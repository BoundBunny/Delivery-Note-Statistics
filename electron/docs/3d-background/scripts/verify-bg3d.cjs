'use strict';
/* ============================================================
 * verify-bg3d.cjs — P4「3D 背景原生化」验收脚本
 * ------------------------------------------------------------
 * 用法（仓库根 electron 目录）：
 *   .\node_modules\.bin\electron.cmd docs\3d-background\scripts\verify-bg3d.cjs
 *
 * 检查项：
 *   1. 宿主页不再有 iframe，场景直接挂在主页面
 *   2. 场景真的在渲染（帧计数递增 / 有 draw call）
 *   3. FPS 探针读到帧率，右下角徽标显示
 *   4. 真实单据/客户数据进了场景
 *   5. 像素级比对：关掉 3D 层后界面发生变化 → 3D 确实透在玻璃卡片下
 *   6. 窄窗（<900）自动卸载，宽窗自动重挂
 *   7. 设置开关关闭后彻底释放
 *   8. 预览页（p0-blockout.html）回归：场景仍能渲染、HUD 正常
 * ============================================================ */
const { app, BrowserWindow, ipcMain, protocol, nativeImage } = require('electron');
app.disableHardwareAcceleration();
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const WEB_ROOT = path.join(ROOT, '..', 'android', 'app', 'src', 'main', 'assets', 'app');
const INDEX_HTML = path.join(WEB_ROOT, 'index.html');
const PREVIEW_HTML = path.join(WEB_ROOT, '3d', 'p0-blockout.html');
const SHOTS = path.join(ROOT, '.shots');
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif']);
const imgDir = path.join(ROOT, 'CommercesData');

const tmpUserData = path.join(os.tmpdir(), 'sd-verify-bg3d-' + Date.now());
app.setPath('userData', tmpUserData);
// 无头环境里 Chromium 会把页面标记为 hidden（rAF 暂停），这里强制保持可见
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');

