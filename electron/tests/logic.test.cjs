'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const JS = path.join(ROOT, 'webapp/js');

function createStore(initial = {}) {
  const values = new Map(Object.entries({
    sd_v1_seed_products_v1: '1', sd_v1_seed_products_cat_v1: '1', ...initial,
  }));
  const messages = [];
  const storage = {
    fail: null,
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (this.fail && this.fail(key, value)) throw new Error('QuotaExceededError');
      values.set(key, String(value));
    },
    removeItem: key => values.delete(key),
  };
  const context = vm.createContext({
    localStorage: storage, TextDecoder, TextEncoder, Intl,
    window: { addEventListener() {}, pinyinPro: { pinyin: value => value } },
    document: { addEventListener() {} }, requestAnimationFrame() {},
  });
  vm.runInContext(fs.readFileSync(path.join(JS, 'util.js'), 'utf8'), context);
  context.toast = (message, error) => messages.push({ message, error });
  vm.runInContext(fs.readFileSync(path.join(JS, 'store.js'), 'utf8'), context);
  return { store: vm.runInContext('Store', context), storage, values, context, messages };
}

function order(overrides = {}) {
  return {
    no: 'SD-20261108-001', date: '2026-11-08', customer: null,
    items: [{ name: 'Water', spec: '500ml', qty: 2, price: 3, amount: 6 }],
    total: 6, ...overrides,
  };
}

test('product CSV keeps distinct specifications and skips repeated identities', () => {
  const { store } = createStore();
  store.upsertProduct({ name: 'Water', spec: '500ml', barcode: '100' });
  const result = store.importProductsCSV('产品名称,规格,条码\nWater,1L,101\nWater,500ml,100\nOther name,2L,101');
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 2);
  assert.equal(store.listProducts().length, 2);
  assert.ok(store.listProducts().some(p => p.name === 'Water' && p.spec === '1L' && p.barcode === '101'));
});

test('product search includes barcode', () => {
  const { store } = createStore();
  store.upsertProduct({ name: 'Water', barcode: '6900123456789' });
  assert.equal(store.listProducts('6900123').length, 1);
});

test('malformed backup data is rejected before changing memory or storage', () => {
  const { store, values } = createStore();
  store.upsertCustomer({ name: 'Existing customer' });
  const original = store.exportJSON();
  const disk = JSON.stringify([...values]);
  const cases = [
    42, [], { customers: [null] }, { customers: [{}] },
    { products: [null] }, { products: [{ id: 'p', name: 12 }] },
    { orders: [null] }, { orders: [{ id: 'o', ...order({ items: null }) }] },
    { orders: [{ id: 'o', ...order({ total: '6' }) }] },
    { orders: [{ id: 'o', ...order({ date: '2026-02-30' }) }] },
    { orders: [{ id: 'o', ...order({ items: [null] }) }] },
    { customers: [{ id: 'same', name: 'A' }, { id: 'same', name: 'B' }] },
    { seqMap: { '2026-11-08': '1' } }, { lastPrices: { 'c:p': '3' } },
    { settings: { noPrefix: 123 } },
  ];
  for (const data of cases) {
    assert.throws(() => store.importJSON(JSON.stringify({ app: 'songhuodan', version: 1, data })), undefined, JSON.stringify(data));
    assert.deepEqual(JSON.parse(store.exportJSON()).data, JSON.parse(original).data);
    assert.equal(JSON.stringify([...values]), disk);
  }
});

test('valid backups round trip and fill missing settings', () => {
  const { store } = createStore();
  store.upsertCustomer({ name: 'Customer' });
  store.addOrder(order());
  const saved = JSON.parse(store.exportJSON());
  saved.data.settings = { company: 'Company' };
  store.importJSON(JSON.stringify(saved));
  assert.equal(store.countAll().orders, 1);
  assert.equal(store.getSettings().noPrefix, 'SD');
  assert.equal(store.getSettings().company, 'Company');
});

test('restoring without a sequence map does not duplicate existing order numbers', () => {
  const { store } = createStore();
  store.addOrder(order());
  const backup = JSON.parse(store.exportJSON());
  delete backup.data.seqMap;
  store.importJSON(JSON.stringify(backup));
  assert.equal(store.nextOrderNo('2026-11-08'), 'SD-20261108-002');
});

