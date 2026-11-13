'use strict';
/* Standalone capture of the 扫码接单设置 dialog (no main-process bridge).
 * Usage: node tests/run-ui.cjs scan-settings-preview.cjs [outName] [w] [h]
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.shots', 'design');
fs.mkdirSync(OUT_DIR, { recursive: true });

const OUT = process.argv[2] || 'scan-settings';
const WIDTH = Number(process.argv[3] || 720);
const HEIGHT = Number(process.argv[4] || 820);

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('allow-file-access-from-files');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'dns-scan-')));

const pause = ms => new Promise(r => setTimeout(r, ms));
const deadline = setTimeout(() => { console.error('PREVIEW_TIMEOUT'); app.exit(1); }, 60000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: WIDTH, height: HEIGHT, show: false, webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false } });
  win.webContents.on('console-message', (_e, level, message) => console.log('RENDERER[' + level + ']', message));
  await win.loadFile(path.join(ROOT, 'webapp', 'index.html'));
  win.show();
  const js = code => win.webContents.executeJavaScript(code, true);
  for (let i = 0; i < 150; i++) { try { if (await js('typeof window.ScanOrders === "object" && typeof Store === "object"')) break; } catch (_) {} await pause(80); }
  await pause(300);
  await js('window.ScanOrders.configure(); true');
  await pause(400);
  const metrics = await js(`(() => {
    const q = s => document.querySelector(s);
    const r = el => el ? { x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null;
    return {
      dialog: r(q('.scan-dialog')),
      toggleCard: r(q('.scan-toggle-card')),
      checkbox: r(q('[data-scan-enabled]')),
      modeOpts: [...document.querySelectorAll('.scan-mode-opt')].map(r),
      activeMode: q('.scan-mode-opt.is-on')?.dataset.mode || null,
      modeValues: [...document.querySelectorAll('.scan-mode-opt')].map(b => b.dataset.mode)
    };
  })()`);
  console.log('METRICS', JSON.stringify(metrics));
  let png = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, OUT + '.png'), png.toPNG());
  console.log('WROTE ' + path.join(OUT_DIR, OUT + '.png'));
  await js(`(() => { const b = document.querySelector('.scan-mode-opt[data-mode="prefix"]'); if (b) b.click(); return true; })()`);
  await pause(250);
  const after = await js(`document.querySelector('[data-scan-mode]').value`);
  console.log('MODE_AFTER_CLICK', after);
  png = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, OUT + '-prefix.png'), png.toPNG());
  console.log('WROTE ' + path.join(OUT_DIR, OUT + '-prefix.png'));
  await js(`(() => { const b = document.querySelector('[data-config-save]'); if (b) b.click(); return true; })()`);
  await pause(300);
  const saved = await js(`localStorage.getItem('sd_v1_scanner_preferences_v2')`);
  const dialogGone = await js(`!document.querySelector('.scan-form-mask')`);
  console.log('SAVED_PREFS', saved, 'DIALOG_CLOSED', dialogGone);
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch(err => { console.error(err && err.stack || err); app.exit(1); });
