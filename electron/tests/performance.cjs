'use strict';
// Real Electron measurements, always using a disposable profile.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const ROOT=path.resolve(__dirname,'..');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'dns-performance-')));
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const deadline=setTimeout(()=>app.exit(1),90000);
require(path.join(ROOT,'main.js'));
app.whenReady().then(async()=>{
  let win;
  for(let i=0;i<200;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame())break;await pause(50);}
  const js=code=>win.webContents.executeJavaScript(code,true);
  for(let i=0;i<150;i++){if(await js('!!window.DNSDesktop?.scene'))break;await pause(100);}
  win.setContentSize(1440,900);win.webContents.setBackgroundThrottling(false);
  const sample=async()=>{const before=await js('DNSDesktop.scene.stats().frame');await pause(800);return (await js('DNSDesktop.scene.stats().frame'))-before;};
  const report={baseline:process.argv.includes('--baseline'),sampleMs:800,homeFrames:await sample()};
  report.renderer=await js(`(()=>{const c=document.querySelector('#warehouse');const gl=c.getContext('webgl2')||c.getContext('webgl');const ext=gl?.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable';})()`);
  await js("location.hash='#/stats'");await pause(250);report.businessFrames=await sample();
  win.hide();await pause(200);report.hiddenFrames=await sample();win.show();
  await js("location.hash='#/home'");await pause(250);
  report.refresh=await js(`(()=>{const a=[];for(let i=0;i<12;i++){const t=performance.now();DNSDesktop.refresh();a.push(performance.now()-t);}return {meanMs:a.reduce((s,v)=>s+v,0)/a.length,maxMs:Math.max(...a)};})()`);
  report.largeData=await js(`(()=>{Store.clearAll();const orders=Array.from({length:5000},(_,i)=>({id:'perf-'+i,no:'PERF-'+i,date:todayStr(),customer:{id:'c'+i%80,name:'客户'+i%80},items:[{name:'商品',qty:1,price:3.33,amount:3.33}],total:3.33,createdAt:Date.now()-i}));const b=JSON.parse(Store.exportJSON());b.data.orders=orders;const t=performance.now();Store.importJSON(JSON.stringify(b));DNSDesktop.refresh();const importAndRefreshMs=performance.now()-t;const a=[];for(let i=0;i<8;i++){const s=performance.now();DNSDesktop.refresh();a.push(performance.now()-s);}const s=performance.now();const v=Views.stats.render();const statsMs=performance.now()-s;v.dispose?.();return {records:orders.length,importAndRefreshMs,refreshMeanMs:a.reduce((s,v)=>s+v,0)/a.length,statsMs};})()`);
  await pause(100);report.staticFrames=await js('DNSDesktop.scene.setMotion(false);DNSDesktop.scene.stats().frame');await pause(200);report.staticFrames=await sample();
  if(!report.baseline){const assert=require('node:assert/strict');assert.equal(report.businessFrames,0);assert.equal(report.hiddenFrames,0);assert.equal(report.staticFrames,0);}
  fs.mkdirSync(path.join(ROOT,'.shots/standalone'),{recursive:true});
  fs.writeFileSync(path.join(ROOT,'.shots/standalone',report.baseline?'performance-before.json':'performance-after.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));clearTimeout(deadline);app.exit(0);
}).catch(e=>{console.error(e);app.exit(1);});
