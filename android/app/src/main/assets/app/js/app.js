/* ============================================================
 * app.js — 入口 / 路由 / 底部导航 / 返回栈
 * ============================================================ */
'use strict';

(function () {
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
    const shouldSlide = previous && currentPage && currentPage.key !== key && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const snapshot = shouldSlide ? previous.cloneNode(true) : null;
    const scrollTop = window.scrollY;
    const direction = navigationDirection(path, tab);
    pendingDirection = null;
    if (previous && typeof previous.dispose === 'function') previous.dispose();
    container.innerHTML = '';
    container.appendChild(view);
    setTab(tab);
    window.scrollTo(0, 0);
    currentPage = { key, path, tab };
    if (historyStack[historyStack.length - 1] !== key) historyStack.push(key);
    if (historyStack.length > 60) historyStack.shift();
    if (snapshot) slidePage(snapshot, view, direction, scrollTop);
  }

  function setTab(tab) {
    $$('#tabbar .tab-item').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
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

  /* 底部导航 */
  $('#tabbar').addEventListener('click', e => {
    const tab = e.target.closest('.tab-item');
    if (!tab) return;
    const key = tab.dataset.tab;
    location.hash = TAB_ROUTE[key] || '#/home';
  });

  window.addEventListener('hashchange', route);
  route();
})();
