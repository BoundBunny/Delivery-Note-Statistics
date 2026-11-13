/* ============================================================
 * views/stats.js — 统计报表（汇总 / 趋势 / 客户排行 / 商品排行）
 * ============================================================ */
'use strict';
window.Views = window.Views || {};

// Sales overview and detailed daily sales chart, both with a zero baseline.
function salesTrendChart(rows, { compact = false } = {}) {
  const max = Math.max(0, ...rows.map(row => row.total));
  const power = Math.pow(10, Math.floor(Math.log10(max || 1)));
  const ceiling = ([1, 2, 5, 10].find(step => step * power >= max) || 10) * power;
  const tick = value => value >= 1e12 ? fmtNum(value / 1e12) + '万亿'
    : value >= 1e8 ? fmtNum(value / 1e8) + '亿'
    : value >= 1e4 ? fmtNum(value / 1e4) + '万' : fmtNum(value);
  const slot = compact ? 24 : Math.max(96, ...rows.map(row => fmtMoney(row.total).length * 7 + 16));
  const label = rows.map(row => row.day + '，销售额 ' + fmtMoney(row.total) + ' 元').join('；');
  return `<div class="sales-chart${compact ? ' sales-chart-compact' : rows.length === 1 ? ' sales-chart-single' : ''}" role="img" aria-label="${esc(label)}">
    <div class="sales-axis" aria-hidden="true"><span class="sales-unit">元</span><span class="sales-tick sales-tick-top">${tick(ceiling)}</span><span class="sales-tick sales-tick-mid">${tick(ceiling / 2)}</span><span class="sales-tick sales-tick-zero">0</span></div>
    <div class="sales-plot-window"><div class="bar-trend" style="--trend-count:${rows.length};--trend-slot:${slot}px">
      ${rows.map(row => `<div class="bt-col" title="${esc(row.day)} · 销售额 ¥${fmtMoney(row.total)}${row.count == null ? '' : ' · ' + row.count + ' 张单据'}">
        <div class="bt-plot"><div class="bt-bar${row.total > 0 ? ' bt-bar--nonzero' : ''}" style="height:${row.total / ceiling * 100}%"></div>${compact ? '' : `<span class="bt-value" style="bottom:calc(${row.total / ceiling * 100}% + 4px)">${fmtMoney(row.total)}</span>`}</div>
        <div class="bt-x">${row.day.slice(5).replace('-', '/')}</div>
      </div>`).join('')}
    </div></div>
  </div>`;
}

/* 月度账单辅助 */
function billTitleFor(customerName, ym, settings) {
  const s = settings || Store.getSettings();
  const tpl = s.billTitle || '{year}年{customer}与{company}{month}月账单';
  const y = ym.slice(0, 4), m = String(+ym.slice(5, 7));
  let out = tpl.replace(/\{year\}/g, y).replace(/\{month\}/g, m).replace(/\{customer\}/g, customerName);
  const comp = s.company || '';
  if (comp) out = out.replace(/\{company\}/g, comp);
  else out = out.replace(/与\{company\}/g, '').replace(/\{company\}/g, '');
  return out;
}
function billRowsOf(group) {
  const rows = [];
  group.orders.forEach(o => o.items.forEach(i => {
    rows.push([o.date, (i.name || '') + (i.spec ? ' ' + i.spec : ''), Number(i.qty) || 0, Number(i.price) || 0, i.amount || 0, i.remark || '']);
  }));
  return rows;
}
async function exportBillXlsx(ym, key, name) {
  if (!ensureExportable()) return;
  const g = Store.billGroups(ym).find(x => String(x.key) === String(key));
  if (!g) { toast('未找到账单', true); return; }
  const rows = billRowsOf(g);
  const total = Math.round(rows.reduce((a, r) => a + (r[4] || 0), 0) * 100) / 100;
  const bytes = Xlsx.build([{ name: name.slice(0, 31), title: billTitleFor(name, ym), headers: ['日期', '产品名称', '数量', '单价', '金额', '备注'], rows: rows, widths: [12, 26, 10, 10, 12, 20], footer: ['', '合计', '', '', total, ''] }]);
  if ((await downloadBlob('账单_' + name + '_' + ym + '.xlsx', xlsxBlob(bytes))).ok) toast('已导出 ' + name);
}
async function exportAllBills(ym) {
  if (!ensureExportable()) return;
  const groups = Store.billGroups(ym);
  if (!groups.length) { toast('该月暂无账单', true); return; }
  const sheets = groups.map(g => {
    const rows = billRowsOf(g);
    const total = Math.round(rows.reduce((a, r) => a + (r[4] || 0), 0) * 100) / 100;
    return { name: g.name.slice(0, 31), title: billTitleFor(g.name, ym), headers: ['日期', '产品名称', '数量', '单价', '金额', '备注'], rows: rows, widths: [12, 26, 10, 10, 12, 20], footer: ['', '合计', '', '', total, ''] };
  });
  if ((await downloadBlob('月度账单_' + ym + '.xlsx', xlsxBlob(Xlsx.build(sheets)))).ok) toast('已导出 ' + groups.length + ' 位客户账单');
}

