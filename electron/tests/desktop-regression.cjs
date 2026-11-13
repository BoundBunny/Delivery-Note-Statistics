'use strict';
const {app,BrowserWindow} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname,'..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'dns-desktop-live-'));
for(const [key,folder] of Object.entries({DNS_TEST_DATA_DIR:'data',DNS_TEST_BACKUP_DIR:'backup',DNS_TEST_IMAGE_DIR:'images'}))process.env[key]=path.join(profile,folder);
const OUT = path.join(ROOT,'.shots/electron-live');fs.mkdirSync(OUT,{recursive:true});
app.setPath('userData',profile);
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
const errors=[], requests=[], results=[];
app.on('web-contents-created',(_event,contents)=>{
  contents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
  contents.on('did-fail-load',(_e,code,description,url)=>errors.push('LOAD '+code+' '+description+' '+url));
  if(contents.setBackgroundThrottling)contents.setBackgroundThrottling(false);
});
const deadline=setTimeout(()=>{console.error('DESKTOP_TIMEOUT');app.exit(1);},100000);
require(path.join(ROOT,'main.js'));
app.whenReady().then(async()=>{
  let win;
  for(let i=0;i<100;i++){win=BrowserWindow.getAllWindows()[0];if(win)break;await pause(50);}
  if(!win)throw new Error('Main window was not created');
  const js=code=>win.webContents.executeJavaScript(code,true);
  const wait=async expression=>{for(let i=0;i<150;i++){try{if(await js(expression))return;}catch(_){}await pause(80);}throw new Error('Timed out: '+expression+' '+JSON.stringify({errors,state:await js('({active:window.__dnsWindowActive,hidden:document.hidden,message:document.querySelector("#scene-loading")?.textContent,three:!!window.THREE})')}));};
  const nav=async hash=>{await js('location.hash='+JSON.stringify(hash));await pause(160);};
  const check=async(name,action)=>{try{await action();results.push({name,ok:true});console.log('PASS '+name);}catch(error){results.push({name,ok:false,error:error.message});console.error('FAIL '+name+': '+error.message);}};
  win.webContents.session.webRequest.onBeforeRequest((details,callback)=>{if(/^https?:/i.test(details.url))requests.push(details.url);callback({cancel:false});});
  await wait('!!window.DNSDesktop?.ready');
  win.show();
  win.setContentSize(1440,900);
  await wait('!!window.DNSDesktop.scene');await pause(350);
  await js(`window.pause=ms=>new Promise(r=>setTimeout(r,ms));void 0`);
  await check('independent entry and production Store use local business resources',async()=>{
    assert.equal(decodeURIComponent(new URL(win.webContents.getURL()).pathname).replace(/^\//,''),path.join(ROOT,'webapp/index.html').replaceAll('\\','/'));
    assert.equal(await js('Android.isDesktop'),true);
    assert.equal(await js('typeof Store.exportJSON'), 'function');
    assert.equal(await js('document.querySelectorAll("#desktop-app .metric").length'),4);
    assert.equal(await js('getComputedStyle(document.querySelector("#desktop-app .app-header")).position'),'fixed');
    assert.equal(await js('getComputedStyle(document.querySelector("#desktop-app .app-header")).height'),'78px');
  });
  await check('empty real data never shows prototype customers, orders or prices',async()=>{
    await js('Store.clearAll();DNSDesktop.refresh();void 0');
    assert.equal(await js('Store.countAll().orders'),0);
    const text=await js('document.getElementById("desktop-app").textContent');
    assert.ok(text.includes('第一张送货单'));
    assert.ok(!text.includes('兴旺超市')&&!text.includes('20261108-018')&&!text.includes('示例数据'));
    assert.equal(await js('document.querySelector(".scene-marker[data-scene-module=products] .marker-number").textContent'),'0 种');
    await pause(120);
    fs.writeFileSync(path.join(OUT,'empty.png'),(await win.webContents.capturePage()).toPNG());
  });
  await js(`(() => {
    const customer=Store.upsertCustomer({name:'测试客户A',address:'测试地址 18 号',phone:'12345678'});
    const product=Store.upsertProduct({name:'测试饮用水',spec:'500ml',unit:'瓶',price:3.33,category:'drink'});
    const previous=addDays(monthRange(todayStr())[0],-1);
    const old=Store.addOrder({no:'SD-OLD-001',date:previous,customer,items:[{pid:product.id,name:product.name,spec:product.spec,unit:'瓶',qty:1,price:100,amount:100}],total:100});
    const order=Store.addOrder({no:Store.nextOrderNo(todayStr()),date:todayStr(),customer,items:[{pid:product.id,name:product.name,spec:product.spec,unit:'瓶',qty:1,price:1234.56,amount:1234.56}],total:1234.56,note:'请当面核对'});
    Store.setSettings({company:'测试业务公司'});window.fixture={customer,product,old,order};DNSDesktop.refresh();
  })()`);
  await check('live metrics and selected order use the real current-month records',async()=>{
    const values=await js('Array.from(document.querySelectorAll("#desktop-app .metric .value")).map(el=>el.textContent)');
    assert.ok(values[0].startsWith('1'));assert.equal(values[1],'1,234.56');assert.equal(values[2],'1,234.56');
    await js('DNSDesktop.selectOrder(fixture.order.id);void 0');assert.ok((await js('document.querySelector("#context-panel .order-total").textContent')).includes('1,234.56'));
  });
  await check('approved scene layout and real catalog are rendered',async()=>{
    assert.ok((await js('DNSDesktop.scene.stats().triangles'))>3000);
    await js('DNSDesktop.setPanel("products","drink");void 0');
    await pause(150);
    const text=await js('document.getElementById("view-container").textContent');assert.ok(text.includes('测试饮用水')&&text.includes('3.33'));
    await js('DNSDesktop.setPanel("home");void 0');await pause(300);
    fs.writeFileSync(path.join(OUT,'workspace.png'),(await win.webContents.capturePage()).toPNG());
  });
  await check('navigation opens existing order collection in its fixed zone',async()=>{
    await nav('#/orders');assert.equal(await js('document.querySelector("#dispatch-title").textContent'),'送货单');
    assert.equal(await js('DNSDesktop.scene.stats().paused'),false);
    assert.equal(await js('document.querySelector(".desktop-business-page").hidden'),true);
    assert.equal(await js('document.body.classList.contains("desktop-business-mode")'),false);
    fs.writeFileSync(path.join(OUT,'orders.png'),(await win.webContents.capturePage()).toPNG());
  });
  await check('original new-order form writes persistent business records',async()=>{
    await nav('#/order/new');
    await js(`(() => {const view=document.querySelector('#view-container .view');view.__draft.customer={...fixture.customer};view.__draft.items=[{pid:fixture.product.id,name:fixture.product.name,spec:fixture.product.spec,unit:'瓶',qty:'2',price:'3.33'}];view.querySelector('[data-act=save]').click();})()`);
    await pause(250);assert.equal(await js('Store.countAll().orders'),3);assert.equal(await js('Store.listOrders()[0].total'),6.66);
    assert.equal(await js('Store.getOrder(DNSDesktop.state.selectedId).total'),6.66);
    const info = await js('Android.getStorageInfo()');
    const diskOrders = JSON.parse(fs.readFileSync(path.join(info.info.dataDir, 'sd_v1_orders.json'), 'utf8'));
    assert.ok(diskOrders.some(order => order.total === 6.66));
    assert.equal(await js('localStorage.getItem("sd_v1_orders")'), null);
    await win.reload();await wait('!!window.DNSDesktop?.ready');assert.equal(await js('Store.countAll().orders'),3);
    await js('window.fixture={order:Store.listOrders().find(o=>o.total===1234.56),product:Store.listProducts().find(p=>p.name==="测试饮用水"),customer:Store.listCustomers()[0]};void 0');
  });
  await check('copy from workspace creates a new ID without changing source order',async()=>{
    await nav('#/home');await js('DNSDesktop.selectOrder(fixture.order.id);window.beforeOriginal=JSON.stringify(Store.getOrder(fixture.order.id));document.querySelector("#desktop-app [data-action=copy-order]").click();void 0');await pause(200);
    assert.equal(await js('document.querySelector("#view-container .view").__draft.id'),null);
    await js('document.querySelector("#view-container [data-act=save]").click();void 0');await pause(200);
    assert.equal(await js('Store.countAll().orders'),4);assert.equal(await js('JSON.stringify(Store.getOrder(fixture.order.id))===window.beforeOriginal'),true);
  });
  await check('native print route hides desktop chrome when printing',async()=>{
    await nav('#/home');await js(`DNSDesktop.selectOrder(fixture.order.id);document.querySelector('#desktop-app [data-route^="#/print"]').click();void 0`);await pause(200);
    assert.equal(await js('!!document.getElementById("print-view")'),true);
    win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{media:'print'});
    assert.equal(await js('getComputedStyle(document.getElementById("desktop-app")).display'),'none');
    assert.equal(await js('getComputedStyle(document.getElementById("toast")).display'),'none');
    assert.notEqual(await js('getComputedStyle(document.querySelector(".desktop-reading-page")).display'),'none');
    assert.equal(await js('getComputedStyle(document.querySelector(".desktop-business-page")).display'),'none');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{media:''});win.webContents.debugger.detach();
    const pdf=await win.webContents.printToPDF({printBackground:true});assert.ok(pdf.length>2000);fs.writeFileSync(path.join(OUT,'print-preview.pdf'),pdf);
  });
  await check('product and customer detail links open the real edit forms',async()=>{
    const ids=await js('({product:fixture.product.id,customer:fixture.customer.id})');
    await nav('#/products?edit='+ids.product);
    assert.equal(await js('document.querySelector("#view-container [data-role=form] [data-role=name]").value'),'测试饮用水');
    await nav('#/customers?edit='+ids.customer);
    assert.equal(await js('document.querySelector("#view-container [data-role=name]").value'),'测试客户A');
  });
  await check('global search opens the selected real customer in its module window',async()=>{
    await js('const input=document.getElementById("global-search");input.value="测试客户A";input.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("[data-search-customer]").click();void 0');await pause(250);
    assert.equal(await js('document.querySelector("#view-container [data-role=address]").value'),'测试地址 18 号');
  });
  await check('customer letter navigation accounts for the fixed desktop header',async()=>{
    await js(`Store.transaction(()=>{for(const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')for(let i=0;i<3;i++)Store.upsertCustomer({name:letter+'测试客户'+i});});void 0`);
    await nav('#/customers');await pause(250);
    await js('document.querySelector("[data-customer-letter=M]").click();void 0');await pause(750);
    const layout=await js(`(()=>{const header=document.querySelector('#desktop-app .app-header').getBoundingClientRect(),toolbar=document.querySelector('.customer-toolbar').getBoundingClientRect(),group=document.querySelector('[data-customer-group=M]').getBoundingClientRect();return {header:header.bottom,toolbar:toolbar.top,group:group.top};})()`);
    assert.ok(layout.toolbar>=layout.header-1&&layout.group>=layout.header,JSON.stringify(layout));
  });
  await check('restoring a backup refreshes live workspace without sample records',async()=>{
    await nav('#/settings');
    await js('window.beforeBackupProducts=Store.listProducts().length;window.backup=Store.exportJSON();Store.upsertProduct({name:"临时商品"});Store.importJSON(window.backup);void 0');await nav('#/home');
    assert.equal(await js('Store.listProducts().length'),await js('beforeBackupProducts'));assert.equal(await js('Store.countAll().orders'),4);
    assert.equal(await js('Store.listProducts().some(p=>p.name==="临时商品")'),false);
    assert.equal(await js('document.getElementById("desktop-app").textContent.includes("示例数据")'),false);
  });
  await check('scene preference uses its own key and survives reload',async()=>{
    await js('DNSDesktop.setSceneEnabled(false);void 0');assert.equal(await js('DNSDesktop.sceneEnabled()'),false);assert.equal(await js('DNSDesktop.scene.stats().paused'),true);
    await win.reload();await wait('!!window.DNSDesktop?.ready');assert.equal(await js('DNSDesktop.sceneEnabled()'),false);assert.equal(await js('Store.countAll().orders'),4);
    await js('DNSDesktop.setSceneEnabled(true);void 0');await wait('!!DNSDesktop.scene');
  });
  await check('minimum desktop viewport keeps navigation and actions usable',async()=>{
    win.setContentSize(1024,680);await pause(300);
    assert.ok((await js('document.documentElement.scrollWidth'))<=(await js('innerWidth')));
    assert.equal(await js('document.querySelectorAll("#desktop-app .nav-item").length'),5);
    await nav('#/order/new');assert.ok(await js('!!document.querySelector("#view-container [data-act=save]")'));
    fs.writeFileSync(path.join(OUT,'minimum-edit.png'),(await win.webContents.capturePage()).toPNG());
  });
  await check('print shortcut protects unsaved forms and previews saved orders',async()=>{
    await nav('#/order/new');
    await js('DNSDesktop.printCurrent();void 0');assert.equal(await js('location.hash'),'#/order/new');
    await nav('#/home');await js('DNSDesktop.printCurrent();void 0');await pause(200);
    assert.ok((await js('location.hash')).startsWith('#/print?id='));
  });
  await check('large currency values remain fully readable in small windows',async()=>{
    await js(`window.largeBackup=Store.exportJSON();Store.addOrder({no:'SD-LARGE',date:todayStr(),customer:null,items:[{name:'大额测试',qty:1,price:99999999999.99,amount:99999999999.99}],total:99999999999.99});void 0`);
    await nav('#/home');await pause(200);
    const fits=await js('(()=>{const values=Array.from(document.querySelectorAll(".fixed-pane .metric.money .value"));return values.length===2&&values.every(el=>el.scrollWidth<=el.parentElement.clientWidth+1);})()');assert.equal(fits,true);
    await js('Store.importJSON(window.largeBackup);DNSDesktop.refresh();void 0');
  });
  await check('day and night controls update the scoped desktop scene',async()=>{
    await nav('#/home');
    const night=await js('DNSDesktop.scene.stats().night');
    const before=await js('getComputedStyle(document.getElementById("scene-surface")).backgroundImage');
    await js('document.querySelector("#desktop-app [data-action=lighting]").click();void 0');await pause(150);
    assert.equal(await js('DNSDesktop.scene.stats().night'),!night);
    assert.notEqual(await js('getComputedStyle(document.getElementById("scene-surface")).backgroundImage'),before);
    fs.writeFileSync(path.join(OUT,'night.png'),(await win.webContents.capturePage()).toPNG());
    await js('document.querySelector("#desktop-app [data-action=lighting]").click();void 0');
  });
  await check('desktop stays offline and emits no renderer errors',async()=>{assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);});
  fs.writeFileSync(path.join(OUT,'verification.json'),JSON.stringify({profile,results,requests,errors},null,2));
  clearTimeout(deadline);win.destroy();app.exit(results.every(result=>result.ok)?0:1);
}).catch(error=>{console.error(error.stack||error);app.exit(1);});
