'use strict';
// 预览：设置-关于 卡 + 更新弹窗（用真实 UpdateUI 的 handle 模拟主进程事件）
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-upd-'));
const OUT = path.join(ROOT, '.shots/design');
fs.mkdirSync(OUT, { recursive: true });
app.setPath('userData', profile);
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const pause = ms => new Promise(r => setTimeout(r, ms));
const deadline = setTimeout(() => { console.error('UPD_PREVIEW_TIMEOUT'); app.exit(1); }, 100000);
require(path.join(ROOT, 'main.js'));
app.whenReady().then(async () => {
  let win;
  for (let i = 0; i < 100; i++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(50); }
  if (!win) throw new Error('no main window');
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async expr => { for (let i = 0; i < 150; i++) { try { if (await js(expr)) return; } catch (_) {} await pause(80); } throw new Error('timeout ' + expr); };
  await wait('!!window.DNSDesktop?.ready');
  win.show(); win.setContentSize(1180, 900); await pause(300);
  await js("location.hash='#/settings'");
  await pause(900);
  await js("(() => { const v = document.querySelector('[data-role=app-version]'); if (v) v.scrollIntoView({ block: 'center' }); })()");
  await pause(400);
  fs.writeFileSync(path.join(OUT, 'update-about-card.png'), (await win.webContents.capturePage()).toPNG());
  // 直接调用 UpdateUI 内部 handle：通过订阅不到已注册监听，改为派发真实 IPC 不可行；
  // 这里用暴露的 startDownload/ check 不便注入。改为模拟主进程 send：调用 desktop 的 webContents.send。
  win.webContents.send('sd:update', { type: 'available', version: '2.0.2', current: '2.0.1',
    notes: '1. 新增应用内检查更新\n2. 修复若干打印对齐问题\n3. 优化扫码确认弹窗体验' });
  await pause(500);
  const hasBox = await js("!!document.querySelector('.upd-box')");
  fs.writeFileSync(path.join(OUT, 'update-modal.png'), (await win.webContents.capturePage()).toPNG());
  // 进度态
  win.webContents.send('sd:update', { type: 'progress', percent: 63.4 });
  await pause(400);
  fs.writeFileSync(path.join(OUT, 'update-progress.png'), (await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({ hasBox, supported: await js('window.UpdateUI && window.UpdateUI.supported') }));
  clearTimeout(deadline);
  app.exit(hasBox ? 0 : 1);
}).catch(err => { console.error('ERROR', err && err.stack || err); app.exit(1); });

