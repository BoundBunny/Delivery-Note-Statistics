'use strict';
// 复现：删除商品后放大应用窗口，3D 场景变空白（只剩标签）
const {app,BrowserWindow,nativeImage} = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname,'..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'dns-scene-repro-'));
const OUT = path.join(ROOT,'.shots/design'); fs.mkdirSync(OUT,{recursive:true});
app.setPath('userData',profile);
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const pause = ms => new Promise(r=>setTimeout(r,ms));
const errors=[];
app.on('web-contents-created',(_e,contents)=>{
  contents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
  if(contents.setBackgroundThrottling)contents.setBackgroundThrottling(false);
});
const deadline=setTimeout(()=>{console.error('TIMEOUT');console.error(errors.join('\n'));app.exit(1);},120000);
require(path.join(ROOT,'main.js'));

// 统计某块截图中“有颜色/偏暗”的像素比例；空白 3D 区域该值会很低
function coloredRatio(img){
  const b=img.getBitmap(); let colored=0,total=0;
  for(let i=0;i<b.length;i+=4){const B=b[i],G=b[i+1],R=b[i+2],A=b[i+3];total++;const mx=Math.max(R,G,B),mn=Math.min(R,G,B);if(A>10&&(mx-mn>22||mx<175))colored++;}
  return +(colored/Math.max(1,total)).toFixed(4);
}

app.whenReady().then(async()=>{
  let win;
  for(let i=0;i<100;i++){win=BrowserWindow.getAllWindows()[0];if(win)break;await pause(50);}
  if(!win)throw new Error('no window');
  const js=code=>win.webContents.executeJavaScript(code,true);
  const wait=async expr=>{for(let i=0;i<160;i++){try{if(await js(expr))return;}catch(_){}await pause(80);}throw new Error('timeout '+expr);};
  await wait('!!window.DNSDesktop?.ready');
  win.show(); win.setContentSize(1180,820); await pause(300);
  await wait('!!window.DNSDesktop.scene'); await pause(600);
  await js('DNSDesktop.scene.setMotion(false);void 0'); await pause(300);
  const sceneRect=()=>js(`(()=>{const r=document.getElementById('scene-surface').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};})()`);
  const snap=async(name)=>{const r=await sceneRect();const img=await win.webContents.capturePage(r);fs.writeFileSync(path.join(OUT,name),(await img.toPNG()));return coloredRatio(img);};
  const state=()=>js(`(()=>({bg:window.DNSBackground?window.DNSBackground.stats():null,paused:!!document.querySelector('.scene-paused'),canvasW:document.getElementById('warehouse').width,canvasH:document.getElementById('warehouse').height,hostW:document.getElementById('scene-surface').clientWidth,hostH:document.getElementById('scene-surface').clientHeight,hash:location.hash,moduleOpen:!!document.querySelector('.desktop-business-page')&&!document.querySelector('.desktop-business-page').hidden}))()`);

  const p = await js(`(()=>{const x=Store.listProducts()[0];return {id:x.id,name:x.name};})()`);
  console.log('product',JSON.stringify(p));
  console.log('baseline colored=',await snap('repro-1-home-before.png'),'state=',JSON.stringify(await state()));

  // 打开商品管理 → 删除该商品 → 回工作台
  await js(`location.hash='#/products'`); await pause(500);
  const del=await js(`(()=>{const r=Store.deleteProduct(${JSON.stringify(p.id)});DNSDesktop.refresh();return r;})()`);
  console.log('delete result',JSON.stringify(del));
  await pause(500);
  await snap('repro-2-products-deleted.png');
  await js(`location.hash='#/home'`); await pause(900);
  console.log('home-after-delete colored=',await snap('repro-3-home-after-delete.png'),'state=',JSON.stringify(await state()));

  // 放大整个应用窗口
  // 场景：在商品管理任务窗口打开时缩放整个应用窗口，再回到工作台
  await js(`location.hash='#/products'`); await pause(500);
  win.setContentSize(1500,950); await pause(800);
  console.log('module-paused-resized colored=',await snap('repro-6-module-resized.png'),'state=',JSON.stringify(await state()));
  await js(`location.hash='#/home'`); await pause(1000);
  console.log('home-after-module-resize colored=',await snap('repro-7-home-after-module-resize.png'),'state=',JSON.stringify(await state()));

  win.maximize(); await pause(1500);
  console.log('after-max colored=',await snap('repro-4-home-after-max.png'),'state=',JSON.stringify(await state()));
  await pause(600);
  console.log('after-max-2 colored=',await snap('repro-5-home-after-max-2.png'),'state=',JSON.stringify(await state()));

  console.log('ERRORS',JSON.stringify(errors));
  clearTimeout(deadline);
  app.exit(0);
}).catch(async e=>{console.error('REPRO ERROR',e&&e.stack||e);console.error(errors.join('\n'));clearTimeout(deadline);app.exit(1);});
