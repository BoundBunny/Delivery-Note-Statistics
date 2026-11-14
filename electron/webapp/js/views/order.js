/* ============================================================
 * views/order.js — 开单 / 编辑 / 详情
 * ============================================================ */
'use strict';
window.Views = window.Views || {};

/* 跨路由暂存：复制新增时携带原单 */
window.__orderDraft = null;

// Plan before mutating the draft: a rejected merge must leave both rows intact.
// Selected product IDs are authoritative. Manual entries resolve only when the
// exact name/specification/unit has no catalog ambiguity; no products are saved here.
function planOrderItemAddition(items, payload, lookupProducts = () => []) {
  const text = value => String(value == null ? '' : value).trim();
  const price = Number(payload.price), quantity = Number(payload.qty);
  if (!text(payload.name) || !text(payload.qty) || !Number.isFinite(quantity) || quantity <= 0
      || !Number.isFinite(price) || price < 0 || !Number.isSafeInteger(amountCents(quantity, price))) {
    throw new Error('请填写有效的货品、数量和单价');
  }
  const incoming = { ...payload, amount: lineAmount(quantity, price) };
  let manual;
  const resolveManual = () => {
    if (!manual) {
      const candidates = lookupProducts(incoming).filter(product => text(product.name) === text(incoming.name)
        && text(product.spec) === text(incoming.spec) && text(product.unit) === text(incoming.unit));
      manual = { ambiguous: candidates.length > 1, pid: candidates.length === 1 ? candidates[0].id : null };
    }
    return manual;
  };
  if (!incoming.pid) {
    const identity = resolveManual();
    if (identity.pid) incoming.pid = identity.pid;
  }
  const indices = [];
  items.forEach((item, index) => {
    if (item.pid && incoming.pid && item.pid !== incoming.pid) return;
    if (['spec', 'unit', 'remark'].some(key => text(item[key]) !== text(incoming[key])) || Number(item.price) !== price) return;
    if (!Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0) return;
    if (!(item.pid && incoming.pid)) {
      if (text(item.name) !== text(incoming.name)) return;
      const identity = resolveManual();
      if (identity.ambiguous || ((item.pid || incoming.pid) && identity.pid !== (item.pid || incoming.pid))) return;
    }
    indices.push(index);
  });
  if (!indices.length) return { item: incoming, indices, index: items.length };
  const qty = sumQuantityText([...indices.map(index => items[index].qty), incoming.qty]), numericQty = Number(qty);
  const cents = amountCents(numericQty, price);
  if (!Number.isFinite(numericQty) || numericQty <= 0 || formatDecimal(numericQty).replace(/,/g, '') !== qty || !Number.isSafeInteger(cents)) {
    throw new Error('合并后的数量或金额超出可计算范围，请调整数量');
  }
  const first = items[indices[0]];
  return { item: { ...first, pid: first.pid || incoming.pid || null, qty, amount: cents / 100 }, indices, index: indices[0] };
}

