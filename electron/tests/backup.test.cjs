'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const { createDataStore } = require('../lib/data-store.js');
const seeds = [
  { name: '内置商品甲', barcode: '001', spec: '500g', unit: '袋', price: 2, category: 'other' },
  { name: '内置商品乙', barcode: '002', spec: '1kg', unit: '袋', price: 5, category: 'other' },
];
function boot(initial = {}, catalog = seeds) {
  const values = new Map(Object.entries(initial));
  const storage = {
    fail: null,
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (this.fail?.(key, value)) throw new Error('Disk write failed'); values.set(key, String(value)); },
    removeItem: key => values.delete(key),
  };
  const context = vm.createContext({
    window: { SEED_PRODUCTS: catalog, pinyinPro: { pinyin: v => v }, addEventListener() {} },
    localStorage: storage, document: { addEventListener() {} }, requestAnimationFrame() {},
    TextEncoder, TextDecoder, Intl, Blob,
  });
  for (const file of ['util.js', 'store.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'webapp/js', file), 'utf8'), context);
  context.toast = () => {};
  return { store: vm.runInContext('Store', context), context, values, storage };
}
function fixture(app) {
  const customer = app.store.upsertCustomer({ name: '换机客户', phone: '00123', address: '收货地址' });
  const product = app.store.upsertProduct({ name: '自建商品', spec: '2kg', unit: '袋', price: 3, cost: 1.5, remark: '资料备注' });
  const order = app.store.addOrder({ no: 'SD-20261112-005', date: '2026-11-12', customer,
    items: [{ pid: product.id, name: product.name, spec: product.spec, unit: product.unit, qty: 2, price: 3, amount: 6, remark: '明细备注' }],
    total: 6, note: '整单备注', operator: '老板' });
  app.store.setLastPrice(customer.id, product.id, 3);
  return { customer, product, order };
}
function temporaryStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-backup-test-'));
  const dirs = { dataDir: path.join(root, 'data'), backupDir: path.join(root, 'backup') };
  const store = createDataStore(dirs); store.load();
  return { root, dirs, store };
}

test('portable JSON excludes initial product definitions and keeps custom/imported products', () => {
  const app = boot(); fixture(app);
  app.store.importProductsCSV('产品名称,条码,规格,单位,价格\n导入商品,009,3kg,袋,8');
  // An explicitly user-created record must remain custom even with a catalog barcode.
  app.store.upsertProduct({ ...seeds[0], price: 22 });
  const backup = JSON.parse(app.store.exportJSON());
  assert.equal(backup.version, 2); assert.equal(backup.kind, 'portable');
  assert.equal(backup.data.products.length, 3);
  assert.ok(backup.data.products.every(p => p.origin === 'custom'));
  assert.equal(backup.catalog.entries.length, 2);
  assert.ok(backup.catalog.entries.every(entry => !Object.hasOwn(entry, 'name') && Object.keys(entry.changes).length === 0));
  assert.equal(backup.data.customers.length, 1); assert.equal(backup.data.orders.length, 1);
});

test('a different computer restores custom data, catalog changes, IDs, prices and sequences', () => {
  const first = boot(), fx = fixture(first);
  const builtin = first.store.listProducts().find(p => p.barcode === '001');
  first.store.upsertProduct({ id: builtin.id, name: '老板改过的内置名称', price: 7, remark: '改价记录' });
  first.store.setLastPrice(fx.customer.id, builtin.id, 6.5);
  first.store.addOrder({ no: 'SD-20261112-006', date: '2026-11-12', customer: fx.customer,
    items: [{ pid: builtin.id, name: '老板改过的内置名称', qty: 1, price: 6.5, amount: 6.5 }], total: 6.5 });
  first.store.deleteProduct(builtin.id);
  const removed = first.store.listProducts().find(p => p.barcode === '002'); first.store.deleteProduct(removed.id);
  first.store.setSettings({ company: '老板店铺', imageDir: 'E:\\old-computer\\images' });
  const json = first.store.exportJSON(), second = boot();
  assert.notEqual(second.store.listProducts().find(p => p.barcode === '001').id, builtin.id);
  second.store.importJSON(json);
  assert.equal(second.store.getProduct(builtin.id).name, '老板改过的内置名称');
  assert.equal(second.store.getProduct(builtin.id).price, 7);
  assert.equal(second.store.getProduct(builtin.id).archived, true);
  assert.equal(second.store.getProduct(fx.product.id).remark, '资料备注');
  assert.equal(second.store.getOrder(fx.order.id).items[0].pid, fx.product.id);
  assert.equal(second.store.getLastPrice(fx.customer.id, builtin.id), 6.5);
  assert.equal(second.store.getLastPrice(fx.customer.id, fx.product.id), 3);
  assert.equal(second.store.getSettings().company, '老板店铺'); assert.equal(second.store.getSettings().imageDir, '');
  assert.ok(!second.store.listProducts('', { includeArchived: true }).some(p => p.barcode === '002'));
  assert.equal(second.store.nextOrderNo('2026-11-12'), 'SD-20261112-007');
  const restarted = boot(Object.fromEntries(second.values));
  assert.equal(restarted.store.getProduct(builtin.id).archived, true);
  assert.equal(restarted.store.getProduct(builtin.id).price, 7);
  assert.equal(restarted.store.countAll().orders, 2);
  assert.ok(!restarted.store.listProducts('', { includeArchived: true }).some(p => p.barcode === '002'));
});

