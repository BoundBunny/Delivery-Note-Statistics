'use strict';
// 预览：真实桌面壳里的打印预览，确认“返回原位置”已隐藏、只剩打印预览左上 `<` 返回。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-desktop-print-'));
const OUT = path.join(ROOT, '.shots/design');
fs.mkdirSync(OUT, { recursive: true });
app.setPath('userData', profile);
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const pause = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
app.on('web-contents-created', (_e, c) => { c.on('console-message', (_x, level, m) => { if (level >= 3) errors.push(m); }); });
const deadline = setTimeout(() => { console.error('PRINT_PREVIEW_TIMEOUT'); app.exit(1); }, 100000);
require(path.join(ROOT, 'main.js'));
app.whenReady().then(async () => {
  let win;
  for (let i = 0; i < 100; i++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(50); }
  if (!win) throw new Error('no main window');
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async expr => { for (let i = 0; i < 150; i++) { try { if (await js(expr)) return; } catch (_) {} await pause(80); } throw new Error('timeout ' + expr); };
  await wait('!!window.DNSDesktop?.ready');
  win.show();
  win.setContentSize(1440, 900);
  await pause(300);
  const orderId = await js(`(() => {
    Store.clearAll();
    const customer = Store.upsertCustomer({ name: '华联超市（城东店）', address: '城东街道 88 号', phone: '138 0000 1234', contact: '王经理' });
    const items = [
      { pid: '', name: '怡宝饮用纯净水 555ml', spec: '555ml', unit: '瓶', qty: 12, price: 2.00 },
      { pid: '', name: '红牛维生素功能饮料 250ml', spec: '250ml', unit: '罐', qty: 24, price: 6.00 }
    ].map(it => ({ ...it, amount: it.qty * it.price }));
    const total = items.reduce((s, it) => s + it.amount, 0);
    const o = Store.addOrder({ no: Store.nextOrderNo(todayStr()), date: todayStr(), customer, items, total, note: '请当面核对' });
    Store.setSettings({ company: '城东便利店' });
    DNSDesktop.refresh();
    return o.id;
  })()`);
  await pause(300);
  await js('location.hash=' + JSON.stringify('#/print?id=' + orderId));
  await pause(800);
  const headerDisplay = await js(`(() => { const h = document.querySelector('#desktop-reader .desktop-reader-header'); return h ? getComputedStyle(h).display : 'missing'; })()`);
  const closeVisible = await js(`(() => { const b = document.querySelector('#desktop-reader [data-close-reader]'); if (!b) return 'missing'; const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
  const printBack = await js(`(() => { const b = document.querySelector('#print-view [data-act=back]'); if (!b) return 'missing'; const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
  fs.writeFileSync(path.join(OUT, 'desktop-print-back.png'), (await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({ headerDisplay, closeVisible, printBack, errors }, null, 2));
  clearTimeout(deadline);
  const ok = headerDisplay === 'none' && closeVisible === false && printBack === true;
  console.log(ok ? 'RESULT PASS' : 'RESULT FAIL');
  app.exit(ok ? 0 : 1);
}).catch(err => { console.error('ERROR', err && err.stack || err); app.exit(1); });
