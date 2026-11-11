'use strict';
/* Design-preview harness: opens the real desktop app, jumps to the new-order
 * task window, optionally fills demo customer/items, and captures a PNG of the
 * form so the info card / remark card can be reviewed visually.
 *
 * Usage: node tests/run-ui.cjs order-meta-preview.cjs <outName> [width] [height] [empty]
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.shots', 'design');
fs.mkdirSync(OUT_DIR, { recursive: true });

const OUT = process.argv[2] || 'order-meta';
const WIDTH = Number(process.argv[3] || 1180);
const HEIGHT = Number(process.argv[4] || 900);
const DEMO = process.argv[5] !== 'empty';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-design-'));
app.setPath('userData', profile);
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

  await js(`(() => {
    Store.clearAll();
    if (${DEMO}) {
      window.__demoCustomer = Store.upsertCustomer({ name: '华联超市（城东店）', phone: '138 0000 1234', address: '城东街道 88 号 · 3 号仓' });
      window.__demoProduct = Store.upsertProduct({ name: '测试饮用水', spec: '500ml', unit: '瓶', price: 3.33 });
    }
    DNSDesktop.refresh();
  })()`);
  await pause(150);

  if (DEMO) {
    await js(`(() => {
      window.__orderDraft = {
        id: null, no: Store.nextOrderNo(todayStr()), date: todayStr(),
        operator: '王小明', note: Store.getSettings().note,
        customer: { ...window.__demoCustomer },
        items: [
          { pid: window.__demoProduct.id, name: '测试饮用水', spec: '500ml', unit: '瓶', qty: '2', price: '3.33' },
          { pid: null, name: '纯净水 · 家庭装', spec: '1.5L', unit: '桶', qty: '3', price: '9.90' }
        ]
      };
    })()`);
  }
  await js(`location.hash = '#/orders'`);
  await pause(150);
  await js(`location.hash = '#/order/new'`);
  await pause(400);
  await js(`DNSDesktop.maximizeModule && DNSDesktop.maximizeModule()`);
  await pause(350);

  await js(`(() => { const b = document.querySelector('.module-window-body'); if (b) b.scrollTop = 0; })()`);
  await pause(150);
  const png = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, OUT + '.png'), png.toPNG());
  console.log('WROTE ' + path.join(OUT_DIR, OUT + '.png'));
  clearTimeout(deadline);
  win.destroy();
  app.exit(0);
}).catch(err => { console.error(err.stack || err); app.exit(1); });
