'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, '.shots/scanner-v2'); fs.mkdirSync(OUT, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-scanner-v2-'));
for (const [key, directory] of Object.entries({ DNS_TEST_USER_DATA: 'profile', DNS_TEST_DATA_DIR: 'data', DNS_TEST_BACKUP_DIR: 'backup', DNS_TEST_IMAGE_DIR: 'images', DNS_TEST_SAVE_DIR: 'exports' })) process.env[key] = path.join(temporary, directory);
app.setPath('userData', process.env.DNS_TEST_USER_DATA); app.disableHardwareAcceleration();
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const results = [], errors = [], requests = [];
const quick = process.argv.includes('--quick');
const deadline = setTimeout(() => { console.error('SCANNER_UI_TIMEOUT'); app.exit(1); }, 165000);
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
});
require(path.join(ROOT, 'main.js'));
app.whenReady().then(async () => {
  let win; for (let attempt = 0; attempt < 200; attempt++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(30); }
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async (code, seconds = 8) => { for (let attempt = 0; attempt < seconds * 20; attempt++) { if (await js(code).catch(() => false)) return; await pause(50); } throw new Error('Timeout: ' + code); };
  const check = async (name, action) => { try { await action(); results.push({ name, ok: true }); console.log('PASS ' + name); } catch (error) { results.push({ name, ok: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); } };
  const click = async selector => { await js(`document.querySelector(${JSON.stringify(selector)}).click();void 0`); await pause(90); };
  const scan = async (code, prefix = false, doubleSuffix = false) => {
    if (prefix) { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F9' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F9' }); }
    for (const character of code) {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: character });
      win.webContents.sendInputEvent({ type: 'char', keyCode: character });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: character });
    }
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    if (doubleSuffix) { await pause(20); win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' }); }
    await pause(150);
  };
  const screenshot = async name => { fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  await wait('!!window.DNSDesktop?.ready && !!window.ScanOrders'); win.show(); win.focus(); win.setContentSize(1440, 950); win.webContents.setBackgroundThrottling(false);
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => { if (/^https?:/i.test(details.url)) requests.push(details.url); callback({ cancel: false }); });
  await js(`Store.clearAll(); DNSDesktop.setSceneEnabled(false); window.scanFixture = { customer: Store.upsertCustomer({name:'扫码验证便利店',phone:'0012345'}), water:Store.upsertProduct({name:'扫码验证饮用水',barcode:'0012345678901',spec:'500ml',unit:'瓶',price:2}), missing:Store.upsertProduct({name:'待定价商品',barcode:'0012345678902',unit:'袋'}) }; void 0`);
  await check('version 2.0.0 appears in runtime and navigation', async () => {
    assert.equal(require('../package.json').version, '2.0.0'); assert.equal(await js('document.querySelector(".navigation .version").textContent'), 'V 2.0.0');
  });
  await check('first HID keyboard scan opens a new draft; three scans produce one three-unit row', async () => {
    await js('document.activeElement.blur(); void 0'); await scan('0012345678901'); await wait('location.hash === "#/order/scan" && !!document.querySelector("[data-scan-input]")');
    await scan('0012345678901', false, true); await scan('0012345678901');
    assert.equal(await js('ScanOrders.session.state.draft.items[0].qty'), '3'); assert.equal(await js('Store.listOrders().length'), 0);
    const disk = JSON.parse(fs.readFileSync(path.join(process.env.DNS_TEST_DATA_DIR, 'sd_v1_scan_session_v2.json'), 'utf8'));
    const journal = typeof disk === 'string' ? JSON.parse(disk) : disk; assert.equal(journal.draft.items[0].qty, '3'); await screenshot('01-scanning');
  });
  await check('quantity editing persists and selecting the customer is explicit', async () => {
    await js(`(()=>{const input=document.querySelector('[data-line-field="price"]');input.focus();input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));ScanOrders.session.state.lastActivity=Date.now()-60001;})();void 0`);
    await click('[data-scan-action="finish"]'); await pause(300); assert.equal(await js('!!document.querySelector(".scan-confirm-mask")'), false);
    await js(`(()=>{const input=document.querySelector('[data-line-field="price"]');input.value='2';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})();void 0`);
    await js(`(()=>{const input=document.querySelector('[data-line-field="qty"]');input.focus();input.value='4';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})();void 0`);
    assert.equal(await js('ScanOrders.session.state.draft.items[0].qty'), '4');
    await click('[data-scan-action="customer"]'); await click('[data-scan-customer]');
    assert.equal(await js('ScanOrders.session.state.draft.customer.id === scanFixture.customer.id'), true);
  });
  await check(quick ? 'elapsed inactivity deadline opens a modal that locks background navigation' : 'real 60-second inactivity opens a modal that locks background navigation', async () => {
    await js('document.querySelector("[data-scan-input]").focus();void 0');
    if (quick) await js('ScanOrders.session.state.lastActivity=Date.now()-60001;ScanOrders.session.retry();void 0');
    const started = Date.now();
    await wait('!!document.querySelector(".scan-confirm-mask")', 64);
    if (!quick) assert.ok(Date.now() - started >= 58000);
    assert.equal(await js('document.querySelector("#desktop-app").inert'), true);
    await js('DNSDesktop.navigate("#/products");void 0'); await pause(100); assert.equal(await js('location.hash'), '#/order/scan');
    await screenshot('02-confirmation');
  });
  await check('scanner Enter cannot activate Save; scans at confirmation remain queued until assigned', async () => {
    await js('document.querySelector(".scan-confirm-mask [data-scan-action=save]").focus();void 0');
    await scan('0012345678901', false, true); await scan('0012345678901');
    assert.equal(await js('Store.listOrders().length'), 0); assert.equal(await js('ScanOrders.session.state.queued.length'), 2);
    assert.equal(await js('ScanOrders.session.state.draft.items[0].qty'), '4'); await screenshot('03-queued');
    await js(`window.originalScannerSetItem=window.__DNSStorage.setItem;window.__DNSStorage.setItem=function(key,value){if(key==='sd_v1_orders')throw new Error('模拟磁盘写入失败');return originalScannerSetItem(key,value);};void 0`);
    await click('.scan-confirm-mask [data-scan-action="save"]');
    assert.equal(await js('Store.listOrders().length'), 0); assert.equal(await js('ScanOrders.session.state.queued.length'), 2);
    assert.equal(await js('ScanOrders.session.state.draft.items[0].qty'), '4');
    await js('window.__DNSStorage.setItem=window.originalScannerSetItem;void 0');
    await click('.scan-confirm-mask [data-scan-action="save"]');
    assert.equal(await js('Store.listOrders().length'), 1); assert.equal(await js('Store.listOrders()[0].items[0].qty'), 4);
    assert.equal(await js('ScanOrders.session.state.draft.items[0].qty'), '2'); assert.equal(await js('ScanOrders.session.state.draft.customer'), null);
    assert.equal(await js('!!document.querySelector(".scan-confirm-mask")'), false);
  });
  await check('unknown and missing-price barcodes are retained, actionable, and never silently saved', async () => {
    await scan('0012345678902'); await scan('0000000000099');
    assert.equal(await js('ScanOrders.session.state.draft.issues.length'), 2);
    await click('[data-scan-action="resolve"]');
    await js(`document.querySelector('[data-product-price]').value='3.5';void 0`); await click('[data-resolve]');
    assert.equal(await js('ScanOrders.session.state.draft.issues.length'), 1);
    await click('[data-scan-action="resolve"]');
    await js(`document.querySelector('[data-product-name]').value='新登记饼干';document.querySelector('[data-product-spec]').value='100g';document.querySelector('[data-product-unit]').value='包';document.querySelector('[data-product-price]').value='4';void 0`); await click('[data-resolve]');
    assert.equal(await js('ScanOrders.session.state.draft.issues.length'), 0); assert.equal(await js('Store.listProducts("0000000000099").length'), 1);
  });
  await check('ordinary typing is not intercepted; F9-framed scans work without changing the typed field', async () => {
    await click('[data-scan-action="settings"]');
    await js(`document.querySelector('[data-scan-mode]').value='prefix';void 0`); await click('[data-config-save]');
    await js(`document.querySelector('[data-line-field="qty"]').focus();void 0`);
    const before = await js('ScanOrders.session.state.draft.items[0].qty'); await scan('0012345678901', true);
    assert.equal(await js('Number(ScanOrders.session.state.draft.items[0].qty)'), Number(before) + 1);
    await click('[data-scan-action="settings"]'); await js(`document.querySelector('[data-scan-mode]').value='auto';void 0`); await click('[data-config-save]');
  });
  await check('reloading restores the exact draft and queue, without creating another formal order', async () => {
    await click('[data-scan-action="finish"]'); await scan('0012345678901');
    const before = await js('JSON.stringify(ScanOrders.session.state.draft)');
    const queue = await js('JSON.stringify(ScanOrders.session.state.queued)');
    win.webContents.reload(); await wait('!!window.DNSDesktop?.ready && location.hash === "#/order/scan"');
    assert.equal(await js('JSON.stringify(ScanOrders.session.state.draft)'), before); assert.equal(await js('Store.listOrders().length'), 1);
    assert.equal(await js('JSON.stringify(ScanOrders.session.state.queued)'), queue);
    await screenshot('04-restored');
  });
  await check('minimum-size window keeps the confirmation actions inside the viewport', async () => {
    win.setContentSize(1000, 720); await click('[data-scan-action="finish"]'); await pause(200);
    assert.equal(await js(`(()=>{const box=document.querySelector('.scan-confirm-dialog').getBoundingClientRect(),save=document.querySelector('.scan-confirm-mask [data-scan-action="save"]').getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&box.bottom<=innerHeight&&save.bottom<=innerHeight;})()`), true);
    await screenshot('05-confirmation-small');
  });
  await check('background clicks and Escape do not dismiss confirmation; Continue preserves all items', async () => {
    const count = await js('ScanOrders.session.state.draft.items.length');
    await click('.scan-confirm-mask'); win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); await pause(80);
    assert.equal(await js('!!document.querySelector(".scan-confirm-mask")'), true);
    await click('.scan-confirm-mask [data-scan-action="continue"]');
    assert.equal(await js('ScanOrders.session.state.draft.items.length'), count); assert.equal(await js('document.querySelector("#desktop-app").inert'), false);
  });
  await check('manual order entry and version display remain available after saving the scanner session', async () => {
    await click('[data-scan-action="customer"]'); await click('[data-walk-in]'); await click('[data-scan-action="finish"]'); await click('.scan-confirm-mask [data-scan-action="save"]');
    assert.equal(await js('ScanOrders.session.state.draft'), null); assert.equal(await js('Store.listOrders().length'), 2);
    await js('DNSDesktop.navigate("#/order/new");void 0'); await wait('!!document.querySelector("#view-container .view")?.__draft');
    assert.equal(await js('document.querySelector("#view-container .view").__draft.items.length'), 0);
    await js('document.querySelector("#view-container .view").__saved=true;DNSDesktop.navigate("#/settings");void 0'); await pause(100);
    assert.equal(await js('document.querySelector(".settings-about-row .settings-row-value").textContent'), 'v2.0.0');
  });
  await check('ordinary numeric typing in a manual order field never starts automatic scanner entry', async () => {
    await js('DNSDesktop.navigate("#/order/new");void 0'); await wait('!!document.querySelector("#view-container .view")?.__draft');
    await click('[data-act="add-item"]'); await scan('0012345678901');
    assert.equal(await js('document.querySelector(".item-dialog [data-role=name]").value'), '0012345678901');
    assert.equal(await js('ScanOrders.session.state.draft'), null); assert.equal(await js('location.hash'), '#/order/new');
    await js('document.querySelector(".item-dialog").closest(".mask").remove();document.querySelector("#view-container .view").__saved=true;void 0');
  });
  await check('scanner workflow remains offline and emits no renderer errors', async () => { assert.deepEqual(requests, []); assert.deepEqual(errors, []); });
  fs.writeFileSync(path.join(OUT, 'verification.json'), JSON.stringify({ quick, temporary, results, errors, requests }, null, 2));
  clearTimeout(deadline); win.destroy(); app.exit(results.every(result => result.ok) ? 0 : 1);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
