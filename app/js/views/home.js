/* ============================================================
 * views/home.js — 工作台
 * ============================================================ */
'use strict';
window.Views = window.Views || {};

Views.home = {
  render() {
    const el = document.createElement('div');
    el.className = 'view active';
    const s = Store.getSettings();
    const today = todayStr();
    const [mFrom, mTo] = monthRange();
    const sum = (arr, fn) => arr.reduce((a, o) => a + (fn(o) || 0), 0);
    const todayOrders = Store.listOrders({ from: today, to: today });
    const todayAmt = sum(todayOrders, o => o.total);
    const monthOrders = Store.listOrders({ from: mFrom, to: mTo });
    const monthAmt = sum(monthOrders, o => o.total);
    const allOrders = Store.listOrders();
    const recent = allOrders.slice(0, 5);
    // 直接汇总本机已保存的单据；不同规格、单位分别统计，无需联网。
    const productSales = new Map();
    allOrders.forEach(o => (o.items || []).forEach(item => {
      if (!item) return;
      const name = String(item.name || '').trim();
      const spec = String(item.spec || '').trim();
      const unit = String(item.unit || '').trim();
      const qty = Number(item.qty);
      if (!name || !Number.isFinite(qty) || qty <= 0) return;
      const key = JSON.stringify([name, spec, unit]);
      if (!productSales.has(key)) productSales.set(key, { name, spec, unit, qty: 0 });
      productSales.get(key).qty += qty;
    }));
    const productRank = Array.from(productSales.values())
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'zh-CN'))
      .slice(0, 3);
    const cnt = Store.countAll();

    const greeting = (() => {
      const h = new Date().getHours();
      if (h < 6) return '夜深了';
      if (h < 9) return '早上好';
      if (h < 12) return '上午好';
      if (h < 14) return '中午好';
      if (h < 18) return '下午好';
      return '晚上好';
    })();
    const name = s.operator || '老板';

    el.innerHTML = `
      <div class="topbar">
        <h1>${esc(greeting)}，${esc(name)}</h1>
        <span class="sub">${esc(today)}</span>
      </div>
      <div class="pad" style="padding-top:4px">
        <div class="stat-cards${fmtMoney(todayAmt).length > 9 || fmtMoney(monthAmt).length > 9 ? ' home-summary-wide' : ''}">
          <div class="stat-card amber">
            <div class="sc-num">${todayOrders.length}</div>
            <div class="sc-lab">今日单据</div>
          </div>
          <div class="stat-card blue">
            <div class="sc-num">${numberHtml(todayAmt, { money: true, label: '今日金额', maxLength: 9 })}</div>
            <div class="sc-lab">今日金额</div>
          </div>
          <div class="stat-card red">
            <div class="sc-num">${numberHtml(monthAmt, { money: true, label: '本月金额', maxLength: 9 })}</div>
            <div class="sc-lab">本月金额</div>
          </div>
        </div>

        <button class="btn btn-primary btn-block" style="min-height:52px;font-size:16px;border-radius:14px;box-shadow:0 4px 14px rgba(217,154,43,.4)" data-go="order">
          开 送 货 单
        </button>

        <div class="section-title">商品销量排行 <span class="sales-rank-period">累计 · 前三</span></div>
        <section class="card sales-rank" aria-label="商品销量前三">
          ${productRank.length ? `
          <ol class="sales-rank-list">
            ${productRank.map((p, i) => `
              <li class="sales-rank-row">
                <span class="sales-rank-no" aria-hidden="true">${i + 1}</span>
                <div class="sales-rank-main">
                  <div class="sales-rank-name">${esc(p.name)}</div>
                  ${p.spec ? `<div class="sales-rank-spec">${esc(p.spec)}</div>` : ''}
                </div>
                <div class="sales-rank-qty">${numberHtml(p.qty, { label: p.name + '累计销量（' + (p.unit || '件') + '）', maxLength: 10 })}<span class="sales-rank-unit">${esc(p.unit || '件')}</span></div>
              </li>`).join('')}
          </ol>` : `
          <div class="empty sales-rank-empty">
            <div class="em-t">暂无销售数据</div>
            <div class="em-s">保存送货单后，自动显示销量前三的商品</div>
          </div>`}
        </section>

        <div class="section-title">基础资料</div>
        <div class="list">
          <div class="list-item" data-go="customers">
            <div class="li-main">
              <div class="li-title">客户管理</div>
              <div class="li-sub">维护客户名称、电话、地址</div>
            </div>
            <div class="li-end"><div class="num" style="font-size:13px;color:var(--muted)">${cnt.customers} 个</div></div>
            <span class="chevron"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
          </div>
          <div class="list-item" data-go="products">
            <div class="li-main">
              <div class="li-title">商品管理</div>
              <div class="li-sub">维护商品名称、规格、单价</div>
            </div>
            <div class="li-end"><div class="num" style="font-size:13px;color:var(--muted)">${cnt.products} 个</div></div>
            <span class="chevron"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
          </div>
        </div>

        <div class="section-title">最近单据 <span style="margin-left:auto;letter-spacing:0" data-go="orders" style="cursor:pointer">全部 ›</span></div>
        ${recent.length ? `
        <div class="list">
          ${recent.map(o => `
            <div class="list-item tri-strip" data-open="${o.id}">
              <div class="li-main">
                <div class="li-title">${esc((o.customer && o.customer.name) || '散客')}</div>
                <div class="li-sub">${esc(o.no)} · ${esc(o.date)}</div>
              </div>
              <div class="li-end">
                <div class="num">${numberHtml(o.total, { money: true, prefix: '¥', label: '单据金额' })}</div>
                <div class="cap">${numberHtml((o.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0), { suffix: ' 件', label: '单据数量' })}</div>
              </div>
              <span class="chevron"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></span>
            </div>`).join('')}
        </div>` : `
        <div class="card"><div class="empty" style="padding:30px 16px">
          <div class="em-t">还没有送货单</div>
          <div class="em-s">点上方「开送货单」开始录入第一张单</div>
        </div></div>`}
      </div>`;

    el.addEventListener('click', e => {
      const go = e.target.closest('[data-go]');
      if (go) { location.hash = '#/' + go.dataset.go; return; }
      const open = e.target.closest('[data-open]');
      if (open) { location.hash = '#/order/view?id=' + open.dataset.open; }
    });
    return el;
  }
};
