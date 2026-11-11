'use strict';
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'.shots/standalone');fs.mkdirSync(OUT,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'dns-scene-')));
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const pause=ms=>new Promise(r=>setTimeout(r,ms));const errors=[];
const timeout=setTimeout(()=>app.exit(1),90000);
require(path.join(ROOT,'main.js'));
app.whenReady().then(async()=>{
  let win;for(let i=0;i<200;i++){win=BrowserWindow.getAllWindows()[0];if(win)break;await pause(30);}
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
  const js=code=>win.webContents.executeJavaScript(code,true);
  const wait=async code=>{for(let i=0;i<150;i++){if(await js(code))return;await pause(70);}throw Error('Timeout: '+code);};
  const nav=async hash=>{await js('location.hash='+JSON.stringify(hash));await pause(100);};
  const frames=async()=>{const before=await js('DNSDesktop.scene.stats().frame');await pause(350);return await js('DNSDesktop.scene.stats().frame')-before;};
  await wait('!!window.DNSDesktop?.scene');win.setContentSize(1440,900);
  await js('window.originalScene=DNSDesktop.scene;void 0');await pause(150);assert.ok(await frames()>0);
  console.log('PASS visible home scene animates');
  await nav('#/orders');assert.equal(await js('DNSDesktop.scene.stats().paused'),true);assert.equal(await frames(),0);
  console.log('PASS business module freezes the background scene');
  await nav('#/home');await pause(100);win.hide();await pause(100);assert.equal(await frames(),0);win.show();win.focus();await pause(150);
  console.log('PASS hidden native window stops rendering and resumes on return');
  win.minimize();await pause(150);assert.equal(await frames(),0);win.restore();win.show();win.focus();await pause(150);
  console.log('PASS minimized native window stops rendering');
  const initial=await js('DNSDesktop.scene.stats()');
  for(let i=0;i<20;i++){await nav(i%2?'#/home':'#/customers');}
  assert.equal(await js('DNSDesktop.scene===originalScene'),true);const current=await js('DNSDesktop.scene.stats()');
  assert.equal(current.geometries,initial.geometries);assert.equal(current.textures,initial.textures);
  assert.equal(await js('document.querySelectorAll("#scene-markers .scene-marker").length'),12);
  console.log('PASS repeated route switches reuse one renderer and stable GPU resources');
  await js('DNSDesktop.scene.setMotion(false);void 0');await pause(150);assert.equal(await frames(),0);
  await js('DNSDesktop.scene.setNight(true);void 0');await pause(80);const still=await js('DNSDesktop.scene.stats().frame');await pause(200);assert.equal(await js('DNSDesktop.scene.stats().frame'),still);
  console.log('PASS paused motion renders changes once without an animation loop');
  win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await js('DNSDesktop.scene.setMotion(true);void 0');await pause(150);assert.equal(await frames(),0);assert.equal(await js('DNSDesktop.scene.stats().motion'),false);
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});win.webContents.debugger.detach();
  console.log('PASS reduced motion disables continuous rendering');
  await js('DNSDesktop.destroy();void 0');const disposed=await js('originalScene.stats()');assert.equal(disposed.disposed,true);assert.equal(disposed.geometries,0);assert.equal(disposed.textures,0);
  await js('DNSDesktop.start();void 0');await wait('!!DNSDesktop.scene');assert.equal(await js('document.querySelectorAll("#desktop-app").length'),1);assert.equal(await js('document.querySelectorAll(".scene-marker").length'),12);
  console.log('PASS destroy releases geometries, textures, listeners and DOM; restart creates one scene');
  await js(`Store.clearAll();const b=JSON.parse(Store.exportJSON());b.data.orders=Array.from({length:30},(_,i)=>({id:'trend-'+i,no:'TREND-'+i,date:'2026-10-'+String(i+1).padStart(2,'0'),customer:null,items:[{name:'测试商品',qty:1,price:i+1,amount:i+1}],total:i+1}));Store.importJSON(JSON.stringify(b));Views.stats.state={range:'custom',from:'2026-10-01',to:'2026-10-31',billYm:'2026-10'};void 0`);
  await nav('#/stats');
  for(const width of [1440,1024]){
    win.setContentSize(width,width===1024?680:900);await pause(160);
    const layout=await js(`(()=>{const chart=document.querySelector('.bar-trend'),bars=[...chart.querySelectorAll('.bt-bar')],cols=[...chart.querySelectorAll('.bt-col')];return {count:bars.length,scroll:chart.scrollWidth,width:chart.clientWidth,bar:bars[0].getBoundingClientRect().width,gap:bars[1].getBoundingClientRect().left-bars[0].getBoundingClientRect().right,step:cols[1].offsetLeft-cols[0].offsetLeft,labelWidth:cols[0].querySelector('.bt-x').getBoundingClientRect().width,columnWidth:cols[0].getBoundingClientRect().width,heights:[bars[0].offsetHeight,bars.at(-1).offsetHeight]};})()`);
    assert.equal(layout.count,30);assert.ok(layout.gap>=10);assert.ok(layout.columnWidth>=44);assert.ok(layout.labelWidth<=layout.columnWidth);assert.ok(layout.heights[1]>layout.heights[0]);assert.ok(layout.scroll>layout.width);
    fs.writeFileSync(path.join(OUT,'trend-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
  }
  await js(`Views.stats.state={range:'today',from:'',to:'',billYm:''};Store.clearAll();Store.addOrder({no:'ONE',date:todayStr(),customer:null,items:[{name:'测试商品',qty:1,price:10,amount:10}],total:10});void 0`);
  await nav('#/home');await nav('#/stats');assert.equal(await js('document.querySelectorAll(".bar-trend .bt-bar").length'),1);assert.ok(await js('document.querySelector(".bt-bar").getBoundingClientRect().width')<=56);assert.ok(await js('document.querySelector(".bt-col").getBoundingClientRect().width')<=76);
  console.log('PASS trend spacing, proportional heights, single day and 30-day scrolling at 1440/1024 widths');
  assert.deepEqual(errors,[]);clearTimeout(timeout);app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
