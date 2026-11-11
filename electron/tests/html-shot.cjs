'use strict';
/* Generic screenshot: load a local HTML file in a chromeless window and capture.
 * Usage: node tests/run-ui.cjs html-shot.cjs <htmlPath> <outPath> [width] [height]
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const htmlPath = path.resolve(ROOT, process.argv[2]);
const outPath = path.resolve(ROOT, process.argv[3]);
const WIDTH = Number(process.argv[4] || 1400);
const HEIGHT = Number(process.argv[5] || 1200);

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'dns-shot-')));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const deadline = setTimeout(() => { console.error('SHOT_TIMEOUT'); app.exit(1); }, 60000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: WIDTH, height: HEIGHT, show: false, backgroundColor: '#f4f5f7', webPreferences: { offscreen: false } });
  await win.loadFile(htmlPath);
  await new Promise(r => setTimeout(r, 500));
  const png = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, png.toPNG());
  console.log('WROTE ' + outPath);
  clearTimeout(deadline);
  win.destroy();
  app.exit(0);
}).catch(err => { console.error(err.stack || err); app.exit(1); });
