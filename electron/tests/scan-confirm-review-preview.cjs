'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-confirm-review-'));
for (const [key, directory] of Object.entries({ DNS_TEST_USER_DATA: 'profile', DNS_TEST_DATA_DIR: 'data', DNS_TEST_BACKUP_DIR: 'backup', DNS_TEST_IMAGE_DIR: 'images', DNS_TEST_SAVE_DIR: 'exports' })) process.env[key] = path.join(temporary, directory);
app.setPath('userData', process.env.DNS_TEST_USER_DATA); app.disableHardwareAcceleration();
const pause = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const deadline = setTimeout(() => { console.error('CONFIRM_REVIEW_TIMEOUT'); app.exit(1); }, 120000);
require(path.join(ROOT, 'main.js'));
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 200; i++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(30); }
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2 && !/Security Warning|GL Driver|ReadPixels|Context/.test(message)) console.log('RENDERER[' + level + ']', message); });
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async (code, seconds = 10) => { for (let i = 0; i < seconds * 20; i++) { if (await js(code).catch(() => false)) return; await pause(50); } throw new Error('Timeout: ' + code); };
  const check = async (name, action) => { try { await action(); results.push({ name, ok: true }); console.log('PASS ' + name); } catch (error) { results.push({ name, ok: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); } };
  await wait('!!window.DNSDesktop?.ready && !!window.ScanOrders'); win.show(); win.focus(); win.setContentSize(1200, 850);
  await js(`Store.clearAll(); DNSDesktop.setSceneEnabled(false); void 0`);
  const codes = ['6900000000011','6900000000012','6900000000013','6900000000014','6900000000015','6900000000016'];
  await js(`(() => { for (let i = 1; i <= 6; i++) Store.upsertProduct({ name: '确认测试' + i, barcode: '69000000000' + (10 + i), spec: '500ml', unit: '瓶', price: 10 + i }); })()`);
  await js('ScanOrders.open();void 0'); await pause(250);
  for (const code of codes) { await js(`ScanOrders.session.scan(${JSON.stringify(code)});void 0`); await pause(70); }
  await js("location.hash='#/orders';void 0"); await pause(350);
  await js("location.hash='#/order/scan';void 0"); await pause(800);
  await js('document.querySelector("[data-scan-action=finish]").click();void 0'); await pause(600);
  await wait('!!document.querySelector(".scan-confirm-dialog")');
  const text = await js('document.querySelector(".scan-confirm-dialog").innerText');
  await check('confirm dialog removes eyebrow and retention hint', async () => {
    assert.equal(text.includes('扫码送货单 · 待确认'), false);
    assert.equal(text.includes('本单已保留'), false);
    assert.ok(text.includes('请确认并保存本单'));
  });
  await pause(500);
  const metrics = await js(`(() => {
    const wrap = document.querySelector('.scan-review-wrap'), list = document.querySelector('.scan-review-items'), bar = wrap.querySelector('.scan-scrollbar');
    const r = wrap.getBoundingClientRect(), lr = list.getBoundingClientRect();
    return { items: ScanOrders.session.state.draft.items.length, wrapWidth: r.width, listWidth: lr.width, clientHeight: list.clientHeight, scrollHeight: list.scrollHeight, maxHeight: getComputedStyle(list).maxHeight, barHidden: bar.hidden, opacity: getComputedStyle(bar).opacity };
  })()`);
  console.log('METRICS', JSON.stringify(metrics));
  await check('review list shows five rows and scrolls internally', async () => {
    assert.ok(metrics.items >= 6);
    assert.ok(metrics.clientHeight <= 175, 'clientHeight ' + metrics.clientHeight);
    assert.ok(metrics.scrollHeight > metrics.clientHeight + 10, 'no inner overflow');
    assert.equal(metrics.barHidden, false);
  });
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 30, y: 30 }); await pause(300);
  const hiddenOpacity = await js('getComputedStyle(document.querySelector(".scan-review-wrap .scan-scrollbar")).opacity');
  fs.writeFileSync(path.join(ROOT, '.shots/design/scan-confirm-review-top.png'), (await win.webContents.capturePage()).toPNG());
  const rect = await js(`(() => { const r = document.querySelector('.scan-review-items').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await js('document.querySelector(".scan-review-wrap").focus();void 0'); await pause(400);
  const shown = await js(`(() => { const w = document.querySelector('.scan-review-wrap'), l = document.querySelector('.scan-review-items'); return { opacity: getComputedStyle(w.querySelector('.scan-scrollbar')).opacity, listWidth: l.getBoundingClientRect().width }; })()`);
  console.log('HOVER', JSON.stringify(shown), 'hiddenOpacity', hiddenOpacity);
  await check('scrollbar hidden until area hover and does not squeeze list', async () => {
    assert.equal(hiddenOpacity, '0');
    assert.equal(shown.opacity, '1');
    assert.ok(Math.abs(shown.listWidth - metrics.listWidth) < 1, 'list width changed');
  });
  fs.writeFileSync(path.join(ROOT, '.shots/design/scan-confirm-review-hover.png'), (await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(ROOT, '.shots/design/scan-confirm-review.json'), JSON.stringify({ metrics, shown, hiddenOpacity, results }, null, 2));
  clearTimeout(deadline); win.destroy(); app.exit(results.every(r => r.ok) ? 0 : 1);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
