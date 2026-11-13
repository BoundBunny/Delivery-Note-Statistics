'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
function planner() {
  const Views = {};
  const context = vm.createContext({ Intl, Views, window: { Views, addEventListener() {} }, document: { addEventListener() {} }, requestAnimationFrame() {} });
  for (const file of ['util.js', 'views/order.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'webapp/js', file), 'utf8'), context);
  return vm.runInContext('planOrderItemAddition', context);
}
const item = (patch = {}) => ({ pid: 'p1', name: '怡宝饮用纯净水', spec: '555ml', unit: '瓶', qty: '232', price: '2.00', amount: 464, remark: '', ...patch });
const added = (patch = {}) => item({ qty: '22', price: '2', amount: 44, ...patch });

test('selected identical product adds quantities and recomputes the merged line without mutating input', () => {
  const plan = planner(), rows = [item()], incoming = added(), before = JSON.stringify({ rows, incoming });
  const result = plan(rows, incoming, () => { throw new Error('Selected IDs need no catalog lookup'); });
  assert.deepEqual(Array.from(result.indices), [0]); assert.equal(result.index, 0);
  assert.equal(result.item.qty, '254'); assert.equal(result.item.amount, 508); assert.equal(result.item.price, '2.00');
  assert.equal(JSON.stringify({ rows, incoming }), before);
});

test('same names and pictures with different selected product IDs remain independent', () => {
  const result = planner()([item()], added({ pid: 'p2' }));
  assert.equal(result.indices.length, 0); assert.equal(result.item.pid, 'p2'); assert.equal(result.item.qty, '22');
});

test('different specifications, units, prices or remarks do not merge', () => {
  const plan = planner();
  for (const patch of [{ spec: '1.55L' }, { unit: '箱' }, { price: '2.01' }, { remark: '单独送货' }]) {
    const result = plan([item()], added(patch)); assert.equal(result.indices.length, 0, JSON.stringify(patch));
  }
});

test('numeric price equivalence and surrounding field whitespace are handled consistently', () => {
  const result = planner()([item({ remark: ' 备注 ', spec: ' 555ml ' })], added({ price: '2.000', remark: '备注', spec: '555ml' }));
  assert.equal(result.indices.length, 1); assert.equal(result.item.amount, 508);
});

test('an authoritative product ID can match a renamed catalog label without rewriting the earlier snapshot name', () => {
  const result = planner()([item({ name: '旧名称' })], added({ name: '新名称' }));
  assert.equal(result.indices.length, 1); assert.equal(result.item.name, '旧名称'); assert.equal(result.item.qty, '254');
});

test('unambiguous manual entries resolve to the selected product without creating records', () => {
  let reads = 0;
  const result = planner()([item()], added({ pid: null }), incoming => { reads++; return [{ id: 'p1', name: incoming.name, spec: incoming.spec, unit: incoming.unit }]; });
  assert.equal(reads, 1); assert.equal(result.indices.length, 1); assert.equal(result.item.pid, 'p1');
});

test('pending manual entries merge only on exact names, specifications and units when no catalog ambiguity exists', () => {
  const plan = planner();
  const result = plan([item({ pid: null })], added({ pid: null }), () => []);
  assert.equal(result.indices.length, 1); assert.equal(result.item.pid, null); assert.equal(result.item.qty, '254');
  assert.equal(plan([item({ pid: null, name: '另一商品' })], added({ pid: null }), () => []).indices.length, 0);
});

test('ambiguous manually typed identities never collapse distinct catalog products or manual rows', () => {
  const plan = planner(), lookup = incoming => ['p1', 'p2'].map(id => ({ id, name: incoming.name, spec: incoming.spec, unit: incoming.unit }));
  assert.equal(plan([item({ pid: null })], added({ pid: null }), lookup).indices.length, 0);
  assert.equal(plan([item({ pid: null })], added(), lookup).indices.length, 0);
  assert.equal(plan([item()], added({ pid: null }), lookup).indices.length, 0);
});

test('an explicitly selected product can absorb a uniquely identifiable pending manual row', () => {
  const result = planner()([item({ pid: null })], added(), incoming => [{ id: 'p1', name: incoming.name, spec: incoming.spec, unit: incoming.unit }]);
  assert.equal(result.item.pid, 'p1'); assert.equal(result.item.qty, '254');
});

test('an addition consolidates all compatible draft duplicates while retaining unrelated rows', () => {
  const rows = [item({ qty: '2', amount: 4 }), item({ pid: 'p2' }), item({ qty: '3', amount: 6 }), item({ remark: '单独送货' })];
  const result = planner()(rows, added({ qty: '4', amount: 8 }));
  assert.deepEqual(Array.from(result.indices), [0, 2]); assert.equal(result.index, 0); assert.equal(result.item.qty, '9'); assert.equal(result.item.amount, 18);
  assert.equal(rows.length, 4);
});

test('decimal quantities add exactly and merged amount is rounded once from merged quantity times price', () => {
  const plan = planner();
  const fractional = plan([item({ qty: '0.1', amount: 0.2 })], added({ qty: '0.2', amount: 0.4 }));
  assert.equal(fractional.item.qty, '0.3'); assert.equal(fractional.item.amount, 0.6);
  const rounding = plan([item({ qty: '1', price: '0.125', amount: 0.13 })], added({ qty: '1', price: '0.125', amount: 0.13 }));
  assert.equal(rounding.item.qty, '2'); assert.equal(rounding.item.amount, 0.25);
});

test('zero-priced products can merge and stale incoming display amounts are recalculated', () => {
  const plan = planner();
  assert.equal(plan([item({ price: '', amount: 0 })], added({ price: '0', amount: 0 })).item.amount, 0);
  assert.equal(plan([], added({ amount: 999 })).item.amount, 44);
});

test('invalid new quantities and prices are rejected before any mutation', () => {
  const plan = planner(), rows = [item()], before = JSON.stringify(rows);
  for (const patch of [{ name: '' }, { qty: '' }, { qty: '0' }, { qty: '-1' }, { qty: 'bad' }, { qty: 'Infinity' }, { price: '-1' }, { price: 'bad' }]) assert.throws(() => plan(rows, added(patch)));
  assert.equal(JSON.stringify(rows), before);
});

test('merged monetary overflow and precision-losing quantities are rejected with the existing draft preserved', () => {
  const plan = planner();
  for (const [row, incoming] of [
    [item({ qty: '40000000000000', price: '2', amount: 80000000000000 }), added({ qty: '40000000000000', price: '2', amount: 80000000000000 })],
    [item({ qty: '1e20', price: '0', amount: 0 }), added({ qty: '1', price: '0', amount: 0 })],
    [item({ qty: '1', price: '0', amount: 0 }), added({ qty: '1e-30', price: '0', amount: 0 })],
    [item({ qty: '1e308', price: '0', amount: 0 }), added({ qty: '1e308', price: '0', amount: 0 })],
  ]) {
    const rows = [row], before = JSON.stringify(rows); assert.throws(() => plan(rows, incoming), /超出可计算范围/); assert.equal(JSON.stringify(rows), before);
  }
});

test('known-ID additions scan only the current draft and never request catalog or historical data', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => item({ pid: 'p' + i, qty: '1', amount: 2 }));
  const result = planner()(rows, added({ pid: 'p999' }), () => { throw new Error('Unexpected catalog scan'); });
  assert.deepEqual(Array.from(result.indices), [999]); assert.equal(result.item.qty, '23'); assert.equal(rows.length, 1000);
});
