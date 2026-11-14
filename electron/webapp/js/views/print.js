/* ============================================================
 * views/print.js — 送货单打印预览
 * 支持：打印 / 存PDF（系统打印）、保存图片（纯Canvas绘制，兼容安卓WebView）、分享
 * ============================================================ */
'use strict';
window.Views = window.Views || {};

/* 送货单：公司电话/地址不打印；客户电话按需显示（客户地址不显示）。 */

/* 单据时间（精确到秒）：取订单创建时间，附在送货日期后面 */
function fmtOrderTime(o) {
  const ts = o && o.createdAt;
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

/* 保存图片：直接用 Canvas 绘制送货单（不依赖 SVG foreignObject，安卓 WebView 更稳） */
// 公司名称水印：画布版（斜向平铺、品牌深蓝 + 金，极淡，绘制在白底之上、正文之下）
function paintWatermarkCanvas(ctx, text, W, H, font) {
  const WM_FONT = '700 34px ' + font;
  ctx.save();
  ctx.font = WM_FONT;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
  const textW = ctx.measureText(text).width;
  const stepX = Math.max(220, Math.min(900, Math.ceil(textW) + 100));
  const stepY = 170;
  let row = 0;
  for (let gy = -110; gy < H + 130; gy += stepY) {
    const offset = (row % 2) ? stepX / 2 : 0;
    for (let gx = -stepX / 2 + offset; gx < W + stepX; gx += stepX) {
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(-Math.PI / 7);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = '#2b4a6f';
      ctx.font = WM_FONT;
      ctx.fillText(text, 0, 0);
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = '#b08a3e';
      ctx.font = '500 10px ' + font;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
      ctx.fillText('送 货 单', 0, 28);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
      ctx.restore();
    }
    row++;
  }
  ctx.restore();
}
// 公司名称水印：平铺宽度按文字长度自适应，避免长公司名被裁切
function watermarkTileWidth(text) {
  const c = document.createElement('canvas').getContext('2d');
  c.font = '700 34px "Microsoft YaHei","SimHei",sans-serif';
  if ('letterSpacing' in c) c.letterSpacing = '2px';
  const w = c.measureText(String(text)).width;
  return Math.max(220, Math.min(900, Math.ceil(w) + 100));
}
// 公司名称水印：HTML/打印版（把 SVG 文字做成可平铺的 data URI 背景）
function watermarkSpriteUrl(text, tileW, nameOpacity) {
  const esc2 = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const w = Math.max(220, tileW || watermarkTileWidth(text));
  const h = 170;
  const cx = w / 2, cy = h / 2;
  const op = nameOpacity == null ? 0.45 : nameOpacity;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">'
    + '<g transform="rotate(-25.7 ' + cx + ' ' + cy + ')" font-family="Microsoft YaHei,SimHei,sans-serif" text-anchor="middle">'
    + '<text x="' + cx + '" y="' + (cy - 6) + '" font-weight="700" font-size="34" letter-spacing="2" fill="#2b4a6f" fill-opacity="' + op + '">' + esc2 + '</text>'
    + '<text x="' + cx + '" y="' + (cy + 32) + '" font-weight="500" font-size="10" letter-spacing="5" fill="#b08a3e" fill-opacity=".4">送 货 单</text>'
    + '</g></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg).replace(/'/g, '%27');
}