test('cleared optional values on initial products stay cleared after restore', () => {
  const first = boot(), product = first.store.listProducts()[0];
  first.store.upsertProduct({ id: product.id, name: product.name, price: undefined });
  const second = boot(); second.store.importJSON(first.store.exportJSON());
  assert.equal(second.store.getProduct(product.id).price, undefined);
});

test('legacy records are classified conservatively and legacy full backups remain supported', () => {
  const products = [{ id: 'old-builtin', ...seeds[0] }, { id: 'old-custom', ...seeds[0], barcode: 'different' }];
  const app = boot({ sd_v1_products: JSON.stringify(products), sd_v1_seed_products_v4: '1' });
  const backup = JSON.parse(app.store.exportJSON());
  assert.deepEqual(backup.data.products.map(p => p.id), ['old-custom']);
  assert.equal(backup.catalog.entries[0].id, 'old-builtin');
  app.store.importJSON(JSON.stringify({ app: 'songhuodan', version: 1, data: { products, customers: [], orders: [] } }));
  assert.equal(app.store.getProduct('old-custom').barcode, 'different');
});

test('raw automatic backup JSON is decoded instead of clearing business records', () => {
  const app = boot(), fx = fixture(app), backend = temporaryStore();
  for (const [key, value] of app.values) backend.store.set(key, value);
  assert.equal(backend.store.flushBackup(), true);
  const json = fs.readFileSync(path.join(backend.dirs.backupDir, 'data-latest.json'), 'utf8');
  assert.equal(JSON.parse(json).kind, 'storage');
  const target = boot(); target.store.importJSON(json);
  assert.equal(target.store.getOrder(fx.order.id).total, 6);
  assert.equal(target.store.getCustomer(fx.customer.id).phone, '00123');
  assert.equal(target.store.getProduct(fx.product.id).price, 3);
  const legacyRaw = JSON.parse(json); delete legacyRaw.kind;
  target.store.importJSON(JSON.stringify(legacyRaw)); assert.equal(target.store.countAll().orders, 1);
  backend.store.close();
});

test('unrecognized, incomplete, incompatible and damaged backups cannot alter existing data', () => {
  const app = boot(); fixture(app);
  const original = app.store.exportJSON(), originalDisk = JSON.stringify([...app.values]);
  const cases = [
    { app: 'songhuodan', version: 1, data: {} },
    { app: 'songhuodan', version: 1, data: { unexpected: [] } },
    { app: 'songhuodan', version: 1, data: { settings: {} } },
    { app: 'songhuodan', version: 1, data: { orders: [] } },
    { app: 'songhuodan', version: 1, data: { customers: [], products: [], orders: [], settings: null } },
    { app: 'songhuodan', version: 1, data: { sd_v1_orders: 'damaged' } },
    { app: 'songhuodan', version: 1, data: { sd_v1_orders: '[]', orders: [] } },
  ];
  for (const mutate of [b => delete b.data.orders, b => b.data.customers = null, b => b.catalog.entries[0].key = 'missing',
    b => b.catalog.entries[0].id = b.data.products[0].id, b => b.catalog.entries[0].changes.price = -1]) {
    const backup = JSON.parse(original); mutate(backup); cases.push(backup);
  }
  for (const backup of cases) {
    assert.throws(() => app.store.importJSON(JSON.stringify(backup)));
    assert.equal(JSON.stringify([...app.values]), originalDisk);
    assert.deepEqual(JSON.parse(app.store.exportJSON()).data, JSON.parse(original).data);
  }
});

