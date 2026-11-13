'use strict';
// Two independent Electron processes model the old and replacement computers.
// No normal profile, business directory, physical printer or real dialog is used.
const { app, BrowserWindow, dialog, Menu, nativeImage } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { unzipFiles, zipFiles } = require('../lib/backup-archive.js');
const ROOT = path.resolve(__dirname, '..'), restoring = process.argv.includes('--restore');
const transferDir = restoring ? process.argv.at(-1) : fs.mkdtempSync(path.join(os.tmpdir(), 'dns-portable-'));
const phase = restoring ? 'new-computer' : 'old-computer', phaseDir = path.join(transferDir, phase);
fs.mkdirSync(phaseDir, { recursive: true });
process.env.DNS_TEST_USER_DATA = path.join(phaseDir, 'profile');
process.env.DNS_TEST_DATA_DIR = path.join(phaseDir, 'data');
process.env.DNS_TEST_BACKUP_DIR = path.join(phaseDir, 'backup');
process.env.DNS_TEST_IMAGE_DIR = path.join(phaseDir, 'images');
delete process.env.DNS_TEST_SAVE_DIR; delete process.env.DNS_TEST_PICK_FILE;
if (!restoring) fs.writeFileSync(process.env.DNS_TEST_BACKUP_DIR, 'blocked backup destination');
app.setPath('userData', process.env.DNS_TEST_USER_DATA); app.disableHardwareAcceleration();
let savePath = path.join(transferDir, 'transfer.zip'), openPath = '';
dialog.showSaveDialog = async () => ({ canceled: !savePath, filePath: savePath });
dialog.showOpenDialog = async () => ({ canceled: !openPath, filePaths: openPath ? [openPath] : [] });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [], timeout = setTimeout(() => { console.error('BACKUP_MIGRATION_TIMEOUT'); app.exit(1); }, 90000);
require(path.join(ROOT, 'main.js'));
app.whenReady().then(async () => {
  let win;
  for (let i = 0; i < 150; i++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(40); }
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async code => { for (let i = 0; i < 200; i++) { try { if (await js(code)) return; } catch (_) {} await pause(30); } throw new Error('Timeout: ' + code); };
  const nav = async hash => { await js('location.hash=' + JSON.stringify(hash)); await pause(100); };
  const check = async (name, action) => {
    try { await action(); results.push({ name, ok: true }); console.log('PASS ' + phase + ': ' + name); }
    catch (error) { results.push({ name, ok: false, error: error.message }); console.error('FAIL ' + phase + ': ' + name + ': ' + error.message); }
  };
  const restoreViaUI = async file => {
    openPath = file; await nav('#/settings');
    await js('if(window.messages)messages.length=0;void 0');
    await js('document.querySelector("[data-act=restore]").click();void 0');
    await wait('!!document.querySelector("#modal-root [data-act=yes]")');
    await js('document.querySelector("#modal-root [data-act=yes]").click();void 0');
  };
  await wait('!!window.DNSDesktop?.ready');
  await js('window.messages=[];window.originalToast=toast;window.toast=(message,...args)=>{messages.push(message);originalToast(message,...args);};void 0');
  if (!restoring) {
    const imagePath = path.join(phaseDir, 'photo.png');
    const imageBytes = nativeImage.createFromBitmap(Buffer.alloc(800 * 600 * 4, 255), { width: 800, height: 600 }).toPNG();
    assert.ok(imageBytes.length > 0);
    fs.writeFileSync(imagePath, imageBytes);
    await js(`window.fx={};fx.builtin=Store.listProducts().find(p=>p.builtinKey);fx.removed=Store.listProducts().find(p=>p.builtinKey&&p.id!==fx.builtin.id);fx.customer=Store.upsertCustomer({name:'换机验收客户',phone:'00123'});fx.product=Store.upsertProduct({name:'换机自建商品',spec:'2kg',unit:'袋',price:3,image:${JSON.stringify(imagePath)}});Store.upsertProduct({...fx.builtin,price:7,image:${JSON.stringify(imagePath)}});fx.order=Store.addOrder({no:Store.nextOrderNo('2026-11-12'),date:'2026-11-12',customer:fx.customer,items:[{pid:fx.product.id,name:fx.product.name,qty:2,price:3,amount:6},{pid:fx.builtin.id,name:fx.builtin.name,qty:1,price:7,amount:7}],total:13,note:'换机后保留备注'});Store.setLastPrice(fx.customer.id,fx.product.id,3);Store.setLastPrice(fx.customer.id,fx.builtin.id,7);Store.deleteProduct(fx.builtin.id);Store.deleteProduct(fx.removed.id);Store.setSettings({company:'换机验收店铺',imageDir:${JSON.stringify(phaseDir)}});void 0`);
    const expected = await js('({counts:Store.countAll(),customerId:fx.customer.id,productId:fx.product.id,builtinId:fx.builtin.id,removedId:fx.removed.id,orderId:fx.order.id,orderNo:fx.order.no})');
    expected.imageHash = createHash('sha256').update(imageBytes).digest('hex');
    fs.writeFileSync(path.join(transferDir, 'expected.json'), JSON.stringify(expected));
    await nav('#/settings');
    await check('ZIP contains JSON and byte-identical original photos larger than thumbnails', async () => {
      await js('document.querySelector("[data-act=backup]").click();void 0');
      for (let i = 0; i < 200 && !fs.existsSync(savePath); i++) await pause(30);
      assert.ok(fs.existsSync(savePath), await js('document.querySelector("#toast").textContent'));
      const files = unzipFiles(fs.readFileSync(savePath));
      const backup = JSON.parse(files.get('data.json').toString('utf8'));
      assert.equal(backup.version, 2); assert.equal(backup.data.products.length, 1);
      assert.equal(backup.data.products[0].id, expected.productId);
      assert.match(backup.data.products[0].image, /^backup:images\//);
      assert.ok(files.get(backup.data.products[0].image.slice(7)).equals(imageBytes));
      assert.equal(nativeImage.createFromBuffer(files.get(backup.data.products[0].image.slice(7))).getSize().width, 800);
      assert.equal(files.size, 2); // shared custom/catalog-override photo is stored once
      assert.equal(backup.catalog.entries.find(e => e.id === expected.builtinId).changes.price, 7);
      assert.equal(backup.catalog.entries.find(e => e.id === expected.builtinId).changes.archived, true);
      assert.equal(backup.data.settings.imageDir, '');
      assert.equal(await js('Store.getProduct(fx.product.id).image'), imagePath);
    });
    await check('canceled save never claims a successful export', async () => {
      await wait('!document.querySelector("[data-act=backup]").disabled'); savePath = '';
      await js('messages.length=0;document.querySelector("[data-act=backup]").click();void 0');
      await wait('!document.querySelector("[data-act=backup]").disabled');
      assert.equal(await js('messages.includes("备份已导出")'), false);
    });
    await check('backup failure is shown and retry succeeds after repairing the directory', async () => {
      await js('messages.length=0;document.querySelector("[data-act=backup-now]").click();void 0');
      await wait('messages.some(message=>message.startsWith("备份失败"))');
      assert.equal(await js('messages.includes("已备份到程序目录之外")'), false);
      fs.unlinkSync(process.env.DNS_TEST_BACKUP_DIR); fs.mkdirSync(process.env.DNS_TEST_BACKUP_DIR);
      await js('messages.length=0;document.querySelector("[data-act=backup-now]").click();void 0');
      await wait('messages.includes("已备份到程序目录之外")');
      assert.ok(fs.existsSync(path.join(process.env.DNS_TEST_BACKUP_DIR, 'data-latest.json')));
    });
    fs.unlinkSync(imagePath); // The replacement process cannot read the source photo.
    await check('unreadable original prevents an incomplete ZIP export', async () => {
      savePath = path.join(transferDir, 'missing-image.zip');
      await js('messages.length=0;document.querySelector("[data-act=backup]").click();void 0');
      await wait('!document.querySelector("[data-act=backup]").disabled');
      assert.equal(fs.existsSync(savePath), false);
      assert.equal(await js('messages.includes("备份已导出")'), false);
      assert.equal(await js('messages.some(message=>message.includes("备份未导出"))'), true);
    });
    if (results.every(result => result.ok)) {
      const child = spawnSync(process.execPath, [__filename, '--restore', transferDir], { env: process.env, encoding: 'utf8', windowsHide: true, timeout: 45000 });
      if (child.stdout) process.stdout.write(child.stdout); if (child.stderr) process.stderr.write(child.stderr);
      await check('independent replacement-computer process completes migration', async () => assert.equal(child.status, 0, child.error?.message || child.stderr));
    }
  } else {
    const expected = JSON.parse(fs.readFileSync(path.join(transferDir, 'expected.json'), 'utf8'));
    const invalid = path.join(transferDir, 'invalid.json'); fs.writeFileSync(invalid, JSON.stringify({ app: 'songhuodan', version: 1, data: { unrelated: [] } }));
    await check('unrecognized JSON is rejected without replacing current data', async () => {
      await js('Store.upsertCustomer({name:"恢复前哨兵客户"});window.beforeRestore=JSON.stringify(Store.countAll());void 0');
      await restoreViaUI(invalid); await wait('messages.some(message=>message.includes("没有可识别"))');
      assert.equal(await js('JSON.stringify(Store.countAll())'), await js('beforeRestore'));
    });
    await check('import ZIP restores customer, orders, products and photos to the new image directory', async () => {
      await restoreViaUI(path.join(transferDir, 'transfer.zip')); await wait('messages.includes("恢复成功")');
      assert.deepEqual(await js('Store.countAll()'), expected.counts);
      assert.equal(await js(`Store.getCustomer(${JSON.stringify(expected.customerId)}).phone`), '00123');
      assert.equal(await js(`Store.getOrder(${JSON.stringify(expected.orderId)}).total`), 13);
      assert.equal(await js(`Store.getProduct(${JSON.stringify(expected.builtinId)}).price`), 7);
      assert.equal(await js(`Store.getProduct(${JSON.stringify(expected.builtinId)}).archived`), true);
      assert.equal(await js(`Store.getLastPrice(${JSON.stringify(expected.customerId)},${JSON.stringify(expected.builtinId)})`), 7);
      assert.equal(await js(`Store.getOrder(${JSON.stringify(expected.orderId)}).items[0].pid`), expected.productId);
      assert.equal(await js('Store.getSettings().imageDir'), '');
      const image = await js(`Store.getProduct(${JSON.stringify(expected.productId)}).image`);
      assert.ok(path.isAbsolute(image)); assert.ok(image.startsWith(process.env.DNS_TEST_IMAGE_DIR + path.sep));
      assert.equal(createHash('sha256').update(fs.readFileSync(image)).digest('hex'), expected.imageHash);
      assert.equal(await js('Store.listCustomers().some(c=>c.name==="恢复前哨兵客户")'), false);
    });
    await check('automatic snapshot import preserves records instead of clearing them', async () => {
      await restoreViaUI(path.join(transferDir, 'old-computer', 'backup', 'data-latest.json'));
      await wait('messages.includes("恢复成功")');
      assert.deepEqual(await js('Store.countAll()'), expected.counts);
      assert.equal(await js(`Store.getOrder(${JSON.stringify(expected.orderId)}).total`), 13);
      await restoreViaUI(path.join(transferDir, 'transfer.zip')); await wait('messages.includes("恢复成功")');
    });
    await check('restored picture renders without the old directory and survives restart', async () => {
      const rendered = await js(`new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth>0);image.onerror=()=>resolve(false);image.src=productImageUrl(Store.getProduct(${JSON.stringify(expected.productId)}).image);})`);
      assert.equal(rendered, true); win.reload(); await pause(300); await wait('!!window.DNSDesktop?.ready');
      assert.deepEqual(await js('Store.countAll()'), expected.counts);
      assert.equal(await js(`Store.getProduct(${JSON.stringify(expected.removedId)})==null`), true);
      assert.equal(await js(`Store.getProduct(${JSON.stringify(expected.builtinId)}).archived`), true);
      assert.equal(await js('Store.getSettings().company'), '换机验收店铺');
    });
    await check('replacement computer can back up its restored original photos again', async () => {
      await nav('#/settings'); savePath = path.join(phaseDir, 'second-backup.zip');
      await js('document.querySelector("[data-act=backup]").click();void 0');
      for (let i = 0; i < 200 && !fs.existsSync(savePath); i++) await pause(30);
      const files = unzipFiles(fs.readFileSync(savePath));
      const backup = JSON.parse(files.get('data.json'));
      assert.equal(createHash('sha256').update(files.get(backup.data.products[0].image.slice(7))).digest('hex'), expected.imageHash);
    });
    await check('failed data validation cleans up staged photos and preserves existing data', async () => {
      const files = unzipFiles(fs.readFileSync(path.join(transferDir, 'transfer.zip'))), backup = JSON.parse(files.get('data.json'));
      backup.data.orders[0].total += 1;
      files.set('data.json', Buffer.from(JSON.stringify(backup)));
      const invalidArchive = path.join(transferDir, 'invalid-data.zip');
      fs.writeFileSync(invalidArchive, zipFiles([...files].map(([name, data]) => ({ name, data }))));
      const folders = fs.readdirSync(process.env.DNS_TEST_IMAGE_DIR).sort();
      const before = await js('JSON.stringify(JSON.parse(Store.exportJSON()).data)');
      await restoreViaUI(invalidArchive);
      await wait('document.querySelector("#toast").textContent.includes("合计金额")');
      for (let i = 0; i < 150 && JSON.stringify(fs.readdirSync(process.env.DNS_TEST_IMAGE_DIR).sort()) !== JSON.stringify(folders); i++) await pause(30);
      assert.deepEqual(fs.readdirSync(process.env.DNS_TEST_IMAGE_DIR).sort(), folders);
      assert.equal(await js('JSON.stringify(JSON.parse(Store.exportJSON()).data)'), before);
    });
    await check('corrupt storage blocks all normal export and print entry points', async () => {
      await js('window.__DNSStorage.setItem("sd_v1_customers","[{broken");void 0');
      win.reload(); await pause(300); await wait('!!window.DNSDesktop?.ready');
      assert.equal(await js('Store.recoveryState().blocked'), true);
      await js('window.saved=[];window.prints=0;window.packageExports=0;Android.saveFile=async(...args)=>{saved.push(args);return {ok:true}};Android.exportBackup=async()=>{packageExports++;return {ok:true}};Android.printPdf=async()=>{prints++;return {ok:true}};void 0');
      await nav('#/settings');
      await js('for(const action of ["backup","exp-orders","exp-products","exp-customers"])document.querySelector("[data-act="+action+"]").click();void 0'); await pause(80);
      await nav('#/orders'); await js('document.querySelector("#dispatch-collection [data-act=export]").click();void 0');
      await nav('#/stats'); await js('document.querySelector("#statistics-view [data-act=export]").click();document.querySelector("#statistics-view [data-act=bill-all]").click();void 0');
      await js(`exportBillXlsx('2026-11',${JSON.stringify(expected.customerId)},'换机验收客户');void 0`);
      await nav('#/print?id=' + expected.orderId);
      assert.equal(await js('!!document.querySelector("[data-act=save-img]")'), false);
      await js('DNSDesktop.printCurrent();void 0');
      await nav('#/bill?m=2026-11&c=' + expected.customerId);
      assert.equal(await js('!!document.querySelector(".bill-paper")'), false);
      assert.equal(await js('DNSDesktop.printCurrent()'), true);
      let nativePrints = 0;
      win.webContents.print = (_options, callback) => { nativePrints++; if (callback) callback(true); };
      const findPrint = menu => {
        for (const item of menu.items) {
          if (item.label === '打印 / 预览单据') return item;
          if (item.submenu) { const found = findPrint(item.submenu); if (found) return found; }
        }
      };
      const printItem = findPrint(Menu.getApplicationMenu()); assert.ok(printItem);
      printItem.click(printItem, win); await pause(100);
      assert.equal(nativePrints, 0);
      assert.equal(await js('saved.length'), 0); assert.equal(await js('prints'), 0); assert.equal(await js('packageExports'), 0);
    });
    await check('raw recovery remains exportable and valid JSON clears protection', async () => {
      await js('document.querySelector("[data-action=export-recovery]").click();void 0'); await pause(80);
      assert.equal(await js('saved.length'), 1);
      assert.equal(await js('JSON.parse(decodeURIComponent(escape(atob(saved[0][2])))).raw.sd_v1_customers'), '[{broken');
      await restoreViaUI(path.join(transferDir, 'transfer.zip')); await wait('!Store.recoveryState().blocked');
      assert.deepEqual(await js('Store.countAll()'), expected.counts);
    });
  }
  fs.writeFileSync(path.join(phaseDir, 'verification.json'), JSON.stringify(results, null, 2));
  clearTimeout(timeout); app.exit(results.every(result => result.ok) ? 0 : 1);
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
