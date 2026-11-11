/* ============================================================
 * lib/data-store.js — 桌面端业务数据文件后端
 * ------------------------------------------------------------
 * 目标：
 *  1) 业务数据（设置/客户/商品/单据/一客一价/单号序号）落盘为安装目录
 *     相对路径下的普通文件，而不是浏览器 localStorage（leveldb）。
 *  2) 每次写入同步复制一份到「安装目录之外」的备份目录；程序目录被误删、
 *     损坏或主文件缺失时，启动时自动从备份恢复。
 *  3) 单个键一个文件（写入量小、原子改名、互不影响），语义与 localStorage 一致。
 *
 * 纯 Node 模块（不依赖 electron），便于用 node --test 单独测试。
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_FILE = 'data.json';
const BACKUP_LATEST = 'data-latest.json';
const BACKUP_PREFIX = 'data-';
const BACKUP_KEEP = 10;
const BACKUP_DELAY = 1200;
// 窗口状态文件放在数据目录里，但它不是业务数据，不能被当成数据键
const WINDOW_STATE_FILE = 'window-state.json';
// 业务数据键前缀（设置/客户/商品/单据/一客一价/序号）。
// 判断「安装目录是否为空」只看这些键：界面偏好等非业务文件不该影响恢复判断。
const BUSINESS_PREFIX = 'sd_v1_';
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif']);

function pad(n) { return String(n).padStart(2, '0'); }
function stamp(date) {
  const d = date || new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function isImage(file) { return IMAGE_EXT.has(path.extname(file).toLowerCase()); }
function fileFor(dir, key) { return path.join(dir, encodeURIComponent(String(key)) + '.json'); }
function keyOf(file) {
  try { return decodeURIComponent(path.basename(file, '.json')); } catch (_) { return path.basename(file, '.json'); }
}

function createDataStore(options) {
  const opts = options || {};
  const dataDir = path.resolve(opts.dataDir);
  const backupDir = path.resolve(opts.backupDir);
  // 商品图片目录（跟着数据一起备份，否则删掉程序目录后商品图就没了）
  let imageDirs = (opts.imageDirs || []).map(dir => path.resolve(dir));
  // 运行期用户可能改了图片目录，这里可以随时更新
  function setImageDirs(dirs) {
    imageDirs = (dirs || []).filter(Boolean).map(dir => path.resolve(dir));
    return imageDirs;
  }
  const file = path.join(dataDir, DATA_FILE);
  const backupLatest = path.join(backupDir, BACKUP_LATEST);
  const backupImageDir = path.join(backupDir, '图片');

  // 内存态：key -> 原始字符串（与 localStorage 的值语义一致）
  const state = Object.create(null);
  let lastError = null;
  let lastDated = '';
  let backupTimer = null;
  let backupDirty = false;
  const status = {
    dir: dataDir,
    backupDir,
    file,
    restored: false,
    restoredFrom: '',
    corrupt: '',
    migrated: 0,
    backupError: '',
  };

  function ensureDir(dir) {
    try { fs.mkdirSync(dir, { recursive: true }); return true; } catch (_) { return false; }
  }
  function readText(filePath) {
    try { return fs.readFileSync(filePath, 'utf8'); } catch (_) { return null; }
  }
  function readJson(filePath) {
    const text = readText(filePath);
    if (text == null) return null;
    try { return JSON.parse(text); } catch (_) { return undefined; } // undefined = 损坏
  }
  function writeAtomic(target, content) {
    const dir = path.dirname(target);
    if (!ensureDir(dir)) throw new Error('无法创建目录：' + dir);
    const tmp = path.join(dir, '.' + path.basename(target) + '.tmp');
    fs.writeFileSync(tmp, content, 'utf8');
    try {
      fs.renameSync(tmp, target);
    } catch (_) {
      try { fs.rmSync(target, { force: true }); } catch (__) { /* ignore */ }
      fs.renameSync(tmp, target);
    }
  }
  // 只认「单键文件」：排除聚合快照 data.json / data-latest.json / data-YYYYMMDD-HHMMSS.json
  // 以及窗口状态等非数据文件（否则它们会被当成数据键，甚至让「安装目录为空」的判断失真）
  function listKeyFiles(dir) {
    try {
      return fs.readdirSync(dir)
        .filter(name => name.endsWith('.json') && !name.startsWith('.'))
        .filter(name => name !== DATA_FILE && name !== BACKUP_LATEST)
        .filter(name => name !== WINDOW_STATE_FILE)
        .filter(name => !(name.startsWith(BACKUP_PREFIX) && /^\d{8}-\d{6}\.json$/.test(name)))
        .map(name => path.join(dir, name));
    } catch (_) { return []; }
  }
  function serialize() {
    return JSON.stringify({
      app: 'songhuodan',
      version: 1,
      updatedAt: new Date().toISOString(),
      data: state,
    }, null, 2);
  }

  /* ---------- 备份（安装目录之外） ---------- */
  function writeBackupMirror() {
    if (!ensureDir(backupDir)) { status.backupError = '无法创建备份目录：' + backupDir; return false; }
    try {
      // 单键文件逐个镜像（安装目录被删后仍可逐键恢复）
      Object.keys(state).forEach(key => {
        const src = fileFor(dataDir, key);
        if (!fs.existsSync(src)) return;
        fs.copyFileSync(src, fileFor(backupDir, key));
      });
      fs.writeFileSync(backupLatest, serialize(), 'utf8');
      // 商品图片一并备份（只补新增/变化的文件，不重复拷贝）
      if (imageDirs.length) backupImages(imageDirs);
      status.backupError = '';
    } catch (err) {
      status.backupError = String(err && err.message || err);
      return false;
    }
    const today = stamp().slice(0, 8);
    if (lastDated.slice(0, 8) !== today) {
      const dated = path.join(backupDir, BACKUP_PREFIX + stamp() + '.json');
      try {
        if (!fs.existsSync(dated)) fs.writeFileSync(dated, serialize(), 'utf8');
        lastDated = dated;
      } catch (_) { /* ignore */ }
      rotateBackups();
    }
    return true;
  }
  function rotateBackups() {
    try {
      const files = fs.readdirSync(backupDir)
        .filter(name => name.startsWith(BACKUP_PREFIX) && name.endsWith('.json'))
        .sort();
      while (files.length > BACKUP_KEEP) {
        const victim = files.shift();
        try { fs.rmSync(path.join(backupDir, victim), { force: true }); } catch (_) { /* ignore */ }
      }
    } catch (_) { /* ignore */ }
  }
  function listBackups() {
    try {
      return fs.readdirSync(backupDir)
        .filter(name => name.startsWith(BACKUP_PREFIX) && name.endsWith('.json'))
        .map(name => path.join(backupDir, name))
        .sort();
    } catch (_) { return []; }
  }
  // 备份写入合并到一次（避免每次按键都复制一遍目录）
  function scheduleBackup() {
    backupDirty = true;
    if (backupTimer) return;
    backupTimer = setTimeout(() => { backupTimer = null; flushBackup(); }, BACKUP_DELAY);
    if (backupTimer && typeof backupTimer.unref === 'function') backupTimer.unref();
  }
  function flushBackup() {
    if (backupTimer) { clearTimeout(backupTimer); backupTimer = null; }
    if (!backupDirty) return true;
    backupDirty = false;
    return writeBackupMirror();
  }

  /* ---------- 启动加载 / 恢复 ----------
   * 恢复规则（很重要）：
   *  - 安装目录里一个键文件都没有 → 说明程序目录被删了/换了新目录，
   *    这时才从「程序目录之外」的备份整体恢复。
   *  - 只要安装目录里还剩任意键文件，就不按键从备份补，
   *    否则用户在应用里「清空全部数据」后重启，数据会从备份里复活。
   */
  function load() {
    ensureDir(dataDir);
    ensureDir(backupDir);
    const mainFiles = listKeyFiles(dataDir);
    // 1) 读取安装目录里的数据文件
    mainFiles.forEach(filePath => {
      const key = keyOf(filePath);
      const text = readText(filePath);
      if (text == null) return;
      state[key] = text;
    });
    // 「安装目录为空」只看业务数据键：界面偏好等非业务文件不该影响恢复判断
    const businessKeys = Object.keys(state).filter(key => key.indexOf(BUSINESS_PREFIX) === 0);
    const mainEmpty = businessKeys.length === 0;
    // 2) 安装目录为空 → 从安装目录之外的备份逐键恢复
    if (mainEmpty) {
      listKeyFiles(backupDir).forEach(filePath => {
        const key = keyOf(filePath);
        const text = readText(filePath);
        if (text == null) return;
        state[key] = text;
        status.restored = true;
        status.restoredFrom = backupDir;
        try { writeAtomic(fileFor(dataDir, key), text); } catch (_) { /* ignore */ }
      });
    }
    // 3) 整体快照备份（聚合文件）也可用于恢复
    const snapshot = readJson(backupLatest);
    if (snapshot && snapshot.data && typeof snapshot.data === 'object') {
      Object.keys(snapshot.data).forEach(key => {
        if (key in state) return;
        if (!mainEmpty) return;              // 安装目录仍有数据 → 不复活被用户清掉的键
        const value = snapshot.data[key];
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        state[key] = text;
        status.restored = true;
        status.restoredFrom = BACKUP_LATEST;
        try { writeAtomic(fileFor(dataDir, key), text); } catch (_) { /* ignore */ }
      });
    }
    // 4) 启动即把当前状态镜像到安装目录之外，避免备份长期落后
    try { writeBackupMirror(); } catch (_) { /* ignore */ }
    return status;
  }

  /* ---------- 读 / 写 ---------- */
  function get(key) {
    const value = state[key];
    return value == null ? null : value;
  }
  function set(key, value) {
    const next = value == null ? null : String(value);
    if (next === null) return remove(key);
    if (state[key] === next) return { ok: true, unchanged: true };
    const target = fileFor(dataDir, key);
    writeAtomic(target, next);            // 失败会抛错 → 上层回滚
    state[key] = next;
    scheduleBackup();
    return { ok: true };
  }
  function remove(key) {
    const target = fileFor(dataDir, key);
    try { fs.rmSync(target, { force: true }); } catch (_) { /* ignore */ }
    try { fs.rmSync(fileFor(backupDir, key), { force: true }); } catch (_) { /* ignore */ }
    if (key in state) delete state[key];
    scheduleBackup();
    return { ok: true };
  }
  function has(key) { return key in state; }
  function keys() { return Object.keys(state); }
  function isEmpty() { return Object.keys(state).length === 0; }
  function lastWriteError() { return lastError; }
  function snapshot() {
    const copy = Object.create(null);
    Object.keys(state).forEach(k => { copy[k] = state[k]; });
    return copy;
  }
  function importSnapshot(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('导入的数据格式不正确');
    Object.keys(state).forEach(k => {
      try { fs.rmSync(fileFor(dataDir, k), { force: true }); } catch (_) { /* ignore */ }
    });
    Object.keys(state).forEach(k => { delete state[k]; });
    Object.keys(payload).forEach(k => {
      const value = payload[k];
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      writeAtomic(fileFor(dataDir, k), text);
      state[k] = text;
    });
    flushBackup();
    return { ok: true };
  }

  /* ---------- 旧版 localStorage 迁移 ----------
   * 升级安装的老用户数据在浏览器 localStorage 里；这里把仍在的键搬到文件后端。 */
  function migrateLegacy(legacy) {
    if (!legacy || typeof legacy !== 'object') return { migrated: 0 };
    let count = 0;
    try {
      Object.keys(legacy).forEach(key => {
        const value = legacy[key];
        if (typeof value !== 'string') return;
        if (key in state) return;
        writeAtomic(fileFor(dataDir, key), value);
        state[key] = value;
        count++;
      });
    } catch (err) {
      lastError = String(err && err.message || err);
      return { migrated: count, error: lastError };
    }
    if (count) flushBackup();
    status.migrated = count;
    return { migrated: count };
  }

  /* ---------- 商品图片：跟着数据一起备份 / 恢复 ---------- */
  function listFiles(dir) {
    const out = [];
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
    entries.forEach(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push.apply(out, listFiles(full));
      else if (entry.isFile() && isImage(entry.name)) out.push(full);
    });
    return out;
  }
  function backupImages(imageDirs) {
    if (!ensureDir(backupImageDir)) return { ok: false, error: '无法创建备份目录' };
    let copied = 0;
    (imageDirs || []).forEach(dir => {
      if (!dir) return;
      listFiles(dir).forEach(src => {
        const target = path.join(backupImageDir, path.basename(src));
        try {
          const st = fs.statSync(src);
          if (fs.existsSync(target)) {
            const bt = fs.statSync(target);
            if (bt.size === st.size) return;
          }
          fs.copyFileSync(src, target);
          copied++;
        } catch (_) { /* ignore */ }
      });
    });
    return { ok: true, copied };
  }
  function restoreImages(imageDirs) {
    if (!ensureDir(backupImageDir)) return { ok: false, restored: 0 };
    let restored = 0;
    let files = [];
    try { files = fs.readdirSync(backupImageDir).filter(isImage); } catch (_) { files = []; }
    if (!files.length) return { ok: true, restored: 0 };
    (imageDirs || []).forEach(dir => {
      if (!dir) return;
      if (!ensureDir(dir)) return;
      files.forEach(name => {
        const target = path.join(dir, name);
        try {
          if (fs.existsSync(target)) return;
          fs.copyFileSync(path.join(backupImageDir, name), target);
          restored++;
        } catch (_) { /* ignore */ }
      });
    });
    return { ok: true, restored };
  }

  /* ---------- 商品图片路径修复 ----------
   * 老板把程序装到新目录后，商品里记录的旧绝对路径会失效；
   * 这里按文件名在新图片目录里找回来并改写。 */
  function repairImagePaths(imageDirs) {
    const raw = state['sd_v1_products'];
    if (!raw) return { changed: false, count: 0 };
    let products = null;
    try { products = JSON.parse(raw); } catch (_) { return { changed: false, count: 0 }; }
    if (!Array.isArray(products)) return { changed: false, count: 0 };
    const byName = Object.create(null);
    (imageDirs || []).filter(Boolean).forEach(dir => {
      listFiles(dir).forEach(file => { byName[path.basename(file)] = file; });
    });
    let count = 0;
    products.forEach(product => {
      const image = product && product.image;
      if (!image || typeof image !== 'string') return;
      if (image.startsWith('bundle:') || /^https?:/i.test(image)) return;
      if (!path.isAbsolute(image)) return;
      if (fs.existsSync(image)) return;
      const hit = byName[path.basename(image)];
      if (!hit) return;
      product.image = hit;
      count++;
    });
    if (!count) return { changed: false, count: 0 };
    const text = JSON.stringify(products);
    writeAtomic(fileFor(dataDir, 'sd_v1_products'), text);
    state['sd_v1_products'] = text;
    scheduleBackup();
    return { changed: true, count };
  }

  function close() {
    flushBackup();
    return { ok: true };
  }

  return {
    status,
    load,
    get,
    set,
    remove,
    has,
    keys,
    isEmpty,
    close,
    flushBackup,
    lastWriteError,
    snapshot,
    importSnapshot,
    migrateLegacy,
    backupImages,
    restoreImages,
    setImageDirs,
    repairImagePaths,
    listBackups,
    writeBackupMirror,
    dataDir,
    backupDir,
  };
}

module.exports = { createDataStore, DATA_FILE, BACKUP_LATEST, BACKUP_KEEP };
