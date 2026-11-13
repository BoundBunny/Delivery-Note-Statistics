/* ============================================================
 * views/data.js — 客户管理 / 商品管理
 * ============================================================ */
'use strict';
window.Views = window.Views || {};

function dataListView({ kind, title, editId }) {
  // kind: 'customers' | 'products'
  const st = { kw: '', editing: editId || null };
  const desktopOffset = () => window.Android && window.Android.isDesktop ? parseFloat(getComputedStyle(document.body).getPropertyValue('--dns-header-height')) || 0 : 0;
  const scrollHost = () => el.closest('[data-desktop-scroll]');
  const scrollTopEdge = () => scrollHost() ? scrollHost().getBoundingClientRect().top : desktopOffset();
  const isCustomers = kind === 'customers';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
  let kwTimer = null, layoutFrame = null, scrollFrame = null, indexToastTimer = null;
  let disposed = false;

  const el = document.createElement('div');
  el.className = 'view active' + (isCustomers ? ' customers-view' : '');

  const updateActiveLetter = () => {
    if (disposed || !isCustomers || !el.isConnected || st.editing) return;
    const groups = $$('[data-customer-group]', el);
    const toolbarHeight = $('.customer-toolbar', el).getBoundingClientRect().height;
    let current = groups[0];
    groups.forEach(group => { if (group.getBoundingClientRect().top <= scrollTopEdge() + toolbarHeight + 18) current = group; });
    $$('[data-customer-letter]', el).forEach(button => {
      const active = Boolean(current && current.dataset.customerGroup === button.dataset.customerLetter);
      button.classList.toggle('on', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };
  const updateLayout = () => {
    if (disposed || !isCustomers || layoutFrame !== null) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = null;
      if (!el.isConnected || disposed) return;
      el.style.setProperty('--customer-toolbar-height', $('.customer-toolbar', el).getBoundingClientRect().height + 'px');
      updateActiveLetter();
    });
  };
  const onScroll = () => {
    if (disposed || scrollFrame !== null) return;
    scrollFrame = requestAnimationFrame(() => { scrollFrame = null; updateActiveLetter(); });
  };
  const jumpToLetter = letter => {
    const group = $('[data-customer-group="' + letter + '"]', el);
    if (!group) return;
    const host = scrollHost();
    const top = (host ? host.scrollTop : window.scrollY) + group.getBoundingClientRect().top - $('.customer-toolbar', el).getBoundingClientRect().height - scrollTopEdge() - 4;
    (host || window).scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const indicator = $('[data-role="index-toast"]', el);
    indicator.textContent = letter;
    indicator.classList.add('show');
    clearTimeout(indexToastTimer);
    indexToastTimer = setTimeout(() => indicator.classList.remove('show'), 650);
  };

  const formHtml = (d) => {
    if (kind === 'customers') {
      return `
        <div class="order-meta" style="padding:14px 16px">
          <div class="field"><label class="lab">客户名称 *</label><input data-role="name" value="${esc(d ? d.name : '')}" placeholder="必填"></div>
          <div class="field-row">
            <div class="field"><label class="lab">电话</label><input data-role="phone" value="${esc(d ? d.phone : '')}"></div>
            <div class="field"><label class="lab">联系人</label><input data-role="contact" value="${esc(d ? d.contact : '')}"></div>
          </div>
          <div class="field"><label class="lab">地址</label><input data-role="address" value="${esc(d ? d.address : '')}"></div>
          <div class="btn-row" style="padding:4px 0 0">
            <button class="btn btn-ghost" data-act="form-cancel">取消</button>
            <button class="btn btn-primary" data-act="form-save">保存</button>
          </div>
        </div>`;
    }
    return `
      <div class="order-meta" style="padding:14px 16px">
        <div class="field-row">
          <div class="field"><label class="lab">产品编号</label><input data-role="code" value="${esc(d ? d.code : '')}"></div>
          <div class="field"><label class="lab">条码</label><input data-role="barcode" value="${esc(d ? d.barcode : '')}"></div>
        </div>
        <div class="field"><label class="lab">产品名称 *</label><input data-role="name" value="${esc(d ? d.name : '')}" placeholder="必填"></div>
        <div class="field-row">
          <div class="field"><label class="lab">规格</label><input data-role="spec" value="${esc(d ? d.spec : '')}"></div>
          <div class="field"><label class="lab">单位</label><input data-role="unit" value="${esc(d ? d.unit : '')}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label class="lab">默认单价</label><input data-role="price" type="number" inputmode="decimal" value="${d && d.price != null ? d.price : ''}"></div>
          <div class="field"><label class="lab">成本价</label><input data-role="cost" type="number" inputmode="decimal" value="${d && d.cost != null ? d.cost : ''}"></div>
        </div>
        <div class="field"><label class="lab">备注</label><input data-role="remark" value="${esc(d ? d.remark : '')}"></div>
        <div class="btn-row" style="padding:4px 0 0">
          <button class="btn btn-ghost" data-act="form-cancel">取消</button>
          <button class="btn btn-primary" data-act="form-save">保存</button>
        </div>
      </div>`;
  };

  const render = () => {
    const list = kind === 'customers' ? Store.listCustomers(st.kw) : Store.listProducts(st.kw);
    const body = $('[data-role="list"]', el);
    const index = $('[data-role="customer-index"]', el);
    const warning = $('[data-role="customer-warning"]', el);
    if (isCustomers) {
      const suspicious = Store.listCustomers().filter(customer => isSuspiciousCustomerName(customer.name)).length;
      warning.classList.toggle('hidden', !suspicious || Boolean(st.editing));
      warning.textContent = suspicious ? `发现 ${suspicious} 个客户名称含乱码字符，已保留在 # 分组。请核对原始文件后修改名称或重新导入，系统不会自动删除。` : '';
      index.classList.toggle('hidden', Boolean(st.editing) || !list.length);
    }
    if (st.editing === 'new' || st.editing) {
      const d = st.editing === 'new' ? null : (kind === 'customers' ? Store.getCustomer(st.editing) : Store.getProduct(st.editing));
      body.innerHTML = formHtml(d);
      updateLayout();
      return;
    }
    const orderCounts = new Map();
    if (isCustomers) Store.listOrders().forEach(order => {
      if (order.customer && order.customer.id != null) {
        const id = String(order.customer.id);
        orderCounts.set(id, (orderCounts.get(id) || 0) + 1);
      }
    });
    const itemHtml = item => {
      const main = kind === 'customers'
        ? { t: item.name, s: [item.phone, item.address].filter(Boolean).join(' · ') || '无联系方式', extra: '客户' }
        : { t: item.name, s: [item.code, item.spec, item.unit].filter(Boolean).join(' · ') || '无规格', extra: item.price != null ? '¥' + fmtPrice(item.price) : '无价' };
      return `
        <div class="list-item" data-item-id="${esc(item.id)}">
          <div class="li-main">
            <div class="li-title">${esc(main.t)}</div>
            <div class="li-sub">${esc(main.s)}</div>
          </div>
          <div class="li-end"><div class="num" style="font-size:13px;color:var(--muted);font-weight:600">${esc(main.extra)}</div>
            <div class="cap">${isCustomers ? (orderCounts.get(String(item.id)) || 0) + ' 张单' : ''}</div>
          </div>
          <span class="chevron"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
        </div>`;
    };
    if (!list.length) {
      body.innerHTML = `<div class="empty customer-empty">
        <div class="em-t">${st.kw ? '没有找到匹配的' : '还没有'}${isCustomers ? '客户' : '商品'}</div>
        <div class="em-s">${st.kw ? '试试其他名称或电话' : '点击上方「新增」开始添加'}</div>
      </div>`;
    } else if (isCustomers) {
      const groups = new Map();
      list.forEach(item => {
        const letter = customerNameInfo(item.name).letter;
        if (!groups.has(letter)) groups.set(letter, []);
        groups.get(letter).push(item);
      });
      body.innerHTML = Array.from(groups, ([letter, customers]) => `
        <section class="customer-group" data-customer-group="${letter}" aria-label="${letter} 分组">
          <h2 class="customer-group-heading">${letter}<span>${customers.length} 位</span></h2>
          <div class="list customer-group-list">${customers.map(itemHtml).join('')}</div>
        </section>`).join('');
      index.innerHTML = alphabet.map(letter => `<button type="button" data-customer-letter="${letter}" aria-label="${groups.has(letter) ? '跳到 ' + letter + ' 开头的客户' : letter + ' 暂无客户'}" aria-pressed="false"${groups.has(letter) ? '' : ' disabled'}>${letter}</button>`).join('');
    } else body.innerHTML = list.map(itemHtml).join('');
    updateLayout();
  };

  el.innerHTML = `
    ${isCustomers ? '<div class="customer-toolbar">' : ''}
    <div class="topbar">
      <h1>${title}</h1>
      <button class="btn btn-ghost btn-sm" data-act="new">+ 新增</button>
    </div>
    <div class="searchbar">
      <input class="input" placeholder="${kind === 'customers' ? '搜索客户名称 / 电话' : '搜索商品名称 / 编号'}" data-role="kw" value="${esc(st.kw)}">
    </div>
    ${isCustomers ? '</div><div class="customer-data-warning hidden" data-role="customer-warning" role="status"></div>' : ''}
    <div class="list${isCustomers ? ' customer-list' : ''}" data-role="list"></div>
    <div class="hint" style="margin:0 20px;text-align:center">点击列表项可修改资料；导入、导出请前往设置页</div>
    ${isCustomers ? '<nav class="customer-index" data-role="customer-index" aria-label="客户字母索引"></nav><div class="customer-index-toast" data-role="index-toast" aria-hidden="true"></div>' : ''}`;

  render();

  el.addEventListener('click', async e => {
    const letter = e.target.closest('[data-customer-letter]');
    if (letter) { if (!letter.disabled) jumpToLetter(letter.dataset.customerLetter); return; }
    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'new') { st.editing = 'new'; render(); return; }
      if (a === 'form-cancel') { st.editing = null; render(); return; }
      if (a === 'form-save') {
        const name = $('[data-role="name"]', el).value.trim();
        if (!name) { toast('请填写名称', true); return; }
        const payload = { name };
        ['phone', 'contact', 'address', 'remark'].forEach(k => {
          const inp = $('[data-role="' + k + '"]', el);
          if (inp) payload[k] = inp.value.trim();
        });
        if (kind === 'products') {
          ['code', 'barcode', 'spec', 'unit'].forEach(k => {
            const inp = $('[data-role="' + k + '"]', el);
            if (inp) payload[k] = inp.value.trim();
          });
          const p = parseFloat($('[data-role="price"]', el).value);
          payload.price = Number.isFinite(p) ? p : undefined;
          const c = parseFloat($('[data-role="cost"]', el).value);
          payload.cost = Number.isFinite(c) ? c : undefined;
        }
        if (st.editing !== 'new') payload.id = st.editing;
        try { kind === 'customers' ? Store.upsertCustomer(payload) : Store.upsertProduct(payload); }
        catch (error) { toast(error.message || '保存失败',true);return; }
        el.dispatchEvent(new Event('dns-form-committed',{bubbles:true}));
        toast('已保存');
        st.editing = null;
        render();
        return;
      }
    }
    const item = e.target.closest('.list-item');
    if (!item) return;
    const target = isCustomers ? Store.getCustomer(item.dataset.itemId) : Store.getProduct(item.dataset.itemId);
    if (!target) return;
    const doEdit = await new Promise(res => {
      const sheet = openSheet(`
        <div style="padding:4px 0 8px">
          <button class="btn btn-ghost btn-block" data-o="edit">修改资料</button>
          <button class="btn btn-ghost btn-block" style="margin-top:8px" data-o="orders">查看相关单据</button>
          <button class="btn btn-danger-ghost btn-block" style="margin-top:8px" data-o="del">删除</button>
        </div>`, target.name);
      const bd = $('.sheet-bd', sheet.mask);
      bd.addEventListener('click', e => {
        const o = e.target.closest('[data-o]');
        if (!o) return;
        sheet.mask.remove();
        res(o.dataset.o);
      });
    });
    if (doEdit === 'edit') { st.editing = target.id; render(); }
    else if (doEdit === 'del') {
      const ok = await confirmDialog({ title: `删除${kind === 'customers' ? '客户' : '商品'}？`, text: target.name, okText: '删除', danger: true });
      if (!ok) return;
      try { kind === 'customers' ? Store.deleteCustomer(target.id) : Store.deleteProduct(target.id); }
      catch(error) { toast(error.message || '删除失败',true);return; }
      toast('已删除');
      render();
    } else if (doEdit === 'orders') {
      Views.orders.state.kw = '';Views.orders.state.range = 'all';
      location.hash = '#/orders?customer=' + encodeURIComponent(target.id);
    }
  });

  el.addEventListener('input', e => {
    if (!e.target.matches('[data-role="kw"]')) return;
    clearTimeout(kwTimer);
    kwTimer = setTimeout(() => { st.kw = e.target.value; if (!st.editing) render(); }, 200);
  });

  let resizeObserver = null;
  if (isCustomers) {
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', updateLayout);
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(updateLayout);
      resizeObserver.observe($('.customer-toolbar', el));
    }
  }
  el.dispose = () => {
    disposed = true;
    clearTimeout(kwTimer);
    clearTimeout(indexToastTimer);
    if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
    if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    if (resizeObserver) resizeObserver.disconnect();
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', updateLayout);
  };

  return el;
}