test('sequence reclamation supports four digits and never reuses a live number', () => {
  const { store } = createStore();
  store.importJSON(JSON.stringify({ app: 'songhuodan', data: { seqMap: { '2026-11-08': 1000 } } }));
  store.reclaimNo('SD-20261108-1000');
  assert.equal(store.nextOrderNo('2026-11-08'), 'SD-20261108-1000');
  store.addOrder(order({ no: 'SD-20261108-1000' }));
  store.reclaimNo('SD-20261108-1000');
  assert.equal(store.nextOrderNo('2026-11-08'), 'SD-20261108-1001');
});

test('failed save throws, reports failure, and restores cached data', () => {
  const { store, storage, messages, values } = createStore();
  store.addOrder(order());
  const disk = JSON.stringify([...values]);
  storage.fail = key => key === 'sd_v1_orders';
  assert.throws(() => store.addOrder(order({ no: 'SD-20261108-002' })), /保存|存储/);
  assert.equal(store.countAll().orders, 1);
  assert.equal(JSON.stringify([...values]), disk);
  assert.equal(messages.at(-1).error, true);
});

test('failed backup restore rolls back keys written before the failure', () => {
  const { store, storage, values } = createStore();
  store.setSettings({ company: 'Original' });
  store.upsertCustomer({ name: 'Original customer' });
  store.addOrder(order());
  const disk = JSON.stringify([...values]);
  const backup = JSON.parse(store.exportJSON());
  backup.data.settings.company = 'Replacement';
  backup.data.customers = [];
  backup.data.orders = [];
  storage.fail = (key, value) => key === 'sd_v1_orders' && value === '[]';
  assert.throws(() => store.importJSON(JSON.stringify(backup)), /保存|存储/);
  assert.equal(store.getSettings().company, 'Original');
  assert.equal(store.countAll().customers, 1);
  assert.equal(store.countAll().orders, 1);
  assert.equal(JSON.stringify([...values]), disk);
});

test('a business transaction rolls back records if a later operation throws', () => {
  const { store, values } = createStore();
  store.setSettings({ company: 'Original' });
  const disk = JSON.stringify([...values]);
  assert.throws(() => store.transaction(() => {
    store.upsertCustomer({ name: 'Temporary customer' });
    store.upsertProduct({ name: 'Temporary product' });
    throw new Error('Aborted');
  }), /Aborted/);
  assert.equal(store.countAll().customers, 0);
  assert.equal(store.countAll().products, 0);
  assert.equal(JSON.stringify([...values]), disk);
});

test('a product CSV batch is not partially imported on a write failure', () => {
  const { store, storage } = createStore();
  storage.fail = key => key === 'sd_v1_products';
  assert.throws(() => store.importProductsCSV('产品名称,规格\nWater,500ml\nWater,1L'), /保存|存储/);
  assert.equal(store.countAll().products, 0);
});

function zipEntry(bytes, name) {
  const buffer = Buffer.from(bytes);
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    if (buffer.subarray(offset + 30, offset + 30 + nameLength).toString() === name) {
      return buffer.subarray(start, start + size).toString('utf8');
    }
    offset = start + size;
  }
  throw new Error('Missing ZIP entry: ' + name);
}

test('XLSX sheet names are valid, bounded, and unique ignoring case', () => {
  const context = vm.createContext({ window: {}, TextEncoder });
  vm.runInContext(fs.readFileSync(path.join(JS, 'xlsx.js'), 'utf8'), context);
  const names = ['A/B', 'A:B', 'a_b', '', "'Client'", 'x'.repeat(40), 'x'.repeat(40)];
  const bytes = context.window.Xlsx.build(names.map(name => ({ name, rows: [[1]] })));
  const xml = zipEntry(bytes, 'xl/workbook.xml');
  const actual = [...xml.matchAll(/<sheet name="([^"]*)"/g)].map(match => match[1]);
  assert.equal(actual.length, names.length);
  assert.equal(new Set(actual.map(name => name.toLowerCase())).size, names.length);
  for (const name of actual) {
    assert.ok(name.length > 0 && name.length <= 31, name);
    assert.doesNotMatch(name, /[\\/\[\]:*?]/);
    assert.ok(!name.startsWith("'") && !name.endsWith("'"), name);
  }
});

