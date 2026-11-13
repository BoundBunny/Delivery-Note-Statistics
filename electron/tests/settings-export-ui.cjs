'use strict';
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, '.shots/settings-export'); fs.mkdirSync(OUT, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-settings-export-'));
for (const [key, folder] of Object.entries({ DNS_TEST_USER_DATA: 'profile', DNS_TEST_DATA_DIR: 'data', DNS_TEST_BACKUP_DIR: 'backup', DNS_TEST_IMAGE_DIR: 'images' })) process.env[key] = path.join(temp, folder);
delete process.env.DNS_TEST_SAVE_DIR;
app.setPath('userData', process.env.DNS_TEST_USER_DATA); app.disableHardwareAcceleration();
let savePath = '', canceled = false, saveDelay = 0, saveCalls = 0, openCalls = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)), results = [], errors = [];
dialog.showSaveDialog = async (_window, options) => { saveCalls++; if (saveDelay) await pause(saveDelay); return { canceled, filePath: savePath || path.join(temp, path.basename(options.defaultPath)) }; };
dialog.showOpenDialog = async () => { openCalls++; return { canceled: true, filePaths: [] }; };
const timeout = setTimeout(() => { console.error('SETTINGS_EXPORT_TIMEOUT'); app.exit(1); }, 60000);
app.on('web-contents-created', (_event, contents) => contents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); }));
require(path.join(ROOT, 'main.js'));
function sheet(file) {
  const buffer = fs.readFileSync(file); let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18), length = buffer.readUInt16LE(offset + 26), start = offset + 30 + length + buffer.readUInt16LE(offset + 28);
    if (buffer.subarray(offset + 30, offset + 30 + length).toString() === 'xl/worksheets/sheet1.xml') return buffer.subarray(start, start + size).toString();
    offset = start + size;
  }
  throw new Error('Missing worksheet');
}
function parseCSV(text) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && char === ',') { row.push(value); value = ''; }
    else if (!quoted && (char === '\r' || char === '\n')) { if (char === '\r' && text[i + 1] === '\n') i++; row.push(value); rows.push(row); row = []; value = ''; }
    else value += char;
  }
  if (value || row.length) { row.push(value); rows.push(row); } assert.equal(quoted, false); return rows;
}
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 200; i++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(30); }
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async code => { for (let i = 0; i < 200; i++) { try { if (await js(code)) return; } catch (_) {} await pause(20); } throw new Error('Timeout: ' + code); };
  const check = async (name, action) => { try { await action(); results.push({ name, ok: true }); console.log('PASS ' + name); } catch (error) { results.push({ name, ok: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); } };
  const choose = (kind, format) => js(`(()=>{const opt=document.querySelector('[data-export-kind="${kind}"] [data-role=export-format] .exp-format-opt[data-format="${format}"]');if(!opt)throw new Error('format option missing: ${format}');opt.click();})();void 0`);
  const click = async (kind, file) => {
    savePath = file;
    await js(`messages.length=0;document.querySelector('[data-act=exp-${kind}]').click();void 0`);
    await wait(`!document.querySelector('[data-act=exp-${kind}]').disabled`);
  };
  await wait('!!window.DNSDesktop?.ready'); win.setContentSize(1440, 1000); win.webContents.setBackgroundThrottling(false);
  await js(`Store.clearAll();DNSDesktop.setSceneEnabled(false);window.messages=[];window.exportToast=toast;window.toast=(message,...args)=>{messages.push(message);exportToast(message,...args);};
    window.exportFixture={customer:Store.upsertCustomer({name:'导出测试客户',phone:'00123',contact:'张老板',address:'测试地址',remark:'客户备注'}),product:Store.upsertProduct({name:'导出测试商品',code:'001',barcode:'0012345',spec:'500g',unit:'袋',price:0.125,cost:0,remark:${JSON.stringify('商品备注\r\n含逗号,和"引号"')}})};
    exportFixture.archived=Store.upsertProduct({name:'下架测试商品',price:2});
    Store.addOrder({no:Store.nextOrderNo(todayStr()),date:todayStr(),customer:exportFixture.customer,items:[{pid:exportFixture.archived.id,name:exportFixture.archived.name,qty:1,price:2,amount:2}],total:2});Store.deleteProduct(exportFixture.archived.id);
    Store.upsertCustomer({name:'=1+1',phone:'+86123'});location.hash='#/settings';void 0`);
  await wait('!!document.querySelector("[data-export-kind=products]")');
  await js('document.querySelector("[data-data-panel=tables]").open=true;void 0');
  const productsFile = path.join(temp, '商品.xlsx'), customersFile = path.join(temp, '客户.xlsx');
  const productsCSV = path.join(temp, '商品.csv'), customersCSV = path.join(temp, '客户.csv');
  await check('products and customers each have one row with a right-hand format selector and export button', async () => {
    assert.equal(await js('document.querySelectorAll(".settings-export-row").length'), 2);
    assert.equal(await js('document.querySelectorAll("[data-act=exp-products]").length'), 1);
    assert.equal(await js('document.querySelectorAll("[data-act=exp-customers]").length'), 1);
    assert.equal(await js('document.querySelectorAll("select").length'), 0);
    assert.deepEqual(await js('Array.from(document.querySelectorAll(".settings-export-row [data-role=export-format]")).map(el=>el.dataset.value)'), ['xlsx', 'xlsx']);
    assert.deepEqual(await js('Array.from(document.querySelectorAll(".settings-export-row .exp-format-opt")).map(el=>el.textContent.replace(/\\s+/g,""))').then(v=>v.filter((_,i)=>i%2===0)), ['Excel.xlsx', 'Excel.xlsx']);
    const before = saveCalls; await choose('products', 'csv'); await choose('customers', 'csv'); await pause(80); assert.equal(saveCalls, before);
    assert.equal(await js('document.querySelectorAll("#modal-root .mask").length'), 0);
    await choose('products', 'xlsx'); await choose('customers', 'xlsx');
  });
  await check('default Excel exports retain product and customer data', async () => {
    await click('products', productsFile); assert.ok(await js('messages.includes("已导出 Excel")'));
    await click('customers', customersFile); assert.ok(await js('messages.includes("已导出 Excel")'));
    const product = sheet(productsFile), customer = sheet(customersFile);
    for (const value of ['导出测试商品', '0012345', '已下架', '<v>0.125</v>', '<v>0</v>']) assert.ok(product.includes(value));
    for (const value of ['导出测试客户', '00123', '张老板', '测试地址']) assert.ok(customer.includes(value));
  });
  await check('CSV uses the same columns, includes archived state, preserves zero prices and quotes multiline remarks', async () => {
    await choose('products', 'csv'); await click('products', productsCSV); assert.ok(await js('messages.includes("已导出 CSV")'));
    const buffer = fs.readFileSync(productsCSV); assert.equal(buffer[0], 0xef); assert.equal(buffer[1], 0xbb); assert.equal(buffer[2], 0xbf);
    const rows = parseCSV(buffer.toString('utf8').replace(/^\ufeff/, ''));
    assert.deepEqual(rows[0], ['编号', '条码', '产品名称', '规格', '单位', '零售价', '成本价', '状态', '备注']);
    const item = rows.find(row => row[2] === '导出测试商品'); assert.equal(item[0], '001'); assert.equal(item[1], '0012345'); assert.equal(item[5], '0.125'); assert.equal(item[6], '0'); assert.equal(item[8], '商品备注\r\n含逗号,和"引号"');
    assert.equal(rows.find(row => row[2] === '下架测试商品')[7], '已下架'); assert.ok(rows.every(row => row.length === 9));
    await choose('customers', 'csv'); await click('customers', customersCSV);
    const customers = parseCSV(fs.readFileSync(customersCSV, 'utf8').replace(/^\ufeff/, ''));
    assert.deepEqual(customers[0], ['客户名称', '电话', '联系人', '地址', '备注']);
    assert.deepEqual(customers.find(row => row[0] === '导出测试客户'), ['导出测试客户', '00123', '张老板', '测试地址', '客户备注']);
    assert.ok(customers.some(row => row[0] === "'=1+1" && row[1] === "'+86123"));
  });
  await check('format choice is independent per row and remains selected after export', async () => {
    await choose('products', 'xlsx');
    assert.equal(await js('document.querySelector("[data-export-kind=customers] [data-role=export-format]").dataset.value'), 'csv');
    await click('products', productsFile);
    assert.equal(await js('document.querySelector("[data-export-kind=products] [data-role=export-format]").dataset.value'), 'xlsx');
    assert.equal(await js('document.querySelector("[data-export-kind=customers] [data-role=export-format]").dataset.value'), 'csv');
  });
  await check('pending export disables its own controls and double click opens only one save dialog', async () => {
    saveDelay = 120; savePath = productsFile; const before = saveCalls;
    await js('const button=document.querySelector("[data-act=exp-products]");button.click();button.click();void 0');
    assert.equal(await js('document.querySelector("[data-act=exp-products]").disabled&&document.querySelector("[data-export-kind=products] [data-role=export-format]").classList.contains("is-busy")'), true);
    assert.equal(await js('document.querySelector("[data-act=exp-customers]").disabled'), false);
    await wait('!document.querySelector("[data-act=exp-products]").disabled'); assert.equal(saveCalls, before + 1); saveDelay = 0;
  });
  await check('cancel and write failure never report success and controls recover', async () => {
    canceled = true; const target = path.join(temp, 'canceled.xlsx'); await click('products', target);
    assert.equal(fs.existsSync(target), false); assert.equal(await js('messages.some(message=>message.startsWith("已导出"))'), false); canceled = false;
    await choose('products', 'csv'); await click('products', path.join(temp, 'missing-parent/failure.csv'));
    assert.equal(await js('messages.some(message=>message.startsWith("已导出"))'), false);
    assert.ok(await js('messages.some(message=>message.includes("保存失败"))'));
    assert.equal(await js('document.querySelector("[data-export-kind=products] [data-role=export-format]").classList.contains("is-busy")'), false);
  });
  await check('CSV imports remain separate and are not triggered by export format selection', async () => {
    const before = openCalls;
    for (const kind of ['products', 'customers']) { await js(`document.querySelector('[data-act=imp-${kind}]').click();void 0`); await pause(60); }
    assert.equal(openCalls, before + 2);
  });
  await check('export controls fit on their rows at the minimum desktop width', async () => {
    await choose('products', 'xlsx'); await choose('customers', 'csv');
    await js('document.querySelector("#toast").classList.remove("show");void 0');
    win.setContentSize(1024, 800); await pause(150);
    await js('document.querySelector(".settings-export-row").scrollIntoView({block:"center",behavior:"instant"});void 0'); await pause(350);
    const fits = await js(`Array.from(document.querySelectorAll('.settings-export-row')).every(row=>{const r=row.getBoundingClientRect(),title=row.querySelector('.settings-row-main').getBoundingClientRect(),controls=row.querySelector('.settings-export-actions').getBoundingClientRect();return controls.right<=r.right&&controls.left>=title.right&&row.scrollWidth<=row.clientWidth+1})`);
    assert.equal(fits, true); fs.writeFileSync(path.join(OUT, 'formats-1024.png'), (await win.webContents.capturePage()).toPNG());
    win.setContentSize(1440, 1000); await pause(150); await js('document.querySelector(".settings-export-row").scrollIntoView({block:"center",behavior:"instant"});void 0'); await pause(350);
    fs.writeFileSync(path.join(OUT, 'formats-1440.png'), (await win.webContents.capturePage()).toPNG());
  });
  await check('both formats remain blocked for incomplete data and emit no uncaught errors', async () => {
    await js('window.__DNSStorage.setItem("sd_v1_orders","[{broken");void 0'); win.reload(); await pause(250); await wait('!!window.DNSDesktop?.ready');
    await js('window.messages=[];void 0');
    await js('location.hash="#/settings";void 0'); await wait('!!document.querySelector("[data-export-kind=products]")');
    const before = saveCalls;
    for (const kind of ['products', 'customers']) for (const format of ['xlsx', 'csv']) { await choose(kind, format); await click(kind, path.join(temp, 'blocked-' + kind + '.' + format)); }
    assert.equal(saveCalls, before); assert.deepEqual(errors, []);
  });
  fs.writeFileSync(path.join(OUT, 'verification.json'), JSON.stringify({ results, errors, temp }, null, 2));
  clearTimeout(timeout); app.exit(results.every(result => result.ok) ? 0 : 1);
}).catch(error => { console.error(error); console.error(JSON.stringify(errors)); clearTimeout(timeout); app.exit(1); });
