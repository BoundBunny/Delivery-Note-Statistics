'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
function boot() {
  const values = new Map();
  const context = vm.createContext({ TextEncoder, TextDecoder, Intl,
    window: { addEventListener() {}, pinyinPro: { pinyin: value => value } },
    document: { addEventListener() {} }, requestAnimationFrame() {},
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) },
  });
  for (const file of ['util.js', 'store.js', 'xlsx.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'webapp/js', file), 'utf8'), context);
  context.toast = () => {};
  return { context, store: vm.runInContext('Store', context), xlsx: context.window.Xlsx };
}
function entry(bytes, name) {
  const buffer = Buffer.from(bytes); let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18), length = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28);
    const start = offset + 30 + length + extra;
    if (buffer.subarray(offset + 30, offset + 30 + length).toString() === name) return buffer.subarray(start, start + size).toString('utf8');
    offset = start + size;
  }
  throw new Error('ZIP entry missing: ' + name);
}
function decodeCell(text) {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
function csvRows(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && character === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (character === '\r' || character === '\n')) { if (character === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += character;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  assert.equal(quoted, false); return rows;
}

test('quantity and unit-price formatting preserves stored digits, including tiny values', () => {
  const { context } = boot();
  for (const value of [0.001, 0.125, 1e-25, 1e-308, 1.2345678901234567, 1234567.8912345, 1e25, -0.001]) {
    context.number = value;
    for (const formatter of ['fmtNum', 'fmtPrice']) assert.equal(Number(vm.runInContext(formatter + '(number)', context).replace(/,/g, '')), value);
  }
  assert.equal(vm.runInContext('fmtPrice(3)', context), '3.00');
  assert.equal(vm.runInContext('fmtPrice(0.125)', context), '0.125');
  assert.equal(vm.runInContext('fmtMoney(0.125)', context), '0.13');
});

test('decimal quantity sums avoid binary floating-point display tails without rounding small quantities to zero', () => {
  const { context, store } = boot();
  assert.equal(vm.runInContext('sumQuantities([0.1, 0.2, 0.001])', context), 0.301);
  assert.equal(vm.runInContext('sumQuantities([-0.1, 0.2])', context), 0.1);
  assert.equal(vm.runInContext('sumQuantities([1e-25, 1e-25])', context), 2e-25);
  store.addOrder({ no: 'P2-SUM', date: '2026-11-12', customer: null,
    items: [0.1, 0.2].map(qty => ({ name: '商品', qty, price: 1, amount: qty })), total: 0.3 });
  assert.equal(store.ordersTable()[0].qty, 0.3);
});

test('CSV text formula prefixes are neutralized while quantity, price and amount cells stay numeric', () => {
  const { store } = boot();
  store.addOrder({ no: 'P2-CSV', date: '2026-11-12', customer: { id: 'c', name: '=1+1', phone: '+86123', contact: ' \t@SUM(1)' },
    items: [{ name: '=HYPERLINK("example")', spec: '-规格', unit: '+瓶', qty: 0.001, price: 100, amount: 0.1, remark: ' \t=1+1' }], total: 0.1, operator: '@person' });
  const rows = csvRows(store.ordersCSV()), line = rows[1];
  for (const column of [2, 3, 4, 5, 6, 7, 11, 12]) assert.ok(line[column].startsWith("'"), line[column]);
  assert.equal(line[8], '0.001'); assert.equal(line[9], '100'); assert.equal(line[10], '0.1');
  assert.ok(rows.every(row => row.length === 13));
});

test('customer and product CSV APIs apply the same formula protection', () => {
  const { store } = boot();
  store.upsertCustomer({ name: ' \t=1+1', phone: '+123', remark: '\ttext' });
  store.upsertProduct({ name: '@商品', code: '-CODE', barcode: '00123', price: 0.125, remark: '\rline' });
  const customer = csvRows(store.customersCSV())[1], product = csvRows(store.productsCSV())[1];
  assert.equal(customer[1], "' \t=1+1"); assert.equal(customer[2], "'+123"); assert.equal(customer[5], "'\ttext");
  assert.equal(product[0], "'-CODE"); assert.equal(product[1], '00123'); assert.equal(product[2], "'@商品"); assert.equal(product[5], '0.125');
});

test('CSV quotes bare carriage returns, multiline remarks, quotes, separators and surrounding whitespace', () => {
  const { store } = boot();
  store.upsertProduct({ name: 'A\rB', spec: '500ml', remark: '备注\r\n第二行\n第三行,"引号"', unit: ' 瓶 ' });
  const csv = store.productsCSV(), rows = csvRows(csv);
  assert.ok(csv.includes('"A\rB"')); assert.equal(rows.length, 2); assert.equal(rows[1].length, 8);
  assert.equal(rows[1][2], 'A\rB'); assert.equal(rows[1][4], ' 瓶 '); assert.equal(rows[1][7], '备注\r\n第二行\n第三行,"引号"');
});

test('XLSX encodes controls and isolated surrogates and preserves emoji and literal escape patterns', () => {
  const { xlsx } = boot();
  const value = 'A\u0000B\u000bC\rD\u001fE\ufffeF\uffffG\ud800H\udc00I😀 _x000B_ _x005F_ & < >';
  const xml = entry(xlsx.build([{ name: '资料', headers: ['名称'], rows: [[value]] }]), 'xl/worksheets/sheet1.xml');
  assert.doesNotMatch(xml, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/);
  assert.ok(xml.includes('_x005F_x000B_')); assert.ok(xml.includes('_xD800_')); assert.ok(xml.includes('😀'));
  const cell = /<c r="A2"[^>]*><is><t[^>]*>([\s\S]*?)<\/t><\/is><\/c>/.exec(xml);
  assert.equal(decodeCell(cell[1]), value);
});

test('XLSX adds merged note rows below totals and retains long and multiline notes', () => {
  const { xlsx } = boot(), note = '结算说明'.repeat(50) + '\n次月5号前付款\n\n保留空行';
  const xml = entry(xlsx.build([{ name: '账单', headers: ['项目', '金额'], rows: [['商品', 1]], widths: [20, 20], footer: ['合计', 1], note }]), 'xl/worksheets/sheet1.xml');
  const cells = [...xml.matchAll(/<c r="A(\d+)" s="5"[^>]*><is><t[^>]*>([\s\S]*?)<\/t><\/is><\/c>/g)];
  assert.ok(cells.length > 4); assert.equal(cells[0][1], '4');
  assert.equal(cells.map(cell => decodeCell(cell[2])).join(''), note.replace(/\n/g, ''));
  assert.ok(xml.includes('<mergeCell ref="A4:B4"/>'));
  assert.ok(xml.includes('<c r="B3" s="3"><v>1</v></c>'));
});

function backendClock(fsModule = fs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-p2-history-')); let now = Date.UTC(2026, 10, 12, 12);
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const context = vm.createContext({ require: name => name === 'fs' ? fsModule : require(name), module: { exports: {} }, Date: Clock, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/data-store.js'), 'utf8'), context);
  const create = (name = 'data') => context.module.exports.createDataStore({ dataDir: path.join(root, name), backupDir: path.join(root, 'backup') });
  return { root, create, advance: ms => now += ms };
}
const dated = store => store.listBackups().filter(file => /^data-\d{8}-\d{6}\.json$/.test(path.basename(file)));

test('daily snapshots do not multiply on repeated saves or application restarts', () => {
  const clock = backendClock(), store = clock.create(); store.load();
  assert.equal(dated(store).length, 0);
  for (let i = 0; i < 12; i++) { clock.advance(1000); store.set('sd_v1_orders', JSON.stringify([i])); assert.equal(store.flushBackup(), true); }
  assert.equal(dated(store).length, 1); store.close();
  const reopened = clock.create(); reopened.load(); assert.equal(dated(reopened).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(clock.root, 'backup/data-latest.json'))).data.sd_v1_orders, '[11]'); reopened.close();
});

test('rotation retains ten dated snapshots plus latest and never deletes an unrelated file', () => {
  const clock = backendClock(), store = clock.create(); store.load();
  const unrelated = path.join(clock.root, 'backup/data-not-a-snapshot.json'); fs.writeFileSync(unrelated, 'retain');
  for (let day = 0; day < 13; day++) { if (day) clock.advance(86400000); store.set('sd_v1_orders', JSON.stringify([day])); assert.equal(store.flushBackup(), true); }
  const snapshots = dated(store); assert.equal(snapshots.length, 10); assert.equal(store.listBackups().length, 11);
  assert.equal(new Set(snapshots.map(file => path.basename(file).slice(5, 13))).size, 10);
  assert.equal(JSON.parse(fs.readFileSync(snapshots[0])).data.sd_v1_orders, '[3]');
  assert.equal(JSON.parse(fs.readFileSync(path.join(clock.root, 'backup/data-latest.json'))).data.sd_v1_orders, '[12]');
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'retain'); store.close();
});

test('historical snapshot write failures are reported and retry after the destination is repaired', () => {
  let fail = true;
  const fileSystem = { ...fs, writeFileSync(file, ...args) {
    if (fail && /^\.data-\d{8}-\d{6}\.json\.tmp$/.test(path.basename(file))) throw new Error('history write blocked');
    return fs.writeFileSync(file, ...args);
  } };
  const clock = backendClock(fileSystem), store = clock.create(); store.load(); store.set('sd_v1_orders', '[]');
  assert.equal(store.flushBackup(), false); assert.match(store.status.backupError, /历史快照.*blocked/); assert.equal(dated(store).length, 0);
  fail = false; clock.advance(1000); assert.equal(store.flushBackup(), true); assert.equal(store.status.backupError, ''); assert.equal(dated(store).length, 1); store.close();
});

test('restore excludes historical files and nested snapshot keys from old polluted latest snapshots', () => {
  const clock = backendClock(), backup = path.join(clock.root, 'backup'); fs.mkdirSync(backup);
  const nested = JSON.stringify({ data: { enormous: 'x'.repeat(10000) } });
  fs.writeFileSync(path.join(backup, 'data-20261112-010101.json'), nested);
  fs.writeFileSync(path.join(backup, 'data-latest.json'), JSON.stringify({ app: 'songhuodan', version: 1, data: {
    sd_v1_orders: '[]', sd_v1_customers: '[]', sd_desktop_ui: '{"scene":false}',
    'data-20261112-010101': nested, 'data-latest': nested, 'window-state': '{"width":1200}',
  } }));
  for (const name of ['new-data-one', 'new-data-two']) {
    const store = clock.create(name); store.load();
    assert.deepEqual(Array.from(store.keys()).sort(), ['sd_desktop_ui', 'sd_v1_customers', 'sd_v1_orders']);
    const snapshot = JSON.parse(fs.readFileSync(path.join(backup, 'data-latest.json')));
    assert.deepEqual(Object.keys(snapshot.data).sort(), ['sd_desktop_ui', 'sd_v1_customers', 'sd_v1_orders']);
    assert.ok(JSON.stringify(snapshot).length < 1000); store.close();
  }
  assert.equal(fs.readFileSync(path.join(backup, 'data-20261112-010101.json'), 'utf8'), nested);
});

test('already-polluted main folders ignore snapshots without removing historical files', () => {
  const clock = backendClock(), data = path.join(clock.root, 'data'); fs.mkdirSync(data);
  const stale = path.join(data, 'data-20261112-010101.json'); fs.writeFileSync(stale, '{"nested":true}');
  fs.writeFileSync(path.join(data, '%64ata-20261112-020202.json'), '{"nested":true}');
  fs.writeFileSync(path.join(data, 'sd_v1_orders.json'), '[]');
  const store = clock.create(); store.load(); assert.deepEqual(Array.from(store.keys()), ['sd_v1_orders']); assert.ok(fs.existsSync(stale)); store.close();
});

test('simultaneous shares and sanitized filename collisions preserve every previous file', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-p2-share-')), directory = path.join(root, 'exports'); fs.mkdirSync(directory);
  const previous = path.join(directory, '送货单_A_B.png'); fs.writeFileSync(previous, 'original'); const handlers = {};
  const electron = { ipcMain: { handle: (key, action) => handlers[key] = action, on() {} }, protocol: { registerSchemesAsPrivileged() {} },
    app: { isPackaged: false, getPath: () => root, requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {} } };
  const context = vm.createContext({ require: name => name === 'electron' ? electron : name.startsWith('.') ? require(path.resolve(ROOT, name)) : require(name), __dirname: ROOT,
    process: { argv: [], on() {}, platform: process.platform, env: { DNS_TEST_SAVE_DIR: directory } }, Buffer, TextDecoder, console, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8'), context);
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => handlers['sd:shareFile']({}, { fileName: i % 2 ? '送货单_A:B.png' : '送货单_A?B.png', mime: 'image/png', base64: Buffer.from('share-' + i).toString('base64') })));
  assert.equal(new Set(results.map(result => result.path)).size, 6);
  for (let i = 0; i < results.length; i++) { assert.equal(results[i].ok, true); assert.equal(fs.readFileSync(results[i].path, 'utf8'), 'share-' + i); }
  assert.equal(fs.readFileSync(previous, 'utf8'), 'original'); assert.equal(fs.readdirSync(directory).length, 7);
});

test('line amounts round half-up from exact decimals, not binary floating point', () => {
  const context = vm.createContext({ window: { addEventListener() {} }, document: { addEventListener() {} }, requestAnimationFrame() {}, Intl });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'webapp/js/util.js'), 'utf8'), context);
  const amount = (q, p) => vm.runInContext(`lineAmount(${JSON.stringify(q)}, ${JSON.stringify(p)})`, context);
  assert.equal(amount('0.1', '0.35'), 0.04);
  assert.equal(amount(1, 1.005), 1.01);
  assert.equal(amount('0.1', '21.15'), 2.12);
  assert.equal(amount(3, 2.5), 7.5);
  assert.equal(amount('232', '2.00'), 464);
  assert.equal(amount(1, 0.004), 0);
  assert.equal(amount(1e-7, 1), 0);
  assert.ok(Number.isNaN(amount('x', 1)));
  for (let q = 1; q <= 60; q++) for (let i = 1; i <= 999; i++) assert.equal(Math.round(amount(q, i / 100) * 100), q * i);
});
