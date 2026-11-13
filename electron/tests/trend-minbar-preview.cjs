'use strict';
/* Verify the compact "近7天每日销售额" chart still paints a visible sliver on a
 * day whose amount is tiny next to the weekly peak (e.g. today's single small order).
 * Setup: one big order yesterday (¥86,700) + one small order today (¥24).
 * Asserts today's bar has non-zero rendered height and the --nonzero class.
 * Usage: node tests/run-ui.cjs trend-minbar-preview.cjs
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-trend-'));
app.setPath('userData', profile);
// 完全隔离：数据目录/备份目录也指向临时目录，避免继承真实数据或备份
process.env.DNS_TEST_USER_DATA = profile;
process.env.DNS_TEST_DATA_DIR = path.join(profile, 'data');
process.env.DNS_TEST_BACKUP_DIR = path.join(profile, 'backup');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const pause = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, cond) => { results.push([name, !!cond]); console.log((cond ? 'PASS ' : 'FAIL ') + name); };
const deadline = setTimeout(() => { console.error('TREND_TIMEOUT'); finish(1); }, 90000);
let finished = false;
function finish(code) { if (finished) return; finished = true; clearTimeout(deadline); app.exit(code); }
require(path.join(ROOT, 'main.js'));

function ymd(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

app.whenReady().then(async () => {
  let win;
  for (let i = 0; i < 100; i++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(50); }
  if (!win) throw new Error('no window');
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async expr => { for (let i = 0; i < 150; i++) { try { if (await js(expr)) return; } catch (_) {} await pause(80); } throw new Error('timeout: ' + expr); };

  await wait('!!window.DNSDesktop?.ready');
  win.show();
  win.setContentSize(1517, 940);
  await pause(300);

  const today = ymd(0), yesterday = ymd(-1);
  const before = await js('Store.listOrders().length');
  check('starts with an empty isolated dataset', before === 0);
  const added = await js(`(() => {
    const mk = (no, date, total) => ({ no, date, operator: '测试', note: '',
      customer: null,
      items: [{ name: '测试商品', spec: '', unit: '件', qty: 1, price: total, amount: total }],
      total });
    Store.addOrder(mk('TREND-BIG', ${JSON.stringify(yesterday)}, 86700));
    Store.addOrder(mk('TREND-TODAY', ${JSON.stringify(today)}, 24));
    location.hash = '#/home';
    DNSDesktop.refresh();
    return Store.listOrders().length;
  })()`);
  check('seeded exactly two orders', added === 2);
  await wait('!!document.querySelector(".sales-chart-compact")');
  await pause(600);

  const bars = await js(`[...document.querySelectorAll('.sales-chart-compact .bt-bar')].map(b => ({ h: b.getBoundingClientRect().height, style: b.getAttribute('style'), nz: b.classList.contains('bt-bar--nonzero') }))`);
  const last = bars[bars.length - 1];
  const big = Math.max(...bars.map(b => b.h));
  check('chart has 7 day bars', bars.length === 7);
  check('today bar is flagged nonzero', !!last && last.nz === true);
  check('today bar renders >= 2px tall', !!last && last.h >= 2);
  check('peak bar still much taller than today', big >= last.h * 5);

  const rect = await js(`(() => { const el = document.querySelector('#statistics-summary'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
  fs.mkdirSync(path.join(ROOT, '.shots', 'design'), { recursive: true });
  const img = await win.webContents.capturePage(rect || { x: 0, y: 0, width: 1517, height: 940 });
  fs.writeFileSync(path.join(ROOT, '.shots', 'design', 'trend-minbar.png'), img.toPNG());
  console.log('BARS', JSON.stringify(bars));

  win.destroy();
  const ok = results.every(r => r[1]);
  console.log(ok ? 'TREND_OK' : 'TREND_FAIL');
  finish(ok ? 0 : 1);
}).catch(err => { console.error(err.stack || err); finish(1); });
