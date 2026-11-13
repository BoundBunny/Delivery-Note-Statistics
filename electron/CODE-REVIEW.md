# 送货宝 Electron 代码审查报告

> 审查范围：`main.js`、`preload.js`、`lib/data-store.js`、`webapp/js/{store,util}.js`、`webapp/js/views/{order,orders,stats,bill,print,data,settings}.js`、`renderer/{desktop.js,warehouse-scene.js,desktop.css}`、`webapp/index.html`、`webapp/js/app.js`、`build/installer.nsh`、`package.json`。
> 说明：每条隐患都给出「位置 / 问题 / 触发 / 后果 / 排查理由」，便于复现和核验。行号对应当前工作区代码。

---

## 0. 架构与数据流（一句话）

渲染进程（浏览器前端）→ `preload.js` 注入的 `window.__DNSStorage`（同步 IPC）→ 主进程 `main.js` → `lib/data-store.js`（每个业务 key 一个 JSON 文件，同步落盘 + 目录外镜像备份）。`webapp/js/store.js` 是唯一的业务数据层（内存缓存 + 校验 + 事务），所有视图只通过 `Store` 读写。

---

## 1. 数据持久化核查（对应你最初的核心需求）

### 1.1 现状：确实做到了「安装目录相对路径 + 目录外备份 + 重装可恢复 + 只初始化商品」

| 机制 | 实现位置 | 说明 |
|---|---|---|
| 主数据目录 = exe 同级「用户数据」 | `main.js:147-158` `dataDir()` | 打包后 `appBaseDir()/用户数据`（`appBaseDir()=dirname(process.execPath)`，`main.js:91-93`） |
| 目录不可写则回退 `%APPDATA%\送货单统计数据` | `main.js:151-156` | 先 `isWritableDir()`（写 `.write-probe.tmp`）探测，失败置 `dataDirFallback=true` |
| 目录外备份 `%APPDATA%\送货单统计数据备份` | `main.js:161-165` `backupDir()` | 刻意不放安装目录、也不放 electron 的 userData，避免卸载「删除应用数据」时被抹掉 |
| 每 key 独立 JSON + 镜像备份 | `lib/data-store.js` | 主目录 `dataDir/<encodeURIComponent(key)>.json`；备份 `data-latest.json` + `data-YYYYMMDD-HHMMSS.json`（`BACKUP_KEEP=10`，`BACKUP_DELAY=1200` 防抖） |
| 启动自愈 | `main.js:951-967` `initStorage()` | `seedBackupFromLegacy → getDataStore(load) → restoreImages → repairImagePaths → syncImageDirs → flushBackup` |
| 退出前刷备份 | `main.js:988-992` | `before-quit` 调 `flushBackup()` |
| 卸载前留存 | `build/installer.nsh:96-106` `sd_keep_user_data` | 卸载前 `CopyFiles` 把 `$INSTDIR\用户数据\*.*` 拷到备份目录 |
| 只初始化商品 | `webapp/js/store.js:229-309` `seedInitialProducts()` | 由 `SEED_FLAG='sd_v1_seed_products_v4'` 一次性门控；单据/客户不灌种；`clearAll()` 移除标记后仅重新灌商品 |

**结论：整体方向正确，落地完整。清理/重装/误删程序的保命链路是有的。**

### 1.2 但有几个会影响「老板数据不丢」这个目标的缺口

1. **回退了「安装目录相对路径」是静默的**（`main.js:151-156`）
   - 问题：装到 Program Files 等不可写位置且无管理员权限时，数据会落到 `%APPDATA%\送货单统计数据`，界面不会显著提示。
   - 后果：老板以为数据在程序目录里，实际在 AppData；把程序文件夹整体拷到另一台电脑时，数据不会跟着走。
   - 排查理由：`storageInfo()` 返回了 `fallback` 标志（`main.js:594-607`），但设置页未对它做强提示，可先在设置「数据保存位置」把该状态明确标红。
2. **只做「整体为空」才从备份恢复，单文件丢失不自动补**（`lib/data-store.js` `load()`）
   - 问题：只有主目录 **全空** 才逐 key 从备份恢复；若只丢/坏 `sd_v1_orders.json` 而其它文件在，该 key 静默为空且不会用备份里的同名 key 回填。
   - 后果：老板误删的是「某一个文件」时，数据看起来丢了一块。
   - 排查理由：构造「主目录只剩 settings，删掉 orders.json」即可复现——启动后 orders 为空、备份里明明有。
