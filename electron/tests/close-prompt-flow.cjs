'use strict';
/* Flow check for the styled close prompt: cancel keeps the window open,
 * remember+minimize hides the window to the tray, and a remembered choice skips the prompt.
 * Usage: node tests/run-ui.cjs close-prompt-flow.cjs
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-flow-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const pause = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, cond) => { results.push([name, !!cond]); console.log((cond ? 'PASS ' : 'FAIL ') + name); };
const deadline = setTimeout(() => { console.error('FLOW_TIMEOUT'); finish(1); }, 90000);
let finished = false;
function finish(code) { if (finished) return; finished = true; clearTimeout(deadline); app.exit(code); }
require(path.join(ROOT, 'main.js'));

app.whenReady().then(async () => {
  let win;
  for (let i = 0; i < 100; i++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(50); }
  if (!win) throw new Error('no window');
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async expr => { for (let i = 0; i < 150; i++) { try { if (await js(expr)) return; } catch (_) {} await pause(80); } throw new Error('timeout: ' + expr); };
  const waitPrompt = async want => { for (let i = 0; i < 100; i++) { const has = await js("!!document.querySelector('.close-prompt')"); if (has === want) return true; await pause(50); } return false; };

  await wait('!!window.DNSDesktop?.ready');
  win.show();
  win.setContentSize(1180, 900);
  await pause(400);

  // 1) 关闭 -> 弹窗出现 -> 取消：窗口仍在
  win.close();
  check('close shows styled prompt', await waitPrompt(true));
  await js(`document.querySelector(".close-prompt [data-choice='cancel']").click()`);
  await pause(300);
  check('cancel removes prompt', (await js("!!document.querySelector('.close-prompt')")) === false);
  check('cancel keeps window open', !win.isDestroyed() && !win.isMinimized() && win.isVisible());

  // 2) 关闭 -> 勾选记住 + 最小化：窗口隐藏到系统托盘（不进任务栏）
  win.close();
  check('prompt reopens', await waitPrompt(true));
  await js(`(() => { const c = document.querySelector('.close-prompt [data-role="remember"]'); if (c) c.checked = true; })()`);
  await js(`document.querySelector(".close-prompt [data-choice='minimize']").click()`);
  await pause(500);
  check('minimize hides window to tray (not taskbar)', !win.isVisible() && !win.isMinimized());

  // 3) 记住后再次关闭：直接隐藏到托盘，不再弹窗
  win.show();
  await pause(300);
  win.close();
  await pause(500);
  check('remembered minimize skips prompt', (await js("!!document.querySelector('.close-prompt')")) === false);
  check('remembered minimize hides window', !win.isVisible());

  // 4) 已记住“关闭=最小化到托盘”时，点最小化仍应进入任务栏，而不是托盘
  win.show();
  await pause(300);
  win.minimize();
  await pause(400);
  check('minimize button goes to taskbar (not tray)', win.isMinimized());
  win.restore();
  await pause(300);
  check('restore brings window back', win.isVisible() && !win.isMinimized());

  win.destroy();
  const ok = results.every(r => r[1]);
  console.log(ok ? 'FLOW_OK' : 'FLOW_FAIL');
  finish(ok ? 0 : 1);
}).catch(err => { console.error(err.stack || err); finish(1); });