test('Electron refuses corrupt UTF-8 BOM files instead of decoding them as GB18030', () => {
  const electron = { ipcMain: { handle() {}, on() {} }, protocol: { registerSchemesAsPrivileged() {} },
    app: { isPackaged: false, requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {} } };
  const context = vm.createContext({
    // main.js 会 require 相对路径的本地模块（如 ./lib/data-store.js），
    // 这里按应用根目录解析，而不是按本测试文件所在目录。
    require: name => {
      if (name === 'electron') return electron;
      if (name.startsWith('./') || name.startsWith('../')) return require(path.join(ROOT, name));
      return require(name);
    },
    __dirname: ROOT, process: { on() {}, argv: [], env: {}, platform: process.platform },
    Buffer, TextDecoder, console,
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8'), context);
  context.input = Buffer.from([0xef, 0xbb, 0xbf, 0x81, 0x40]);
  assert.throws(() => vm.runInContext('decodeImportText(input)', context), /UTF-8/);
  context.input = Buffer.from('客户名称,电话\n客户,123', 'utf8');
  assert.equal(vm.runInContext('decodeImportText(input)', context), context.input.toString());
});

test('关闭按钮行为偏好可记住并在下次生效，也能恢复为「每次询问」', () => {
  const os = require('node:os');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-close-pref-'));
  const electron = { ipcMain: { handle() {}, on() {} }, protocol: { registerSchemesAsPrivileged() {} },
    app: { isPackaged: false, getPath: () => userData, requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {} } };
  const context = vm.createContext({
    require: name => {
      if (name === 'electron') return electron;
      if (name.startsWith('./') || name.startsWith('../')) return require(path.join(ROOT, name));
      return require(name);
    },
    __dirname: ROOT, process: { on() {}, argv: [], env: {}, platform: process.platform },
    Buffer, TextDecoder, console, setTimeout, clearTimeout,
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8'), context);

  const file = path.join(userData, 'app-prefs.json');
  const readPrefs = () => JSON.parse(fs.readFileSync(file, 'utf8'));

  // 初始：默认「关闭时提示」开启 → getCloseAction() 为 ''（每次询问）
  assert.equal(vm.runInContext('getCloseAction()', context), '');
  assert.equal(vm.runInContext('getClosePrefs().action', context), 'minimize');
  assert.equal(vm.runInContext('getClosePrefs().prompt', context), true);

  // 单选「最小化」并取消「关闭时提示」→ 直接最小化、不再询问
  vm.runInContext("setClosePrefs({action:'minimize', prompt:false})", context);
  assert.equal(vm.runInContext('getCloseAction()', context), 'minimize');
  assert.equal(readPrefs().closeAction, 'minimize');
  assert.equal(readPrefs().closePrompt, false);

  // 单选「退出程序」并取消提示
  vm.runInContext("setClosePrefs({action:'quit', prompt:false})", context);
  assert.equal(vm.runInContext('getCloseAction()', context), 'quit');
  assert.equal(readPrefs().closeAction, 'quit');

  // 勾选「关闭时提示」→ 恢复每次询问（getCloseAction 返回 ''），但记住的动作仍是 quit
  vm.runInContext("setClosePrefs({action:'quit', prompt:true})", context);
  assert.equal(vm.runInContext('getCloseAction()', context), '');
  assert.equal(readPrefs().closeAction, 'quit');
  assert.equal(readPrefs().closePrompt, true);

  // 旧兼容接口：setCloseAction('minimize') 等价于带动作且关闭提示
  vm.runInContext("setCloseAction('minimize')", context);
  assert.equal(vm.runInContext('getCloseAction()', context), 'minimize');
  vm.runInContext("setCloseAction('')", context);
  assert.equal(vm.runInContext('getCloseAction()', context), '');
  // 非法动作回落到默认 minimize
  vm.runInContext("setClosePrefs({action:'hack', prompt:true})", context);
  assert.equal(readPrefs().closeAction, 'minimize');
});
