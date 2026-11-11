'use strict';
// 预览：桌面顶部全局搜索栏重新设计（默认 / 聚焦 / 输入中三态）。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-search-bar-'));
const OUT = path.join(ROOT, '.shots/design');
fs.mkdirSync(OUT, { recursive: true });
app.setPath('userData', profile);
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const pause = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
app.on('web-contents-created', (_e, c) => { c.on('console-message', (_x, level, m) => { if (level >= 3) errors.push(m); }); });
const deadline = setTimeout(() => { console.error('SEARCH_BAR_PREVIEW_TIMEOUT'); app.exit(1); }, 100000);
require(path.join(ROOT, 'main.js'));
app.whenReady().then(async () => {
  let win;
  for (let i = 0; i < 100; i++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(50); }
  if (!win) throw new Error('no main window');
  const js = code => win.webContents.executeJavaScript(code, true);
  await js(`(async () => { for (let i = 0; i < 100 && !window.DNSDesktop?.ready; i++) await new Promise(r => setTimeout(r, 60)); return !!window.DNSDesktop?.ready; })()`);
  win.show();
  win.setContentSize(1440, 900);
  await pause(400);
  await js(`(() => {
    Store.clearAll();
    const customer = Store.upsertCustomer({ name: '华联超市（城东店）', address: '城东街道 88 号', phone: '138 0000 1234' });
    const items = [{ pid: '', name: '怡宝纯净水 555ml', spec: '555ml', unit: '瓶', qty: 12, price: 2 }].map(it => ({ ...it, amount: it.qty * it.price }));
    Store.addOrder({ no: Store.nextOrderNo(todayStr()), date: todayStr(), customer, items, total: 24, note: '' });
    DNSDesktop.refresh();
  })()`);
  await pause(300);
  const rect = { x: 0, y: 0, width: 1440, height: 80 };
  const shoot = name => win.webContents.capturePage(rect).then(img => fs.writeFileSync(path.join(OUT, name), img.toPNG()));

  // 默认（未聚焦、空）
  await js(`document.activeElement && document.activeElement.blur()`);
  await pause(250);
  await shoot('search-bar-default.png');

  // 聚焦（空）
  await js(`document.querySelector('#global-search').focus()`);
  await pause(250);
  await shoot('search-bar-focus.png');

  // 输入中（有结果 + 清空按钮）
  const state = await js(`(() => {
    const i = document.querySelector('#global-search');
    i.focus(); i.value = '华联'; i.dispatchEvent(new Event('input', { bubbles: true }));
    const clear = document.querySelector('.hs-clear');
    const kbd = document.querySelector('.header-search kbd');
    const cs = getComputedStyle(i);
    return {
      hasKbd: !!kbd,
      clearHidden: clear ? clear.hidden : 'missing',
      resultsVisible: !document.querySelector('#search-results').hidden,
      resultCount: document.querySelectorAll('#search-results .search-result').length,
      inputStyle: {
        border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
        bg: cs.backgroundColor,
        radius: cs.borderRadius,
        padding: cs.padding,
        boxShadow: cs.boxShadow,
        width: cs.width,
        height: cs.height
      }
    };
  })()`);
  await pause(350);
  await shoot('search-bar-typing.png');
  console.log(JSON.stringify({ state, errors }, null, 2));
  clearTimeout(deadline);
  const ok = state.hasKbd === false && state.clearHidden === false && state.resultsVisible === true && state.resultCount > 0;
  console.log(ok ? 'RESULT PASS' : 'RESULT FAIL');
  app.exit(ok ? 0 : 1);
}).catch(err => { console.error('ERROR', err && err.stack || err); app.exit(1); });
