'use strict';
/* ============================================================
 * diag-layout.cjs — 界面体检：元素重叠 + 文字透底风险 + 3D 影响
 * ------------------------------------------------------------
 * 用法（electron 目录）：
 *   .\node_modules\.bin\electron.cmd docs\3d-background\scripts\diag-layout.cjs
 *
 * 输出三部分：
 *   1) OVERLAP  —— 同层元素矩形大面积相交（疑似视觉重叠）
 *   2) BLEED    —— 文字所在卡片背景半透明（底下的 3D/背景会透上来）
 *   3) CONTRAST —— 文字与其实际背景的对比度估算（WCAG 相对亮度比）
 * ============================================================ */
const { app, BrowserWindow, ipcMain, protocol } = require('electron');
app.disableHardwareAcceleration();
const path = require('path');
const fs = require('fs');
const os = require('os');
const tmpUserData = path.join(os.tmpdir(), 'sd-diag-' + Date.now());
app.setPath('userData', tmpUserData);
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const WEB_ROOT = path.join(ROOT, '..', 'android', 'app', 'src', 'main', 'assets', 'app');
const INDEX_HTML = path.join(WEB_ROOT, 'index.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(a.join(' '));

ipcMain.handle('sd:getDefaultImageDir', async () => path.join(ROOT, 'CommercesData'));
ipcMain.handle('sd:chooseImageDir', async () => '');
ipcMain.handle('sd:openImageDir', async () => ({ ok: true }));
ipcMain.handle('sd:pickProductImage', async () => ({ ok: false, canceled: true }));

const PROBE = `(function(){
  function vis(el){
    var st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.05) return false;
    if (st.pointerEvents === 'none') return false;
    var r = el.getBoundingClientRect();
    return r.width > 6 && r.height > 6;
  }
  function label(el){
    var t = (el.textContent || '').trim().replace(/\\s+/g,' ').slice(0, 18);
    return el.tagName.toLowerCase() + (el.id ? '#'+el.id : '') + (el.className && typeof el.className === 'string' ? '.'+el.className.trim().split(/\\s+/).slice(0,2).join('.') : '') + (t ? ' «'+t+'»' : '');
  }
  function area(r){ return Math.max(0, r.width) * Math.max(0, r.height); }
  function inter(a,b){
    var w = Math.min(a.right,b.right) - Math.max(a.left,b.left);
    var h = Math.min(a.bottom,b.bottom) - Math.max(a.top,b.top);
    return w>0 && h>0 ? w*h : 0;
  }
  function parseRGBA(str){
    var m = String(str||'').match(/rgba?\\(([^)]+)\\)/); if(!m) return null;
    var p = m[1].split(',').map(function(x){ return parseFloat(x); });
    return { r:p[0], g:p[1], b:p[2], a: p.length>3 ? p[3] : 1 };
  }
  function over(fg, bg){
    var a = fg.a;
    return { r: fg.r*a + bg.r*(1-a), g: fg.g*a + bg.g*(1-a), b: fg.b*a + bg.b*(1-a), a: 1 };
  }
  function lum(c){
    function ch(v){ v = v/255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }
    return 0.2126*ch(c.r) + 0.7152*ch(c.g) + 0.0722*ch(c.b);
  }
  function ratio(f,b){ var L1 = lum(f), L2 = lum(b); var hi = Math.max(L1,L2), lo = Math.min(L1,L2); return (hi+0.05)/(lo+0.05); }

  var out = { overlap: [], bleed: [], contrast: [] };
  var view = document.querySelector('.view.active') || document.body;
  var nodes = Array.prototype.slice.call(view.querySelectorAll('*')).filter(vis);

  // 1) 同层元素重叠（排除祖先-后代关系）
  for (var i=0;i<nodes.length;i++){
    for (var j=i+1;j<nodes.length;j++){
      var a = nodes[i], b = nodes[j];
      if (a.contains(b) || b.contains(a)) continue;
      var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      var ov = inter(ra, rb);
      if (!ov) continue;
      var small = Math.min(area(ra), area(rb));
      if (ov > 600 && ov / small > 0.45) {
        out.overlap.push({ a: label(a), b: label(b), pct: Math.round(ov/small*100) });
      }
    }
  }

  // 2) 文字透底 + 对比度（往上叠背景色，直到不透明）
  var texts = nodes.filter(function(el){
    if (!el.firstChild) return false;
    var hasText = Array.prototype.some.call(el.childNodes, function(n){ return n.nodeType === 3 && n.textContent.trim(); });
    return hasText;
  }).slice(0, 400);
  texts.forEach(function(el){
    var st = getComputedStyle(el);
    var fg = parseRGBA(st.color) || {r:0,g:0,b:0,a:1};
    if (fg.a === 0) return;
    var bg = {r:247,g:247,b:250,a:1};
    var alpha = 0;
    var node = el;
    while (node && node !== document.documentElement){
      var s2 = getComputedStyle(node);
      var c = parseRGBA(s2.backgroundColor);
      if (c && c.a > 0){ bg = over(c, bg); alpha += (1-alpha) * c.a; if (alpha > 0.99) break; }
      node = node.parentElement;
    }
    var bgImage = false, n2 = el;
    while (n2 && n2 !== document.documentElement){
      var s3 = getComputedStyle(n2);
      if (s3.backgroundImage && s3.backgroundImage !== 'none'){ bgImage = true; break; }
      n2 = n2.parentElement;
    }
    var rect = el.getBoundingClientRect();
    var entry = { el: label(el), fg: st.color, alpha: Math.round(alpha*100)/100, ratio: Math.round(ratio(fg,bg)*100)/100, bgImage: bgImage, rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)] };
    if (alpha < 0.92) out.bleed.push(entry);
    if (entry.ratio < 4.5) out.contrast.push(entry);
  });
  return JSON.stringify(out);
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: true, webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: false, nodeIntegration: false, sandbox: false } });
  await win.loadFile(INDEX_HTML);
  const js = c => win.webContents.executeJavaScript(c, true);
  const routes = ['#/', '#/orders', '#/products', '#/customers', '#/stats', '#/settings'];
  try {
    await sleep(3000);
    for (const r of routes) {
      await js(`location.hash='${r}'`);
      await sleep(1200);
      const raw = await js(PROBE);
      const o = JSON.parse(raw);
      log('\n=== ROUTE ' + r + ' ===');
      log('OVERLAP ' + o.overlap.length);
      o.overlap.slice(0, 8).forEach(x => log('   ' + x.pct + '%  ' + x.a + '  ×  ' + x.b));
      log('BLEED(半透明底) ' + o.bleed.length);
      o.bleed.slice(0, 8).forEach(x => log('   alpha=' + x.alpha + '  ' + x.el));
      log('LOW_CONTRAST(<4.5) ' + o.contrast.length);
      o.contrast.slice(0, 8).forEach(x => log('   ratio=' + x.ratio + '  ' + x.el));
    }
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
    app.exit(0);
  } catch (e) { log('ERR ' + (e && e.stack || e)); app.exit(1); }
});