test('restore write failure rolls back both data and initialization flags', () => {
  const app = boot({}, []); fixture(app);
  const before = JSON.stringify([...app.values]);
  const replacement = { app: 'songhuodan', version: 1, data: { customers: [], products: [], orders: [] } };
  app.storage.fail = (key, value) => key === 'sd_v1_orders' && value === '[]';
  assert.throws(() => app.store.importJSON(JSON.stringify(replacement)), /保存|存储/);
  assert.equal(JSON.stringify([...app.values]), before);
  assert.equal(app.store.countAll().orders, 1);
});

test('initialization flag failure cannot partially replace business data', () => {
  const app = boot({}, []); fixture(app); const before = JSON.stringify([...app.values]);
  app.storage.fail = key => key === 'sd_v1_seed_products_v4';
  assert.throws(() => app.store.importJSON(JSON.stringify({ app: 'songhuodan', version: 1, data: { customers: [], products: [], orders: [] } })), /Disk write/);
  assert.equal(JSON.stringify([...app.values]), before); assert.equal(app.store.countAll().orders, 1);
});

test('all report APIs refuse incomplete storage while raw recovery remains available', () => {
  const app = boot({ sd_v1_orders: '[{"broken"' });
  assert.equal(app.store.recoveryState().blocked, true);
  for (const name of ['exportJSON', 'ordersCSV', 'ordersSheet', 'ordersTable', 'productsCSV', 'customersCSV', 'tableCSV', 'assertExportable']) assert.throws(() => app.store[name](), /原始数据|不完整/);
  assert.equal(JSON.parse(app.store.exportRecoveryJSON()).raw.sd_v1_orders, '[{"broken"');
  app.store.importJSON(JSON.stringify({ app: 'songhuodan', version: 1, data: { customers: [], products: [], orders: [] } }));
  assert.equal(app.store.recoveryState().blocked, false); assert.equal(app.store.ordersTable().length, 0);
});

test('failed backup remains pending and retries after its destination is repaired', () => {
  const t = temporaryStore(); t.store.close();
  const blocked = path.join(t.root, 'blocked'); fs.writeFileSync(blocked, 'file');
  const store = createDataStore({ dataDir: t.dirs.dataDir, backupDir: blocked }); store.load();
  store.set('sd_v1_customers', '[]'); assert.equal(store.flushBackup(), false); assert.ok(store.status.backupError);
  assert.equal(store.flushBackup(), false);
  fs.unlinkSync(blocked); fs.mkdirSync(blocked);
  assert.equal(store.flushBackup(), true); assert.equal(store.status.backupError, '');
  assert.equal(JSON.parse(fs.readFileSync(path.join(blocked, 'data-latest.json'), 'utf8')).data.sd_v1_customers, '[]');
  store.close();
});

test('manual forced backup writes a snapshot even when business data has not changed', () => {
  const t = temporaryStore(); t.store.set('sd_v1_orders', '[]'); t.store.flushBackup();
  const file = path.join(t.dirs.backupDir, 'data-latest.json'); fs.unlinkSync(file);
  assert.equal(t.store.flushBackup(true), true); assert.ok(fs.existsSync(file)); t.store.close();
});

test('a backup failure during startup remains pending without any new business write', () => {
  const t = temporaryStore(); t.store.set('sd_v1_orders', '[]'); t.store.close();
  const blocked = path.join(t.root, 'startup-blocked'); fs.writeFileSync(blocked, 'file');
  const store = createDataStore({ dataDir: t.dirs.dataDir, backupDir: blocked }); store.load();
  assert.ok(store.status.backupError); fs.unlinkSync(blocked); fs.mkdirSync(blocked);
  assert.equal(store.flushBackup(), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(blocked, 'data-latest.json'), 'utf8')).data.sd_v1_orders, '[]');
  store.close();
});

