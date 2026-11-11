'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Never open the user's normal profile or write test records into real data.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-note-logic-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration();
const timeout = setTimeout(() => { console.error('UI tests timed out'); app.exit(1); }, 60000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: true },
  });
  let failed = 0;
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) errors.push(message);
  });
  const run = (name, scenario) => async () => {
    try {
      await win.webContents.executeJavaScript('(' + scenario.toString() + ')()', true);
      console.log('PASS ' + name);
    } catch (error) {
      failed++;
      console.error('FAIL ' + name + ': ' + error.message);
    }
  };
  try {
    await win.loadFile(path.resolve(__dirname, '../webapp/index.html'));
    await win.webContents.executeJavaScript(`
      window.check = (ok, message) => { if (!ok) throw new Error(message); };
      window.pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      window.navigate = async hash => { location.hash = hash; await pause(60); };
      window.resetData = async () => {
        Store.clearAll(); window.__orderDraft = null;
        await navigate('#/home');
        document.getElementById('modal-root').innerHTML = '';
      };
      window.makeOrder = (overrides = {}) => ({
        no: Store.nextOrderNo(todayStr()), date: todayStr(), customer: null,
        items: [{ name: 'Water', spec: '500ml', qty: 2, price: 3, amount: 6 }],
        total: 6, ...overrides,
      });
      window.startDraft = async data => {
        window.__orderDraft = { ...makeOrder(), id: null, ...data };
        await navigate('#/order/new');
        return document.querySelector('#view-container .view');
      };
      window.saveDraft = async () => {
        document.querySelector('#view-container [data-act="save"]').click();
        await pause(60);
      };
      void 0;
    `);

    await run('copy creates a new order and leaves the original unchanged', async () => {
      await resetData();
      const original = Store.addOrder(makeOrder());
      const before = JSON.stringify(original);
      await navigate('#/order/view?id=' + original.id);
      document.querySelector('#view-container [data-act="copy"]').click();
      await pause(60);
      const draft = document.querySelector('#view-container .view').__draft;
      check(!draft.id, 'Copied draft still has the original ID');
      draft.items[0].qty = '4';
      await saveDraft();
      check(Store.countAll().orders === 2, 'Copy did not create a second order');
      check(JSON.stringify(Store.getOrder(original.id)) === before, 'Original order changed');
      const copied = Store.listOrders().find(o => o.id !== original.id);
      check(copied.no !== original.no && copied.total === 12, 'Copy number/total is wrong');
    })();

    await run('manual specifications resolve the right product before remembering price', async () => {
      await resetData();
      const customer = Store.upsertCustomer({ name: 'Customer' });
      const small = Store.upsertProduct({ name: 'Water', spec: '500ml' });
      const large = Store.upsertProduct({ name: 'Water', spec: '1L' });
      Store.setLastPrice(customer.id, small.id, 2);
      await startDraft({ customer, items: [{ name: 'Water', spec: '1L', qty: '2', price: '7' }] });
      await saveDraft();
      const saved = Store.listOrders()[0];
      check(saved.items[0].pid === large.id, 'Wrong product specification linked');
      check(Store.getLastPrice(customer.id, large.id) === 7, 'Resolved product price was not remembered');
      check(Store.getLastPrice(customer.id, small.id) === 2, 'Other specification price changed');
    })();

    await run('changing a new order date updates its number while edits keep their identity', async () => {
      await resetData();
      await startDraft({});
      const input = document.querySelector('[data-f="date"]');
      input.value = '2026-10-31'; input.dispatchEvent(new Event('input', { bubbles: true }));
      check(document.querySelector('[data-role="order-no"]').textContent.includes('-20261031-'), 'Number did not follow the new date');
      await saveDraft();
      const saved = Store.listOrders()[0];
      check(saved.date === '2026-10-31' && saved.no.includes('-20261031-'), 'Saved date/number mismatch');
      const no = saved.no;
      await navigate('#/order/edit?id=' + saved.id);
      const edit = document.querySelector('[data-f="date"]');
      edit.value = '2026-11-01'; edit.dispatchEvent(new Event('input', { bubbles: true }));
      await saveDraft();
      check(Store.getOrder(saved.id).no === no, 'Editing an existing order changed its number');
    })();

    await run('renaming a selected item clears its old product identity', async () => {
      await resetData();
      const customer = Store.upsertCustomer({ name: 'Customer' });
      const product = Store.upsertProduct({ name: 'Water', spec: '500ml', price: 3 });
      Store.setLastPrice(customer.id, product.id, 3);
      const original = Store.addOrder(makeOrder({ customer, items: [{ pid: product.id, name: product.name, spec: product.spec, qty: 2, price: 3, amount: 6 }] }));
      await navigate('#/order/edit?id=' + original.id);
      document.querySelector('.oi-card').click();
      const input = document.querySelector('.item-dialog [data-role="name"]');
      input.value = 'Juice'; input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.item-dialog [data-role="price"]').value = '5';
      document.querySelector('.item-dialog [data-act="ok"]').click();
      await saveDraft();
      const item = Store.getOrder(original.id).items[0];
      check(item.pid !== product.id, 'Renamed item reused the old ID');
      check(Store.getProduct(item.pid).name === 'Juice', 'New product was not resolved');
      check(Store.getLastPrice(customer.id, product.id) === 3, 'Old product price was overwritten');
      check(Store.getLastPrice(customer.id, item.pid) === 5, 'New product price was not remembered');
    })();

    await run('invalid lines stop saving instead of silently dropping items', async () => {
      await resetData();
      await startDraft({ items: [
        { name: 'Valid', qty: '1', price: '2' },
        { name: 'Invalid', qty: '0', price: '2' },
      ] });
      await saveDraft();
      check(Store.countAll().orders === 0, 'Invalid line was silently discarded');
      check(location.hash === '#/order/new', 'Invalid order left the editor');
      check(document.querySelector('#toast').classList.contains('err'), 'Missing validation error');
    })();

    await run('non-finite amounts and negative prices cannot be saved', async () => {
      for (const price of ['1e309', '-1', '1e300']) {
        await resetData();
        await startDraft({ items: [{ name: 'Invalid', qty: '2', price }] });
        await saveDraft();
        check(Store.countAll().orders === 0, 'Invalid price was saved: ' + price);
      }
    })();

    await run('failed order save rolls back related records and can be retried', async () => {
      await resetData();
      await startDraft({ customer: { name: 'New customer' }, items: [{ name: 'New product', qty: '1', price: '5' }] });
      const before = JSON.stringify(JSON.parse(Store.exportJSON()).data);
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'sd_v1_orders' && value !== '[]') throw new DOMException('Full', 'QuotaExceededError');
        return original.call(this, key, value);
      };
      try {
        await saveDraft();
        check(JSON.stringify(JSON.parse(Store.exportJSON()).data) === before, 'Failed save left partial business data');
        check(location.hash === '#/order/new', 'Failed save left the editor');
      } finally { Storage.prototype.setItem = original; }
      await saveDraft();
      check(Store.countAll().orders === 1 && Store.countAll().customers === 1 && Store.countAll().products === 1, 'Retry did not save all records');
      const saved = Store.listOrders()[0];
      check(!!Store.getCustomer(saved.customer.id), 'Retry left a dangling customer ID');
      check(Store.getLastPrice(saved.customer.id, saved.items[0].pid) === 5, 'Retry missed price history');
    })();

    await run('product specification is included in print preview and exported image', async () => {
      await resetData();
      const saved = Store.addOrder(makeOrder());
      await navigate('#/print?id=' + saved.id);
      check(document.querySelector('.doc table').textContent.includes('Water 500ml'), 'Print preview lost the specification');
      const original = CanvasRenderingContext2D.prototype.fillText;
      const drawn = [];
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        drawn.push(text); return original.call(this, text, ...args);
      };
      try { drawDocToCanvas(saved, Store.getSettings()); }
      finally { CanvasRenderingContext2D.prototype.fillText = original; }
      check(drawn.includes('Water 500ml'), 'Exported image lost the specification');
    })();

    await run('ordinary customer/product names cannot collide with object properties', async () => {
      await resetData();
      const customer = Store.upsertCustomer({ id: 'constructor', name: 'constructor' });
      Store.addOrder(makeOrder({ customer, items: [{ name: '__proto__', qty: 2, price: 3, amount: 6 }] }));
      const group = Store.billGroups(todayStr().slice(0, 7))[0];
      check(group.total === 6, 'Monthly bill grouping collided with object prototype');
      await navigate('#/stats');
      const rank = document.querySelector('[data-role="custRank"]').textContent;
      check(rank.includes('constructor') && rank.includes('6.00'), 'Customer rank is wrong');
      const products = document.querySelector('[data-role="prodRank"]').textContent;
      check(products.includes('__proto__') && products.includes('6.00'), 'Product rank is wrong');
    })();

    if (errors.length) {
      failed++;
      console.error('Renderer errors: ' + errors.join('\n'));
    }
  } catch (error) {
    failed++;
    console.error(error.stack || String(error));
  }
  clearTimeout(timeout);
  console.log(failed ? 'UI_REGRESSION_FAIL' : 'UI_REGRESSION_OK');
  win.destroy();
  // Chromium may hold profile files until exit; only touch our own temp folder.
  app.on('quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {} });
  app.exit(failed ? 1 : 0);
}).catch(error => { console.error(error); app.exit(1); });
