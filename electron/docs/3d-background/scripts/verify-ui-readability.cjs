'use strict';
/* ============================================================
 * verify-ui-readability.cjs — 3D 背景对界面可读性的影响量化
 * ------------------------------------------------------------
 * 用法（electron 目录）：
 *   .\node_modules\.bin\electron.cmd docs\3d-background\scripts\verify-ui-readability.cjs
 *
 * 指标：
 *   1) WORST CONTRAST —— 设置页所有叶子文字元素里，「文字笔画 vs 紧邻底色」的
 *      对比度最差值 / 10 分位（数字越接近基线越好，WCAG AA 参考线 4.5）。
 *   2) 3D 露出率 —— 相对「3D 关闭」基线，内容区发生像素变化的面积占比。
 * 三种状态：关闭（基线） / 柔化（默认档） / 全开。
 * ============================================================ */
const { app, BrowserWindow, ipcMain, protocol, nativeImage } = require('electron');
app.disableHardwareAcceleration();
const path = require('path');
const fs = require('fs');
const os = require('os');
const tmpUserData = path.join(os.tmpdir(), 'sd-verify-ui-' + Date.now());
app.setPath('userData', tmpUserData);
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const WEB_ROOT = path.join(ROOT, '..', 'android', 'app', 'src', 'main', 'assets', 'app');
const INDEX_HTML = path.join(WEB_ROOT, 'index.html');
const SHOTS = path.join(ROOT, '.shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(a.join(' '));

ipcMain.handle('sd:getDefaultImageDir', async () => path.join(ROOT, 'CommercesData'));
ipcMain.handle('sd:chooseImageDir', async () => '');
ipcMain.handle('sd:openImageDir', async () => ({ ok: true }));
ipcMain.handle('sd:pickProductImage', async () => ({ ok: false, canceled: true }));

function lum(r, g, b) {
  function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
function toBitmap(buf) {
  const img = nativeImage.createFromBuffer(buf);
  return { w: img.getSize().width, h: img.getSize().height, bmp: img.toBitmap() };
}
function contrastOf(bm, rect) {
  const vals = [];
  const x0 = Math.max(0, Math.round(rect[0])), y0 = Math.max(0, Math.round(rect[1]));
  const x1 = Math.min(bm.w, Math.round(rect[0] + rect[2])), y1 = Math.min(bm.h, Math.round(rect[1] + rect[3]));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * bm.w + x) * 4;
    vals.push(lum(bm.bmp[i + 2], bm.bmp[i + 1], bm.bmp[i]));
  }
  if (vals.length < 12) return null;
  vals.sort((a, b) => a - b);
  const p01 = vals[Math.max(0, Math.floor(vals.length * 0.01))];
  const bright = vals.slice(Math.floor(vals.length * 0.6));
  const bg = bright[Math.floor(bright.length * 0.5)];
  return (bg + 0.05) / (p01 + 0.05);
}
function diffRatio(a, b, region) {
  const x1 = Math.min(a.w, b.w, region[2]), y1 = Math.min(a.h, b.h, region[3]);
  let diff = 0, n = 0;
  for (let y = region[1]; y < y1; y += 2) for (let x = region[0]; x < x1; x += 2) {
    const i = (y * a.w + x) * 4;
    if (Math.abs(a.bmp[i + 2] - b.bmp[i + 2]) + Math.abs(a.bmp[i + 1] - b.bmp[i + 1]) + Math.abs(a.bmp[i] - b.bmp[i]) > 12) diff++;
    n++;
  }
  return n ? +(diff / n).toFixed(3) : -1;
}

function noiseIndex(bm, region) {
  // 干净界面里背景像素几乎都在 0.85 以上；3D 的深色块会把像素拉进 0.15~0.6 的中暗区间
  const x1 = Math.min(bm.w, region[2]), y1 = Math.min(bm.h, region[3]);
  let mid = 0, n = 0, sum = 0;
  for (let y = region[1]; y < y1; y += 2) for (let x = region[0]; x < x1; x += 2) {
    const i = (y * bm.w + x) * 4;
    const l = lum(bm.bmp[i + 2], bm.bmp[i + 1], bm.bmp[i]);
    if (l >= 0.12 && l <= 0.62) mid++;
    sum += l; n++;
  }
  return { midPct: n ? +(mid / n * 100).toFixed(2) : -1, avgLum: n ? +(sum / n).toFixed(3) : -1 };
}

