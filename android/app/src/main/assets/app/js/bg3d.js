/* ============================================================
 * bg3d.js — 工作台 3D 背景层（P4.1：老板优先的可读性优先版）
 * ------------------------------------------------------------
 * - 场景直接挂在宿主页（无 iframe、无 postMessage），按需动态加载 three.js。
 * - **默认关闭**：新装用户打开就是干净的界面，不改变老板的工作习惯。
 * - 两档强度：
 *     柔化（默认开启后默认档）：加一层纸色白纱 + 场景降档，界面文字始终清晰；
 *     全开：撤掉白纱，看完整场景（演示/展示用）。
 * - 窗口宽度分级：<900 不挂载；900–1279 精简；1280–1599 标准；≥1600 高。
 * - FPS 探针：连续低帧自动降级（DPR → FPS 逐级下调）；帧率在设置页显示，
 *   页面右下角不再常驻徽标（避免压住内容）。
 * - 首帧未就绪 / WebGL 失败 / 脚本加载失败 → 回退 3d/bg-static.png 静态图。
 * ============================================================ */
'use strict';

(function () {
  var KEY = 'sd_v1_bg3d';          // '1' 开启 / '0' 关闭（缺省 = 关闭）
  var MODE_KEY = 'sd_v1_bg3d_mode'; // 'soft' 柔化（默认） / 'full' 全开
  var q = new URLSearchParams(location.search);
  var force = q.get('bg3d');

  var layer = null, canvas = null, img = null, scrim = null;
  var api = null, mounted = false, loading = false;
  var timer = null, probe = null, params = null;

  var st = {
    state: 'idle',      // idle | loading | ready | fallback | skip | off
    reason: '',
    fps: 0,
    tier: '',
    dpr: 0,
    maxfps: 0,
    level: 0,           // 降级档位 0~3
    samples: []
  };

  /* ---------- 开关 / 强度 ---------- */
  function enabled() {
    if (force === '0') return false;
    if (force === '1') return true;
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  function mode() {
    try { return localStorage.getItem(MODE_KEY) === 'full' ? 'full' : 'soft'; } catch (e) { return 'soft'; }
  }
  function setMode(m) {
    var next = m === 'full' ? 'full' : 'soft';
    try { localStorage.setItem(MODE_KEY, next); } catch (e) { /* ignore */ }
    applyMode();
    applyTier(tierFor(), true);
    return next;
  }

  /* ---------- 画质分级 ---------- */
  function tierFor(w) {
    w = w || window.innerWidth;
    if (w < 900) return null;
    var soft = mode() === 'soft';
    if (w < 1280) return { name: '精简', dpr: soft ? 0.8 : 1.0, maxfps: soft ? 20 : 24 };
    if (w < 1600) return { name: '标准', dpr: soft ? 1.0 : 1.5, maxfps: soft ? 24 : 30 };
    return { name: '高', dpr: soft ? 1.5 : 2.0, maxfps: soft ? 30 : 30 };
  }

  // 场景脚本读 URL 参数；宿主用这个可读可写的替身注入 dpr / maxfps / clean
  function makeParams(tier) {
    var p = { dpr: tier.dpr, maxfps: tier.maxfps, clean: '1', tags: '0' };
    return {
      get: function (k) { return p[k] == null ? null : String(p[k]); },
      set: function (k, v) { p[k] = v; }
    };
  }

  /* ---------- 样式 / DOM ---------- */
  function injectStyle() {
    if (document.getElementById('bg3d-style')) return;
    var el = document.createElement('style');
    el.id = 'bg3d-style';
    el.textContent = [
      '#bg3d-layer{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;',
      'background:radial-gradient(1200px 700px at 62% 38%,#FFFFFF 0%,#F7F9FD 45%,#EDF1F8 100%);',
      'opacity:0;transition:opacity .6s ease;}',
      '#bg3d-layer canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}',
      '#bg3d-layer img{width:100%;height:100%;object-fit:cover;display:block;}',
      '#bg3d-scrim{position:absolute;inset:0;display:block;pointer-events:none;}',
      '#app{position:relative;z-index:1;}',
      '#modal-root{position:relative;z-index:3;}'
    ].join('');
    document.head.appendChild(el);
  }

  function loadScript(src, onOk, onErr) {
    var s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = function () { onOk(); };
    s.onerror = function () { if (onErr) onErr(); };
    document.head.appendChild(s);
  }

  /* ---------- 挂载 ---------- */
  function mount() {
    if (mounted || loading) return;
    var tier = tierFor();
    if (!tier) { st.state = 'skip'; return; }
    loading = true;
    st.state = 'loading';
    st.tier = tier.name;
    st.level = 0;
    st.samples = [];

    injectStyle();
    layer = document.createElement('div');
    layer.id = 'bg3d-layer';
    layer.setAttribute('aria-hidden', 'true');

    img = document.createElement('img');
    img.src = '3d/bg-static.png';
    img.alt = '';
    layer.appendChild(img);

    canvas = document.createElement('canvas');
    canvas.id = 'bg3d-canvas';
    canvas.style.display = 'none';
    layer.appendChild(canvas);

    scrim = document.createElement('div');
    scrim.id = 'bg3d-scrim';
    layer.appendChild(scrim);

    document.body.insertBefore(layer, document.body.firstChild);
    applyMode();

    loadScript('3d/vendor/three.min.js', function () {
      if (!window.THREE) { fail('three-missing'); return; }
      params = makeParams(tier);
      window.__dnsSceneOpts = { canvas: canvas, params: params, ui: false };
      window.__dnsSceneOnReady = function (a) { api = a; onReady(); };
      loadScript('3d/scene.js', function () {
        if (!api) setTimeout(function () { if (!api) fail('scene-error'); }, 600);
      }, function () { fail('scene-load-failed'); });
    }, function () { fail('three-load-failed'); });
  }

  function applyMode() {
    if (!layer) return;
    var m = mode();
    if (scrim) scrim.style.background = m === 'full' ? 'rgba(247,247,250,0)' : 'rgba(247,247,250,.66)';
    if (layer) layer.style.opacity = m === 'full' ? '0.92' : '0.9';
  }

  function onReady() {
    loading = false;
    mounted = true;
    st.state = 'ready';
    st.reason = '';
    if (img) img.style.display = 'none';
    if (canvas) canvas.style.display = 'block';
    applyMode();
    applyTier(tierFor(), true);
    pushData();
    startTimers();
  }

  function fail(reason) {
    loading = false;
    mounted = false;
    api = null;
    st.state = 'fallback';
    st.reason = reason;
    if (img) img.style.display = 'block';
    if (canvas) canvas.style.display = 'none';
    if (layer) layer.style.opacity = '0.9';
    stopTimers();
  }

  function teardown(state) {
    stopTimers();
    if (api && api.dispose) { try { api.dispose(); } catch (e) { /* ignore */ } }
    api = null;
    mounted = false;
    loading = false;
    st.state = state || 'off';
    st.fps = 0;
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    layer = null; canvas = null; img = null; scrim = null; params = null;
  }

  /* ---------- 数据同步 ---------- */
  function pushData() {
    if (!api || typeof Store === 'undefined') return;
    try {
      if (api.state) api.state.source = '工作台 Store';
      api.computeFromData(Store.listOrders(), Store.listCustomers());
    } catch (e) { /* 数据异常不拖垮场景 */ }
  }

  /* ---------- FPS 探针 + 自动降级 ---------- */
  function startTimers() {
    stopTimers();
    timer = setInterval(pushData, 12000);
    probe = setInterval(tickProbe, 2000);
    window.addEventListener('hashchange', pushData);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) pushData(); });
  }
  function stopTimers() {
    if (timer) { clearInterval(timer); timer = null; }
    if (probe) { clearInterval(probe); probe = null; }
  }

  function tickProbe() {
    if (!api) return;
    var s = api.stats();
    st.fps = s.fps || 0;
    st.dpr = s.dpr || 0;
    st.maxfps = s.maxfps || 0;
    if (document.hidden) return;
    st.samples.push(st.fps);
    if (st.samples.length > 3) st.samples.shift();
    if (st.samples.length < 3) return;
    var avg = st.samples.reduce(function (a, b) { return a + b; }, 0) / st.samples.length;
    if (avg >= 22) { st.samples.length = 0; return; }
    if (st.level >= 3) return;
    st.level++;
    var dpr = [0, 1.0, 0.8, 0.6][st.level];
    var fps = [0, 24, 16, 12][st.level];
    if (api) api.setQuality({ dpr: dpr, maxfps: fps });
    st.dpr = dpr;
    st.maxfps = fps;
    st.samples.length = 0;
  }

  /* ---------- 画质档位切换 ---------- */
  function applyTier(tier, force) {
    if (!tier) return;
    if (!force && st.tier === tier.name) return;
    st.tier = tier.name;
    st.level = 0;
    st.samples = [];
    if (api) api.setQuality({ dpr: tier.dpr, maxfps: tier.maxfps });
    var s = api && api.stats ? api.stats() : null;
    if (s) { st.dpr = s.dpr; st.maxfps = s.maxfps; }
  }

  /* ---------- 窗口变化 ---------- */
  window.addEventListener('resize', function () {
    var tier = tierFor();
    if (!tier) { if (mounted || loading) teardown('skip'); else st.state = 'skip'; return; }
    if (!mounted && !loading) { mount(); return; }
    if (tier.name !== st.tier) applyTier(tier, false);
  });

  /* ---------- 对外接口 ---------- */
  function setEnabled(on) {
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* ignore */ }
    if (!on) { teardown(); return; }
    st.state = 'idle';
    mount();
  }

  window.DNSBackground = {
    setEnabled: setEnabled,
    setMode: setMode,
    getMode: mode,
    refresh: pushData,
    isEnabled: enabled,
    stats: function () {
      return {
        state: st.state, reason: st.reason, fps: st.fps, tier: st.tier,
        dpr: st.dpr, maxfps: st.maxfps, level: st.level, mode: mode()
      };
    }
  };

  /* ---------- 启动 ---------- */
  function boot() {
    if (!enabled()) { st.state = 'off'; return; }
    if (window.innerWidth < 900) { st.state = 'skip'; return; }
    mount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
