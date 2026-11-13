'use strict';
/* Verify tobacco seed barcodes load + apply on a fresh store. */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'dns-bc-')));
const pause = ms => new Promise(r => setTimeout(r, ms));
const deadline = setTimeout(() => { console.error('TIMEOUT'); app.exit(1); }, 60000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1000, height: 700, show: false, webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false } });
  win.webContents.on('console-message', (_e, l, m) => console.log('RENDERER[' + l + ']', m));
  await win.loadFile(path.join(ROOT, 'webapp', 'index.html'));
  win.show();
  const js = c => win.webContents.executeJavaScript(c, true);
  for (let i = 0; i < 120; i++) { try { if (await js('typeof Store === "object" && typeof Store.listProducts === "function"')) break; } catch (_) {} await pause(100); }
  const res = await js(`(() => {
    const all = Store.listProducts('', { includeArchived: true }).filter(p => p.category === 'tobacco');
    const filled = all.filter(p => p.barcode);
    const dup = {};
    all.forEach(p => { if (p.barcode) dup[p.barcode] = (dup[p.barcode] || 0) + 1; });
    const dups = Object.entries(dup).filter(([, n]) => n > 1);
    const get = (name, unit) => { const p = all.find(x => x.name === name && x.unit === unit); return p ? p.barcode : null; };
    return {
      tobacco: all.length, filled: filled.length,
      dupCount: dups.length, dups,
      zhonghuaHardBox: get('中华（硬）', '盒'),
      zhonghuaHardCarton: get('中华（硬）', '条'),
      zhonghuaSoftBox: get('中华（软）', '盒'),
      liqunNew: get('利群（新版）', '盒'),
      wu: get('三五（金）', '盒')
    };
  })()`);
  console.log('RESULT', JSON.stringify(res, null, 1));
  const ok = res.filled >= 40 && res.dupCount === 0 && res.zhonghuaHardBox === '6901028075763' && res.zhonghuaHardCarton === '6901028075015' && res.zhonghuaSoftBox === '6901028075770' && res.wu === '8888075000505';
  console.log(ok ? 'TOBACCO_BARCODE_INITIAL_OK' : 'TOBACCO_BARCODE_INITIAL_FAIL');
  // 迁移场景：清空两个内置商品条码并清掉标记，重载后应由 fillSeedBarcodes 自动补回
  await js(`(() => {
    const all = Store.listProducts('', { includeArchived: true }).filter(p => p.category === 'tobacco');
    const a = all.find(x => x.name === '中华（硬）' && x.unit === '盒');
    const b = all.find(x => x.name === '利群（新版）' && x.unit === '条');
    if (a) Store.upsertProduct({ ...a, barcode: '' });
    if (b) Store.upsertProduct({ ...b, barcode: '' });
    localStorage.removeItem('sd_v1_seed_barcodes_v1');
    return true;
  })()`);
  await win.webContents.reload();
  for (let i = 0; i < 120; i++) { try { if (await js('typeof Store === "object" && typeof Store.listProducts === "function"')) break; } catch (_) {} await pause(100); }
  const mig = await js(`(() => {
    const all = Store.listProducts('', { includeArchived: true }).filter(p => p.category === 'tobacco');
    const g = (name, unit) => { const p = all.find(x => x.name === name && x.unit === unit); return p ? p.barcode : null; };
    return { zhonghuaHardBox: g('中华（硬）', '盒'), liqunNewCarton: g('利群（新版）', '条') };
  })()`);
  console.log('MIGRATION', JSON.stringify(mig));
  const okMig = mig.zhonghuaHardBox === '6901028075763' && mig.liqunNewCarton === '6901028118187';
  console.log(okMig ? 'TOBACCO_BARCODE_MIGRATION_OK' : 'TOBACCO_BARCODE_MIGRATION_FAIL');
  clearTimeout(deadline); win.destroy(); app.quit();
  if (!ok || !okMig) process.exitCode = 1;
}).catch(e => { console.error(e && e.stack || e); app.exit(1); });
