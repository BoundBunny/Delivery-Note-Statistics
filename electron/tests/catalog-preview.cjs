'use strict';
/* Standalone capture of 商品管理 with the rebuilt tobacco catalog.
 * Usage: node tests/run-ui.cjs catalog-preview.cjs <outName> [w] [h]
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.shots', 'design');
fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT = process.argv[2] || 'catalog-preview';
const WIDTH = Number(process.argv[3] || 1180);
const HEIGHT = Number(process.argv[4] || 1000);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('allow-file-access-from-files');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'dns-cat-')));
const pause = ms => new Promise(r => setTimeout(r, ms));
const deadline = setTimeout(() => { console.error('TIMEOUT'); app.exit(1); }, 120000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: WIDTH, height: HEIGHT, show: false, webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false } });
  win.webContents.on('console-message', (_e, level, message) => console.log('RENDERER[' + level + ']', message));
  await win.loadFile(path.join(ROOT, 'webapp', 'index.html'));
  win.show();
  const js = code => win.webContents.executeJavaScript(code, true);
  for (let i = 0; i < 200; i++) { try { if (await js('typeof Store === "object" && typeof Store.listProducts === "function"')) break; } catch (_) {} await pause(80); }
  await pause(800);
  const stats = await js(`(() => ({ total: Store.listProducts('').length, tobacco: Store.listProducts('', {includeArchived:true}).filter(p=>p.category==='tobacco').length, withImg: Store.listProducts('', {includeArchived:true}).filter(p=>p.category==='tobacco' && p.image).length }))()`);
  console.log('STATS', JSON.stringify(stats));
  await js(`(() => { const el = Views.products.render({}); document.body.innerHTML = ''; document.body.appendChild(el); document.body.classList.add('preview-catalog'); return !!el; })()`);
  await pause(1200);
  // filter to tobacco by typing 中华 into the search box if present
  const filtered = await js(`(() => {
    const input = document.querySelector('.pm-search input') || document.querySelector('input[type="search"]') || document.querySelector('.search input');
    if (!input) return false;
    input.value = '中华'; input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  console.log('FILTERED', filtered);
  await pause(900);
  fs.writeFileSync(path.join(OUT_DIR, OUT + '.png'), (await win.webContents.capturePage()).toPNG());
  console.log('WROTE ' + path.join(OUT_DIR, OUT + '.png'));
  clearTimeout(deadline); win.destroy(); app.exit(0);
}).catch(err => { console.error(err.stack || err); app.exit(1); });
