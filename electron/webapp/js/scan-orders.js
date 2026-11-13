'use strict';
/* HID keyboard input stays in this app; ordinary form typing never starts a scan. */
window.ScanOrders = (() => {
  const PREFS = 'sd_v1_scanner_preferences_v2';
  let model, storage, prefs = { enabled: true, mode: 'auto' }, started = false, timer, view, confirmation, settingsMask;
  let buffer = '', lastKey = 0, lastScanEnd = 0, framed = false, previousPaused = false, inerted = [], unsubscribe;
  const editable = target => !!target?.closest('input,textarea,select,[contenteditable="true"]');
  function ensure() {
    if (model) return model;
    storage = window.__DNSStorage || window.localStorage;
    try { const saved = JSON.parse(storage.getItem(PREFS) || 'null'); if (saved && typeof saved.enabled === 'boolean') prefs = { enabled: saved.enabled, mode: saved.mode === 'prefix' ? 'prefix' : 'auto' }; } catch (_) { /* Safe defaults; do not rewrite preferences. */ }
    model = ScanSession.create({ storage, store: Store, plan: planOrderItemAddition, now: () => Date.now(), id: () => uid(), today: todayStr, operator: () => Store.getSettings().operator });
    return model;
  }
  const current = () => ensure().state;
  const draft = () => current().draft;
  const otherModal = () => Array.from(document.querySelectorAll('#modal-root .mask')).some(mask => mask !== confirmation);
  function available() {
    if (!prefs.enabled || ensure().damaged || Store.recoveryState().blocked || document.querySelector('.close-prompt')) return false;
    if (draft() && (confirmation || view?.isConnected)) return true;
    return ['orders', 'stats', 'detail'].includes(window.DNSDesktop?.mode) && !otherModal();
  }
  function guarded(action) {
    try { const result = action(); update(); return result; }
    catch (error) { toast(error.message || '扫码操作失败', true); update(); return null; }
  }
  function feedback(ok) {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      const audio = ScanOrders.audio || (ScanOrders.audio = new Audio());
      audio.resume().catch(() => {});
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      oscillator.frequency.value = ok ? 880 : 330; gain.gain.value = 0.035;
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + 0.065);
    } catch (_) { /* The visible receipt is always available if audio is disabled. */ }
  }
  function open() {
    return window.DNSDesktop.navigate('#/order/scan');
  }
  function receive(code) {
    if (!available()) return;
    const result = guarded(() => ensure().scan(code));
    if (result) {
      feedback(result.accepted);
      const label = result.queued ? '已暂存扫码，等待选择归属' : result.accepted ? '已记入本单' : '已保留扫码，请处理商品资料';
      toast(label + '：' + code, !result.accepted && !result.queued);
    }
    if (!view?.isConnected) open();
    else focusScan();
  }
  function resetInput() { buffer = ''; framed = false; lastKey = 0; }
  function keydown(event) {
    if (!started || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) { resetInput(); return; }
    const inScan = event.target?.matches?.('[data-scan-input]');
    const eligible = available() && (!otherModal() || prefs.mode === 'prefix');
    if (!eligible) { resetInput(); return; }
    const consume = () => { event.preventDefault(); event.stopImmediatePropagation(); };
    if (event.key === 'Enter' && !buffer && !framed && !inScan && Date.now() - lastScanEnd < 250) { consume(); return; }
    if (event.key === 'F9') { consume(); framed = true; buffer = ''; lastKey = Date.now(); return; }
    if (!framed && !inScan && editable(event.target)) { resetInput(); return; }
    if (event.key === 'Enter' && (framed || buffer || inScan)) {
      consume();
      const code = (inScan && !framed ? event.target.value : buffer).trim();
      const complete = framed || inScan || (buffer.length >= 6 && buffer.length <= 32);
      resetInput(); if (inScan) event.target.value = '';
      if (code && complete) { lastScanEnd = Date.now(); receive(code); }
      else if (code) toast('未识别完整扫码，请重新扫描或在扫码框输入条码', true);
      return;
    }
    if (event.key === 'Escape' && framed) { consume(); resetInput(); return; }
    if (event.key.length !== 1) { if (!['Shift', 'CapsLock'].includes(event.key)) resetInput(); return; }
    if (framed) {
      consume(); if (Date.now() - lastKey > 2000 || buffer.length >= 128) { resetInput(); toast('扫码输入中断，请重扫', true); return; }
      buffer += event.key; lastKey = Date.now(); return;
    }
    if (inScan) return; // A dedicated field also supports pasted and alphanumeric barcodes.
    if (prefs.mode === 'prefix' || !/\d/.test(event.key)) { resetInput(); return; }
    if (Date.now() - lastKey > 100) buffer = '';
    buffer += event.key; lastKey = Date.now(); consume();
  }
  function lockBackground(lock) {
    if (lock && !inerted.length) {
      for (const element of document.querySelectorAll('#desktop-app,#desktop-module-window,#desktop-reader,#app')) { inerted.push([element, element.inert]); element.inert = true; }
    } else if (!lock) { inerted.forEach(([element, was]) => { element.inert = was; }); inerted = []; }
  }
  function focusScan() {
    if (confirmation || otherModal()) return;
    const input = view?.querySelector('[data-scan-input]'); if (input && prefs.enabled) input.focus({ preventScroll: true });
  }
  function modal(title, body) {
    const mask = document.createElement('div'); mask.className = 'mask center show scan-form-mask';
    mask.innerHTML = `<section class="scan-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2>${body}</section>`;
    document.getElementById('modal-root').append(mask);
    const previous = document.activeElement;
    mask.close = () => { mask.remove(); if (draft() && current().phase === 'scanning') guarded(() => model.activity()); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
    mask.addEventListener('keydown', event => trap(event, mask));
    mask.querySelector('input,select,button')?.focus(); return mask;
  }
  function trap(event, mask) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); return; }
    if (event.key !== 'Tab') return;
    const controls = Array.from(mask.querySelectorAll('button:not(:disabled),input:not(:disabled),select,textarea,[tabindex="0"]')).filter(element => !element.hidden && element.getClientRects().length);
    if (!controls.length) return;
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function ask(title, text) {
    return new Promise(resolve => {
      const mask = modal(title, `<p>${esc(text)}</p><div class="scan-actions"><button type="button" class="btn btn-ghost" data-choice="no">取消</button><button type="button" class="btn btn-primary" data-choice="yes">确认</button></div>`);
      mask.addEventListener('click', event => { const button = event.target.closest('[data-choice]'); if (button) { mask.close(); resolve(button.dataset.choice === 'yes'); } });
    });
  }
  function selectCustomer() {
    const mask = modal('选择本单客户', '<p>选择客户后会确认客户价差异；手动改过的价格保留。</p><input class="scan-search" data-customer-query placeholder="搜索名称或电话"><div class="scan-customer-list" data-customer-list></div><div class="scan-actions"><button class="btn btn-ghost" data-cancel>返回</button><button class="btn btn-ghost" data-walk-in>明确选择散客</button></div>');
    const render = () => {
      const keyword = mask.querySelector('[data-customer-query]').value;
      mask.querySelector('[data-customer-list]').innerHTML = Store.listCustomers(keyword).map(customer => `<button type="button" data-scan-customer="${esc(customer.id)}"><b>${esc(customer.name)}</b><span>${esc([customer.phone, customer.address].filter(Boolean).join(' · '))}</span></button>`).join('') || '<p>没有匹配客户。可保留本单，返回客户资料新增后继续。</p>';
    };
    render(); mask.addEventListener('input', render);
    mask.addEventListener('click', async event => {
      if (event.target.closest('[data-cancel]')) { mask.close(); return; }
      const button = event.target.closest('[data-scan-customer],[data-walk-in]'); if (!button || !draft()) return;
      const customer = button.dataset.scanCustomer ? Store.getCustomer(button.dataset.scanCustomer) : null;
      if (button.dataset.scanCustomer && !customer) return;
      const changes = draft().items.filter(item => {
        if (item.manualPrice) return false;
        const remembered = customer ? Store.getLastPrice(customer.id, item.pid) : null;
        const price = remembered != null ? remembered : Store.getProduct(item.pid)?.price;
        return price != null && price !== '' && Number(price) !== Number(item.price);
      });
      button.disabled = true;
      if (changes.length && !await ask('确认本单价格', `切换到${customer?.name || '散客'}后，${changes.length} 项商品将使用对应客户价或商品默认价。手动改价保留，是否应用？`)) { button.disabled = false; return; }
      guarded(() => model.setCustomer(customer, !customer)); mask.close(); update();
    });
  }
  function resolveIssue(issueId) {
    const issue = draft()?.issues.find(record => record.id === issueId); if (!issue) return;
    const products = Store.listProducts('', { includeArchived: true });
    const exact = products.filter(product => product.barcode === issue.code), initial = exact.length === 1 ? exact[0] : null;
    const mask = modal('处理扫码商品', `<p><b>${esc(issue.code)}</b> · ${esc(issue.reason)}</p><p class="scan-muted">绑定无条码商品，或新建商品。重复条码可明确选用本次商品，随后在商品资料中修正。</p><label>搜索已有商品<input data-product-query placeholder="输入名称、规格或条码筛选"></label><label>已有商品<select data-product-select><option value="">新建商品</option></select></label><div class="scan-form-grid"><label>商品名称<input data-product-name></label><label>规格<input data-product-spec></label><label>单位<input data-product-unit></label><label>本次售价<input data-product-price type="number" min="0" step="any"></label></div><label class="scan-check"><input type="checkbox" data-product-restore>如商品已下架，确认恢复上架</label><p data-issue-error class="scan-error" role="alert"></p><div class="scan-actions"><button class="btn btn-ghost" data-cancel>返回</button><button class="btn btn-primary" data-resolve>确认加入本单</button></div>`);
    const select = mask.querySelector('[data-product-select]');
    const list = () => {
      const selected = select.value, query = mask.querySelector('[data-product-query]').value.trim().toLowerCase();
      select.innerHTML = '<option value="">新建商品</option>' + products.filter(product => [product.name, product.spec, product.barcode].join(' ').toLowerCase().includes(query)).map(product => `<option value="${esc(product.id)}">${esc(product.name + ' ' + (product.spec || '') + (product.archived ? '（已下架）' : ''))}</option>`).join('');
      select.value = selected;
    };
    function fill() {
      const product = Store.getProduct(select.value);
      for (const [field, key] of [['name', 'name'], ['spec', 'spec'], ['unit', 'unit'], ['price', 'price']]) {
        const input = mask.querySelector('[data-product-' + field + ']'); input.value = product?.[key] ?? ''; if (field !== 'price') input.disabled = !!product;
      }
    }
    list(); if (initial) select.value = initial.id; fill();
    mask.querySelector('[data-product-query]').addEventListener('input', list); select.addEventListener('change', fill);
    mask.addEventListener('click', event => {
      if (event.target.closest('[data-cancel]')) { mask.close(); return; }
      if (!event.target.closest('[data-resolve]')) return;
      const values = { pid: select.value, restore: mask.querySelector('[data-product-restore]').checked };
      for (const key of ['name', 'spec', 'unit', 'price']) values[key] = mask.querySelector('[data-product-' + key + ']').value;
      try { model.resolve(issueId, values); mask.close(); update(); feedback(true); }
      catch (error) { mask.querySelector('[data-issue-error]').textContent = error.message; update(); }
    });
  }
  function exportJournal() {
    let text; try { text = model.damaged ? storage.getItem(ScanSession.KEY) : JSON.stringify(current(), null, 2); } catch (_) { text = JSON.stringify(current()); }
    const url = URL.createObjectURL(new Blob([text || ''], { type: 'application/json' })), anchor = document.createElement('a');
    anchor.href = url; anchor.download = '扫码草稿-' + todayStr() + '.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function configure() {
    if (settingsMask?.isConnected) return;
    settingsMask = modal('扫码接单设置', `<div class="scan-config">
      <div class="scan-toggle-card">
        <div class="scan-toggle-copy">
          <span class="scan-toggle-title">开启扫码接单</span>
          <span class="scan-toggle-desc">在首页或扫码页直接用扫码枪录入商品</span>
        </div>
        <label class="scan-switch"><input data-scan-enabled type="checkbox" ${prefs.enabled ? 'checked' : ''}><span class="scan-switch-slider" aria-hidden="true"></span></label>
      </div>
      <div class="scan-config-label">扫码接入方式</div>
      <div class="scan-mode" data-role="scan-mode">
        <button type="button" class="scan-mode-opt" data-mode="auto">
          <span class="scan-mode-ic"><svg viewBox="0 0 24 24"><path d="M4 5v14M8 5v14M11 5v14M14 5v14M18 5v14M21 5v14"/></svg></span>
          <span class="scan-mode-copy"><b>数字条码快速输入</b><em>普通输入框暂停时也能扫，适合大多数扫码枪</em></span>
          <span class="scan-mode-check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg></span>
        </button>
        <button type="button" class="scan-mode-opt" data-mode="prefix">
          <span class="scan-mode-ic"><svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2.4"/><path d="M6 10h1.2M10 10h1.2M14 10h1.2M18 10h1.2M7 14h10"/></svg></span>
          <span class="scan-mode-copy"><b>F9 前缀 + 条码 + 回车</b><em>需在扫码枪中配置 F9 前缀与 Enter 后缀</em></span>
          <span class="scan-mode-check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg></span>
        </button>
        <select data-scan-mode class="scan-mode-select" tabindex="-1" aria-hidden="true"><option value="auto">数字条码快速输入＋回车（普通输入框暂停）</option><option value="prefix">F9 前缀＋条码＋回车（需配置扫码枪）</option></select>
      </div>
      <div class="scan-help">
        <p>软件须保持在前台。默认模式在首页直接扫描；开单页的专用扫码框也支持粘贴、手输和字母条码。</p>
        <p class="scan-help-tip">建议按扫码枪说明书配置 F9 前缀和 Enter 后缀，避免与普通键盘输入混淆；保存后用一件实际商品试扫。</p>
      </div>
      <div class="scan-actions"><button class="btn btn-ghost" data-config-cancel>返回</button><button class="btn btn-primary" data-config-save>保存设置</button></div>
    </div>`);
    const modeSelect = settingsMask.querySelector('[data-scan-mode]');
    const modeWrap = settingsMask.querySelector('[data-role="scan-mode"]');
    const syncMode = () => modeWrap.querySelectorAll('.scan-mode-opt').forEach(btn => {
      const on = btn.dataset.mode === modeSelect.value;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    modeSelect.value = prefs.mode;
    syncMode();
    settingsMask.addEventListener('click', event => {
      const opt = event.target.closest('.scan-mode-opt');
      if (opt) { modeSelect.value = opt.dataset.mode; syncMode(); return; }
      if (event.target.closest('[data-config-cancel]')) { settingsMask.close(); return; }
      if (!event.target.closest('[data-config-save]')) return;
      try {
        const next = { enabled: settingsMask.querySelector('[data-scan-enabled]').checked, mode: settingsMask.querySelector('[data-scan-mode]').value };
        storage.setItem(PREFS, JSON.stringify(next)); prefs = next; resetInput(); settingsMask.close(); update(); focusScan();
      } catch (_) { toast('扫码设置保存失败，请检查存储空间', true); }
    });
  }
  const total = () => (draft()?.items || []).reduce((sum, item) => sum + Math.round(Number(item.qty) * Number(item.price) * 100), 0) / 100;
  function closeConfirmation() { if (confirmation) { confirmation.remove(); confirmation = null; lockBackground(false); } }
  function showConfirmation() {
    if (!draft() || current().phase !== 'confirm' || otherModal()) return;
    const d = draft(), queued = current().queued.length;
    if (!confirmation) {
      confirmation = document.createElement('div'); confirmation.className = 'mask center show scan-confirm-mask';
      confirmation.addEventListener('click', click); confirmation.addEventListener('keydown', event => trap(event, confirmation));
      document.getElementById('modal-root').append(confirmation); lockBackground(true);
    }
    const focus = document.activeElement?.dataset?.scanAction;
    confirmation.innerHTML = `<section class="scan-dialog scan-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="scan-confirm-title"><span class="scan-eyebrow">扫码送货单 · 待确认</span><h2 id="scan-confirm-title">请确认并保存本单</h2><button type="button" class="scan-customer-button" data-scan-action="customer">客户：${esc(d.customer?.name || (d.walkIn ? '散客' : '尚未选择，点击选择'))}</button><div class="scan-summary"><span>${d.items.length} 种商品 · ${esc(fmtNum(sumQuantities(d.items.map(item => item.qty))))} 件</span><strong>¥${fmtMoney(total())}</strong></div>${d.issues.length ? `<p class="scan-error">有 ${d.issues.length} 条待处理扫码，请返回处理后保存。</p>` : ''}${queued ? `<div class="scan-queue-notice" role="status">确认期间收到 ${queued} 次新扫码，已暂存。请选择补入本单，或保存本单后用于下一单。</div>` : '<p class="scan-muted">本单已保留。确认前不会自动保存，也不会自动开下一单。</p>'}<details><summary>查看本单明细</summary><ul class="scan-review-items">${d.items.map(item => `<li><span>${esc(item.name)} ${esc(item.spec)}</span><span>${esc(fmtNum(item.qty))}${esc(item.unit)} × ¥${esc(fmtPrice(item.price))}</span></li>`).join('')}</ul></details><p class="scan-error" data-confirm-error>${esc(model.error)}</p><div class="scan-actions"><button type="button" class="btn btn-primary scan-save-button" data-scan-action="save">${d.customer || d.walkIn ? (queued ? '保存本单，再开下一单' : '保存单据') : '选择客户后保存'}</button><button type="button" class="btn btn-ghost" data-scan-action="continue">${queued ? '补入本单，继续扫描' : '继续本单'}</button></div><div class="scan-confirm-footer"><button type="button" class="scan-link" data-scan-action="edit">返回修改 / 处理异常</button><button type="button" class="scan-link" data-scan-action="discard">放弃本单…</button></div></section>`;
    const restore = focus ? confirmation.querySelector('[data-scan-action="' + focus + '"]') : confirmation.querySelector('[data-scan-action="continue"]'); restore?.focus({ preventScroll: true });
  }
  function save() {
    if (!draft()?.customer && !draft()?.walkIn) { selectCustomer(); return; }
    try {
      const saved = model.save(current().queued.length > 0);
      closeConfirmation();
      toast(saved?.no ? '已保存 ' + saved.no + ' · ' + (saved.customer?.name || '散客') + ' · ¥' + fmtMoney(saved.total) : '已恢复保存状态'); feedback(true);
      update(); focusScan();
    } catch (error) { toast(error.message, true); update(); const label = confirmation?.querySelector('[data-confirm-error]'); if (label) label.textContent = error.message; }
  }
  async function click(event) {
    const button = event.target.closest('[data-scan-action]'); if (!button) return;
    const action = button.dataset.scanAction;
    if (action === 'finish') {
      const invalid = view?.querySelector('[data-line-field]:invalid');
      if (invalid) { invalid.reportValidity(); toast('请先修正标红的数量或单价，再结束本单', true); return; }
    }
    if (action === 'customer') selectCustomer();
    else if (action === 'settings') configure();
    else if (action === 'finish') guarded(() => model.confirm());
    else if (action === 'save') save();
    else if (action === 'continue' || action === 'edit') { guarded(() => model.resume(action === 'continue')); closeConfirmation(); update(); if (!view?.isConnected) open(); else focusScan(); }
    else if (action === 'undo') { guarded(() => model.undo()); focusScan(); }
    else if (action === 'retry') { guarded(() => model.retry()); focusScan(); }
    else if (action === 'export') exportJournal();
    else if (action === 'resolve') resolveIssue(button.dataset.issueId);
    else if (action === 'confirm-price') { const item = draft()?.items.find(item => item.lineId === button.dataset.lineId); if (item) guarded(() => model.edit(item.lineId, 'price', item.price)); }
    else if (action === 'remove-issue') { if (await ask('移除这次扫码？', '仅移除此扫码记录，不会删除商品资料。')) guarded(() => model.removeIssue(button.dataset.issueId)); }
    else if (action === 'remove-line') { if (await ask('移除该商品行？', '本行全部数量将从当前草稿中移除。')) guarded(() => model.remove(button.dataset.lineId)); }
    else if (action === 'discard') {
      if (await ask('放弃当前扫码单？', '本单的商品、待处理扫码和暂存扫码都将被删除。已保存的历史单据不受影响。')) { guarded(() => model.discard()); closeConfirmation(); update(); focusScan(); }
    } else if (action === 'home') window.DNSDesktop.navigate('#/orders');
    else if (action === 'queue') { guarded(() => model.resume(true)); focusScan(); }
  }
  function renderView() {
    ensure(); const element = document.createElement('div'); element.className = 'view active scan-order-view'; view = element;
    element.addEventListener('click', click);
    element.addEventListener('input', event => {
      const input = event.target.closest('[data-line-field]'); if (!input || !draft()) return;
      try { model.edit(input.dataset.lineId, input.dataset.lineField, input.value); input.setCustomValidity(''); input.classList.remove('scan-invalid'); updateTotals(); }
      catch (error) { input.setCustomValidity(error.message); input.classList.add('scan-invalid'); if (model.error) update(); }
    });
    element.addEventListener('change', event => {
      const input = event.target.closest('[data-line-field]'); if (!input) return;
      if (!input.checkValidity()) { input.reportValidity(); return; }
      update(); focusScan();
    });
    element.dispose = () => { if (view === element) view = null; };
    paint(); requestAnimationFrame(focusScan); return element;
  }
  function paint() {
    if (!view) return;
    const d = draft();
    view.innerHTML = `<div class="pad scan-order-content"><div class="scan-heading"><div><span class="scan-eyebrow">扫码接单</span><h1>${d ? '正在记录新的送货单' : '等待第一件商品'}</h1></div><button type="button" class="btn btn-ghost btn-sm" data-scan-action="settings">扫码设置</button></div><p class="scan-muted">本地草稿随扫描保存，停止开单操作 60 秒后提醒确认。软件须保持在前台。</p>${model.error ? `<div class="scan-error-box" role="alert"><p>${esc(model.error)}</p><button class="btn btn-ghost" data-scan-action="retry" ${model.damaged ? 'disabled' : ''}>重试写入 / 恢复状态</button><button class="btn btn-ghost" data-scan-action="export">导出当前草稿</button></div>` : ''}<label class="scan-entry">扫描商品条码<input data-scan-input autocomplete="off" spellcheck="false" placeholder="对准扫码枪扫描，或输入条码后按回车" ${prefs.enabled && !model.damaged ? '' : 'disabled'}></label><div class="scan-live-status" data-scan-countdown role="status"></div>${d ? `<div class="scan-order-toolbar"><button class="scan-customer-button" data-scan-action="customer">客户：${esc(d.customer?.name || (d.walkIn ? '散客' : '尚未选择'))}</button><span>${esc(d.date)} · 保存时生成单号</span><button type="button" class="btn btn-ghost btn-sm" data-scan-action="undo" ${model.canUndo ? '' : 'disabled'}>撤销上一扫</button></div>${current().queued.length ? `<div class="scan-queue-notice">另有 ${current().queued.length} 次扫码待确认归属。<button class="scan-link" data-scan-action="queue">明确补入本单</button></div>` : ''}<div class="scan-table-wrap"><table class="scan-items-table"><thead><tr><th>商品 / 规格</th><th>数量</th><th>单价</th><th>金额</th><th></th></tr></thead><tbody>${d.items.map(item => `<tr><td><b>${esc(item.name)}</b><span>${esc([item.spec, item.unit, item.barcode].filter(Boolean).join(' · '))}</span>${item.needsPrice ? '<button type="button" class="scan-link scan-error" data-scan-action="confirm-price" data-line-id="' + esc(item.lineId) + '">缺少默认价，确认当前单价</button>' : ''}</td><td><input aria-label="${esc(item.name)}数量" type="number" min="0" step="any" data-line-id="${esc(item.lineId)}" data-line-field="qty" value="${esc(item.qty)}"></td><td><input aria-label="${esc(item.name)}单价" type="number" min="0" step="any" data-line-id="${esc(item.lineId)}" data-line-field="price" value="${esc(item.price)}"></td><td data-line-amount="${esc(item.lineId)}">¥${fmtMoney(item.amount)}</td><td><button type="button" class="scan-link" data-scan-action="remove-line" data-line-id="${esc(item.lineId)}">移除</button></td></tr>`).join('') || '<tr><td colspan="5" class="scan-empty">等待扫描商品；未登记条码会保留在下方。</td></tr>'}</tbody></table></div>${d.issues.length ? `<section class="scan-issues" aria-label="待处理扫码"><h2>待处理扫码 ${d.issues.length}</h2>${d.issues.map(record => `<div class="scan-issue"><div><b>${esc(record.code)}</b><span>${esc(record.reason)}</span></div><button class="btn btn-ghost btn-sm" data-scan-action="resolve" data-issue-id="${esc(record.id)}">处理</button><button class="scan-link" data-scan-action="remove-issue" data-issue-id="${esc(record.id)}">移除</button></div>`).join('')}</section>` : ''}<div class="scan-bottom"><strong data-scan-total>合计 ¥${fmtMoney(total())}</strong><button class="btn btn-primary" data-scan-action="finish">提前结束本单</button></div><div class="scan-bottom-links"><button class="scan-link" data-scan-action="home">保留草稿，返回首页</button><button class="scan-link" data-scan-action="discard">放弃本单…</button></div>` : '<div class="scan-empty"><b>扫一下，就开始记货</b><p>同一商品重复扫描会累加数量。没有登记的条码会保留，处理完再保存。</p><button class="btn btn-ghost" data-scan-action="home">返回送货单首页</button></div>'}</div>`;
    updateTotals();
  }
  function updateTotals() {
    const element = view?.querySelector('[data-scan-total]'); if (element) element.textContent = '合计 ¥' + fmtMoney(total());
    if (view && draft()) for (const item of draft().items) { const cell = view.querySelector('[data-line-amount="' + item.lineId + '"]'); if (cell) cell.textContent = '¥' + fmtMoney(item.amount); }
  }
  function update() {
    paint(); if (current().phase === 'confirm') showConfirmation(); else closeConfirmation(); status();
  }
  function status() {
    const button = document.querySelector('[data-scanner-launch]');
    const paused = !available() || (editable(document.activeElement) && !document.activeElement.matches('[data-scan-input]') && prefs.mode !== 'prefix');
    if (button) {
      button.textContent = model.error ? '扫码草稿异常' : !prefs.enabled ? '扫码接单：已暂停' : draft() ? '恢复扫码单' : paused ? '扫码暂停 · 当前操作中' : '扫码接单：已开启';
      button.dataset.active = String(!!draft());
    }
    const countdown = view?.querySelector('[data-scan-countdown]');
    if (countdown) countdown.textContent = !prefs.enabled ? '扫码接单已暂停，可在扫码设置中开启。' : model.error ? '请先处理草稿存储异常。' : !draft() ? '等待扫描第一件商品' : current().phase === 'confirm' ? '请确认当前单据' : otherModal() || (editable(document.activeElement) && !document.activeElement.matches('[data-scan-input]')) ? '正在处理本单，计时已暂停' : '草稿已保留 · ' + Math.max(0, Math.ceil((60000 - (Date.now() - current().lastActivity)) / 1000)) + ' 秒后提醒保存';
  }
  function tick() {
    if (!started) return;
    const interacting = otherModal() || !!document.querySelector('[data-line-field]:focus,.scan-order-view .scan-invalid') || !prefs.enabled;
    const paused = interacting || document.hidden;
    if (previousPaused && !interacting && draft() && current().phase === 'scanning') guarded(() => model.activity());
    previousPaused = interacting;
    if (!paused && !model.damaged) { try { if (model.tick(false)) update(); } catch (_) { update(); } }
    status();
    if (current().phase === 'confirm' && !confirmation && !otherModal()) showConfirmation();
  }
  function start() {
    if (started) return; ensure(); started = true;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'scanner-launch'; button.dataset.scannerLaunch = ''; button.title = '扫码接单 / 恢复扫码草稿';
    button.addEventListener('click', () => { if (draft() || model.error) open(); else configure(); });
    document.querySelector('#desktop-app .new-order-button')?.before(button);
    document.addEventListener('keydown', keydown, true);
    timer = setInterval(tick, 250);
    unsubscribe = Store.subscribe(() => { status(); });
    update();
    if (draft()) { toast('发现未完成的扫码单，已保留，可点击“恢复扫码单”继续'); open(); }
  }
  function stop() {
    if (!started) return; started = false; clearInterval(timer); unsubscribe?.();
    document.removeEventListener('keydown', keydown, true); closeConfirmation(); document.querySelector('[data-scanner-launch]')?.remove();
    document.querySelectorAll('.scan-form-mask').forEach(mask => mask.remove()); resetInput(); view = null; model = null;
  }
  function clearForReplacement() {
    try { storage.removeItem(ScanSession.KEY); closeConfirmation(); model = null; ensure(); update(); }
    catch (_) { prefs.enabled = false; toast('业务数据已替换，但旧扫码草稿未能清理，已暂停扫码接单。请检查存储空间。', true); }
  }
  window.Views.scanOrder = { render: renderView };
  return { start, stop, configure, open, clearForReplacement, get session() { return ensure(); }, get prefs() { return { ...prefs }; }, blocksNavigation(hash) { return !!draft() && current().phase === 'confirm' && hash !== '#/order/scan'; } };
})();
