/* ============================================================
 * bg3d.js — 工作台「沙盘卡片」3D 模块（P5）
 * ------------------------------------------------------------
 * - 3D 不再整页铺底，而是挂在首页的 .home-stage 卡片里：
 *   位置固定、尺寸固定、不改变任何既有布局，文字零干扰。
 * - 场景用「容器模式」渲染：相机视锥、拾取坐标都按卡片自身尺寸算。
 * - 双向导航：
 *     · 点 3D 里的分类货架 → 跳 #/products?cat=xxx（商品管理已按分类筛选）
 *     · 点卡片里的分类芯片 → 同样的跳转
 *     · 鼠标移到 3D 分类上 → 对应芯片高亮
 * - 开关：设置 → 「3D 工作台沙盘」（localStorage: sd_v1_bg3d），默认关闭。
 * - 兜底：WebGL 不可用 / 脚本加载失败 → 卡片保留渐变底与分类芯片，不影响任何功能。
 * ============================================================ */
'use strict';

(function () {
  if (window.Android && window.Android.isDesktop) return;
  var KEY = 'sd_v1_bg3d';
  var q = new URLSearchParams(location.search);
  var force = q.get('bg3d');

  var api = null, canvas = null, stageEl = null, viewEl = null, loading = false;
  var routeTimer = null, lowFpsSamples = 0, lastDataKey = null;
  var st = { state: 'idle', reason: '', fps: 0, tier: '', dpr: 0, maxfps: 0, level: 0 };

  /* ---------- 开关 ---------- */
  function enabled() {
    if (force === '0') return false;
    if (force === '1') return true;
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }

  /* ---------- 分类芯片：鼠标移到 3D 分类上时高亮 ---------- */
  var CATS = {
    snack: { label: '休闲零食', accent: '#D97706' },
    drink: { label: '酒水饮料', accent: '#2563EB' },
    candy: { label: '糖果巧克力', accent: '#DB2777' },
    grain: { label: '粮油副食', accent: '#059669' },
    daily: { label: '日用百货', accent: '#4F46E5' },
    tobacco: { label: '香烟烟草', accent: '#7C3AED' }
  };

  /* ---------- 分类商品数（口径与商品管理完全一致） ----------
   * 6 个分类键 + 旧版本分类键兼容；没有分类的商品不计入任何一个分类。
   * 暴露成 window.DNSCatCounts，供工作台渲染芯片上的数量。 */
  var CAT_KEYS = ['snack', 'drink', 'candy', 'grain', 'daily', 'tobacco'];
  var LEGACY_CAT = { wine: 'drink', drink: 'drink', snack: 'snack', other: 'daily' };
  function catOfProduct(p) {
    var raw = String((p && p.category) || '').trim();
    if (!raw) return '';
    if (CAT_KEYS.indexOf(raw) >= 0) return raw;
    if (LEGACY_CAT[raw]) return LEGACY_CAT[raw];
    return '';
  }
  function catCounts() {
    var counts = {};
    CAT_KEYS.forEach(function (k) { counts[k] = 0; });
    try {
      if (typeof Store === 'undefined' || !Store.listProducts) return counts;
      Store.listProducts().forEach(function (p) {
        var c = catOfProduct(p);
        if (c) counts[c]++;
      });
    } catch (e) { /* 数据异常不拖垮卡片 */ }
    return counts;
  }
  window.DNSCatCounts = catCounts;

  function refreshCounts() {
    var counts = catCounts();
    document.querySelectorAll('[data-cat-n]').forEach(function (el) {
      var k = el.getAttribute('data-cat-n');
      if (!(k in counts)) return;
      var n = counts[k];
      el.textContent = n > 0 ? String(n) : '0';
      el.classList.toggle('zero', n === 0);
    });
    return counts;
  }

  /* ---------- 实时指标：仅展示实际业务记录，不把场景动画当成物流状态 ---------- */
  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function moneyTxt(v) {
    var n = Number(v) || 0;
    var s = '';
    try {
      if (typeof fmtMoney === 'function') s = fmtMoney(n);
    } catch (e) { /* ignore */ }
    if (!s) s = n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (!/[¥￥]/.test(s)) s = '¥' + s;   // fmtMoney 不带货币符号，这里补上
    return s;
  }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function updateKpi() {
    if (!api || !api.state) return;
    var s = api.state;
    setText('hs-kpi-orders', (s.orders || 0) + ' 单');
    setText('hs-kpi-amount', moneyTxt(s.todayAmount));
    setText('hs-kpi-month', (s.monthOrders || 0) + ' 单');
    setText('hs-kpi-customers', (s.customers || 0) + ' 位');
  }
  // 3D 不可用时（WebGL 失败 / 脚本没加载）也能显示指标
  function updateKpiFromStore() {
    if (api && api.state) { updateKpi(); return; }
    if (typeof Store === 'undefined' || !Store.listOrders) return;
    try {
      var t = todayStr();
      var list = Store.listOrders({ from: t, to: t }) || [];
      var amt = list.reduce(function (a, o) { return a + (Number(o.total) || 0); }, 0);
      setText('hs-kpi-orders', list.length + ' 单');
      setText('hs-kpi-amount', moneyTxt(amt));
      var month = t.slice(0, 7);
      setText('hs-kpi-month', Store.listOrders({ from: month + '-01', to: month + '-31' }).length + ' 单');
      setText('hs-kpi-customers', Store.listCustomers().length + ' 位');
    } catch (e) { /* ignore */ }
  }

  function chipsOf(root) {
    return root ? Array.prototype.slice.call(root.querySelectorAll('.hs-chip')) : [];
  }
  function chipCat(chip) {
    var m = /cat=([a-z]+)/i.exec(chip.getAttribute('data-go') || '');
    return m ? m[1] : '';
  }
  function highlightCat(cat) {
    chipsOf(document).forEach(function (chip) {
      chip.classList.toggle('hot', !!cat && chipCat(chip) === cat);
    });
  }

  /* ---------- 功能按钮：鼠标移到 3D 模块上时高亮 ---------- */
  function highlightModule(mod) {
    document.querySelectorAll('.hs-mod').forEach(function (btn) {
      btn.classList.toggle('hot', !!mod && btn.getAttribute('data-module') === mod);
    });
  }

  /* ---------- 悬停提示：告诉用户点下去会去哪 ---------- */
  function showTip(d) {
    var el = document.getElementById('hs-tip');
    if (!el) return;
    if (!d || !d.name) { el.classList.remove('on'); el.textContent = ''; return; }
    el.textContent = d.name + ' · 点击进入';
    el.classList.add('on');
  }

  /* ---------- 点击 3D → 跳到对应功能模块 ---------- */
  function routeFor(data) {
    if (!data) return;
    if (data.cat && CATS[data.cat]) { location.hash = '#/products?cat=' + data.cat; return; }
    var map = {
      products: '#/products', orders: '#/orders', customers: '#/customers',
      stats: '#/stats', order: '#/order/new'
    };
    if (map[data.module]) location.hash = map[data.module];
  }

  /* ---------- 场景参数替身（scene.js 需要可读可写） ---------- */
  function makeParams(dpr, maxfps) {
    var p = { dpr: dpr, maxfps: maxfps };
    return {
      get: function (k) { return p[k] == null ? null : String(p[k]); },
      set: function (k, v) { p[k] = v; }
    };
  }

  /* ---------- 样式 ---------- */
  function injectStyle() {
    if (document.getElementById('bg3d-style')) return;
    var el = document.createElement('style');
    el.id = 'bg3d-style';
    el.textContent = [
      '.home-stage .hs-view canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:pointer}',
      '.home-stage .hs-hint{position:absolute;right:12px;top:12px;font-size:11px;color:var(--muted);',
      'background:rgba(255,255,255,.8);border-radius:999px;padding:4px 9px;pointer-events:none}',
      '.home-stage .hs-hint.on{background:#4F46E5;color:#fff}'
    ].join('');
    document.head.appendChild(el);
  }

  /* ---------- 脚本加载（只加载一次） ---------- */
  function loadScript(src, onOk, onErr) {
    var s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = function () { onOk(); };
    s.onerror = function () { if (onErr) onErr(); };
    document.head.appendChild(s);
  }

  function ensureScene(onReady) {
    if (api) { onReady(); return; }
    if (loading) return;
    loading = true;
    st.state = 'loading';
    loadScript('3d/vendor/three.min.js', function () {
      if (!window.THREE) { fail('three-missing'); return; }
      window.__dnsSceneOpts = {
        canvas: canvas,
        params: makeParams(1.25, 30),
        stage: true,          // 容器模式
        onPick: routeFor     // 点 3D → 跳功能模块
      };
      window.__dnsSceneOnReady = function (a) {
        api = a; loading = false;
        st.state = 'ready'; st.reason = '';
        onReady();
      };
      loadScript('3d/scene.js', function () {
        if (!api) setTimeout(function () { if (!api) fail('scene-error'); }, 600);
      }, function () { fail('scene-load-failed'); });
    }, function () { fail('three-load-failed'); });
  }

  function fail(reason) {
    loading = false;
    st.state = 'fallback';
    st.reason = reason;
    showHint('沙盘不可用（' + reason + '）');
    updateKpiFromStore();
    refreshCounts();
  }

  /* ---------- 提示条 ---------- */
  function showHint(text) {
    if (!viewEl) return;
    var hint = viewEl.querySelector('.hs-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'hs-hint';
      viewEl.appendChild(hint);
    }
    hint.textContent = text;
    hint.classList.add('on');
  }
  function clearHint() {
    if (!viewEl) return;
    var hint = viewEl.querySelector('.hs-hint');
    if (hint) hint.remove();
  }

  /* ---------- 挂载 / 卸载 ---------- */
  function mount() {
    if (!enabled()) { unmount(); return; }
    if (window.innerWidth < 900) { unmount(); return; }
    viewEl = document.getElementById('hs-view');
    stageEl = document.getElementById('home-stage');
    if (!viewEl) { unmount(); return; }
    injectStyle();
    document.body.classList.add('bg3d-on');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'bg3d-canvas';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', '仓库沙盘示意图。可使用右侧分类与功能按钮进入相同页面。');
      canvas.title = '点击货架、货车或门店进入对应页面';
    }
    if (canvas.parentElement !== viewEl) viewEl.appendChild(canvas);
    canvas.style.display = 'block';
    updateKpiFromStore();
    refreshCounts();
    if (api) {
      st.state = 'ready'; st.reason = '';
      try { api.resume && api.resume(); } catch (e) {}
      bindHover(); pushData(); startTimers(); clearHint();
      return;
    }
    // Re-check route, switch and viewport after asynchronous script loading.
    ensureScene(mount);
  }

  function unmount() {
    document.body.classList.remove('bg3d-on');
    stopTimers();
    if (canvas && canvas.parentElement) canvas.parentElement.removeChild(canvas);
    if (api) { try { api.pause && api.pause(); } catch (e) {} }
    st.fps = 0;
    st.reason = enabled() && window.innerWidth < 900 ? 'narrow' : '';
    st.state = enabled() ? 'skip' : 'off';
    highlightCat(''); highlightModule(''); showTip(null);
  }

  function bindHover() {
    if (!canvas || canvas.__bound) return;
    canvas.__bound = true;
    canvas.addEventListener('pointermove', function () {
      if (!api || !api.hovered) return;
      var d = api.hovered();
      highlightCat(d && d.cat);
      highlightModule(d && d.module);
      showTip(d);
    });
    canvas.addEventListener('pointerleave', function () {
      highlightCat(''); highlightModule(''); showTip(null);
    });
  }

  /* ---------- 数据同步 ---------- */
  function pushData(force) {
    if (!api || typeof Store === 'undefined') return;
    try {
      if (api.state) api.state.source = '工作台 Store';
      var orders = Store.listOrders(), customers = Store.listCustomers();
      var dataKey = JSON.stringify([orders, customers]);
      if (force === true || dataKey !== lastDataKey) {
        api.computeFromData(orders, customers);
        lastDataKey = dataKey;
      }
    } catch (e) { /* 数据异常不拖垮场景 */ }
    updateKpi();
    refreshCounts();
  }

  /* ---------- 定时器 ---------- */
  var timer = null, probe = null;
  function startTimers() {
    stopTimers();
    timer = setInterval(pushData, 12000);
    probe = setInterval(tickProbe, 2000);
  }
  function stopTimers() {
    if (timer) { clearInterval(timer); timer = null; }
    if (probe) { clearInterval(probe); probe = null; }
  }

  /* ---------- FPS 探针 + 自动降级 ---------- */
  function tickProbe() {
    if (!api || !api.stats) return;
    var s = api.stats();
    st.fps = s.fps || 0; st.dpr = s.dpr || 0; st.maxfps = s.maxfps || 0;
    if (s.reducedMotion) return;
    if (document.hidden) return;
    if (st.fps <= 0) return;
    if (st.fps >= (st.maxfps || 30) * 0.72) { lowFpsSamples = 0; return; }
    if (++lowFpsSamples < 3 || st.level >= 3) return;
    lowFpsSamples = 0;
    st.level++;
    var dpr = [1.25, 1, 0.8, 0.6][st.level];
    var fps = [30, 24, 16, 12][st.level];
    try { api.setQuality({ dpr: dpr, maxfps: fps }); } catch (e) {}
  }

  /* ---------- 路由变化：只有工作台才挂卡片 ---------- */
  function onRoute() {
    // 等首页视图渲染完再找容器
    clearTimeout(routeTimer);
    routeTimer = setTimeout(mount, 80);
  }

  /* ---------- 对外接口 ---------- */
  function setEnabled(on) {
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
    if (!on) { unmount(); return; }
    onRoute();
  }

  window.DNSBackground = {
    setEnabled: setEnabled,
    refresh: function () { pushData(true); },
    isEnabled: enabled,
    stats: function () {
      return {
        state: st.state, reason: st.reason, fps: st.fps, tier: st.tier,
        dpr: st.dpr, maxfps: st.maxfps, level: st.level,
        reducedMotion: !!(api && api.stats && api.stats().reducedMotion)
      };
    }
  };

  /* ---------- 启动 ---------- */
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('resize', function () {
    if (window.innerWidth < 900) unmount();
    onRoute();
  });
  function boot() {
    if (!enabled()) { st.state = 'off'; return; }
    onRoute();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
