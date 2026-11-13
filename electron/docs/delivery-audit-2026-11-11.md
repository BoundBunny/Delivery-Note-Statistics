# 「送货单统计」Electron 桌面版 · 交付标准质量审计

- 审计对象：`E:\github\delivery-note\electron`（version 1.0.0，Electron ^31.7.7）
- 审计方式：源码通读（main.js / preload.js / lib/data-store.js / webapp/js 全量视图与工具 / renderer 外壳）、构建脚本实跑、单元测试直跑、产物与 git 状态核查
- 审计日期：2026-11-11
- 总体判定：**功能完成度高、数据可靠性工程扎实，达到"可小规模自用/内测交付"水平；但按商业交付标准仍缺 4 项硬门槛（代码签名、CSP/进程隔离、事务化存储、LICENSE+CI）。**

---

## 一、优点清单

| # | 维度 | 优点 | 证据 |
|---|------|------|------|
| 1 | 功能完整 | 覆盖开单/编辑/复制新增、客户与商品管理、统计对账、打印导出、客户月度账单、3D 场景工作台、离线可用等完整业务闭环 | `webapp/js/views/*`、`renderer/desktop.js` |
| 2 | 数据可靠性 | 原子写（`.tmp` 写入 + rename，失败回退）、备份写在安装目录之外（卸载不删数据）、10 份滚动备份 + 1200ms 防抖、导入 `validateSnapshot` 校验、原型污染名（`__proto__`/`constructor`）用 null-proto 字典防护 | `lib/data-store.js` |
| 3 | 数据可靠性 | 只读保护模式：数据异常时 `Store.recoveryState().blocked` 全面禁用保存/删除，引导先导出原始数据再恢复；「清空数据后重启不复活」有明确设计 rationale | `lib/data-store.js`、`renderer/desktop.js:69,78,88,293` |
| 4 | 桌面集成 | 单实例锁、窗口状态记忆、托盘最小化、关闭二次确认（站内弹窗 + 原生对话框兜底）、菜单快捷键（新建/列表/打印）、`--smoke` 自检脚本、测试用 env 钩子 | `main.js` |
| 5 | 安全（局部） | 自定义 `sdimg` 协议对 `bundle` 资源做了路径穿越防护（限定 `WEB_ROOT` 前缀，越界 403） | `main.js` registerImageProtocol |
| 6 | 安全（渲染层） | 统一 `esc()` 转义纪律良好：抽查 67 处用户数据（客户名/备注/规格/地址/公司等）插值**全部经 `esc()` 包裹**，能有效抑制 XSS | `webapp/js/views/*`、`webapp/js/util.js` `esc()` |
| 7 | 输入防御 | `decodeImportText` 拒绝二进制（PK/D0CF/PDF）、多编码回退（UTF-16LE/BE、UTF-8 fatal、GB18030）、去 BOM；`readOptionalMoney` 拒绝负数与非 safe-cent | `main.js`、`webapp/js/util.js` |
| 8 | 测试 | 单元/逻辑层 **34 项全部通过**（data-store 9、logic 13、logic-audit 9、desktop-bridge 3）；另有大量 UI/回归/E2E 脚本与 `.shots/` 留痕、12 组固定分区验收记录 | `tests/*.test.cjs`、`.shots/` |
| 9 | 工程化/构建 | `build-desktop-assets.cjs` 可脱离 electron 独立生成桌面资源（exit 0）；`verify-desktop-package.cjs` 校验；files 白名单打包；已产出真实 NSIS 安装包与 `win-unpacked`（Setup 81.6MB / app.asar 8.2MB）；`pnpm-lock.yaml` 固定依赖 | `scripts/`、`dist/` |
| 10 | 可访问性/体验 | 语义化 `nav`/`aria-label`/`aria-current`；遵循系统 `prefers-reduced-motion`；3D 场景性能降级（30FPS / 像素比上限 1.25 / 隐藏或最小化暂停） | `renderer/src/shell.html`、`renderer/desktop.js:229-245` |
| 11 | 文档 | README 详尽（结构/构建/数据兼容/验证命令/已知限制）；`docs/code-review-2026-11-08.md` 诚实记录已修复 P1/P2 与遗留限制 | `README.md`、`docs/` |

---

## 二、劣势 / 风险清单

