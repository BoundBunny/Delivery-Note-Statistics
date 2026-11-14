'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, '.shots/p2-regression'); fs.mkdirSync(OUT, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-p2-ui-'));
for (const [key, folder] of Object.entries({ DNS_TEST_USER_DATA: 'profile', DNS_TEST_DATA_DIR: 'data', DNS_TEST_BACKUP_DIR: 'backup', DNS_TEST_IMAGE_DIR: 'images', DNS_TEST_SAVE_DIR: 'exports' })) process.env[key] = path.join(temp, folder);
app.setPath('userData', process.env.DNS_TEST_USER_DATA); app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)), results = [], errors = [];
const timeout = setTimeout(() => { console.error('P2_UI_TIMEOUT'); app.exit(1); }, 90000);
app.on('web-contents-created', (_event, contents) => contents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); }));
require(path.join(ROOT, 'main.js'));
function entry(bytes, name) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : fs.readFileSync(bytes); let at = 0;
  while (buffer.readUInt32LE(at) === 0x04034b50) {
    const length = buffer.readUInt32LE(at + 18), nameLength = buffer.readUInt16LE(at + 26), extra = buffer.readUInt16LE(at + 28), start = at + 30 + nameLength + extra;
    if (buffer.subarray(at + 30, at + 30 + nameLength).toString() === name) return buffer.subarray(start, start + length).toString();
    at = start + length;
  }
  throw new Error('ZIP entry missing: ' + name);
}
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 200; i++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(40); }
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async code => { for (let i = 0; i < 200; i++) { try { if (await js(code)) return; } catch (_) {} await pause(30); } throw new Error('Timeout: ' + code); };
  const nav = async hash => { await js('location.hash=' + JSON.stringify(hash)); await pause(120); };
  const check = async (name, action) => { try { await action(); results.push({ name, ok: true }); console.log('PASS ' + name); } catch (error) { results.push({ name, ok: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); } };
  const save = async (file, code) => {
    await js('messages.length=0;' + code + ';void 0'); await wait('messages.some(message=>message.startsWith("已保存到 "))');
    const result = path.join(process.env.DNS_TEST_SAVE_DIR, file); assert.ok(fs.existsSync(result)); return result;
  };
  await wait('!!window.DNSDesktop?.ready'); win.setContentSize(1440, 1000);
  await js(`Store.clearAll();DNSDesktop.setSceneEnabled(false);window.messages=[];window.p2Toast=toast;window.toast=(message,...args)=>{messages.push(message);p2Toast(message,...args);};
    window.fx={customer:Store.upsertCustomer({name:'小数对账客户',phone:'00123'}),danger:Store.upsertCustomer({name:'=1+1',phone:'+86123'})};
    Store.setSettings({company:'P2 验证店铺',note:'默认结算说明：次月5号前付款'});
    fx.order=Store.addOrder({no:'MATCH-1',date:'2026-11-12',customer:fx.customer,items:[{name:'小数数量商品',unit:'kg',qty:0.001,price:100,amount:0.1},{name:'小数单价商品',unit:'袋',qty:100,price:0.125,amount:12.5}],total:12.6});
    Store.addOrder({no:'OTHER-2',date:'2026-11-13',customer:fx.customer,items:[{name:'其他商品',qty:1,price:2,amount:2}],total:2});
    Store.addOrder({no:'CSV-3',date:'2026-11-14',customer:fx.danger,operator:'@制单人',items:[{name:${JSON.stringify('A\rB')},qty:1,price:3,amount:3,remark:${JSON.stringify('第一行\r\n第二行')}}],total:3});
    fx.product=Store.upsertProduct({name:${JSON.stringify('控制字符\u000b_x000B_😀')},price:0.125});window.beforePrecisionOrder=JSON.stringify(Store.getOrder(fx.order.id));void 0`);

  await check('print HTML and PNG preserve fractional quantity and unit price', async () => {
    await nav('#/print?id=' + await js('fx.order.id'));
    const cells = await js('Array.from(document.querySelectorAll("#print-view .doc-num")).map(cell=>cell.textContent)');
    for (const value of ['0.001', '100.00', '0.10', '100', '0.125', '12.50']) assert.ok(cells.includes(value), value);
    const drawn = await js(`(()=>{const original=CanvasRenderingContext2D.prototype.fillText,drawn=[];CanvasRenderingContext2D.prototype.fillText=function(text,...args){drawn.push(String(text));return original.call(this,text,...args)};try{drawDocToCanvas(Store.getOrder(fx.order.id),Store.getSettings());return drawn}finally{CanvasRenderingContext2D.prototype.fillText=original}})()`);
    for (const value of ['0.001', '0.125', '12.50']) assert.ok(drawn.includes(value));
    const png = await save('送货单_MATCH-1.png', 'document.querySelector("[data-act=save-img]").click()');
    assert.equal(fs.readFileSync(png).subarray(1, 4).toString(), 'PNG');
    fs.writeFileSync(path.join(OUT, 'precision.pdf'), await win.webContents.printToPDF({ printBackground: true }));
    fs.writeFileSync(path.join(OUT, 'precision.png'), (await win.webContents.capturePage()).toPNG());
    assert.equal(await js('JSON.stringify(Store.getOrder(fx.order.id))'), await js('beforePrecisionOrder'));
  });
  await check('sharing twice retains the existing file and creates two numbered PNGs', async () => {
    const previous = path.join(process.env.DNS_TEST_SAVE_DIR, '送货单_MATCH-1.png'); fs.writeFileSync(previous, 'previous-version');
    for (let i = 0; i < 2; i++) { await js('messages.length=0;document.querySelector("[data-act=share]").click();void 0'); await wait('messages.includes("已分享")'); }
    assert.equal(fs.readFileSync(previous, 'utf8'), 'previous-version');
    for (const suffix of [2, 3]) assert.equal(fs.readFileSync(path.join(process.env.DNS_TEST_SAVE_DIR, '送货单_MATCH-1 (' + suffix + ').png')).subarray(1, 4).toString(), 'PNG');
  });
  await check('bill preview and its Excel retain edited title, note and decimal values', async () => {
    await nav('#/bill?m=2026-11&c=' + await js('fx.customer.id'));
    const text = await js('document.querySelector(".bill-paper").textContent'); assert.ok(text.includes('0.001') && text.includes('0.125'));
    await js(`document.querySelector('[data-act=edit]').click();document.querySelector('[data-role=eTitle]').value='本月小数对账单';document.querySelector('[data-role=eNote]').value=${JSON.stringify('编辑后的结算条款：次月5号前付款\n请注明送货单号')};document.querySelector('[data-act=edit-save]').click();void 0`);
    const file = await save('账单_小数对账客户_2026-11.xlsx', 'document.querySelector("#desktop-reader [data-act=export]").click()');
    const xml = entry(file, 'xl/worksheets/sheet1.xml');
    assert.ok(xml.includes('本月小数对账单')); assert.ok(xml.includes('编辑后的结算条款：次月5号前付款')); assert.ok(xml.includes('请注明送货单号'));
    assert.ok(xml.includes('<v>0.001</v>') && xml.includes('<v>0.125</v>'));
    fs.copyFileSync(file, path.join(OUT, 'edited-bill.xlsx'));
    fs.writeFileSync(path.join(OUT, 'bill-note.png'), (await win.webContents.capturePage()).toPNG());
  });
  await check('single and all monthly bills export from statistics without the retired default note', async () => {
    await js('Views.stats.state={range:"custom",from:"2026-11-01",to:"2026-11-30",billYm:"2026-11"};void 0'); await nav('#/stats');
    const single = await save('账单_小数对账客户_2026-11.xlsx', `exportBillXlsx('2026-11',fx.customer.id,'小数对账客户')`);
    const bill = entry(single, 'xl/worksheets/sheet1.xml');
    for (const value of ['小数数量商品', '其他商品', '<v>0.001</v>', '<v>14.6</v>']) assert.ok(bill.includes(value), value);
    const all = await save('月度账单_2026-11.xlsx', 'document.querySelector("[data-act=bill-all]").click()');
    const sheets = [1, 2].map(sheet => entry(all, 'xl/worksheets/sheet' + sheet + '.xml'));
    assert.ok(sheets[0].includes('<v>14.6</v>')); assert.ok(sheets[1].includes('<v>3</v>'));
    // The fixture keeps a settings.note saved by an older version; it must stay out of every bill.
    for (const xml of [bill, ...sheets]) assert.ok(!xml.includes('默认结算说明'));
  });
  await check('statistics CSV protects formulas and quotes embedded CR and multiline remarks', async () => {
    const file = await save('销售统计_2026-11-01.csv', 'document.querySelector("#statistics-view [data-act=export]").click()');
    const csv = fs.readFileSync(file, 'utf8'); assert.ok(csv.startsWith('\ufeff'));
    assert.ok(csv.includes(",'=1+1,'+86123,")); assert.ok(csv.includes("'@制单人"));
    assert.ok(csv.includes('"A\rB"')); assert.ok(csv.includes('"第一行\r\n第二行"'));
    fs.copyFileSync(file, path.join(OUT, 'statistics.csv'));
  });
  await check('typing then immediately exporting uses the current keyword', async () => {
    await nav('#/orders'); await js('document.querySelector("#dispatch-collection [data-range=all]").click();void 0');
    const file = await save('送货单_全部.xlsx', `const input=document.querySelector('#dispatch-collection [data-role=kw]');input.value='MATCH';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#dispatch-collection [data-act=export]').click()`);
    const xml = entry(file, 'xl/worksheets/sheet1.xml'); assert.ok(xml.includes('MATCH-1')); assert.ok(!xml.includes('OTHER-2') && !xml.includes('CSV-3'));
  });
  await check('clearing a pending search cannot later reapply the old keyword', async () => {
    const file = await save('送货单_全部.xlsx', `(()=>{const input=document.querySelector('#dispatch-collection [data-role=kw]');input.value='OTHER';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#dispatch-collection [data-act=clear]').click();document.querySelector('#dispatch-collection [data-act=export]').click()})()`);
    const xml = entry(file, 'xl/worksheets/sheet1.xml'); assert.ok(xml.includes('MATCH-1') && xml.includes('OTHER-2') && xml.includes('CSV-3'));
    await pause(250); assert.equal(await js('Views.orders.state.kw'), '');
  });
  await check('products XLSX safely encodes controls, literal escape patterns and emoji', async () => {
    await nav('#/settings'); const file = await save('商品.xlsx', 'document.querySelector("[data-act=exp-products]").click()');
    const xml = entry(file, 'xl/worksheets/sheet1.xml'); assert.ok(!xml.includes('\u000b')); assert.ok(xml.includes('_x000B_') && xml.includes('_x005F_x000B_') && xml.includes('😀'));
    fs.copyFileSync(file, path.join(OUT, 'controls.xlsx'));
  });
  await check('P2 workflows produce no uncaught renderer errors', async () => assert.deepEqual(errors, []));
  fs.writeFileSync(path.join(OUT, 'verification.json'), JSON.stringify({ results, errors, temp }, null, 2));
  clearTimeout(timeout); app.exit(results.every(result => result.ok) ? 0 : 1);
}).catch(error => { console.error(error); console.error(JSON.stringify(errors)); clearTimeout(timeout); app.exit(1); });
