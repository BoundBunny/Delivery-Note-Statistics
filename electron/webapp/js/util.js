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
  return formatDecimal(n);
}
// Quantities and unit prices retain the stored Number's decimal digits.
// Only final monetary amounts use fmtMoney's two-decimal rounding.
function formatDecimal(n, minimumFractionDigits = 0) {
  n = Number(n) || 0;
  if (!Number.isFinite(n)) return n.toLocaleString('zh-CN');
  const [coefficient, exponentText] = Math.abs(n).toString().split('e');
  let [whole, fraction = ''] = coefficient.split('.');
  if (exponentText) {
    const digits = whole + fraction, point = whole.length + Number(exponentText);
    if (point <= 0) { whole = '0'; fraction = '0'.repeat(-point) + digits; }
    else if (point >= digits.length) { whole = digits + '0'.repeat(point - digits.length); fraction = ''; }
    else { whole = digits.slice(0, point); fraction = digits.slice(point); }
  }
  fraction = fraction.padEnd(minimumFractionDigits, '0');
  return (n < 0 ? '-' : '') + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? '.' + fraction : '');
}
function fmtPrice(n) { return formatDecimal(n, 2); }
function sumQuantities(values) {
  return Number(sumQuantityText(values));
}
function sumQuantityText(values) {
  const numbers = values.map(value => Number(value) || 0);
  if (numbers.some(value => !Number.isFinite(value))) return String(numbers.reduce((sum, value) => sum + value, 0));
  const parts = numbers.map(value => formatDecimal(value).replace(/,/g, '').split('.'));
  const scale = parts.reduce((max, value) => Math.max(max, (value[1] || '').length), 0);
  const sum = parts.reduce((total, value) => total + BigInt(value[0] + (value[1] || '')) * 10n ** BigInt(scale - (value[1] || '').length), 0n);
  const digits = (sum < 0n ? -sum : sum).toString().padStart(scale + 1, '0');
  const fraction = scale ? digits.slice(-scale).replace(/0+$/, '') : '';
  return (sum < 0n ? '-' : '') + (scale ? digits.slice(0, -scale) : digits) + (fraction ? '.' + fraction : '');
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

/* ---------- 关闭确认（退出 / 最小化到系统托盘） ---------- */
function showClosePrompt() {
  const root = $('#modal-root');
  if (!root || root.querySelector('.close-prompt')) return;
  const mask = document.createElement('div');
  mask.className = 'mask center show close-prompt-mask';
  mask.innerHTML = `
    <div class="close-prompt" role="dialog" aria-modal="true" aria-labelledby="cp-title">
      <div class="cp-head">
        <div class="cp-badge" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></svg></div>
        <div class="cp-headtext">
          <div class="cp-eyebrow">关闭送货宝</div>
          <h2 id="cp-title" class="cp-title">要退出，还是最小化？</h2>
        </div>
      </div>
      <p class="cp-desc">数据已自动保存。选择最小化，程序会留在系统托盘继续运行，点托盘图标即可回来。</p>
      <div class="cp-options">
        <button type="button" class="cp-opt" data-choice="minimize">
          <span class="cp-opt-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M9 15h6"/></svg></span>
          <span class="cp-opt-main"><span class="cp-opt-title">最小化到系统托盘 <span class="cp-tag">推荐</span></span><span class="cp-opt-sub">程序继续在后台运行</span></span>
          <span class="cp-opt-arrow" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
        </button>
        <button type="button" class="cp-opt is-quit" data-choice="quit">
          <span class="cp-opt-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v10"/><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/></svg></span>
          <span class="cp-opt-main"><span class="cp-opt-title">完全退出</span><span class="cp-opt-sub">关闭程序，下次再打开</span></span>
          <span class="cp-opt-arrow" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
        </button>
      </div>
      <label class="cp-remember"><input type="checkbox" data-role="remember"><span>记住我的选择，以后不再询问</span></label>
      <div class="cp-foot"><button type="button" class="btn btn-ghost" data-choice="cancel">取消</button></div>
    </div>`;
  root.appendChild(mask);
  const remember = mask.querySelector('[data-role="remember"]');
  const respond = payload => {
    mask.remove();
    if (typeof window.__dnsRespondClosePrompt === 'function') window.__dnsRespondClosePrompt(payload);
  };
  mask.addEventListener('click', e => {
    const btn = e.target.closest('[data-choice]');
    if (btn) {
      const choice = btn.dataset.choice;
      if (choice === 'cancel') respond({ action: 'cancel' });
      else respond({ action: choice, remember: !!(remember && remember.checked) });
      return;
    }
    if (e.target === mask) respond({ action: 'cancel' });
  });
  mask.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); respond({ action: 'cancel' }); }
  });
  const first = mask.querySelector('.cp-opt');
  if (first) first.focus();
}
window.addEventListener('dns-close-prompt', () => { try { showClosePrompt(); } catch (_) { /* ignore */ } });

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
    if (e.target === mask) { if(mask.__isDirty?.()){toast('请先保存或关闭当前填写内容',true);return;}mask.remove(); }
    if (e.target.closest('[data-act="close"]')) mask.remove();
  });
  return { mask, bd };
}