const COLLECT = `(function(){
  var root = document.getElementById('app') || document.body;
  var out = [];
  root.querySelectorAll('.settings-row-title,.settings-row-note,.settings-section-title,.settings-group-title,.hint,.sr-t,.sr-s').forEach(function(el){
    var st = getComputedStyle(el);
    if(st.display==='none'||st.visibility==='hidden'||Number(st.opacity)<0.3) return;
    var txt = (el.innerText||'').trim();
    if(txt.length < 3) return;
    var r = el.getBoundingClientRect();
    if(r.width < 26 || r.height < 9 || r.height > 120) return;
    if(r.top < 60 || r.bottom > window.innerHeight - 10) return;
    // 块级标题会横跨整行，只取左侧文字实际所在的一段
    var w = Math.min(r.width, 220);
    out.push([r.left, r.top, w, r.height, txt.replace(/\\s+/g,' ').slice(0, 14)]);
  });
  return out;
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 900, show: true, webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: false, nodeIntegration: false, sandbox: false } });
  await win.loadFile(INDEX_HTML);
  const js = c => win.webContents.executeJavaScript(c, true);
  const cap = async name => { win.show(); win.focus(); await sleep(900); const buf = (await win.webContents.capturePage()).toPNG(); fs.writeFileSync(path.join(SHOTS, name), buf); return buf; };

  function score(bm, rects) {
    const rows = [];
    rects.forEach(r => { const c = contrastOf(bm, r); if(c) rows.push({ txt: r[4], ratio: +c.toFixed(2) }); });
    if (!rows.length) return null;
    const rs = rows.map(r => r.ratio).sort((a, b) => a - b);
    const worst = rows.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 3);
    return { n: rows.length, min: +rs[0].toFixed(2), p10: +rs[Math.floor(rs.length * 0.1)].toFixed(2), median: +rs[Math.floor(rs.length / 2)].toFixed(2), worst };
  }

  try {
    await sleep(2600);
    log('DEFAULT_STATE ' + await js(`JSON.stringify(window.DNSBackground.stats())`));
    log('DEFAULT_LAYER ' + await js(`!!document.getElementById('bg3d-layer')`));

    const routes = ['#/settings', '#/products', '#/'];
    let allOk = true;
    for (const route of routes) {
      await js(`location.hash='${route}'`);
      await sleep(1500);
      const rects = await js(COLLECT);
      const region = [260, 110, 1240, 880];
      const tag = route === '#/' ? 'home' : route.replace('#/', '').replace('/', '-');
      log('\n=== ROUTE ' + route + '  文字样本 ' + rects.length + ' ===');

      const offBm = toBitmap(await cap('verify-ui-' + tag + '-off.png'));
      const off = score(offBm, rects);
      await js(`window.DNSBackground.setEnabled(true); window.DNSBackground.setMode('soft');`);
      await sleep(3400);
      const softBm = toBitmap(await cap('verify-ui-' + tag + '-soft.png'));
      const soft = score(softBm, rects);
      await js(`window.DNSBackground.setMode('full');`);
      await sleep(2800);
      const fullBm = toBitmap(await cap('verify-ui-' + tag + '-full.png'));
      const full = score(fullBm, rects);

      log('OFF  ' + JSON.stringify(off) + '  背景噪声=' + JSON.stringify(noiseIndex(offBm, region)));
      log('SOFT ' + JSON.stringify(soft) + '  露出率=' + diffRatio(offBm, softBm, region) + ' 背景噪声=' + JSON.stringify(noiseIndex(softBm, region)));
      log('FULL ' + JSON.stringify(full) + '  露出率=' + diffRatio(offBm, fullBm, region) + ' 背景噪声=' + JSON.stringify(noiseIndex(fullBm, region)));
      // 判定：WCAG AA（正文 4.5:1）为硬线；柔化档基本等于关闭基线
      // 「全开」是明确标注可能干扰界面的档位，只作参考，不参与判定
      const AA = 4.5;
      const ok = !off || !soft
        ? true
        : (soft.min >= AA && soft.p10 >= AA && soft.p10 >= off.p10 * 0.95 && soft.min >= off.min * 0.95);
      if (!ok) allOk = false;
      await js(`window.DNSBackground.setEnabled(false)`);
      await sleep(400);
    }
    log(allOk ? 'READABILITY_OK' : 'READABILITY_FAIL');
    try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
    app.exit(allOk ? 0 : 1);
  } catch (e) { log('ERR ' + (e && e.stack || e)); try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {} app.exit(1); }
});
