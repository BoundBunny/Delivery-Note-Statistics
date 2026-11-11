/* ============================================================
 * main.js — 送货单统计 电脑版（Electron 主进程）
 * ------------------------------------------------------------
 * 加载本项目 webapp 内的业务资源（index.html + js/css），
 * 在主进程里提供 saveFile / pickFile / printPdf / shareFile 等原生能力，
 * 并通过 preload 暴露成 window.Android；另提供商品图片的本地存储能力
 * （选择图片复制到本地目录、通过 sdimg:// 协议显示，全程离线无网络请求）。
 * ============================================================ */
'use strict';

/* stdout 被关闭（终端退出 / 管道提前关闭）时写日志会抛 EPIPE，
 * 未捕获异常会让 Electron 弹一个"主进程 JavaScript 错误"框，影响使用。
 * 这里只吞掉管道类错误，其余错误仍然报错退出。 */
process.on('uncaughtException', (err) => {
  const code = err && err.code;
  if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED' || code === 'ERR_STREAM_WRITE_AFTER_END') {
    try { process.exit(0); } catch (_) {}
    return;
  }
  try { console.error(err); } catch (_) {}
  try { process.exit(1); } catch (_) {}
});

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeImage, protocol, screen, Tray } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { createDataStore } = require('./lib/data-store.js');

// 开发与 app.asar 内使用相同目录关系；保留业务存储键和 Electron 应用名。
const WEB_ROOT = path.join(__dirname, 'webapp');
const INDEX_HTML = path.join(WEB_ROOT, 'index.html');
// 应用图标（窗口/任务栏）：512px 品牌图随 webapp 一起打包。
const APP_ICON = path.join(WEB_ROOT, 'assets', 'brand', 'dns-icon-512.png');

/* ---------- 商品图片：本地存储目录 + 自定义协议 ----------
 * 图片以文件形式保存在本地（默认在应用所在目录的 CommercesData 文件夹），
 * 全程不发起任何网络请求。渲染进程通过 sdimg:// 协议读取本地图片。
 */
// 图片缩略图缓存（GPU/内存渲染压力优化）：
// 商品卡片只需 ~150px 显示，原图动辄 800~1024px，同时解码几十上百张会把
// 合成器拖垮导致拖窗口卡顿。这里按需生成并缓存最大 320px 的缩略图。
const THUMB_MAX = 320;            // 缩略图最长边像素（覆盖 retina 卡片显示够用）
const thumbCache = new Map();     // key: absPath|mtime|size → Buffer（内存 LRU）
const THUMB_CACHE_MAX = 400;      // 最多缓存多少张缩略图，超出淘汰最旧
function thumbCacheKey(filePath, stat) { return filePath + '|' + stat.mtimeMs + '|' + stat.size; }
function evictThumbs() {
  while (thumbCache.size > THUMB_CACHE_MAX) {
    const firstKey = thumbCache.keys().next().value;
    thumbCache.delete(firstKey);
  }
}
// 生成缩略图；不支持/失败则返回原图 Buffer（保证功能不退化）
async function makeThumbnail(filePath, data, ext) {
  // SVG 矢量无需缩略
  if (ext === '.svg') return data;
  try {
    const img = nativeImage.createFromBuffer(data);
    if (img.isEmpty()) return data;
    const { width, height } = img.getSize();
    if (!width || !height || Math.max(width, height) <= THUMB_MAX) return data;
    const scaled = img.resize(width >= height
      ? { width: THUMB_MAX, height: Math.round(height * THUMB_MAX / width), quality: 'good' }
      : { height: THUMB_MAX, width: Math.round(width * THUMB_MAX / height), quality: 'good' });
    // nativeImage 只能导出 PNG / JPEG；PNG 保留透明，JPEG 体积更小
    const useJpeg = (ext === '.jpg' || ext === '.jpeg');
    const out = useJpeg ? scaled.toJPEG(82) : scaled.toPNG();
    return (out && out.length) ? out : data;
  } catch (_) { return data; }
}
// 读取图片并按需缩略 + 缓存：返回 { data, mime, cacheable }
async function readImageForDisplay(filePath) {
  const stat = await fsp.stat(filePath);
  const key = thumbCacheKey(filePath, stat);
  const ext = path.extname(filePath).toLowerCase();
  if (thumbCache.has(key)) {
    // LRU：命中后移到末尾
    const hit = thumbCache.get(key);
    thumbCache.delete(key); thumbCache.set(key, hit);
    return { data: hit.data, mime: hit.mime, cacheable: true };
  }
  const raw = await fsp.readFile(filePath);
  const thumb = await makeThumbnail(filePath, raw, ext);
  const didShrink = thumb !== raw;
  const mime = didShrink ? (/\.(jpe?g)$/i.test(filePath) ? 'image/jpeg' : 'image/png') : imageMime(filePath);
  const entry = { data: thumb, mime };
  thumbCache.set(key, entry); evictThumbs();
  return { data: thumb, mime, cacheable: true };
}
// 应用所在目录：打包后为 exe 所在目录，开发时为 electron/ 目录
function appBaseDir() {
  return app.isPackaged ? path.dirname(process.execPath) : __dirname;
}
// 默认商品图片目录：<应用目录>/CommercesData
function defaultImageDir() {
  if (process.env.DNS_TEST_IMAGE_DIR) return path.resolve(process.env.DNS_TEST_IMAGE_DIR);
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

/* 测试钩子：把 userData（localStorage/window-state/单实例锁）指向临时目录，避免污染真实数据 */
if (process.env.DNS_TEST_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.DNS_TEST_USER_DATA));
}