3. **损坏文件会被接受并反写覆盖好备份**（`lib/data-store.js` `load()`/`writeBackupMirror()`）
   - 问题：读 key 文件只当文本存、不 `JSON.parse` 校验；随后 `writeBackupMirror()` 把当前（含坏数据）状态写回备份 → 好备份被顶掉。
   - 后果：一次非正常退出写出半截 JSON，就可能把「最后的干净备份」也污染。
   - 排查理由：`store.js:129-150` 在内存层会校验并 `recoveryBlocked`，但 `data-store` 已先一步覆盖备份，双层保护没兜住。
4. **历史日期快照只写不读**（`lib/data-store.js`）
   - 问题：`data-YYYYMMDD-HHMMSS.json` 只写不读，`load()` 只认 `data-latest.json`。
   - 后果：留了 10 份快照却无法用来「回滚到昨天」，形同占空间。
5. **卸载脚本拷贝非递归**（`build/installer.nsh`）
   - 问题：`CopyFiles` 没加 `/r`，`用户数据` 下若有子目录不会被拷走；且拷贝后默认卸载器仍 `RMDir /r $INSTDIR` 删除用户数据。
   - 后果：目前数据文件是扁平结构，暂不出事；一旦引入子目录（如子文件夹归档）会漏备份。

---

## 2. 各模块功能清单 + 逻辑错误

### 2.1 main.js（主进程，996 行）
**功能**：窗口/托盘/单实例；关闭行为（站内弹窗 + 原生对话框 + 记住选择）；数据目录与备份；`sdimg://` 自定义图片协议（bundle/local）；存储同步 IPC；文件保存/选择/分享；Excel/CSV/JSON 导入文本解码；打印（整窗 `webContents.print`）；缩略图缓存；菜单快捷键；冒烟自检 `--smoke`。
**隐患**：
- 【中】`process.on('uncaughtException')`（14-22）静默吞掉非 EPIPE 异常并 `exit(0)`，崩溃无日志。
- 【中】`sd:printPdf`（749-759）打印整个 webContents，无 `pageSize`、`jobName` 未使用；依赖 @media print 隐藏 UI。
- 【低】`sdimg://local/?p=` 只校验 `isAbsolute`+扩展名（844-869），任意绝对路径图片可读（本机应用风险有限）。
- 【低】`safeFileName` 只处理 Windows 非法字符，不处理保留名（CON/PRN）。
- 【说明】`SMOKE` 在 872 行才声明，但 150/163 行引用——因是延迟调用，运行时安全。

### 2.2 preload.js（桥接，10KB）
**功能**：注入 `window.Android`（同 Android 签名）+ `window.__DNSStorage`（同步 localStorage 兼容层）；文件回调、打印、分享、图片目录、存储信息、关闭偏好。
**隐患**：
- 【中】每次读写走 `ipcRenderer.sendSync` 同步阻塞主进程，高频写（recalc/persist）有卡顿隐患（数据量小可接受）。
- 【低】`contextIsolation:false` + 页面同 world，安全边界依赖只加载本地文件。

### 2.3 lib/data-store.js（持久化，16KB）
见第 1.2 节 5 条。另：
- 【低】`status.corrupt` 字段声明但从未赋值（死代码）。

### 2.4 webapp/js/store.js（数据层核心，50KB）
**功能**：`sd_v1_*` 键持久化 + localStorage 迁移；`load()/persist()/transaction()`；初始商品/分类/价格灌种；启动幂等去重 `dedupeProducts`；商品/客户/单据 CRUD；单号生成 `nextOrderNo/reclaimNo`；一客一价；`validateSnapshot` 结构校验；JSON/CSV 导入导出；`clearAll`；只读保护 `recoveryState`。
**隐患**：
- 【高】**`!Number.isSafeInteger(Math.round(v*100))` 形同虚设**（556-574 `upsertProduct`）：`Math.round` 对任何有限数都返回整数，拦不住 3 位小数（1.005 原样入库，显示 ¥1.01）。`data.js:557` 的价格校验同源缺陷。
- 【高】**`nextOrderNo` 每次调用即 persist 消耗序号**（658-673）：`order.js:21` 打开新建页就占号，取消/改日期不回退 → 单号空洞、易误判漏单。
- 【中】**任一键损坏 → 全局只读**（129-150）：一条脏商品记录即把整个应用锁成只读，误锁风险高。
- 【中】`importProductsCSV/importCustomersCSV` 先改内存再 persist，未包 transaction，只读态抛错后内存已脏。
- 【低】`billGroups(ym)` 用 `ym+'-31'` 靠字符串比较（对 2 月可用但脆弱）。
- 【低】`clearAll()` 不清理备份目录与备份图片。

