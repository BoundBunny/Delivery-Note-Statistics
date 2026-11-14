'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-scan-close-'));
for (const [key, directory] of Object.entries({ DNS_TEST_USER_DATA: 'profile', DNS_TEST_DATA_DIR: 'data', DNS_TEST_BACKUP_DIR: 'backup', DNS_TEST_IMAGE_DIR: 'images', DNS_TEST_SAVE_DIR: 'exports' })) process.env[key] = path.join(temporary, directory);
app.setPath('userData', process.env.DNS_TEST_USER_DATA); app.disableHardwareAcceleration();
const pause = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const deadline = setTimeout(() => { console.error('SCAN_CLOSE_TIMEOUT'); app.exit(1); }, 120000);
require(path.join(ROOT, 'main.js'));
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 200; i++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(30); }
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async (code, seconds = 8) => { for (let i = 0; i < seconds * 20; i++) { if (await js(code).catch(() => false)) return; await pause(50); } throw new Error('Timeout: ' + code); };
  const check = async (name, action) => { try { await action(); results.push({ name, ok: true }); console.log('PASS ' + name); } catch (error) { results.push({ name, ok: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); } };
  const click = async selector => { await js(`document.querySelector(${JSON.stringify(selector)}).click();void 0`); await pause(120); };
  await wait('!!window.DNSDesktop?.ready && !!window.ScanOrders'); win.show(); win.focus(); win.setContentSize(1200, 850);
  await js(`Store.clearAll(); DNSDesktop.setSceneEnabled(false); window.closeFixture = Store.upsertProduct({name:'关闭测试商品',barcode:'0012345678999',spec:'500ml',unit:'瓶',price:2}); void 0`);
  const openDraft = async () => { await js('ScanOrders.open();void 0'); await pause(250); await js(`ScanOrders.session.scan('0012345678999');void 0`); await pause(350); await wait('!!ScanOrders.session.state.draft'); };

  await check('closing a scanned draft opens a three-way exit dialog', async () => {
    await openDraft();
    console.log('DBG', await js(`JSON.stringify({hash:location.hash, hidden:document.querySelector('#desktop-module-window').hidden, mod:document.querySelector('#desktop-module-window').dataset.module, hasClose:!!document.querySelector('#desktop-module-window [data-window-action=close]'), draft:!!ScanOrders.session.state.draft, fn:typeof window.ScanOrders.promptClose})`));
    await click('#desktop-module-window [data-window-action="close"]');
    await wait('!!document.querySelector(".scan-exit-dialog")');
    assert.equal(await js('document.querySelector(".scan-exit-dialog .scan-exit-cancel").textContent'), '×');
    assert.equal(await js('document.querySelector(".scan-exit-dialog .scan-exit-cancel").getAttribute("aria-label")'), '取消');
    assert.equal(await js('document.querySelector(".scan-exit-dialog [data-choice=discard]").classList.contains("btn-danger")'), true);
    assert.equal(await js('document.querySelector(".scan-exit-dialog [data-choice=save-draft]").textContent'), '保存草稿');
    fs.writeFileSync(path.join(ROOT, '.shots/design/scan-close-dialog.png'), (await win.webContents.capturePage()).toPNG());
  });
  await check('cancel keeps the module open and the draft intact', async () => {
    await click('.scan-exit-dialog [data-choice=cancel]');
    assert.equal(await js('!!document.querySelector(".scan-exit-dialog")'), false);
    assert.equal(await js('!!ScanOrders.session.state.draft'), true);
    assert.equal(await js('!document.querySelector("#desktop-module-window").hidden'), true);
  });
  await check('save draft closes the window but keeps the draft for resume', async () => {
    await click('#desktop-module-window [data-window-action="close"]'); await wait('!!document.querySelector(".scan-exit-dialog")');
    await click('.scan-exit-dialog [data-choice=save-draft]');
    await pause(300);
    assert.equal(await js('!!ScanOrders.session.state.draft'), true);
    assert.equal(await js('document.querySelector("#desktop-module-window").hidden'), true);
    const disk = JSON.parse(fs.readFileSync(path.join(process.env.DNS_TEST_DATA_DIR, 'sd_v1_scan_session_v2.json'), 'utf8'));
    const journal = typeof disk === 'string' ? JSON.parse(disk) : disk; assert.ok(journal.draft && journal.draft.items.length === 1);
  });
  await check('discard closes the window and clears the draft', async () => {
    await openDraft();
    await click('#desktop-module-window [data-window-action="close"]'); await wait('!!document.querySelector(".scan-exit-dialog")');
    await click('.scan-exit-dialog [data-choice=discard]');
    await pause(400);
    assert.equal(await js('ScanOrders.session.state.draft'), null);
    assert.equal(await js('document.querySelector("#desktop-module-window").hidden'), true);
  });
  fs.writeFileSync(path.join(ROOT, '.shots/design/scan-close-prompt.json'), JSON.stringify(results, null, 2));
  clearTimeout(deadline); win.destroy(); app.exit(results.every(r => r.ok) ? 0 : 1);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
