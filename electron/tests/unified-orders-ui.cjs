'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, '.shots/unified-orders');fs.mkdirSync(OUT, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-unified-orders-'));
for(const [key,folder] of Object.entries({ DNS_TEST_USER_DATA:'profile',DNS_TEST_DATA_DIR:'data',DNS_TEST_BACKUP_DIR:'backup',DNS_TEST_IMAGE_DIR:'images',DNS_TEST_SAVE_DIR:'exports' }))process.env[key]=path.join(temp,folder);
app.setPath('userData',process.env.DNS_TEST_USER_DATA);app.disableHardwareAcceleration();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),errors=[];
const deadline=setTimeout(()=>{console.error('UNIFIED_ORDERS_TIMEOUT');app.exit(1);},90000);
app.on('web-contents-created',(_event,contents)=>contents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);}));
require(path.join(ROOT,'main.js'));
function worksheet(file){
  const buffer=fs.readFileSync(file);let at=0;
  while(buffer.readUInt32LE(at)===0x04034b50){
    const size=buffer.readUInt32LE(at+18),length=buffer.readUInt16LE(at+26),extra=buffer.readUInt16LE(at+28),start=at+30+length+extra;
    if(buffer.subarray(at+30,at+30+length).toString()==='xl/worksheets/sheet1.xml')return buffer.subarray(start,start+size).toString();
    at=start+size;
  }
  throw Error('Missing worksheet');
}
app.whenReady().then(async()=>{
  let win;for(let i=0;i<200;i++){win=BrowserWindow.getAllWindows()[0];if(win)break;await pause(30);}
  assert.ok(win);
  const js=code=>win.webContents.executeJavaScript(code,true);
  const wait=async code=>{for(let i=0;i<200;i++){try{if(await js(code))return;}catch(_){}await pause(30);}throw Error('Timeout: '+code);};
  const nav=async hash=>{await js('location.hash='+JSON.stringify(hash));await pause(130);};
  const click=async selector=>{await js('document.querySelector('+JSON.stringify(selector)+').click();void 0');await pause(60);};
  const range=key=>click('#dispatch-collection [data-range='+key+']');
  const keyword=async value=>{await js(`(()=>{const input=document.querySelector('#dispatch-collection [data-role=kw]');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));})();void 0`);await pause(240);};
  const rows=()=>js('Array.from(document.querySelectorAll("#dispatch-collection [data-order-id]"),row=>row.dataset.orderId)');
  const metrics=()=>js('({count:document.querySelector("[data-order-count]").textContent,amount:document.querySelector("[data-order-amount]").textContent})');
  const screenshot=async name=>{await pause(180);fs.writeFileSync(path.join(OUT,name+'.png'),(await win.webContents.capturePage()).toPNG());};
  await wait('!!window.DNSDesktop?.ready');win.setContentSize(1440,1000);win.webContents.setBackgroundThrottling(false);
  await js(`Store.clearAll();DNSDesktop.setSceneEnabled(false);window.unified={customer:Store.upsertCustomer({name:'城东商行',phone:'13800001234'}),orders:[]};
    Store.transaction(()=>{for(let i=0;i<12;i++)unified.orders.push(Store.addOrder({no:'UNIFIED-TODAY-'+String(i+1).padStart(2,'0'),date:todayStr(),customer:i%2?null:unified.customer,items:[{name:'怡宝饮用纯净水',spec:'555ml',unit:'瓶',qty:10,price:2,amount:20}],total:20}));
      unified.month=Store.addOrder({no:'UNIFIED-MONTH',date:monthRange()[0],customer:unified.customer,items:[{name:'本月商品',qty:1,price:50,amount:50}],total:50});
      unified.old=Store.addOrder({no:'UNIFIED-HISTORY',date:addDays(monthRange()[0],-1),customer:unified.customer,items:[{name:'历史商品',qty:1,price:100,amount:100}],total:100});
    });window.unifiedBefore=JSON.stringify(JSON.parse(Store.exportJSON()).data);window.unifiedRevision=Store.revision;
    window.unifiedList=document.querySelector('#dispatch-collection .view');void 0`);
  assert.equal(await js('document.querySelector("#dispatch-title").textContent'),'送货单');
  assert.equal(await js('location.hash'),'#/orders');
  assert.deepEqual(await js('Array.from(document.querySelectorAll("#desktop-app .nav-item"),button=>button.dataset.module)'),['orders','products','customers','stats','settings']);
  assert.equal(await js('document.querySelector(".nav-item[aria-current=page]").dataset.module'),'orders');
  assert.equal(await js('!!document.querySelector("[data-module=home],[data-action=dispatch-expand],#desktop-workspace-return")'),false);
  assert.equal(await js('Object.hasOwn(DNSDesktop.state,"listExpanded")'),false);
  assert.equal(await js('document.querySelectorAll("#dispatch-panel [data-role=list]").length'),1);
  assert.equal(await js('document.querySelectorAll("#dispatch-panel .seg").length'),1);
  assert.equal(await js('!!document.querySelector("#dispatch-panel h1,#selection-view")'),false);
  assert.deepEqual(await js('Array.from(document.querySelectorAll("#dispatch-panel [data-range]"),button=>button.dataset.range)'),['today','month','all','custom']);
  assert.equal((await rows()).length,12);
  assert.deepEqual(await metrics(),{count:'12张',amount:'240.00'});
  assert.equal(await js('document.querySelector("#context-panel").hidden'),true);
  await screenshot('unified-home');
  console.log('PASS single order panel defaults to today and displays every matching row beyond the old eight-row cap');

  await range('month');assert.deepEqual(await metrics(),{count:'13张',amount:'290.00'});
  await range('all');assert.deepEqual(await metrics(),{count:'14张',amount:'390.00'});
  await nav('#/orders');assert.equal(await js('document.querySelector("#dispatch-collection .view")===unifiedList'),true);
  assert.deepEqual(await metrics(),{count:'14张',amount:'390.00'});
  await keyword('HISTORY');assert.equal((await rows()).length,1);assert.deepEqual(await metrics(),{count:'1张',amount:'100.00'});
  await click('#dispatch-collection [data-order-id]');
  assert.equal(await js('DNSDesktop.mode'),'orders');assert.equal(await js('location.hash'),'#/orders');
  assert.equal(await js('document.querySelector("#context-panel").hidden'),false);
  assert.ok((await js('document.querySelector("#selection-summary").textContent')).includes('UNIFIED-HISTORY'));
  const id=await js('unified.old.id');assert.equal(await js('document.querySelector(".selection-source").dataset.orderId'),id);
  const width=await js('document.querySelector("#dispatch-panel").getBoundingClientRect().width');
  await nav('#/home');assert.equal(await js('location.hash'),'#/orders');
  assert.equal(await js('document.querySelector("#dispatch-panel").getBoundingClientRect().width'),width);
  assert.equal(await js('document.querySelector("#dispatch-collection .view")===unifiedList'),true);
  assert.equal(await js('document.querySelector("#dispatch-collection [data-role=kw]").value'),'HISTORY');
  assert.equal(await js('document.querySelector("#context-panel").hidden'),false);
  await screenshot('orders-home-flyout');
  await click('[data-action=selection-expand]');assert.equal(await js('DNSDesktop.mode'),'detail');
  assert.equal(await js('document.querySelector("#desktop-reader").hidden'),false);
  assert.equal(await js('document.querySelector("#context-panel").hidden'),true);
  await js('window.__appBack();void 0');await pause(140);
  assert.equal(await js('location.hash'),'#/orders');assert.equal(await js('document.querySelector("#context-panel").hidden'),false);
  assert.equal(await js('document.querySelector("#dispatch-collection [data-role=kw]").value'),'HISTORY');
  await click('[data-action=selection-close]');await nav('#/home');
  assert.equal(await js('document.querySelector("#dispatch-collection .view")===unifiedList'),true);
  assert.deepEqual(await metrics(),{count:'1张',amount:'100.00'});
  console.log('PASS one orders home replaces the old workspace and expand controls; legacy links preserve filters and full-detail return');

  for(const hash of ['#/products','#/customers','#/settings']){
    await nav(hash);
    assert.equal(await js('!!document.querySelector("#desktop-workspace-return")'),false);
    await click('#desktop-app .brand');assert.equal(await js('location.hash'),'#/orders');
    assert.equal(await js('document.querySelector("#dispatch-collection .view")===unifiedList'),true);
    assert.equal(await js('document.querySelector("#dispatch-collection [data-role=kw]").value'),'HISTORY');
  }

  await click('#dispatch-collection [data-act=clear]');await range('custom');
  await js(`(()=>{for(const role of ['from','to']){const input=document.querySelector('#dispatch-collection [data-role='+role+']');input.value=Store.getOrder(unified.old.id).date;input.dispatchEvent(new Event('change',{bubbles:true}));}})();void 0`);
  assert.equal((await rows()).length,1);assert.deepEqual(await metrics(),{count:'1张',amount:'100.00'});
  await keyword('NOT-FOUND');assert.equal((await rows()).length,0);assert.deepEqual(await metrics(),{count:'0张',amount:'0.00'});
  await click('#dispatch-collection [data-act=clear]');
  await js(`const from=document.querySelector('#dispatch-collection [data-role=from]');from.value=todayStr();from.dispatchEvent(new Event('change',{bubbles:true}));void 0`);
  assert.ok((await js('document.querySelector("#dispatch-collection [data-role=sum]").textContent')).includes('无效'));
  assert.equal((await rows()).length,0);
  await range('all');await keyword('UNIFIED-HISTORY');
  await click('#dispatch-collection [data-act=export]');
  const exportPath=path.join(process.env.DNS_TEST_SAVE_DIR,'送货单_全部.xlsx');
  for(let i=0;i<100&&!fs.existsSync(exportPath);i++)await pause(30);
  assert.ok(fs.existsSync(exportPath));const xml=worksheet(exportPath);
  assert.ok(xml.includes('UNIFIED-HISTORY'));assert.ok(!xml.includes('UNIFIED-TODAY')&&!xml.includes('UNIFIED-MONTH'));
  console.log('PASS custom dates, empty results, invalid ranges and export use the same filtered order set as the summary');

  await click('#dispatch-collection [data-act=clear]');await range('today');
  await js('document.querySelector("#dispatch-body").scrollTop=220;void 0');await pause(80);
  const scroll=await js('document.querySelector("#dispatch-body").scrollTop');
  await nav('#/orders');assert.ok(Math.abs(await js('document.querySelector("#dispatch-body").scrollTop')-scroll)<2);
  await nav('#/home');assert.ok(Math.abs(await js('document.querySelector("#dispatch-body").scrollTop')-scroll)<2);
  assert.equal(await js('Store.revision'),await js('unifiedRevision'));
  assert.equal(await js('JSON.stringify(JSON.parse(Store.exportJSON()).data)'),await js('unifiedBefore'));
  await nav('#/orders?customer='+await js('unified.customer.id'));
  assert.ok((await js('document.querySelector("[data-role=customer-filter]").textContent')).includes('城东商行'));
  assert.deepEqual(await metrics(),{count:'8张',amount:'270.00'});
  await click('[data-act=clear-customer-filter]');assert.deepEqual(await metrics(),{count:'14张',amount:'390.00'});
  await range('today');await nav('#/home');
  await js('DNSDesktop.setSceneEnabled(true);void 0');await wait('!!DNSDesktop.scene');
  for(const [width,height] of [[1920,1080],[1440,900],[1024,680]]){
    win.setContentSize(width,height);await pause(160);
      await js('document.querySelector("#dispatch-body").scrollTop=0;void 0');await pause(70);
      await click('#dispatch-collection [data-order-id]');
      await wait(`(()=>{const p=document.querySelector('#context-panel'),r=p.getBoundingClientRect(),list=document.querySelector('#dispatch-panel').getBoundingClientRect();return !p.hidden&&r.left>list.right&&r.right<=innerWidth-10;})()`);
      const geometry=await js(`(()=>{const p=document.querySelector('#context-panel'),r=p.getBoundingClientRect(),list=document.querySelector('#dispatch-panel').getBoundingClientRect(),button=p.querySelector('#selection-actions .primary-button'),b=button.getBoundingClientRect();return {hidden:p.hidden,left:r.left,right:r.right,top:r.top,bottom:r.bottom,listRight:list.right,hit:document.elementFromPoint(b.left+b.width/2,b.top+b.height/2)?.closest('button')===button};})()`);
      assert.ok(!geometry.hidden&&geometry.left>geometry.listRight&&geometry.right<=width-10&&geometry.bottom<=height-10&&geometry.top>=88&&geometry.hit,JSON.stringify({width,height,...geometry}));
      if(width===1440)await screenshot('orders-home-live-flyout');
      if(width===1024)await screenshot('orders-home-minimum-flyout');
      await click('[data-action=selection-close]');
  }
  console.log('PASS fixed responsive order list and row-attached flyout over the live scene at 1920, 1440 and 1024 window widths');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS shared list preserves scroll, customer-specific history remains available and read-only interactions leave business data unchanged');
  fs.writeFileSync(path.join(OUT,'verification.json'),JSON.stringify({ok:true,errors},null,2));clearTimeout(deadline);app.exit(0);
}).catch(error=>{console.error(error.stack||error);console.error(JSON.stringify(errors));clearTimeout(deadline);app.exit(1);});
