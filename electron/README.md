# 送货宝 · 独立 Electron 项目

所有业务页面、脚本、样式、品牌资源和 3D 引擎都由本目录维护。开发、测试和打包不需要相邻项目目录，正式入口为 `webapp/index.html`。

## 源码结构

```text
electron/
├─ main.js / preload.js       # 原生窗口、文件、图片和打印桥
├─ webapp/
│  ├─ index.html              # 唯一业务入口
│  ├─ js/views/               # 开单、单据、客户、商品、统计、账单、打印、设置
│  ├─ js/store.js             # 原有业务存储和 JSON 备份格式
│  ├─ css/ / assets/          # 业务样式和品牌资源
│  └─ vendor/three.min.js     # 唯一 Three.js 运行资源
├─ renderer/
│  ├─ desktop.js             # 唯一路由、模块窗口和场景调度
│  ├─ warehouse-scene.js      # 唯一 3D 场景维护源
│  ├─ desktop.css
│  ├─ src/                   # 外壳 HTML 模板和原始外壳 CSS
│  └─ generated/             # 自动生成，不手改、不提交
├─ scripts/                  # 构建和安装包核验
├─ tests/                    # 独立临时数据目录的回归与性能测量
└─ docs/                     # 历史设计记录，不参与运行或构建
```

## 安装依赖与启动

在本目录安装依赖后运行：

```powershell
npm install
npm start
# 开发启动
npm run dev
```

仓库保留 `pnpm-lock.yaml`，也可使用 `pnpm install --frozen-lockfile` 安装锁定依赖。现有 Electron 和 electron-builder 版本未升级。

启动及构建前会自动运行 `scripts/build-desktop-assets.cjs`。它只读取 `renderer/src/`，生成 `renderer/generated/shell.js` 和 `workspace.css`，不读取设计原型或外部项目。

## 打包

```powershell
npm run build:win       # Windows x64 NSIS 安装包
npm run build:win:dir   # Windows 解包目录
npm run verify:package # 源文件/安装包内容/启动自检
```

产物位于 `dist/`。业务资源和桌面资源一起进入 `resources/app.asar`，开发和生产采用相同相对目录。Windows 图标来自本项目 `webapp/assets/brand/dns-icon-512.png`。

macOS / Linux 的构建命令保留为 `npm run build:mac` / `npm run build:linux`，本轮只验证 Windows 构建。安装包尚未配置商业代码签名。

## 数据与兼容

- 应用名 `songhuodan-desktop`、appId `com.songhuodan.desktop`、默认 userData 位置和全部 `sd_v1_*` 业务键保持原有值。
- 通过临时旧 file 路径、退出进程、再启动新入口验证已有单据、客户、商品、图片路径、一客一价、序号和桌面偏好可读。
- 商品初始化目录升级可能补充新的内置商品；迁移测试同时确认原有用户记录及已设价格保持原值。
- JSON 备份继续使用 `songhuodan` / version 1 格式。迁移与回归均使用独立临时 profile，不操作日常业务数据。
- 图片默认位于程序同级 `CommercesData/`，也可在设置中选择目录。JSON 只记录图片路径，跨电脑迁移还需复制图片文件并调整目录。
- 同一 profile 仅允许一个应用实例写入。请继续定期导出备份；多键 localStorage 仍不保证断电时的事务原子性。

## 场景与性能

首页保留仓库场景及真实业务指标。打开业务模块时画面静止，返回首页复用同一场景。隐藏/最小化窗口时暂停，关闭场景、手动暂停及系统减少动态效果设置均生效。帧率上限 30 FPS，像素比上限 1.25。

工作台采用已选定的**固定分区**：左侧今日送货，右上统计对账，右下当前单据。左侧范围切换不改变今日汇总；选中历史单据也不会把旧单号混入今日信息。

全部单据和完整统计在原分区展开，详情使用固定阅读区域。新建/编辑、商品、客户和本机设置仍使用任务窗口；关闭任务回到原记录，保留列表筛选和阅读位置。打印与月度账单进入专用阅读区，提供返回原位置入口。门口是装饰，货车打开固定单据区，模型/名称/导航映射到相同模块。

经营汇总按 Store 成功提交的 revision 和日期缓存；数据更新会失效缓存。场景销毁时释放监听、观察器、几何体、材质、纹理、阴影和 WebGL 上下文。

销售趋势采用固定范围的列宽和明确间距；多日期可横向滚动，柱顶高度保留比例，日期标签不会互相挤压。

## 验证

```powershell
npm test                 # 数据逻辑 + 无外部目录的复制启动验证
npm run test:ui          # 开单/复制/校验/失败重试/统计/打印内容
npm run test:desktop     # 正式入口、持久化、导航、备份、窗口和打印 PDF
npm run test:workspace   # 固定分区、真实鼠标点击、门口/货车、位置恢复和布局
npm run test:migration   # 旧路径 profile、备份、价格、图片和序号兼容
npm run test:3d          # 暂停恢复、生命周期、资源释放、趋势布局
npm run test:native      # 文件 IPC、取消/错误、图片复制和打印派发
npm run test:performance # 实际帧数和 5000 单据测量
```

运行测量、截图和安装包核验日志写入 `.shots/standalone/`；业务回归截图/PDF 写入 `.shots/electron-live/`。

固定分区实测截图、PDF 和 12 组验收结果位于 `.shots/fixed-workspace/`，变更说明见 [固定分区验收](docs/fixed-workspace-2026-11-09.md)。

固定分区本次验收的独立安装包位于 `dist/fixed-workspace/`，使用 `node scripts/verify-desktop-package.cjs dist/fixed-workspace` 核验；默认构建命令仍输出到 `dist/`。

原生测试保留真实 preload/IPC/文件读写，文件对话框返回值和系统打印回调由测试替代，不会向物理打印机出纸。Windows EXE 直接启动的环境限制与本轮完整记录见 [独立迁移验收](docs/standalone-2026-11-09.md)。
