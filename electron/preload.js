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

function notify(msg, isErr) {
  try { if (typeof window.toast === 'function') window.toast(msg, isErr); } catch (_) { /* ignore */ }
}

const AndroidBridge = {
  /* 保存文件：弹出系统保存对话框，写入用户选择的位置 */
  saveFile(fileName, mime, base64) {
    ipcRenderer.invoke('sd:saveFile', { fileName, mime, base64 })
      .then(res => {
        if (res && res.ok) notify('已保存到 ' + res.path);
        else if (res && res.error) notify('保存失败：' + res.error, true);
      })
      .catch(err => notify('保存失败：' + (err && err.message || err), true));
  },

  /* 选择文件并回传文本（回调机制与 Android 版一致：window.__fileCallbacks[cb]） */
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
    ipcRenderer.invoke('sd:printPdf', { jobName });
  },

  /* 分享文件：桌面保存到「下载/送货单统计」并在文件夹中定位 */
  shareFile(fileName, mime, base64) {
    ipcRenderer.invoke('sd:shareFile', { fileName, mime, base64 })
      .then(res => {
        if (res && res.ok) notify('已保存到 ' + res.path);
        else if (res && res.error) notify('分享失败：' + res.error, true);
      })
      .catch(err => notify('分享失败：' + (err && err.message || err), true));
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

  /* 本地图片绝对路径 → 可在页面中直接使用的 sdimg:// 地址 */
  imageUrl(absPath) {
    if (!absPath) return '';
    return 'sdimg://local/?p=' + encodeURIComponent(String(absPath));
  },

  /* 退出应用 */
  exitApp() {
    window.close();
  }
};

/* 直接挂到 window（同一 world），前端 `window.Android` 检测即可命中 */
window.Android = AndroidBridge;
