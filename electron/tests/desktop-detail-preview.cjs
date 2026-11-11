'use strict';
// 预览：单据详情左右翻页悬浮按钮；未聚焦暗淡、聚焦单据时点亮。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-desktop-detail-'));
const OUT = path.join(ROOT, '.shots/design');
fs.mkdirSync(OUT, { recursive: true });
app.setPath('userData', profile);
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const pause = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
app.on('web-contents-created', (_e, c) => { c.on('console-message', (_x, level, m) => { if (level >= 3) errors.push(m); }); });
const deadline = setTimeout(() => { console.error('DETAIL_PREVIEW_TIMEOUT'); app.exit(1); }, 100000);
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
  const ids = await js(`(() => {
    Store.clearAll();
    const customer = Store.upsertCustomer({ name: '测试客户A', address: '测试地址 18 号', phone: '12345678' });
    const mk = (name, qty, price) => { const items = [{ pid: '', name, spec: '500ml', unit: '瓶', qty, price }].map(it => ({ ...it, amount: it.qty * it.price })); return Store.addOrder({ no: Store.nextOrderNo(todayStr()), date: todayStr(), customer, items, total: items.reduce((s,i)=>s+i.amount,0), note: '请当面核对' }); };
    const a = mk('测试饮用水', 1, 1234.56);
    const b = mk('测试饮用水', 2, 1234.56);
    const c = mk('测试饮用水', 3, 1234.56);
    Store.setSettings({ company: '城东便利店' });
    DNSDesktop.refresh();
    return [a.id, b.id, c.id];
  })()`);
  await pause(300);
  await js('location.hash=' + JSON.stringify('#/order/view?id=' + ids[1]));
  await pause(700);
  const dimOpacity = await js(`(() => { const b = document.querySelector('.doc-nav-btn'); return b ? getComputedStyle(b).opacity : 'missing'; })()`);
  const prevDisabled = await js(`document.querySelector('.doc-nav-prev')?.disabled`);
  const nextDisabled = await js(`document.querySelector('.doc-nav-next')?.disabled`);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 });
  await pause(300);
  fs.writeFileSync(path.join(OUT, 'desktop-detail-dim.png'), (await win.webContents.capturePage()).toPNG());
  // 鼠标悬停到单据上，模拟“光标聚焦单据”时按钮点亮
  const center = await js(`(() => { const r = document.querySelector('.doc-stage').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: center.x, y: center.y });
  await pause(400);
  const brightOpacity = await js(`(() => { const b = document.querySelector('.doc-nav-btn'); return b ? getComputedStyle(b).opacity : 'missing'; })()`);
  fs.writeFileSync(path.join(OUT, 'desktop-detail-bright.png'), (await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({ dimOpacity, brightOpacity, prevDisabled, nextDisabled, errors }, null, 2));
  clearTimeout(deadline);
  const ok = prevDisabled === false && nextDisabled === false && Number(dimOpacity) < 0.4 && Number(brightOpacity) > 0.9;
  console.log(ok ? 'RESULT PASS' : 'RESULT FAIL');
  app.exit(ok ? 0 : 1);
}).catch(err => { console.error('ERROR', err && err.stack || err); app.exit(1); });
