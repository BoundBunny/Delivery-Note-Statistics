'use strict';
/* Design-preview harness: opens the real desktop app, lands on a normal page,
 * then fires the close-prompt event so the styled exit dialog is rendered for
 * visual review. Does not actually close the window.
 *
 * Usage: node tests/run-ui.cjs close-prompt-preview.cjs <outName> [width] [height]
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.shots', 'design');
fs.mkdirSync(OUT_DIR, { recursive: true });

const OUT = process.argv[2] || 'close-prompt';
const WIDTH = Number(process.argv[3] || 1180);
const HEIGHT = Number(process.argv[4] || 900);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-design-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration(); // 预览用软件渲染，避免本机 GPU/SwiftShader 崩溃
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
  const wait = async expr => { for (let i = 0; i < 150; i++) { try { if (await js(expr)) return; } catch (_) {} await pause(80); } throw new Error('Timed out: ' + expr); };

  await wait('!!window.DNSDesktop?.ready');
  win.show();
  win.setContentSize(WIDTH, HEIGHT);
  await pause(400);

  await js(`(() => { Store.clearAll(); DNSDesktop.refresh(); })()`);
  await pause(150);
  await js(`location.hash = '#/orders'`);
  await pause(400);

  await js(`window.dispatchEvent(new Event('dns-close-prompt'))`);
  await pause(350);

  const png = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, OUT + '.png'), png.toPNG());
  console.log('WROTE ' + path.join(OUT_DIR, OUT + '.png'));
  clearTimeout(deadline);
  win.destroy();
  app.exit(0);
}).catch(err => { console.error(err.stack || err); app.exit(1); });
