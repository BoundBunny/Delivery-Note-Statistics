'use strict';
/* ============================================================
 * tests/data-store.test.cjs — 桌面端业务数据文件后端
 * ------------------------------------------------------------
 * 覆盖老板最关心的四件事：
 *  1) 改过的商品/客户/单据落在「安装目录相对路径」下的普通文件里；
 *  2) 程序目录被误删后重装，能从程序目录之外的备份自动恢复；
 *  3) 用户主动「清空全部数据」后重启，数据不会从备份里复活；
 *  4) 老版本 localStorage 里的数据能平滑搬进文件后端；
 *  5) 随包只初始化商品，不带任何单据和客户。
 * ============================================================ */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const JS = path.join(ROOT, 'webapp/js');
const { createDataStore } = require(path.join(ROOT, 'lib/data-store.js'));

function tempDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-datastore-'));
  return { base, dataDir: path.join(base, '安装目录', '用户数据'), backupDir: path.join(base, 'AppData', '送货单统计数据备份') };
}
function openStore(dirs) {
  const store = createDataStore({ dataDir: dirs.dataDir, backupDir: dirs.backupDir });
  store.load();
  return store;
}

test('业务数据写入安装目录下的独立文件，重开即读回', () => {
  const dirs = tempDirs();
  const store = openStore(dirs);
  store.set('sd_v1_products', JSON.stringify([{ id: 'p1', name: '怡宝饮用纯净水', price: 2.5 }]));
  store.set('sd_v1_orders', JSON.stringify([{ id: 'o1', no: 'SD-20261111-001', total: 10 }]));
  store.close();

  const file = path.join(dirs.dataDir, encodeURIComponent('sd_v1_products') + '.json');
  assert.ok(fs.existsSync(file), '商品数据应落在安装目录相对路径下');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [{ id: 'p1', name: '怡宝饮用纯净水', price: 2.5 }]);

  const reopened = openStore(dirs);
  assert.equal(JSON.parse(reopened.get('sd_v1_products'))[0].price, 2.5, '改过的价格应原样保留');
  assert.equal(JSON.parse(reopened.get('sd_v1_orders')).length, 1);
});

test('程序目录被误删后重新安装，能从程序目录之外的备份自动恢复', () => {
  const dirs = tempDirs();
  const store = openStore(dirs);
  store.set('sd_v1_customers', JSON.stringify([{ id: 'c1', name: '敖客' }]));
  store.set('sd_v1_products', JSON.stringify([{ id: 'p1', name: '三养火鸡面（油炸）140g', price: 7 }]));
  store.set('sd_v1_orders', JSON.stringify([{ id: 'o1', no: 'SD-20261107-021', total: 10605 }]));
  store.flushBackup();

  // 老板把整个程序文件夹删了，只留下程序目录之外的备份
  fs.rmSync(path.join(dirs.base, '安装目录'), { recursive: true, force: true });
  assert.ok(!fs.existsSync(dirs.dataDir));

  const restored = openStore(dirs);
  assert.equal(restored.status.restored, true, '应从目录外备份恢复');
  assert.equal(JSON.parse(restored.get('sd_v1_customers'))[0].name, '敖客');
  assert.equal(JSON.parse(restored.get('sd_v1_products'))[0].price, 7);
  assert.equal(JSON.parse(restored.get('sd_v1_orders'))[0].total, 10605);
  assert.ok(fs.existsSync(path.join(dirs.dataDir, encodeURIComponent('sd_v1_orders') + '.json')), '恢复后应写回安装目录');
});

test('用户主动清空数据后重启，数据不会从备份里复活', () => {
  const dirs = tempDirs();
  const store = openStore(dirs);
  store.set('sd_v1_orders', JSON.stringify([{ id: 'o1', total: 100 }]));
  store.flushBackup();

  // 「清空全部数据」= 业务键仍在，但内容被重置为空
  store.set('sd_v1_orders', '[]');
  store.set('sd_v1_customers', '[]');
  store.flushBackup();

  const reopened = openStore(dirs);
  assert.equal(reopened.status.restored, false, '安装目录仍有业务键，不应触发恢复');
  assert.deepEqual(JSON.parse(reopened.get('sd_v1_orders')), []);
});

test('老版本 localStorage 里的数据能搬进文件后端，且搬完不留在旧处', () => {
  const dirs = tempDirs();
  const store = openStore(dirs);
  const result = store.migrateLegacy({
    sd_v1_products: JSON.stringify([{ id: 'p1', name: '老数据商品' }]),
    sd_v1_orders: JSON.stringify([{ id: 'o1', total: 8 }]),
  });
  assert.equal(result.migrated, 2);
  assert.equal(JSON.parse(store.get('sd_v1_products'))[0].name, '老数据商品');
  assert.ok(fs.existsSync(path.join(dirs.dataDir, encodeURIComponent('sd_v1_orders') + '.json')));
});

