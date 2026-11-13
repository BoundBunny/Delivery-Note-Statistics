'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const XLSX = require('../webapp/js/vendor/sheetjs-0.20.3.full.min.js');
const reader = require('../webapp/js/table-import.js');
const JS = path.resolve(__dirname, '../webapp/js');
function store() {
  const values = new Map();
  const storage = { fail: false, getItem: key => values.get(key) ?? null,
    setItem(key, value) { if (this.fail) throw new Error('Storage unavailable'); values.set(key, String(value)); }, removeItem: key => values.delete(key) };
  const context = vm.createContext({ localStorage: storage, TextDecoder, TextEncoder, Intl,
    window: { pinyinPro: { pinyin: value => value }, addEventListener() {} }, document: { addEventListener() {} }, requestAnimationFrame() {} });
  for (const file of ['util.js', 'store.js']) vm.runInContext(fs.readFileSync(path.join(JS, file), 'utf8'), context);
  context.toast = () => {};
  return { api: vm.runInContext('Store', context), values, storage, context };
}
function workbook(tables, bookType = 'xlsx', mutate) {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of tables) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  if (mutate) mutate(book);
  return XLSX.write(book, { type: 'buffer', bookType, compression: true, bookSST: true });
}
const products = [['产品名称', '规格', '单位', '条码', '编号', '零售价', '成本价', '状态', '备注'], ['测试水', '500ml', '瓶', '0012345', '0001', 0.125, 0, '已下架', '第一行\r\n第二行']];
const customers = [['客户名称', '电话', '联系人', '地址', '备注'], ['客户甲', '0012345', '张老板', '中国上海', '资料备注']];

for (const type of ['xlsx', 'xls']) test(type + ' autodetection imports native strings, raw numeric prices, zero costs and archived state', () => {
  const data = reader.read(workbook([['说明', [['导入说明']]], ['商品', [['商品资料'], [], ...products]]], type, book => { book.Sheets['商品'].F4.z = '0.00'; }), 'products');
  assert.equal(data.format, 'Excel'); assert.equal(data.sheets[0].name, '商品');
  const target = store(), result = target.api.importTables('products', data.sheets);
  assert.equal(result.added, 1); const product = target.api.listProducts('', { includeArchived: true })[0];
  assert.equal(product.barcode, '0012345'); assert.equal(product.code, '0001'); assert.equal(product.price, 0.125); assert.equal(product.cost, 0); assert.equal(product.archived, true);
  assert.equal(product.remark.replace(/\r\n/g, '\n'), '第一行\n第二行');
});

test('XLS and XLSX customer imports preserve formatted numeric phone leading zeros', () => {
  for (const type of ['xls', 'xlsx']) {
    const data = workbook([['客户', [...customers.slice(0, 1), ['客户乙', 12345, '王老板', '北京', '']]]], type, book => { book.Sheets['客户'].B2.z = '00000000'; });
    const target = store(); target.api.importTables('customers', reader.read(data, 'customers').sheets);
    assert.equal(target.api.listCustomers()[0].phone, '00012345');
  }
});

test('general-format numeric barcodes use exact stored numbers rather than shortened scientific display', () => {
  for (const type of ['xls', 'xlsx']) {
    const data = workbook([['商品', [['产品名称', '条码', '价格'], ['数字条码商品', 6901285991219, 2]]]], type);
    const target = store(); target.api.importTables('products', reader.read(data, 'products').sheets);
    assert.equal(target.api.listProducts()[0].barcode, '6901285991219');
  }
  const unsafe = workbook([['商品', [['产品名称', '条码'], ['不精确条码', 1234567890123456789]]]]);
  assert.throws(() => reader.read(unsafe, 'products'), /精确数字范围/);
});

test('one workbook automatically finds matching sheets and imports them as one transaction', () => {
  const data = reader.read(workbook([['说明', [['请选择商品页']]], ['商品一', products], ['客户', customers], ['商品二', [['名称', '价格'], ['第二商品', 2]]]]), 'products');
  assert.equal(data.sheets.length, 2); const target = store(), before = target.api.revision;
  const result = target.api.importTables('products', data.sheets);
  assert.equal(result.added, 2); assert.equal(target.api.listProducts('', { includeArchived: true }).length, 2); assert.equal(target.api.revision, before + 1);
  const again = target.api.importTables('products', data.sheets); assert.equal(again.added, 0); assert.equal(again.skipped, 2);
});

test('hidden historical sheets are not silently imported', () => {
  const data = workbook([['在用', products], ['旧记录', [['产品名称'], ['不该导入']]]], 'xlsx', book => { book.Workbook = { Sheets: [{ name: '在用', Hidden: 0 }, { name: '旧记录', Hidden: 1 }] }; });
  const result = reader.read(data, 'products'); assert.deepEqual(result.sheets.map(sheet => sheet.name), ['在用']);
});

test('an invalid later sheet cancels all earlier rows and leaves storage unchanged', () => {
  const data = reader.read(workbook([['有效', products], ['错误', [['产品名称', '价格'], ['坏价格', -2]]]]), 'products');
  const target = store(); target.api.upsertProduct({ name: '已有商品', price: 1 });
  const disk = JSON.stringify([...target.values]), before = target.api.exportJSON();
  assert.throws(() => target.api.importTables('products', data.sheets), /错误.*无效单价/);
  assert.equal(JSON.stringify([...target.values]), disk); assert.deepEqual(JSON.parse(target.api.exportJSON()).data, JSON.parse(before).data);
});

