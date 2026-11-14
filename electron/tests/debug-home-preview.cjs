'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ROOT = path.resolve(__dirname, '..'); const OUT = path.join(ROOT, '.shots', 'design');
fs.mkdirSync(OUT, { recursive: true });
app.disableHardwareAcceleration(); app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'dns-dbg-')));
const pause = ms => new Promise(r => setTimeout(r, ms));
const deadline = setTimeout(() => { console.error('TIMEOUT'); app.exit(1); }, 90000);
require(path.join(ROOT, 'main.js'));
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 200 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; if (!win) await pause(30); }
  await win.webContents.executeJavaScript('new Promise(r=>{const t=setInterval(()=>{if(window.DNSDesktop?.ready){clearInterval(t);r(true)}},50)})', true);
  win.show(); win.setContentSize(1440, 900); await pause(1200);
  fs.writeFileSync(path.join(OUT, 'scan-debug-home.png'), (await win.webContents.capturePage({ x: 0, y: 0, width: 1440, height: 96 })).toPNG());
  console.log('WROTE ' + path.join(OUT, 'scan-debug-home.png'));
  clearTimeout(deadline); win.destroy(); app.exit(0);
}).catch(err => { console.error(err.stack || err); app.exit(1); });
