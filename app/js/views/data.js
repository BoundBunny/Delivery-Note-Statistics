/* ============================================================
 * views/data.js — 客户管理 / 商品管理
 * ============================================================ */
'use strict';
window.Views = window.Views || {};

function dataListView({ kind, title }) {
  // kind: 'customers' | 'products'
  const st = { kw: '', editing: null };
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
    groups.forEach(group => { if (group.getBoundingClientRect().top <= toolbarHeight + 18) current = group; });
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
    const top = window.scrollY + group.getBoundingClientRect().top - $('.customer-toolbar', el).getBoundingClientRect().height - 4;
    window.scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
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
          <div class="field"><label class="lab">备注</label><input data-role="remark" value="${esc(d ? d.remark : '')}"></div>
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
        : { t: item.name, s: [item.code, item.spec, item.unit].filter(Boolean).join(' · ') || '无规格', extra: item.price != null ? '¥' + fmtMoney(item.price) : '无价' };
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
          payload.price = isNaN(p) ? undefined : p;
          const c = parseFloat($('[data-role="cost"]', el).value);
          payload.cost = isNaN(c) ? undefined : c;
        }
        if (st.editing !== 'new') payload.id = st.editing;
        kind === 'customers' ? Store.upsertCustomer(payload) : Store.upsertProduct(payload);
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
      kind === 'customers' ? Store.deleteCustomer(target.id) : Store.deleteProduct(target.id);
      toast('已删除');
      render();
    } else if (doEdit === 'orders') {
      st.kw = target.name;
      const kwInput = $('[data-role="kw"]', el);
      if (kwInput) kwInput.value = target.name;
      Views.orders.state.kw = target.name;
      location.hash = '#/orders';
    }
  });

  el.addEventListener('input', e => {
    if (!e.target.matches('[data-role="kw"]')) return;
    clearTimeout(kwTimer);
    kwTimer = setTimeout(() => { st.kw = e.target.value; if (!st.editing) render(); }, 200);
  });

  let resizeObserver = null;
  if (isCustomers) {
    window.addEventListener('scroll', onScroll, { passive: true });
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
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', updateLayout);
  };

  return el;
}

Views.customers = { render() { return dataListView({ kind: 'customers', title: '客户管理' }); } };
Views.products = { render() { return dataListView({ kind: 'products', title: '商品管理' }); } };