function imageMime(p) {
  const m = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif' };
  return m[path.extname(p).toLowerCase()] || 'application/octet-stream';
}
protocol.registerSchemesAsPrivileged([{ scheme: 'sdimg', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
ipcMain.handle('sd:getDefaultImageDir', async () => imgDir);
ipcMain.handle('sd:chooseImageDir', async () => '');
ipcMain.handle('sd:openImageDir', async () => ({ ok: true }));
ipcMain.handle('sd:pickProductImage', async () => ({ ok: false, canceled: true }));

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const log = (...a) => console.log(a.join(' '));
function check(name, ok, detail) {
  if (!ok) failed++;
  log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : ''));
}

function bitmap(buf) {
  const img = nativeImage.createFromBuffer(buf);
  return { w: img.getSize().width, h: img.getSize().height, bmp: img.toBitmap() };
}
function diffRatio(a, b, x0, y0, x1, y1) {
  const X1 = Math.min(a.w, b.w, x1), Y1 = Math.min(a.h, b.h, y1);
  let diff = 0, n = 0;
  for (let y = Math.max(0, y0); y < Y1; y += 2) for (let x = Math.max(0, x0); x < X1; x += 2) {
    const i = (y * a.w + x) * 4;
    if (Math.abs(a.bmp[i + 2] - b.bmp[i + 2]) + Math.abs(a.bmp[i + 1] - b.bmp[i + 1]) + Math.abs(a.bmp[i] - b.bmp[i]) > 12) diff++;
    n++;
  }
  return n ? +(diff / n).toFixed(3) : -1;
}

app.whenReady().then(async () => {
  protocol.handle('sdimg', async request => {
    try {
      const u = new URL(request.url);
      const fp = path.normalize(u.searchParams.get('p') || '');
      if (!fp || !path.isAbsolute(fp) || !IMAGE_EXTS.has(path.extname(fp).toLowerCase())) return new Response('', { status: 403 });
      const data = await fs.promises.readFile(fp);
      return new Response(data, { headers: { 'content-type': imageMime(fp) } });
    } catch (_) { return new Response('', { status: 404 }); }
  });
  try { fs.mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

  const win = new BrowserWindow({ width: 1440, height: 900, show: true, webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: false, nodeIntegration: false, sandbox: false } });
  await win.loadFile(INDEX_HTML);
  const js = c => win.webContents.executeJavaScript(c, true);
  const cap = async () => { win.show(); win.focus(); await sleep(900); return (await win.webContents.capturePage()).toPNG(); };

  try {
    await sleep(3200);

    // 0) 默认开启：3D 背景板就是老板的工作底板
    check('默认加载 3D 背景板', (await js(`!!document.getElementById('bg3d-layer')`)) === true);
    check('工作面进入浮层模式', (await js(`document.body.classList.contains('bg3d-on')`)) === true);

    // 1) 无 iframe + 画布挂载
    check('无 iframe 残留', await js(`!document.querySelector('#bg3d-layer iframe')`));
    const canvasInfo = await js(`(function(){var c=document.getElementById('bg3d-canvas'); if(!c) return 'none'; return getComputedStyle(c).display+' '+c.width+'x'+c.height;})()`);
    check('场景画布已挂载', canvasInfo !== 'none' && canvasInfo.indexOf('block') === 0, canvasInfo);

    // 2) 真的在渲染
    const f1 = await js(`window.DNS_SCENE ? window.DNS_SCENE.renderer.info.render.frame : -1`);
    await sleep(1200);
    const f2 = await js(`window.DNS_SCENE ? window.DNS_SCENE.renderer.info.render.frame : -1`);
    check('主循环持续渲染', f2 > f1, 'frames ' + f1 + ' → ' + f2);
    const tri = await js(`window.DNS_SCENE ? window.DNS_SCENE.renderer.info.render.triangles : 0`);
    check('场景有几何体', tri > 1000, 'triangles=' + tri);

    // 3) FPS 探针（不再有常驻徽标，避免压住内容；帧率在设置页显示）
    const fps = await js(`window.DNSBackground.stats().fps`);
    check('FPS 探针有读数', fps > 0, 'fps=' + fps);
    const badge = await js(`!!document.getElementById('bg3d-badge')`);
    check('页面无常驻徽标', badge === false);

    // 4) 真实数据
    const data = await js(`(function(){
      var d=new Date(), ds=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      Store.upsertCustomer({name:'兴旺超市', phone:'13800000000', address:'人民路 8 号'});
      Store.addOrder({no:'SD-TEST-001', date:ds, customer:{name:'兴旺超市'}, items:[{name:'怡宝饮用纯净水', spec:'555ml', unit:'瓶', qty:12, price:2}], total:24});
      window.DNSBackground.refresh();
      var s=window.DNS_SCENE.state;
      return JSON.stringify({orders:s.orders, customers:s.customers, amount:s.amount, top:s.top.length, source:s.source});
    })()`);
    const d = JSON.parse(data);
    check('真实单据进入场景', d.orders === 1 && d.customers === 1 && d.amount === 24, data);
    check('数据源标记为工作台', d.source === '工作台 Store', d.source);

    // 5) 像素级：关掉 3D 层后界面变化 → 3D 透在玻璃卡片下
    const A = await cap();
    fs.writeFileSync(path.join(SHOTS, 'verify-bg3d-native.png'), A);
    await js(`document.getElementById('bg3d-layer').style.display='none'`);
    await sleep(400);
    const B = await cap();
    fs.writeFileSync(path.join(SHOTS, 'verify-bg3d-no3d.png'), B);
    await js(`document.getElementById('bg3d-layer').style.display=''`);
    const diff = diffRatio(bitmap(A), bitmap(B), 380, 60, 1200, 820);
    check('3D 透过工作面可见', diff > 0.02, '内容区像素差异 ' + (diff * 100).toFixed(1) + '%');

    // 5.5) 功能模块在背景板上照常可用（点击落到按钮上、背景不拦截）
    const clickable = await js(`(function(){
      var btn = document.querySelector('.tab-item[data-tab="orders"]');
      if(!btn) return 'NO_TAB';
      var r = btn.getBoundingClientRect();
      var top = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
      return top ? (btn.contains(top) ? 'HIT_TAB' : 'BLOCKED_BY:' + (top.id||'') + '.' + (top.className||'')) : 'NULL';
    })()`);
    check('导航按钮可点（不被背景遮挡）', clickable === 'HIT_TAB', clickable);
    const bgPointer = await js(`(function(){var l=document.getElementById('bg3d-layer'); return l? getComputedStyle(l).pointerEvents : 'NO_LAYER';})()`);
    check('背景板不拦截点击', bgPointer === 'none', bgPointer);

    // 6) 窄窗卸载 / 宽窗重挂
    await js(`window.__resizeLog=[]; window.addEventListener('resize',function(){ window.__resizeLog.push(window.innerWidth); });`);
    win.setSize(860, 700);
    await sleep(1800);
    log('DBG_NARROW innerWidth=' + await js(`window.innerWidth`) + ' events=' + await js(`JSON.stringify(window.__resizeLog)`) + ' stats=' + await js(`JSON.stringify(window.DNSBackground.stats())`));
    check('窄窗自动卸载', (await js(`!document.getElementById('bg3d-layer')`)) === true);
    win.setSize(1440, 900);
    await sleep(2800);
    check('宽窗自动重挂', (await js(`(window.DNSBackground.stats().state === 'ready') && !!document.getElementById('bg3d-canvas')`)) === true);

    // 7) 开关关闭
    await js(`window.DNSBackground.setEnabled(false)`);
    await sleep(600);
    check('关闭后彻底释放', (await js(`!document.getElementById('bg3d-layer')`)) === true);

    // 7.5) 设置页 3D 行显示实时状态 + 强度行
    await js(`window.DNSBackground.setEnabled(true)`);
    await sleep(2500);
    await js(`location.hash='#/settings'`);
    await sleep(2200);
    const rowText = await js(`(function(){var r=document.querySelector('[data-act="toggle-bg3d"] .settings-row-value'); return r? r.textContent : 'NO_ROW';})()`);
    check('设置页显示实时帧率', /FPS/.test(rowText), rowText);
    const modeRow = await js(`(function(){var r=document.querySelector('[data-act="toggle-bg3d-mode"] .settings-row-value'); return r? r.textContent : 'NO_ROW';})()`);
    check('开启后出现强度行', /柔化|全开/.test(modeRow), modeRow);
    await js(`location.hash='#/'`);
    await sleep(600);

    // 8) 预览页回归
    const pv = new BrowserWindow({ width: 1280, height: 800, show: true });
    await pv.loadFile(PREVIEW_HTML);
    await sleep(2600);
    const pjs = c => pv.webContents.executeJavaScript(c, true);
    const pf1 = await pjs(`window.DNS_SCENE ? window.DNS_SCENE.renderer.info.render.frame : -1`);
    await sleep(1000);
    const pf2 = await pjs(`window.DNS_SCENE ? window.DNS_SCENE.renderer.info.render.frame : -1`);
    check('预览页场景仍可渲染', pf2 > pf1, 'frames ' + pf1 + ' → ' + pf2);
    const hud = await pjs(`(function(){var e=document.getElementById('ui-orders'); return e? e.textContent : 'none';})()`);
    check('预览页 HUD 正常', hud !== 'none' && hud !== '', 'ui-orders=' + hud);
    await pv.show(); pv.focus(); await sleep(700);
    const pcap = await pv.webContents.capturePage();
    fs.writeFileSync(path.join(SHOTS, 'verify-bg3d-preview.png'), pcap.toPNG());

    log(failed ? 'RESULT FAIL(' + failed + ')' : 'RESULT ALL_PASS');
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
    app.exit(failed ? 1 : 0);
  } catch (e) {
    log('ERR ' + (e && e.stack || e));
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
    app.exit(1);
  }
});
