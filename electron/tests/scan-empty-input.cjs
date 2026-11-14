'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'dns-empty-scan-')));
const pause = ms => new Promise(r => setTimeout(r, ms));
const deadline = setTimeout(() => { console.error('TIMEOUT'); app.exit(1); }, 90000);
require(path.join(ROOT, 'main.js'));
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 200 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; if (!win) await pause(30); }
  const js = c => win.webContents.executeJavaScript(c, true);
  const wait = async (c, s = 10) => { for (let i = 0; i < s * 20; i++) { if (await js(c).catch(() => false)) return true; await pause(50); } throw new Error('timeout ' + c); };
  await wait('!!window.DNSDesktop?.ready && !!window.ScanOrders');
  win.show(); win.focus(); win.setContentSize(1440, 900);
  await js('DNSDesktop.setSceneEnabled(false); ScanOrders.open(); void 0');
  await wait('location.hash === "#/order/scan" && !!document.querySelector("[data-scan-input]")');
  await pause(300);
  await js('document.querySelector("[data-scan-input]").focus(); void 0');
  const code = '6901028075763';
  for (const ch of code) { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: ch }); win.webContents.sendInputEvent({ type: 'char', keyCode: ch }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: ch }); }
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await pause(700);
  const result = await js(`(() => ({ draft: !!ScanOrders.session.state.draft, items: ScanOrders.session.state.draft?.items?.length || 0, name: ScanOrders.session.state.draft?.items?.[0]?.name || '' }))()`);
  console.log('EMPTY_INPUT_RESULT ' + JSON.stringify(result));
  if (!result.draft || result.items < 1) { console.error('FAIL empty scan page manual input did not start draft'); clearTimeout(deadline); win.destroy(); app.exit(1); }
  console.log('EMPTY_INPUT_OK'); clearTimeout(deadline); win.destroy(); app.exit(0);
}).catch(e => { console.error(e.stack || e); app.exit(1); });
