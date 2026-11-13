'use strict';
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const XLSX = require('../webapp/js/vendor/sheetjs-0.20.3.full.min.js');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, '.shots/data-import'); fs.mkdirSync(OUT, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-auto-import-'));
for (const [key, folder] of Object.entries({ DNS_TEST_USER_DATA: 'profile', DNS_TEST_DATA_DIR: 'data', DNS_TEST_BACKUP_DIR: 'backup', DNS_TEST_IMAGE_DIR: 'images', DNS_TEST_SAVE_DIR: 'exports' })) process.env[key] = path.join(temp, folder);
delete process.env.DNS_TEST_PICK_FILE; app.setPath('userData', process.env.DNS_TEST_USER_DATA); app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let chosen = '', pickerDelay = 0, pickCalls = 0, lastOptions;
dialog.showOpenDialog = async (_window, options) => { pickCalls++; lastOptions = options; if (pickerDelay) await pause(pickerDelay); return { canceled: !chosen, filePaths: chosen ? [chosen] : [] }; };
const results = [], errors = [], requests = [];
const timeout = setTimeout(() => { console.error('AUTO_IMPORT_TIMEOUT'); app.exit(1); }, 90000);
app.on('web-contents-created', (_event, contents) => contents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); }));
require(path.join(ROOT, 'main.js'));
const header = ['产品名称', '规格', '单位', '条码', '编号', '零售价', '成本价', '状态', '备注'];
function excel(fileName, sheets, type = 'xlsx', mutate) {
  const book = XLSX.utils.book_new(); for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  if (mutate) mutate(book);
  const file = path.join(temp, fileName); fs.writeFileSync(file, XLSX.write(book, { type: 'buffer', bookType: type, bookSST: true, compression: true })); return file;
}
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 200; i++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(30); }
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async code => { for (let i = 0; i < 300; i++) { try { if (await js(code)) return; } catch (_) {} await pause(20); } throw new Error('Timeout: ' + code); };
  const nav = async hash => { await js('location.hash=' + JSON.stringify(hash)); await pause(100); };
  const check = async (name, action) => { try { await action(); results.push({ name, ok: true }); console.log('PASS ' + name); } catch (error) { results.push({ name, ok: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); } };
  const importFile = async (kind, file) => {
    chosen = file;
    await js(`messages.length=0;document.querySelector('[data-act=imp-${kind}]').click();void 0`);
    await wait(`!document.querySelector('[data-act=imp-${kind}]').disabled`);
  };
  await wait('!!window.DNSDesktop?.ready'); win.setContentSize(1280, 900); win.webContents.setBackgroundThrottling(false);
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (detail, callback) => { requests.push(detail.url); callback({ cancel: true }); });
  await js(`Store.clearAll();Store.importJSON(Store.exportJSON());DNSDesktop.setSceneEnabled(false);window.messages=[];window.importToast=toast;window.toast=(message,...args)=>{messages.push(message);importToast(message,...args);};
    window.workerStats={created:0,terminated:0};const NativeWorker=window.Worker;window.Worker=function(...args){workerStats.created++;const worker=new NativeWorker(...args),terminate=worker.terminate.bind(worker);worker.terminate=()=>{workerStats.terminated++;terminate()};return worker};location.hash='#/settings';void 0`);
  await wait('!!document.querySelector("[data-act=imp-products]")');
  await js('document.querySelector("[data-data-panel=tables]").open=true;void 0');
  const xlsx = excel('products.xlsx', [['说明', [['导入资料']]], ['商品', [['商品资料'], [], header, ['Excel水', '500ml', '瓶', '00123456789', '0001', 0.125, 0, '已下架', '多行\r\n备注']]]], 'xlsx', book => { book.Sheets['商品'].F4.z = '0.00'; });
  const xls = excel('customers.xls', [['客户', [['客户名称', '电话', '联系人', '地址'], ['旧Excel客户', 12345, '张老板', '上海']]]], 'xls', book => { book.Sheets['客户'].B2.z = '00000000'; });
  let expectedProduct, expectedCustomer;
  await check('import rows accept Excel and CSV without any format selector', async () => {
    assert.equal(await js('document.querySelector("[data-act=imp-products]").getAttribute("aria-label")'), '导入商品');
    assert.equal(await js('document.querySelector("[data-act=imp-customers]").getAttribute("aria-label")'), '导入客户');
    assert.equal(await js('document.querySelector("[data-export-kind=products] .settings-row-title").textContent'), '商品资料');
    assert.equal(await js('document.querySelectorAll("[data-act^=imp-] select").length'), 0);
    assert.equal(await js('typeof window.XLSX'), 'undefined');
  });
  await check('real picker and background worker import XLSX with title rows and precise prices', async () => {
    await importFile('products', xlsx);
    assert.ok(await js('messages.some(message=>message.includes("已识别 Excel")&&message.includes("新增 1"))'), await js('messages.join("|")'));
    expectedProduct = await js('Store.listProducts("Excel水",{includeArchived:true})[0]');
    assert.equal(expectedProduct.barcode, '00123456789'); assert.equal(expectedProduct.code, '0001'); assert.equal(expectedProduct.price, 0.125); assert.equal(expectedProduct.cost, 0); assert.equal(expectedProduct.archived, true);
    assert.ok(lastOptions.filters[0].extensions.includes('xlsx') && lastOptions.filters[0].extensions.includes('xls') && lastOptions.filters[0].extensions.includes('csv'));
    assert.equal(await js('typeof window.XLSX'), 'undefined');
  });
  await check('XLS customer import keeps formatted numeric phone zeros', async () => {
    await importFile('customers', xls);
    expectedCustomer = await js('Store.listCustomers("旧Excel客户")[0]');
    assert.equal(expectedCustomer.phone, '00012345'); assert.equal(expectedCustomer.contact, '张老板'); assert.equal(expectedCustomer.address, '上海');
    assert.ok(await js('messages.some(message=>message.includes("已识别 Excel"))'));
  });
  await check('CSV still imports Chinese, string phones and escaped formula text automatically', async () => {
    const file = path.join(temp, 'customers.csv'); fs.writeFileSync(file, '\ufeff客户名称,电话\r\nCSV客户,00123\r\n\'=1+1,\'+86123');
    await importFile('customers', file);
    assert.equal(await js('Store.listCustomers("CSV客户")[0].phone'), '00123'); assert.equal(await js('Store.listCustomers("=1+1")[0].phone'), '+86123');
    assert.ok(await js('messages.some(message=>message.includes("已识别 CSV")&&message.includes("新增 2"))'));
  });
  await check('file contents determine Excel or CSV even when its extension is misleading', async () => {
    const file = path.join(temp, 'actual-excel.csv'); fs.copyFileSync(xlsx, file);
    await importFile('products', file); assert.ok(await js('messages.some(message=>message.includes("已识别 Excel")&&message.includes("跳过重复 1"))'));
    const csv = path.join(temp, 'actual-csv.xlsx'); fs.writeFileSync(csv, '产品名称,单价\n扩展名不同商品,2.5');
    await importFile('products', csv); assert.ok(await js('messages.some(message=>message.includes("已识别 CSV"))')); assert.equal(await js('Store.listProducts("扩展名不同商品")[0].price'), 2.5);
  });
  await check('duplicate files skip existing identities instead of duplicating records', async () => {
    const before = await js('JSON.stringify(Store.countAll())'); await importFile('products', xlsx); await importFile('customers', xls);
    assert.equal(await js('JSON.stringify(Store.countAll())'), before); assert.ok(await js('messages.some(message=>message.includes("新增 0")&&message.includes("跳过重复 1"))'));
  });
  await check('a bad row on a later matching worksheet rolls back the complete file', async () => {
    const file = excel('bad-batch.xlsx', [['好表', [['产品名称', '价格'], ['不该部分保存', 2]]], ['坏表', [['产品名称', '价格'], ['错误商品', 'invalid']]]]);
    const before = await js('JSON.stringify(JSON.parse(Store.exportJSON()).data)');
    await importFile('products', file);
    assert.equal(await js('JSON.stringify(JSON.parse(Store.exportJSON()).data)'), before);
    assert.ok(await js('messages.some(message=>message.includes("坏表")&&message.includes("无效单价"))'));
  });
  await check('wrong module, malformed workbook and empty files fail without modifying data', async () => {
    const corrupt = path.join(temp, 'corrupt.xlsx'), empty = path.join(temp, 'empty.xls'); fs.writeFileSync(corrupt, 'PK corrupted'); fs.writeFileSync(empty, '');
    const before = await js('JSON.stringify(JSON.parse(Store.exportJSON()).data)');
    for (const file of [xls, corrupt, empty]) {
      await importFile('products', file); assert.equal(await js('JSON.stringify(JSON.parse(Store.exportJSON()).data)'), before);
      assert.equal(await js('messages.some(message=>message.includes("新增"))'), false);
      assert.equal(await js('document.querySelector("[data-act=imp-products]").disabled||document.querySelector("[data-act=imp-customers]").disabled'), false);
    }
  });
  await check('cancel is silent and a double click cannot start overlapping imports', async () => {
    await importFile('products', ''); assert.equal(await js('messages.length'), 0);
    chosen = xlsx; pickerDelay = 120; const before = pickCalls;
    await js('const button=document.querySelector("[data-act=imp-products]");button.click();button.click();document.querySelector("[data-act=imp-customers]").click();void 0');
    assert.equal(await js('document.querySelector("[data-act=imp-products]").disabled&&document.querySelector("[data-act=imp-customers]").disabled'), true);
    await wait('!document.querySelector("[data-act=imp-products]").disabled'); assert.equal(pickCalls, before + 1); pickerDelay = 0;
  });
  const exports = process.env.DNS_TEST_SAVE_DIR;
  await check('current exported Excel and CSV files both import directly including title rows and product status', async () => {
    for (const format of ['xlsx', 'csv']) for (const kind of ['products', 'customers']) {
      await js(`(()=>{messages.length=0;const row=document.querySelector('[data-export-kind=${kind}]'),select=row.querySelector('select');if(select)select.value='${format}';else row.querySelector('[data-format=${format}]').click();row.querySelector('[data-act=exp-${kind}]').click()})();void 0`);
      await wait(`!document.querySelector('[data-act=exp-${kind}]').disabled`);
    }
    for (const format of ['xlsx', 'csv']) {
      await js('Store.clearAll();Store.importJSON(Store.exportJSON());void 0');
      await importFile('products', path.join(exports, '商品.' + format));
      await importFile('customers', path.join(exports, '客户.' + format));
      const product = await js('Store.listProducts("Excel水",{includeArchived:true})[0]'), customer = await js('Store.listCustomers("旧Excel客户")[0]');
      assert.equal(product.price, 0.125); assert.equal(product.cost, 0); assert.equal(product.archived, true); assert.equal(product.barcode, expectedProduct.barcode); assert.equal(customer.phone, expectedCustomer.phone);
      assert.equal(await js('Store.listCustomers("=1+1")[0].phone'), '+86123');
    }
  });
  await check('browser file-input fallback also decodes Excel without a native file bridge', async () => {
    const buffer = fs.readFileSync(excel('browser.xlsx', [['客户', [['客户名称', '电话'], ['浏览器回退客户', '00112']]]]));
    await js(`window.nativeDataPicker=Android.pickDataFile;Android.pickDataFile=undefined;window.nativeInputClick=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.type==='file'){const bytes=Uint8Array.from(atob(${JSON.stringify(buffer.toString('base64'))}),c=>c.charCodeAt(0)),transfer=new DataTransfer();transfer.items.add(new File([bytes],'browser.xlsx'));this.files=transfer.files;this.dispatchEvent(new Event('change'));}else return nativeInputClick.call(this)};void 0`);
    try { await importFile('customers', ''); assert.equal(await js('Store.listCustomers("浏览器回退客户")[0].phone'), '00112'); }
    finally { await js('Android.pickDataFile=nativeDataPicker;HTMLInputElement.prototype.click=nativeInputClick;void 0'); }
  });
  await check('workers terminate after both successful and failed imports and runtime stays offline', async () => {
    const workers = await js('workerStats'); assert.ok(workers.created > 10); assert.equal(workers.created, workers.terminated);
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    await js('document.querySelector("#toast").classList.remove("show");document.querySelector("[data-act=imp-products]").scrollIntoView({block:"center",behavior:"instant"});void 0');
    await pause(200); fs.writeFileSync(path.join(OUT, 'auto-import.png'), (await win.webContents.capturePage()).toPNG());
  });
  await check('successful records persist after reload and corrupt storage blocks imports', async () => {
    await js('Store.importJSON(Store.exportJSON());void 0'); win.reload(); await pause(250); await wait('!!window.DNSDesktop?.ready');
    assert.equal(await js('Store.listProducts("Excel水",{includeArchived:true})[0].price'), 0.125);
    assert.equal(await js('Store.listCustomers("旧Excel客户")[0].phone'), '00012345');
    await js('window.__DNSStorage.setItem("sd_v1_orders","[{broken");void 0'); win.reload(); await pause(250); await wait('!!window.DNSDesktop?.ready'); await nav('#/settings');
    const before = pickCalls; await js('document.querySelector("[data-act=imp-products]").click();document.querySelector("[data-act=imp-customers]").click();void 0');
    assert.equal(pickCalls, before);
  });
  fs.writeFileSync(path.join(OUT, 'verification.json'), JSON.stringify({ results, errors, requests, temp }, null, 2));
  clearTimeout(timeout); app.exit(results.every(result => result.ok) ? 0 : 1);
}).catch(error => { console.error(error); console.error(JSON.stringify(errors)); clearTimeout(timeout); app.exit(1); });
