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
- 设置的“数据管理 → 备份与换机”只常驻“备份到文件”“从备份恢复”两个操作；表格导入导出及高级选项默认收起。商品和客户各合并成一行，包含导入、导出格式和导出按钮。清空数据、目录及手动更新本机备份放在高级选项内。
- “备份到文件”生成一个 ZIP：`data.json` 保存客户、单据、自建/导入商品、公司设置、一客一价和单号序号，`images/` 保存商品图片原文件。初始化商品定义不重复导出，只保留关联 ID 和改价、下架等差异，恢复时由本机内置目录重建。
- 图片直接读取原文件，不经过缩略图通道；共享图片按内容去重。导入后图片写入新电脑 `CommercesData/restore-*` 目录，并自动更新商品路径。初始化商品的默认配图继续使用随应用打包的资源。
- 新电脑安装相同或兼容版本后，在“设置 → 从备份恢复”选择 ZIP 即可恢复。也支持选择解压后的 `data.json`，同时保留相邻 `images/` 文件夹。图片缺失、校验失败或写入失败会中止恢复；业务数据校验失败会清理本次暂存图片，不替换现有数据。
- 旧完整 JSON 和自动快照继续兼容；旧 JSON 内嵌的图片也会恢复成本地文件。仅含外部图片路径的旧 JSON 无法补回缺失的图片，需要从旧电脑重新导出含原图的备份包。目录自动备份仍保留完整数据和图片。迁移与回归均使用独立临时 profile，不操作日常业务数据。
- 本机最新镜像随保存更新；历史快照每天至多新增一份，跨重启复用当天快照，滚动保留 10 份历史快照，`data-latest.json` 单独保留。高级选项中的“更新本机备份”刷新最新镜像和图片，不会在同一天不断挤掉旧历史。
- 数量及单价显示保留已存储的小数，最终金额仍显示两位；同名分享文件自动编号。账单 Excel 包含整单结算备注。CSV 文本字段会添加必要的防公式前缀，完整数据迁移请继续使用 ZIP 备份。
- 展开“表格导入导出”，在“商品资料”“客户资料”行内选择 Excel 或 CSV 再导出，默认 Excel。两种格式使用相同字段和数据，商品均包含已下架状态。选择格式不触发导出。
- 同一行的“导入”直接选择 `.xlsx`、`.xls` 或 CSV 文件即可，按内容自动识别格式、标题后的表头及相关工作表，无需选择格式或先转换。数值价格读取原值，电话/条码保留文本或单元格格式中已有的前导零。重复记录跳过；文件出错整批取消。Excel 解析库离线打包，按需在后台 worker 中加载。
- 开单再次添加同一商品时，规格、单位、单价、备注相同才累加数量并重算金额；不同商品 ID 不会因名称或图片相同而合并。日常新增和单行合并只刷新对应卡片与合计。编辑数量按新值替换，历史单据不会在打开时自动整理。手输商品有歧义时须在商品库选定具体商品。
- 同一 profile 仅允许一个应用实例写入。请继续定期导出备份；多键 localStorage 仍不保证断电时的事务原子性。

## 场景与性能

首页保留仓库场景及真实业务指标。打开业务模块时画面静止，返回首页复用同一场景。隐藏/最小化窗口时暂停，关闭场景、手动暂停及系统减少动态效果设置均生效。帧率上限 30 FPS，像素比上限 1.25。

工作台左侧保留今日送货，右上保留统计对账。“当前单据”默认隐藏，点击今日送货中的某一行后，从该行右侧滑出关联预览，选中行高亮并用连接指示对应。切换单据就地更新，关闭按钮、空白处或 Esc 可收起；靠近窗口底部时自动调整位置，长内容在卡片内滚动。左侧范围切换不改变今日汇总；选中历史单据也不会把旧单号混入今日信息。

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
npm run test:backup      # 两个独立 Electron 进程验证 ZIP 换机、原图字节一致、失败回滚及异常导出拦截
npm run test:p2          # 小数打印、账单备注、即时筛选、CSV/XLSX 编码及分享防覆盖
npm run test:order-merge # 重复商品累加、价格/规格隔离、金额精度、持久化及 300 行局部刷新验证
npm run test:settings-export # 商品/客户格式选择、真实文件内容、取消/失败、重复点击及最小窗口布局
npm run test:data-import # XLSX/XLS/CSV 自动识别、现有导出回导、多表回滚、前导零及离线后台解析
npm run test:settings-data # 默认收起、商品/客户行合并、真实点击、恢复/清空确认及小窗口布局
npm run test:order-preview # 单据行关联侧滑、滚动/尺寸跟随、关闭/键盘、详情/打印/编辑返回
npm run test:performance # 实际帧数和 5000 单据测量
```

运行测量、截图和安装包核验日志写入 `.shots/standalone/`；业务回归截图/PDF 写入 `.shots/electron-live/`。

固定分区实测截图、PDF 和 12 组验收结果位于 `.shots/fixed-workspace/`，变更说明见 [固定分区验收](docs/fixed-workspace-2026-11-09.md)。

固定分区本次验收的独立安装包位于 `dist/fixed-workspace/`，使用 `node scripts/verify-desktop-package.cjs dist/fixed-workspace` 核验；默认构建命令仍输出到 `dist/`。

原生测试保留真实 preload/IPC/文件读写，文件对话框返回值和系统打印回调由测试替代，不会向物理打印机出纸。Windows EXE 直接启动的环境限制与本轮完整记录见 [独立迁移验收](docs/standalone-2026-11-09.md)。
