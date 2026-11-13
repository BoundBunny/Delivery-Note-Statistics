'use strict';
/* Capture the 统计/对账「销售趋势」chart with only two sales days to check bar spacing.
 * Usage: node tests/run-ui.cjs stats-trend-preview.cjs [width] [height]
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.shots', 'design');
fs.mkdirSync(OUT_DIR, { recursive: true });
const WIDTH = Number(process.argv[2] || 1600), HEIGHT = Number(process.argv[3] || 900);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('allow-file-access-from-files');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-trendpage-'));
app.setPath('userData', profile);
process.env.DNS_TEST_USER_DATA = profile;
process.env.DNS_TEST_DATA_DIR = path.join(profile, 'data');
process.env.DNS_TEST_BACKUP_DIR = path.join(profile, 'backup');
const pause = ms => new Promise(r => setTimeout(r, ms));
const deadline = setTimeout(() => { console.error('PREVIEW_TIMEOUT'); app.exit(1); }, 90000);

function ymd(off) { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: WIDTH, height: HEIGHT, show: false, webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false } });
  win.webContents.on('console-message', (_e, level, message) => console.log('RENDERER[' + level + ']', message));
  await win.loadFile(path.join(ROOT, 'webapp', 'index.html'));
  win.show();
  const js = code => win.webContents.executeJavaScript(code, true);
  for (let i = 0; i < 150; i++) { try { if (await js('typeof Store === "object" || typeof Store === "function"')) break; } catch (_) {} await pause(80); }
  await pause(300);
  const today = ymd(0), yesterday = ymd(-1);
  const res = await js(`(() => {
    try {
      try { Store.clearAll(); } catch (_) {}
      const mk = (no, date, total) => ({ no, date, operator: '测试', note: '', customer: null,
        items: [{ name: '测试商品', spec: '', unit: '件', qty: 1, price: total, amount: total }], total });
      Store.addOrder(mk('ST-BIG', ${JSON.stringify(yesterday)}, 86679));
      Store.addOrder(mk('ST-TODAY', ${JSON.stringify(today)}, 24));
      const el = Views.stats.render({}); document.body.innerHTML = ''; document.body.appendChild(el);
      return Store.listOrders().length;
    } catch (e) { return { error: String(e && e.message || e) }; }
  })()`);
  console.log('SETUP', JSON.stringify(res));
  await pause(1200);
  const rect = await js(`(() => { const el = document.querySelector('[data-role="trend"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height + 10) }; })()`);
  const img = await win.webContents.capturePage(rect || undefined);
  fs.writeFileSync(path.join(OUT_DIR, 'stats-trend-spacing.png'), img.toPNG());
  console.log('WROTE ' + path.join(OUT_DIR, 'stats-trend-spacing.png'));
  clearTimeout(deadline);
  win.destroy(); app.exit(0);
}).catch(err => { console.error(err.stack || err); app.exit(1); });
