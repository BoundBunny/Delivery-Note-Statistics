// 用 Electron 无头截取 P0 预览页面，验证构图。
// 运行： node_modules\electron\dist\electron.exe docs\3d-background\preview\scripts\capture.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.on('window-all-closed', function(){ /* keep alive for sequential shots */ });

const OUT = path.join(__dirname, '..', 'shots');

async function shot(name, query){
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false, useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, nodeIntegration: false }
  });
  await win.loadFile(path.join(__dirname, '..', 'p0-blockout.html'), { query });
  // 等 Three 首帧 + 字体渲染
  await new Promise(r => setTimeout(r, 2800));
  const img = await win.webContents.capturePage();
  const file = path.join(OUT, name + '.png');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(file, img.toPNG());
  console.log('saved', file, JSON.stringify(img.getSize()));
  win.destroy();
}

async function shotHover(name, x, y){  const win = new BrowserWindow({
    width: 1440, height: 900, show: false, useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, nodeIntegration: false }
  });
  await win.loadFile(path.join(__dirname, '..', 'p0-blockout.html'), { query: { ui: '1', hud: '0' } });
  await new Promise(r => setTimeout(r, 2800));
  win.webContents.sendInputEvent({ type: 'mouseMove', x: x, y: y });
  await new Promise(r => setTimeout(r, 900));
  const img = await win.webContents.capturePage();
  const file = path.join(OUT, name + '.png');
  fs.writeFileSync(file, img.toPNG());
  console.log('saved hover', file, JSON.stringify(img.getSize()));
  win.destroy();
}

const sampleBackup = {
  app: 'songhuodan', version: 1,
  data: {
    settings: { noPrefix: 'SD', operator: '老板' },
    customers: [
      {id:'c1',name:'城南便利店'}, {id:'c2',name:'老王杂货铺'}, {id:'c3',name:'阳光超市'},
      {id:'c4',name:'惠民小卖部'}, {id:'c5',name:'车站小卖柜'}
    ],
    orders: [
      {no:'SD-20261107-004', date:'2026-11-07', customer:{name:'城南便利店'}, total:320, createdAt:4,
       items:[{name:'农夫山泉',spec:'550ml',unit:'瓶',qty:40},{name:'可口可乐',spec:'330ml',unit:'罐',qty:24}]},
      {no:'SD-20261107-003', date:'2026-11-07', customer:{name:'老王杂货铺'}, total:186, createdAt:3,
       items:[{name:'金龙鱼油',spec:'5L',unit:'桶',qty:12},{name:'农夫山泉',spec:'550ml',unit:'瓶',qty:10}]},
      {no:'SD-20261107-002', date:'2026-11-07', customer:{name:'阳光超市'}, total:540, createdAt:2,
       items:[{name:'可口可乐',spec:'330ml',unit:'罐',qty:30},{name:'雪碧',spec:'500ml',unit:'瓶',qty:18}]},
      {no:'SD-20261107-001', date:'2026-11-07', customer:{name:'惠民小卖部'}, total:96, createdAt:1,
       items:[{name:'康师傅方便面',spec:'袋装',unit:'袋',qty:24}]},
      {no:'SD-20261106-013', date:'2026-11-06', customer:{name:'车站小卖柜'}, total:135, createdAt:9,
       items:[{name:'农夫山泉',spec:'550ml',unit:'瓶',qty:30}]},
      {no:'SD-20261105-011', date:'2026-11-05', customer:{name:'城南便利店'}, total:880, createdAt:8,
       items:[{name:'可口可乐',spec:'330ml',unit:'罐',qty:60},{name:'雪碧',spec:'500ml',unit:'瓶',qty:24}]},
      {no:'SD-20261103-008', date:'2026-11-03', customer:{name:'阳光超市'}, total:420, createdAt:7,
       items:[{name:'金龙鱼油',spec:'5L',unit:'桶',qty:8},{name:'康师傅方便面',spec:'袋装',unit:'袋',qty:20}]}
    ]
  }
};

async function shotData(name){
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false, useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, nodeIntegration: false }
  });
  await win.loadFile(path.join(__dirname, '..', 'p0-blockout.html'), { query: { ui: '1', hud: '0' } });
  await new Promise(r => setTimeout(r, 2600));
  await win.webContents.executeJavaScript('window.__preview.loadBackup(' + JSON.stringify(sampleBackup) + ')');
  await new Promise(r => setTimeout(r, 1400));
  const img = await win.webContents.capturePage();
  const file = path.join(OUT, name + '.png');
  fs.writeFileSync(file, img.toPNG());
  console.log('saved data', file, JSON.stringify(img.getSize()));
  win.destroy();
}

app.whenReady().then(async () => {
  try {
    await shot('ui-1440', { ui: '1', hud: '0' });
    await shot('scene-1440', { ui: '0', hud: '0' });
    await shot('zones-1440', { ui: '1', hud: '0', zones: '1' });
    await shot('night-1440', { ui: '1', hud: '0', night: '1' });
    await shot('focus-products', { ui: '1', hud: '0', focus: 'products' });
    await shot('focus-cat-drink', { ui: '1', hud: '0', focus: 'products', cat: 'drink' });
    await shot('focus-customers', { ui: '1', hud: '0', focus: 'customers' });
    await shot('focus-orders', { ui: '1', hud: '0', focus: 'orders' });
    await shotHover('hover-candy', 700, 330);
    await shotHover('hover-truck', 830, 500);
    await shotData('data-loaded');
    await shot('bg-static', { clean: '1' });
    console.log('done');
  } catch (e) {
    console.error('capture failed:', e);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