/* ---------- 业务数据存储：安装目录内的文件 + 目录外备份 ----------
 * 目标：
 *  1) 商品/客户/单据的改动写进「安装目录相对路径」下的普通文件（不再依赖浏览器缓存），
 *     老板重装程序、换电脑时数据跟着程序走。
 *  2) 每次写入同时在「安装目录之外」留一份备份（默认 %APPDATA%\送货单统计数据备份），
 *     误删整个程序目录再重新下载安装后，启动时自动从备份恢复。
 */
const DATA_DIR_NAME = '用户数据';
const BACKUP_DIR_NAME = '送货单统计数据备份';
let dataStore = null;

// 主数据目录：打包后位于 exe 同级的「用户数据」目录（安装目录相对路径）
// 若安装目录不可写（例如装到 Program Files 且没有管理员权限），自动改用
// %APPDATA%\送货单统计数据，保证数据一定能落盘，不会「改了价但没保存」。
const FALLBACK_DATA_DIR_NAME = '送货单统计数据';
let dataDirFallback = false;
function isWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-probe.tmp');
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    return true;
  } catch (_) { return false; }
}
function dataDir() {
  if (process.env.DNS_TEST_DATA_DIR) return path.resolve(process.env.DNS_TEST_DATA_DIR);
  // 冒烟自检：数据写到临时 profile，不污染打包目录
  if (SMOKE && process.env.DNS_SMOKE_USER_DATA) return path.join(path.resolve(process.env.DNS_SMOKE_USER_DATA), DATA_DIR_NAME);
  if (app.isPackaged) {
    const target = path.join(appBaseDir(), DATA_DIR_NAME);
    if (isWritableDir(target)) return target;
    dataDirFallback = true;
    return path.join(app.getPath('appData'), FALLBACK_DATA_DIR_NAME);
  }
  return path.join(app.getPath('userData'), DATA_DIR_NAME);
}
// 备份目录：刻意放在安装目录之外（也不放在 electron 自己的 userData 里，
// 避免卸载程序时「删除应用数据」把备份一起抹掉），删掉整个程序目录也留得住。
function backupDir() {
  if (process.env.DNS_TEST_BACKUP_DIR) return path.resolve(process.env.DNS_TEST_BACKUP_DIR);
  if (SMOKE && process.env.DNS_SMOKE_USER_DATA) return path.join(path.resolve(process.env.DNS_SMOKE_USER_DATA), BACKUP_DIR_NAME);
  return path.join(app.getPath('appData'), BACKUP_DIR_NAME);
}
// 早期版本把备份放在 userData 下；升级后如那边有数据，先搬过来
function legacyBackupDir() {
  return path.join(app.getPath('userData'), BACKUP_DIR_NAME);
}
function seedBackupFromLegacy() {
  try {
    const legacy = legacyBackupDir();
    const target = backupDir();
    if (!fs.existsSync(legacy) || path.resolve(legacy) === path.resolve(target)) return;
    const has = dir => { try { return fs.readdirSync(dir).some(n => n.endsWith('.json')); } catch (_) { return false; } };
    if (has(target) || !has(legacy)) return;
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(legacy)) {
      const src = path.join(legacy, name);
      const dst = path.join(target, name);
      try {
        if (fs.statSync(src).isDirectory()) fs.cpSync(src, dst, { recursive: true });
        else fs.copyFileSync(src, dst);
      } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }
}
function getDataStore() {
  if (!dataStore) {
    dataStore = createDataStore({
      dataDir: dataDir(),
      backupDir: backupDir(),
      imageDirs: imageDirsToBackup(),
    });
    dataStore.load();
  }
  return dataStore;
}
// 需要跟着数据一起备份的商品图片目录（默认目录 + 用户在设置里指定的目录）
function imageDirsToBackup() {
  const dirs = [defaultImageDir()];
  try {
    const raw = fs.existsSync(path.join(dataDir(), 'sd_v1_settings.json'))
      ? fs.readFileSync(path.join(dataDir(), 'sd_v1_settings.json'), 'utf8')
      : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.imageDir) dirs.push(path.resolve(parsed.imageDir));
    }
  } catch (_) { /* ignore */ }
  return dirs;
}
// 当前生效的商品图片目录（设置里可自定义）
function currentImageDir() {
  try {
    const raw = getDataStore().get('sd_v1_settings');
    const parsed = raw ? JSON.parse(raw) : null;
    return resolveImageDir(parsed && parsed.imageDir);
  } catch (_) {
    return defaultImageDir();
  }
}
// 把当前生效的图片目录同步给数据后端（用户改了目录后，备份才能带上新图）
function syncImageDirs() {
  try {
    const store = getDataStore();
    if (store.setImageDirs) store.setImageDirs([defaultImageDir(), currentImageDir()]);
  } catch (_) { /* ignore */ }
}

