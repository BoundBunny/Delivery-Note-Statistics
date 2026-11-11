'use strict';
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const seeding=process.argv.includes('--seed');
const ROOT=path.resolve(__dirname,'..'),temp=seeding?process.argv.at(-1):fs.mkdtempSync(path.join(os.tmpdir(),'dns-migration-'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const timeout=setTimeout(()=>app.exit(1),30000);
const values={
    sd_v1_settings:JSON.stringify({company:'迁移前公司',noPrefix:'OLD',imageDir:'E:\\old-images'}),
    sd_v1_customers:JSON.stringify([{id:'legacy-c',name:'已有客户',phone:'123'}]),
    sd_v1_products:JSON.stringify([{id:'legacy-p',name:'已有商品',spec:'500ml',unit:'瓶',price:3.33,image:'E:\\old-images\\water.png'}]),
    sd_v1_orders:JSON.stringify([{id:'legacy-o',no:'OLD-20261108-001',date:'2026-11-08',customer:{id:'legacy-c',name:'已有客户'},items:[{pid:'legacy-p',name:'已有商品',spec:'500ml',qty:2,price:3.33,amount:6.66}],total:6.66}]),
    sd_v1_lastprices:JSON.stringify({'legacy-c:legacy-p':3.33}),sd_v1_seqmap:JSON.stringify({'2026-11-08':1}),
    sd_v1_seed_products_v1:'1',sd_v1_seed_products_cat_v1:'1',sd_desktop_ui:JSON.stringify({scene:false,motion:false,night:true,focused:false}),
};
app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();
if(seeding){
  app.whenReady().then(async()=>{
  // Simulate the old file URL without reading or modifying the Android project.
  const legacy=path.join(temp,'android/app/src/main/assets/app/index.html');fs.mkdirSync(path.dirname(legacy),{recursive:true});fs.writeFileSync(legacy,'<!doctype html><title>legacy profile</title>');
  const old=new BrowserWindow({show:false,webPreferences:{contextIsolation:false}});await old.loadFile(legacy);
  await old.webContents.executeJavaScript(`for(const [key,value] of Object.entries(${JSON.stringify(values)}))localStorage.setItem(key,value);`);
  await old.webContents.session.flushStorageData();app.exit(0);
  }).catch(error=>{console.error(error);app.exit(1);});
}else{
  const seed=require('node:child_process').spawnSync(process.execPath,[__filename,'--seed',temp],{env:process.env,encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(seed.status,0,seed.stderr);
  require(path.join(ROOT,'main.js'));
  app.whenReady().then(async()=>{
  let win;
  for(let i=0;i<200;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoadingMainFrame()&&await win.webContents.executeJavaScript('!!window.DNSDesktop?.ready'))break;await pause(50);}
  assert.ok(win);
  const js=code=>win.webContents.executeJavaScript(code,true);
  assert.equal(app.getPath('userData'),path.join(temp,'profile'));
  // Catalog upgrades may append bundled products; existing records must remain exact.
  const {sd_v1_products:originalProducts,sd_v1_settings:originalSettings,...unchangedKeys}=values;
  assert.deepEqual(await js(`Object.fromEntries(${JSON.stringify(Object.keys(unchangedKeys))}.map(key=>[key,localStorage.getItem(key)]))`),unchangedKeys);
  assert.deepEqual(await js('Store.getProduct("legacy-p")'),JSON.parse(originalProducts)[0]);
  for(const [key,value] of Object.entries(JSON.parse(originalSettings)))assert.equal(await js('Store.getSettings()['+JSON.stringify(key)+']'),value);
  assert.equal(await js('Store.getOrder("legacy-o").total'),6.66);assert.equal(await js('Store.getLastPrice("legacy-c","legacy-p")'),3.33);
  assert.equal(await js('Store.getProduct("legacy-p").image'),'E:\\old-images\\water.png');
  await js('window.previous=Store.exportJSON();Store.importJSON(window.previous);void 0');
  assert.equal(await js('Store.countAll().orders'),1);assert.equal(await js('Store.nextOrderNo("2026-11-08")'),'OLD-20261108-002');
  await win.loadFile(path.join(ROOT,'webapp/index.html'));assert.equal(await js('Store.getOrder("legacy-o").total'),6.66);
  console.log('PASS legacy file URL profile retains all business keys, images, desktop preferences, prices and sequences');
  console.log('PASS version-1 JSON restore and independent entry reload preserve existing orders');
  clearTimeout(timeout);app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
}
