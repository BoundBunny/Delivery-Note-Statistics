/* ============================================================
 * app.js — 入口 / 路由 / 底部导航 / 返回栈
 * ============================================================ */
'use strict';

(function startApp(classic) {
  if (!classic && window.Android && window.Android.isDesktop && window.Android.desktopAssetsUrl) {
    const base = window.Android.desktopAssetsUrl;
    const pending = [];
    const loadScript = src => new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = src;
      script.onload = resolve; script.onerror = reject;
      document.head.appendChild(script); pending.push(script);
    });
    const loadStyle = src => new Promise((resolve, reject) => {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = src;
      link.onload = resolve; link.onerror = reject;
      document.head.appendChild(link); pending.push(link);
    });
    (async () => {
      await Promise.all([loadStyle(base + 'workspace.css'), loadStyle(base + 'desktop.css'), loadScript(base + 'shell.js')]);
      await loadScript(base + 'desktop.js');
      window.DNSDesktop.start();
    })().catch(error => {
      if (window.DNSDesktop && window.DNSDesktop.destroy) window.DNSDesktop.destroy();
      pending.forEach(node => node.remove());
      console.error('Desktop workspace failed; using the classic interface.', error);
      startApp(true);
    });
    return;
  }
  const container = $('#view-container');
  const TAB_ROUTE = { home: '#/home', order: '#/order/new', orders: '#/orders', stats: '#/stats', settings: '#/settings' };
  const TAB_ORDER = Object.keys(TAB_ROUTE);
  const ROUTE_TAB = {
    '#/home': 'home', '#/orders': 'orders', '#/stats': 'stats',
    '#/customers': 'settings', '#/products': 'settings', '#/settings': 'settings', '#/settings/company': 'settings',
  };
  const PAGE_DEPTH = {
    '/customers': 1, '/products': 1, '/settings/company': 1,
    '/order/view': 1, '/bill': 1, '/order/edit': 2, '/print': 2,
  };
  const navigationSession = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const historyStack = [];
  let historyIndex = 0, historySequence = 0;
  let currentPage = null, pendingDirection = null, finishTransition = null;

  function navigationDirection(path, tab) {
    const state = history.state;
    const entry = state && state.dnsNavigation;
    const previousIndex = historyIndex;
    if (entry && entry.session === navigationSession) {
      historyIndex = entry.index;
    } else {
      historyIndex = currentPage ? ++historySequence : 0;
      history.replaceState({ ...state, dnsNavigation: { session: navigationSession, index: historyIndex } }, '');
    }
    if (pendingDirection) return pendingDirection;
    if (!currentPage) return 'forward';
    if (currentPage.tab !== tab) return TAB_ORDER.indexOf(tab) > TAB_ORDER.indexOf(currentPage.tab) ? 'forward' : 'back';
    if ((PAGE_DEPTH[path] || 0) < (PAGE_DEPTH[currentPage.path] || 0)) return 'back';
    return historyIndex < previousIndex ? 'back' : 'forward';
  }

  function slidePage(previous, view, direction, scrollTop) {
    const overlay = document.createElement('div');
    overlay.className = 'page-transition';
    overlay.dataset.direction = direction;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.setProperty('--page-slide-distance', container.clientWidth + 'px');
    const outgoing = document.createElement('div');
    outgoing.className = 'page-transition-layer page-leaving';
    previous.removeAttribute('id');
    previous.removeAttribute('name');
    $$('[id], [name]', previous).forEach(el => { el.removeAttribute('id'); el.removeAttribute('name'); });
    previous.style.marginTop = -scrollTop + 'px';
    outgoing.appendChild(previous);
    const incoming = document.createElement('div');
    incoming.className = 'page-transition-layer page-entering';
    const originalMinHeight = container.style.minHeight;
    container.style.minHeight = container.getBoundingClientRect().height + 'px';
    container.setAttribute('aria-busy', 'true');
    incoming.appendChild(view);
    overlay.appendChild(outgoing);
    overlay.appendChild(incoming);
    document.body.appendChild(overlay);
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      container.appendChild(view);
      container.style.minHeight = originalMinHeight;
      container.removeAttribute('aria-busy');
      overlay.remove();
      finishTransition = null;
    };
    finishTransition = cleanup;
    const timeout = setTimeout(cleanup, 380);
    incoming.addEventListener('animationend', event => { if (event.target === incoming) cleanup(); });
  }

  function parseHash(hash) {
    const h = (hash || '#/home').replace(/^#/, '') || '/home';
    const [path, queryStr] = h.split('?');
    const params = {};
    if (queryStr) {
      queryStr.split('&').forEach(pair => {
        const [k, v] = pair.split('=');
        if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
      });
    }
    return { path, params };
  }

  function route() {
    if (finishTransition) finishTransition();
    const key = location.hash || '#/home';
    const { path, params } = parseHash(key);
    let viewName = null;
    let tab = null;
    let view = null;

    if (path === '/home' || path === '/' || path === '') { viewName = 'home'; tab = 'home'; }
    else if (path === '/order/new' || path === '/order') { viewName = 'order'; tab = 'order'; }
    else if (path === '/order/edit') { viewName = 'order'; tab = 'order'; params.id && (params.id = params.id); }
    else if (path === '/order/view') { viewName = 'order'; tab = 'orders'; }
    else if (path === '/orders') { viewName = 'orders'; tab = 'orders'; }
    else if (path === '/stats') { viewName = 'stats'; tab = 'stats'; }
    else if (path === '/customers') { viewName = 'customers'; tab = 'settings'; }
    else if (path === '/products') { viewName = 'products'; tab = 'settings'; }
    else if (path === '/settings') { viewName = 'settings'; tab = 'settings'; }
    else if (path === '/settings/company') { viewName = 'companyInfo'; tab = 'settings'; }
    else if (path === '/print') { viewName = 'print'; tab = 'orders'; }
    else if (path === '/bill') { viewName = 'bill'; tab = 'stats'; }
    else { viewName = 'home'; tab = 'home'; }

    if (!ROUTE_TAB['#' + path]) ROUTE_TAB['#' + path] = tab;
    if (Views[viewName]) view = Views[viewName].render(params);

    if (!view) { viewName = 'home'; view = Views.home.render({}); tab = 'home'; }

    // Invalid detail routes may redirect while rendering; animate the destination only.
    if ((location.hash || '#/home') !== key) return;

    const previous = container.firstElementChild;
    // 桌面宽屏是「左导航 + 右工作区」布局，滑动遮罩按移动端 640px 居中的逻辑会错位，故宽屏直接切换。
    const canSlide = window.innerWidth < 900 && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const shouldSlide = previous && currentPage && currentPage.key !== key && canSlide;
    const snapshot = shouldSlide ? previous.cloneNode(true) : null;
    const scrollTop = window.scrollY;
    const direction = navigationDirection(path, tab);
    pendingDirection = null;
    if (previous && typeof previous.dispose === 'function') previous.dispose();
    container.innerHTML = '';
    container.appendChild(view);
    setTab(tab, path);
    window.scrollTo(0, 0);
    currentPage = { key, path, tab };
    if (historyStack[historyStack.length - 1] !== key) historyStack.push(key);
    if (historyStack.length > 60) historyStack.shift();
    if (snapshot) slidePage(snapshot, view, direction, scrollTop);
  }

  function setTab(tab, path) {
    const desktop = window.innerWidth >= 900;
    const routeHash = '#' + (path || '');
    let matchedSide = false;
    if (desktop) {
      $$('#tabbar .side-extra').forEach(b => { if (b.dataset.sideRoute === routeHash) matchedSide = true; });
    }
    $$('#tabbar .tab-item').forEach(b => {
      let on;
      if (b.dataset.sideRoute) {
        on = desktop && b.dataset.sideRoute === routeHash;   // 宽屏：客户/商品侧栏项按路由高亮
      } else {
        on = !matchedSide && b.dataset.tab === tab;          // 命中侧栏项时，底部/常规项不再高亮
      }
      b.classList.toggle('on', on);
    });
  }

  /* Android 返回键：优先回退应用内路由 */
  window.__appBack = function () {
    pendingDirection = 'back';
    if (historyStack.length > 1) {
      historyStack.pop();
      const target = historyStack[historyStack.length - 1];
      historyStack.pop();
      location.hash = target;
    } else {
      const cur = (location.hash || '#/home').replace(/^#/, '');
      if (cur !== '/home') location.hash = '#/home';
      else if (window.Android && window.Android.exitApp) window.Android.exitApp();
      else history.back();
    }
    return true;
  };

  // Explicit back/previous controls also use the reverse slide when they set a hash.
  document.addEventListener('click', event => {
    const action = event.target.closest('[data-act]');
    pendingDirection = action && (action.dataset.act === 'back' || action.dataset.act === 'prev') ? 'back' : null;
    if (action && action.dataset.act === 'next') pendingDirection = 'forward';
  }, true);

  window.addEventListener('resize', () => { if (finishTransition) finishTransition(); });
  window.addEventListener('beforeprint', () => { if (finishTransition) finishTransition(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && finishTransition) finishTransition(); });

  /* 底部导航 / 左侧导航 */
  $('#tabbar').addEventListener('click', e => {
    const tab = e.target.closest('.tab-item');
    if (!tab) return;
    if (tab.dataset.sideRoute) { location.hash = tab.dataset.sideRoute; return; }
    const key = tab.dataset.tab;
    location.hash = TAB_ROUTE[key] || '#/home';
  });

  window.addEventListener('hashchange', route);
  route();
})();
