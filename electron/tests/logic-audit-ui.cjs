'use strict';
const {app,BrowserWindow,dialog}=require('electron');
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'.shots/logic-review');fs.mkdirSync(OUT,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dns-audit-ui-'));app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();
let saveResult={canceled:true},openPath='',unloadChoice=0,unloadPrompts=0;
dialog.showSaveDialog=async()=>saveResult;dialog.showOpenDialog=async()=>({canceled:!openPath,filePaths:openPath?[openPath]:[]});
dialog.showMessageBoxSync=()=>{unloadPrompts++;return unloadChoice;};
const pause=ms=>new Promise(r=>setTimeout(r,ms)),results=[],errors=[];
app.on('web-contents-created',(_e,w)=>{w.on('console-message',(_e,l,m)=>{if(l>=3)errors.push(m);});});
const timeout=setTimeout(()=>{console.error('AUDIT_TIMEOUT');app.exit(1);},110000);
require(path.join(ROOT,'main.js'));
app.whenReady().then(async()=>{
  let win;for(let i=0;i<150;i++){win=BrowserWindow.getAllWindows()[0];if(win)break;await pause(50);}
  const js=code=>win.webContents.executeJavaScript(code,true);
  const wait=async code=>{for(let i=0;i<150;i++){try{if(await js(code))return;}catch(_){}await pause(50);}throw Error('Timeout: '+code);};
  const nav=async hash=>{await js('location.hash='+JSON.stringify(hash));await pause(100);};
  const check=async(name,fn)=>{try{await fn();results.push({name,ok:true});console.log('PASS '+name);}catch(error){results.push({name,ok:false,error:error.message});console.error('FAIL '+name+': '+error.message);}};
  await wait('!!window.DNSDesktop?.ready');win.setContentSize(1440,900);
  await js(`Store.clearAll();window.messages=[];window.realToast=toast;window.toast=(msg,...args)=>{messages.push(msg);realToast(msg,...args);};void 0`);
  await check('held/double save commits one order and one identity only',async()=>{
    await nav('#/order/new');await js(`const v=document.querySelector('#view-container .view');v.__draft.items=[{name:'Water',spec:'500ml',unit:'瓶',qty:'2',price:'3'}];const b=v.querySelector('[data-act=save]');b.click();b.click();void 0`);await pause(150);
    assert.equal(await js('Store.countAll().orders'),1);assert.equal(await js('DNSDesktop.mode'),'detail');
  });
  await check('negative product prices stay in editor and are not saved',async()=>{
    await nav('#/products?edit=new');await js(`(()=>{const v=document.querySelector('.products-view');v.querySelector('[data-role=name]').value='Bad price';v.querySelector('[data-role=price]').value='-1';v.querySelector('[data-act=form-save]').click();})()`);
    assert.equal(await js('Store.listProducts("Bad price").length'),0);assert.equal(await js('document.querySelector(".products-view [data-role=form]").classList.contains("hidden")'),false);
    await js(`document.querySelector('.products-view [data-act=form-cancel]').click();void 0`);
  });
  await check('new product inline form changes are guarded; cancel keeps fields',async()=>{
    await js(`document.querySelector('.products-view [data-act=new]').click();document.querySelector('.products-view [data-role=name]').value='Unsaved product';DNSDesktop.navigate('#/home');void 0`);await pause(80);
    assert.equal(await js('!!document.querySelector("#modal-root .mask")'),true);await js('document.querySelector("#modal-root [data-act=no]").click();void 0');await pause(50);
    assert.equal(await js('document.querySelector(".products-view [data-role=name]").value'),'Unsaved product');await js('document.querySelector(".products-view [data-act=form-cancel]").click();void 0');
  });
  await check('image-only product edits and reverted fields participate in unsaved checks',async()=>{
    await js(`document.querySelector('.products-view [data-act=new]').click();window.imagePickBefore=window.pickProductImage;window.pickProductImage=async()=> 'E:/temporary-image.png';document.querySelector('.products-view [data-act=pick-image]').click();void 0`);await pause(60);
    await js('DNSDesktop.navigate("#/home");void 0');await pause(70);assert.equal(await js('!!document.querySelector("#modal-root .mask")'),true);
    await js('document.querySelector("#modal-root [data-act=no]").click();void 0');await pause(40);await js('document.querySelector(".products-view [data-act=remove-image]").click();DNSDesktop.navigate("#/home");window.pickProductImage=imagePickBefore;void 0');await pause(120);assert.equal(await js('DNSDesktop.mode'),'home');
  });
  await check('editor internal Back and direct hash navigation cannot discard a dirty order',async()=>{
    await nav('#/order/new');await js(`document.querySelector('#view-container .view').__draft.items=[{name:'Unsaved',qty:'1',price:'2'}];document.querySelector('#view-container [data-act=back]').click();void 0`);await pause(100);
    assert.equal(await js('!!document.querySelector("#modal-root .mask")'),true);await js('document.querySelector("#modal-root [data-act=no]").click();void 0');await pause(60);assert.equal(await js('location.hash'),'#/order/new');
    await nav('#/stats');assert.equal(await js('location.hash'),'#/order/new');assert.equal(await js('!!document.querySelector("#modal-root .mask")'),true);
    await js('document.querySelector("#modal-root [data-act=yes]").click();void 0');await pause(130);assert.equal(await js('DNSDesktop.mode'),'stats');
  });
  await check('company title button edits are detected even without native input events',async()=>{
    await nav('#/settings/company');await js(`document.querySelector('[data-title-field=customer]').click();DNSDesktop.navigate('#/home');void 0`);await pause(70);
    assert.equal(await js('!!document.querySelector("#modal-root .mask")'),true);await js('document.querySelector("#modal-root [data-act=no]").click();void 0');await pause(40);
    await js('document.querySelector("[data-act=save-info]").click();void 0');await pause(140);assert.equal(await js('location.hash'),'#/settings');assert.equal(await js('!!document.querySelector("#modal-root .mask")'),false);
  });
  await check('unconfirmed item dialog edits are protected and disposed after approved navigation',async()=>{
    await nav('#/order/new');await js(`document.querySelector('#view-container [data-act=add-item]').click();document.querySelector('.item-dialog [data-role=name]').value='Pending line';location.hash='#/home';void 0`);await pause(120);
    assert.equal(await js('location.hash'),'#/order/new');assert.equal(await js('document.querySelectorAll("#modal-root .mask").length'),2);
    await js('document.querySelector("#modal-root .confirm-box [data-act=yes]").click();void 0');await pause(130);assert.equal(await js('DNSDesktop.mode'),'home');assert.equal(await js('!!document.querySelector(".item-dialog")'),false);
  });
  await check('customer related orders use exact identity and ignore stale date/keyword filters',async()=>{
    await js(`const c1=Store.upsertCustomer({name:'同名客户'}),c2=Store.upsertCustomer({name:'同名客户'});window.related={c1,c2};Store.addOrder({no:'OLD-C1',date:'2025-01-01',customer:c1,items:[{name:'Water',qty:1,price:6,amount:6}],total:6});Store.addOrder({no:'NEW-C2',date:todayStr(),customer:c2,items:[{name:'Water',qty:1,price:6,amount:6}],total:6});Views.orders.state.range='month';Views.orders.state.kw='stale';void 0`);
    await nav('#/customers');await js(`document.querySelector('[data-item-id="'+related.c1.id+'"]').click();void 0`);await pause(60);await js('document.querySelector("#modal-root [data-o=orders]").click();void 0');await pause(140);
    assert.equal(await js('document.querySelectorAll("#dispatch-collection [data-open]").length'),1);assert.ok((await js('document.querySelector("#dispatch-collection").textContent')).includes('OLD-C1'));assert.ok(!(await js('document.querySelector("#dispatch-collection").textContent')).includes('NEW-C2'));
  });
  await check('canceled backup and spreadsheet saves never report export success',async()=>{
    await nav('#/settings');await js(`messages.length=0;document.querySelector('[data-act=backup]').click();void 0`);await pause(180);assert.equal(await js('messages.some(m=>m.includes("备份已导出"))'),false);
    await js(`messages.length=0;document.querySelector('[data-act=exp-products]').click();void 0`);await pause(180);assert.equal(await js('messages.some(m=>m.includes("已导出"))'),false);
    saveResult={canceled:false,filePath:path.join(temp,'backup.json')};await js('document.querySelector("[data-act=backup]").click();void 0');await wait('messages.includes("备份已导出")');assert.equal(fs.existsSync(saveResult.filePath),true);
  });
  await check('statistics keeps distinct customers and products separate when display names match',async()=>{
    await js(`const p1=Store.upsertProduct({name:'Same item',spec:'500ml',price:2,barcode:'111'}),p2=Store.upsertProduct({name:'Same item',spec:'500ml',price:4,barcode:'222'});Store.addOrder({no:'IDENTITY-1',date:todayStr(),customer:related.c1,items:[{pid:p1.id,name:'Same item',spec:'500ml',qty:1,price:2,amount:2}],total:2});Store.addOrder({no:'IDENTITY-2',date:todayStr(),customer:related.c2,items:[{pid:p2.id,name:'Same item',spec:'500ml',qty:1,price:4,amount:4}],total:4});void 0`);
    await nav('#/stats');
    assert.equal(await js('Array.from(document.querySelectorAll("[data-role=custRank] .hb-name")).filter(el=>el.textContent==="同名客户").length'),2);
    assert.equal(await js('Array.from(document.querySelectorAll("[data-role=prodRank] .pr-title")).filter(el=>el.textContent==="Same item").length'),2);
  });
  await check('invalid date ranges cannot be exported as successful empty reports',async()=>{
    await nav('#/stats');await js(`document.querySelector('#statistics-view [data-range=custom]').click();const from=document.querySelector('#statistics-view [data-role=from]'),to=document.querySelector('#statistics-view [data-role=to]');from.value='2026-12-31';to.value='2026-01-01';from.dispatchEvent(new Event('change',{bubbles:true}));window.originalSave=Android.saveFile;window.auditExports=0;Android.saveFile=async()=>{auditExports++;return {ok:true};};document.querySelector('#statistics-view [data-act=export]').click();void 0`);await pause(100);
    assert.equal(await js('auditExports'),0);assert.ok((await js('document.querySelector("#toast").textContent')).includes('开始日期'));await js('Android.saveFile=originalSave;Views.stats.state.range="month";void 0');
  });
  await check('window-close and reload cancellation preserve dirty drafts; explicit discard permits reload',async()=>{
    await nav('#/order/new');await js(`document.querySelector('#view-container .view').__draft.items=[{name:'Do not lose',qty:'1',price:'2'}];void 0`);unloadChoice=0;win.reload();await pause(350);
    assert.equal(unloadPrompts,1);assert.equal(await js('document.querySelector("#view-container .view").__draft.items[0].name'),'Do not lose');
    win.close();await pause(200);assert.equal(win.isDestroyed(),false);assert.equal(unloadPrompts,2);
    unloadChoice=1;win.reload();await pause(300);await wait('!!window.DNSDesktop?.ready');assert.equal(unloadPrompts,3);
  });
  await check('corrupt storage remains unchanged, recovery export preserves raw bytes and restore clears protection',async()=>{
    await nav('#/home');const valid=await js('Store.exportJSON()');const bad='[{"broken-record"';await js('localStorage.setItem("sd_v1_orders",'+JSON.stringify(bad)+');void 0');win.reload();await pause(300);await wait('!!window.DNSDesktop?.ready');
    assert.equal(await js('Store.recoveryState().blocked'),true);assert.equal(await js('localStorage.getItem("sd_v1_orders")'),bad);assert.equal(await js('document.querySelector("#storage-recovery-notice").hidden'),false);
    assert.ok((await js('document.querySelector("#dispatch-body").textContent')).includes('暂不可用'));assert.equal(await js('!!document.querySelector("#selection-summary [data-route=\"#/order/new\"]")'),false);
    saveResult={canceled:false,filePath:path.join(temp,'raw-recovery.json')};await js('document.querySelector("[data-action=export-recovery]").click();void 0');
    for(let i=0;i<50&&!fs.existsSync(saveResult.filePath);i++)await pause(50);
    assert.ok(fs.existsSync(saveResult.filePath),await js('document.querySelector("#toast")?.textContent||"No export feedback"'));
    assert.equal(JSON.parse(fs.readFileSync(saveResult.filePath,'utf8')).raw.sd_v1_orders,bad);
    fs.writeFileSync(path.join(OUT,'recovery.png'),(await win.webContents.capturePage()).toPNG());
    await nav('#/settings');openPath=path.join(temp,'valid.json');fs.writeFileSync(openPath,valid);await js('document.querySelector("[data-act=restore]").click();void 0');await pause(60);await js('document.querySelector("#modal-root [data-act=yes]").click();void 0');await wait('!Store.recoveryState().blocked');
    assert.equal(await js('document.querySelector("#storage-recovery-notice").hidden'),true);assert.equal(await js('Store.countAll().orders'),5);
  });
  await check('reviewed workflows produce no uncaught renderer errors',async()=>assert.deepEqual(errors,[]));
  fs.writeFileSync(path.join(OUT,'ui-verification.json'),JSON.stringify({results,errors,profile:temp},null,2));clearTimeout(timeout);app.exit(results.every(r=>r.ok)?0:1);
}).catch(e=>{console.error(e);app.exit(1);});
