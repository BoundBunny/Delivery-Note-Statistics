'use strict';
/* Standalone capture of the company/shop settings screen to review the
 * redesigned watermark control + live preview. Loads webapp/index.html directly.
 * Usage: node tests/run-ui.cjs settings-wm-preview.cjs <outName> [w] [h]
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.shots', 'design');
fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT = process.argv[2] || 'settings-wm';
const WIDTH = Number(process.argv[3] || 1180);
const HEIGHT = Number(process.argv[4] || 920);

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('allow-file-access-from-files');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'dns-wm-')));

const pause = ms => new Promise(r => setTimeout(r, ms));
const deadline = setTimeout(() => { console.error('PREVIEW_TIMEOUT'); app.exit(1); }, 60000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: WIDTH, height: HEIGHT, show: false, webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false } });
  win.webContents.on('console-message', (_e, level, message) => console.log('RENDERER[' + level + ']', message));
  await win.loadFile(path.join(ROOT, 'webapp', 'index.html'));
  win.show();
  const js = code => win.webContents.executeJavaScript(code, true);
  for (let i = 0; i < 150; i++) { try { if (await js('typeof Store === "object" || typeof Store === "function"')) break; } catch (_) {} await pause(80); }
  await pause(400);
  const res = await js(`(() => {
    try {
      try { Store.clearAll(); } catch (_) {}
      Store.setSettings({ company: '离鼎智能科技有限公司', phone: '13250715760', contact: '庄金淇', address: '广东省广州市海珠区东港中路2519号opc社区', watermark: true });
      const el = Views.companyInfo.render();
      document.body.innerHTML = '';
      document.body.appendChild(el);
      return { ok: true };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`);
  console.log('RENDER', JSON.stringify(res));
  if (!res || !res.ok) throw new Error('render failed: ' + JSON.stringify(res));
  await pause(700);
  const png = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, OUT + '.png'), png.toPNG());
  console.log('WROTE ' + path.join(OUT_DIR, OUT + '.png'));
  clearTimeout(deadline);
  win.destroy();
  app.exit(0);
}).catch(err => { console.error(err.stack || err); app.exit(1); });