test('窗口状态文件不会被当成业务数据键', () => {
  const dirs = tempDirs();
  fs.mkdirSync(dirs.dataDir, { recursive: true });
  fs.writeFileSync(path.join(dirs.dataDir, 'window-state.json'), JSON.stringify({ width: 1200, height: 800 }));
  const store = openStore(dirs);
  assert.equal(store.get('window-state'), null, '窗口状态不应进入业务数据');
  assert.equal(store.keys().length, 0);
});

test('商品图片换了安装位置后，能按文件名找回失效的绝对路径', () => {
  const dirs = tempDirs();
  const oldImages = path.join(dirs.base, '旧位置');
  const newImages = path.join(dirs.base, '新位置');
  fs.mkdirSync(oldImages, { recursive: true });
  fs.mkdirSync(newImages, { recursive: true });
  // 旧位置的文件已经随程序目录一起没了，只剩新位置的那一份
  fs.writeFileSync(path.join(newImages, 'p_1.jpg'), 'x');

  const store = openStore(dirs);
  store.set('sd_v1_products', JSON.stringify([{ id: 'p1', image: path.join(oldImages, 'p_1.jpg') }]));
  const repaired = store.repairImagePaths([newImages]);
  assert.equal(repaired.count, 1);
  assert.equal(JSON.parse(store.get('sd_v1_products'))[0].image, path.join(newImages, 'p_1.jpg'));
});

test('商品图片跟着数据一起备份，删掉程序目录后还能找回', () => {
  const dirs = tempDirs();
  const imageDir = path.join(dirs.base, '安装目录', 'CommercesData');
  fs.mkdirSync(imageDir, { recursive: true });
  fs.writeFileSync(path.join(imageDir, 'p_1.jpg'), 'image-bytes');

  const store = createDataStore({ dataDir: dirs.dataDir, backupDir: dirs.backupDir, imageDirs: [imageDir] });
  store.load();
  store.set('sd_v1_products', JSON.stringify([{ id: 'p1', image: path.join(imageDir, 'p_1.jpg') }]));
  store.flushBackup();

  // 图片应已复制到程序目录之外的备份里
  const backedUp = path.join(dirs.backupDir, '图片', 'p_1.jpg');
  assert.ok(fs.existsSync(backedUp), '商品图片应备份到程序目录之外');

  // 老板删掉整个程序目录后重装
  fs.rmSync(path.join(dirs.base, '安装目录'), { recursive: true, force: true });
  const reopened = createDataStore({ dataDir: dirs.dataDir, backupDir: dirs.backupDir, imageDirs: [imageDir] });
  reopened.load();
  assert.equal(reopened.status.restored, true, '应从目录外备份恢复数据');
  const restored = reopened.restoreImages([imageDir]);
  assert.equal(restored.restored, 1, '应把商品图片一并恢复');
  assert.ok(fs.existsSync(path.join(imageDir, 'p_1.jpg')));
});

/* ---------- store.js 与文件后端的联动 ---------- */
function createDesktopStore(dirs, seeds) {
  const store = openStore(dirs);
  const bridge = {
    getItem: key => store.get(key),
    setItem: (key, value) => { store.set(key, value); return key; },
    removeItem: key => { store.remove(key); },
    key: index => { const keys = store.keys(); return index >= 0 && index < keys.length ? keys[index] : null; },
    get length() { return store.keys().length; },
    clear() { store.keys().forEach(k => store.remove(k)); },
  };
  const context = vm.createContext({
    window: { __DNSStorage: bridge, SEED_PRODUCTS: seeds || [], pinyinPro: { pinyin: v => v }, addEventListener() {} },
    localStorage: null,
    TextDecoder, TextEncoder, Intl,
    document: { addEventListener() {} },
    requestAnimationFrame() {},
  });
  vm.runInContext(fs.readFileSync(path.join(JS, 'util.js'), 'utf8'), context);
  context.toast = () => {};
  vm.runInContext(fs.readFileSync(path.join(JS, 'store.js'), 'utf8'), context);
  return { api: vm.runInContext('Store', context), store };
}

test('首次运行只初始化商品：没有任何单据和客户', () => {
  const dirs = tempDirs();
  const seeds = [{ name: '怡宝饮用纯净水', spec: '555ml', unit: '瓶', barcode: '6901285991219' }];
  const { api } = createDesktopStore(dirs, seeds);
  const counts = api.countAll();
  assert.equal(counts.products, 1, '应写入随包的初始商品');
  assert.equal(counts.orders, 0, '不应初始化任何单据');
  assert.equal(counts.customers, 0, '不应初始化任何客户');
});