| # | 严重度 | 问题 | 证据 | 建议 |
|---|--------|------|------|------|
| 1 | 🔴 高 | **进程隔离关闭**：`contextIsolation:false` + `sandbox:false`（仅 `nodeIntegration:false`）。preload 暴露同步 IPC 存储桥、文件读写（saveFile/pickFile/pickProductImage）、打开数据目录，任何渲染层漏洞可触达本地文件系统，缺少纵深防御 | `main.js:394-398`、`preload.js` | 评估开启 `contextIsolation:true` + `sandbox:true`，改用 `contextBridge` 暴露最小 API |
| 2 | 🔴 高 | **无 Content-Security-Policy**：`webapp/index.html`、`renderer/src/shell.html` 均无 CSP；全项目无 CSP 声明，削弱 XSS 缓解 | 全局 grep 无 CSP | 打包页面注入严格 CSP（`default-src 'self'`，限制 `script-src`） |
| 3 | 🔴 高 | **无代码签名**：README 明示"安装包尚未配置商业代码签名" → Windows SmartScreen 拦截、企业分发受阻 | `README.md` | 交付前配置 Authenticode 签名 |
| 4 | 🔴 高 | **持久化非事务**：6 个 `sd_v1_*` localStorage 键无崩溃/断电原子性；金额用浮点 `*100+Math.round` 且精度未集中定义（作者自认） | `docs/code-review-2026-11-08.md`、`lib/data-store.js` | 引入事务化落盘 + 统一金额分整数模型 |
| 5 | 🟠 中 | **图片不可移植**：JSON 只记录图片绝对路径、备份不含图片字节，跨机/换目录需手工复制（已有 `repairImagePaths` 缓解） | `lib/data-store.js`、`main.js` | 备份打包图片或以相对路径 + 内容哈希寻址 |
| 6 | 🟠 中 | **工作树不清洁、改动未提交**：`git status` 有大量未提交改动（android/app、main.js/preload.js/package.json/README、docs/3d-background、build/ 未跟踪）→ 交付基线不可复现、无法追溯 | `git status` | 交付前清理并打 tag |
| 7 | 🟠 中 | **无 CI、无 LICENSE 文件**：`package.json`/README 写 MIT 却无 LICENSE 文本；仓库根同时含 `android` 与 `electron`，交付边界模糊 | 根目录核查、`.github` 不存在 | 补 LICENSE、加 CI（构建 + 测试 + 打包） |
| 8 | 🟠 中 | **并发/多实例写保护不足**（作者自认）：虽有 `requestSingleInstanceLock`，数据层无并发一致性防护 | `docs/code-review-2026-11-08.md` | 加文件锁或写入互斥 |
| 9 | 🟡 低 | **图片目录未收紧**：`sdimg` 协议 `local` host 仅按图片扩展名校验、接受任意绝对路径，未限定到图片目录 | `main.js` registerImageProtocol | 将可读路径限定到 `imageDir` |
| 10 | 🟡 低 | **E2E/打包启动测试强依赖 spawn/图形环境**，本沙箱 `npm test` 因 `spawn EPERM` 无法整体运行（属环境限制，非代码缺陷，但说明 CI 需图形环境准备） | `tests/`、本机运行 | CI 中用带显示环境跑 UI/打包冒烟 |
| 11 | 🟡 低 | 部分视图仍用 `innerHTML` 字符串拼接 + 内联 `onerror`（已转义但可维护性一般）；`renderer/desktop.js` 336 行单文件复杂度偏高 | `webapp/js/views/*`、`renderer/desktop.js` | 逐步组件化、内联事件外置 |

---

## 三、交付判定与修复优先级

- **可交付（内测/自用）**：功能与数据可靠性达标，产物可安装运行。
- **不可直接商业交付**，卡点按优先级：
  1. **P0（必须）**：代码签名（#3）、CSP + 进程隔离加固（#1/#2）、事务化存储与金额精度（#4）
  2. **P1（应当）**：LICENSE + CI（#7）、清洁提交（#6）、图片可移植（#5）、并发写保护（#8）
  3. **P2（可选）**：图片目录收紧（#9）、组件化重构（#11）、CI 图形环境（#10）

> 注：本次审计在受限沙箱内进行，`npm test`（node --test）因沙箱禁止子进程 spawn 报 `spawn EPERM`；已改为直接逐文件运行完成 34 项单元/逻辑测试（全绿），UI/E2E/打包启动类测试需在带图形环境的本机复跑。
