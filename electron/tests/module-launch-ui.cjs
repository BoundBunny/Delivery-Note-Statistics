'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'.shots/module-launch');fs.mkdirSync(OUT,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'dns-module-launch-'));
for(const [key,folder] of Object.entries({DNS_TEST_USER_DATA:'profile',DNS_TEST_DATA_DIR:'data',DNS_TEST_BACKUP_DIR:'backup',DNS_TEST_IMAGE_DIR:'images'}))process.env[key]=path.join(profile,folder);
app.setPath('userData',process.env.DNS_TEST_USER_DATA);app.disableHardwareAcceleration();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),errors=[];
const deadline=setTimeout(()=>{console.error('MODULE_LAUNCH_TIMEOUT');app.exit(1);},90000);
app.on('web-contents-created',(_e,contents)=>contents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message);}));
require(path.join(ROOT,'main.js'));
app.whenReady().then(async()=>{
  let win;for(let i=0;i<200;i++){win=BrowserWindow.getAllWindows()[0];if(win)break;await pause(30);}assert.ok(win);
  const js=code=>win.webContents.executeJavaScript(code,true);
  const wait=async code=>{for(let i=0;i<200;i++){try{if(await js(code))return;}catch(_){}await pause(25);}throw Error('Timeout '+code);};
  const nav=async hash=>{await js('location.hash='+JSON.stringify(hash));await pause(130);};
  const click=async selector=>{
    const point=await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el?.checkVisibility())throw Error('Not visible: '+${JSON.stringify(selector)});const r=el.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
    win.webContents.sendInputEvent({type:'mouseMove',...point});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await pause(50);
  };
  const snapshot=()=>js('JSON.stringify(JSON.parse(Store.exportJSON()).data)');
  const capture=async name=>{await pause(350);fs.writeFileSync(path.join(OUT,name+'.png'),(await win.webContents.capturePage()).toPNG());};
  const opened=async(module,source)=>{
    await wait('DNSDesktop.mode==="task"&&!document.querySelector(".desktop-business-page").hidden');
    const state=await js(`(()=>{const page=document.querySelector('.desktop-business-page'),button=document.querySelector(${JSON.stringify(source)}),trace=document.querySelector('.module-launch-trace'),r=page.getBoundingClientRect();return {module:page.dataset.module,focused:document.activeElement===page,noticed:page.classList.contains('module-noticed'),source:button.classList.contains('module-launch-source'),expanded:button.getAttribute('aria-expanded'),controls:button.getAttribute('aria-controls'),id:page.id,icon:page.querySelector('.module-icon use').getAttribute('href'),status:page.querySelector('#desktop-module-status')?.textContent ?? null,trace:!!trace,tracePointer:trace?getComputedStyle(trace).pointerEvents:null,keyframes:trace?.getAnimations()[0]?.effect.getKeyframes(),timing:trace?.getAnimations()[0]?.effect.getTiming(),traceLeft:trace?.style.left,traceWidth:trace?.style.width,left:r.left,top:r.top,width:r.width,height:r.height};})()`);
    assert.equal(state.module,module);assert.equal(state.focused,true);assert.equal(state.noticed,true);assert.equal(state.source,true);assert.equal(state.expanded,'true');assert.equal(state.controls,state.id);assert.equal(state.icon,module==='products'?'#i-box':'#i-people');assert.equal(state.status,null);assert.equal(state.trace,true);assert.equal(state.tracePointer,'none');assert.ok(state.keyframes.length>=2);
    assert.ok(Math.abs(Number.parseFloat(state.traceLeft)-state.left)<2);assert.ok(Math.abs(Number.parseFloat(state.traceWidth)-state.width)<2);
    assert.equal(state.timing.duration,440);assert.equal(state.keyframes.at(-1).transform,'translate(0px, 0px) scale(1, 1)');
    assert.ok(state.keyframes.every(frame=>!('left' in frame)&&!('top' in frame)&&!('width' in frame)&&!('height' in frame)),'Movement must avoid per-frame layout');
    return state;
  };
  await wait('!!window.DNSDesktop?.ready');win.setContentSize(1440,900);win.show();win.webContents.setBackgroundThrottling(false);await pause(120);
  await js(`Store.clearAll();DNSDesktop.setSceneEnabled(false);Store.upsertProduct({name:'提示测试商品',spec:'555ml',unit:'瓶',price:2});Store.upsertCustomer({name:'提示测试客户',phone:'13800001234'});void 0`);
  const before=await snapshot();
  for(const module of ['products','customers']){
    const source='.nav-item[data-module='+module+']';await click(source);const first=await opened(module,source);
    await capture(module+'-opened');await pause(1100);
    assert.equal(await js('!!document.querySelector(".module-launch-trace,.module-noticed,.module-launch-source")'),false);
    const stable=await js('({...DNSDesktop.moduleWindow.rect})');
    assert.ok(Math.abs(stable.left-first.left)<2&&Math.abs(stable.width-first.width)<2,'Animation drifted saved window geometry');
    await js('window.launchView=document.querySelector("#view-container .view");void 0');await click(source);await opened(module,source);
    assert.equal(await js('document.querySelector("#view-container .view")===launchView'),true);
    assert.equal(await js('document.querySelector(".desktop-business-page").getAnimations().filter(animation=>animation.effect.getKeyframes().some(frame=>frame.opacity!==undefined)).length'),0,'Repeated click must not fade the open window');
    await click('.module-window-controls [data-window-action=close]');await wait('DNSDesktop.mode==="orders"');
    assert.equal(await js('document.activeElement===document.querySelector('+JSON.stringify(source)+')'),true);
    assert.equal(await js('document.querySelector('+JSON.stringify(source)+').getAttribute("aria-expanded")'),'false');
    assert.equal(await js('!!document.querySelector(".module-launch-trace,.module-noticed,.module-launch-source")'),false);
  }
  assert.equal(await snapshot(),before);
  console.log('PASS product/customer navigation launches are linked to their buttons, focus the window, clear cues, replay without remount and restore focus on close; no business writes');

  await click('.nav-item[data-module=products]');await opened('products','.nav-item[data-module=products]');
  await js(`document.querySelector('.products-view [data-act=new]').click();document.querySelector('.products-view [data-role=name]').value='尚未保存的商品';void 0`);
  await click('.nav-item[data-module=products]');await opened('products','.nav-item[data-module=products]');
  assert.equal(await js('document.querySelector(".products-view [data-role=name]").value'),'尚未保存的商品');
  await click('.nav-item[data-module=customers]');await wait('!!document.querySelector("#modal-root .confirm-box")');
  await click('#modal-root [data-act=no]');assert.equal(await js('document.querySelector(".products-view [data-role=name]").value'),'尚未保存的商品');
  assert.equal(await js('document.querySelector(".nav-item[data-module=customers]").getAttribute("aria-expanded")'),'false');
  await click('.nav-item[data-module=customers]');await wait('!!document.querySelector("#modal-root .confirm-box")');await click('#modal-root [data-act=yes]');await opened('customers','.nav-item[data-module=customers]');
  await click('.module-window-controls [data-window-action=close]');await wait('DNSDesktop.mode==="orders"');
  assert.equal(await snapshot(),before);
  console.log('PASS repeated click preserves unsaved forms; canceled switching stays put and confirmed switching cues the chosen module');

  await js('DNSDesktop.setSceneEnabled(true);void 0');await wait('!!DNSDesktop.scene');await pause(200);
  for(const module of ['products','customers']){
    const source='.scene-marker[data-scene-module='+module+']:not([data-scene-category])';await click(source);const state=await opened(module,source);
    assert.ok(state.keyframes[0].transform.includes('scale'));await capture(module+'-scene-opened');
    await click('.module-window-controls [data-window-action=close]');await wait('DNSDesktop.mode==="orders"');
    assert.equal(await js('document.activeElement===document.querySelector('+JSON.stringify(source)+')'),true);
  }
  console.log('PASS scene buttons launch with the same visual source-to-window cue and regain focus on closing');

  win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await wait('matchMedia("(prefers-reduced-motion: reduce)").matches');
  await click('.nav-item[data-module=products]');
  assert.equal(await js('!!document.querySelector(".module-launch-trace")'),false);assert.equal(await js('document.querySelector(".desktop-business-page").classList.contains("module-noticed")'),true);assert.equal(await js('document.activeElement.id'),'desktop-module-window');
  await click('.module-window-controls [data-window-action=close]');await wait('DNSDesktop.mode==="orders"');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});win.webContents.debugger.detach();
  for(const [width,height] of [[1920,1080],[1024,680]]){
    win.setContentSize(width,height);await pause(150);await click('.nav-item[data-module=customers]');await opened('customers','.nav-item[data-module=customers]');
    assert.ok(await js(`(()=>{const page=document.querySelector('.desktop-business-page'),r=page.getBoundingClientRect(),b=page.querySelector('[data-window-action=close]'),c=b.getBoundingClientRect();return r.left>=0&&r.top>=78&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.elementFromPoint(c.left+c.width/2,c.top+c.height/2)?.closest('button')===b;})()`));
    if(width===1024)await capture('customers-minimum');
    await click('.module-window-controls [data-window-action=close]');await wait('DNSDesktop.mode==="orders"');
  }
  assert.equal(await snapshot(),before);assert.deepEqual(errors,[]);
  console.log('PASS reduced-motion uses static cues, 1920/1024 windows remain usable and no renderer errors occur');
  fs.writeFileSync(path.join(OUT,'verification.json'),JSON.stringify({ok:true,errors},null,2));clearTimeout(deadline);app.exit(0);
}).catch(error=>{console.error(error.stack||error);console.error(JSON.stringify(errors));clearTimeout(deadline);app.exit(1);});
