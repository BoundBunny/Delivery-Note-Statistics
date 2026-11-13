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
    // 关联商品库，取商品图片用于缩略图展示（无图则用占位图标）
    productRank.forEach(p => {
      const list = Store.listProducts(p.name);
      const match = list.find(x => x.name === p.name && (x.spec || '') === p.spec) || list.find(x => x.name === p.name);
      p.image = match && match.image ? match.image : '';
    });
    const crown = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 7 5 3 4-7 4 7 5-3-2 12H5L3 7zm3 14h12" fill="currentColor"/></svg>';
    const BOX_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5v-7Z"/><path d="M3 8.5 12 13l9-4.5"/><path d="M12 13v8"/></svg>';
    const productThumb = product => {
      const hasImg = product && product.image;
      return `<span class="podium-thumb">
        ${hasImg ? `<img class="podium-thumb-img" src="${esc(productImageUrl(product.image))}" alt="${esc(product.name)}" loading="lazy" onerror="this.style.display='none';var f=this.parentElement.querySelector('.podium-thumb-fallback');if(f)f.style.display='flex';">` : ''}
        <span class="podium-thumb-fallback"${hasImg ? ' style="display:none"' : ''}>${BOX_ICON}</span>
      </span>`;
    };
    const podiumItem = rank => {
      const product = productRank[rank - 1];
      const place = ['冠军', '亚军', '季军'][rank - 1];
      const specText = product ? [String(product.spec || '').trim(), String(product.unit || '').trim()].filter(Boolean).join('') : '';
      const identity = product ? `
        <button type="button" class="podium-info" data-podium-product="${rank}" aria-label="第${rank}名，${esc(product.name)}${specText ? '，' + esc(specText) : ''}，查看完整商品信息">
          ${productThumb(product)}
          <span class="podium-product-name" title="${esc(product.name)}">${esc(product.name)}</span>
          <span class="podium-product-spec" title="${esc(specText)}">${esc(specText || '—')}</span>
        </button>` : `
        <div class="podium-info">
          ${productThumb(null)}
          <span class="podium-product-name">虚位以待</span>
          <span class="podium-product-spec">暂无上榜商品</span>
        </div>`;
      return `<li class="podium-place podium-place-${rank}${product ? '' : ' podium-place-empty'}"${product ? ' data-product-rank="' + rank + '"' : ''} value="${rank}" aria-label="第${rank}名${product ? '' : '，暂无上榜商品'}">
        ${identity}
        <div class="podium-product-qty">${product ? numberHtml(product.qty, { label: product.name + '累计销量', maxLength: 8 }) : '<span class="podium-pending-qty">—</span>'}</div>
        <div class="podium-spacer" aria-hidden="true"></div>
        <div class="podium-stage" aria-hidden="true">${crown}<span class="podium-place-number">${rank}</span><span class="podium-place-label">${place}</span></div>
      </li>`;
    };

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
    // 各分类商品数（口径与商品管理一致；bg3d.js 提供，缺失时按 0 显示）
    const catCounts = (typeof window.DNSCatCounts === 'function') ? (window.DNSCatCounts() || {}) : {};
    const catN = k => {
      const n = Number(catCounts[k]) || 0;
      return `<span class="hs-chip-n${n ? '' : ' zero'}" data-cat-n="${k}">${n}</span>`;
    };

    el.innerHTML = `
      <div class="topbar">
        <img class="brand-icon" src="assets/brand/dns-icon.svg" width="32" height="32" alt="DNS 送货单统计">
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

        <button class="btn btn-primary btn-block home-create-order" data-go="order">
          开 送 货 单
        </button>

        <section class="home-stage" id="home-stage" aria-label="仓库沙盘">
          <div class="hs-view" id="hs-view">
            <div class="hs-kpi" id="hs-kpi" aria-label="沙盘实时指标">
              <div class="hs-kpi-item"><b id="hs-kpi-orders">—</b><span>今日单据</span></div>
              <div class="hs-kpi-item"><b id="hs-kpi-amount">—</b><span>今日金额</span></div>
              <div class="hs-kpi-item"><b id="hs-kpi-month">—</b><span>本月单据</span></div>
              <div class="hs-kpi-item"><b id="hs-kpi-customers">—</b><span>客户总数</span></div>
            </div>
            <div class="hs-tip" id="hs-tip" aria-hidden="true"></div>
          </div>
          <aside class="hs-side">
            <div class="hs-side-title">商品 6 大分类</div>
            <div class="hs-chips" id="hs-chips">
              <button type="button" class="hs-chip" data-go="products?cat=snack"><i style="background:#D97706"></i>休闲零食类${catN('snack')}</button>
              <button type="button" class="hs-chip" data-go="products?cat=drink"><i style="background:#2563EB"></i>酒水饮料类${catN('drink')}</button>
              <button type="button" class="hs-chip" data-go="products?cat=candy"><i style="background:#DB2777"></i>糖果巧克力类${catN('candy')}</button>
              <button type="button" class="hs-chip" data-go="products?cat=grain"><i style="background:#059669"></i>粮油副食类${catN('grain')}</button>
              <button type="button" class="hs-chip" data-go="products?cat=daily"><i style="background:#4F46E5"></i>日用百货类${catN('daily')}</button>
              <button type="button" class="hs-chip" data-go="products?cat=tobacco"><i style="background:#7C3AED"></i>香烟烟草类${catN('tobacco')}</button>
            </div>
            <div class="hs-mods" id="hs-mods">
              <button type="button" class="hs-mod" data-go="order" data-module="order">开单</button>
              <button type="button" class="hs-mod" data-go="orders" data-module="orders">单据</button>
              <button type="button" class="hs-mod" data-go="customers" data-module="customers">客户</button>
              <button type="button" class="hs-mod" data-go="stats" data-module="stats">统计</button>
            </div>
            <div class="hs-side-tip">车辆与托盘仅作场景示意</div>
          </aside>
        </section>

        <div class="section-title">商品销量排行 <span class="sales-rank-period">累计 · 前三</span></div>
        <section class="card sales-rank" aria-label="商品销量前三">
          ${productRank.length ? `
          <ol class="sales-podium" role="list" aria-label="按累计销售数量排名，冠军居中">
            ${[1, 2, 3].map(podiumItem).join('')}
          </ol>` : `
          <div class="empty sales-rank-empty">
            <span class="podium-empty-crown" aria-hidden="true">${crown}</span>
            <div class="em-t">暂无销售数据</div>
            <div class="em-s">保存送货单后，自动显示销量前三的商品</div>
          </div>`}
        </section>

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
      const podiumProduct = e.target.closest('[data-podium-product]');
      if (podiumProduct) {
        const rank = Number(podiumProduct.dataset.podiumProduct);
        const product = productRank[rank - 1];
        if (!product) return;
        const quantity = Number.isFinite(product.qty) ? product.qty.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '数值超出范围';
        openSheet(`<div class="podium-product-detail">
          <div class="podium-detail-rank">销量第 ${rank} 名 · 累计销售数量</div>
          <div class="podium-detail-name">${esc(product.name)}</div>
          ${product.spec ? `<div class="podium-detail-spec">规格：${esc(product.spec)}</div>` : ''}
          <div class="podium-detail-qty">${esc(quantity)} <span>${esc(product.unit || '件')}</span></div>
        </div>`, '上榜商品');
        return;
      }
      const go = e.target.closest('[data-go]');
      if (go) { location.hash = '#/' + go.dataset.go; return; }
      const open = e.target.closest('[data-open]');
      if (open) { location.hash = '#/order/view?id=' + open.dataset.open; }
    });
    return el;
  }
};