test('a failed product image copy makes the backup fail and remains retryable', () => {
  const t = temporaryStore(), images = path.join(t.root, 'images'); fs.mkdirSync(images);
  fs.writeFileSync(path.join(images, 'test.png'), 'image-bytes');
  const collision = path.join(t.dirs.backupDir, '图片', 'test.png'); fs.mkdirSync(collision, { recursive: true });
  t.store.setImageDirs([images]); t.store.set('sd_v1_products', '[]');
  assert.equal(t.store.flushBackup(), false); assert.ok(t.store.status.backupError);
  fs.rmdirSync(collision); assert.equal(t.store.flushBackup(), true);
  assert.equal(fs.readFileSync(collision, 'utf8'), 'image-bytes'); t.store.close();
});

test('manual backup and storage-flush IPC return failure instead of a false success', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-backup-ipc-')), blocked = path.join(root, 'blocked');
  fs.writeFileSync(blocked, 'file'); const handlers = {};
  const electron = { ipcMain: { handle: (key, fn) => handlers[key] = fn, on: (key, fn) => handlers[key] = fn },
    protocol: { registerSchemesAsPrivileged() {} }, app: { isPackaged: false, getPath: () => root, on() {}, requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }) } };
  const context = vm.createContext({ require: name => name === 'electron' ? electron : name.startsWith('.') ? require(path.resolve(ROOT, name)) : require(name),
    __dirname: ROOT, process: { on() {}, argv: [], platform: process.platform, env: { DNS_TEST_DATA_DIR: path.join(root, 'data'), DNS_TEST_BACKUP_DIR: blocked, DNS_TEST_IMAGE_DIR: path.join(root, 'images') } },
    Buffer, TextDecoder, console, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8'), context);
  const event = {}; handlers['sd:storage:set'](event, 'sd_v1_orders', '[]'); assert.equal(event.returnValue.ok, true);
  const first = await handlers['sd:backupNow']({}); assert.equal(first.ok, false); assert.ok(first.error);
  handlers['sd:storage:flush'](event); assert.equal(event.returnValue.ok, false);
  fs.unlinkSync(blocked); fs.mkdirSync(blocked);
  const repaired = await handlers['sd:backupNow']({}); assert.equal(repaired.ok, true); assert.equal(repaired.info.backupError, '');
});

function fileReader() {
  return class {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(bytes => { this.result = 'data:' + blob.type + ';base64,' + Buffer.from(bytes).toString('base64'); this.onload(); }, () => this.onerror());
    }
  };
}
test('export packs custom product and initial-product override images in the same JSON', async () => {
  const app = boot(), fx = fixture(app), image = 'E:\\old-machine\\photo.png';
  app.store.upsertProduct({ id: fx.product.id, name: fx.product.name, image });
  const builtin = app.store.listProducts().find(p => p.barcode === '001');
  app.store.upsertProduct({ id: builtin.id, name: builtin.name, image });
  let reads = 0;
  app.context.window.Android = { imageUrl: src => 'sdimg://local/?p=' + encodeURIComponent(src) };
  app.context.FileReader = fileReader();
  app.context.fetch = async url => { reads++; assert.ok(url.startsWith('sdimg://')); return { ok: true, blob: async () => new Blob(['image-bytes'], { type: 'image/png' }) }; };
  const json = await vm.runInContext('exportBackupJSON()', app.context), backup = JSON.parse(json);
  assert.match(backup.data.products[0].image, /^data:image\/png;base64,/);
  assert.equal(backup.data.products[0].image, backup.catalog.entries.find(e => e.key === 'barcode:001').changes.image);
  assert.equal(reads, 1); assert.equal(app.store.getProduct(fx.product.id).image, image);
  const target = boot(); target.store.importJSON(json);
  assert.equal(target.store.getProduct(fx.product.id).image, backup.data.products[0].image);
});

test('missing custom image stops portable export instead of creating an incomplete migration file', async () => {
  const app = boot(), fx = fixture(app); app.store.upsertProduct({ id: fx.product.id, name: fx.product.name, image: 'missing.png' });
  app.context.fetch = async () => ({ ok: false });
  await assert.rejects(vm.runInContext('exportBackupJSON()', app.context), /备份未导出/);
  assert.equal(app.store.getProduct(fx.product.id).image, 'missing.png');
});
