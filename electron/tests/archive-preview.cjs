'use strict';
/* Standalone capture for "delisted (archived) product" behaviour:
 * shows 商品管理 with an 已下架 card (restore button) and 商品销售排行 with 已下架 badge.
 * Usage: node tests/run-ui.cjs archive-preview.cjs <outName> [w] [h]
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.shots', 'design');
fs.mkdirSync(OUT_DIR, { recursive: true });

const OUT = process.argv[2] || 'archive-preview';
const WIDTH = Number(process.argv[3] || 1180);
const HEIGHT = Number(process.argv[4] || 1000);

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('allow-file-access-from-files');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-arc-'));
app.setPath('userData', profile);

const pause = ms => new Promise(r => setTimeout(r, ms));
const deadline = setTimeout(() => { console.error('PREVIEW_TIMEOUT'); app.exit(1); }, 90000);

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
      const cust = Store.upsertCustomer({ name: '华联超市（城东店）', phone: '138 0000 1234', address: '城东街道 88 号' });
      const p1 = Store.upsertProduct({ name: '测试饮用水', spec: '500ml', unit: '瓶', price: 3.33, category: 'drink' });
      const p2 = Store.upsertProduct({ name: '怡宝饮用纯净水', spec: '555ml', unit: '瓶', price: 2.00, category: 'drink' });
      const p3 = Store.upsertProduct({ name: '中华香烟（软）', spec: '盒', unit: '盒', price: 65.00, category: 'tobacco' });
      const items = [
        { pid: p1.id, name: p1.name, spec: p1.spec, unit: p1.unit, qty: 4, price: 3.33, amount: 13.32 },
        { pid: p2.id, name: p2.name, spec: p2.spec, unit: p2.unit, qty: 12, price: 2.00, amount: 24.00 },
        { pid: p3.id, name: p3.name, spec: p3.spec, unit: p3.unit, qty: 3, price: 65.00, amount: 195.00 }
      ];
      const total = items.reduce((s, it) => s + it.amount, 0);
      Store.addOrder({ no: Store.nextOrderNo(todayStr()), date: todayStr(), operator: '王小明', customer: { id: cust.id, name: cust.name, phone: cust.phone, address: cust.address }, items, total, note: '' });
      const r = Store.deleteProduct(p1.id); // 有历史单据 → 应下架
      return { archived: r && r.archived, deleted: r && r.deleted, count: Store.listProducts('').length, all: Store.listProducts('', { includeArchived: true }).length };
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`);
  console.log('SETUP', JSON.stringify(res));
  if (!res || res.error || !res.archived) throw new Error('setup failed: ' + JSON.stringify(res));

  // 商品管理（含已下架卡片）
  await js(`(() => { const el = Views.products.render({}); document.body.innerHTML = ''; document.body.appendChild(el); return !!el; })()`);
  await pause(900);
  fs.writeFileSync(path.join(OUT_DIR, OUT + '-products.png'), (await win.webContents.capturePage()).toPNG());
  console.log('WROTE ' + path.join(OUT_DIR, OUT + '-products.png'));

  // 商品销售排行（已下架徽章）
  await js(`(() => { const el = Views.stats.render({}); document.body.innerHTML = ''; document.body.appendChild(el); return !!el; })()`);
  await pause(1300);
  fs.writeFileSync(path.join(OUT_DIR, OUT + '-stats.png'), (await win.webContents.capturePage()).toPNG());
  console.log('WROTE ' + path.join(OUT_DIR, OUT + '-stats.png'));

  clearTimeout(deadline);
  win.destroy();
  app.exit(0);
}).catch(err => { console.error(err.stack || err); app.exit(1); });
