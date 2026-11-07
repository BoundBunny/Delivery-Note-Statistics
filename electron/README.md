# 送货单统计 · 电脑版（Electron）

这是「送货单统计」的桌面壳程序。它**复用 Android 版同一套前端代码**（`index.html` + `js/` + `css/`），
只在主进程里把原本 Android WebView 的四个原生能力（保存文件、选择文件、打印、分享）
换成 Electron 的实现，因此账务逻辑、界面、数据格式与手机版完全一致。

> 数据仍然**纯本地、离线**保存（Electron 的 localStorage，存在系统的用户数据目录里）。

---

## 目录结构

```
delivery-note/
├─ android/                         # 手机版（原有，未改动）
│  └─ app/src/main/assets/app/      # ← 桌面版直接加载这里的前端资源
└─ electron/                        # 电脑版（本次新增）
   ├─ package.json
   ├─ main.js                       # 主进程：窗口、菜单、四个原生能力
   ├─ preload.js                    # 注入 window.Android 桥，前端零改动
   └─ README.md
```

`main.js` 开发时直接 `loadFile` 到 `../android/app/src/main/assets/app/index.html`；
打包时通过 `package.json` 的 `extraResources` 把这套前端资源复制进安装包。

---

## 一、准备环境（只需一次）

1. **安装 Node.js**（建议 18 或 20 LTS 以上）：<https://nodejs.org/>
   安装后在终端确认：
   ```bash
   node -v
   npm -v
   ```

2. **进入 electron 目录并安装依赖**：
   ```bash
   cd delivery-note/electron
   npm install
   ```
   > 若下载 Electron 慢，可先设置国内镜像再安装：
   > ```bash
   > # Windows PowerShell
   > $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
   > npm install
   > ```
   > macOS / Linux：
   > ```bash
   > ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm install
   > ```

---

## 二、启动（开发/日常使用）

在 `delivery-note/electron` 目录执行：

```bash
npm start
```

就会打开「送货单统计」桌面窗口。

带开发者工具启动（排查问题时用）：

```bash
npm run dev
```
> 之后按 `Ctrl+Shift+I`（macOS 为 `Cmd+Option+I`）可随时打开/关闭开发者工具。

---

## 三、打包成安装程序（可选，发给客户用）

```bash
# Windows：生成 dist/ 下的安装包（.exe，NSIS）
npm run build:win

# macOS：生成 .dmg
npm run build:mac

# Linux：生成 .AppImage
npm run build:linux
```

生成的安装包在 `electron/dist/` 目录里。把对应安装包发给客户，双击安装即可。

---

## 四、桌面版快捷键

| 快捷键 | 功能 |
|---|---|
| `Ctrl/Cmd + N` | 新建送货单 |
| `Ctrl/Cmd + L` | 单据列表 |
| `Ctrl/Cmd + P` | 打印当前页（可「另存为 PDF」）|
| `Ctrl/Cmd + 滚轮` | 缩放界面 |
| `Ctrl/Cmd + Shift + I` | 开发者工具 |

---

## 五、和手机版的能力对照

| 能力 | 手机版（Android） | 电脑版（Electron） |
|---|---|---|
| 保存导出文件 | 写入「下载/送货单统计」 | 弹出「另存为」对话框 |
| 选择导入文件 | 系统文件选择器 | 系统文件选择器 |
| 打印 / 存 PDF | 系统打印服务 | 系统打印 / 另存为 PDF |
| 分享文件 | 分享到微信等 | 保存到「下载/送货单统计」并定位文件 |
| 商品图片 | 相册 / 拍照 | 选择本地图片，复制到本地目录保存 |

---

## 六、商品图片

- 商品管理的新增 / 编辑表单里可以为商品上传一张封面图片，图片会复制到**本地文件夹**，
  全程不发起任何网络请求。
- 默认目录为程序所在目录（打包后是 exe 同级，开发时是 `electron/`）下的 `CommercesData` 文件夹。
- 可在「设置 → 商品图片 → 图片存储位置」里**更改文件夹**、**打开文件夹**或**恢复默认**。
- 图片以本地文件路径记录在商品资料中，通过应用内的 `sdimg://` 协议读取显示；
  数据仍保存在本机，不上传。

---

## 七、3D 工作台背景

- 首页可铺一层等距微缩「送货沙盘」：货架、月台、货车、叉车、门店、数据展台，
  随真实单据实时变化（单据数→箱堆/货车，金额→货架填充，销量前三→展台高度，客户数→门店）。
- **默认关闭**：打开应用就是原来那个干净的界面，不影响日常开单、记账、打印；
  需要演示时到「设置 → 基础资料 → 3D 工作台背景」里打开。
- 打开后默认是**柔化**档：加一层纸色白纱并自动降档，文字始终清晰；
  需要完整画面可在下面把「背景强度」切成「全开」。
- 场景直接挂在主页面（`3d/scene.js`），**没有 iframe、不走网络**，纯本地渲染。
- 自动省电：窗口 <900px 不渲染；按窗口宽度自动调档（精简/标准/高）；
  帧率过低会逐级降档；场景不可用（无 WebGL、脚本加载失败）时自动回退静态背景图。
- 当前帧率与画质档位在「设置 → 3D 工作台背景」那一行里实时显示（页面上不再有常驻角标）。
- 设计与实现说明见 [`docs/3d-background/`](docs/3d-background/scene-spec.md)。

---

## 八、数据在哪、如何备份

- 桌面版业务数据保存在系统的用户数据目录（Electron `userData`）里的 localStorage。
- 商品图片保存在本地的 `CommercesData` 文件夹（默认），可随程序目录一起备份。
- 备份/恢复仍然用设置页的「导出备份 / 恢复备份」（JSON 文件），跨手机、跨电脑通用。
- 迁移：在 A 电脑「导出备份」，把 JSON 拷到 B 电脑「恢复备份」即可。

---

## 常见问题

**Q：`npm install` 卡住 / 下载 Electron 失败？**
设置上面的 `ELECTRON_MIRROR` 镜像后重试。

**Q：启动报 `Cannot find module 'electron'`？**
说明依赖没装成功，回到 `electron/` 目录重新 `npm install`。

**Q：窗口打不开、白屏？**
确认 `../android/app/src/main/assets/app/index.html` 存在（前端资源没被挪走）。
打包后则确认安装包里带了 `webapp` 资源。