### 2.5 webapp/js/views/order.js（开单，579 行）
**功能**：新建/编辑送货单；货品弹窗+卡片网格；实时合计（件数+金额小写大写）；一客一价；客户弹层；事务保存（自动建档客户/商品）；详情/上下张/复制新增/打印导出/删除；离开保护。
**隐患**：
- 【高】**空单价当 ¥0 放行**（272-276 / 398）：无 `!price` 判空，`Number('')===0` 通过校验，生成 ¥0 明细无提示、合计偏低，`validateSnapshot` 也通过。
- 【高】打开即占号且取消不回退（21/32/378-381）。
- 【中】一客一价只在「先选客户后点商品」生效（258-261），改客户不回填已有行（328-348）。
- 【中】就地新增客户立即 persist（340-348），取消单后残留孤立客户；客户被删后单据仍留旧 id。
- 【低】编辑改送货日期不重生成单号（378 仅 `!draft.id` 分支 + 575 沿用 `o.no`）→ 单号内嵌 YMD 与日期矛盾。
- 【低】商品改名后旧单 pid 命中保留旧 name、缩略图按 pid 显示新图 → 文本旧名/图新名不一致。
- 【低】数量允许小数（273），「件数」可显示 1.5 件。

### 2.6 webapp/js/views/orders.js（单据列表，5.9KB）
**功能**：区间+关键词（200ms 防抖）筛选；列表/底部合计；导出 Excel；点进详情。
**隐患**：
- 【中】`st.customerId` 由路由 `?customer=` 注入（desktop.js:182），页面无「按客户筛选」标识、无清除入口 → 以为看全部实际被过滤、合计偏小。
- 【中】自定义日期面板初始 `class="hidden"`，`range==='custom'` 重渲染后仍隐藏。
- 【低】输入后立刻导出用旧 `st.kw`；导出文件名只含 `from` 易同名。

### 2.7 webapp/js/views/stats.js（统计，16.8KB）
**功能**：区间统计（今日/周/月/年/自定义）+ 汇总卡 + 日趋势 + 客户/商品排行 + 月度账单列表；导出/预览。
**隐患**：
- 【中】趋势只取最近 30 个「有销售」日（118-137），汇总卡取全区间 → 趋势金额和 ≠ 销售额卡。
- 【中】自定义面板 `L214` 写死 `class="hidden"`，仅点击时移除（248-249），重进/重渲染若 `st.range==='custom'` 日期框仍看不见。
- 【中】客户数只算有 `customer.id` 的单（72/186-189），散客不计 → 「有单但客户数 0」。
- 【中】「导出」（272-276）实调 `Store.ordersCSV` 明细 CSV，文件名却「销售统计」。

### 2.8 webapp/js/views/bill.js（月度账单，6.3KB）
**功能**：按 `#/bill?m&c&n` 渲染账单三联视图；算合计/大写；编辑标题备注；导出 Excel；打印。
**隐患**：
- 【中】备注标签称「打印/导出时显示在底部」，但导出 Excel footer 不含 `st.note`（73 vs 111-118）。
- 【中】`esc(st.note)` 放普通 div，`\n` 不转 `<br>`，多行备注被压一行（61）。
- 【中】标题/备注仅存内存，离开页即丢失（31/101-108）。
- 【中】编辑面板 `data-role="editBox"` 未被 @media print 隐藏，编辑态打印会把表单印出（88 + styles.css:585）。

