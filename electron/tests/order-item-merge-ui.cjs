'use strict';
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, '.shots/order-item-merge'); fs.mkdirSync(OUT, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-order-merge-'));
for (const [key, folder] of Object.entries({ DNS_TEST_USER_DATA: 'profile', DNS_TEST_DATA_DIR: 'data', DNS_TEST_BACKUP_DIR: 'backup', DNS_TEST_IMAGE_DIR: 'images', DNS_TEST_SAVE_DIR: 'exports' })) process.env[key] = path.join(temp, folder);
app.setPath('userData', process.env.DNS_TEST_USER_DATA); app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)), results = [], errors = [];
const timeout = setTimeout(() => { console.error('ORDER_MERGE_TIMEOUT'); app.exit(1); }, 90000);
app.on('web-contents-created', (_event, contents) => contents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); }));
require(path.join(ROOT, 'main.js'));
function sheet(file) {
  const buffer = fs.readFileSync(file); let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18), length = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28), start = offset + 30 + length + extra;
    if (buffer.subarray(offset + 30, offset + 30 + length).toString() === 'xl/worksheets/sheet1.xml') return buffer.subarray(start, start + size).toString();
    offset = start + size;
  }
  throw new Error('Missing worksheet');
}
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 200; i++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(30); }
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async code => { for (let i = 0; i < 200; i++) { try { if (await js(code)) return; } catch (_) {} await pause(30); } throw new Error('Timeout: ' + code); };
  const nav = async hash => { await js('location.hash=' + JSON.stringify(hash)); await pause(100); };
  const check = async (name, action) => { try { await action(); results.push({ name, ok: true }); console.log('PASS ' + name); } catch (error) { results.push({ name, ok: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); } };
  const open = async (hash = '#/order/new') => {
    await js('(()=>{const view=document.querySelector("#view-container .view");if(view)view.__saved=true;window.__orderDraft=null;})();void 0');
    await nav('#/home'); await nav(hash);
    await js('window.mergeView=document.querySelector("#view-container .view");window.mergeDraft=mergeView.__draft;mergeView.querySelector("[data-act=pick-cust]").click();document.querySelector("#modal-root [data-pick-cust=\\\""+fixture.customer.id+"\\\"]").click();void 0');
  };
  const addLine = async (options = {}) => {
    await js(`(()=>{
      const options=${JSON.stringify(options)};
      mergeView.querySelector('[data-act=add-item]').click();
      const dialog=document.querySelector('.item-dialog');
      const set=(role,value)=>{const input=dialog.querySelector('[data-role="'+role+'"]');input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));};
      if(options.pid){const product=Store.getProduct(options.pid);set('name',product.name);dialog.querySelector('[data-pick-pid="'+product.id+'"]').click();}
      else {for(const role of ['name','spec','unit'])if(options[role]!=null)set(role,options[role]);}
      for(const role of ['name','spec','unit','qty','price'])if(options[role]!=null)set(role,options[role]);
      const confirm=dialog.querySelector('[data-act=ok]');confirm.click();if(options.double)confirm.click();
    })();void 0`);
  };
  const saveOrder = async () => { await js('mergeView.querySelector("[data-act=save]").click();void 0'); await wait('location.hash.startsWith("#/order/view?id=")'); return js('Store.getOrder(DNSDesktop.state.selectedId)'); };
  await wait('!!window.DNSDesktop?.ready'); win.setContentSize(1440, 1000); win.webContents.setBackgroundThrottling(false);
  const image = path.join(temp, 'images/water.png'); fs.mkdirSync(path.dirname(image), { recursive: true });
  fs.writeFileSync(image, nativeImage.createFromBitmap(Buffer.alloc(4 * 4 * 4, 255), { width: 4, height: 4 }).toPNG());
  await js(`Store.clearAll();DNSDesktop.setSceneEnabled(false);window.messages=[];window.oldMergeToast=toast;window.toast=(message,...args)=>{messages.push(message);oldMergeToast(message,...args);};
    window.fixture={customer:Store.upsertCustomer({name:'合并验证客户',phone:'00123'})};
    fixture.water=Store.upsertProduct({name:'怡宝合并测试水',barcode:'990001',spec:'555ml',unit:'瓶',price:2,image:${JSON.stringify(image)}});
    fixture.twin=Store.upsertProduct({name:'怡宝合并测试水',barcode:'990002',spec:'555ml',unit:'瓶',price:2,image:${JSON.stringify(image)}});
    fixture.unique=Store.upsertProduct({name:'唯一手输商品',barcode:'990003',spec:'500ml',unit:'瓶',price:3.33,image:${JSON.stringify(image)}});
    fixture.fraction=Store.upsertProduct({name:'小数合并商品',barcode:'990004',spec:'1kg',unit:'kg',price:0.125});
    fixture.free=Store.upsertProduct({name:'免费合并商品',barcode:'990005',spec:'1件',unit:'件',price:0});
    Store.importJSON(Store.exportJSON());void 0`);
  const fixture = await js('fixture'); let firstSaved;

  await check('232 plus 22 becomes one 254-bottle card, 508 total, with no business write before Save', async () => {
    await open(); const revision = await js('Store.revision'), before = await js('JSON.stringify(JSON.parse(Store.exportJSON()).data)');
    await addLine({ pid: fixture.water.id, qty: '232', price: '2' }); await addLine({ pid: fixture.water.id, qty: '22', price: '2.00' });
    assert.equal(await js('mergeDraft.items.length'), 1); assert.equal(await js('Number(mergeDraft.items[0].qty)'), 254); assert.equal(await js('mergeDraft.total'), 508);
    assert.equal(await js('mergeView.querySelectorAll(".oi-card").length'), 1);
    assert.equal(await js('mergeView.isConnected&&document.querySelectorAll("#view-container .oi-card").length===1'), true);
    assert.ok(await js('mergeView.querySelector(".oi-card").getBoundingClientRect().width>0'));
    assert.ok((await js('mergeView.querySelector(".oi-card .pm-meta").textContent')).includes('254 瓶'));
    assert.equal(await js('Store.revision'), revision); assert.equal(await js('JSON.stringify(JSON.parse(Store.exportJSON()).data)'), before);
    await pause(200); fs.writeFileSync(path.join(OUT, 'merged-254.png'), (await win.webContents.capturePage()).toPNG());
    firstSaved = await saveOrder(); assert.equal(firstSaved.items.length, 1); assert.equal(firstSaved.items[0].qty, 254); assert.equal(firstSaved.total, 508);
    const disk = JSON.parse(fs.readFileSync(path.join(process.env.DNS_TEST_DATA_DIR, 'sd_v1_orders.json'))); assert.equal(disk.find(order => order.id === firstSaved.id).items[0].qty, 254);
  });
  await check('saved merged quantities remain consistent in print, PNG, CSV and Excel', async () => {
    assert.ok(firstSaved); await nav('#/print?id=' + firstSaved.id);
    const numbers = await js('Array.from(document.querySelectorAll("#print-view .doc-num")).map(cell=>cell.textContent)');
    for (const value of ['254', '2.00', '508.00']) assert.ok(numbers.includes(value));
    await js('messages.length=0;document.querySelector("[data-act=save-img]").click();void 0'); await wait('messages.includes("图片已保存")');
    assert.ok(fs.existsSync(path.join(process.env.DNS_TEST_SAVE_DIR, '送货单_' + firstSaved.no + '.png')));
    fs.writeFileSync(path.join(OUT, 'merged-print.pdf'), await win.webContents.printToPDF({ printBackground: true }));
    const csv = await js('Store.ordersCSV({keyword:' + JSON.stringify(firstSaved.no) + '})'); assert.ok(csv.includes(',254,2,508,')); assert.equal(csv.split('\r\n').length, 3);
    await nav('#/orders');
    await js(`document.querySelector('#dispatch-collection [data-range=all]').click();const input=document.querySelector('#dispatch-collection [data-role=kw]');input.value=${JSON.stringify(firstSaved.no)};input.dispatchEvent(new Event('input',{bubbles:true}));messages.length=0;document.querySelector('#dispatch-collection [data-act=export]').click();void 0`);
    await wait('messages.includes("已导出 Excel")');
    const file = path.join(process.env.DNS_TEST_SAVE_DIR, '送货单_全部.xlsx'), xml = sheet(file);
    assert.ok(xml.includes('<c r="I2" s="2"><v>254</v></c>')); assert.ok(xml.includes('<c r="K2" s="2"><v>508</v></c>'));
    fs.copyFileSync(file, path.join(OUT, 'merged.xlsx'));
  });
  await check('ordinary appends and one-row merges preserve existing card and image DOM nodes', async () => {
    await open(); await addLine({ pid: fixture.water.id, qty: '2', price: '2' });
    await js('window.firstCard=mergeView.querySelector(".oi-card");window.firstImage=firstCard.querySelector("img");window.addButton=mergeView.querySelector("[data-act=add-item]");void 0');
    await addLine({ pid: fixture.unique.id, qty: '1', price: '3.33' }); assert.equal(await js('mergeView.querySelector(".oi-card")===firstCard'), true);
    await js('window.otherCard=mergeView.querySelectorAll(".oi-card")[1];window.otherImage=otherCard.querySelector("img");void 0');
    await addLine({ pid: fixture.water.id, qty: '4', price: '2' });
    assert.equal(await js('mergeView.querySelectorAll(".oi-card")[0]===firstCard&&firstCard.querySelector("img")===firstImage'), true);
    assert.equal(await js('mergeView.querySelectorAll(".oi-card")[1]===otherCard&&otherCard.querySelector("img")===otherImage'), true);
    assert.equal(await js('mergeView.querySelector("[data-act=add-item]")===addButton'), true);
    assert.equal(await js('Number(mergeDraft.items[0].qty)'), 6);
  });
  await check('editing an existing quantity replaces its value instead of adding it again', async () => {
    await js('mergeView.querySelector(".oi-card").click();document.querySelector(".item-dialog [data-role=qty]").value="7";document.querySelector(".item-dialog [data-act=ok]").click();void 0');
    assert.equal(await js('Number(mergeDraft.items[0].qty)'), 7); assert.equal(await js('mergeDraft.items.length'), 2);
  });
  await check('different IDs, specifications, units and prices remain separate', async () => {
    await open(); await addLine({ pid: fixture.water.id, qty: '2', price: '2' });
    await addLine({ pid: fixture.water.id, qty: '3', price: '3' });
    await addLine({ pid: fixture.water.id, qty: '4', price: '2', unit: '箱' });
    await addLine({ pid: fixture.water.id, qty: '5', price: '2', spec: '1.55L' });
    await addLine({ pid: fixture.twin.id, qty: '6', price: '2' });
    assert.equal(await js('mergeDraft.items.length'), 5); assert.equal(await js('Number(mergeDraft.items[0].qty)'), 2);
  });
  await check('different historical line remarks are preserved as separate rows', async () => {
    await open(); await addLine({ pid: fixture.water.id, qty: '2', price: '2' });
    await js('mergeDraft.items[0].remark="单独送货";void 0'); await addLine({ pid: fixture.water.id, qty: '3', price: '2' });
    assert.equal(await js('mergeDraft.items.length'), 2); assert.equal(await js('mergeDraft.items[0].remark'), '单独送货');
  });
  await check('different price rows remember the last confirmed price after an earlier card absorbs an addition', async () => {
    await open();
    await addLine({ pid: fixture.water.id, qty: '1', price: '2' });
    await addLine({ pid: fixture.water.id, qty: '1', price: '3' });
    await addLine({ pid: fixture.water.id, qty: '2', price: '2' });
    const saved = await saveOrder(); assert.equal(saved.items.length, 2); assert.equal(saved.items[0].qty, 3); assert.equal(saved.total, 9);
    assert.equal(await js('Store.getLastPrice(fixture.customer.id,fixture.water.id)'), 2);
  });
  await check('deleting the latest confirmed line cannot leave its price in customer price history', async () => {
    await open();
    await addLine({ pid: fixture.water.id, qty: '1', price: '2' });
    await addLine({ pid: fixture.water.id, qty: '1', price: '3' });
    await addLine({ pid: fixture.water.id, qty: '1', price: '2' });
    await js('mergeView.querySelector(".oi-card .pm-del").click();void 0');
    const saved = await saveOrder(); assert.equal(saved.items.length, 1); assert.equal(saved.items[0].price, 3);
    assert.equal(await js('Store.getLastPrice(fixture.customer.id,fixture.water.id)'), 3);
  });
  await check('manual input resolves only a unique catalog product and merges it', async () => {
    await open(); await addLine({ pid: fixture.unique.id, qty: '1', price: '3.33' });
    await addLine({ name: fixture.unique.name, spec: fixture.unique.spec, unit: fixture.unique.unit, qty: '2', price: '3.33' });
    assert.equal(await js('mergeDraft.items.length'), 1); assert.equal(await js('mergeDraft.items[0].pid'), fixture.unique.id); assert.equal(await js('Number(mergeDraft.items[0].qty)'), 3);
  });
  await check('ambiguous manual product names do not merge and cannot silently bind an arbitrary product on Save', async () => {
    await open(); await addLine({ pid: fixture.water.id, qty: '2', price: '2' });
    await addLine({ name: fixture.water.name, spec: fixture.water.spec, unit: fixture.water.unit, qty: '3', price: '2' });
    assert.equal(await js('mergeDraft.items.length'), 2); assert.equal(await js('mergeDraft.items[1].pid||null'), null);
    const count = await js('Store.countAll().orders'); await js('mergeView.querySelector("[data-act=save]").click();void 0');
    assert.equal(await js('Store.countAll().orders'), count); assert.ok((await js('document.querySelector("#toast").textContent')).includes('选择具体商品'));
  });
  await check('new manual duplicates merge with exact decimal quantities and create one product when saved', async () => {
    await open(); const products = await js('Store.countAll().products');
    const base = { name: '手输新商品', spec: '1kg', unit: '袋', price: '2' };
    await addLine({ ...base, qty: '0.1' }); await addLine({ ...base, qty: '0.2' });
    assert.equal(await js('mergeDraft.items.length'), 1); assert.equal(await js('mergeDraft.items[0].qty'), '0.3'); assert.equal(await js('mergeDraft.total'), 0.6);
    assert.equal(await js('Store.countAll().products'), products);
    const saved = await saveOrder(); assert.equal(saved.items.length, 1); assert.equal(saved.items[0].qty, 0.3); assert.equal(saved.total, 0.6);
    assert.equal(await js('Store.countAll().products'), products + 1);
  });
  await check('fractional prices round once after merging and a repeated confirm is applied only once', async () => {
    await open(); await addLine({ pid: fixture.fraction.id, qty: '1', price: '0.125' });
    await addLine({ pid: fixture.fraction.id, qty: '1', price: '0.125', double: true });
    assert.equal(await js('mergeDraft.items.length'), 1); assert.equal(await js('Number(mergeDraft.items[0].qty)'), 2); assert.equal(await js('mergeDraft.total'), 0.25);
    const saved = await saveOrder(); assert.equal(saved.items[0].amount, 0.25); assert.equal(saved.total, 0.25);
  });
  await check('overflow stays in the item dialog and leaves the previous quantity unchanged', async () => {
    await open(); await addLine({ pid: fixture.water.id, qty: '40000000000000', price: '2' });
    const before = await js('JSON.stringify(mergeDraft.items)'); await addLine({ pid: fixture.water.id, qty: '40000000000000', price: '2' });
    assert.equal(await js('JSON.stringify(mergeDraft.items)'), before); assert.equal(await js('!!document.querySelector(".item-dialog")'), true);
    assert.ok((await js('document.querySelector("#toast").textContent')).includes('超出可计算范围'));
    await js('document.querySelector(".item-dialog [data-act=cancel]").click();void 0');
  });
  await check('opening old duplicates never rewrites history; an explicit addition consolidates only compatible draft rows', async () => {
    await open();
    const historic = await js(`(()=>{const item={pid:fixture.water.id,name:fixture.water.name,spec:fixture.water.spec,unit:fixture.water.unit,price:2};return Store.addOrder({no:Store.nextOrderNo(todayStr()),date:todayStr(),customer:fixture.customer,items:[{...item,qty:2,amount:4},{pid:fixture.unique.id,name:fixture.unique.name,spec:fixture.unique.spec,unit:fixture.unique.unit,qty:1,price:3.33,amount:3.33},{...item,qty:3,amount:6}],total:13.33})})()`);
    const before = JSON.stringify(historic); await open('#/order/edit?id=' + historic.id);
    assert.equal(await js('mergeDraft.items.length'), 3); await addLine({ pid: fixture.water.id, qty: '4', price: '2' });
    assert.equal(await js('mergeDraft.items.length'), 2); assert.equal(await js('Number(mergeDraft.items[0].qty)'), 9);
    assert.deepEqual(await js('Array.from(mergeView.querySelectorAll(".oi-card")).map(card=>card.dataset.idx)'), ['0', '1']);
    assert.equal(await js('JSON.stringify(Store.getOrder(' + JSON.stringify(historic.id) + '))'), before);
    await open(); assert.equal(await js('JSON.stringify(Store.getOrder(' + JSON.stringify(historic.id) + '))'), before);
  });
  await check('copying and merging creates a new order without changing the source', async () => {
    await open(); await js('mergeView.__saved=true;void 0'); await nav('#/order/view?id=' + firstSaved.id); await wait('DNSDesktop.mode==="detail"');
    await js('document.querySelector("#desktop-reader [data-act=copy]").click();void 0'); await wait('location.hash==="#/order/new"');
    await js('window.mergeView=document.querySelector("#view-container .view");window.mergeDraft=mergeView.__draft;void 0');
    await addLine({ pid: fixture.water.id, qty: '2', price: '2' });
    const copied = await saveOrder(); assert.notEqual(copied.id, firstSaved.id); assert.notEqual(copied.no, firstSaved.no); assert.equal(copied.items[0].qty, 256);
    assert.equal(await js('Store.getOrder(' + JSON.stringify(firstSaved.id) + ').items[0].qty'), 254);
  });
  let performance;
  await check('300-line draft merges locally without replacing cards, looking up history or writing business data', async () => {
    await open();
    await js(`mergeView.__saved=true;window.__orderDraft={id:null,no:Store.nextOrderNo(todayStr()),date:todayStr(),operator:'',note:'',customer:fixture.customer,items:Array.from({length:300},(_,i)=>{const p=i===0?fixture.water:fixture.unique;return {pid:p.id,name:p.name,spec:p.spec,unit:p.unit,qty:'1',price:'2',amount:2,remark:''}})};location.hash='#/home';void 0`);
    await pause(100); await nav('#/order/new');
    await js('window.mergeView=document.querySelector("#view-container .view");window.mergeDraft=mergeView.__draft;window.mergeCards=Array.from(mergeView.querySelector("[data-role=items]").children);void 0');
    await js(`mergeView.querySelector('[data-act=add-item]').click();const dialog=document.querySelector('.item-dialog');const name=dialog.querySelector('[data-role=name]');name.value=fixture.water.name;name.dispatchEvent(new Event('input',{bubbles:true}));dialog.querySelector('[data-pick-pid="'+fixture.water.id+'"]').click();dialog.querySelector('[data-role=qty]').value='22';dialog.querySelector('[data-role=price]').value='2';void 0`);
    performance = await js(`(()=>{const calls={},original={},keys=['listOrders','getProduct','listProducts','upsertProduct','transaction'];for(const key of keys){original[key]=Store[key];calls[key]=0;Store[key]=function(...args){calls[key]++;return original[key].apply(this,args)}}const before=Store.revision,start=performance.now();try{document.querySelector('.item-dialog [data-act=ok]').click();return {rows:mergeDraft.items.length,elapsedMs:performance.now()-start,calls,noBusinessWrite:Store.revision===before,reusedCards:mergeCards.every((card,index)=>mergeView.querySelector('[data-role=items]').children[index]===card),quantity:Number(mergeDraft.items[0].qty)}}finally{for(const key of keys)Store[key]=original[key]}})()`);
    assert.equal(performance.rows, 300); assert.equal(performance.quantity, 23); assert.equal(performance.reusedCards, true); assert.equal(performance.noBusinessWrite, true);
    for (const count of Object.values(performance.calls)) assert.equal(count, 0);
    console.log('MERGE_PERFORMANCE ' + JSON.stringify(performance));
  });
  await check('saved merged records survive reload and all merge workflows have no uncaught errors', async () => {
    await js('mergeView.__saved=true;void 0'); await nav('#/home'); win.reload(); await pause(250); await wait('!!window.DNSDesktop?.ready');
    const saved = await js('Store.getOrder(' + JSON.stringify(firstSaved.id) + ')'); assert.equal(saved.items.length, 1); assert.equal(saved.items[0].qty, 254); assert.equal(saved.total, 508); assert.deepEqual(errors, []);
  });
  fs.writeFileSync(path.join(OUT, 'verification.json'), JSON.stringify({ results, errors, performance, temp }, null, 2));
  clearTimeout(timeout); app.exit(results.every(result => result.ok) ? 0 : 1);
}).catch(error => { console.error(error); console.error(JSON.stringify(errors)); clearTimeout(timeout); app.exit(1); });
