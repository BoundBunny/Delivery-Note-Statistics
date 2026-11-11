'use strict';
/* Design-preview harness: creates a demo order and captures the print preview
 * so the document footer / layout can be reviewed visually.
 *
 * Usage: node tests/run-ui.cjs print-preview.cjs <outName> [width] [height]
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.shots', 'design');
fs.mkdirSync(OUT_DIR, { recursive: true });

const OUT = process.argv[2] || 'print-preview';
const WIDTH = Number(process.argv[3] || 1180);
const HEIGHT = Number(process.argv[4] || 980);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-design-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.disableHardwareAcceleration();

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

  const id = await js(`(() => {
    Store.clearAll();
    const cust = Store.upsertCustomer({ name: 'A测试客户0', phone: '138 0000 1234', address: '城东街道 88 号' });
    const items = [
      { pid: null, name: '怡宝饮用纯净水 555ml', spec: '555ml', unit: '瓶', qty: 12, price: 2.00 },
      { pid: null, name: '红牛维生素功能饮料 250ml', spec: '250ml', unit: '罐', qty: 2131, price: 6.00 },
      { pid: null, name: '中华香烟（软）盒', spec: '', unit: '盒', qty: 123, price: 65.00 }
    ];
    const total = items.reduce((s, it) => s + it.qty * it.price, 0);
    const o = Store.addOrder({
      no: Store.nextOrderNo(todayStr()), date: todayStr(), operator: '王小明',
      customer: { id: cust.id, name: cust.name, phone: cust.phone, address: cust.address },
      items, total, note: ''
    });
    DNSDesktop.refresh();
    return o.id;
  })()`);
  await pause(200);

  await js(`location.hash = '#/print?id=' + ${JSON.stringify(id)}`);
  await pause(600);

  const png = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, OUT + '.png'), png.toPNG());
  console.log('WROTE ' + path.join(OUT_DIR, OUT + '.png'));
  clearTimeout(deadline);
  win.destroy();
  app.exit(0);
}).catch(err => { console.error(err.stack || err); app.exit(1); });