### 2.9 webapp/js/views/print.js（送货单打印，13.9KB）
**功能**：Canvas 复刻三联单；HTML 预览；存 PNG/打印 PDF/分享；空白检测。
**隐患**：
- 【中】Canvas 高度随明细线性 ×scale2，明细约 >700–1000 行超 Chromium 上限（~32767px）→ `toDataURL` 失败统一 toast「图片生成失败」（9-43/288-293）。
- 【中】print 按钮 `printPdf` 不 await 不判 ok，失败无提示（279-283）。
- 【中】HTML 预览 >8 行不分页，导出是一张超长图非 A4 分页（206/231-242）。
- 【低】`jobName` 主进程未用，存 PDF 文件名取决于页面 title。
- 【低】`fillText(maxWidth)` 超长文本横向压缩不变小字。

### 2.10 webapp/js/views/data.js（客户/商品，642 行）
**功能**：客户列表（搜索/字母索引/增改删、乱码名预警）；商品卡片网格（分类筛选、增改删、图片、软删/下架与恢复）。
**隐患**：
- 【高】价格「两位小数」约束形同虚设（同 store.js:559）；`198-201` 遗留分支还用更松的 `parseFloat`（"1,234"→1）。
- 【高】图片无去重/无清理（612-618）：选图即落盘，①选图后取消→孤儿；②换图不删旧图；③移除图片只清字段不删文件。
- 【中】商品软删靠脆弱的「pid 或 name+spec」等价键（store.js:576-583），改名/改规格后可能误判「无单据」而硬删。
- 【中】编辑商品清空单价保存 → `readOptionalMoney` 返回 undefined 经 `Object.assign` 覆盖为 undefined，默认单价被误清（557-560 + store.js:561）。
- 【中】删客户仅按名称确认、未用 `countCustomerOrders` 展示关联单据数，硬删不可逆（233-239）。

### 2.11 webapp/js/views/settings.js（设置，430 行）
**功能**：公司信息；数据管理（导出/恢复备份、Excel 导出、CSV 导入、清空）；数据/备份/图片目录；关闭行为；3D 开关；关于。
**隐患**：
- 【高】更改/恢复图片目录只 `setSettings({imageDir})`，不迁移旧图、不提示、备份范围仍按旧目录（`imageDirsToBackup` 只含默认+当前）→ 跨机恢复旧图丢失（219-234 + main.js:200-229）。
- 【高】恢复备份只回填 JSON，不触发 `restoreImages/repairImagePaths`；且备份含 `settings.imageDir` 绝对路径，换机后指向旧机路径（283-296）。
- 【中】只读 `recoveryBlocked` 时 data.js/settings.js 均不调 `recoveryState()`，写按钮不禁用，仅靠 store 抛错兜底。
- 【中】「导出备份」在只读态会抛错被 catch 成失败 toast，而设置页没有「导出原始数据」按钮（恢复路径断点）。
- 【中】清空不清理图片/备份；导入/清空在只读态先改内存再抛错。
- 【低】无「更改数据目录」入口（产品约束，非缺陷）。

