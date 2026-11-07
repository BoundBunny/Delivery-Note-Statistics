// 验证 3D 背景正式接入工作台：截取 app 首页与设置页
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
app.on('window-all-closed', function(){});
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const APP = path.join(__dirname, '..', '..', '..', '..', '..', 'android', 'app', 'src', 'main', 'assets', 'app', 'index.html');
const OUT = path.join(__dirname, '..', 'shots');

async function shot(name, setup){
  const win = new BrowserWindow({ width: 1450, height: 900, show: false, useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, nodeIntegration: false, contextIsolation: false } });
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2) console.log('PAGE:', msg); });
  await win.loadFile(APP, { query: { bg3d: '1' } });
  await new Promise(r => setTimeout(r, 7000));
  const info = await win.webContents.executeJavaScript(`(function(){
    var l=document.getElementById('bg3d-layer'), f=l&&l.querySelector('iframe'), im=l&&l.querySelector('img');
    return { hasLayer:!!l, display:l&&getComputedStyle(l).display, opacity:l&&getComputedStyle(l).opacity,
      iframe:!!f, iframeDisplay:f&&getComputedStyle(f).display, iframeSrc:f&&f.src,
      imgDisplay:im&&getComputedStyle(im).display, bg:getComputedStyle(document.body).backgroundColor,
      dns:typeof window.DNSBackground, store:typeof window.Store, w:innerWidth,
      key:(function(){try{return localStorage.getItem('sd_v1_bg3d');}catch(e){return 'ERR';}})() };
  })()`);
  console.log('bg3d info:', JSON.stringify(info));
  if(setup) await setup(win);
  await new Promise(r => setTimeout(r, 800));
  const img = await win.webContents.capturePage();
  const file = path.join(OUT, name + '.png');
  fs.writeFileSync(file, img.toPNG());
  console.log('saved', file, JSON.stringify(img.getSize()));
  win.destroy();
}

app.whenReady().then(async () => {
  try {
    await shot('app-home');
    await shot('app-settings', async win => {
      await win.webContents.executeJavaScript("location.hash='#/settings'");
      await new Promise(r => setTimeout(r, 900));
    });
  } catch (e) { console.error(e); process.exitCode = 1; } finally { app.quit(); }
});
