/* ============================================================
 * preload.js — 桥接层
 * ------------------------------------------------------------
 * 前端代码通过 window.Android.* 调用原生能力（与 Android 版一致）。
 * 这里注入一个同签名的 window.Android，内部转成 IPC。
 * 因此 index.html / store.js / util.js / views/*.js 全部无需修改。
 *
 * 注：contextIsolation 关闭（见 main.js），preload 与页面同一 window，
 * 可直接访问页面里的 window.__fileCallbacks（文件回传回调）与 toast。
 * ============================================================ */
'use strict';

const { ipcRenderer } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

window.__dnsWindowActive = true;
window.__DNS_DEV = typeof process !== 'undefined' && Array.isArray(process.argv) && process.argv.includes('--dns-dev');
ipcRenderer.on('sd:windowActivity', (_event, active) => {
  window.__dnsWindowActive = !!active;
  window.dispatchEvent(new Event('dns-window-activity'));
});

/* 关闭确认：主进程拦截右上角关闭后，请渲染进程用站内样式弹窗来询问，
 * 用户选择通过 sd:closePromptResult 回传，避免系统原生对话框的观感割裂。 */
ipcRenderer.on('sd:showClosePrompt', () => {
  window.dispatchEvent(new Event('dns-close-prompt'));
});
window.__dnsRespondClosePrompt = (result) => {
  try { ipcRenderer.send('sd:closePromptResult', result || {}); } catch (_) { /* ignore */ }
};

function notify(msg, isErr) {
  try { if (typeof window.toast === 'function') window.toast(msg, isErr); } catch (_) { /* ignore */ }
}

const AndroidBridge = {
  isDesktop: true,
  desktopAssetsUrl: pathToFileURL(path.join(__dirname, 'renderer') + path.sep).href,
  /* 保存文件：弹出系统保存对话框，写入用户选择的位置 */
  saveFile(fileName, mime, base64) {
    return ipcRenderer.invoke('sd:saveFile', { fileName, mime, base64 })
      .then(res => {
        if (res && res.ok) notify('已保存到 ' + res.path);
        else if (res && res.error) notify('保存失败：' + res.error, true);
        return res;
      })
      .catch(err => { notify('保存失败：' + (err && err.message || err), true);return {ok:false,error:String(err && err.message || err)}; });
  },

  exportBackup(json, fileName) {
    return ipcRenderer.invoke('sd:exportBackup', { json, fileName })
      .then(res => { if (res?.ok) notify('已保存到 ' + res.path); return res; })
      .catch(error => ({ ok: false, error: String(error.message || error) }));
  },
  pickBackup() {
    return ipcRenderer.invoke('sd:pickBackup').catch(error => ({ ok: false, error: String(error.message || error) }));
  },
  finishBackupImport(token, keep) {
    return ipcRenderer.invoke('sd:finishBackupImport', { token, keep }).catch(error => ({ ok: false, error: String(error.message || error) }));
  },

  /* 选择文件并回传文本（回调机制与 Android 版一致：window.__fileCallbacks[cb]） */
  pickDataFile() {
    return ipcRenderer.invoke('sd:pickDataFile').catch(error => ({ ok: false, error: String(error.message || error) }));
  },
  pickFile(callbackId, accept) {
    ipcRenderer.invoke('sd:pickFile', { accept: accept || '*/*' })
      .then(res => {
        const cbs = window.__fileCallbacks || {};
        const cb = cbs[callbackId];
        try {
          if (res && res.ok) { if (cb) cb(null, res.text); }
          else if (res && res.canceled) { if (cb) cb('canceled', null); }
          else { if (cb) cb((res && res.error) || 'read_error', null); }
        } finally {
          if (cb) delete cbs[callbackId];
        }
      })
      .catch(err => {
        const cbs = window.__fileCallbacks || {};
        const cb = cbs[callbackId];
        if (cb) { cb(String(err && err.message || err), null); delete cbs[callbackId]; }
      });
  },

  /* 系统打印 / 另存为 PDF */
  printPdf(jobName) {
    return ipcRenderer.invoke('sd:printPdf', { jobName }).then(res => {
      if (res && !res.ok && res.error && !/cancel/i.test(res.error)) notify('打印失败：' + res.error, true);
      return res;
    }).catch(err => { notify('打印失败：' + (err && err.message || err), true);return {ok:false,error:String(err && err.message || err)}; });
  },

  /* 分享文件：桌面保存到「下载/送货宝」并在文件夹中定位 */
  shareFile(fileName, mime, base64) {
    return ipcRenderer.invoke('sd:shareFile', { fileName, mime, base64 })
      .then(res => {
        if (res && res.ok) notify('已保存到 ' + res.path);
        else if (res && res.error) notify('分享失败：' + res.error, true);
        return res;
      })
      .catch(err => {notify('分享失败：' + (err && err.message || err), true);return {ok:false,error:String(err && err.message || err)};});
  },

  /* 触感反馈：桌面无触感，空实现以兼容 */
  tapFeedback() { /* no-op */ },

  /* ---------- 商品图片（本地存储，无网络请求） ---------- */
  /* 默认图片目录（应用目录下的 CommercesData） */
  getDefaultImageDir() {
    return ipcRenderer.invoke('sd:getDefaultImageDir')
      .catch(err => Promise.reject(err && err.message || err));
  },

  /* 选择图片存储文件夹；取消返回空字符串 */
  chooseImageDir() {
    return ipcRenderer.invoke('sd:chooseImageDir')
      .catch(err => Promise.reject(err && err.message || err));
  },

  /* 在系统中打开图片目录 */
  openImageDir(dir) {
    return ipcRenderer.invoke('sd:openImageDir', dir)
      .then(res => {
        if (res && res.ok === false && res.error) notify('打开文件夹失败：' + res.error, true);
        return res;
      })
      .catch(err => { notify('打开文件夹失败：' + (err && err.message || err), true); return { ok: false }; });
  },

  /* 选择一张商品图片并复制到本地目录，返回 { ok, path } */
  pickProductImage(destDir) {
    return ipcRenderer.invoke('sd:pickProductImage', destDir)
      .catch(err => ({ ok: false, error: String(err && err.message || err) }));
  },

  /* 本地图片绝对路径 → 可在页面中直接使用的 sdimg:// 地址
   * bundle:assets/products/xxx.jpg 表示随应用打包的内置商品图片 */
  imageUrl(absPath) {
    if (!absPath) return '';
    const s = String(absPath);
    if (s.startsWith('bundle:')) {
      return 'sdimg://bundle/?p=' + encodeURIComponent(s.slice(7));
    }
    return 'sdimg://local/?p=' + encodeURIComponent(s);
  },

  /* 退出应用 */
  exitApp() {
    window.close();
  },

  /* 数据保存位置信息（桌面端） */
  getStorageInfo() {
    return ipcRenderer.invoke('sd:getStorageInfo')
      .catch(err => ({ ok: false, error: String(err && err.message || err) }));
  },

  /* 打开数据目录 / 备份目录 */
  openDataDir(which) {
    return ipcRenderer.invoke('sd:openDataDir', which)
      .catch(err => ({ ok: false, error: String(err && err.message || err) }));
  },

  /* 立即生成一次目录外备份 */
  backupNow() {
    return ipcRenderer.invoke('sd:backupNow')
      .catch(err => ({ ok: false, error: String(err && err.message || err) }));
  },

  /* 右上角关闭按钮的行为：{ action:'minimize'|'quit', prompt:bool } */
  getClosePrefs() {
    return ipcRenderer.invoke('sd:getClosePrefs')
      .catch(err => ({ ok: false, error: String(err && err.message || err), action: 'minimize', prompt: true }));
  },
  setClosePrefs(prefs) {
    return ipcRenderer.invoke('sd:setClosePrefs', prefs)
      .catch(err => ({ ok: false, error: String(err && err.message || err) }));
  },
  getCloseAction() {
    return ipcRenderer.invoke('sd:getCloseAction')
      .catch(err => ({ ok: false, error: String(err && err.message || err), action: '' }));
  },
  setCloseAction(action) {
    return ipcRenderer.invoke('sd:setCloseAction', action)
      .catch(err => ({ ok: false, error: String(err && err.message || err) }));
  },
};

