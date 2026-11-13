'use strict';
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, '.shots/order-preview'); fs.mkdirSync(OUT, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-order-preview-'));
for (const [key, folder] of Object.entries({ DNS_TEST_USER_DATA: 'profile', DNS_TEST_DATA_DIR: 'data', DNS_TEST_BACKUP_DIR: 'backup', DNS_TEST_IMAGE_DIR: 'images' })) process.env[key] = path.join(temp, folder);
app.setPath('userData', process.env.DNS_TEST_USER_DATA); app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)), results = [], errors = [];
const timeout = setTimeout(() => { console.error('ORDER_PREVIEW_TIMEOUT'); app.exit(1); }, 90000);
app.on('web-contents-created', (_event, contents) => contents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); }));
require(path.join(ROOT, 'main.js'));
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 200; i++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(30); }
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async code => { for (let i = 0; i < 200; i++) { try { if (await js(code)) return; } catch (_) {} await pause(25); } throw new Error('Timeout: ' + code); };
  const nav = async hash => { await js('location.hash=' + JSON.stringify(hash)); await pause(100); };
  const click = async selector => {
    const point = await js(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element?.checkVisibility())throw Error('Not visible: '+${JSON.stringify(selector)});const r=element.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point }); await pause(100);
  };
  const key = async keyCode => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await pause(60); };
  const check = async (name, action) => { try { await action(); results.push({ name, ok: true }); console.log('PASS ' + name); } catch (error) { results.push({ name, ok: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); } };
  const source = index => '#dispatch-body [data-order-id="' + fixture.orders[index].id + '"]';
  const geometry = () => js(`(()=>{const panel=document.querySelector('#context-panel'),row=document.querySelector('#dispatch-body .selection-source'),dispatch=document.querySelector('#dispatch-panel');if(!row||panel.hidden)return {hidden:panel.hidden};const p=panel.getBoundingClientRect(),r=row.getBoundingClientRect(),d=dispatch.getBoundingClientRect(),styles=getComputedStyle(panel);return {hidden:false,p:{left:p.left,top:p.top,right:p.right,bottom:p.bottom,width:p.width,height:p.height},r:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},d:{right:d.right},anchor:parseFloat(styles.getPropertyValue('--selection-anchor-y')),link:parseFloat(styles.getPropertyValue('--selection-link-width')),width:innerWidth,height:innerHeight,pressed:row.getAttribute('aria-expanded'),animation:styles.animationName,hit:document.elementFromPoint(p.left+p.width/2,p.top+24)?.closest('#context-panel')===panel}})()`);
  const fit = state => {
    assert.equal(state.hidden, false); assert.ok(state.p.left > state.d.right && state.p.left - state.d.right <= 14, JSON.stringify(state));
    assert.ok(state.p.left > state.r.right, JSON.stringify(state)); assert.ok(state.p.right <= state.width - 10, JSON.stringify(state));
    assert.ok(state.p.top >= 88 && state.p.bottom <= state.height - 10, JSON.stringify(state)); assert.equal(state.hit, true); assert.equal(state.pressed, 'true');
  };
  await wait('!!window.DNSDesktop?.ready'); win.setContentSize(1440, 1000); win.webContents.setBackgroundThrottling(false);
  const photo = path.join(temp, 'water.png'); fs.writeFileSync(photo, nativeImage.createFromBitmap(Buffer.alloc(12 * 12 * 4, 200), { width: 12, height: 12 }).toPNG());
  await js(`Store.clearAll();DNSDesktop.setSceneEnabled(false);window.fixture={customer:Store.upsertCustomer({name:'列表关联客户',phone:'00123'}),product:Store.upsertProduct({name:'怡宝测试饮用水',unit:'瓶',spec:'555ml',price:2,image:${JSON.stringify(photo)}}),orders:[]};
    Store.transaction(()=>{for(let i=0;i<8;i++){const items=Array.from({length:i===6?35:i===0?2:1},(_,j)=>({pid:fixture.product.id,name:fixture.product.name,spec:fixture.product.spec,unit:'瓶',qty:1,price:j===1?0.125:2,amount:j===1?0.13:2}));fixture.orders.push(Store.addOrder({no:'PREVIEW-'+(8-i),date:todayStr(),createdAt:Date.now()-i*1000,customer:i%2?null:fixture.customer,items,total:items.reduce((sum,item)=>sum+Math.round(item.amount*100),0)/100}))}});Store.importJSON(Store.exportJSON());DNSDesktop.refresh();void 0`);
  const fixture = await js('fixture');
  await check('home has no permanent current-order panel even when records exist', async () => {
    assert.equal(await js('document.querySelector("#context-panel").hidden'), true);
    assert.equal(await js('document.querySelector("#context-panel").checkVisibility()'), false);
    assert.equal(await js('document.querySelectorAll("#dispatch-body [aria-expanded=true]").length'), 0);
    assert.equal(await js('document.querySelector("#statistics-panel").checkVisibility()'), true);
    fs.writeFileSync(path.join(OUT, 'home-closed.png'), (await win.webContents.capturePage()).toPNG());
  });
  await check('clicked row opens an adjacent sliding preview with explicit source and no route change', async () => {
    const before = await js('Store.revision'), hash = await js('location.hash'); await click(source(0));
    await wait('!document.querySelector("#context-panel").hidden'); await pause(220); const state = await geometry(); fit(state);
    assert.ok(Math.abs(state.p.top - state.r.top) <= 2, JSON.stringify(state));
    assert.ok(Math.abs(state.p.top + state.anchor - (state.r.top + state.r.bottom) / 2) <= 3);
    assert.equal(await js('location.hash'), hash); assert.equal(await js('DNSDesktop.mode'), 'orders'); assert.equal(await js('Store.revision'), before);
    assert.ok((await js('document.querySelector("#selection-summary").textContent')).includes('PREVIEW-8'));
    assert.ok((await js('document.querySelector("#selection-summary").textContent')).includes('0.125'));
    assert.equal(await js('document.querySelector(".selection-source").getAttribute("aria-controls")'), 'context-panel');
    assert.equal(await js('document.querySelector("#context-panel").classList.contains("selection-entering")'), true);
    await pause(320);fs.writeFileSync(path.join(OUT, 'linked-first-row.png'), (await win.webContents.capturePage()).toPNG());
  });
  await check('another row updates the same preview while clicking the active row toggles it closed', async () => {
    await click(source(1)); assert.equal(await js('DNSDesktop.state.selectedId'), fixture.orders[1].id);
    assert.equal(await js('document.querySelectorAll(".selection-source").length'), 1); fit(await geometry());
    assert.ok((await js('document.querySelector("#selection-summary").textContent')).includes('PREVIEW-7'));
    await click(source(1)); assert.equal(await js('document.querySelector("#context-panel").hidden'), true);
    assert.equal(await js('document.querySelectorAll(".selection-source").length'), 0);
  });
  await check('close button and Escape return focus to the selected row and outside click dismisses', async () => {
    await click(source(0)); await click('[data-action=selection-close]');
    assert.equal(await js('document.querySelector("#context-panel").hidden'), true); assert.equal(await js('document.activeElement.dataset.orderId'), fixture.orders[0].id);
    await click(source(0)); await wait('!document.querySelector("#context-panel").hidden'); await key('Escape');
    assert.equal(await js('document.querySelector("#context-panel").hidden'), true); assert.equal(await js('document.activeElement.dataset.orderId'), fixture.orders[0].id);
    await click(source(0)); await click('#statistics-panel .fixed-pane-heading'); assert.equal(await js('document.querySelector("#context-panel").hidden'), true);
  });
  await check('keyboard arrow opens preview and moves focus to detail action', async () => {
    await js(`document.querySelector(${JSON.stringify(source(2))}).focus();void 0`); await key('Right');
    assert.equal(await js('document.querySelector("#context-panel").hidden'), false); assert.equal(await js('document.activeElement.dataset.action'), 'selection-expand');
    await key('Escape'); assert.equal(await js('document.activeElement.dataset.orderId'), fixture.orders[2].id);
  });
  await check('long order uses internal scroll and stays within minimum window bounds near the last rows', async () => {
    win.setContentSize(1024, 680); await pause(120);
    await js(`document.querySelector(${JSON.stringify(source(6))}).scrollIntoView({block:'end',behavior:'instant'});void 0`); await pause(80);
    await click(source(6)); await pause(220); fit(await geometry());
    assert.equal(await js('document.querySelectorAll("#selection-summary .fixed-selection-item").length'), 35);
    assert.equal(await js('document.querySelector("#selection-summary").scrollHeight>document.querySelector("#selection-summary").clientHeight'), true);
    assert.equal(await js('(()=>{const button=document.querySelector("#selection-actions .primary-button"),r=button.getBoundingClientRect();return r.bottom<=innerHeight&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest("button")===button})()'), true);
    await js('document.querySelector("#selection-summary").scrollTop=100;void 0'); await pause(40); assert.equal(await js('document.querySelector("#context-panel").hidden'), false);
    fs.writeFileSync(path.join(OUT, 'linked-long-order-1024.png'), (await win.webContents.capturePage()).toPNG());
    await js(`document.querySelector(${JSON.stringify(source(7))}).scrollIntoView({block:'end',behavior:'instant'});void 0`);await pause(60);await click(source(7));await pause(220);
    const shorter=await geometry();fit(shorter);assert.ok(shorter.p.height<400,JSON.stringify(shorter));
  });
  await check('list scrolling follows its source and closes when the source scrolls out of view', async () => {
    await js('document.querySelector("#dispatch-body").scrollTop=0;void 0'); await pause(90);
    assert.equal(await js('document.querySelector("#context-panel").hidden'), true);
    await click(source(0)); const before = await geometry();
    await js('document.querySelector("#dispatch-body").scrollTop=20;void 0'); await pause(90); fit(await geometry());
    const after = await geometry(); assert.ok(after.p.top <= before.p.top);
    await js('document.querySelector("#dispatch-body").scrollTop=10000;void 0'); await pause(90); assert.equal(await js('document.querySelector("#context-panel").hidden'), true);
  });
  await check('range changes and navigation hide previews while keeping the chosen record identity', async () => {
    await js('document.querySelector("#dispatch-body").scrollTop=0;void 0'); await pause(50); await click(source(0));
    await click('#dispatch-collection [data-range=all]'); assert.equal(await js('document.querySelector("#context-panel").hidden'), true);
    assert.equal(await js('DNSDesktop.state.selectedId'), fixture.orders[0].id);
    await click(source(0)); await click('.nav-item[data-module=products]'); assert.equal(await js('document.querySelector("#context-panel").hidden'), true);
    await js('DNSDesktop.restoreWorkspace();void 0'); await pause(100); assert.equal(await js('document.querySelector("#context-panel").hidden'), true);
  });
  await check('statistics can show a row-attached preview without switching to the full-detail route', async () => {
    win.setContentSize(1440, 1000); await pause(100); await nav('#/stats'); await click(source(1)); await pause(200);
    assert.equal(await js('DNSDesktop.mode'), 'stats'); assert.equal(await js('location.hash'), '#/stats'); fit(await geometry());
    await click('[data-action=selection-close]'); await nav('#/home');
  });
  await check('detail, edit, copy and print remain available and original orders remain intact', async () => {
    await click(source(0)); await click('[data-action=selection-expand]'); await wait('DNSDesktop.mode==="detail"');
    assert.equal(await js('document.querySelector("#desktop-reader").hidden'), false);assert.equal(await js('document.querySelector("#context-panel").hidden'), true);
    assert.equal(await js('!!document.querySelector("#selection-view")'),false);
    await key('Escape');await wait('DNSDesktop.mode==="orders"');assert.equal(await js('document.querySelector("#context-panel").hidden'),false);
    await click('#selection-actions [data-route^="#/order/edit"]'); await wait('DNSDesktop.mode==="task"');
    assert.equal(await js('document.querySelector("#view-container .view").__draft.id'), fixture.orders[0].id);
    await click('.module-window-controls [data-window-action=close]'); await wait('DNSDesktop.mode==="orders"'); assert.equal(await js('document.querySelector("#context-panel").hidden'), false);
    await click('#selection-actions [data-action=copy-order]'); await wait('location.hash==="#/order/new"');
    assert.equal(await js('document.querySelector("#view-container .view").__draft.id'), null);
    assert.equal(await js('document.querySelector("#view-container .view").__draft.items.length'), 2);
    await click('.module-window-controls [data-window-action=close]'); await wait('DNSDesktop.mode==="orders"');
    await click('#selection-actions [data-route^="#/print"]'); await wait('DNSDesktop.mode==="reader"');
    assert.ok((await js('document.querySelector("#print-view").textContent')).includes('PREVIEW-8')); assert.equal(await js('document.querySelector("#context-panel").hidden'), true);
    const pdf = await win.webContents.printToPDF({ printBackground: true }); assert.ok(pdf.length > 2000); fs.writeFileSync(path.join(OUT, 'print-preview.pdf'), pdf);
    await key('Escape'); await wait('DNSDesktop.mode==="orders"'); assert.equal(await js('document.querySelector("#context-panel").hidden'), false);
    assert.equal(await js('Store.countAll().orders'), 8); assert.equal(await js('Store.getOrder(' + JSON.stringify(fixture.orders[0].id) + ').total'), fixture.orders[0].total);
  });
  await check('store refresh keeps source linkage and deletion closes instead of silently showing another record', async () => {
    await js('Store.upsertCustomer({name:"无关客户"});void 0'); await pause(80); fit(await geometry());
    await js('Store.deleteOrder(' + JSON.stringify(fixture.orders[0].id) + ');void 0'); await pause(100);
    assert.equal(await js('document.querySelector("#context-panel").hidden'), true); assert.equal(await js('DNSDesktop.state.selectionOpen'), false);
  });
  await check('resizing and reduced-motion settings keep preview accessible with no permanent right panel', async () => {
    for (const [width, height] of [[1920,1080],[1440,900],[1024,680]]) {
      win.setContentSize(width,height); await pause(100); await js('document.querySelector("#dispatch-body").scrollTop=0;void 0'); await pause(50);
      await click(source(1)); await pause(220); fit(await geometry()); await click('[data-action=selection-close]');
      assert.equal(await js('document.querySelector("#context-panel").checkVisibility()'), false);
    }
    win.webContents.debugger.attach('1.3'); await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await click(source(1)); assert.equal((await geometry()).animation, 'none'); await click('[data-action=selection-close]');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});win.webContents.debugger.detach();
  });
  await check('preview works over the live warehouse scene and blocks scene clicks underneath', async () => {
    win.setContentSize(1440,900);await pause(100);await js('DNSDesktop.setSceneEnabled(true);void 0');await wait('!!DNSDesktop.scene');await pause(200);
    await click(source(1));await pause(550);fit(await geometry());
    const hash=await js('location.hash');
    await click('#context-panel .fixed-pane-heading');assert.equal(await js('location.hash'),hash);assert.equal(await js('document.querySelector("#context-panel").hidden'),false);
    fs.writeFileSync(path.join(OUT,'linked-live-scene.png'),(await win.webContents.capturePage()).toPNG());
    await click('[data-action=selection-close]');await js('DNSDesktop.setSceneEnabled(false);void 0');
  });
  await check('reload starts closed and no uncaught renderer errors occur', async () => {
    win.reload(); await pause(250); await wait('!!window.DNSDesktop?.ready'); assert.equal(await js('document.querySelector("#context-panel").hidden'), true); assert.deepEqual(errors, []);
  });
  fs.writeFileSync(path.join(OUT,'verification.json'),JSON.stringify({results,errors,temp},null,2));clearTimeout(timeout);app.exit(results.every(result=>result.ok)?0:1);
}).catch(error=>{console.error(error);console.error(JSON.stringify(errors));clearTimeout(timeout);app.exit(1);});