test('改过的商品价格写进安装目录，重新打开应用依然生效', () => {
  const dirs = tempDirs();
  const seeds = [{ name: '三养火鸡面（油炸）140g', spec: '140g', unit: '袋', barcode: '6941234567890' }];
  const first = createDesktopStore(dirs, seeds);
  first.api.upsertProduct({ name: '三养火鸡面（油炸）140g', spec: '140g', unit: '袋', barcode: '6941234567890', price: 8.5 });
  first.api.upsertCustomer({ name: '敖客', phone: '13800000000' });
  first.store.flushBackup();

  const second = createDesktopStore(dirs, seeds);
  assert.equal(second.api.listProducts()[0].price, 8.5, '改过的单价应保留');
  assert.equal(second.api.listCustomers()[0].name, '敖客');
  assert.equal(second.api.listOrders().length, 0);
});

/* ---------- 单个数据文件丢失 / 损坏：从备份回填，且好备份不被覆盖 ---------- */
function seededDirs() {
  const dirs = tempDirs();
  const store = openStore(dirs);
  store.set('sd_v1_settings', JSON.stringify({ company: '测试店' }));
  store.set('sd_v1_customers', '[]');
  store.set('sd_v1_orders', JSON.stringify([{ id: 'o1', total: 100 }]));
  store.flushBackup();
  return dirs;
}

test('只丢失单据文件时从备份回填，其它文件保持不变', () => {
  const dirs = seededDirs();
  fs.rmSync(path.join(dirs.dataDir, 'sd_v1_orders.json'));
  const reopened = openStore(dirs);
  assert.deepEqual(JSON.parse(reopened.get('sd_v1_orders')), [{ id: 'o1', total: 100 }]);
  assert.deepEqual(reopened.status.repaired.map(r => [r.key, r.reason]), [['sd_v1_orders', 'missing']]);
  assert.equal(reopened.status.restored, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dirs.dataDir, 'sd_v1_orders.json'), 'utf8')), [{ id: 'o1', total: 100 }]);
});

test('单据文件写坏时回填备份、保留损坏原文，且备份不被坏数据覆盖', () => {
  const dirs = seededDirs();
  fs.writeFileSync(path.join(dirs.dataDir, 'sd_v1_orders.json'), '[{"id":"o1","tot');
  const reopened = openStore(dirs);
  assert.deepEqual(JSON.parse(reopened.get('sd_v1_orders')), [{ id: 'o1', total: 100 }]);
  assert.equal(reopened.status.repaired[0].reason, 'corrupt');
  const kept = fs.readdirSync(dirs.dataDir).filter(name => name.includes('.corrupt-'));
  assert.equal(kept.length, 1);
  assert.equal(fs.readFileSync(path.join(dirs.dataDir, kept[0]), 'utf8'), '[{"id":"o1","tot');
  assert.ok(!reopened.keys().some(key => key.includes('corrupt')), '损坏副本不能变成数据键');
  assert.deepEqual(JSON.parse(openStore(dirs).get('sd_v1_orders')), [{ id: 'o1', total: 100 }]);
});

test('逐键镜像也坏了时，改用最新快照或按日快照', () => {
  const dirs = seededDirs();
  fs.writeFileSync(path.join(dirs.dataDir, 'sd_v1_orders.json'), '');
  fs.writeFileSync(path.join(dirs.backupDir, 'sd_v1_orders.json'), '{{');
  fs.writeFileSync(path.join(dirs.backupDir, 'data-latest.json'), 'broken');
  const reopened = openStore(dirs);
  assert.deepEqual(JSON.parse(reopened.get('sd_v1_orders')), [{ id: 'o1', total: 100 }]);
  assert.match(reopened.status.repaired[0].from, /^data-\d{8}-\d{6}\.json$/);
});

test('损坏且没有任何可用备份时保留原文供抢救，坏数据不进入备份', () => {
  const dirs = seededDirs();
  for (const name of fs.readdirSync(dirs.backupDir)) fs.rmSync(path.join(dirs.backupDir, name), { recursive: true });
  fs.writeFileSync(path.join(dirs.dataDir, 'sd_v1_orders.json'), 'garbage');
  const reopened = openStore(dirs);
  assert.equal(reopened.get('sd_v1_orders'), 'garbage');
  assert.deepEqual(reopened.status.unrecovered, ['sd_v1_orders']);
  assert.equal(fs.existsSync(path.join(dirs.backupDir, 'sd_v1_orders.json')), false);
  assert.equal('sd_v1_orders' in JSON.parse(fs.readFileSync(path.join(dirs.backupDir, 'data-latest.json'), 'utf8')).data, false);
  // 用户恢复有效数据后重新纳入备份
  reopened.set('sd_v1_orders', '[]');
  reopened.flushBackup();
  assert.equal(fs.readFileSync(path.join(dirs.backupDir, 'sd_v1_orders.json'), 'utf8'), '[]');
});