/* ============================================================
 * 业务数据存储桥（同步）
 * ------------------------------------------------------------
 * 桌面端业务数据不再放在浏览器 localStorage（leveldb，位于 %APPDATA%），
 * 而是落到「程序安装目录相对路径」下的普通文件里：
 *   <程序目录>/用户数据/sd_v1_xxx.json
 * 同时在「程序目录之外」留一份备份，程序被误删/损坏后重装可自动恢复。
 *
 * 这里注入 window.__DNSStorage，接口与 localStorage 完全一致（同步），
 * webapp/js/store.js 通过 `window.__DNSStorage || window.localStorage` 取用。
 * ============================================================ */
const storageCache = new Map();

function storageRequest(channel, ...args) {
  try { return ipcRenderer.sendSync(channel, ...args); }
  catch (_) { return null; }
}

/* 旧版本（localStorage 时代）的数据搬迁在页面上下文里做（见 webapp/js/store.js）：
 * preload 阶段拿不到稳定的 window.localStorage，搬运会不可靠。
 * 这里只负责把文件后端的当前快照读出来放进本地缓存。 */
function storageInit() {
  const res = storageRequest('sd:storage:snapshot');
  if (!res || !res.ok) return null;
  const data = res.data || {};
  Object.keys(data).forEach(key => storageCache.set(key, data[key]));
  const info = res.info || {};
  window.__DNSStorageInfo = info;
  return info;
}

const DNSStorage = {
  getItem(key) {
    const name = String(key);
    if (storageCache.has(name)) return storageCache.get(name);
    const value = storageRequest('sd:storage:get', name);
    if (value == null) return null;
    storageCache.set(name, value);
    return value;
  },
  setItem(key, value) {
    const name = String(key);
    const text = value == null ? null : String(value);
    const res = storageRequest('sd:storage:set', name, text);
    if (!res || res.ok !== true) {
      const err = new Error((res && res.error) || '数据保存失败');
      err.code = 'SD_STORAGE_WRITE_FAILED';
      throw err;
    }
    if (text == null) storageCache.delete(name); else storageCache.set(name, text);
    return name;
  },
  removeItem(key) {
    const name = String(key);
    const res = storageRequest('sd:storage:remove', name);
    if (!res || res.ok !== true) {
      const err = new Error((res && res.error) || '数据删除失败');
      err.code = 'SD_STORAGE_WRITE_FAILED';
      throw err;
    }
    storageCache.delete(name);
  },
  key(index) {
    const keys = Array.from(storageCache.keys());
    const i = Number(index);
    return (i >= 0 && i < keys.length) ? keys[i] : null;
  },
  get length() { return storageCache.size; },
  clear() {
    Array.from(storageCache.keys()).forEach(key => DNSStorage.removeItem(key));
  },
};

window.__DNSStorage = DNSStorage;
storageInit();

/* 直接挂到 window（同一 world），前端 `window.Android` 检测即可命中 */
window.Android = AndroidBridge;
