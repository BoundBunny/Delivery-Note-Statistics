/* ============================================================
 * util.js — 通用工具：金额、大写、日期、DOM辅助、弹层
 * ============================================================ */
'use strict';

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* 拼音字典随应用打包，客户排序不需要联网。 */
const customerNameCache = new Map();
const customerNameCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
function isSuspiciousCustomerName(name) {
  return /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(String(name || ''));
}
function customerNameInfo(name) {
  const raw = String(name || '');
  if (customerNameCache.has(raw)) return customerNameCache.get(raw);
  const normalized = raw.normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().replace(/^[^A-Za-z0-9\u3400-\u9FFF]+/u, '');
  const key = isSuspiciousCustomerName(raw) ? normalized.toLowerCase()
    : window.pinyinPro.pinyin(normalized, { toneType: 'none', nonZh: 'consecutive' }).replace(/\s+/g, '').toLowerCase();
  const letter = !isSuspiciousCustomerName(raw) && /^[a-z]/.test(key) ? key[0].toUpperCase() : '#';
  const info = { letter, key };
  customerNameCache.set(raw, info);
  return info;
}
function compareCustomerNames(a, b) {
  const x = customerNameInfo(a.name), y = customerNameInfo(b.name);
  const rank = letter => letter === '#' ? 26 : letter.charCodeAt(0) - 65;
  return rank(x.letter) - rank(y.letter) || customerNameCollator.compare(x.key, y.key)
    || String(a.name).localeCompare(String(b.name), 'zh-CN') || String(a.id).localeCompare(String(b.id));
}
function fmtMoney(n) {
  n = Number(n) || 0;
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(n) {
  n = Number(n) || 0;
  return (Math.round(n * 100) / 100).toLocaleString('zh-CN');
}

/* 界面长数字：金额始终完整显示，数量可缩写，不改动存储或计算。 */
let numberFitFrame = null;
function scheduleNumberFit() {
  if (numberFitFrame !== null) return;
  numberFitFrame = requestAnimationFrame(() => {
    numberFitFrame = null;
    $$('.number-value').forEach(el => {
      el.style.fontSize = '';
      const width = el.clientWidth;
      if (width > 0 && el.scrollWidth > width) {
        const size = parseFloat(getComputedStyle(el).fontSize);
        el.style.fontSize = Math.max(10, Math.floor(size * width / el.scrollWidth * 10) / 10 - .5) + 'px';
      }
    });
  });
}
function numberHtml(n, { money = false, prefix = '', suffix = '', label = '数值', maxLength = 12 } = {}) {
  n = Number(n) || 0;
  const finite = Number.isFinite(n);
  const formatted = money ? fmtMoney(n)
    : Math.abs(n) > Number.MAX_VALUE / 100 ? n.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : fmtNum(n);
  const full = finite ? prefix + formatted + suffix : '数值超过了可计算范围，请检查单据中的数量和单价。';
  scheduleNumberFit();
  if (finite && (money || full.length <= maxLength)) return `<span class="number-value">${esc(full)}</span>`;
  let short = '超出范围';
  if (finite) {
    const abs = Math.abs(n);
    const unit = abs >= 1e12 && abs < 1e16 ? [1e12, '万亿']
      : abs >= 1e8 && abs < 1e12 ? [1e8, '亿']
      : abs >= 1e4 && abs < 1e8 ? [1e4, '万'] : null;
    short = unit ? fmtNum(n / unit[0]) + unit[1] : formatted;
    if (!unit || (prefix + short + suffix).length + 1 > maxLength) {
      short = n.toExponential(1).replace('e+', 'e');
    }
    short = '≈' + prefix + short + suffix;
  }
  return `<button type="button" class="number-value number-detail-trigger" data-number-full="${esc(full)}" data-number-label="${esc(label)}" title="${esc(label + '：' + full)}" aria-label="${esc(label + '，点击查看完整数值')}">${esc(short)}</button>`;
}
window.addEventListener('resize', scheduleNumberFit);
document.addEventListener('click', e => {
  const trigger = e.target.closest('[data-number-full]');
  if (!trigger) return;
  e.preventDefault();
  e.stopPropagation();
  openSheet(`<div class="number-detail-value">${esc(trigger.dataset.numberFull)}</div>`, trigger.dataset.numberLabel || '完整数值');
}, true);

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/* 日期工具：本地时区 */
function dateStr(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function todayStr() { return dateStr(new Date()); }
function dateOf(s) {
  const p = String(s).split('-').map(Number);
  return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
}
function addDays(s, n) {
  const d = dateOf(s); d.setDate(d.getDate() + n); return dateStr(d);
}
function weekRange(today) {
  const t = today || new Date();
  const day = (t.getDay() + 6) % 7; // 周一为一周开始
  const mon = addDays(dateStr(t), -day);
  return [mon, addDays(mon, 6)];
}
function monthRange(s) {
  const p = String(s || todayStr()).split('-').map(Number);
  const first = p[0] + '-' + pad2(p[1]) + '-01';
  const last = new Date(p[0], p[1], 0);
  return [first, p[0] + '-' + pad2(p[1]) + '-' + pad2(last.getDate())];
}
function shortDate(s) { // 2026-10-09 -> 10-09
  return String(s || '').slice(5);
}
function fmtDateTime(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
         pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/* 人民币大写金额 */
const CN_NUM = ['零','壹','贰','叁','肆','伍','陆','柒','捌','玖'];
const CN_U = ['','拾','佰','仟'];
const CN_G = ['','万','亿'];
function numToUpperInt(nStr) {
  // nStr: 去掉小数的整数部分字符串
  if (nStr === '0') return '零';
  const groups = [];
  while (nStr.length > 4) { groups.unshift(nStr.slice(-4)); nStr = nStr.slice(0, -4); }
  groups.unshift(nStr);
  let out = '';
  let emptyGroup = false;
  const gLen = groups.length;
  groups.forEach((g, gi) => {
    const pow = gLen - 1 - gi;
    let gs = '';
    let zero = false;
    for (let i = 0; i < g.length; i++) {
      const d = +g[i];
      const pos = g.length - 1 - i;
      if (d === 0) { zero = true; }
      else {
        if (zero && gs) gs += '零';
        gs += CN_NUM[d] + CN_U[pos];
        zero = false;
      }
    }
    if (gs) {
      if (out && (emptyGroup || Number(g) < 1000)) out += '零';
      out += gs + CN_G[pow];
      emptyGroup = false;
    } else if (out) emptyGroup = true;
  });
  return out.replace(/零+$/, '');
}
function amountUpper(amount) {
  let cents = Math.round((Number(amount) || 0) * 100);
  if (!Number.isFinite(cents) || Math.abs(cents) >= 1e14) return '金额超出大写转换范围';
  if (cents === 0) return '零元整';
  const neg = cents < 0; cents = Math.abs(cents);
  const yuan = Math.floor(cents / 100);
  const jiao = Math.floor(cents % 100 / 10);
  const fen = cents % 10;
  let s = numToUpperInt(String(yuan)) + '元';
  if (jiao === 0 && fen === 0) s += '整';
  else {
    if (jiao > 0) s += CN_NUM[jiao] + '角';
    else if (fen > 0 && yuan > 0) s += '零';
    if (fen > 0) s += CN_NUM[fen] + '分';
  }
  return (neg ? '负' : '') + s;
}

/* ID 生成 */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------- 轻提示 ---------- */
let toastTimer = null;
function toast(msg, isErr) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = isErr ? 'show err' : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2200);
}

/* ---------- 确认框 ---------- */
function confirmDialog({ title, text, okText = '确定', danger = false }) {
  return new Promise(resolve => {
    const root = $('#modal-root');
    const mask = document.createElement('div');
    mask.className = 'mask show';
    mask.innerHTML = `
      <div class="confirm-box">
        <div class="cb-t">${esc(title)}</div>
        ${text ? `<div class="cb-s">${esc(text)}</div>` : ''}
        <div class="cb-row">
          <button class="btn btn-ghost" data-act="no">取消</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="yes">${esc(okText)}</button>
        </div>
      </div>`;
    root.appendChild(mask);
    const close = val => { mask.remove(); resolve(val); };
    mask.addEventListener('click', e => {
      if (e.target === mask) close(false);
      const act = e.target.closest('[data-act]');
      if (act) close(act.dataset.act === 'yes');
    });
  });
}

/* ---------- 底部弹层 ---------- */
function openSheet(html, title) {
  const root = $('#modal-root');
  const mask = document.createElement('div');
  mask.className = 'mask show';
  mask.innerHTML = `
    <div class="sheet">
      <div class="sheet-grab"></div>
      <div class="sheet-hd">
        <span>${esc(title || '')}</span>
        <button class="icbtn" data-act="close">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="sheet-bd"></div>
    </div>`;
  root.appendChild(mask);
  const bd = $('.sheet-bd', mask);
  bd.innerHTML = html;
  mask.addEventListener('click', e => {
    if (e.target === mask) mask.remove();
    if (e.target.closest('[data-act="close"]')) mask.remove();
  });
  return { mask, bd };
}

/* 文件下载/保存（浏览器环境回退） */
function xlsxBlob(bytes) {
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function downloadBlob(filename, blob) {
  if (window.Android && window.Android.saveFile) {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(',')[1];
      window.Android.saveFile(filename, blob.type || 'application/octet-stream', base64);
    };
    reader.readAsDataURL(blob);
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

/* 选择文件并读取为文本（Android桥 或 input[type=file]） */
function assertImportText(text) {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/.test(text)) {
    throw new Error('文件包含乱码或二进制内容，请使用原始 CSV 文本文件，勿直接导入 Excel 文件。');
  }
  return text.replace(/^\uFEFF/, '');
}
function decodeImportText(buffer) {
  const bytes = new Uint8Array(buffer);
  if ((bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf)
      || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    throw new Error('请选择 CSV 或 JSON 文本文件；Excel 文件请先另存为 CSV。');
  }
  let text;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
  else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (err) {
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error('UTF-8 文件已损坏，请重新导出原始 CSV。');
      text = new TextDecoder('gb18030', { fatal: true }).decode(bytes);
    }
  }
  return assertImportText(text);
}
function pickFileAsText(accept) {
  return new Promise(resolve => {
    if (window.Android && window.Android.pickFile) {
      const cb = 'f' + uid();
      window.__fileCallbacks = window.__fileCallbacks || {};
      window.__fileCallbacks[cb] = (err, text) => {
        delete window.__fileCallbacks[cb];
        if (err) { if (err !== 'canceled') toast(err === 'read_error' ? '读取文件失败' : String(err), true); resolve(null); return; }
        resolve(text);
      };
      window.Android.pickFile(cb, accept || '*/*');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept || '.json,.csv,text/*';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(decodeImportText(reader.result)); }
        catch (err) { toast(err.message || '文件格式或编码不正确', true); resolve(null); }
      };
      reader.onerror = () => { toast('读取文件失败', true); resolve(null); };
      reader.readAsArrayBuffer(f);
    };
    input.click();
  });
}

