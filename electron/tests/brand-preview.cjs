'use strict';
/* Design-preview harness: opens the real desktop app on the home workspace and
 * captures the header + 3D scene so we can review the "送货宝" brand.
 *
 * Usage: node tests/run-ui.cjs brand-preview.cjs <outName> [width] [height] [hash]
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.shots', 'design');
fs.mkdirSync(OUT_DIR, { recursive: true });

const OUT = process.argv[2] || 'brand-home';
const WIDTH = Number(process.argv[3] || 1440);
const HEIGHT = Number(process.argv[4] || 900);
const HASH = process.argv[5] || '#/home';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-design-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const pause = ms => new Promise(r => setTimeout(r, ms));
const deadline = setTimeout(() => { console.error('PREVIEW_TIMEOUT'); app.exit(1); }, 100000);
require(path.join(ROOT, 'main.js'));

app.whenReady().then(async () => {
  let win;
  for (let i = 0; i < 100; i++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(50); }
  if (!win) throw new Error('Main window was not created');
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async expr => { for (let i = 0; i < 200; i++) { try { if (await js(expr)) return; } catch (_) {} await pause(80); } throw new Error('Timed out: ' + expr); };

  await wait('!!window.DNSDesktop?.ready');
  win.show();
  win.setContentSize(WIDTH, HEIGHT);
  await pause(400);
  win.focus();

  await js(`(() => { Store.clearAll(); DNSDesktop.refresh(); DNSDesktop.setSceneEnabled(true); })()`);
  await pause(150);
  await js(`location.hash = ${JSON.stringify(HASH)}`);
  await pause(500);

  if (HASH === '#/home') {
    await wait(`window.DNSBackground?.stats?.().state === 'ready'`);
    await pause(900);
  } else {
    await pause(700);
  }

  const png = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, OUT + '.png'), png.toPNG());
  console.log('WROTE ' + path.join(OUT_DIR, OUT + '.png'));
  clearTimeout(deadline);
  win.destroy();
  app.exit(0);
}).catch(err => { console.error(err.stack || err); app.exit(1); });
