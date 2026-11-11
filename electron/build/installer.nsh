; 自定义安装器逻辑（electron-builder NSIS include）。
;
; 包含两个宏：
;   1) customCheckAppRunning —— 替换默认模板 allowOnlyOneInstallerInstance.nsh 的
;      _CHECK_APP_RUNNING：把难懂的「送货单统计 无法关闭。请手动关闭它，然后单击重试以继续。」
;      改成「友好询问 → 自动结束进程（含子进程，最多 10 轮）→ 仍关不掉才用中文给出办法」。
;   2) customPageAfterChangeDir —— 仅在 assisted 安装向导（可自选安装目录）里生效：
;      选完目录后、开始写文件前，清理上一个安装残留的 Uninstall 子目录，并再次确认程序没在运行。
;
; 相对默认实现的三点改进：
;   1. 检测进程时不再附加 /FI "USERNAME eq %USERNAME%" 过滤条件，
;      因此当程序是以「管理员身份运行」启动时也能被检测到并清理
;      （默认实现正是在这种情况下检测得到、却杀不掉，才弹那句英文提示）。
;   2. taskkill 增加 /t（连同子进程一起结束，Electron 会派生子进程）并最多重试 10 轮，
;      每次强制结束后重新检测，避免「进程刚退出、系统还没刷新」被误判成「关不掉」。
;   3. 失败提示改为中文，并直接给出可执行解决办法。
;
; 注意：管道符在 NSIS 反引号字符串里必须原样写成 |（写成 ^| 会被 cmd 当成转义，
;      管道失效）。这一点与 electron-builder 默认模板一致。

!macro sd_detect_app_running
  ; 返回 $0 = 0 表示程序正在运行（nsExec::Exec 的返回值即管道末端 find.exe 的退出码）
  nsExec::Exec `/SYSTEMROOT\System32\cmd.exe /c tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO csv | /SYSTEMROOT\System32\find.exe "${APP_EXECUTABLE_FILENAME}"`
  Pop $0
!macroend

!macro sd_kill_app
  DetailPrint `正在关闭 ${PRODUCT_NAME}...`

  ; 先温和关闭（等同于点窗口的关闭按钮）
  nsExec::Exec `/SYSTEMROOT\System32\cmd.exe /c taskkill /im "${APP_EXECUTABLE_FILENAME}"`
  Sleep 800

  !insertmacro sd_detect_app_running

  ; 温和关闭失败 → 强制结束（含子进程），最多重试 10 轮
  StrCpy $R1 0
  sd_force_kill:
  ${If} $0 == 0
    nsExec::Exec `/SYSTEMROOT\System32\cmd.exe /c taskkill /f /t /im "${APP_EXECUTABLE_FILENAME}"`
    Sleep 800
    !insertmacro sd_detect_app_running
    IntOp $R1 $R1 + 1
    ${If} $0 == 0
      ${If} $R1 < 10
        DetailPrint `等待 ${PRODUCT_NAME} 退出...`
        Sleep 500
        Goto sd_force_kill
      ${EndIf}
      ; 仍然关不掉：通常是程序以管理员身份运行（普通权限的安装器无法结束它）
      !ifdef BUILD_UNINSTALLER
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "「${PRODUCT_NAME}」正在运行，卸载程序无法自动关闭它。$\r$\n$\r$\n请关闭所有「${PRODUCT_NAME}」窗口后单击「重试」。$\r$\n$\r$\n若仍不行，请打开任务管理器（Ctrl+Shift+Esc）结束所有「${APP_EXECUTABLE_FILENAME}」进程。" /SD IDCANCEL IDRETRY sd_force_kill
        Quit
      !else
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "「${PRODUCT_NAME}」正在运行，安装程序无法自动关闭它。$\r$\n$\r$\n解决办法（任选其一）：$\r$\n$\r$\n1. 关闭「${PRODUCT_NAME}」的所有窗口，然后重新运行本安装包；$\r$\n2. 打开任务管理器（Ctrl+Shift+Esc），在「详细信息」里结束所有「${APP_EXECUTABLE_FILENAME}」进程后重试；$\r$\n$\r$\n3. 右键本安装包 → 「以管理员身份运行」——如果之前是用管理员身份启动过程序，必须用同样权限安装才能关掉它；$\r$\n$\r$\n4. 不想安装也可以直接使用免安装版：运行 dist\win-unpacked\${APP_EXECUTABLE_FILENAME}，功能完全相同。" /SD IDCANCEL IDRETRY sd_force_kill
        Quit
      !endif
    ${EndIf}
  ${EndIf}
!macroend

!macro customCheckAppRunning
  ; 清理上一次安装残留的 Uninstall 子目录（某些旧安装器会留下它），
  ; 否则写卸载器时会报「不能打开要写入的文件: ...\Uninstall\xxx.exe」
  RMDir /r "$INSTDIR\Uninstall"

  !insertmacro sd_detect_app_running

  ${If} $0 == 0
    ; 检测到程序正在运行：先问用户，避免直接杀掉未保存的数据
    !ifdef BUILD_UNINSTALLER
      MessageBox MB_YESNO|MB_ICONEXCLAMATION "检测到「${PRODUCT_NAME}」正在运行。$\r$\n$\r$\n卸载需要先关闭它，现在自动关闭并继续卸载吗？$\r$\n$\r$\n（选择「否」将取消卸载；若有未保存的内容，请先在程序里保存好再重试。）" /SD IDYES IDYES sd_do_kill IDNO sd_abort_install
    !else
      MessageBox MB_YESNO|MB_ICONEXCLAMATION "检测到「${PRODUCT_NAME}」正在运行。$\r$\n$\r$\n安装需要先关闭它，现在自动关闭并继续安装吗？$\r$\n$\r$\n（选择「否」将取消安装；若有未保存的内容，请先在程序里保存好再重试。）" /SD IDYES IDYES sd_do_kill IDNO sd_abort_install
    !endif
    sd_abort_install:
    Quit
    sd_do_kill:
    !insertmacro sd_kill_app
  ${EndIf}
!macroend

; ------------------------------------------------------------
; 卸载前的数据保险
; ------------------------------------------------------------
; electron-builder 默认的卸载器会执行 `RMDir /r $INSTDIR`，也就是把整个
; 安装目录连同里面的「用户数据」目录一起删掉。老板卸载后如果直接重装，
; 单据 / 客户 / 改过的商品价格就会连同目录一起消失。
;
; 这里在卸载流程最开始（customUnInit）先把「用户数据」目录里的文件复制
; 一份到程序目录之外的备份目录（%APPDATA%\送货单统计数据备份）。
; 重装后程序启动时发现安装目录是空的，就会自动从这份备份恢复。
;
; 说明：应用运行时本身已经持续在目录外留备份，这份拷贝是额外的一层保险
; （覆盖「卸载前最后一次改动还没来得及写备份」的极小概率情况）。
!macro sd_keep_user_data
  !ifdef BUILD_UNINSTALLER
    IfFileExists "$INSTDIR\用户数据\*.*" 0 sd_skip_keep
    CreateDirectory "$APPDATA\送货单统计数据备份"
    CopyFiles /SILENT "$INSTDIR\用户数据\*.*" "$APPDATA\送货单统计数据备份\"
    sd_skip_keep:
  !endif
!macroend

!macro customUnInit
  !insertmacro sd_keep_user_data
!macroend