function drawDocToCanvas(o, s) {
  Store.assertExportable();
  const padL = 30, padR = 30;
  const measure = document.createElement('canvas').getContext('2d');
  const font = '"SimSun","Microsoft YaHei",sans-serif';
  measure.font = '12px ' + font;
  const qtyTotal = fmtNum(sumQuantityText(o.items.map(it => it.qty)));
  const numericWidth = (key, format, min) => Math.max(min, ...o.items.map(it =>
    Math.ceil(measure.measureText(format(it[key])).width) + 14));
  // 列宽由完整数值决定；画布覆盖全部列，金额不压缩、不截断。
  const cols = [30, 196, 40, numericWidth('qty', fmtNum, 60), numericWidth('price', fmtPrice, 100), numericWidth('amount', fmtMoney, 112), 80];
  cols[3] = Math.max(cols[3], Math.ceil(measure.measureText(qtyTotal).width) + 14);
  measure.font = 'bold 22px ' + font;
  cols[5] = Math.max(cols[5], Math.ceil(measure.measureText('¥' + fmtMoney(o.total)).width) + 24 - cols[4] - cols[6]);
  const W = padL + cols.reduce((a, b) => a + b, 0) + padR;
  const innerW = W - padL - padR;
  const scale = 2;

  function fmt(v) { return v == null || v === '' ? '' : String(v); }
  function wrap(text, width, textFont) {
    measure.font = textFont;
    const lines = [];
    let line = '';
    for (const ch of String(text)) {
      if (ch === '\n') { lines.push(line); line = ''; continue; }
      if (measure.measureText(line + ch).width > width && line) { lines.push(line); line = ch; }
      else line += ch;
    }
    if (line) lines.push(line);
    return lines;
  }

  /* 先计算总高度 */
  const rows = o.items;
  const ROW_H = 24;
  const sideWidth = (innerW - 116) / 2;
  const companyLines = []; // 公司名称不再出现在单据左上角，仅保留水印
  const noLines = wrap('单号：' + o.no, sideWidth, '11px ' + font);
  const headerHeight = Math.max(28, companyLines.length * 28, noLines.length * 16);
  const companyDetails = [];
  const customerDetails = [];
  const phone = o.customer && o.customer.phone ? '客户电话：' + o.customer.phone : '';
  // 客户名称、客户电话、送货日期保持同一行；名称过长时在自身区域内换行，不把电话/日期挤到下一行。
  const metaName = o.customer && o.customer.name ? '客户名称：' + o.customer.name : '';
  const metaDate = '送货日期：' + o.date + fmtOrderTime(o);
  measure.font = '12px ' + font;
  const metaNameLines = wrap(metaName, Math.max(120, innerW * 0.44 - 10), '12px ' + font);
  const metaDateLines = wrap(metaDate, Math.max(120, innerW * 0.32 - 8), '12px ' + font);
  const metaH = Math.max(1, metaNameLines.length, metaDateLines.length) * 18;
  // 客户名称与客户电话之间固定约 4 个汉字的间距
  const metaNameW = metaNameLines.length ? Math.max(...metaNameLines.map(t => measure.measureText(t).width)) : 0;
  const metaGapW = measure.measureText('中中中中').width;
  const metaPhoneX = padL + Math.min(metaNameW, innerW * 0.44 - 10) + metaGapW;
  const headTop = 14 + headerHeight + (companyDetails.length ? 2 + companyDetails.length * 17 : 0)
    + 6 + metaH + 6;
  const upperLines = wrap('金额（大写）：' + amountUpper(o.total), innerW - 16, '13px ' + font);
  const upperHeight = Math.max(26, upperLines.length * 18 + 8);
  const H = headTop + 24 + rows.length * ROW_H + 32 + upperHeight + 36;

  const canvas = document.createElement('canvas');
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  if (s.company && s.watermark !== false) paintWatermarkCanvas(ctx, s.company, W, H, font);
  ctx.fillStyle = '#222';
  ctx.textBaseline = 'middle';

  let y = 14;

  // 标题与单号同排；公司名称只在水印中体现。
  ctx.textAlign = 'left';
  ctx.font = 'bold 22px ' + font;
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px ' + font;
  ctx.fillText('送 货 单', W / 2, y + headerHeight / 2);
  ctx.textAlign = 'right';
  ctx.font = '11px ' + font;
  noLines.forEach((text, i) => ctx.fillText(text, W - padR, y + (headerHeight - noLines.length * 16) / 2 + i * 16 + 8));
  y += headerHeight;
  ctx.textAlign = 'left';
  ctx.font = '12px ' + font;
  if (companyDetails.length) {
    y += 2;
    companyDetails.forEach(text => { ctx.fillText(text, padL, y + 8.5); y += 17; });
  }
  y += 6;
  // 客户名称、客户电话、送货日期同一行；客户名称过长时在左侧区域内换行。
  ctx.textAlign = 'left';
  ctx.font = '12px ' + font;
  metaNameLines.forEach((text, ri) => ctx.fillText(text, padL, y + ri * 18 + 9, innerW * 0.44 - 10));
  if (phone) ctx.fillText(phone, metaPhoneX, y + 9, innerW * 0.24);
  ctx.textAlign = 'right';
  metaDateLines.forEach((text, ri) => ctx.fillText(text, padL + innerW, y + ri * 18 + 9));
  y += metaH;
  ctx.textAlign = 'left';
  y += 6;

  // 表头
  const colX = [];
  let cx = padL;
  cols.forEach((cw, i) => { colX.push(cx); cx += cw; });
  const tableRight = padL + cols.reduce((a, b) => a + b, 0);

  ctx.fillStyle = '#F1F2F5';
  ctx.fillRect(padL, y, tableRight - padL, 24);
  ctx.strokeStyle = '#999';
  ctx.lineWidth = 1;
  ctx.strokeRect(padL, y, tableRight - padL, 24);
  ctx.fillStyle = '#222';
  ctx.font = 'bold 12px "SimSun","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center';
  const heads = ['序号', '产品名称', '单位', '数量', '单价', '金额', '备注'];
  heads.forEach((h, i) => ctx.fillText(h, colX[i] + cols[i] / 2, y + 12));
  y += 24;

  // 只绘制实际商品，不补空白行。
  ctx.font = '12px "SimSun","Microsoft YaHei",sans-serif';
  for (let i = 0; i < rows.length; i++) {
    const it = rows[i];
    ctx.strokeRect(padL, y, tableRight - padL, ROW_H);
    if (it) {
      ctx.fillStyle = '#222';
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), colX[0] + cols[0] / 2, y + ROW_H / 2);
      ctx.textAlign = 'left';
      ctx.fillText([fmt(it.name), fmt(it.spec)].filter(Boolean).join(' '), colX[1] + 4, y + ROW_H / 2, cols[1] - 8);
      ctx.textAlign = 'center';
      ctx.fillText(fmt(it.unit), colX[2] + cols[2] / 2, y + ROW_H / 2, cols[2] - 8);
      ctx.fillText(fmtNum(it.qty), colX[3] + cols[3] / 2, y + ROW_H / 2);
      ctx.fillText(fmtPrice(it.price), colX[4] + cols[4] / 2, y + ROW_H / 2);
      ctx.fillText(fmtMoney(it.amount), colX[5] + cols[5] / 2, y + ROW_H / 2);
      ctx.textAlign = 'left';
      ctx.fillText(fmt(it.remark), colX[6] + 4, y + ROW_H / 2, cols[6] - 8);
    }
    y += ROW_H;
  }
  // 列分隔线
  ctx.strokeStyle = '#999';
  for (let i = 1; i < cols.length; i++) {
    ctx.beginPath();
    ctx.moveTo(colX[i], headTop);
    ctx.lineTo(colX[i], y);
    ctx.stroke();
  }

  // 参考票据式合计：数量与金额一行，大写金额紧接下一行。
  ctx.strokeRect(padL, y, innerW, 32);
  for (const x of [colX[3], colX[4]]) {
    ctx.beginPath();ctx.moveTo(x, y);ctx.lineTo(x, y + 32);ctx.stroke();
  }
  ctx.fillStyle = '#222';
  ctx.textAlign = 'center';
  ctx.font = 'bold 13px ' + font;
  ctx.fillText('合　计', (padL + colX[3]) / 2, y + 16);
  ctx.font = '12px ' + font;
  ctx.fillText(qtyTotal, colX[3] + cols[3] / 2, y + 16);
  ctx.textAlign = 'right';
  ctx.font = 'bold 22px ' + font;
  ctx.fillText('¥' + fmtMoney(o.total), tableRight - 8, y + 16);
  y += 32;
  ctx.strokeRect(padL, y, innerW, upperHeight);
  ctx.textAlign = 'left';
  ctx.font = '13px ' + font;
  upperLines.forEach((text, i) => ctx.fillText(text, padL + 8, y + 13 + i * 18));
  y += upperHeight;

  // 制单人与收货签章并列。
  ctx.font = '12px "SimSun","Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#222';
  ctx.textAlign = 'left';
  ctx.fillText('制单人：' + (o.operator || ''), padL, y + 18, innerW / 2 - 10);
  ctx.fillText('收货签章：', padL + innerW / 2, y + 18);

  // 联次说明已按用户要求删除（单张/普通打印不需要）
  return canvas;
}

