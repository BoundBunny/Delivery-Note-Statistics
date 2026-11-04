/* 离线玻璃按钮交互：滚动不触发点击反馈，系统触感设置优先。 */
'use strict';
(function () {
  const selector = 'button,[role="button"],.list-item[data-open],.list-item[data-go],.set-row[data-act],.cust-pick';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const timers = new WeakMap();
  let active = null, keyboardTarget = null, suppressed = null, lastFeedback = -Infinity;

  function targetFor(event) {
    if (!(event.target instanceof Element)) return null;
    const target = event.target.closest(selector);
    if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true') return null;
    return target;
  }
  function surfaceFor(target) {
    return target.matches('.tab-new') ? target.querySelector('.new-circle') || target : target;
  }
  function prepare(target, x, y) {
    const surface = surfaceFor(target);
    const timer = timers.get(surface);
    if (timer) clearTimeout(timer);
    surface.classList.remove('glass-releasing');
    surface.classList.add('glass-tap-target');
    if (getComputedStyle(surface).position === 'static') surface.style.position = 'relative';
    const rect = surface.getBoundingClientRect();
    const px = Math.max(0, Math.min(rect.width, x == null ? rect.width / 2 : x - rect.left));
    const py = Math.max(0, Math.min(rect.height, y == null ? rect.height / 2 : y - rect.top));
    surface.style.setProperty('--press-point-x', px + 'px');
    surface.style.setProperty('--press-point-y', py + 'px');
    const angle = rect.width > 240 ? 1.1 : 2.8;
    surface.style.setProperty('--press-tilt-x', (rect.height ? (0.5 - py / rect.height) * angle : 0) + 'deg');
    surface.style.setProperty('--press-tilt-y', (rect.width ? (px / rect.width - 0.5) * angle : 0) + 'deg');
    if (!surface.querySelector(':scope > .glass-tap-overlay')) {
      const overlay = document.createElement('span');
      overlay.className = 'glass-tap-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      surface.appendChild(overlay);
    }
    surface.classList.add('is-pressed');
    return { surface, px, py, size: Math.max(rect.width, rect.height) * 2.2 };
  }
  function release(state, activate) {
    if (!state) return;
    const surface = state.surface;
    surface.classList.remove('is-pressed');
    if (!activate || !surface.isConnected || reducedMotion.matches) return;
    surface.classList.add('glass-releasing');
    timers.set(surface, setTimeout(() => surface.classList.remove('glass-releasing'), 380));
    const ripple = document.createElement('span');
    ripple.className = 'glass-ripple';
    ripple.style.setProperty('--ripple-x', state.px + 'px');
    ripple.style.setProperty('--ripple-y', state.py + 'px');
    ripple.style.setProperty('--ripple-size', state.size + 'px');
    const overlay = surface.querySelector(':scope > .glass-tap-overlay');
    overlay.querySelectorAll('.glass-ripple').forEach(node => node.remove());
    overlay.appendChild(ripple);
    setTimeout(() => ripple.remove(), 520);
  }
  function feedback() {
    const now = performance.now();
    if (now - lastFeedback < 70) return;
    lastFeedback = now;
    try {
      if (window.Android && typeof window.Android.tapFeedback === 'function') window.Android.tapFeedback();
      else if (typeof navigator.vibrate === 'function') navigator.vibrate(10);
    } catch (error) { /* 不支持触感时仅保留视觉反馈。 */ }
  }
  function cancelPointer() {
    if (!active) return;
    suppressed = { target: active.target, until: performance.now() + 350 };
    release(active, false);
    active = null;
  }
  document.addEventListener('pointerdown', event => {
    if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const target = targetFor(event);
    if (!target) return;
    cancelPointer();
    suppressed = null;
    active = { ...prepare(target, event.clientX, event.clientY), target, id: event.pointerId, x: event.clientX, y: event.clientY };
  }, { capture: true, passive: true });
  document.addEventListener('pointermove', event => {
    if (active && event.pointerId === active.id && Math.hypot(event.clientX - active.x, event.clientY - active.y) > 10) cancelPointer();
  }, { capture: true, passive: true });
  document.addEventListener('pointercancel', cancelPointer, { capture: true, passive: true });
  document.addEventListener('pointerup', event => {
    if (!active || event.pointerId !== active.id) return;
    const state = active;
    active = null;
    const valid = targetFor(event) === state.target && state.target.isConnected;
    release(state, valid);
    if (valid && event.isTrusted) feedback();
  }, { capture: true, passive: true });
  document.addEventListener('keydown', event => {
    if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
    const target = targetFor(event);
    if (!target) return;
    suppressed = null;
    keyboardTarget = { ...prepare(target), target };
  }, true);
  document.addEventListener('keyup', event => {
    if (!keyboardTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    release(keyboardTarget, false);
    keyboardTarget = null;
  }, true);
  document.addEventListener('click', event => {
    const target = targetFor(event);
    if (!target) return;
    if (suppressed && suppressed.target === target && performance.now() < suppressed.until) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!event.isTrusted || (event.detail !== 0 && window.PointerEvent)) return;
    release(keyboardTarget && keyboardTarget.target === target ? keyboardTarget : prepare(target), true);
    keyboardTarget = null;
    feedback();
  }, true);
  window.addEventListener('blur', () => {
    cancelPointer();
    release(keyboardTarget, false);
    keyboardTarget = null;
  });
})();
