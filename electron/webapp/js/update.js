/* ============================================================
 * update.js — 应用内检查更新（桌面端）
 * ------------------------------------------------------------
 * 主进程用 electron-updater 读取 GitHub Releases；这里负责全局弹窗：
 *   - 启动自动检查到新版时，在任何页面都能弹出说明
 *   - 设置页「检查更新」按钮触发手动检查
 *   - 点“下载并安装”→ 显示进度 → 下载完成自动退出安装
 * 开发模式 / 浏览器环境不启用。
 * ============================================================ */
'use strict';

(function () {
  const bridge = window.Android;
  const supported = !!(bridge && bridge.getAppVersion && bridge.onUpdateEvent);
  let version = '';
  let hint = '';
  let modal = null;
  let unsubscribe = null;
  let manual = false;

  const updateListeners = new Set();
  function emit(state) {
    version = state.version || version;
    hint = state.hint || '';
    updateListeners.forEach(fn => { try { fn(state); } catch (_) { /* ignore */ } });
  }

  function notesHtml(notes) {
    const text = String(notes || '').trim();
    if (!text) return '<p class="upd-note-empty">本次更新包含体验与稳定性改进。</p>';
    return '<pre class="upd-notes">' + esc(text) + '</pre>';
  }

  function ensureModal() {
    if (modal) return modal;
    const mask = document.createElement('div');
    mask.className = 'mask center show upd-mask';
    mask.innerHTML =
      '<section class="upd-box" role="dialog" aria-modal="true" aria-labelledby="upd-title">' +
        '<div class="upd-head"><span class="upd-badge" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/><path d="M12 7v6l4 2"/></svg></span>' +
          '<div class="upd-headtext"><div class="upd-eyebrow">应用更新</div><h2 id="upd-title" class="upd-title">发现新版本</h2></div>' +
          '<button type="button" class="upd-x" aria-label="关闭" title="关闭">×</button></div>' +
        '<div class="upd-body"></div>' +
        '<div class="upd-actions"></div>' +
      '</section>';
    document.getElementById('modal-root').appendChild(mask);
    modal = mask;
    mask.querySelector('.upd-x').addEventListener('click', () => closeModal());
    return mask;
  }

  function closeModal() {
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    modal = null;
  }

  function setModal({ title, subtitle, notes, progress, actions }) {
    const mask = ensureModal();
    mask.querySelector('.upd-title').textContent = title;
    const body = mask.querySelector('.upd-body');
    body.innerHTML = (subtitle ? '<p class="upd-sub">' + esc(subtitle) + '</p>' : '') +
      (notes != null ? notesHtml(notes) : '') +
      (progress == null ? '' : '<div class="upd-progress"><span class="upd-bar"><i style="width:' + (Number(progress) || 0) + '%"></i></span><b class="upd-percent">' + Math.round(Number(progress) || 0) + '%</b></div>');
    const box = mask.querySelector('.upd-actions');
    box.innerHTML = '';
    (actions || []).forEach(action => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn ' + (action.kind || 'btn-ghost');
      button.textContent = action.label;
      if (action.disabled) button.disabled = true;
      button.addEventListener('click', action.onClick);
      box.appendChild(button);
    });
  }

  function showAvailable(payload, isManual) {
    version = payload.version || '';
    const render = () => {
      const current = payload.current || window.__appVersion || '';
      setModal({
        title: '发现新版本' + (version ? ' v' + version : ''),
        subtitle: (current ? '当前版本 v' + current + ' → ' : '') + '新版本' + (version ? ' v' + version : '') + '，建议更新。',
        notes: payload.notes,
        actions: [
          { label: '稍后再说', onClick: () => { closeModal(); if (isManual) toast('已暂不更新'); } },
          { label: '下载并安装', kind: 'btn-primary', onClick: () => startDownload() },
        ],
      });
    };
    if (!payload.current && !window.__appVersion && supported) {
      bridge.getAppVersion().then(res => { if (res && res.version) { window.__appVersion = res.version; } render(); }).catch(render);
    } else {
      render();
    }
    emit({ phase: 'available', version, hint: '发现新版本 v' + version });
  }

  function startDownload() {
    setModal({ title: '正在下载更新', subtitle: '请保持网络连接，下载完成后会自动退出并安装。', progress: 0, actions: [] });
    emit({ phase: 'downloading', hint: '正在下载更新…' });
    bridge.downloadUpdate().then(res => {
      if (res && res.ok === false) {
        toast('下载失败：' + (res.error || '未知错误'), true);
        closeModal();
      }
    }).catch(err => { toast('下载失败：' + (err && err.message || err), true); closeModal(); });
  }

  function showDownloaded(payload) {
    const v = payload.version || version;
    version = v;
    setModal({
      title: '更新已下载',
      subtitle: '新版本' + (v ? ' v' + v : '') + '已下载完成，正在退出并安装…',
      actions: [{ label: '立即安装', kind: 'btn-primary', onClick: () => bridge.installUpdate() }],
    });
    emit({ phase: 'downloaded', version, hint: '更新已下载，即将安装' });
    setTimeout(() => { try { bridge.installUpdate(); } catch (_) { /* ignore */ } }, 900);
  }

  function handle(payload, isManual) {
    const type = payload && payload.type;
    if (type === 'available') showAvailable(payload, isManual);
    else if (type === 'none') {
      if (isManual) toast('已是最新版本' + ((payload.current || version) ? ' v' + (payload.current || version) : ''));
      emit({ phase: 'none', version: payload.current || version, hint: '已是最新版本' });
    } else if (type === 'progress') {
      const value = Math.max(0, Math.min(100, Number(payload.percent) || 0));
      // 若当前没有下载态弹窗（例如直接收到进度事件），重建为下载态
      if (!modal || !modal.querySelector('.upd-bar')) {
        setModal({ title: '正在下载更新', subtitle: '请保持网络连接，下载完成后会自动退出并安装。', progress: value, actions: [] });
      } else {
        const bar = modal.querySelector('.upd-bar i');
        const percent = modal.querySelector('.upd-percent');
        if (bar) bar.style.width = value + '%';
        if (percent) percent.textContent = Math.round(value) + '%';
      }
      emit({ phase: 'progress', percent: payload.percent, hint: '正在下载更新…' });
    } else if (type === 'downloaded') showDownloaded(payload);
    else if (type === 'error') {
      if (isManual) toast('检查更新失败：' + (payload.message || '请检查网络'), true);
      emit({ phase: 'error', message: payload.message, hint: '检查更新失败' });
      if (modal && modal.querySelector('.upd-progress')) closeModal();
    }
  }

  const UpdateUI = {
    supported,
    get version() { return version; },
    get hint() { return hint; },
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      updateListeners.add(fn);
      try { fn({ phase: 'idle', version, hint }); } catch (_) { /* ignore */ }
      return () => updateListeners.delete(fn);
    },
    refreshVersion() {
      if (!supported) return Promise.resolve('');
      return bridge.getAppVersion().then(res => { if (res && res.version) { version = res.version; window.__appVersion = res.version; } return version; }).catch(() => version);
    },
    check() {
      manual = true;
      if (!supported) { toast('当前环境不支持检查更新', true); return; }
      emit({ phase: 'checking', hint: '正在检查更新…' });
      bridge.checkForUpdates().then(res => {
        if (res && res.ok === false) {
          toast(res.error && res.error.indexOf('开发模式') >= 0 ? '开发模式下不检查更新' : ('检查更新失败：' + (res.error || '未知错误')), true);
          emit({ phase: 'error', message: res.error, hint: '检查更新失败' });
        }
      }).catch(err => toast('检查更新失败：' + (err && err.message || err), true));
    },
    startDownload,
    close: closeModal,
  };
  window.UpdateUI = UpdateUI;

  if (supported) {
    bridge.getAppVersion().then(res => { if (res && res.version) { version = res.version; window.__appVersion = res.version; } }).catch(() => {});
    unsubscribe = bridge.onUpdateEvent(payload => handle(payload || {}, manual));
    manual = false;
  }
})();
