/* ============================================================
 * main.js — 送货单统计 电脑版（Electron 主进程）
 * ------------------------------------------------------------
 * 直接复用 Android 版同一套前端资源（index.html + js/css），
 * 在主进程里提供 saveFile / pickFile / printPdf / shareFile 等原生能力，
 * 并通过 preload 暴露成 window.Android；另提供商品图片的本地存储能力
 * （选择图片复制到本地目录、通过 sdimg:// 协议显示，全程离线无网络请求）。
 * ============================================================ */
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeImage, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

// 开发时直接加载仓库里的 Android 前端资源；打包后从 resources/webapp 加载
const isDev = !app.isPackaged;
const WEB_ROOT = isDev
  ? path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'app')
  : path.join(process.resourcesPath, 'webapp');
const INDEX_HTML = path.join(WEB_ROOT, 'index.html');
// 应用图标（窗口/任务栏）：使用 512px 高清品牌图，打包后同样存在于 webapp/resources 内
const APP_ICON = path.join(WEB_ROOT, 'assets', 'brand', 'dns-icon-512.png');

/* ---------- 商品图片：本地存储目录 + 自定义协议 ----------
 * 图片以文件形式保存在本地（默认在应用所在目录的 CommercesData 文件夹），
 * 全程不发起任何网络请求。渲染进程通过 sdimg:// 协议读取本地图片。
 */
// 应用所在目录：打包后为 exe 所在目录，开发时为 electron/ 目录
function appBaseDir() {
  return app.isPackaged ? path.dirname(process.execPath) : __dirname;
}
// 默认商品图片目录：<应用目录>/CommercesData
function defaultImageDir() {
  return path.join(appBaseDir(), 'CommercesData');
}
// 用户在设置里填写的目录；为空则回落到默认目录
function resolveImageDir(dir) {
  const value = dir == null ? '' : String(dir).trim();
  return path.resolve(value || defaultImageDir());
}
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif']);
function imageMime(p) {
  const map = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif'
  };
  return map[path.extname(p).toLowerCase()] || 'application/octet-stream';
}
// 必须在 app ready 之前注册为特权协议，渲染进程才能把 sdimg:// 当作安全来源加载
protocol.registerSchemesAsPrivileged([
  { scheme: 'sdimg', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

let mainWindow = null;

/* ---------- 窗口状态记忆 ---------- */
function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}
function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (s && Number.isFinite(s.width) && Number.isFinite(s.height)) return s;
  } catch (_) { /* ignore */ }
  return null;
}
function saveWindowState(win) {
  try {
    if (!win || win.isMinimized() || win.isMaximized()) return;
    const b = win.getBounds();
    fs.writeFileSync(stateFile(), JSON.stringify(b));
  } catch (_) { /* ignore */ }
}