/* dataURL -> Blob（不依赖 fetch，安卓 WebView 兼容） */
function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(',');
  const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
  const bin = atob(parts[1]);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

Views.print = {
  render(params) {
    const o = Store.getOrder(params.id);
    const el = document.createElement('div');
    el.className = 'view active';
    el.id = 'print-view';
    if (Store.recoveryState().blocked) {
      el.innerHTML = '<div class="empty"><div class="em-t">本地数据异常，打印与导出暂不可用</div><p>请先导出原始数据，再恢复有效备份。</p></div>';
      return el;
    }
    if (!o) {
      el.innerHTML = `<div class="empty"><div class="em-t">单据不存在</div><button class="btn btn-primary" data-act="back">返回</button></div>`;
      el.addEventListener('click', async e => { if (e.target.closest('[data-act="back"]')) location.hash = '#/orders'; });
      return el;
    }
    const s = Store.getSettings();
    const wmText = s.company && s.watermark !== false ? String(s.company) : '';
    const rows = o.items;
    const companyDetails = [];
    const customerDetails = [];
    const qtyTotal = fmtNum(sumQuantityText(rows.map(it => it.qty)));

    const docHtml = `
      <div class="doc-wrap">
        <div class="doc" data-role="doc">
          ${wmText ? '<div class="doc-watermark" aria-hidden="true"></div>' : ''}
          <div class="d-company">
            <div class="d-header">
              <div class="d-company-slot"></div>
              <div class="d-title">送货单</div>
              <div class="d-no">单号：${esc(o.no)}</div>
            </div>
            ${companyDetails.length ? `<div class="d-company-detail">${esc(companyDetails.join('　'))}</div>` : ''}
          </div>
          <div class="d-meta">
            ${o.customer && o.customer.name ? `<span class="d-customer-name">客户名称：<b>${esc(o.customer.name)}</b></span>` : ''}
            ${o.customer && o.customer.phone ? `<span class="d-customer-phone">客户电话：<b>${esc(o.customer.phone)}</b></span>` : ''}
            <span class="d-date">送货日期：<b>${esc(o.date + fmtOrderTime(o))}</b></span>
            ${customerDetails.some(Boolean) ? customerDetails.map(text => `<span>${esc(text)}</span>`).join('') : ''}
          </div>
          <table>
            <thead><tr>
              <th style="width:34px">序号</th><th>产品名称</th>
              <th style="width:42px">单位</th><th style="width:52px">数量</th>
              <th style="width:64px">单价</th><th style="width:74px">金额</th><th style="width:56px">备注</th>
            </tr></thead>
            <tbody>
              ${rows.map((it, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>${esc([it.name, it.spec].filter(Boolean).join(' '))}</td>
                  <td>${esc(it.unit || '')}</td>
                  <td class="doc-num">${fmtNum(it.qty)}</td>
                  <td class="doc-num">${fmtPrice(it.price)}</td>
                  <td class="doc-num">${fmtMoney(it.amount)}</td>
                  <td>${esc(it.remark || '')}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot class="d-total">
              <tr class="t-summary"><td colspan="3" class="t-label">合　计</td><td class="t-qty">${qtyTotal}</td><td colspan="3" class="t-amount"><b class="t-num">¥${fmtMoney(o.total)}</b></td></tr>
              <tr><td colspan="7" class="t-cap"><span>金额（大写）：</span><b>${esc(amountUpper(o.total))}</b></td></tr>
            </tfoot>
          </table>
          <div class="d-sign">
            <div>制单人：${esc(o.operator || '')}</div>
            <div>收货签章：</div>
          </div>
        </div>
      </div>`;

    el.innerHTML = `
      <div id="print-toolbar">
        <div class="topbar">
          <button class="icbtn" data-act="back"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
          <h1>打印预览</h1>
          <button class="icbtn" data-act="share"><svg viewBox="0 0 24 24"><path d="M12 3v13m0-13 4 4m-4-4-4 4M5 21h14"/></svg></button>
        </div>
        <div style="display:flex;gap:8px;padding:10px 16px;background:var(--paper);border-bottom:1px solid var(--line)">
          <button class="btn btn-primary btn-sm" data-act="save-img" style="flex:1"><svg viewBox="0 0 24 24"><path d="M4 17v3h16v-3M12 3v12m0 0 4-4m-4 4-4-4"/></svg>保存图片</button>
          <button class="btn btn-blue btn-sm" data-act="print" style="flex:1"><svg viewBox="0 0 24 24"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/></svg>打印 / 存PDF</button>
        </div>
      </div>
      <div class="hint document-scroll-hint">左右滑动查看完整单据</div>
      <div class="document-scroll print-document-scroll" role="region" aria-label="送货单打印预览，可左右滑动" tabindex="0">
        <div class="doc-page">${docHtml}</div>
      </div>
      <div class="hint" style="text-align:center;margin:10px 0 16px">A4 竖版送货单 · 打印时选择「另存为 PDF」即可保存电子档</div>`;

    const wmEl = el.querySelector('.doc-watermark');
    if (wmEl && wmText) {
      const wmTile = watermarkTileWidth(wmText);
      wmEl.style.backgroundImage = 'url("' + watermarkSpriteUrl(wmText, wmTile) + '")';
      wmEl.style.backgroundSize = wmTile + 'px 170px';
    }

    el.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const a = act.dataset.act;
      if (a === 'back') { history.length > 1 ? history.back() : (location.hash = '#/order/view?id=' + o.id); return; }
      if (!ensureExportable()) return;
      if (a === 'print') {
        if (window.Android && window.Android.printPdf) { window.Android.printPdf('送货单_' + o.no); }
        else window.print();
        return;
      }
      if (a === 'save-img' || a === 'share') {
        try {
          const canvas = drawDocToCanvas(o, s);
          const dataUrl = canvas.toDataURL('image/png');
          const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          let nonWhite = 0;
          for (let i = 0; i < px.length; i += 40) {
            if (px[i] < 245 || px[i + 1] < 245 || px[i + 2] < 245) { nonWhite++; if (nonWhite > 30) break; }
          }
          if (nonWhite <= 30) throw new Error('blank');
          const blob = dataUrlToBlob(dataUrl);
          const name = '送货单_' + o.no + '.png';
          if (a === 'share') { if ((await shareFile(name, blob)).ok) toast('已分享'); }
          else { if ((await downloadBlob(name, blob)).ok) toast('图片已保存'); }
        } catch (err) {
          toast('图片生成失败，请用「打印/存PDF」导出', true);
        }
      }
    });
    return el;
  }
};
