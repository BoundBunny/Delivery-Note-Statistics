'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-close-timer-'));
for (const [key, directory] of Object.entries({ DNS_TEST_USER_DATA: 'profile', DNS_TEST_DATA_DIR: 'data', DNS_TEST_BACKUP_DIR: 'backup', DNS_TEST_IMAGE_DIR: 'images', DNS_TEST_SAVE_DIR: 'exports' })) process.env[key] = path.join(temporary, directory);
app.setPath('userData', process.env.DNS_TEST_USER_DATA); app.disableHardwareAcceleration();
const pause = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const deadline = setTimeout(() => { console.error('CLOSE_TIMER_TIMEOUT'); app.exit(1); }, 120000);
require(path.join(ROOT, 'main.js'));
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 200; i++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(30); }
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async (code, seconds = 10) => { for (let i = 0; i < seconds * 20; i++) { if (await js(code).catch(() => false)) return; await pause(50); } throw new Error('Timeout: ' + code); };
  const check = async (name, action) => { try { await action(); results.push({ name, ok: true }); console.log('PASS ' + name); } catch (error) { results.push({ name, ok: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); } };
  const click = async selector => { await js(`document.querySelector(${JSON.stringify(selector)}).click();void 0`); await pause(150); };
  await wait('!!window.DNSDesktop?.ready && !!window.ScanOrders'); win.show(); win.focus(); win.setContentSize(1200, 850);
  await js(`Store.clearAll(); DNSDesktop.setSceneEnabled(false); Store.upsertProduct({ name: '倒计时测试', barcode: '6900000000199', spec: '500ml', unit: '瓶', price: 9 }); void 0`);
  const openDraft = async () => { await js('ScanOrders.open();void 0'); await pause(250); await js(`ScanOrders.session.scan('6900000000199');void 0`); await pause(250); await wait('!!ScanOrders.session.state.draft'); };
  await openDraft();
  await js('ScanOrders.session.state.lastActivity = Date.now() - 59000; void 0');
  await click('#desktop-module-window [data-window-action="close"]'); await wait('!!document.querySelector(".scan-exit-dialog")');
  await check('opening close prompt pauses countdown', async () => {
    const text = await js('document.querySelector("[data-scan-countdown]")?.textContent || ""');
    assert.ok(text.includes('计时已暂停'));
    assert.ok(text.includes('60 秒'));
  });
  await click('.scan-exit-dialog [data-choice="save-draft"]'); await pause(400);
  await check('save draft keeps a paused draft', async () => {
    assert.equal(await js('!!ScanOrders.session.state.draft'), true);
    assert.equal(await js('ScanOrders.session.state.phase'), 'scanning');
  });
  await check('paused draft does not auto-confirm even when overdue', async () => {
    await js('ScanOrders.session.state.lastActivity = Date.now() - 61000; void 0');
    await pause(1200);
    assert.equal(await js('ScanOrders.session.state.phase'), 'scanning');
    assert.equal(await js('!!document.querySelector(".scan-confirm-dialog")'), false);
  });
  await check('reopening restarts at a full 60 seconds', async () => {
    await js('ScanOrders.open();void 0'); await pause(700);
    assert.equal(await js('ScanOrders.session.state.phase'), 'scanning');
    assert.ok(await js('Date.now() - ScanOrders.session.state.lastActivity < 1500'), 'remaining elapsed should be reset');
    await pause(1200);
    assert.equal(await js('ScanOrders.session.state.phase'), 'scanning', 'must not expire early');
    await js('ScanOrders.session.state.lastActivity = Date.now() - 61000; void 0');
    await wait('!!document.querySelector(".scan-confirm-dialog")', 4);
    assert.equal(await js('ScanOrders.session.state.phase'), 'confirm');
  });
  // fresh draft for discard
  await js('document.querySelector(".scan-confirm-dialog [data-scan-action=discard]")?.click();void 0'); await pause(300);
  if (await js('!!ScanOrders.session.state.draft')) { await js('ScanOrders.session.discard();void 0'); await pause(200); }
  await openDraft();
  await js('ScanOrders.session.state.lastActivity = Date.now() - 45000; void 0');
  await click('#desktop-module-window [data-window-action="close"]'); await wait('!!document.querySelector(".scan-exit-dialog")');
  await click('.scan-exit-dialog [data-choice="discard"]'); await pause(400);
  await check('discard clears the draft and leaves nothing to auto-confirm', async () => {
    assert.equal(await js('ScanOrders.session.state.draft'), null);
    await pause(1200);
    assert.equal(await js('!!document.querySelector(".scan-confirm-dialog")'), false);
  });
  await check('cancel restarts at a full 60 seconds', async () => {
    await openDraft();
    await js('ScanOrders.session.state.lastActivity = Date.now() - 59000; void 0');
    await click('#desktop-module-window [data-window-action="close"]'); await wait('!!document.querySelector(".scan-exit-dialog")');
    await click('.scan-exit-dialog [data-choice="cancel"]'); await pause(300);
    assert.equal(await js('!!document.querySelector(".scan-exit-dialog")'), false);
    assert.equal(await js('ScanOrders.session.state.phase'), 'scanning');
    assert.ok(await js('Date.now() - ScanOrders.session.state.lastActivity < 1500'));
  });
  fs.writeFileSync(path.join(ROOT, '.shots/design/scan-close-timer.json'), JSON.stringify(results, null, 2));
  clearTimeout(deadline); win.destroy(); app.exit(results.every(r => r.ok) ? 0 : 1);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