/* ---------- 主窗口 ---------- */
function createWindow() {
  const saved = loadWindowState();
  mainWindow = new BrowserWindow({
    width: saved ? saved.width : 1280,
    height: saved ? saved.height : 860,
    x: saved ? saved.x : undefined,
    y: saved ? saved.y : undefined,
    minWidth: 1024,
    minHeight: 680,
    title: '送货单统计',
    icon: APP_ICON,
    backgroundColor: '#F7F7FA',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 前端使用 window.__fileCallbacks 回调机制在「同一 window」上传回文件内容，
      // 因此关闭 contextIsolation；node 能力仍隔离（nodeIntegration=false），
      // 只通过 preload 暴露受控的 window.Android。纯本地离线应用，风险可控。
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', () => saveWindowState(mainWindow));
  mainWindow.on('closed', () => { mainWindow = null; });

  // 站内导航在应用内进行；外部链接交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });

  mainWindow.loadFile(INDEX_HTML);
}

/* ---------- 应用菜单（桌面快捷键） ---------- */
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [
        { label: '开新送货单', accelerator: 'CmdOrCtrl+N', click: () => goto('#/order/new') },
        { label: '单据列表', accelerator: 'CmdOrCtrl+L', click: () => goto('#/orders') },
        { type: 'separator' },
        { label: '打印当前页', accelerator: 'CmdOrCtrl+P', click: () => mainWindow && mainWindow.webContents.print() },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '数据完全本地存储，离线运行', enabled: false }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function goto(hash) {
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript('location.hash = ' + JSON.stringify(hash)).catch(() => {});
}

/* ---------- 原生桥：saveFile ---------- */
ipcMain.handle('sd:saveFile', async (_e, { fileName, mime, base64 }) => {
  try {
    const buf = Buffer.from(base64 || '', 'base64');
    const m = mime || 'application/octet-stream';
    const ext = path.extname(fileName || '').replace('.', '') || 'bin';
    const defaultDir = app.getPath('downloads');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '保存文件',
      defaultPath: path.join(defaultDir, fileName || ('文件.' + ext)),
      filters: [
        { name: ext.toUpperCase() + ' 文件', extensions: [ext] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    await fsp.writeFile(filePath, buf);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

/* ---------- 原生桥：pickFile（读取文本，回传给渲染进程） ---------- */
ipcMain.handle('sd:pickFile', async (_e, { accept }) => {
  const isCsv = /\.csv/.test(accept || '');
  const isJson = /\.json/.test(accept || '');
  const filters = isCsv
    ? [{ name: 'CSV 文件', extensions: ['csv', 'txt'] }, { name: '所有文件', extensions: ['*'] }]
    : isJson
      ? [{ name: 'JSON 文件', extensions: ['json'] }, { name: '所有文件', extensions: ['*'] }]
      : [{ name: '所有文件', extensions: ['*'] }];
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '选择文件', properties: ['openFile'], filters
    });
    if (canceled || !filePaths || !filePaths.length) return { ok: false, canceled: true };
    const buf = await fsp.readFile(filePaths[0]);
    const text = decodeImportText(buf);
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

/* 复刻前端 / Android 的严格编码解码：先识别二进制，再尝试 UTF-8 / GB18030 */
function decodeImportText(buf) {
  if (buf.length >= 2 && ((buf[0] === 0x50 && buf[1] === 0x4b) || (buf[0] === 0xd0 && buf[1] === 0xcf))) {
    throw new Error('请选择 CSV 或 JSON 文本文件；Excel 文件请先另存为 CSV。');
  }
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    throw new Error('请选择 CSV 或 JSON 文本文件；Excel 文件请先另存为 CSV。');
  }
  let text;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    text = new TextDecoder('utf-16le', { fatal: true }).decode(buf);
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    text = new TextDecoder('utf-16be', { fatal: true }).decode(buf);
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      text = new TextDecoder('gb18030', { fatal: true }).decode(buf); // 失败会抛错
    }
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/.test(text)) {
    throw new Error('文件包含乱码或二进制内容，请核对原始 CSV 文件。');
  }
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
}

/* ---------- 原生桥：printPdf（系统打印 / 另存为 PDF） ---------- */
ipcMain.handle('sd:printPdf', async (_e, { jobName }) => {
  return new Promise(resolve => {
    try {
      mainWindow.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
        resolve({ ok: success, error: success ? undefined : reason });
      });
    } catch (err) {
      resolve({ ok: false, error: String(err && err.message || err) });
    }
  });
});

/* ---------- 原生桥：shareFile（桌面：保存后定位到文件） ---------- */
ipcMain.handle('sd:shareFile', async (_e, { fileName, mime, base64 }) => {
  try {
    const buf = Buffer.from(base64 || '', 'base64');
    const dir = path.join(app.getPath('downloads'), '送货单统计');
    await fsp.mkdir(dir, { recursive: true });
    const target = path.join(dir, fileName || 'file');
    await fsp.writeFile(target, buf);
    shell.showItemInFolder(target);
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

/* ---------- 原生桥：商品图片（纯本地存储，无网络请求） ---------- */
// 返回默认图片目录（供设置页展示）
ipcMain.handle('sd:getDefaultImageDir', async () => defaultImageDir());

// 选择图片存储文件夹
ipcMain.handle('sd:chooseImageDir', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '选择商品图片存储文件夹',
      properties: ['openDirectory', 'createDirectory']
    });
    if (canceled || !filePaths || !filePaths.length) return '';
    return filePaths[0];
  } catch (_) {
    return '';
  }
});

// 在系统中打开图片目录
ipcMain.handle('sd:openImageDir', async (_e, dir) => {
  try {
    const target = resolveImageDir(dir);
    await fsp.mkdir(target, { recursive: true });
    const errMsg = await shell.openPath(target);
    return errMsg ? { ok: false, error: errMsg } : { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// 选择一张商品图片，复制到目标目录，返回本地绝对路径（无网络上传）
ipcMain.handle('sd:pickProductImage', async (_e, dir) => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '选择商品图片',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (canceled || !filePaths || !filePaths.length) return { ok: false, canceled: true };
    const src = filePaths[0];
    const ext = path.extname(src).toLowerCase() || '.png';
    const destDir = resolveImageDir(dir);
    await fsp.mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, 'product_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext);
    await fsp.copyFile(src, destPath);
    return { ok: true, path: destPath };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// sdimg://local/?p=<encoded absPath>  →  返回本地图片文件内容
function registerImageProtocol() {
  protocol.handle('sdimg', async request => {
    try {
      const url = new URL(request.url);
      const filePath = path.normalize(url.searchParams.get('p') || '');
      if (!filePath || !path.isAbsolute(filePath) || !IMAGE_EXTS.has(path.extname(filePath).toLowerCase())) {
        return new Response('', { status: 403 });
      }
      const data = await fsp.readFile(filePath);
      return new Response(data, { headers: { 'content-type': imageMime(filePath), 'cache-control': 'no-store' } });
    } catch (_) {
      return new Response('', { status: 404 });
    }
  });
}

/* ---------- 冒烟自检模式：electron . --smoke ---------- */
const SMOKE = process.argv.includes('--smoke');
async function runSmokeTest(win) {
  const checks = [];
  try {
    const report = await win.webContents.executeJavaScript(`(function(){
      try {
        return {
          title: document.title,
          hasApp: !!window.Android,
          hasImageBridge: !!(window.Android && window.Android.pickProductImage && window.Android.imageUrl),
          hasStore: typeof Store !== 'undefined' && typeof Store.countAll === 'function',
          hasViews: typeof Views !== 'undefined' && !!Views.home,
          hasXlsx: typeof Xlsx !== 'undefined',
          viewChildren: document.querySelectorAll('#view-container > *').length,
          tabbar: document.querySelectorAll('#tabbar .tab-item:not(.side-extra)').length
        };
      } catch (e) { return { error: String(e && e.message || e) }; }
    })()`);
    checks.push(['页面已加载', report && !report.error && report.title === '送货单统计']);
    checks.push(['window.Android 桥已注入', report && report.hasApp === true]);
    checks.push(['商品图片桥已注入', report && report.hasImageBridge === true]);
    checks.push(['Store 数据层可用', report && report.hasStore === true]);
    checks.push(['Views 视图已注册', report && report.hasViews === true]);
    checks.push(['Xlsx 导出器可用', report && report.hasXlsx === true]);
    checks.push(['首页已渲染', report && report.viewChildren >= 1]);
    checks.push(['底部导航 5 项', report && report.tabbar === 5]);
    // 用一个真实导出验证 xlsx + 保存链路（不弹窗，只测生成）
    const gen = await win.webContents.executeJavaScript(`(function(){
      try { const b = Xlsx.build([{name:'t',title:'t',headers:['a'],rows:[[1]]}]); return b && b.length > 0; }
      catch(e){ return 'ERR:' + (e && e.message || e); }
    })()`);
    checks.push(['Excel 生成可用', gen === true]);
  } catch (err) {
    checks.push(['执行自检', false, String(err && err.message || err)]);
  }
  let allOk = true;
  for (const [name, ok, extra] of checks) {
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : ''));
    if (!ok) allOk = false;
  }
  console.log(allOk ? 'SMOKE_OK' : 'SMOKE_FAIL');
  app.exit(allOk ? 0 : 1);
}

/* ---------- 生命周期 ---------- */
app.whenReady().then(() => {
  // Windows 任务栏图标/分组使用应用自身标识，避免显示 Electron 默认图标
  if (process.platform === 'win32') app.setAppUserModelId('com.songhuodan.desktop');
  registerImageProtocol();
  buildMenu();
  createWindow();
  if (SMOKE) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => runSmokeTest(mainWindow), 1200);
    });
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