/* 文件下载/保存（浏览器环境回退） */
function xlsxBlob(bytes) {
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function ensureExportable() {
  try { Store.assertExportable(); return true; }
  catch (error) { toast(error.message, true); return false; }
}

// A migration file must not depend on an old computer's image directory.
// Built-in images remain bundled; custom images become self-contained data URLs.
async function exportBackupJSON() {
  const backup = JSON.parse(Store.exportJSON());
  const imageCache = new Map();
  const embed = async record => {
    const src = record.image;
    if (!src || /^(bundle:|data:)/i.test(src)) return;
    if (!imageCache.has(src)) imageCache.set(src, (async () => {
      let response;
      try { response = await fetch(productImageUrl(src)); }
      catch (_) { throw new Error('无法读取商品图片，备份未导出：' + src); }
      if (!response.ok) throw new Error('无法读取商品图片，备份未导出：' + src);
      const blob = await response.blob();
      if (!blob.size || !/^image\//i.test(blob.type)) throw new Error('商品图片无效，备份未导出：' + src);
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('商品图片读取失败，备份未导出：' + src));
        reader.readAsDataURL(blob);
      });
    })());
    record.image = await imageCache.get(src);
  };
  for (const product of backup.data.products) await embed(product);
  for (const entry of backup.catalog.entries) await embed(entry.changes);
  return JSON.stringify(backup, null, 2);
}

function transferBlob(method, filename, blob) {
  if (window.Android && window.Android[method]) {
    return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = String(reader.result).split(',')[1];
      try { resolve(await window.Android[method](filename, blob.type || 'application/octet-stream', base64) || {ok:false}); }
      catch (error) { toast('文件保存失败：' + (error.message || error), true);resolve({ok:false,error:String(error)}); }
    };
    reader.onerror = () => { toast('文件读取失败，请重试',true);resolve({ok:false,error:'read_error'}); };
    reader.readAsDataURL(blob);
    });
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  return Promise.resolve({ok:true});
}
function downloadBlob(filename, blob) { return transferBlob('saveFile', filename, blob); }
function readOptionalMoney(input, label) {
  const text = input.value.trim();
  if (!text && !input.validity.badInput) return undefined;
  const value = Number(text);
  if (input.validity.badInput || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100))) throw new Error(label + '须为有效的非负金额');
  return value;
}
function validDateRange(from, to) {
  for(const value of [from,to])if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||dateStr(dateOf(value))!==value)){toast('请填写有效日期',true);return false;}
  if(from&&to&&from>to){toast('开始日期不能晚于结束日期',true);return false;}
  return true;
}

/* 选择文件并读取为文本（Android桥 或 input[type=file]） */
function assertImportText(text) {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/.test(text)) {
    throw new Error('文件包含乱码或二进制内容，请检查文本编码；Excel 资料请使用商品或客户导入入口。');
  }
  return text.replace(/^\uFEFF/, '');
}
function decodeImportText(buffer) {
  const bytes = new Uint8Array(buffer);
  if ((bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf)
      || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    throw new Error('当前入口只读取文本。Excel 资料请使用设置中的“导入商品”或“导入客户”。');
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
async function pickDataTable(kind) {
  let buffer;
  if (window.Android?.pickDataFile) {
    const result = await window.Android.pickDataFile();
    if (result.canceled) return null;
    if (!result.ok) throw new Error(result.error || '资料文件读取失败');
    const binary = atob(result.base64);
    buffer = Uint8Array.from(binary, character => character.charCodeAt(0)).buffer;
  } else {
    buffer = await new Promise((resolve, reject) => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = '.xlsx,.xls,.csv,.txt,.tsv';
      input.oncancel = () => resolve(null);
      input.onchange = async () => {
        const file = input.files?.[0]; if (!file) { resolve(null); return; }
        if (!file.size || file.size > 32 * 1024 * 1024) { reject(new Error('请选择非空且不超过 32 MB 的资料文件')); return; }
        try { resolve(await file.arrayBuffer()); } catch (_) { reject(new Error('资料文件读取失败')); }
      };
      input.click();
    });
    if (buffer == null) return null;
  }
  return new Promise((resolve, reject) => {
    let worker, timer;
    const finish = (error, result) => { clearTimeout(timer); worker?.terminate(); if (error) reject(error); else resolve(result); };
    try {
      worker = new Worker(new URL('js/import-worker.js', document.baseURI));
      worker.onmessage = event => event.data.ok ? finish(null, event.data) : finish(new Error(event.data.error || '资料解析失败'));
      worker.onerror = event => { event.preventDefault(); finish(new Error('资料解析失败，请检查文件格式或重新导出原文件')); };
      timer = setTimeout(() => finish(new Error('资料解析超时，请拆分文件后重试')), 30000);
      worker.postMessage({ buffer, kind }, [buffer]);
    } catch (error) { finish(error); }
  });
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
  return transferBlob(window.Android && window.Android.shareFile ? 'shareFile' : 'saveFile', filename, blob);
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