let mainWindow = null;
// 系统托盘图标（异步创建并缓存）：选择「最小化到系统托盘」时，关闭窗口只隐藏到托盘。
let tray = null;
let trayCreating = false;
// 真正退出（点「完全退出」/ 菜单退出 / 系统关机）时置为 true，避免关闭拦截再次弹窗
let isQuitting = false;

/* ---------- 应用偏好（关闭按钮行为） ----------
 * 与设置页一致，拆成两个独立项：
 *   closeAction: 'minimize' | 'quit' —— 关闭时默认做什么（默认 minimize）
 *   closePrompt: true | false        —— 关闭时是否先弹窗询问（默认 true）
 * 旧版本只存过一个 combined closeAction（''/'minimize'/'quit'），读取时做兼容。 */
function appPrefsFile() {
  return path.join(app.getPath('userData'), 'app-prefs.json');
}
function readAppPrefs() {
  try {
    const parsed = JSON.parse(fs.readFileSync(appPrefsFile(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) { return {}; }
}
function writeAppPrefs(prefs) {
  try {
    fs.mkdirSync(path.dirname(appPrefsFile()), { recursive: true });
    fs.writeFileSync(appPrefsFile(), JSON.stringify(prefs));
  } catch (_) { /* ignore */ }
}
function getClosePrefs() {
  const prefs = readAppPrefs();
  // 兼容旧字段：closeAction 曾用 '' 表示“每次询问”
  let action = prefs.closeAction;
  let prompt;
  if (action === 'minimize' || action === 'quit') {
    prompt = prefs.closePrompt == null ? true : !!prefs.closePrompt;
  } else {
    action = 'minimize';
    prompt = true; // '' / 未设置 → 默认每次询问
  }
  return { action, prompt };
}
function getCloseAction() {
  const prefs = getClosePrefs();
  return prefs.prompt ? '' : prefs.action; // '' = 每次询问
}
function setClosePrefs({ action, prompt }) {
  const prefs = readAppPrefs();
  if (action === 'minimize' || action === 'quit') prefs.closeAction = action;
  prefs.closePrompt = !!prompt;
  writeAppPrefs(prefs);
  return getClosePrefs();
}
function setCloseAction(action) {
  // 兼容旧调用：'minimize'/'quit' → 关闭提示并固定该行为；'' → 开启提示
  if (action === 'minimize' || action === 'quit') return setClosePrefs({ action, prompt: false });
  return setClosePrefs({ action: getClosePrefs().action, prompt: true });
}

/* ---------- 系统托盘 ----------
 * 「最小化到系统托盘」：关闭窗口时隐藏主窗口、只留托盘图标，点托盘图标或菜单可再唤回。
 * 托盘图标按需创建并缓存；退出程序走 before-quit，会顺带销毁托盘。 */
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function ensureTray() {
  if (tray || trayCreating) return;
  trayCreating = true;
  let image;
  try {
    image = nativeImage.createFromPath(APP_ICON);
    // 托盘图标用 16/32px 更清晰；512 原图交给系统缩放也可，但显式缩放更稳。
    if (!image.isEmpty()) image = image.resize({ width: 32, height: 32 });
  } catch (_) { image = undefined; }
  try {
    tray = new Tray(image);
  } catch (_) { tray = null; trayCreating = false; return; }
  tray.setToolTip('送货宝');
  const menu = Menu.buildFromTemplate([
    { label: '显示主界面', click: () => showMainWindow() },
    { type: 'separator' },
    { label: '退出程序', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  // 单击托盘图标：唤回窗口（Windows 习惯）
  tray.on('click', () => showMainWindow());
  trayCreating = false;
}
function destroyTray() {
  if (tray) { try { tray.destroy(); } catch (_) { /* ignore */ } tray = null; }
}
// 关闭时「最小化到系统托盘」：隐藏窗口 + 确保托盘存在
function minimizeToTray() {
  ensureTray();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // 托盘创建失败（极少数环境）时退回任务栏最小化，避免窗口隐藏后无处可寻
  if (!tray) { mainWindow.minimize(); return; }
  mainWindow.hide();
}

// 系统原生兜底（仅在渲染进程尚未就绪/已销毁时使用）：弹出选择，也可以记住选择
async function nativeAskCloseAction() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { response, checkboxChecked } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: '关闭送货宝',
    message: '要完全退出程序，还是最小化到系统托盘？',
    detail: '最小化后程序仍在系统托盘运行，点击托盘图标即可继续使用；完全退出会关闭程序（数据都已自动保存）。',
    buttons: ['最小化到系统托盘', '完全退出', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    checkboxLabel: '记住我的选择，以后不再询问',
    checkboxChecked: false,
  });
  if (response === 2) return; // 取消：什么都别做
  const action = response === 1 ? 'quit' : 'minimize';
  if (checkboxChecked) setCloseAction(action);
  if (action === 'quit') {
    isQuitting = true;
    app.quit();
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    minimizeToTray();
  }
}

// 老板点了右上角关闭：优先用站内样式的弹窗询问（与整体 UI 一致），渲染进程未就绪时退回原生对话框
let closePromptPending = false;
async function askCloseAction() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (closePromptPending) return; // 已有询问在进行，避免重复弹窗
  const wc = mainWindow.webContents;
  if (!wc || wc.isDestroyed() || wc.isLoading()) {
    return nativeAskCloseAction();
  }
  closePromptPending = true;
  let payload = null;
  try {
    payload = await new Promise(resolve => {
      let settled = false;
      const timer = setTimeout(() => finish(null), 120000);
      function finish(val) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ipcMain.removeListener('sd:closePromptResult', onResult);
        resolve(val);
      }
      function onResult(event, data) {
        if (event.sender !== wc) return;
        finish(data || {});
      }
      ipcMain.on('sd:closePromptResult', onResult);
      try { wc.send('sd:showClosePrompt'); } catch (_) { finish(null); }
    });
  } finally {
    closePromptPending = false;
  }
  if (!payload || payload.action === 'cancel') return; // 取消：什么都不做
  const action = payload.action === 'quit' ? 'quit' : 'minimize';
  if (payload.remember) setClosePrefs({ action, prompt: false }); // 记住 = 关闭提示并固定该行为
  if (action === 'quit') {
    isQuitting = true;
    app.quit();
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    minimizeToTray();
  }
}

/* ---------- 窗口状态记忆 ----------
 * 新位置：业务数据目录（安装目录相对路径）；旧位置（userData/window-state.json）保留读取回退。 */
function legacyStateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}
function stateFile() {
  return path.join(dataDir(), 'window-state.json');
}
function readStateFile(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (s && Number.isFinite(s.width) && Number.isFinite(s.height)) return s;
  } catch (_) { /* ignore */ }
  return null;
}
function loadWindowState() {
  return readStateFile(stateFile()) || readStateFile(legacyStateFile());
}
function saveWindowState(win) {
  try {
    if (!win || win.isMinimized() || win.isMaximized()) return;
    const b = win.getBounds();
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(b));
  } catch (_) { /* ignore */ }
}