/* 分享文件（Android桥，浏览器回退为下载） */
function shareFile(filename, blob) {
  if (window.Android && window.Android.shareFile) {
    const reader = new FileReader();
    reader.onload = () => {
      window.Android.shareFile(filename, blob.type || 'application/octet-stream', String(reader.result).split(',')[1]);
    };
    reader.readAsDataURL(blob);
    return;
  }
  downloadBlob(filename, blob);
}

/* ---------- 商品图片（本地存储，无网络请求） ---------- */
// 把本地图片路径 / 已有地址转换为 <img src> 可用的地址
function productImageUrl(src) {
  if (!src) return '';
  const s = String(src);
  if (/^(data:|blob:|https?:|file:|sdimg:)/i.test(s)) return s;
  // 随应用打包的内置商品图片：bundle:assets/products/xxx.jpg
  if (/^bundle:/i.test(s)) {
    if (window.Android && window.Android.imageUrl) {
      try { return window.Android.imageUrl(s); } catch (_) { /* 落回相对路径 */ }
    }
    return s.slice(7);
  }
  if (window.Android && window.Android.imageUrl) {
    try { return window.Android.imageUrl(s); } catch (_) { return s; }
  }
  return s;
}

// 选择一张商品图片：
// - 桌面端（Electron）：复制到本地图片目录并返回文件绝对路径；
// - 浏览器回退：读取为 data URL，仍然只存在本机，不发起网络请求。
function pickProductImage(destDir) {
  return new Promise(resolve => {
    if (window.Android && window.Android.pickProductImage) {
      window.Android.pickProductImage(destDir || '')
        .then(res => {
          if (res && res.ok) resolve(res.path);
          else if (res && res.canceled) resolve(null);
          else { toast('选择图片失败：' + ((res && res.error) || '未知错误'), true); resolve(null); }
        })
        .catch(err => { toast('选择图片失败：' + (err && err.message || err), true); resolve(null); });
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => { toast('读取图片失败', true); resolve(null); };
      reader.readAsDataURL(f);
    };
    input.click();
  });
}
