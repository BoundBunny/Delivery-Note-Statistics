'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-scan-scroll-'));
for (const [key, directory] of Object.entries({ DNS_TEST_USER_DATA: 'profile', DNS_TEST_DATA_DIR: 'data', DNS_TEST_BACKUP_DIR: 'backup', DNS_TEST_IMAGE_DIR: 'images', DNS_TEST_SAVE_DIR: 'exports' })) process.env[key] = path.join(temporary, directory);
app.setPath('userData', process.env.DNS_TEST_USER_DATA); app.disableHardwareAcceleration();
const pause = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const deadline = setTimeout(() => { console.error('SCAN_SCROLL_TIMEOUT'); app.exit(1); }, 120000);
require(path.join(ROOT, 'main.js'));
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 200; i++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(30); }
  win.webContents.on('console-message', (_e, level, message) => console.log('RENDERER[' + level + ']', message));
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async (code, seconds = 10) => { for (let i = 0; i < seconds * 20; i++) { if (await js(code).catch(() => false)) return; await pause(50); } throw new Error('Timeout: ' + code); };
  const check = async (name, action) => { try { await action(); results.push({ name, ok: true }); console.log('PASS ' + name); } catch (error) { results.push({ name, ok: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); } };
  await wait('!!window.DNSDesktop?.ready && !!window.ScanOrders'); win.show(); win.focus(); win.setContentSize(1200, 850);
  await js(`Store.clearAll(); DNSDesktop.setSceneEnabled(false); void 0`);
  const codes = ['6900000000001','6900000000002','6900000000003','6900000000004','6900000000005','6900000000006'];
  console.log('SETUP', await js(`(() => { try { for (let i = 1; i <= 6; i++) { Store.upsertProduct({ name: '滚动测试' + i, barcode: '690000000000' + i, spec: '500ml', unit: '瓶', price: 10 + i }); } return 'OK'; } catch (e) { return 'ERR:' + e.message; } })()`));
  console.log('OPEN', await js(`(() => { try { ScanOrders.open(); return 'OK'; } catch (e) { return 'ERR:' + e.message; } })()`)); await pause(250);
  for (const code of codes) { console.log('SCAN', code, await js(`(() => { try { ScanOrders.session.scan(${JSON.stringify(code)}); return 'OK'; } catch (e) { return 'ERR:' + e.message; } })()`)); await pause(80); }
  await wait('(ScanOrders.session.state.draft?.items.length||0) >= 5');
  await js("location.hash='#/orders';void 0"); await pause(400);
  await js("location.hash='#/order/scan';void 0"); await pause(900);
  console.log('VIEW', await js(`JSON.stringify({ hash: location.hash, views: Array.from(document.querySelectorAll('.view')).map(v => v.className + ':' + v.innerHTML.length), moduleHidden: document.querySelector('#desktop-module-window')?.hidden, body: document.body.className })`));
  await pause(400);
  console.log('STATE', await js(`(() => { try { const d = ScanOrders.session.state.draft; return JSON.stringify({ items: d && d.items.length, hasWrap: !!document.querySelector('.scan-table-wrap') }); } catch (e) { return 'ERR:' + e.message; } })()`));
  const metrics = await js(`(() => {
    try {
    const wrap = document.querySelector('.scan-table-wrap');
    const table = document.querySelector('.scan-items-table');
    const head = document.querySelector('.scan-table-head');
    const heading = document.querySelector('.scan-heading');
    const toolbar = document.querySelector('.scan-order-toolbar');
    const r = wrap.getBoundingClientRect();
    return { rows: ScanOrders.session.state.draft.items.length, wrapWidth: r.width, wrapHeight: r.height, clientHeight: wrap.clientHeight, scrollHeight: wrap.scrollHeight, tableWidth: table.getBoundingClientRect().width, overflowY: getComputedStyle(wrap).overflowY, hasHeadingText: heading.textContent.trim(), hasToolbar: !!toolbar, headTop: head.getBoundingClientRect().top };
    } catch (e) { return { error: e.message }; }
  })()`);
  console.log('METRICS', JSON.stringify(metrics));
  await check('heading and date hint removed', async () => {
    assert.equal(metrics.hasHeadingText, '扫码设置');
    assert.equal(metrics.hasToolbar, false);
  });
  await check('five-row viewport with inner scroll', async () => {
    assert.ok(metrics.rows >= 6);
    assert.ok(metrics.wrapHeight <= 332, 'wrap height ' + metrics.wrapHeight);
    assert.ok(metrics.scrollHeight > metrics.clientHeight + 20, 'no inner overflow');
  });
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 40, y: 40 }); await pause(350);
  fs.writeFileSync(path.join(ROOT, '.shots/design/scan-table-scroll-top.png'), (await win.webContents.capturePage()).toPNG());
  // move the pointer over the detail area to reveal the overlay scrollbar
  const r = metrics; const cx = 600, cy = 500;
  win.webContents.sendInputEvent({ type: 'mouseMove', x: cx, y: cy });
  await pause(500);
  const after = await js(`(() => { const wrap=document.querySelector('.scan-table-wrap'); const rr=wrap.getBoundingClientRect(); return { wrapWidth: rr.width, tableWidth: document.querySelector('.scan-items-table').getBoundingClientRect().width }; })()`);
  console.log('HOVER', JSON.stringify(after));
  await check('hovering the detail area does not squeeze table width', async () => {
    assert.ok(Math.abs(after.tableWidth - metrics.tableWidth) < 1, 'table width changed');
    assert.ok(Math.abs(after.wrapWidth - metrics.wrapWidth) < 1, 'wrap width changed');
  });
  fs.writeFileSync(path.join(ROOT, '.shots/design/scan-table-scroll-hover.png'), (await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(ROOT, '.shots/design/scan-table-scroll.json'), JSON.stringify({ metrics, after, results }, null, 2));
  clearTimeout(deadline); win.destroy(); app.exit(results.every(r => r.ok) ? 0 : 1);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
