'use strict';
/* Load etmoc Brands page in Electron (executes the site's JS challenge) and dump DOM. */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const URL = process.argv[2] || 'http://www.etmoc.com/Firms/Brands';
const OUT = process.argv[3] || '.tmp-etmoc-dom.html';
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'dns-etmoc-')));
const pause = ms => new Promise(r => setTimeout(r, ms));
const deadline = setTimeout(() => { console.error('TIMEOUT'); app.exit(1); }, 90000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false } });
  win.webContents.on('console-message', (_e, l, m) => console.log('RENDERER[' + l + ']', m));
  await win.loadURL(URL).catch(e => console.log('LOADERR', e.message));
  await pause(3500);
  for (let i = 0; i < 5; i++) { await pause(1500); const u = await win.webContents.executeJavaScript('location.href'); console.log('URL', u); if (!/security_verify/.test(u)) break; }
  const info = await win.webContents.executeJavaScript(`(() => {
    const c = document.querySelector('.col-8');
    return { title: document.title, url: location.href, hasCol8: !!c, col8Text: c ? c.innerText.slice(0, 4000) : '', bodyText: document.body.innerText.slice(0, 1500) };
  })()`);
  console.log('INFO', JSON.stringify(info));
  const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
  fs.writeFileSync(path.join(ROOT, OUT), html, 'utf8');
  console.log('WROTE', OUT, html.length);
  clearTimeout(deadline); win.destroy(); app.quit();
}).catch(e => { console.error(e && e.stack || e); app.exit(1); });
