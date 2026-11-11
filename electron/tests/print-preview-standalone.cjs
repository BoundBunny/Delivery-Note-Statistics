'use strict';
/* Standalone print-preview capture: loads webapp/index.html directly (no main
 * process bridge) to visually verify the printed document layout.
 *
 * Usage: node tests/run-ui.cjs print-preview-standalone.cjs <outName> [w] [h]
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.shots', 'design');
fs.mkdirSync(OUT_DIR, { recursive: true });

const OUT = process.argv[2] || 'print-standalone';
const WIDTH = Number(process.argv[3] || 1180);
const HEIGHT = Number(process.argv[4] || 1000);

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('allow-file-access-from-files');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dns-p3-'));
app.setPath('userData', profile);

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
      const cust = Store.upsertCustomer({ name: 'A测试客户0', phone: '138 0000 1234', address: '城东街道 88 号' });
      const items = [
        { pid: '', name: '怡宝饮用纯净水 555ml', spec: '555ml', unit: '瓶', qty: 12, price: 2.00 },
        { pid: '', name: '红牛维生素功能饮料 250ml', spec: '250ml', unit: '罐', qty: 2131, price: 6.00 },
        { pid: '', name: '中华香烟（软）盒', spec: '', unit: '盒', qty: 123, price: 65.00 }
      ].map(it => ({ ...it, amount: it.qty * it.price }));
      const total = items.reduce((s, it) => s + it.amount, 0);
      const o = Store.addOrder({ no: Store.nextOrderNo(todayStr()), date: todayStr(), operator: '王小明', customer: { id: cust.id, name: cust.name, phone: cust.phone, address: cust.address }, items, total, note: '' });
      return { id: o.id };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`);
  console.log('CREATE', JSON.stringify(res));
  if (!res || !res.id) throw new Error('create failed: ' + JSON.stringify(res));
  const id = res.id;
  await js(`(() => { const el = Views.print.render({ id: ${JSON.stringify(id)} }); document.body.innerHTML = ''; document.body.appendChild(el); return !!el; })()`);
  await pause(900);
  const png = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, OUT + '.png'), png.toPNG());
  console.log('WROTE ' + path.join(OUT_DIR, OUT + '.png'));
  clearTimeout(deadline);
  win.destroy();
  app.exit(0);
}).catch(err => { console.error(err.stack || err); app.exit(1); });
