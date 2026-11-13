'use strict';
const { app, BrowserWindow, dialog, shell, nativeImage } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, '.shots/settings-data'); fs.mkdirSync(OUT, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-settings-data-'));
for (const [key, folder] of Object.entries({ DNS_TEST_USER_DATA: 'profile', DNS_TEST_DATA_DIR: 'data', DNS_TEST_BACKUP_DIR: 'backup', DNS_TEST_IMAGE_DIR: 'images' })) process.env[key] = path.join(temp, folder);
delete process.env.DNS_TEST_SAVE_DIR; delete process.env.DNS_TEST_PICK_FILE;
app.setPath('userData', process.env.DNS_TEST_USER_DATA); app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)), results = [], errors = [], opened = [];
let savePath = '', chosen = '', saveCalls = 0, pickCalls = 0;
dialog.showSaveDialog = async (_window, options) => { saveCalls++; return { canceled: !savePath, filePath: savePath }; };
dialog.showOpenDialog = async () => { pickCalls++; return { canceled: !chosen, filePaths: chosen ? [chosen] : [] }; };
shell.openPath = async file => { opened.push(file); return ''; };
const timeout = setTimeout(() => { console.error('SETTINGS_DATA_TIMEOUT'); app.exit(1); }, 70000);
app.on('web-contents-created', (_event, contents) => contents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); }));
require(path.join(ROOT, 'main.js'));
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 200; i++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(30); }
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async code => { for (let i = 0; i < 250; i++) { try { if (await js(code)) return; } catch (_) {} await pause(20); } throw new Error('Timeout: ' + code); };
  const check = async (name, action) => { try { await action(); results.push({ name, ok: true }); console.log('PASS ' + name); } catch (error) { results.push({ name, ok: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); } };
  const click = async selector => {
    const point = await js(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element||!element.checkVisibility())throw Error('Target not visible: '+${JSON.stringify(selector)});element.scrollIntoView({block:'center',behavior:'instant'});return true})()`);
    assert.equal(point, true); await pause(100);
    const rect = await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...rect });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...rect }); await pause(80);
  };
  await wait('!!window.DNSDesktop?.ready'); win.setContentSize(1280, 1000); win.webContents.setBackgroundThrottling(false);
  const photo = path.join(temp, 'photo.png'); fs.writeFileSync(photo, nativeImage.createFromBitmap(Buffer.alloc(4 * 4 * 4, 255), { width: 4, height: 4 }).toPNG());
  await js(`Store.clearAll();DNSDesktop.setSceneEnabled(false);const customer=Store.upsertCustomer({name:'简化设置客户',phone:'00123'}),product=Store.upsertProduct({name:'简化设置商品',spec:'500ml',unit:'瓶',price:2,image:${JSON.stringify(photo)}});Store.addOrder({no:Store.nextOrderNo(todayStr()),date:todayStr(),customer,items:[{pid:product.id,name:product.name,qty:1,price:2,amount:2}],total:2});Store.importJSON(Store.exportJSON());window.beforeSettingsData=JSON.stringify(JSON.parse(Store.exportJSON()).data);window.messages=[];window.settingsToast=toast;window.toast=(message,...args)=>{messages.push(message);settingsToast(message,...args);};location.hash='#/settings';void 0`);
  await wait('!!document.querySelector("[data-data-panel=tables]")');
  await check('only backup, restore and two disclosure headings are visible in data management by default', async () => {
    const state = await js(`(()=>{const section=document.querySelector('[aria-labelledby=settings-data-title]'),visible=selector=>Array.from(section.querySelectorAll(selector)).filter(element=>element.checkVisibility());return {actions:visible('[data-act]').map(element=>element.dataset.act),summaries:visible('summary').map(element=>element.querySelector('.settings-row-title').textContent),groups:Array.from(section.querySelectorAll('details')).map(element=>element.open)}})()`);
    assert.deepEqual(state.actions, ['backup', 'restore']); assert.deepEqual(state.summaries, ['表格导入导出', '高级选项']); assert.deepEqual(state.groups, [false, false]);
    assert.equal(await js('document.querySelectorAll("[data-role=data-dir]").length'), 1);
    assert.equal(await js('document.querySelectorAll("[data-act=clear]").length'), 1);
    await js(`(()=>{const section=document.querySelector('[aria-labelledby=settings-data-title]');section.scrollIntoView({block:'start',behavior:'instant'});let parent=section.parentElement;while(parent&&parent.scrollHeight<=parent.clientHeight+1)parent=parent.parentElement;if(parent)parent.scrollTop=Math.max(0,parent.scrollTop-85)})();void 0`); await pause(200);
    fs.writeFileSync(path.join(OUT, 'simplified-default.png'), (await win.webContents.capturePage()).toPNG());
  });
  await check('native disclosure opens table controls and keeps goods and customers on one row each', async () => {
    assert.equal(await js('document.querySelector("[data-data-panel=tables] summary").tagName'), 'SUMMARY');
    await click('[data-data-panel=tables] summary');
    await wait('document.querySelector("[data-data-panel=tables]").open');
    for (const kind of ['products', 'customers']) {
      assert.equal(await js(`(()=>{const row=document.querySelector('[data-export-kind=${kind}]');return row.querySelectorAll('[data-act=imp-${kind}]').length===1&&row.querySelectorAll('[data-act=exp-${kind}]').length===1&&row.querySelector('[data-act=imp-${kind}]').checkVisibility()})()`), true);
    }
    assert.equal(await js('document.querySelectorAll("[data-act=imp-products]").length'), 1); assert.equal(await js('document.querySelectorAll("[data-act=imp-customers]").length'), 1);
    assert.equal(await js('document.querySelector("[data-data-panel=advanced]").open'), false);
    assert.equal(await js('JSON.stringify(JSON.parse(Store.exportJSON()).data)'), await js('beforeSettingsData'));
  });
  await check('table exports remain separate from complete backups and all imports remain reachable', async () => {
    const before = saveCalls;
    await click('[data-export-kind=products] [data-format=csv]'); assert.equal(saveCalls, before);
    savePath = path.join(temp, 'products.csv'); await click('[data-act=exp-products]'); await wait('messages.includes("已导出 CSV")'); assert.ok(fs.existsSync(savePath));
    savePath = path.join(temp, 'customers.xlsx'); await click('[data-act=exp-customers]'); await wait('messages.includes("已导出 Excel")'); assert.ok(fs.existsSync(savePath));
    savePath = path.join(temp, 'summary.xlsx'); await click('[data-act=exp-orders]'); await wait('!document.querySelector("[data-act=exp-orders]").disabled'); await pause(100); assert.ok(fs.existsSync(savePath));
    const count = pickCalls; await click('[data-act=imp-products]'); await wait('!document.querySelector("[data-act=imp-products]").disabled');
    await click('[data-act=imp-customers]'); await wait('!document.querySelector("[data-act=imp-customers]").disabled'); assert.equal(pickCalls, count + 2);
  });
  await check('complete backup still carries original pictures and restore requires explicit confirmation', async () => {
    await click('[data-data-panel=tables] summary'); assert.equal(await js('document.querySelector("[data-data-panel=tables]").open'), false);
    savePath = path.join(temp, 'complete.zip'); await js('messages.length=0;void 0'); await click('[data-act=backup]'); await wait('messages.includes("备份已导出")');
    const files = require('../lib/backup-archive.js').unzipFiles(fs.readFileSync(savePath)); assert.ok(files.has('data.json')); assert.ok([...files.keys()].some(name => name.startsWith('images/')));
    const before = pickCalls; await click('[data-act=restore]'); await wait('!!document.querySelector("#modal-root .confirm-box")');
    assert.ok((await js('document.querySelector(".confirm-box").textContent')).includes('覆盖当前全部数据')); assert.equal(pickCalls, before);
    await click('#modal-root [data-act=no]'); assert.equal(pickCalls, before);
    chosen = savePath; await click('[data-act=restore]'); await click('#modal-root [data-act=yes]'); await wait('location.hash==="#/orders"');
    assert.equal(await js('Store.countAll().orders'), 1);
    await js('location.hash="#/settings";void 0'); await wait('!!document.querySelector("[data-data-panel=advanced]")');
  });
  await check('directory and local mirror actions are advanced-only and remain functional', async () => {
    await click('[data-data-panel=advanced] summary'); assert.equal(await js('document.querySelector("[data-data-panel=advanced]").open'), true);
    await click('[data-act=open-data-dir]'); await click('[data-act=open-backup-dir]');
    assert.ok(opened.includes(process.env.DNS_TEST_DATA_DIR)); assert.ok(opened.includes(process.env.DNS_TEST_BACKUP_DIR));
    await js('messages.length=0;void 0'); await click('[data-act=backup-now]'); await wait('messages.includes("已备份到程序目录之外")');
    assert.ok(fs.existsSync(path.join(process.env.DNS_TEST_BACKUP_DIR, 'data-latest.json')));
    assert.ok((await js('document.querySelector("[data-role=data-hint]").textContent')).includes('换电脑请使用“备份到文件”'));
  });
  await check('clear remains hidden until advanced is opened and cancel leaves the data intact', async () => {
    const before = await js('JSON.stringify(Store.countAll())');
    await click('[data-act=clear]'); await wait('!!document.querySelector("#modal-root .confirm-box")');
    assert.ok((await js('document.querySelector(".confirm-box").textContent')).includes('无法恢复')); await click('#modal-root [data-act=no]');
    assert.equal(await js('JSON.stringify(Store.countAll())'), before);
    await click('[data-data-panel=advanced] summary');
    assert.equal(await js('document.querySelector("[data-act=clear]").checkVisibility()'), false);
  });
  await check('combined rows fit at minimum width and folding preserves selected formats', async () => {
    win.setContentSize(1024, 850); await pause(150); await click('[data-data-panel=tables] summary');
    await click('[data-export-kind=customers] [data-format=csv]'); await click('[data-data-panel=tables] summary'); await click('[data-data-panel=tables] summary');
    assert.equal(await js('document.querySelector("[data-export-kind=customers] [data-role=export-format]").dataset.value'), 'csv');
    assert.equal(await js(`Array.from(document.querySelectorAll('.settings-export-row')).every(row=>{const r=row.getBoundingClientRect(),title=row.querySelector('.settings-row-main').getBoundingClientRect(),actions=row.querySelector('.settings-export-actions').getBoundingClientRect();return actions.right<=r.right&&actions.left>=title.right&&row.scrollWidth<=row.clientWidth+1})`), true);
    await js(`(()=>{document.querySelector('#toast').classList.remove('show');const section=document.querySelector('[data-data-panel=tables]');section.scrollIntoView({block:'start',behavior:'instant'});let parent=section.parentElement;while(parent&&parent.scrollHeight<=parent.clientHeight+1)parent=parent.parentElement;if(parent)parent.scrollTop=Math.max(0,parent.scrollTop-85)})();void 0`); await pause(150);
    fs.writeFileSync(path.join(OUT, 'combined-tables-1024.png'), (await win.webContents.capturePage()).toPNG());
  });
  await check('reopening settings returns to a compact view without mutating stored records', async () => {
    const before = await js('JSON.stringify(JSON.parse(Store.exportJSON()).data)');
    await js('location.hash="#/home";void 0'); await pause(100); await js('location.hash="#/settings";void 0'); await wait('!!document.querySelector("[data-data-panel=tables]")');
    assert.equal(await js('document.querySelector("[data-data-panel=tables]").open||document.querySelector("[data-data-panel=advanced]").open'), false);
    assert.equal(await js('JSON.stringify(JSON.parse(Store.exportJSON()).data)'), before); assert.deepEqual(errors, []);
  });
  fs.writeFileSync(path.join(OUT, 'verification.json'), JSON.stringify({ results, errors, temp }, null, 2));
  clearTimeout(timeout); app.exit(results.every(result => result.ok) ? 0 : 1);
}).catch(error => { console.error(error); console.error(JSON.stringify(errors)); clearTimeout(timeout); app.exit(1); });