Views.stats = {
  state: { range: 'month', from: '', to: '', billYm: '', prodShowAll: false },

  render() {
    const st = this.state;
    const today = todayStr();
    const [wFrom, wTo] = weekRange();
    const [mFrom, mTo] = monthRange();
    const yFrom = today.slice(0, 4) + '-01-01';
    const ranges = {
      today: ['今日', today, today],
      week: ['本周', wFrom, wTo],
      month: ['本月', mFrom, mTo],
      year: ['本年', yFrom, today],
      custom: ['自定义', st.from, st.to],
    };
    if (st.range !== 'custom' || !st.from) {
      st.from = ranges[st.range][1]; st.to = ranges[st.range][2];
    }

    const el = document.createElement('div');
    el.className = 'view active';
    let chartObserver = null;

    const compute = () => {
      const list = Store.listOrders({ from: st.from || undefined, to: st.to || undefined });
      const orders = list.length;
      const qtySum = sumQuantities(list.flatMap(o => o.items.map(i => i.qty)));
      const total = Math.round(list.reduce((a, o) => a + (o.total || 0), 0) * 100) / 100;
      const custSet = new Set(list.filter(o => o.customer && o.customer.id).map(o => o.customer.id));
      // 按日趋势
      const dayMap = Object.create(null);
      const dayCounts = Object.create(null), dayCents = Object.create(null);
      list.forEach(o => { dayCents[o.date] = (dayCents[o.date] || 0) + Math.round((o.total || 0) * 100); dayCounts[o.date] = (dayCounts[o.date] || 0) + 1; });
      Object.keys(dayCents).forEach(day => { dayMap[day] = dayCents[day] / 100; });
      // 客户排行
      const custMap = Object.create(null);
      list.forEach(o => {
        const name = o.customer?.name || '散客';
        const key = o.customer?.id || ('name:' + name);
        if (!custMap[key]) custMap[key] = {name,total:0};
        custMap[key].total += o.total || 0;
      });
      // 商品排行：按商品 id（无 id 时按名称+规格+单位）归并，保留规格/单位/图片/销量，
      // 让老板能看清「是哪个商品、哪个规格」，并带缩略图（图片来自商品库，随初始目录内置）。
      const prods = (typeof Store.listProducts === 'function' ? Store.listProducts('', { includeArchived: true }) : []) || [];
      const normP = v => String(v == null ? '' : v).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
      const pidMap = new Map();
      const nameSpecMap = new Map();
      prods.forEach(p => {
        if (!p) return;
        if (p.id != null) pidMap.set(p.id, p);
        nameSpecMap.set(normP(p.name) + '\u0000' + normP(p.spec), p);
      });
      const prodMap = Object.create(null);
      list.forEach(o => o.items.forEach(i => {
        const pid = i.pid || '';
        const key = pid || ('manual:' + normP(i.name) + '\u0000' + normP(i.spec || '') + '\u0000' + normP(i.unit || ''));
        let row = prodMap[key];
        if (!row) {
          const p = pid ? pidMap.get(pid) : nameSpecMap.get(normP(i.name) + '\u0000' + normP(i.spec || ''));
          row = prodMap[key] = {
            name: (p && p.name) || i.name || '',
            spec: (p && p.spec) || i.spec || '',
            unit: (p && p.unit) || i.unit || '',
            image: (p && p.image) || '',
            archived: (p && !!p.archived) || (!!pid && !p),
            total: 0, qty: 0, count: 0,
          };
        }
        row.total += i.amount || 0;
        row.qty = sumQuantities([row.qty, i.qty]);
        row.count += 1;
      }));
      const custRank = Object.values(custMap).map(row=>[row.name,row.total]).sort((a, b) => b[1] - a[1]).slice(0, 8);
      const prodAll = Object.values(prodMap).sort((a, b) => b.total - a.total || b.qty - a.qty);
      const salesDays = Object.keys(dayMap).sort();
      return { orders, qtySum, total, customers: custSet.size, dayMap, dayCounts, salesDays, custRank, prodAll };
    };

    const render = () => {
      if(!validDateRange(st.from,st.to)){
        chartObserver?.disconnect();
        for(const key of ['trend','custRank','prodRank'])$('[data-role="'+key+'"]',el).textContent='日期范围无效，请修正后查询';
        for(const key of ['c1','c2','c3','c4'])$('[data-role="'+key+'"]',el).textContent='—';
        $('[data-role="range"]',el).textContent='日期范围无效';return;
      }
      const d = compute();
      const trendHtml = d.salesDays.length
        ? salesTrendChart(d.salesDays.map(day => ({ day, total: d.dayMap[day], count: d.dayCounts[day] })))
          + `<div class="trend-totals"><span>区间合计 <b>¥${fmtMoney(d.total)}</b></span><span>共 ${fmtNum(d.orders)} 张单据</span></div>`
        : '<div class="trend-empty">该时间段没有送货单，暂无销售趋势。</div>';

      const rankHtml = (rank, cls) => {
        if (!rank.length) return `<div class="empty" style="padding:22px 0"><div class="em-s">暂无数据</div></div>`;
        const max = rank[0][1] || 1;
        return `<div class="hbar">${rank.map(([name, v]) => `
          <div class="hb-row ${cls}">
            <div class="hb-name" title="${esc(name)}">${esc(name)}</div>
            <div class="hb-track"><div class="hb-fill" style="width:${Math.max(2, Math.round(v / max * 100))}%"></div></div>
            <div class="hb-num">${numberHtml(v, { money: true, label: name + '销售额', maxLength: 9 })}</div>
          </div>`).join('')}</div>`;
      };

      // 商品销售排行：缩略图 + 完整商品名（可两行）+ 规格/单位/销量 + 销售额 + 进度条 + 名次
      const prodRankHtml = rows => {
        if (!rows.length) return `<div class="empty" style="padding:22px 0"><div class="em-s">暂无商品销售数据</div></div>`;
        const max = rows[0].total || 1;
        const shown = st.prodShowAll ? rows : rows.slice(0, 10);
        const listHtml = shown.map((r, idx) => {
          const name = r.name || '未命名商品';
          const meta = [];
          if (r.spec) meta.push('规格 ' + r.spec);
          if (r.unit) meta.push('单位 ' + r.unit);
          if (r.qty) meta.push('销量 ' + fmtNum(r.qty) + (r.unit ? r.unit : ''));
          return `
          <div class="pr-row">
            <div class="pr-rank${idx < 3 ? ' pr-rank--top' : ''}">${idx + 1}</div>
            <div class="pr-thumbwrap">
              <span class="pr-thumb pr-thumb--ph" aria-hidden="true">${esc(name.slice(0, 1))}</span>
              ${r.image ? `<img class="pr-thumb pr-thumb--img" src="${esc(productImageUrl(r.image))}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}
            </div>
            <div class="pr-main">
              <div class="pr-title" title="${esc(name)}">${esc(name)}${r.archived ? ' <span class="pr-badge pr-badge--off">已下架</span>' : ''}</div>
              <div class="pr-meta">${esc(meta.join(' · ') || '无规格')}</div>
              <div class="pr-track"><div class="pr-fill" style="width:${Math.max(2, Math.round(r.total / max * 100))}%"></div></div>
            </div>
            <div class="pr-amount">${numberHtml(r.total, { money: true, prefix: '¥', label: name + '销售额', maxLength: 10 })}</div>
          </div>`;
        }).join('');
        const more = rows.length > 10
          ? `<button class="btn btn-ghost btn-sm pr-more" data-act="prod-more">${st.prodShowAll ? '收起' : '查看全部 ' + rows.length + ' 项'}</button>`
          : '';
        return `<div class="prodrk">${listHtml}${more}</div>`;
      };

      const oldPlot = $('[data-role="trend"] .sales-plot-window', el);
      const oldScroll = oldPlot?.scrollLeft || 0;
      const oldDates = oldPlot?.querySelector('.bar-trend')?.dataset.dates || '';
      const oldAtEnd = !oldPlot || oldPlot.scrollWidth - oldPlot.clientWidth - oldScroll < 2;
      chartObserver?.disconnect();
      $('[data-role="trend"]', el).innerHTML = trendHtml;
      const plot = $('[data-role="trend"] .sales-plot-window', el);
      if (plot) {
        const dates = d.salesDays.join('|');
        plot.querySelector('.bar-trend').dataset.dates = dates;
        let followLatest = dates !== oldDates || oldAtEnd;
        let lastWidth = 0;
        const observer = new ResizeObserver(() => {
          if (!plot.isConnected) return;
          lastWidth = plot.clientWidth;
          if (followLatest) plot.scrollLeft = plot.scrollWidth;
        });
        chartObserver = observer;
        plot.addEventListener('scroll', () => {
          if (plot.clientWidth === lastWidth) followLatest = plot.scrollWidth - plot.clientWidth - plot.scrollLeft < 2;
        }, { passive: true });
        requestAnimationFrame(() => {
          if (!plot.isConnected) return;
          plot.scrollLeft = followLatest ? plot.scrollWidth : oldScroll;
          lastWidth = plot.clientWidth;
          observer.observe(plot);
        });
      }
      $('[data-role="custRank"]', el).innerHTML = rankHtml(d.custRank, '');
      $('[data-role="prodRank"]', el).innerHTML = prodRankHtml(d.prodAll);
      $('[data-role="c1"]', el).textContent = d.orders;
      $('[data-role="c2"]', el).innerHTML = numberHtml(d.qtySum, { label: '销售件数', maxLength: 9 });
      $('[data-role="c3"]', el).innerHTML = numberHtml(d.total, { money: true, prefix: '¥', label: '销售额' });
      $('[data-role="c4"]', el).textContent = d.customers;
      $('[data-role="range"]', el).textContent = (st.from || '全部') + ' 至 ' + (st.to || '全部');
      const ym = st.billYm || todayStr().slice(0, 7);
      $('[data-role="billYm"]', el).value = ym;
      const groups = Store.billGroups(ym);
      $('[data-role="billList"]', el).innerHTML = groups.length ? groups.map(g => `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 2px;border-bottom:1px dashed var(--line)">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:14px">${esc(g.name)}</div>
            <div style="font-size:11px;color:var(--muted)">${g.orders.length} 单 · ${numberHtml(g.total, { money: true, label: g.name + '月度账单金额', maxLength: 10 })}</div>
          </div>
          <button class="btn btn-ghost btn-sm" data-bill-key="${esc(g.key)}" data-bill-name="${esc(g.name)}" data-bill-go="1">预览</button>
          <button class="btn btn-ghost btn-sm" data-bill-key="${esc(g.key)}" data-bill-name="${esc(g.name)}" data-bill-x="1">Excel</button>
        </div>`).join('')
        : `<div class="empty" style="padding:22px 0"><div class="em-s">${ym} 暂无账单数据</div></div>`;
    };

    el.innerHTML = `
      <div class="topbar">
        <h1>数据统计</h1>
        <button class="icbtn" data-act="export"><svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg></button>
      </div>
      <div class="seg">
        ${Object.keys(ranges).map(r => `<button data-range="${r}" class="${st.range === r ? 'on' : ''}">${ranges[r][0]}</button>`).join('')}
      </div>
      <div class="${st.range === 'custom' ? '' : 'hidden'}" data-role="custom" style="display:flex;gap:8px;margin:0 16px 10px;align-items:center">
        <input type="date" data-role="from" value="${esc(st.from)}">
        <span style="color:var(--muted)">至</span>
        <input type="date" data-role="to" value="${esc(st.to)}">
      </div>
      <div style="margin:0 16px 10px;font-size:12px;color:var(--muted)" data-role="range"></div>
      <div class="stat-cards stats-summary">
        <div class="stat-card amber"><div class="sc-num" data-role="c1">0</div><div class="sc-lab">单据数</div></div>
        <div class="stat-card blue"><div class="sc-num" data-role="c2">0</div><div class="sc-lab">件数</div></div>
        <div class="stat-card red"><div class="sc-num" data-role="c3">¥0</div><div class="sc-lab">销售额</div></div>
        <div class="stat-card"><div class="sc-num" data-role="c4">0</div><div class="sc-lab">客户数</div></div>
      </div>
      <div class="chart-card"><h3>销售趋势</h3><div data-role="trend"></div></div>
      <div class="chart-card"><h3>客户销售排行</h3><div data-role="custRank"></div></div>
      <div class="chart-card"><h3>商品销售排行</h3><div data-role="prodRank"></div></div>
      <div class="chart-card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px">
          <h3 style="margin:0">月度账单</h3>
          <div style="display:flex;align-items:center;gap:6px">
            <input type="month" data-role="billYm" style="padding:6px 8px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff;color:var(--text)">
            <button class="btn btn-ghost btn-sm" data-act="bill-all">全部导出</button>
          </div>
        </div>
        <div data-role="billList"></div>
        <div class="hint" style="padding:8px 2px 0;font-size:11px;color:var(--muted)">账单标题可在「设置 → 公司/店铺信息」里修改，年份、月份和客户名称会自动填写。</div>
      </div>
      <div style="height:8px"></div>`;

    render();

    el.addEventListener('click', async e => {
      const rangeBtn = e.target.closest('[data-range]');
      if (rangeBtn) {
        st.range = rangeBtn.dataset.range;
        if (st.range === 'custom') {
          $('[data-role="custom"]', el).classList.remove('hidden');
        } else {
          $('[data-role="custom"]', el).classList.add('hidden');
          const r = ranges[st.range];
          st.from = r[1]; st.to = r[2];
          $('[data-role="from"]', el).value = st.from;
          $('[data-role="to"]', el).value = st.to;
        }
        $$('[data-range]', el).forEach(b => b.classList.toggle('on', b === rangeBtn));
        render();
        return;
      }
      const billBtn = e.target.closest('[data-bill-key]');
      if (billBtn) {
        const ym = st.billYm || todayStr().slice(0, 7);
        const key = billBtn.dataset.billKey;
        const name = billBtn.dataset.billName;
        if (billBtn.dataset.billGo) location.hash = '#/bill?m=' + ym + '&c=' + encodeURIComponent(key) + '&n=' + encodeURIComponent(name);
        else if (billBtn.dataset.billX) exportBillXlsx(ym, key, name);
        return;
      }
      if (e.target.closest('[data-act="bill-all"]')) { exportAllBills(st.billYm || todayStr().slice(0, 7)); return; }
      if (e.target.closest('[data-act="prod-more"]')) { st.prodShowAll = !st.prodShowAll; render(); return; }
      if (e.target.closest('[data-act="export"]')) {
        if (!ensureExportable()) return;
        if(!validDateRange(st.from,st.to))return;
        const csv = Store.ordersCSV({ from: st.from || undefined, to: st.to || undefined });
        if ((await downloadBlob('销售统计_' + (st.from || '全部') + '.csv', new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }))).ok) toast('已导出 CSV');
      }
    });
    el.addEventListener('change', e => {
      if (e.target.matches('[data-role="from"]')) { st.from = e.target.value; render(); }
      if (e.target.matches('[data-role="to"]')) { st.to = e.target.value; render(); }
      if (e.target.matches('[data-role="billYm"]')) { st.billYm = e.target.value; render(); }
    });

    el.dispose = () => chartObserver?.disconnect();
    return el;
  }
};
