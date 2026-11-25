'use strict';
// 预览：更新弹窗「更新说明」不再显示 HTML 标签（先用带标签的原文走主进程 releaseNotesText，
// 再模拟旧版服务端直接下发带标签的 notes，校验前端 sanitizeNotes 兜底）。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-updn-'));
const OUT = path.join(ROOT, '.shots/design');
fs.mkdirSync(OUT, { recursive: true });
app.setPath('userData', profile);
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const pause = ms => new Promise(r => setTimeout(r, ms));
const deadline = setTimeout(() => { console.error('UPD_NOTES_TIMEOUT'); app.exit(1); }, 100000);
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
  // 场景 1：主进程已把 HTML 转成纯文本（模拟 electron-updater 的 releaseNotes 是 HTML）
  win.webContents.send('sd:update', { type: 'available', version: '2.0.4', current: '2.0.3',
    notes: '送货宝 v2.0.4\n· 修复：更新说明不再显示 HTML 标签\n· 更新说明现在按纯文本逐行展示' });
  await pause(500);
  const text1 = await js("(document.querySelector('.upd-notes')||{}).textContent||''");
  fs.writeFileSync(path.join(OUT, 'update-notes-plain.png'), (await win.webContents.capturePage()).toPNG());
  // 场景 2：旧版服务端直接甩 HTML，前端 sanitizeNotes 兜底
  win.webContents.send('sd:update', { type: 'available', version: '2.0.5', current: '2.0.4',
    notes: '<h2>送货宝 v2.0.5</h2>\n<ul>\n<li>修复：送货单打印表格去掉多余的「备注」列</li>\n<li>桌面外壳左下角版本号同步为 V 2.0.5</li>\n</ul>' });
  await pause(500);
  const text2 = await js("(document.querySelector('.upd-notes')||{}).textContent||''");
  fs.writeFileSync(path.join(OUT, 'update-notes-html-fallback.png'), (await win.webContents.capturePage()).toPNG());
  const hasTag1 = /<[a-zA-Z/]/.test(text1);
  const hasTag2 = /<[a-zA-Z/]/.test(text2);
  console.log(JSON.stringify({ text1, text2, hasTag1, hasTag2 }));
  clearTimeout(deadline);
  app.exit(!hasTag1 && !hasTag2 ? 0 : 1);
}).catch(err => { console.error('ERROR', err && err.stack || err); app.exit(1); });