test('write failure after parsing rolls the complete batch back', () => {
  const target = store(), disk = JSON.stringify([...target.values]); target.storage.fail = true;
  assert.throws(() => target.api.importTables('products', reader.read(workbook([['商品', products]]), 'products').sheets), /保存|存储/);
  assert.equal(target.api.countAll().products, 0); assert.equal(JSON.stringify([...target.values]), disk);
});

test('current app XLSX title rows and inline strings import without conversion', () => {
  const target = store(); vm.runInContext(fs.readFileSync(path.join(JS, 'xlsx.js'), 'utf8'), target.context);
  const bytes = target.context.window.Xlsx.build([{ name: '客户', title: '客户资料', headers: customers[0], rows: customers.slice(1) }]);
  const result = reader.read(bytes, 'customers'); target.api.importTables('customers', result.sheets);
  assert.equal(target.api.listCustomers()[0].name, '客户甲'); assert.equal(target.api.listCustomers()[0].phone, '0012345');
});

test('CSV, semicolon and tab separated data are detected without choosing a format', () => {
  for (const separator of [',', ';', '\t']) {
    const bytes = Buffer.from('\ufeff客户资料\r\n\r\n客户名称' + separator + '电话\r\n客户甲' + separator + '0012345');
    const result = reader.read(bytes, 'customers'); assert.equal(result.format, 'CSV');
    const target = store(); target.api.importTables('customers', result.sheets); assert.equal(target.api.listCustomers()[0].phone, '0012345');
  }
});

test('quoted CSV separators and multiline remarks survive automatic decoding', () => {
  const result = reader.read(Buffer.from('产品名称,规格,备注\r\n"品名,带逗号",500ml,"第一行\r\n第二行"'), 'products');
  assert.equal(result.sheets[0].rows[1][0], '品名,带逗号'); assert.equal(result.sheets[0].rows[1][2], '第一行\r\n第二行');
});

test('UTF-16 CSV and GB18030 CSV continue importing Chinese text', () => {
  const text = '客户名称,电话\r\n客户甲,00123';
  assert.equal(reader.read(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]), 'customers').sheets[0].rows[1][0], '客户甲');
  const gb = Buffer.concat([Buffer.from([0xbf, 0xcd, 0xbb, 0xa7, 0xc3, 0xfb, 0xb3, 0xc6]), Buffer.from(',phone\n'), Buffer.from([0xbf, 0xcd, 0xbb, 0xa7]), Buffer.from(',00123')]);
  assert.equal(reader.read(gb, 'customers').sheets[0].rows[1][0], '客户');
});

test('app CSV formula-protection prefixes are removed as text, without executing formulas', () => {
  const target = store(); target.api.upsertCustomer({ name: '=1+1', phone: '+86123' });
  const csv = target.api.tableCSV(['客户名称', '电话'], [['=1+1', '+86123']]);
  const restored = store(); restored.api.importTables('customers', reader.read(Buffer.from(csv), 'customers').sheets);
  assert.equal(restored.api.listCustomers()[0].name, '=1+1'); assert.equal(restored.api.listCustomers()[0].phone, '+86123');
});

test('cached formula prices use saved numeric results and missing results are rejected', () => {
  const cached = workbook([['商品', [['产品名称', '价格'], ['公式商品', 2]]]], 'xlsx', book => { book.Sheets['商品'].B2 = { t: 'n', v: 2, f: '1+1', z: '0.00' }; });
  const target = store(); target.api.importTables('products', reader.read(cached, 'products').sheets); assert.equal(target.api.listProducts()[0].price, 2);
  const missing = workbook([['商品', [['产品名称', '价格'], ['缺少结果', '']]]], 'xlsx', book => { book.Sheets['商品'].B2 = { t: 'n', f: '1+1' }; });
  assert.throws(() => reader.read(missing, 'products'), /未计算|错误/);
});

test('Excel error cells, malformed CSV and invalid archive inputs fail before data changes', () => {
  const error = workbook([['商品', [['产品名称', '价格'], ['错误商品', 1]]]], 'xlsx', book => { book.Sheets['商品'].B2 = { t: 'e', v: 7 }; });
  assert.throws(() => reader.read(error, 'products'), /错误/);
  for (const text of ['产品名称,价格\n"引号未闭合,2', '产品名称,价格\n商品,2,extra', '{"app":"songhuodan"}', '客户名称,电话\n客户甲,123']) assert.throws(() => reader.read(Buffer.from(text), 'products'));
  assert.throws(() => reader.read(Buffer.from('PK broken'), 'products'));
  assert.throws(() => reader.read(new Uint8Array(), 'products'), /非空/);
});

test('wrong module, empty worksheets and oversized column layouts are rejected', () => {
  assert.throws(() => reader.read(workbook([['客户', customers]]), 'products'), /产品名称/);
  assert.throws(() => reader.read(workbook([['空表', [['说明']]]]), 'customers'), /客户名称/);
  const wide = workbook([['客户', customers]], 'xlsx', book => { book.Sheets['客户']['!ref'] = 'A1:ZZ2'; });
  assert.throws(() => reader.read(wide, 'customers'), /列数/);
});