/* ---------- 主窗口 ---------- */
function createWindow() {
  const saved = loadWindowState();
  const area = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: saved ? saved.width : Math.min(1440, area.width),
    height: saved ? saved.height : Math.min(960, area.height),
    x: saved ? saved.x : undefined,
    y: saved ? saved.y : undefined,
    minWidth: 1024,
    minHeight: 680,
    title: '送货宝',
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
  mainWindow.on('close', (event) => {
    if (mainWindow) saveWindowState(mainWindow);
    if (isQuitting || SMOKE) return;               // 真正退出 / 冒烟自检：直接放行
    event.preventDefault();                        // 先拦住，按老板的选择处理
    const prefs = getClosePrefs();
    if (prefs.prompt) { askCloseAction(); return; } // 开启“关闭时提示”→ 每次询问
    if (prefs.action === 'quit') { isQuitting = true; app.quit(); return; }
    if (mainWindow && !mainWindow.isDestroyed()) minimizeToTray();
  });
  // 点右上角「最小化」按钮时：若设置为最小化到系统托盘，也收进托盘而不是留在任务栏
  mainWindow.on('minimize', (event) => {
    if (isQuitting || SMOKE) return;
    const prefs = getClosePrefs();
    if (prefs.action === 'minimize' && !prefs.prompt) {
      event.preventDefault();
      minimizeToTray();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  const publishActivity = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sd:windowActivity',
      mainWindow.isVisible() && !mainWindow.isMinimized());
  };
  // Native visibility flags settle after the show/hide event callback returns.
  const scheduleActivity = () => setImmediate(publishActivity);
  for (const event of ['show', 'hide', 'minimize', 'restore']) mainWindow.on(event, scheduleActivity);
  mainWindow.webContents.on('did-finish-load', scheduleActivity);
  mainWindow.webContents.on('will-prevent-unload', event => {
    const choice=dialog.showMessageBoxSync(mainWindow,{type:'warning',title:'修改尚未保存',message:'当前修改尚未保存',detail:'关闭或重新加载会放弃当前修改。',buttons:['继续编辑','放弃修改并继续'],defaultId:0,cancelId:0,noLink:true});
    if(choice===1)event.preventDefault();
  });

  // 站内导航在应用内进行；外部链接交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });

  const win = mainWindow;
  win.loadFile(INDEX_HTML).then(() => {
    // A paused, lazily loaded WebGL canvas must not gate initial visibility.
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }).catch(error => console.error('页面加载失败', error));
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
        { label: '打印 / 预览单据', accelerator: 'CmdOrCtrl+P', click: () => {
          if (!mainWindow) return;
          const win = mainWindow;
          win.webContents.executeJavaScript('!!(window.DNSDesktop && window.DNSDesktop.ready && window.DNSDesktop.printCurrent())')
            .then(handled => { if (!handled && !win.isDestroyed()) win.webContents.print(); }).catch(() => {});
        } },
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
  mainWindow.webContents.executeJavaScript('window.DNSDesktop.navigate(' + JSON.stringify(hash) + ')').catch(() => {});
}

/* ---------- 业务数据存储桥（同步 IPC，保证 store.js 的同步语义） ----------
 * 渲染进程通过 preload 的 window.__DNSStorage 访问，接口与 localStorage 一致。
 * 写入立刻落到安装目录下的文件，并按需在目录外留备份。
 */
ipcMain.on('sd:storage:snapshot', (event) => {
  try {
    const store = getDataStore();
    event.returnValue = { ok: true, data: store.snapshot(), info: storageInfo() };
  } catch (err) {
    event.returnValue = { ok: false, error: String(err && err.message || err), data: {} };
  }
});
ipcMain.on('sd:storage:get', (event, key) => {
  try { event.returnValue = getDataStore().get(String(key)); } catch (_) { event.returnValue = null; }
});
ipcMain.on('sd:storage:set', (event, key, value) => {
  try {
    getDataStore().set(String(key), value);
    event.returnValue = { ok: true };
  } catch (err) {
    event.returnValue = { ok: false, error: String(err && err.message || err) };
  }
});
ipcMain.on('sd:storage:remove', (event, key) => {
  try { getDataStore().remove(String(key)); event.returnValue = { ok: true }; } catch (err) {
    event.returnValue = { ok: false, error: String(err && err.message || err) };
  }
});
ipcMain.on('sd:storage:migrate', (event, legacy) => {
  try {
    const result = getDataStore().migrateLegacy(legacy || {});
    event.returnValue = { ok: true, migrated: result.migrated || 0 };
  } catch (err) {
    event.returnValue = { ok: false, error: String(err && err.message || err), migrated: 0 };
  }
});
ipcMain.on('sd:storage:flush', (event) => {
  try { getDataStore().flushBackup(); event.returnValue = { ok: true }; } catch (_) { event.returnValue = { ok: false }; }
});

/* 设置页展示用：数据保存位置 + 备份位置 */
function storageInfo() {
  const store = getDataStore();
  return {
    dataDir: store.dataDir,
    backupDir: store.backupDir,
    keys: store.keys().length,
    restored: store.status.restored,
    restoredFrom: store.status.restoredFrom,
    migrated: store.status.migrated,
    backups: store.listBackups().map(name => path.basename(name)),
    backupError: store.status.backupError,
    fallback: dataDirFallback,
  };
}
ipcMain.handle('sd:getStorageInfo', async () => {
  try { return { ok: true, info: storageInfo() }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
// 在文件管理器里打开数据目录 / 备份目录
ipcMain.handle('sd:openDataDir', async (_e, which) => {
  try {
    const store = getDataStore();
    const target = which === 'backup' ? store.backupDir : store.dataDir;
    await fsp.mkdir(target, { recursive: true });
    const errMsg = await shell.openPath(target);
    return errMsg ? { ok: false, error: errMsg } : { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});
// 立即生成一次目录外备份（老板重装前的保险）
ipcMain.handle('sd:backupNow', async () => {
  try {
    const store = getDataStore();
    syncImageDirs();
    store.flushBackup();
    store.backupImages([defaultImageDir(), currentImageDir()]);
    return { ok: true, info: storageInfo() };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

/* ---------- 关闭按钮行为偏好 ---------- */
ipcMain.handle('sd:getClosePrefs', async () => {
  try { const p = getClosePrefs(); return { ok: true, action: p.action, prompt: p.prompt }; }
  catch (err) { return { ok: false, error: String(err && err.message || err), action: 'minimize', prompt: true }; }
});
ipcMain.handle('sd:setClosePrefs', async (_e, payload) => {
  try {
    const data = payload && typeof payload === 'object' ? payload : {};
    const p = setClosePrefs({ action: data.action, prompt: data.prompt });
    return { ok: true, action: p.action, prompt: p.prompt };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('sd:getCloseAction', async () => {
  try { return { ok: true, action: getCloseAction() }; }
  catch (err) { return { ok: false, error: String(err && err.message || err), action: '' }; }
});
ipcMain.handle('sd:setCloseAction', async (_e, action) => {
  try { return { ok: true, action: setCloseAction(String(action || '')) }; }
  catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});

/* ---------- 原生桥：saveFile ---------- */
function safeFileName(value, fallback='文件.bin') {
  const name=String(value||'').replace(/[\\/<>:"|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').trim();
  return name||fallback;
}
ipcMain.handle('sd:saveFile', async (_e, { fileName, mime, base64 }) => {
  try {
    fileName=safeFileName(fileName);
    const buf = Buffer.from(base64 || '', 'base64');
    if (process.env.DNS_TEST_SAVE_DIR) {
      const dir = path.resolve(process.env.DNS_TEST_SAVE_DIR);
      await fsp.mkdir(dir, { recursive: true });
      const target = path.join(dir, safeFileName(fileName));
      await fsp.writeFile(target, buf);
      return { ok: true, path: target };
    }
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
    let chosenPath = process.env.DNS_TEST_PICK_FILE || '';
    if (!chosenPath) {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: '选择文件', properties: ['openFile'], filters
      });
      if (canceled || !filePaths || !filePaths.length) return { ok: false, canceled: true };
      chosenPath = filePaths[0];
    }
    const buf = await fsp.readFile(chosenPath);
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
      if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        throw new Error('UTF-8 文件已损坏，请重新导出原始 CSV。');
      }
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
    fileName=safeFileName(fileName);
    const buf = Buffer.from(base64 || '', 'base64');
    const dir = process.env.DNS_TEST_SAVE_DIR
      ? path.resolve(process.env.DNS_TEST_SAVE_DIR)
      : path.join(app.getPath('downloads'), '送货宝');
    await fsp.mkdir(dir, { recursive: true });
    const target = path.join(dir, fileName || 'file');
    await fsp.writeFile(target, buf);
    if (!process.env.DNS_TEST_SAVE_DIR) shell.showItemInFolder(target);
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
    if (process.env.DNS_TEST_IMAGE_DIR) return path.resolve(process.env.DNS_TEST_IMAGE_DIR);
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '选择商品图片存储文件夹',
      properties: ['openDirectory', 'createDirectory']
    });
    if (canceled || !filePaths || !filePaths.length) return '';
    // 用户改了图片目录 → 后端备份范围跟着更新
    try { syncImageDirs(); } catch (_) { /* ignore */ }
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
    let src = process.env.DNS_TEST_PICK_IMAGE_SRC || '';
    if (!src) {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: '选择商品图片',
        properties: ['openFile'],
        filters: [
          { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      });
      if (canceled || !filePaths || !filePaths.length) return { ok: false, canceled: true };
      src = filePaths[0];
    }
    const ext = path.extname(src).toLowerCase();
    if(!IMAGE_EXTS.has(ext))return {ok:false,error:'请选择受支持的图片文件'};
    const destDir = resolveImageDir(dir);
    await fsp.mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, 'product_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext);
    await fsp.copyFile(src, destPath);
    // 新图片落到目录里后立刻纳入备份范围
    try { syncImageDirs(); getDataStore().backupImages([destDir]); } catch (_) { /* ignore */ }
    return { ok: true, path: destPath };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// sdimg://local/?p=<encoded absPath>  →  返回本地图片文件内容
// sdimg://bundle/?p=<encoded relative path under webapp/>  →  返回随应用打包的内置商品图片
function registerImageProtocol() {
  protocol.handle('sdimg', async request => {
    try {
      const url = new URL(request.url);
      const raw = url.searchParams.get('p') || '';
      if (url.hostname === 'bundle') {
        const rel = String(raw).replace(/\\/g, '/').replace(/^\/+/, '');
        const target = path.normalize(path.join(WEB_ROOT, rel));
        const root = path.normalize(WEB_ROOT) + path.sep;
        if (!target.startsWith(root) || !IMAGE_EXTS.has(path.extname(target).toLowerCase())) {
          return new Response('', { status: 403 });
        }
        const { data, mime, cacheable } = await readImageForDisplay(target);
        return new Response(data, { headers: { 'content-type': mime, 'cache-control': cacheable ? 'public, max-age=86400' : 'no-store' } });
      }
      const filePath = path.normalize(raw);
      if (!filePath || !path.isAbsolute(filePath) || !IMAGE_EXTS.has(path.extname(filePath).toLowerCase())) {
        return new Response('', { status: 403 });
      }
      const { data, mime, cacheable } = await readImageForDisplay(filePath);
      return new Response(data, { headers: { 'content-type': mime, 'cache-control': cacheable ? 'public, max-age=86400' : 'no-store' } });
    } catch (_) {
      return new Response('', { status: 404 });
    }
  });
}

/* ---------- 冒烟自检模式：electron . --smoke ---------- */
const SMOKE = process.argv.includes('--smoke');
if (SMOKE && process.env.DNS_SMOKE_USER_DATA) app.setPath('userData', path.resolve(process.env.DNS_SMOKE_USER_DATA));
// Cached localStorage records must have one writer per profile.
const ownsProfile = app.requestSingleInstanceLock();
if (!ownsProfile) app.quit();
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();mainWindow.focus();
});
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
          hasViews: typeof Views !== 'undefined' && !!Views.order && !!Views.stats,
          hasXlsx: typeof Xlsx !== 'undefined',
          hasStorageBridge: !!(window.__DNSStorage && typeof window.__DNSStorage.setItem === 'function'),
          storageRoundTrip: (function(){
            try {
              if (!window.__DNSStorage) return false;
              window.__DNSStorage.setItem('sd_smoke_probe', 'ok');
              const back = window.__DNSStorage.getItem('sd_smoke_probe');
              window.__DNSStorage.removeItem('sd_smoke_probe');
              return back === 'ok';
            } catch (e) { return 'ERR:' + (e && e.message || e); }
          })(),
          viewChildren: document.querySelectorAll('#view-container > *').length,
          desktopReady: !!(window.DNSDesktop && window.DNSDesktop.ready),
          desktopMetrics: document.querySelectorAll('#desktop-app .metric').length,
          desktopNav: document.querySelectorAll('#desktop-app .nav-item').length,
          tabbar: document.querySelectorAll('#tabbar .tab-item:not(.side-extra)').length
        };
      } catch (e) { return { error: String(e && e.message || e) }; }
    })()`);
    checks.push(['页面已加载', report && !report.error && report.title === '送货宝']);
    checks.push(['window.Android 桥已注入', report && report.hasApp === true]);
    checks.push(['商品图片桥已注入', report && report.hasImageBridge === true]);
    checks.push(['Store 数据层可用', report && report.hasStore === true]);
    checks.push(['Views 视图已注册', report && report.hasViews === true]);
    checks.push(['Xlsx 导出器可用', report && report.hasXlsx === true]);
    checks.push(['文件存储桥已注入', report && report.hasStorageBridge === true]);
    checks.push(['数据可写入安装目录', report && report.storageRoundTrip === true]);
    checks.push(['首页已渲染', report && (report.desktopReady ? report.desktopMetrics === 4 : report.viewChildren >= 1)]);
    checks.push(['桌面场景工作台已就绪', report && report.desktopReady === true]);
    checks.push(['导航已就绪', report && (report.desktopReady ? report.desktopNav === 6 : report.tabbar === 5)]);
    // 用一个真实导出验证 xlsx + 保存链路（不弹窗，只测生成）
    const gen = await win.webContents.executeJavaScript(`(function(){
      try { const b = Xlsx.build([{name:'t',title:'t',headers:['a'],rows:[[1]]}]); return b && b.length > 0; }
      catch(e){ return 'ERR:' + (e && e.message || e); }
    })()`);
    checks.push(['Excel 生成可用', gen === true]);
  } catch (err) {
    checks.push(['执行自检', false, String(err && err.message || err)]);
  }
  let allOk = checks.every(([, ok]) => !!ok);
  // Packaged Windows GUI applications may have no stdout. Persist diagnostics
  // before logging so the release smoke test has a reliable result to read.
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(path.join(app.getPath('userData'), 'smoke-report.json'), JSON.stringify({ allOk, checks }, null, 2));
  } catch (error) {
    allOk = false;
    checks.push(['写入自检结果', false, String(error && error.message || error)]);
  }
  for (const [name, ok, extra] of checks) {
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : ''));
    if (!ok) allOk = false;
  }
  console.log(allOk ? 'SMOKE_OK' : 'SMOKE_FAIL');
  app.exit(allOk ? 0 : 1);
}

/* ---------- 启动时的存储自愈 ---------- */
function initStorage() {
  try {
    seedBackupFromLegacy();               // 早期版本把备份放在 userData 下 → 搬到现在的新位置
    const store = getDataStore();          // 内部已做「安装目录为空则从目录外备份恢复」
    // 恢复商品图片：程序目录被删后重装，图片在目录外备份里
    try { store.restoreImages([defaultImageDir(), currentImageDir()]); }
    catch (_) { /* ignore */ }
    // 图片绝对路径失效（换了安装位置）时按文件名重新指向当前图片目录
    try { store.repairImagePaths([defaultImageDir(), currentImageDir()]); }
    catch (_) { /* ignore */ }
    // 备份范围纳入当前图片目录（商品图跟着数据一起留档）
    try { syncImageDirs(); } catch (_) { /* ignore */ }
    // 立刻把当前状态写一份目录外备份，作为首次运行的基线
    try { store.flushBackup(); } catch (_) { /* ignore */ }
    return store;
  } catch (_) { return null; }
}

/* ---------- 生命周期 ---------- */
app.whenReady().then(() => {
  if (!ownsProfile) return;
  // Windows 任务栏图标/分组使用应用自身标识，避免显示 Electron 默认图标
  if (process.platform === 'win32') app.setAppUserModelId('com.songhuodan.desktop');
  initStorage();
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

app.on('before-quit', () => {
  isQuitting = true; // 菜单「退出」/ 系统关机等：不再弹关闭选择
  // 退出前把最新数据刷进目录外备份，保证误删程序后还能恢复
  try { if (dataStore) dataStore.flushBackup(); } catch (_) { /* ignore */ }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