Views.order = {
  render(params) {
    if (params && params.id && location.hash.indexOf('/edit') >= 0) return this.renderEdit(params.id);
    if (params && params.id) return this.renderView(params.id);
    return this.renderNew();
  },

  /* ---------------- 新建 / 编辑 ---------------- */
  renderNew() {
    const s = Store.getSettings();
    const draft = window.__orderDraft || {
      id: null, no: Store.peekOrderNo(todayStr()), date: todayStr(),
      operator: s.operator || '',
      customer: null,
      items: [],
    };
    window.__orderDraft = null;
    // 复制新增时重生成单号
    if (draft._copy) {
      draft.id = null;
      delete draft.createdAt;
      delete draft.updatedAt;
      draft.no = Store.peekOrderNo(draft.date);
      delete draft._copy;
    }

    const el = document.createElement('div');
    el.className = 'view active';
    el.innerHTML = `
      <div class="topbar">
        <button class="icbtn" data-act="back"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
        <h1>${draft.id ? '编辑送货单' : '开送货单'}</h1>
      </div>
      <div class="pad">
        <div class="section-title">单据信息</div>
        <div class="order-meta om-card">
          <div class="om-grid">
            <div class="field"><label class="lab">送货日期</label><input type="date" data-f="date" value="${esc(draft.date)}"></div>
            <div class="field"><label class="lab">单号</label><div class="om-static" data-role="order-no" title="单号随送货日期自动生成，保存时确定">${esc(draft.no)}</div></div>
            <div class="field"><label class="lab">制单人</label><input data-f="operator" value="${esc(draft.operator)}" placeholder="选填"></div>
          </div>
          <div class="field om-cust-field">
            <div class="cust-field-head">
              <label class="lab">客户</label>
            </div>
            <div class="cust-pick" data-act="pick-cust" role="button" tabindex="0" aria-label="选择客户">
              <span class="cp-ic"><svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0"/></svg></span>
              <div class="cp-main">
                <div class="cp-name" data-role="cname">${draft.customer ? esc(draft.customer.name) : '选择客户（可选）'}</div>
                <div class="cp-sub" data-role="csub">${draft.customer ? esc([draft.customer.phone, draft.customer.address].filter(Boolean).join(' · ')) : ''}</div>
              </div>
              <button type="button" class="cust-clear${draft.customer ? '' : ' hidden'}" data-act="clear-cust" aria-label="取消选择客户" title="取消选择客户"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6"/><path d="M18.5 6l-1 13.2A1.8 1.8 0 0 1 15.7 21H8.3a1.8 1.8 0 0 1-1.8-1.8L5.5 6"/><path d="M10 10.5v6M14 10.5v6"/></svg></button>
              <span class="cp-arrow"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
            </div>
          </div>
        </div>

        <div class="section-title">货品明细</div>
        <div class="order-items-grid" data-role="items"></div>

        <div class="order-sum">
          <span>共 <b data-role="qtySum">0</b> 件</span>
          <span>合计：</span><span class="sum-money" data-role="total">¥0.00</span>
        </div>
        <div style="text-align:right;font-size:12px;color:var(--muted);padding:4px 2px 2px" data-role="upper"></div>

        <div class="btn-row" style="padding:14px 0 4px">
          <button class="btn btn-ghost" data-act="back">取消</button>
          <button class="btn btn-primary" data-act="save">保存单据</button>
        </div>
      </div>`;

    el.__draft = draft;
    let saving = false;
    const priceConfirmations = new WeakMap();
    let priceConfirmationSequence = 0;
    const dialogs = new Set();
    const trackDialog = mask => { for(const old of dialogs)if(!old.isConnected)dialogs.delete(old);dialogs.add(mask); };
    el.dispose = () => { for(const mask of dialogs)mask.remove();dialogs.clear(); };

    /* ----- 货品明细：卡片网格 + 「圆形 +」弹窗录入 ----- */
    const itemsBox = $('[data-role="items"]', el);
    const GRADS = [
      'linear-gradient(135deg,#EEF2FF,#C7D2FE)',
      'linear-gradient(135deg,#F5F3FF,#DDD6FE)',
      'linear-gradient(135deg,#ECFDF5,#A7F3D0)',
      'linear-gradient(135deg,#FFF7ED,#FED7AA)',
      'linear-gradient(135deg,#F0F9FF,#BAE6FD)',
      'linear-gradient(135deg,#FDF2F8,#FBCFE8)'
    ];
    const TRASH = '<path d="M3 6h18"/><path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6"/><path d="M18.5 6l-1 13.2A1.8 1.8 0 0 1 15.7 21H8.3a1.8 1.8 0 0 1-1.8-1.8L5.5 6"/><path d="M10 10.5v6M14 10.5v6"/>';
    const itemGrad = name => { let h = 0; String(name || '').split('').forEach(ch => { h = (h * 31 + ch.codePointAt(0)) >>> 0; }); return GRADS[h % GRADS.length]; };
    const itemMono = name => {
      const s = String(name || '').trim();
      if (!s) return '＋';
      const first = Array.from(s)[0];
      return /[\u4e00-\u9fff]/.test(first) ? first : s.replace(/\s+/g, '').slice(0, 2).toUpperCase();
    };
    const itemImage = it => {
      let p = null;
      if (it && it.pid) p = Store.getProduct(it.pid);
      if (!p && it && it.name) {
        p = Store.listProducts(it.name, { includeArchived: true }).find(x =>
          x.name === it.name && (x.spec || '') === (it.spec || ''));
      }
      return p && p.image ? p.image : '';
    };
    function cardHtml(it, i) {
      const display = [it.name, it.spec].filter(Boolean).join(' ');
      const q = parseFloat(it.qty) || 0, p = parseFloat(it.price) || 0;
      it.amount = lineAmount(q, p);
      const meta = (q ? fmtNum(q) + (it.unit ? ' ' + it.unit : '') : '数量 0') + ' × ¥' + fmtPrice(p);
      const img = itemImage(it);
      return `
        <div class="pm-card oi-card" data-idx="${i}" role="button" tabindex="0" aria-label="编辑货品 ${esc(it.name || '')}">
          <div class="pm-thumb" style="background:${itemGrad(it.name)}">
            ${img ? `<img class="pm-thumb-img" src="${esc(productImageUrl(img))}" alt="${esc(display || '货品')}" loading="lazy" onerror="this.style.display='none';var m=this.parentElement.querySelector('.pm-mono');if(m)m.style.display='block';">` : ''}
            <span class="pm-mono" aria-hidden="true"${img ? ' style="display:none"' : ''}>${esc(itemMono(it.name))}</span>
          </div>
          <div class="pm-body">
            <div class="pm-info">
              <div class="pm-name" title="${esc(display || '未命名货品')}">${esc(display || '未命名货品')}</div>
              <div class="pm-price">¥${fmtMoney(it.amount)}</div>
              <div class="pm-meta">${esc(meta)}</div>
            </div>
            <button type="button" class="pm-del" data-act="del-item" data-idx="${i}" aria-label="删除该货品" title="删除"><svg viewBox="0 0 24 24" aria-hidden="true">${TRASH}</svg></button>
          </div>
        </div>`;
    }
    const addItemCard = `
      <button type="button" class="pm-add" data-act="add-item" aria-label="添加货品">
        <span class="pm-add-circle" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span>
        <span class="pm-add-label">添加货品</span>
      </button>`;
    function renderItems() {
      const list = draft.items || [];
      itemsBox.innerHTML = list.map(cardHtml).join('') + addItemCard;
      recalc();
    }
    function refreshAddedItem(addition, previous) {
      if (addition.indices.length > 1) { renderItems(); return; }
      if (addition.indices.length === 1) {
        const card = itemsBox.querySelector('.oi-card[data-idx="' + addition.index + '"]');
        if (!card) { renderItems(); return; }
        if (previous.pid !== addition.item.pid) card.outerHTML = cardHtml(addition.item, addition.index);
        else {
          card.querySelector('.pm-price').textContent = '¥' + fmtMoney(addition.item.amount);
          card.querySelector('.pm-meta').textContent = fmtNum(addition.item.qty) + (addition.item.unit ? ' ' + addition.item.unit : '') + ' × ¥' + fmtPrice(addition.item.price);
        }
      } else {
        const button = itemsBox.querySelector('[data-act="add-item"]');
        if (!button) { renderItems(); return; }
        button.insertAdjacentHTML('beforebegin', cardHtml(addition.item, addition.index));
      }
      recalc();
    }
    function recalc() {
      const qtySum = sumQuantities((draft.items || []).map(it => it.qty));
      let total = 0;
      (draft.items || []).forEach(it => {
        const q = parseFloat(it.qty) || 0, p = parseFloat(it.price) || 0;
        it.amount = lineAmount(q, p);
        total += it.amount;
      });
      draft.total = Math.round(total * 100) / 100;
      $('[data-role="qtySum"]', el).textContent = fmtNum(qtySum);
      $('[data-role="total"]', el).textContent = '¥' + fmtMoney(draft.total);
      $('[data-role="upper"]', el).textContent = '大写：' + amountUpper(draft.total);
    }
    function openItemDialog(idx) {
      const isEdit = idx >= 0;
      const src = isEdit ? draft.items[idx] : { name: '', spec: '', unit: '', qty: '', price: '', pid: null, remark: '' };
      let pickedPid = src.pid || null;
      let confirmed = false;
      const PICK_PAGE_SIZE = 6;
      let pickPage = 0;
      const mask = document.createElement('div');
      trackDialog(mask);
      mask.className = 'mask show center';
      mask.innerHTML = `
        <div class="item-dialog item-dialog-pick" role="dialog" aria-modal="true" aria-label="${isEdit ? '编辑货品' : '添加货品'}">
          <div class="id-hd">${isEdit ? '编辑货品' : '添加货品'}</div>
          <div class="id-top">
            <div class="field"><label class="lab">产品名称 *</label><input data-role="name" placeholder="输入可模糊筛选下方商品" value="${esc(src.name)}" autocomplete="off"></div>
            <div class="field-row">
              <div class="field"><label class="lab">规格</label><input data-role="spec" value="${esc(src.spec)}"></div>
              <div class="field"><label class="lab">单位</label><input data-role="unit" value="${esc(src.unit)}"></div>
            </div>
            <div class="field-row">
              <div class="field"><label class="lab">数量 *</label><input data-role="qty" type="number" inputmode="decimal" value="${esc(src.qty)}"></div>
              <div class="field"><label class="lab">单价</label><input data-role="price" type="number" inputmode="decimal" value="${esc(src.price)}"></div>
            </div>
            <div class="id-amount">金额：<b data-role="amt">¥0.00</b></div>
          </div>
          <div class="id-pick">
            <div class="id-pick-hd">商品库 <span data-role="pick-count"></span>　（点选下方商品即可填入）</div>
            <div class="id-pick-grid" data-role="pick-grid"></div>
            <div class="id-pick-pager hidden" data-role="pick-pager"></div>
          </div>
          <div class="id-ft">
            <button class="btn btn-ghost" data-act="cancel">取消</button>
            <button class="btn btn-primary" data-act="ok">保存</button>
          </div>
        </div>`;
      $('#modal-root').appendChild(mask);
      const pickGrid = mask.querySelector('[data-role="pick-grid"]');
      const pickPager = mask.querySelector('[data-role="pick-pager"]');
      const val = role => (mask.querySelector('[data-role="' + role + '"]') || {}).value || '';
      const setVal = (role, v) => { const e = mask.querySelector('[data-role="' + role + '"]'); if (e) e.value = (v == null ? '' : v); };
      const updAmt = () => {
        const q = parseFloat(val('qty')) || 0, p = parseFloat(val('price')) || 0;
        mask.querySelector('[data-role="amt"]').textContent = '¥' + fmtMoney(lineAmount(q, p));
      };
      const renderPicker = () => {
        const kw = (val('name') || '').trim();
        const list = Store.listProducts(kw);
        const cnt = mask.querySelector('[data-role="pick-count"]');
        if (cnt) cnt.textContent = kw ? '(' + list.length + ')' : '';
        const pages = Math.max(1, Math.ceil(list.length / PICK_PAGE_SIZE));
        if (pickPage > pages - 1) pickPage = pages - 1;
        if (pickPage < 0) pickPage = 0;
        const shown = list.slice(pickPage * PICK_PAGE_SIZE, pickPage * PICK_PAGE_SIZE + PICK_PAGE_SIZE);
        if (!shown.length) {
          pickGrid.innerHTML = '<div class="id-pick-empty">没有找到匹配的商品，可手动填写上方信息</div>';
        } else {
          pickGrid.innerHTML = shown.map(p => {
            const img = p.image ? `<img class="id-pick-img" src="${esc(productImageUrl(p.image))}" alt="" loading="lazy" onerror="this.style.display='none';var m=this.parentElement.querySelector('.id-pick-mono');if(m)m.style.display='flex';">` : '';
            const on = (pickedPid && p.id === pickedPid) ? ' on' : '';
            return `
              <button type="button" class="id-pick-item${on}" data-pick-pid="${esc(p.id)}">
                <span class="id-pick-thumb" style="background:${itemGrad(p.name)}">
                  ${img}
                  <span class="id-pick-mono"${img ? ' style="display:none"' : ''}>${esc(itemMono(p.name))}</span>
                </span>
                <span class="id-pick-info"><b>${esc(p.name)}</b><span>${esc([p.spec, p.unit].filter(Boolean).join(' / ') || '无规格')}</span></span>
                <span class="id-pick-price">${p.price != null ? '¥' + fmtPrice(p.price) : ''}</span>
              </button>`;
          }).join('');
        }
        if (pages > 1) {
          pickPager.classList.remove('hidden');
          pickPager.innerHTML = `
            <button type="button" class="id-pager-btn" data-pick-page="prev"${pickPage <= 0 ? ' disabled' : ''}>‹ 上一页</button>
            <span class="id-pager-info">第 ${pickPage + 1} / ${pages} 页</span>
            <button type="button" class="id-pager-btn" data-pick-page="next"${pickPage >= pages - 1 ? ' disabled' : ''}>下一页 ›</button>`;
        } else {
          pickPager.classList.add('hidden');
          pickPager.innerHTML = '';
        }
      };
      mask.addEventListener('input', e => {
        if (e.target.matches('[data-role="qty"],[data-role="price"]')) updAmt();
        if (e.target.matches('[data-role="name"]')) { pickedPid = null; pickPage = 0; renderPicker(); }
        if (e.target.matches('[data-role="spec"]')) { pickedPid = null; renderPicker(); }
      });
      mask.addEventListener('click', e => {
        if (e.target === mask) { if(mask.__isDirty?.()){toast('请先确认或取消货品修改',true);return;}mask.remove(); return; }
        const pg = e.target.closest('[data-pick-page]');
        if (pg) { pickPage += (pg.dataset.pickPage === 'next' ? 1 : -1); renderPicker(); return; }
        const pick = e.target.closest('[data-pick-pid]');
        if (pick) {
          const p = Store.getProduct(pick.dataset.pickPid);
          if (!p) return;
          pickedPid = p.id;
          setVal('name', p.name);
          setVal('spec', p.spec || '');
          setVal('unit', p.unit || '');
          let price = (p.price != null ? p.price : '');
          const custId = draft.customer ? draft.customer.id : null;
          if (custId) { const last = Store.getLastPrice(custId, p.id); if (last != null && last !== '') price = last; }
          setVal('price', price);
          updAmt();
          renderPicker();
          return;
        }
        const a = e.target.closest('[data-act]');
        if (!a) return;
        if (a.dataset.act === 'cancel') { mask.remove(); return; }
        if (a.dataset.act === 'ok') {
          if (confirmed || !mask.isConnected) return;
          const name = val('name').trim();
          if (!name) { toast('请填写产品名称', true); return; }
          const qty = val('qty').trim(), price = val('price').trim();
          if (!qty || !Number.isFinite(Number(qty)) || Number(qty) <= 0
              || !Number.isFinite(Number(price)) || Number(price) < 0
              || !Number.isSafeInteger(amountCents(qty, price))) {
            toast('请填写大于 0 的有效数量和非负单价，金额不能超出可计算范围', true);
            return;
          }
          const payload = {
            pid: pickedPid, name,
            spec: val('spec').trim(), unit: val('unit').trim(),
            qty, price, remark: src.remark || '',
            amount: lineAmount(qty, price),
          };
          let addition, previous;
          if (!isEdit) {
            try { addition = planOrderItemAddition(draft.items, payload, item => Store.listProducts(item.name, { includeArchived: true })); }
            catch (error) { toast(error.message, true); return; }
            previous = draft.items[addition.index];
          }
          confirmed = true;
          a.disabled = true;
          if (isEdit) draft.items[idx] = payload;
          else if (addition.indices.length) {
            draft.items[addition.index] = addition.item;
            for (let i = addition.indices.length - 1; i > 0; i--) draft.items.splice(addition.indices[i], 1);
          } else draft.items.push(addition.item);
          priceConfirmations.set(draft.items[isEdit ? idx : addition.index], ++priceConfirmationSequence);
          mask.remove();
          if (isEdit) renderItems();
          else {
            refreshAddedItem(addition, previous);
            if (addition.indices.length) toast('已合并相同商品，数量：' + fmtNum(addition.item.qty) + (addition.item.unit ? ' ' + addition.item.unit : ''));
          }
        }
      });
      updAmt();
      renderPicker();
      const fieldSnapshot=()=>JSON.stringify(Array.from(mask.querySelectorAll('input')).map(input=>input.value));
      const baseline=fieldSnapshot();mask.__isDirty=()=>fieldSnapshot()!==baseline;
      setTimeout(() => { const n = mask.querySelector('[data-role="name"]'); if (n) n.focus(); }, 30);
    }
    renderItems();

    /* ----- 客户选择弹层 ----- */
    function openCustPicker() {
      let kw = '';
      const renderList = () => {
        const list = Store.listCustomers(kw);
        bd.querySelector('[data-role="clist"]').innerHTML = list.length ? list.map(c => `
          <div class="list-item" data-pick-cust="${c.id}">
            <div class="li-main">
              <div class="li-title">${esc(c.name)}</div>
              <div class="li-sub">${esc([c.phone, c.address].filter(Boolean).join(' · ')) || '无联系方式'}</div>
            </div>
            <span class="chevron"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
          </div>`).join('') : `<div class="empty" style="padding:30px 0"><div class="em-s">没有匹配的客户，可在下方新增</div></div>`;
      };
      const sheet = openSheet(`
        <div class="searchbar"><input placeholder="搜索客户名称 / 电话 / 地址" data-role="ckw"></div>
        <div data-role="clist"></div>
        <button class="btn btn-blue btn-block mt12" data-act="new-cust">+ 新增客户</button>
        <div class="hidden" data-role="cform" style="margin-top:12px;background:var(--surface);border-radius:10px;padding:12px">
          <div class="field"><input data-role="n.name" placeholder="客户名称 *"></div>
          <div class="field"><input data-role="n.phone" placeholder="电话"></div>
          <div class="field"><input data-role="n.address" placeholder="地址"></div>
          <div class="field"><input data-role="n.contact" placeholder="联系人"></div>
          <button class="btn btn-primary btn-block" data-act="save-new">保存客户并选用</button>
        </div>`, '选择客户');
      const bd = $('.sheet-bd', sheet.mask);
      trackDialog(sheet.mask);
      sheet.mask.__isDirty=()=>Array.from(bd.querySelectorAll('[data-role^="n."]')).some(input=>input.value.trim());
      renderList();
      $('[data-role="ckw"]', bd).addEventListener('input', e => { kw = e.target.value; renderList(); });
      bd.addEventListener('click', e => {
        const pick = e.target.closest('[data-pick-cust]');
        if (pick) {
          const c = Store.getCustomer(pick.dataset.pickCust);
          if (c) { draft.customer = { id: c.id, name: c.name, phone: c.phone || '', address: c.address || '', contact: c.contact || '' }; syncCust(); }
          sheet.mask.remove();
          return;
        }
        if (e.target.closest('[data-act="new-cust"]')) { $('[data-role="cform"]', bd).classList.remove('hidden'); return; }
        if (e.target.closest('[data-act="save-new"]')) {
          const name = $('[data-role="n.name"]', bd).value.trim();
          if (!name) { toast('请填写客户名称', true); return; }
          let c;try { c = Store.upsertCustomer({
            name,
            phone: $('[data-role="n.phone"]', bd).value.trim(),
            address: $('[data-role="n.address"]', bd).value.trim(),
            contact: $('[data-role="n.contact"]', bd).value.trim(),
          }); } catch(error) { toast(error.message || '保存客户失败',true);return; }
          draft.customer = { id: c.id, name: c.name, phone: c.phone || '', address: c.address || '', contact: c.contact || '' };
          syncCust();
          sheet.mask.remove();
        }
      });
    }
    function syncCust() {
      const c = draft.customer;
      $('[data-role="cname"]', el).textContent = c ? c.name : '选择客户（可选）';
      $('[data-role="csub"]', el).textContent = c ? [c.phone, c.address].filter(Boolean).join(' · ') : '';
      $('[data-act="clear-cust"]', el).classList.toggle('hidden', !c);
    }

    /* 货品明细通过「圆形 +」弹窗录入（见 openItemDialog），支持手动填写。 */

    /* ----- 事件 ----- */
    el.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (act) {
        const a = act.dataset.act;
        if (a === 'back') { history.length > 1 ? history.back() : (location.hash = '#/home'); return; }
        if (a === 'save') { save(); return; }
        if (a === 'clear-cust') {
          draft.customer = null;
          syncCust();
          $('[data-act="pick-cust"]', el).focus({ preventScroll: true });
          return;
        }
        if (a === 'pick-cust') { openCustPicker(); return; }
        if (a === 'add-item') { openItemDialog(-1); return; }
        if (a === 'del-item') { const idx = +act.dataset.idx; draft.items.splice(idx, 1); renderItems(); return; }
        return;
      }
      const card = e.target.closest('.oi-card');
      if (card && card.dataset.idx != null) { openItemDialog(+card.dataset.idx); }
    });
    el.addEventListener('input', e => {
      const f = e.target.closest('[data-f]');
      if (!f) return;
      if (f.dataset.f === 'date' && f.value && f.value !== draft.date && !draft.id) {
        try {
          draft.no = Store.peekOrderNo(f.value);
          $('[data-role="order-no"]', el).textContent = draft.no;
        } catch (error) {
          f.value = draft.date;
          return;
        }
      }
      draft[f.dataset.f] = f.value;
    });

    function save() {
      if (saving) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || dateStr(dateOf(draft.date)) !== draft.date) {
        toast('请填写有效的送货日期', true);
        return;
      }
      if (!draft.items.length || draft.items.some(it => !String(it.name || '').trim()
          || String(it.qty).trim() === '' || !Number.isFinite(Number(it.qty)) || Number(it.qty) <= 0
          || !Number.isFinite(Number(it.price)) || Number(it.price) < 0
          || !Number.isSafeInteger(amountCents(it.qty, it.price)))) {
        toast('请检查货品：名称必填、数量须大于 0、单价须非负，金额不能超出可计算范围', true);
        return;
      }
      const clean = draft.items.map(it => ({
        pid: it.pid,
        name: (it.name || '').trim(),
        spec: (it.spec || '').trim(),
        unit: (it.unit || '').trim(),
        qty: Number(it.qty),
        price: Number(it.price),
        amount: lineAmount(it.qty, it.price),
        remark: (it.remark || '').trim(),
      }));
      if (!clean.length) { toast('请至少填写一行有效货品', true); return; }
      const total = Math.round(clean.reduce((a, it) => a + it.amount, 0) * 100) / 100;
      if (!Number.isSafeInteger(Math.round(total * 100))) { toast('合计金额超出可计算范围', true); return; }

      let saved;
      saving = true;
      try {
        saved = Store.transaction(() => {
          // Resolve identities first, including manually entered specifications.
          let customer = draft.customer ? { ...draft.customer } : null;
          if (customer && customer.name && !customer.id) {
            const c = Store.upsertCustomer({
              name: customer.name, phone: customer.phone || '', address: customer.address || '', contact: customer.contact || '',
            });
            customer = { id: c.id, name: c.name, phone: c.phone || '', address: c.address || '', contact: c.contact || '' };
          }
          clean.forEach(it => {
            if (!it.pid || !Store.getProduct(it.pid)) {
              const matches = Store.listProducts(it.name, { includeArchived: true }).filter(product => String(product.name || '').trim() === it.name
                && String(product.spec || '').trim() === it.spec && String(product.unit || '').trim() === it.unit);
              if (matches.length > 1) throw new Error('同名同规格商品有多条，请在货品编辑窗口从商品库选择具体商品后保存');
              const product = matches[0] || Store.upsertProduct({ name: it.name, spec: it.spec, unit: it.unit, price: it.price });
              it.pid = product.id;
            }
          });
          const custId = customer ? customer.id : null;
          // Merging preserves the first card's position. Remember the last
          // confirmed price, not whichever differently-priced row sits last.
          const rememberedPrices = new Map();
          clean.forEach((it, index) => {
            const sequence = priceConfirmations.get(draft.items[index]) || 0;
            const previous = rememberedPrices.get(it.pid);
            if (!previous || sequence >= previous.sequence) rememberedPrices.set(it.pid, { price: it.price, sequence });
          });
          for (const [pid, entry] of rememberedPrices) Store.setLastPrice(custId, pid, entry.price);
          const payload = {
            // 新单在保存这一刻才占用单号；界面上显示的是预览
            no: draft.id ? draft.no : Store.nextOrderNo(draft.date),
            date: draft.date || todayStr(),
            operator: (draft.operator || '').trim(),
            customer,
            items: clean,
            total,
          };
          if (!draft.id) return Store.addOrder(payload);
          const updated = Store.updateOrder(draft.id, payload);
          if (!updated) throw new Error('单据已不存在，请返回单据列表重新打开');
          return updated;
        });
      } catch (error) {
        saving = false;
        toast(error.message || '保存失败', true);
        return;
      }
      el.__saved = true;
      toast(draft.id ? '单据已更新' : '送货单已保存');
      location.hash = '#/order/view?id=' + saved.id;
    }

    return el;
  },

  /* ---------------- 详情 ---------------- */
  renderView(id) {
    const o = Store.getOrder(id);
    const el = document.createElement('div');
    el.className = 'view active';
    if (!o) {
      el.innerHTML = `<div class="empty"><div class="em-t">单据不存在</div><button class="btn btn-primary" data-act="back">返回</button></div>`;
      el.addEventListener('click', e => { if (e.target.closest('[data-act="back"]')) location.hash = '#/orders'; });
      return el;
    }
    const prev = Store.siblingOrder(id, -1);
    const next = Store.siblingOrder(id, 1);
    const qtySum = sumQuantities(o.items.map(i => i.qty));

    el.innerHTML = `
      <div class="topbar">
        <button class="icbtn" data-act="back"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
        <h1>单据详情</h1>
        <button class="icbtn" data-act="print"><svg viewBox="0 0 24 24"><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z"/></svg></button>
      </div>
      <div class="pad">
        <div class="hint document-scroll-hint">左右滑动查看完整单据</div>
        <div class="doc-stage">
          <button type="button" class="doc-nav-btn doc-nav-prev" data-act="prev" aria-label="上一张" title="上一张"${prev ? '' : ' disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
          <button type="button" class="doc-nav-btn doc-nav-next" data-act="next" aria-label="下一张" title="下一张"${next ? '' : ' disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
          <div class="document-scroll doc-detail-scroll" role="region" aria-label="送货单详情，可左右滑动" tabindex="0">
        <div class="doc-card tri-strip">
          <div class="dc-head">
            <span class="dc-no">${esc(o.no)}</span>
            <span class="dc-state">已开单</span>
          </div>
          <div class="dc-body">
            <div class="dc-meta">
              <div class="dc-meta-group dc-customer">
                <div class="dc-line dc-span2"><span class="k">客户</span><span class="v">${esc((o.customer && o.customer.name) || '')}</span></div>
                ${o.customer && o.customer.phone ? `<div class="dc-line"><span class="k">电话</span><span class="v">${esc(o.customer.phone)}</span></div>` : ''}
                ${o.customer && o.customer.contact ? `<div class="dc-line"><span class="k">联系人</span><span class="v">${esc(o.customer.contact)}</span></div>` : ''}
                ${o.customer && o.customer.address ? `<div class="dc-line dc-span2"><span class="k">地址</span><span class="v">${esc(o.customer.address)}</span></div>` : ''}
              </div>
              <div class="dc-meta-group dc-order">
                <div class="dc-line"><span class="k">日期</span><span class="v">${esc(o.date)}</span></div>
                ${o.operator ? `<div class="dc-line"><span class="k">制单人</span><span class="v">${esc(o.operator)}</span></div>` : ''}
              </div>
            </div>
            <table class="tbl dc-tbl">
              <thead><tr><th style="width:30px">#</th><th>产品名称</th><th style="width:76px">规格</th><th style="width:40px">单位</th><th style="width:50px">数量</th><th style="width:70px">单价</th><th style="width:78px">金额</th></tr></thead>
              <tbody>
                ${o.items.map((it, i) => `
                  <tr>
                    <td class="num">${i + 1}</td>
                    <td class="left">${esc(it.name)}</td>
                    <td>${esc(it.spec || '-')}</td>
                    <td>${esc(it.unit || '-')}</td>
                    <td class="num">${fmtNum(it.qty)}</td>
                    <td class="num">${fmtPrice(it.price)}</td>
                    <td class="num">${fmtMoney(it.amount)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="dc-foot">
            <span class="f-lab">共 <span class="doc-quantity">${fmtNum(qtySum)}</span> 件</span>
            <span class="f-lab">金额大写：${esc(amountUpper(o.total))}</span>
            <span class="f-num">¥${fmtMoney(o.total)}</span>
          </div>
        </div>
        </div>
        </div>

        <div class="btn-row">
          <button class="btn btn-ghost" data-act="copy">复制新增</button>
          <button class="btn btn-primary" data-act="edit">编辑</button>
        </div>
        <div class="btn-row">
          <button class="btn btn-ghost" data-act="print">打印预览 / 导出</button>
          <button class="btn btn-danger-ghost" data-act="del">删除</button>
        </div>
      </div>`;

    el.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const a = act.dataset.act;
      if (a === 'back') { history.length > 1 ? history.back() : (location.hash = '#/orders'); }
      else if (a === 'print') { location.hash = '#/print?id=' + o.id; }
      else if (a === 'edit') { location.hash = '#/order/edit?id=' + o.id; }
      else if (a === 'copy') { window.__orderDraft = { ...o, customer: o.customer ? { ...o.customer } : null, items: o.items.map(i => ({ ...i })), _copy: true }; location.hash = '#/order/new'; }
      else if (a === 'prev' && prev) { location.hash = '#/order/view?id=' + prev.id; }
      else if (a === 'next' && next) { location.hash = '#/order/view?id=' + next.id; }
      else if (a === 'del') {
        const ok = await confirmDialog({ title: '删除这张送货单？', text: o.no + '，删除后不可恢复。', okText: '删除', danger: true });
        if (!ok) return;
        try { Store.transaction(()=>{Store.deleteOrder(o.id);Store.reclaimNo(o.no);}); }
        catch(error) { toast(error.message || '删除失败',true);return; }
        toast('已删除');
        location.hash = '#/orders';
      }
    });
    return el;
  },

  /* ---------------- 编辑 ---------------- */
  renderEdit(id) {
    const o = Store.getOrder(id);
    if (!o) { location.hash = '#/orders'; return document.createElement('div'); }
    window.__orderDraft = {
      id: o.id, no: o.no, date: o.date,
      operator: o.operator || '',
      customer: o.customer ? { ...o.customer } : null,
      items: o.items.map(i => ({ pid: i.pid, name: i.name, spec: i.spec || '', unit: i.unit || '', qty: String(i.qty), price: String(i.price), amount: i.amount, remark: i.remark || '' })),
    };
    return this.renderNew();
  }
};