Views.customers = { render(params) { const id=params&&params.edit;return dataListView({ kind:'customers',title:'客户管理',editId:id==='new'||Store.getCustomer(id)?id:null }); } };

/* ============================================================
 * views/data.js — 商品管理（卡片网格视图）
 *   风格参考 POS：顶部分类胶囊 + 商品卡片网格。
 *   分类：所有 / 烟酒 / 饮料 / 零食 / 其他。
 *   每张卡片：图片区 + 左下角(名称/单价/规格单位) + 右侧垃圾桶(二次确认删除)。
 *   网格第一张为「圆形 +」添加商品卡片。
 * ============================================================ */
function productCardView(params) {
  const CATS = [
    { key: 'all', label: '所有', icon: '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>' },
    { key: 'snack', label: '休闲零食类', icon: '<circle cx="12" cy="12" r="8"/><circle cx="9" cy="10" r=".95" fill="currentColor" stroke="none"/><circle cx="14.6" cy="9.4" r=".95" fill="currentColor" stroke="none"/><circle cx="12.4" cy="14.1" r=".95" fill="currentColor" stroke="none"/><circle cx="8.7" cy="14.7" r=".95" fill="currentColor" stroke="none"/>' },
    { key: 'drink', label: '酒水饮料类', icon: '<path d="M6 8h12l-1.4 12.1a2 2 0 0 1-2 1.9H9.4a2 2 0 0 1-2-1.9L6 8Z"/><path d="M5 8h14"/><path d="M13.5 3.2 15.5 8"/>' },
    { key: 'candy', label: '糖果巧克力类', icon: '<rect x="8" y="9" width="8" height="6" rx="2"/><path d="M8 12 4 9v6l4-3M16 12l4-3v6l-4-3"/>' },
    { key: 'grain', label: '粮油副食类', icon: '<path d="M7 8h10l-1.2 12.2a1 1 0 0 1-1 .8H9.2a1 1 0 0 1-1-.8L7 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><path d="M9.4 13h5.2"/>' },
    { key: 'daily', label: '日用百货类', icon: '<path d="M4 9h16l-1.5 10.2a1 1 0 0 1-1 .8H6.5a1 1 0 0 1-1-.8L4 9Z"/><path d="M8.5 9 11 3.5M15.5 9 13 3.5"/><path d="M9 13v3.5M12 13v3.5M15 13v3.5"/>' },
    { key: 'tobacco', label: '香烟烟草类', icon: '<rect x="3" y="9.5" width="14.5" height="5" rx="1.4"/><path d="M17.5 12h2a1.4 1.4 0 0 1 0 2.8h-2"/><path d="M6.5 7c0-.9.9-1.2.9-2.1M10 7c0-.9.9-1.2.9-2.1"/>' }
  ];
  const CAT_KEYS = CATS.map(c => c.key);
  const GRADS = [
    'linear-gradient(135deg,#EEF2FF,#C7D2FE)',
    'linear-gradient(135deg,#F5F3FF,#DDD6FE)',
    'linear-gradient(135deg,#ECFDF5,#A7F3D0)',
    'linear-gradient(135deg,#FFF7ED,#FED7AA)',
    'linear-gradient(135deg,#F0F9FF,#BAE6FD)',
    'linear-gradient(135deg,#FDF2F8,#FBCFE8)'
  ];
  const TRASH = '<path d="M3 6h18"/><path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6"/><path d="M18.5 6l-1 13.2A1.8 1.8 0 0 1 15.7 21H8.3a1.8 1.8 0 0 1-1.8-1.8L5.5 6"/><path d="M10 10.5v6M14 10.5v6"/>';
  // 旧版本分类键值 → 新分类（兼容历史商品数据）
  const LEGACY_CAT = { wine: 'drink', drink: 'drink', snack: 'snack', other: 'daily' };
  const catLabel = k => (CATS.find(c => c.key === k) || CATS[1]).label;
  const catOf = p => {
    const raw = p && p.category;
    if (raw && CAT_KEYS.indexOf(raw) > 0) return raw;
    if (raw && LEGACY_CAT[raw]) return LEGACY_CAT[raw];
    return '';
  };
  const catIcon = k => (CATS.find(c => c.key === k) || CATS[1]).icon;
  const grad = name => { let h = 0; String(name || '').split('').forEach(ch => { h = (h * 31 + ch.codePointAt(0)) >>> 0; }); return GRADS[h % GRADS.length]; };
  const mono = name => {
    const s = String(name || '').trim();
    if (!s) return '?';
    const first = Array.from(s)[0];
    return /[\u4e00-\u9fff]/.test(first) ? first : s.replace(/\s+/g, '').slice(0, 2).toUpperCase();
  };

  const st = { kw: '', category: 'all', editing: null, image: '' };
  // 支持 #/products?cat=drink 直接定位到某个分类（工作台沙盘卡片点进来）
  const wantCat = params && params.cat ? String(params.cat) : '';
  if (wantCat && CATS.some(c => c.key === wantCat)) st.category = wantCat;
  let kwTimer = null;

  const el = document.createElement('div');
  el.className = 'view active products-view';
  el.innerHTML = `
    <div class="pm-head">
      <h1 class="pm-title">商品管理</h1>
      <div class="pm-searchbar">
        <svg class="pm-search-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input class="input" type="search" placeholder="搜索商品名称 / 编号 / 规格" data-role="kw" autocomplete="off">
      </div>
    </div>
    <div data-role="browse">
      <div class="pm-cats" data-role="cats" role="tablist" aria-label="商品分类"></div>
      <div class="pm-grid" data-role="grid"></div>
    </div>
    <div data-role="form" class="hidden"></div>`;

  const cardHtml = p => `
    <div class="pm-card${p.archived ? ' pm-card--archived' : ''}" data-id="${esc(p.id)}" role="button" tabindex="0" aria-label="编辑商品 ${esc(p.name)}">
      <div class="pm-thumb" style="background:${grad(p.name)}">
        ${p.image ? `<img class="pm-thumb-img" src="${esc(productImageUrl(p.image))}" alt="${esc(p.name)}" width="160" height="120" loading="lazy" decoding="async" onerror="this.style.display='none';var m=this.parentElement.querySelector('.pm-mono');if(m)m.style.display='block';">` : ''}
        <span class="pm-mono" aria-hidden="true"${p.image ? ' style="display:none"' : ''}>${esc(mono(p.name))}</span>
        ${catOf(p) ? `<span class="pm-chip"><svg viewBox="0 0 24 24" aria-hidden="true">${catIcon(catOf(p))}</svg>${esc(catLabel(catOf(p)))}</span>` : ''}
        ${p.archived ? `<span class="pm-off-badge">已下架</span>` : ''}
      </div>
      <div class="pm-body">
        <div class="pm-info">
          <div class="pm-name" title="${esc(p.name)}">${esc(p.name)}</div>
          <div class="pm-price">${p.price != null ? '¥' + fmtPrice(p.price) : '未定价'}</div>
          <div class="pm-meta">${esc([p.spec, p.unit].filter(Boolean).join(' / ') || '无规格')}</div>
        </div>
        ${p.archived ? `<button type="button" class="pm-restore" data-restore="${esc(p.id)}" aria-label="恢复上架 ${esc(p.name)}" title="恢复上架">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
        </button>` : ''}
        <button type="button" class="pm-del" data-del="${esc(p.id)}" aria-label="删除商品 ${esc(p.name)}" title="${p.archived ? '彻底删除' : '删除（有历史单据则下架）'}">
          <svg viewBox="0 0 24 24" aria-hidden="true">${TRASH}</svg>
        </button>
      </div>
    </div>`;

  const addCardHtml = `
    <button type="button" class="pm-add" data-act="new" aria-label="添加商品">
      <span class="pm-add-circle" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span>
      <span class="pm-add-label">添加商品</span>
    </button>`;

  const formHtml = d => `
    <div class="order-meta" style="padding:14px 16px">
      <div class="field-row">
        <div class="field"><label class="lab">产品编号</label><input data-role="code" value="${esc(d ? d.code : '')}"></div>
        <div class="field"><label class="lab">条码</label><input data-role="barcode" value="${esc(d ? d.barcode : '')}"></div>
      </div>
      <div class="field"><label class="lab">产品名称 *</label><input data-role="name" value="${esc(d ? d.name : '')}" placeholder="必填"></div>
      <div class="field"><label class="lab">分类</label>
        <select data-role="category">
          ${CATS.filter(c => c.key !== 'all').map(c => `<option value="${c.key}" ${catOf(d) === c.key ? 'selected' : ''}>${c.label}</option>`).join('')}
        </select>
      </div>
      <div class="field-row">
        <div class="field"><label class="lab">规格</label><input data-role="spec" value="${esc(d ? d.spec : '')}"></div>
        <div class="field"><label class="lab">单位</label><input data-role="unit" value="${esc(d ? d.unit : '')}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label class="lab">默认单价</label><input data-role="price" type="number" inputmode="decimal" value="${d && d.price != null ? d.price : ''}"></div>
        <div class="field"><label class="lab">成本价</label><input data-role="cost" type="number" inputmode="decimal" value="${d && d.cost != null ? d.cost : ''}"></div>
      </div>
      <div class="field"><label class="lab">备注</label><input data-role="remark" value="${esc(d ? d.remark : '')}"></div>
      <div class="field">
        <label class="lab">商品图片</label>
        <div class="pm-img-field">
          <div class="pm-img-preview${st.image ? '' : ' empty'}" data-role="img-preview">
            ${st.image ? `<img src="${esc(productImageUrl(st.image))}" alt="商品图片">` : '<span>暂无图片</span>'}
          </div>
          <div class="pm-img-btns">
            <button type="button" class="btn btn-ghost btn-sm" data-act="pick-image">选择图片</button>
            <button type="button" class="btn btn-ghost btn-sm${st.image ? '' : ' hidden'}" data-act="remove-image">移除图片</button>
          </div>
          <div class="pm-img-hint">图片保存在本机，纯本地存储，不上传网络。</div>
        </div>
      </div>
      <div class="btn-row" style="padding:4px 0 0">
        <button class="btn btn-ghost" data-act="form-cancel">取消</button>
        <button class="btn btn-primary" data-act="form-save">保存</button>
      </div>
    </div>`;

  const renderCats = () => {
    $('[data-role="cats"]', el).innerHTML = CATS.map(c => `
      <button type="button" class="pm-cat${st.category === c.key ? ' on' : ''}" data-cat="${c.key}" role="tab" aria-selected="${st.category === c.key}">
        <svg viewBox="0 0 24 24" class="pm-cat-ic" aria-hidden="true">${c.icon}</svg>
        <span>${c.label}</span>
      </button>`).join('');
  };

  const currentList = () => {
    let list = Store.listProducts(st.kw, { includeArchived: true });
    if (st.category !== 'all') list = list.filter(p => catOf(p) === st.category);
    // 在售在前，已下架排在后面
    return list.slice().sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0));
  };

  // 分批渲染：一次性渲染数百张卡片会同时解码数百张图片，拖窗口时合成器扛不住。
  // 先渲染首批，滚动到底部哨兵时再追加下一批（IntersectionObserver）。
  const PAGE_SIZE = 48;
  let gridList = [];      // 当前待渲染的完整列表
  let gridRendered = 0;   // 已渲染到第几个
  let gridObserver = null;
  let gridSentinel = null;

  const stopGridObserver = () => {
    if (gridObserver) { gridObserver.disconnect(); gridObserver = null; }
    gridSentinel = null;
  };

  const appendCardBatch = (grid, count) => {
    const slice = gridList.slice(gridRendered, gridRendered + count);
    if (!slice.length) return;
    const frag = document.createElement('div');
    frag.innerHTML = slice.map(cardHtml).join('');
    // 插到哨兵之前
    const anchor = grid.querySelector('[data-role="grid-sentinel"]');
    const nodes = Array.from(frag.children);
    nodes.forEach(n => anchor ? grid.insertBefore(n, anchor) : grid.appendChild(n));
    gridRendered += slice.length;
  };

  const ensureSentinel = grid => {
    gridSentinel = grid.querySelector('[data-role="grid-sentinel"]');
    if (gridSentinel) return gridSentinel;
    gridSentinel = document.createElement('div');
    gridSentinel.setAttribute('data-role', 'grid-sentinel');
    gridSentinel.style.cssText = 'grid-column:1/-1;height:1px;';
    grid.appendChild(gridSentinel);
    return gridSentinel;
  };

  const renderGrid = () => {
    stopGridObserver();
    const list = currentList();
    gridList = list;
    gridRendered = 0;
    const grid = $('[data-role="grid"]', el);
    const emptyHint = list.length ? '' : `<div class="pm-empty">${(st.kw || st.category !== 'all') ? '没有找到匹配的商品' : '还没有商品，点上方「+」添加第一个商品'}</div>`;
    grid.innerHTML = '';
    // 「添加商品」卡固定放在第一位
    const addWrap = document.createElement('div');
    addWrap.style.display = 'contents';
    addWrap.innerHTML = addCardHtml;
    grid.appendChild(addWrap);
    if (emptyHint) {
      const hintWrap = document.createElement('div');
      hintWrap.style.display = 'contents';
      hintWrap.innerHTML = emptyHint;
      grid.appendChild(hintWrap);
      return;
    }
    appendCardBatch(grid, PAGE_SIZE);
    if (gridRendered < list.length) {
      // 哨兵排在所有商品卡之后，新批次会插在它前面
      ensureSentinel(grid);
      gridObserver = new IntersectionObserver(entries => {
        if (entries.some(en => en.isIntersecting)) {
          appendCardBatch(grid, PAGE_SIZE);
          if (gridRendered >= list.length) {
            stopGridObserver();
            if (gridSentinel && gridSentinel.parentNode) gridSentinel.parentNode.removeChild(gridSentinel);
          }
        }
      }, { rootMargin: '400px 0px' });
      gridObserver.observe(gridSentinel);
    }
  };

  // 删除后只需从内存列表移除一张，避免整块重建
  const removeRenderedCard = id => {
    gridList = gridList.filter(p => p.id !== id);
    const card = el.querySelector(`.pm-card[data-id="${CSS.escape(id)}"]`);
    if (card) card.remove();
    gridRendered = Math.max(0, gridRendered - 1);
  };


  const openForm = id => {
    st.editing = id;
    const d = (id && id !== 'new') ? Store.getProduct(id) : null;
    st.image = (d && d.image) ? d.image : '';
    // 新增 / 编辑商品时，右上角搜索框不应出现
    const searchbar = $('.pm-searchbar', el);
    if (searchbar) searchbar.classList.add('hidden');
    $('[data-role="browse"]', el).classList.add('hidden');
    const wrap = $('[data-role="form"]', el);
    wrap.classList.remove('hidden');
    wrap.innerHTML = `<div class="pm-form-head">
        <button type="button" class="btn btn-ghost btn-sm" data-act="form-cancel">‹ 返回</button>
        <span>${id === 'new' ? '新增商品' : '编辑商品'}</span>
      </div>` + formHtml(d);
    const nameInput = $('[data-role="name"]', wrap);
    if (nameInput) nameInput.focus();
  };

  const updateFormImagePreview = () => {
    const wrap = $('[data-role="form"]', el);
    const box = $('[data-role="img-preview"]', wrap);
    if (!box) return;
    box.classList.toggle('empty', !st.image);
    box.innerHTML = st.image
      ? `<img src="${esc(productImageUrl(st.image))}" alt="商品图片">`
      : '<span>暂无图片</span>';
    const removeBtn = $('[data-act="remove-image"]', wrap);
    if (removeBtn) removeBtn.classList.toggle('hidden', !st.image);
  };

  const closeForm = () => {
    st.editing = null;
    st.image = '';
    const wrap = $('[data-role="form"]', el);
    wrap.innerHTML = '';
    wrap.classList.add('hidden');
    const searchbar = $('.pm-searchbar', el);
    if (searchbar) searchbar.classList.remove('hidden');
    $('[data-role="browse"]', el).classList.remove('hidden');
    renderCats();
    renderGrid();
  };

  const saveForm = () => {
    const wrap = $('[data-role="form"]', el);
    const name = ($('[data-role="name"]', wrap).value || '').trim();
    if (!name) { toast('请填写商品名称', true); return; }
    const payload = { name };
    ['code', 'barcode', 'spec', 'unit', 'remark', 'category'].forEach(k => {
      const inp = $('[data-role="' + k + '"]', wrap);
      if (inp) payload[k] = inp.value.trim();
    });
    try {
      payload.price = readOptionalMoney($('[data-role="price"]', wrap), '商品单价');
      payload.cost = readOptionalMoney($('[data-role="cost"]', wrap), '成本价');
    } catch(error) { toast(error.message,true);return; }
    payload.image = st.image || '';
    if (st.editing !== 'new') payload.id = st.editing;
    try { Store.upsertProduct(payload); } catch(error) { toast(error.message || '保存失败',true);return; }
    el.dispatchEvent(new Event('dns-form-committed',{bubbles:true}));
    toast('已保存');
    closeForm();
  };

  renderCats();
  renderGrid();
  if (params && params.edit && (params.edit === 'new' || Store.getProduct(params.edit))) openForm(params.edit);

  el.addEventListener('click', async e => {
    const catBtn = e.target.closest('[data-cat]');
    if (catBtn) { st.category = catBtn.dataset.cat; renderCats(); renderGrid(); return; }

    const restore = e.target.closest('[data-restore]');
    if (restore) {
      try { Store.restoreProduct(restore.dataset.restore); } catch (error) { toast(error.message || '恢复失败', true); return; }
      toast('已恢复上架');
      renderGrid();
      return;
    }

    const del = e.target.closest('[data-del]');
    if (del) {
      const p = Store.getProduct(del.dataset.del);
      if (!p) return;
      const used = Store.productHasOrders(p.id);
      const ok = await confirmDialog({
        title: used ? '该商品有历史单据' : '删除商品？',
        text: used
          ? `${p.name} 已被历史送货单引用。删除只会把它「下架」：商品库不再显示，但历史单据和销售排行保留，可随时恢复上架。`
          : p.name,
        okText: used ? '下架' : '删除',
        cancelText: '取消',
        danger: true
      });
      if (!ok) return;
      let res;
      try { res = Store.deleteProduct(p.id); } catch (error) { toast(error.message || '操作失败', true); return; }
      if (res && res.archived) { toast('已下架，可在商品列表底部恢复上架'); renderGrid(); }
      else { toast('已删除'); removeRenderedCard(p.id); }
      return;
    }

    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'new') { openForm('new'); return; }
      if (a === 'form-cancel') { closeForm(); return; }
      if (a === 'form-save') { saveForm(); return; }
      if (a === 'pick-image') {
        const dest = Store.getSettings().imageDir || '';
        const picked = await pickProductImage(dest);
        if (picked) { st.image = picked; updateFormImagePreview(); }
        return;
      }
      if (a === 'remove-image') { st.image = ''; updateFormImagePreview(); return; }
    }

    const card = e.target.closest('.pm-card');
    if (card && card.dataset.id) { openForm(card.dataset.id); }
  });

  el.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest && e.target.closest('.pm-card');
    if (card && card.dataset.id && e.target === card) { e.preventDefault(); openForm(card.dataset.id); }
  });

  el.addEventListener('input', e => {
    if (!e.target.matches('[data-role="kw"]')) return;
    clearTimeout(kwTimer);
    kwTimer = setTimeout(() => { st.kw = e.target.value; renderGrid(); }, 180);
  });

  el.dispose = () => { clearTimeout(kwTimer); stopGridObserver(); };

  return el;
}

Views.products = { render(params) { return productCardView(params); } };
