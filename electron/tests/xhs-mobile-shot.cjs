'use strict';
/* 小红书宣传用：手机端截图（直接渲染 webapp 业务视图，等同 Android WebView 内容）
 * 用法: node tests/run-ui.cjs xhs-mobile-shot.cjs
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.shots', 'xhs');
fs.mkdirSync(OUT, { recursive: true });

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('allow-file-access-from-files');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-xhs-m-'));
app.setPath('userData', profile);

const pause = ms => new Promise(r => setTimeout(r, ms));
const deadline = setTimeout(() => { console.error('XHS_M_TIMEOUT'); app.exit(1); }, 150000);

const SEED = `(() => {
  try { Store.clearAll(); } catch(_) {}
  Store.setSettings && Store.setSettings({ company: '鼎晟商贸有限公司', phone: '0571-8888 6666', address: '杭州市余杭区仓前街道 88 号', contact: '王经理', operator: '王小明' });
  const custs = [
    ['华联超市（城东店）', '138 0000 1234', '城东街道 88 号'],
    ['小卖铺便利店', '139 1234 5678', '城西街道 12 号'],
    ['老王副食批发', '136 8888 2233', '农贸市场 A-18'],
    ['阳光便利（人民路）', '135 6677 8899', '人民路 205 号'],
    ['锦绣超市', '137 5566 3322', '锦绣花园 3 栋'],
  ].map(([name, phone, address]) => Store.upsertCustomer({ name, phone, address }));
  const prods = [
    ['怡宝饮用纯净水', '555ml', '瓶', 2.00, 'drink'],
    ['农夫山泉天然水', '550ml', '瓶', 1.80, 'drink'],
    ['红牛维生素功能饮料', '250ml', '罐', 6.00, 'drink'],
    ['可口可乐', '500ml', '瓶', 3.50, 'drink'],
    ['康师傅红烧牛肉面', '桶装', '桶', 4.50, 'food'],
    ['中华香烟（软）', '盒', '盒', 65.00, 'tobacco'],
    ['利群（新版）', '盒', '盒', 18.00, 'tobacco'],
    ['黄鹤楼（软蓝）', '盒', '盒', 20.00, 'tobacco'],
    ['双汇火腿肠', '30g', '根', 1.20, 'food'],
    ['金龙鱼调和油', '5L', '桶', 68.00, 'oil'],
  ].map(a => Store.upsertProduct({ name: a[0], spec: a[1], unit: a[2], price: a[3], category: a[4] }));
  const pad = n => String(n).padStart(2, '0');
  const dayStr = off => { const d = new Date(); d.setDate(d.getDate() - off); return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); };
  const mkItems = idx => idx.map(([pi, qty]) => { const p = prods[pi]; return { pid: p.id, name: p.name, spec: p.spec, unit: p.unit, qty, price: p.price, amount: Math.round(qty * p.price * 100) / 100 }; });
  const mkOrder = (off, ci, idx, note) => { const items = mkItems(idx); const total = Math.round(items.reduce((s, it) => s + it.amount, 0) * 100) / 100; const c = custs[ci]; const date = dayStr(off); return Store.addOrder({ no: Store.nextOrderNo(date), date, operator: '王小明', customer: { id: c.id, name: c.name, phone: c.phone, address: c.address }, items, total, note: note || '' }); };
  mkOrder(6, 1, [[0,20],[3,12],[8,30]]);
  mkOrder(5, 2, [[5,6],[6,10],[1,24]]);
  mkOrder(4, 3, [[2,24],[4,18],[9,3]]);
  mkOrder(3, 0, [[0,40],[3,24],[8,50]]);
  mkOrder(2, 4, [[5,8],[7,12],[2,36]]);
  mkOrder(1, 1, [[1,36],[3,18],[4,24]]);
  mkOrder(0, 2, [[6,10],[0,24],[4,12]]);
  const hero = mkOrder(0, 0, [[0,24],[2,12],[4,10],[8,40]], '请于上午 10 点前送到后门收货处');
  return { orders: Store.listOrders().length, heroId: hero.id };
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 390, height: 844, show: false, webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false } });
  win.webContents.on('console-message', (_e, l, m) => console.log('RENDERER[' + l + ']', m));
  await win.loadFile(path.join(ROOT, 'webapp', 'mobile-preview.html'));
  win.show();
  const js = code => win.webContents.executeJavaScript(code, true);
  for (let i = 0; i < 150; i++) { try { if (await js('typeof Store === "object" && typeof Views === "object"')) break; } catch (_) {} await pause(80); }
  await pause(600);
  const seedRes = await js(SEED);
  console.log('SEED', JSON.stringify(seedRes));
  await pause(400);
  const shot = async name => { await pause(800); fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG()); console.log('WROTE ' + name); };
  const render = (expr) => js(`(() => { const c = document.getElementById('view-container'); c.innerHTML=''; const el = ${expr}; if (el) c.appendChild(el); window.scrollTo(0,0); return !!el; })()`);

  // 1. 送货单列表
  await render('Views.orders.render({})'); await shot('m1-orders');
  // 2. 单据详情
  await render("Views.order.render({ id: '" + seedRes.heroId + "' })"); await shot('m2-detail');
  // 3. 统计
  await render('Views.stats.render({})'); await shot('m3-stats');
  // 4. 商品管理
  await render('Views.products.render({})'); await shot('m4-products');
  // 5. 客户管理
  await render('Views.customers.render({})'); await shot('m5-customers');
  // 6. 开单（带明细草稿）
  await js(`(() => {
    const cs = Store.listCustomers(); const ps = Store.listProducts();
    const find = n => ps.find(p => p.name === n) || ps[0];
    const pick = [[find('怡宝饮用纯净水'),24],[find('红牛维生素功能饮料'),12],[find('康师傅红烧牛肉面'),10],[find('双汇火腿肠'),40]];
    const items = pick.map(([p,qty]) => ({ pid:p.id, name:p.name, spec:p.spec, unit:p.unit, qty, price:p.price, amount: Math.round(qty*p.price*100)/100 }));
    const c = cs[0];
    window.__orderDraft = { id:null, no: Store.peekOrderNo(todayStr()), date: todayStr(), operator:'王小明', note:'', customer:{ id:c.id, name:c.name, phone:c.phone, address:c.address }, items };
    return true;
  })()`);
  await render('Views.order.render({})'); await shot('m6-order-new');

  clearTimeout(deadline);
  win.destroy();
  app.exit(0);
}).catch(err => { console.error(err.stack || err); app.exit(1); });