### 2.12 renderer/desktop.js（桌面外壳，341 行）+ warehouse-scene.js（3D）
**功能**：启动构建覆盖层/业务页/阅读页；路由（home/orders/order/stats/print/bill/new/edit/products/customers/settings/company）；场景标签；可拖拽/最大化模块窗口；面板懒建；全局搜索；快捷键（Esc、/、Ctrl+N）；打印入口；关闭提示链路；只读提示条；3D 场景按模式/可见性/窗口激活暂停恢复。
**隐患**：
- 【高】**未保存检测覆盖不全**（36-39 `isDirty` + data.js:63/82）：只认 order 的 `__draft` 和 order/company 表单，**商品/客户编辑弹窗无脏标记** → 填一半按 Esc/点遮罩/切路由，输入被静默丢弃。
- 【高】只读仅在路由层拦 `/order/new|edit`（173），**未拦 /products、/customers、/settings** → 只读态仍能进编辑，保存时才抛错。
- 【中】关闭弹窗文案固定「数据已自动保存」，从不查询 `isDirty`（util.js:244 对照 39/297）→ 文案误导；商品/客户脏数据两边都漏。
- 【中】全局无 `window.onerror/unhandledrejection`，`Store.subscribe` 回调 `Promise.resolve().then(listener).catch(()=>{})` 静默吞渲染异常（store.js:172）→ 数据已写但界面不刷新、无提示无日志。
- 【中】3D 初始化失败（247）只 `console.error` + 提示，`prefs.scene` 仍 true、无永久降级 → 每次 `updateScene` 重试、重复建 WebGL 上下文、控制台刷屏；fallback 无「重试/关闭」按钮。
- 【中】首次 Ctrl+P 只跳预览不打印（290-295 + main.js:519-520、749-752）：非 /print|/bill 时 `go('#/print')` 后 return，主进程见 handled 不再兜底。
- 【中】route 内先 `refresh()`（已渲四项）随后又显式调同样四项（199-200 对照 123-129）→ revision 变化时 DOM 双重建、列表闪烁。
- 【低】`mountView` 中途发现 hash 已变返回 false 且各路由直接 return（161-166/189/194/196-197），已 `clearView`+`page.hidden=true` → 快速切换可能短暂空白。
- 【低】Ctrl+N 渲染层与应用菜单加速器重复绑定；Esc 在任意 `#modal-root .mask` 存在时直接 return，确认框无 Esc 关闭。
- 【低】`scrollPositions` 按 hash 永久累积不清理（20/200/332-339）。
- 【已确认无问题】启动时序（preload `storageInit` 先于 store `load()`）、场景创建次序（245-246）、`will-prevent-unload` 语义（484-487）、`start()` 防重复初始化、`destroy()` 清理——均正确，勿误报。

### 2.13 build/installer.nsh + package.json
**功能**：安装/卸载钩子（检测并结束占用进程、卸载前留存用户数据）；`nsis` 非一键安装、可改安装目录、可提权；files 白名单只打包运行必需文件；afterPack 清理。
**隐患**：见 1.2-5（拷贝非递归）。

---

## 3. 按严重度汇总（建议修复顺序）

**P1（会真丢/错数据或锁死）**
1. 商品/客户弹窗未保存静默丢弃（desktop.js:36-39 + data.js:63/82）。
2. 只读态仍能进商品/客户/设置编辑（desktop.js:173 未拦）。
3. 价格两位小数约束失效（store.js:556-574 / data.js:557）。
4. 空单价当 ¥0 生成明细（order.js:272-276/398）。
5. 数据损坏时「单文件丢失不回填 / 坏数据反写覆盖好备份」（data-store load/mirror）。
6. 图片无去重/无清理；改图片目录不迁移、备份范围不更新。

**P2（体验/一致性/可靠性）**
7. 单号打开即占号且取消不回退（order.js + store.js:658-673）。
8. 全局渲染异常静默（无 onerror + subscribe catch 吞错）。
9. 3D 失败无永久降级/重试按钮。
10. 趋势口径不一致、自定义面板重渲染隐藏、客户数漏散客。
11. 恢复备份不恢复图片、备份含旧机 imageDir。
12. 打印入口不一致（首次 Ctrl+P 只预览）、失败静默、超大单据 Canvas 失败。

**P3（可维护性/可访问性）**
13. 死代码（data-store `status.corrupt`、data.js 遗留商品列表分支）。
14. `decodeImportText/assertImportText` 在 util.js 与 main.js 重复维护。
15. 快捷键重复绑定、Esc 不能关确认框、scrollPositions 不清理。

---

## 4. 建议的核验动作

- 数据目录：装到 `C:\Program Files\...` 无管理员权限，观察设置页「数据保存位置」是否显示 AppData 回退态。
- 单文件恢复：跑一次生成 `用户数据\*.json`，只删 `sd_v1_orders.json`，重启看单据是否还在（应「不自动补」）。
- 坏文件：把某个 key 文件改成半截 JSON，重启看是否被当作数据且备份被覆盖。
- 价格：商品单价填 `1.005` 保存，看是否入库且开单金额出现分位误差。
- 空单价：开单时单价留空、数量填 1，看是否生成 ¥0 行且能保存。
- 未保存：商品编辑填一半按 Esc / 点遮罩，看是否无确认丢弃。
- 只读：制造 `recoveryBlocked` 后进 `#/products` 编辑保存，看是否报错、按钮是否禁用。
- 趋势：选「本年」，对比趋势柱金额之和与汇总卡销售额是否一致。
