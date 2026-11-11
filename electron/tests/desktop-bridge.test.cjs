'use strict';
/* 桌面端存储链路的端到端验证（不依赖 Electron GUI）：
 *   preload.js 的同步存储桥 → 主进程 IPC 处理 → lib/data-store.js 文件后端
 *   → webapp/js/store.js 业务层
 * 在 Node 里用假 ipcRenderer 把这些环节接起来，验证真实桌面行为。
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const { createDataStore } = require(path.join(ROOT, 'lib/data-store.js'));

function tempDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-bridge-'));
  return {
    base,
    dataDir: path.join(base, '程序目录', '用户数据'),
    backupDir: path.join(base, '程序目录之外', '送货单统计数据备份'),
  };
}

/* 用真实 data-store 模拟主进程侧的 IPC 处理 */
function createIpcRouter(dirs) {
  const store = createDataStore({ dataDir: dirs.dataDir, backupDir: dirs.backupDir });
  store.load();
  const handlers = {
    'sd:storage:snapshot': () => ({ ok: true, data: store.snapshot(), info: { dataDir: store.dataDir, backupDir: store.backupDir } }),
    'sd:storage:get': key => store.get(String(key)),
    'sd:storage:set': (key, value) => {
      try { store.set(String(key), value); return { ok: true }; }
      catch (err) { return { ok: false, error: String(err && err.message || err) }; }
    },
    'sd:storage:remove': key => {
      try { store.remove(String(key)); return { ok: true }; }
      catch (err) { return { ok: false, error: String(err && err.message || err) }; }
    },
    'sd:storage:migrate': legacy => {
      try { const r = store.migrateLegacy(legacy || {}); return { ok: true, migrated: r.migrated || 0 }; }
      catch (err) { return { ok: false, error: String(err && err.message || err), migrated: 0 }; }
    },
    'sd:storage:flush': () => { try { store.flushBackup(); return { ok: true }; } catch (_) { return { ok: false }; } },
  };
  return {
    store,
    ipcRenderer: {
      sendSync(channel, ...args) {
        const fn = handlers[channel];
        if (!fn) return null;
        try { return fn(...args); } catch (_) { return null; }
      },
      on() {},
      invoke() { return Promise.resolve({ ok: true }); },
    },
  };
}

function createFakeLocalStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    get length() { return map.size; },
    key(index) { return Array.from(map.keys())[index] || null; },
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    clear() { map.clear(); },
    _dump() { return Object.fromEntries(map); },
  };
}

/* 在同一个 vm 里依次跑 preload.js（提供 window.__DNSStorage）与 store.js（业务层） */
function bootDesktop(dirs, options) {
  const opts = options || {};
  const router = createIpcRouter(dirs);
  const legacy = createFakeLocalStorage(opts.legacy || {});
  const preloadSource = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  const storeSource = fs.readFileSync(path.join(ROOT, 'webapp/js/store.js'), 'utf8');
  const utilSource = fs.readFileSync(path.join(ROOT, 'webapp/js/util.js'), 'utf8');

  const fakeWindow = {
    localStorage: legacy,
    SEED_PRODUCTS: opts.seeds || [],
    pinyinPro: { pinyin: v => v },
    addEventListener() {},
    dispatchEvent() {},
    close() {},
  };
  const context = vm.createContext({
    window: fakeWindow,
    localStorage: legacy,
    document: { addEventListener() {} },
    requestAnimationFrame() {},
    TextDecoder, TextEncoder, Intl, Event, Map, JSON, Object, Array, String, Number, Boolean, Math, Date, RegExp, Error, Promise, Set,
    console,
    __dirname: ROOT,
    require: (name) => {
      if (name === 'electron') return { ipcRenderer: router.ipcRenderer };
      if (name === 'path') return path;
      if (name === 'url') return require('node:url');
      return require(name);
    },
  });
  vm.runInContext(utilSource, context);
  vm.runInContext(preloadSource, context);
  vm.runInContext(storeSource, context);
  return {
    store: router.store,
    legacy,
    bridge: fakeWindow.__DNSStorage,
    info: fakeWindow.__DNSStorageInfo,
    api: vm.runInContext('Store', context),
  };
}

test('桌面端业务数据落在安装目录相对路径的文件里，不写浏览器缓存', () => {
  const dirs = tempDirs();
  const seeds = [{ name: '三养火鸡面（油炸）140g', spec: '140g', unit: '袋', barcode: '6941234567890' }];
  const { api, store, legacy } = bootDesktop(dirs, { seeds });

  api.upsertCustomer({ name: '敖客', phone: '13800000000' });
  api.upsertProduct({ name: '三养火鸡面（油炸）140g', spec: '140g', unit: '袋', barcode: '6941234567890', price: 7 });
  store.flushBackup();

  const files = fs.readdirSync(dirs.dataDir);
  assert.ok(files.includes('sd_v1_customers.json'), '客户数据应写进安装目录下的独立文件');
  assert.ok(files.includes('sd_v1_products.json'), '商品数据应写进安装目录下的独立文件');
  assert.equal(legacy._dump()['sd_v1_customers'], undefined, '不应再往浏览器 localStorage 写数据');

  // 整个程序目录被删掉，备份还在程序目录之外
  fs.rmSync(path.join(dirs.base, '程序目录'), { recursive: true, force: true });
  assert.ok(fs.existsSync(dirs.backupDir), '备份应留在程序目录之外');

  const reopened = bootDesktop(dirs, { seeds });
  assert.equal(reopened.api.listCustomers()[0].name, '敖客', '重装后客户应自动恢复');
  assert.equal(reopened.api.listProducts()[0].price, 7, '重装后改过的单价应保留');
});

test('旧版本留在 localStorage 的数据，桌面端启动时搬进安装目录并清掉旧副本', () => {
  const dirs = tempDirs();
  const legacyData = {
    sd_v1_customers: JSON.stringify([{ id: 'c1', name: '敖客', phone: '13800000000' }]),
    sd_v1_orders: JSON.stringify([{
      id: 'o1', no: 'SD-20261107-021', date: '2026-11-07', total: 10605,
      customer: { id: 'c1', name: '敖客' },
      items: [{ pid: 'p1', name: '三养火鸡面（油炸）140g', qty: 1515, price: 7, amount: 10605 }],
    }]),
  };
  const { api, legacy, store } = bootDesktop(dirs, { legacy: legacyData, seeds: [] });

  assert.equal(api.listCustomers()[0].name, '敖客', '旧数据应被搬进文件后端');
  assert.equal(api.listOrders().length, 1, '旧单据应被搬进文件后端');
  assert.equal(legacy._dump()['sd_v1_customers'], undefined, '搬完后应删掉 localStorage 旧副本');
  assert.ok(fs.existsSync(path.join(dirs.dataDir, 'sd_v1_customers.json')));
  store.flushBackup();
});

test('清空全部数据后重启，数据不会从目录外备份里复活', () => {
  const dirs = tempDirs();
  const seeds = [{ name: '怡宝饮用纯净水', spec: '555ml', unit: '瓶', barcode: '6901285991219' }];
  const first = bootDesktop(dirs, { seeds });
  first.api.upsertCustomer({ name: '敖客', phone: '13800000000' });
  first.store.flushBackup();
  first.api.clearAll();

  const second = bootDesktop(dirs, { seeds });
  assert.equal(second.api.listCustomers().length, 0, '清空后不应复活客户');
  assert.equal(second.api.listOrders().length, 0, '清空后不应复活单据');
});
