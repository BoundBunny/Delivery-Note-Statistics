'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { create, KEY } = require('../webapp/js/scan-session.js');
function fixture(initial = {}) {
  const values = new Map(Object.entries(initial));
  const storage = { fail: null, getItem: key => values.get(key) ?? null, setItem(key, value) { if (this.fail?.(key, value)) throw new Error('disk full'); values.set(key, String(value)); }, removeItem: key => values.delete(key) };
  const Views = {};
  const context = vm.createContext({ Intl, Views, localStorage: storage, window: { Views, addEventListener() {} }, document: { addEventListener() {} }, requestAnimationFrame() {} });
  for (const file of ['util.js', 'store.js', 'views/order.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../webapp/js', file), 'utf8'), context);
  context.toast = () => {};
  const store = vm.runInContext('Store', context), plan = vm.runInContext('planOrderItemAddition', context);
  const water = store.upsertProduct({ name: '测试水', barcode: '0012345678901', unit: '瓶', spec: '500ml', price: 2 });
  const customer = store.upsertCustomer({ name: '测试客户' });
  let clock = Date.UTC(2026, 10, 13), nextId = 0;
  const options = { storage, store, plan, now: () => clock, today: () => '2026-11-13', id: () => 'scan-' + (++nextId), operator: () => '测试制单人' };
  const session = create(options);
  return { storage, values, store, water, customer, session, restore: () => create(options), advance: milliseconds => { clock += milliseconds; } };
}
test('three transmissions merge to three units, retain leading zeroes, and remain outside formal orders', () => {
  const f = fixture(); for (let i = 0; i < 3; i++) f.session.scan(f.water.barcode);
  assert.equal(f.session.state.draft.items.length, 1); assert.equal(f.session.state.draft.items[0].qty, '3');
  assert.equal(f.session.state.draft.items[0].amount, 6); assert.equal(f.session.state.draft.items[0].barcode, '0012345678901');
  assert.equal(f.store.listOrders().length, 0); assert.equal(f.restore().state.draft.items[0].qty, '3');
});
test('the 60 second deadline resets only through deliberate order activity and pauses for editing', () => {
  const f = fixture(); f.session.scan(f.water.barcode); f.advance(59999); assert.equal(f.session.tick(), false);
  f.session.activity(); f.advance(59999); assert.equal(f.session.tick(), false); f.advance(1);
  assert.equal(f.session.tick(true), false); assert.equal(f.session.tick(), true); assert.equal(f.session.state.phase, 'confirm');
  assert.equal(f.store.listOrders().length, 0);
});
test('confirmations retain every new scan until the operator explicitly merges them', () => {
  const f = fixture(); f.session.scan(f.water.barcode); f.session.confirm();
  for (let i = 0; i < 3; i++) f.session.scan(f.water.barcode);
  assert.equal(f.session.state.draft.items[0].qty, '1'); assert.equal(f.session.state.queued.length, 3);
  assert.equal(f.restore().state.queued.length, 3); f.session.resume(true);
  assert.equal(f.session.state.draft.items[0].qty, '4'); assert.equal(f.session.state.queued.length, 0);
});
test('saving the previous order moves queued scans to a fresh draft with no inherited customer', () => {
  const f = fixture(); f.session.scan(f.water.barcode); f.session.setCustomer(f.customer); f.session.confirm(); f.session.scan(f.water.barcode);
  const saved = f.session.save(true);
  assert.equal(saved.items[0].qty, 1); assert.equal(f.store.listOrders().length, 1);
  assert.notEqual(f.session.state.draft.id, saved.id); assert.equal(f.session.state.draft.customer, null);
  assert.equal(f.session.state.draft.items[0].qty, '1'); assert.equal(f.session.state.phase, 'scanning');
});
test('customer and queue decisions are required; explicit walk-in is supported', () => {
  const f = fixture(); f.session.scan(f.water.barcode); assert.throws(() => f.session.save(), /选择客户/);
  f.session.setCustomer(null, true); f.session.confirm(); f.session.scan(f.water.barcode);
  assert.throws(() => f.session.save(), /决定暂存/); f.session.resume(); const saved = f.session.save();
  assert.equal(saved.customer, null); assert.equal(saved.items[0].qty, 2);
});
test('missing price, unknown barcode, and archived products remain actionable and block submission', () => {
  const f = fixture(); f.store.upsertProduct({ name: '缺价商品', barcode: '00000008' });
  const archived = f.store.upsertProduct({ name: '下架商品', barcode: '00000009', price: 3, archived: true });
  f.session.scan('00000007'); f.session.scan('00000008'); f.session.scan(archived.barcode); f.session.setCustomer(f.customer);
  assert.equal(f.session.state.draft.issues.length, 3); assert.throws(() => f.session.save(), /待处理扫码/);
  const unknown = f.session.state.draft.issues[0]; f.session.resolve(unknown.id, { name: '新商品', price: '0', unit: '件' });
  assert.equal(f.session.state.draft.items[0].price, '0');
  const archivedIssue = f.session.state.draft.issues.find(record => record.code === archived.barcode);
  assert.throws(() => f.session.resolve(archivedIssue.id, { pid: archived.id, price: '3' }), /恢复上架/);
  f.session.resolve(archivedIssue.id, { pid: archived.id, price: '3', restore: true }); assert.equal(f.store.getProduct(archived.id).archived, false);
});
test('binding an unknown barcode only updates the selected product and preserves zero prefixes', () => {
  const f = fixture(), product = f.store.upsertProduct({ name: '待绑定', spec: '10g', unit: '包', price: 5 });
  f.session.scan('0000001234567'); f.session.resolve(f.session.state.draft.issues[0].id, { pid: product.id, price: '5' });
  assert.equal(f.store.getProduct(product.id).barcode, '0000001234567'); assert.equal(f.session.state.draft.items[0].pid, product.id);
});
test('product updates reject barcode collisions including archived products', () => {
  const f = fixture(); assert.throws(() => f.store.assertProductBarcode({ name: '冲突', barcode: f.water.barcode }), /条码已被/);
  f.store.upsertProduct({ id: f.water.id, name: f.water.name, archived: true });
  assert.throws(() => f.store.assertProductBarcode({ name: '另一个', barcode: f.water.barcode }), /条码已被/);
  assert.doesNotThrow(() => f.store.assertProductBarcode({ id: f.water.id, name: f.water.name, barcode: f.water.barcode }));
});
test('customer pricing changes untouched rows while manual prices survive and apply on later scans', () => {
  const f = fixture(); f.store.setLastPrice(f.customer.id, f.water.id, 1.5); f.session.scan(f.water.barcode);
  f.session.setCustomer(f.customer); assert.equal(f.session.state.draft.items[0].price, '1.5');
  f.session.edit(f.session.state.draft.items[0].lineId, 'price', '1.25'); f.session.setCustomer(null, true); f.session.scan(f.water.barcode);
  assert.equal(f.session.state.draft.items.length, 1); assert.equal(f.session.state.draft.items[0].price, '1.25'); assert.equal(f.session.state.draft.items[0].qty, '2');
});
test('undo removes exactly the last accepted scan and never rolls back subsequent manual edits', () => {
  const f = fixture(); f.session.scan(f.water.barcode); f.session.scan(f.water.barcode); f.session.undo();
  assert.equal(f.session.state.draft.items[0].qty, '1'); f.session.edit(f.session.state.draft.items[0].lineId, 'qty', '9');
  assert.equal(f.session.canUndo, false); f.session.undo(); assert.equal(f.session.state.draft.items[0].qty, '9');
});
test('a failed draft write retains the received barcode in memory and can be retried without rescan', () => {
  const f = fixture(); f.storage.fail = key => key === KEY; assert.throws(() => f.session.scan(f.water.barcode), /草稿写入失败/);
  assert.equal(f.session.state.draft.items[0].qty, '1'); assert.ok(f.session.error);
  f.storage.fail = null; f.session.retry(); assert.equal(f.session.error, ''); assert.equal(f.restore().state.draft.items[0].qty, '1');
});
test('formal save failure keeps current order, queued scans and stable draft id for retry', () => {
  const f = fixture(); f.session.scan(f.water.barcode); f.session.setCustomer(f.customer); f.session.confirm(); f.session.scan(f.water.barcode);
  const draftId = f.session.state.draft.id;
  f.storage.fail = key => key === 'sd_v1_orders'; assert.throws(() => f.session.save(true), /保存失败/);
  assert.equal(f.session.state.draft.id, draftId); assert.equal(f.session.state.queued.length, 1); assert.equal(f.store.listOrders().length, 0);
  f.storage.fail = null; assert.equal(f.session.save(true).id, draftId); assert.equal(f.store.listOrders().length, 1);
});
test('a crash after order commit but before clearing journal reconciles to exactly one order', () => {
  const f = fixture(); f.session.scan(f.water.barcode); f.session.setCustomer(f.customer); f.session.confirm(); f.session.scan(f.water.barcode);
  const originalSet = f.storage.setItem;
  f.storage.setItem = function (key, value) { if (key === KEY && f.store.listOrders().length) throw new Error('crash after commit'); return originalSet.call(this, key, value); };
  assert.throws(() => f.session.save(true), /单据已保存/); assert.equal(f.store.listOrders().length, 1);
  f.storage.setItem = originalSet; const restored = f.restore();
  assert.equal(f.store.listOrders().length, 1); assert.equal(restored.state.draft.items[0].qty, '1'); assert.equal(restored.state.draft.customer, null);
});
test('damaged journals are preserved verbatim and cannot be overwritten by new scans', () => {
  const f = fixture(); f.values.set(KEY, '{broken'); const restored = f.restore();
  assert.equal(restored.damaged, true); assert.throws(() => restored.scan(f.water.barcode), /无法读取/); assert.equal(f.values.get(KEY), '{broken');
});
test('invalid edits never change valid persisted quantities and zero prices remain valid', () => {
  const f = fixture(); f.session.scan(f.water.barcode); const line = f.session.state.draft.items[0];
  for (const qty of ['', '0', '-1', 'Infinity']) assert.throws(() => f.session.edit(line.lineId, 'qty', qty), /数量须/);
  assert.equal(line.qty, '1'); f.session.edit(line.lineId, 'price', '0'); assert.equal(f.restore().state.draft.items[0].amount, 0);
});
test('switching away from a customer price requires an explicit replacement when the catalog has no price', () => {
  const f = fixture(); f.store.upsertProduct({ id: f.water.id, name: f.water.name, price: null });
  f.store.setLastPrice(f.customer.id, f.water.id, 3); f.session.scan('99999999'); f.session.setCustomer(f.customer);
  f.session.removeIssue(f.session.state.draft.issues[0].id); f.session.scan(f.water.barcode);
  f.session.setCustomer(null, true); assert.equal(f.session.state.draft.items[0].needsPrice, true);
  assert.throws(() => f.session.save(), /逐项确认/);
  const item = f.session.state.draft.items[0]; f.session.edit(item.lineId, 'price', '2.5'); assert.equal(f.session.save().items[0].price, 2.5);
});
test('failed discards retain the current draft both in memory and on disk', () => {
  const f = fixture(); f.session.scan(f.water.barcode); const before = JSON.stringify(f.session.state.draft);
  f.storage.fail = key => key === KEY; assert.throws(() => f.session.discard(), /写入失败/);
  assert.equal(JSON.stringify(f.session.state.draft), before); assert.equal(JSON.stringify(f.restore().state.draft), before);
});
test('scans assigned from the confirmation queue can be undone one transmission at a time', () => {
  const f = fixture(); f.session.scan(f.water.barcode); f.session.confirm(); f.session.scan(f.water.barcode); f.session.scan(f.water.barcode); f.session.resume();
  assert.equal(f.session.state.draft.items[0].qty, '3'); f.session.undo(); assert.equal(f.session.state.draft.items[0].qty, '2');
  f.session.undo(); assert.equal(f.session.state.draft.items[0].qty, '1');
});
