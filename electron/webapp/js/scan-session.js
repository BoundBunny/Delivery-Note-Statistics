'use strict';
/* Scanner sessions are a separate journal: drafts never enter sales or statements. */
(function (root) {
  const KEY = 'sd_v1_scan_session_v2';
  const copy = value => JSON.parse(JSON.stringify(value));
  const money = value => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0 && Number.isSafeInteger(Math.round(Number(value) * 100));
  const validCode = code => typeof code === 'string' && code.length > 0 && code.length <= 128 && !/[\x00-\x20\x7f]/.test(code);
  function create(options) {
    const { storage, store, plan, now, id, today } = options;
    const fresh = () => ({ version: 2, phase: 'idle', draft: null, queued: [], lastActivity: 0, afterSave: 'idle' });
    let state = fresh(), error = '', damaged = false, history = [];
    function validate(value) {
      if (!value || value.version !== 2 || !['idle', 'scanning', 'confirm'].includes(value.phase)
          || !Array.isArray(value.queued) || !Number.isFinite(value.lastActivity) || !['idle', 'next'].includes(value.afterSave)) throw new Error('invalid journal');
      const records = records => records.every(record => record && typeof record.id === 'string' && validCode(record.code));
      if (!records(value.queued)) throw new Error('invalid queue');
      const d = value.draft;
      if (!d) { if (value.phase !== 'idle' || value.queued.length) throw new Error('orphan queue'); return; }
      if (value.phase === 'idle' || typeof d.id !== 'string' || !d.id || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)
          || !Array.isArray(d.items) || !Array.isArray(d.issues) || !records(d.issues) || typeof d.walkIn !== 'boolean'
          || (d.customer != null && (typeof d.customer.id !== 'string' || typeof d.customer.name !== 'string'))
          || !d.items.every(item => item && typeof item.lineId === 'string' && typeof item.pid === 'string'
            && typeof item.name === 'string' && item.name.trim() && Number(item.qty) > 0 && money(item.price)
            && Number.isSafeInteger(Math.round(Number(item.qty) * Number(item.price) * 100)))) throw new Error('invalid draft');
    }
    try {
      const raw = storage.getItem(KEY);
      if (raw) { state = JSON.parse(raw); validate(state); }
    } catch (_) { damaged = true; error = '扫码草稿无法读取，已停止扫码接单。原始草稿未被覆盖，请先导出并检查数据。'; state = fresh(); }
    function persist() {
      if (damaged) throw new Error(error);
      try { storage.setItem(KEY, JSON.stringify(state)); error = ''; }
      catch (_) { error = '草稿写入失败，当前内容仍在内存中。请勿退出，检查存储空间后重试。'; throw new Error(error); }
    }
    function begin() {
      state.draft = { id: id(), date: today(), operator: options.operator?.() || '', customer: null, walkIn: false, items: [], issues: [], createdAt: now() };
      state.phase = 'scanning'; state.afterSave = 'idle'; history = [];
    }
    const touch = () => { state.lastActivity = now(); };
    function priceFor(product) {
      const manual = state.draft.items.slice().reverse().find(item => item.pid === product.id && item.manualPrice);
      if (manual) return { price: manual.price, manualPrice: true };
      const price = state.draft.customer ? store.getLastPrice(state.draft.customer.id, product.id) : null;
      return { price: price != null && price !== '' ? price : product.price, manualPrice: false };
    }
    function append(product, code, override) {
      const chosen = override == null ? priceFor(product) : { price: override, manualPrice: true };
      if (!money(chosen.price)) throw new Error('请先设置有效售价');
      const d = state.draft;
      const result = plan(d.items, { lineId: id(), pid: product.id, barcode: code, name: product.name, spec: product.spec || '', unit: product.unit || '', qty: '1', price: String(chosen.price), remark: '', manualPrice: chosen.manualPrice });
      result.item.manualPrice = !!(chosen.manualPrice || result.item.manualPrice);
      if (result.indices.length) {
        d.items[result.index] = result.item;
        for (let i = result.indices.length - 1; i > 0; i--) d.items.splice(result.indices[i], 1);
      } else d.items.push(result.item);
    }
    function apply(record) {
      const matches = store.listProducts('', { includeArchived: true }).filter(product => String(product.barcode || '').trim() === record.code);
      let reason = '';
      if (!matches.length) reason = '未登记条码';
      else if (matches.length > 1) reason = '条码对应多个商品，请明确选择';
      else if (matches[0].archived) reason = '商品已下架';
      else if (!money(priceFor(matches[0]).price)) reason = '商品尚未设置售价';
      if (!reason) {
        try { append(matches[0], record.code); }
        catch (exception) { reason = exception.message; }
      }
      if (reason) state.draft.issues.push({ ...record, reason });
      return !reason;
    }
    function applyWithHistory(record) {
      history.push(copy({ items: state.draft.items, issues: state.draft.issues })); if (history.length > 20) history.shift();
      return apply(record);
    }
    function finish() {
      const queue = state.queued.slice(), startNext = state.afterSave === 'next';
      state = fresh(); history = [];
      if (queue.length) {
        begin();
        if (startNext) queue.forEach(applyWithHistory);
        else { state.queued = queue; state.phase = 'confirm'; }
        touch();
      }
      persist();
    }
    function reconcile() {
      if (state.draft && store.getOrder(state.draft.id)) { finish(); return true; }
      return false;
    }
    if (!damaged) { try { reconcile(); } catch (_) { /* Keep the journal for retry. */ } }
    return {
      get state() { return state; }, get error() { return error; }, get damaged() { return damaged; },
      get canUndo() { return history.length > 0; },
      retry() { if (!reconcile()) persist(); },
      scan(code) {
        if (damaged) throw new Error(error);
        code = String(code).trim(); if (!validCode(code)) throw new Error('条码格式无效');
        if (!state.draft) begin();
        const record = { id: id(), code, time: now() };
        let accepted = false;
        if (state.phase === 'confirm' || error) state.queued.push(record);
        else {
          accepted = applyWithHistory(record);
        }
        touch(); persist(); return { accepted, queued: state.phase === 'confirm' };
      },
      activity() { if (state.draft && state.phase === 'scanning') { touch(); persist(); } },
      confirm() { if (state.draft) { state.phase = 'confirm'; persist(); } },
      tick(paused = false) {
        if (!paused && !error && state.draft && state.phase === 'scanning' && now() - state.lastActivity >= 60000) { state.phase = 'confirm'; persist(); return true; }
        return false;
      },
      resume(includeQueue = true) {
        if (includeQueue) { const records = state.queued.splice(0); records.forEach(applyWithHistory); }
        state.phase = 'scanning'; touch(); persist();
      },
      undo() {
        const previous = history.pop(); if (!previous || !state.draft) return;
        Object.assign(state.draft, previous); touch(); persist();
      },
      edit(lineId, field, value) {
        const item = state.draft?.items.find(item => item.lineId === lineId); if (!item) return;
        if (!['qty', 'price', 'remark'].includes(field)) throw new Error('不支持的修改');
        const candidate = { ...item, [field]: value };
        if (field !== 'remark' && (!money(candidate.price) || !Number.isFinite(Number(candidate.qty)) || Number(candidate.qty) <= 0
          || !Number.isSafeInteger(Math.round(Number(candidate.qty) * Number(candidate.price) * 100)))) throw new Error('数量须大于 0，单价须非负，金额不能超出范围');
        Object.assign(item, candidate); if (field === 'price') { item.manualPrice = true; item.needsPrice = false; }
        item.amount = Math.round(Number(item.qty) * Number(item.price) * 100) / 100;
        history = []; touch(); persist();
      },
      remove(lineId) { state.draft.items = state.draft.items.filter(item => item.lineId !== lineId); history = []; touch(); persist(); },
      setCustomer(customer, walkIn = false) {
        if (!state.draft) return;
        state.draft.customer = customer ? copy(customer) : null; state.draft.walkIn = !customer && walkIn;
        for (const item of state.draft.items) {
          if (item.manualPrice) continue;
          const product = store.getProduct(item.pid), price = customer ? store.getLastPrice(customer.id, item.pid) : null;
          const next = price != null && price !== '' ? price : product?.price;
          if (money(next)) { item.price = String(next); item.amount = Math.round(Number(item.qty) * Number(next) * 100) / 100; item.needsPrice = false; }
          else item.needsPrice = true;
        }
        history = []; touch(); persist();
      },
      removeIssue(issueId) { state.draft.issues = state.draft.issues.filter(record => record.id !== issueId); history = []; touch(); persist(); },
      resolve(issueId, values) {
        const issue = state.draft.issues.find(record => record.id === issueId); if (!issue) return;
        if (!money(values.price)) throw new Error('请填写有效售价');
        let product = values.pid ? store.getProduct(values.pid) : null;
        if (values.pid && !product) throw new Error('商品已不存在');
        if (product?.archived && !values.restore) throw new Error('请确认恢复上架后再加入');
        if (product) {
          if (!product.barcode) {
            store.assertProductBarcode({ id: product.id, barcode: issue.code });
            product = store.upsertProduct({ id: product.id, name: product.name, barcode: issue.code, price: Number(values.price), ...(values.restore ? { archived: false, archivedAt: null } : {}) });
          }
          else if (String(product.barcode).trim() !== issue.code) throw new Error('该商品已有其他条码，请选择无条码商品或新建商品');
          else if (values.restore || !money(product.price)) product = store.upsertProduct({ id: product.id, name: product.name, price: Number(values.price), ...(values.restore ? { archived: false, archivedAt: null } : {}) });
        } else {
          if (!String(values.name || '').trim()) throw new Error('请填写商品名称');
          store.assertProductBarcode({ barcode: issue.code });
          product = store.upsertProduct({ name: String(values.name).trim(), barcode: issue.code, spec: String(values.spec || '').trim(), unit: String(values.unit || '').trim(), price: Number(values.price) });
        }
        append(product, issue.code, Number(values.price));
        state.draft.issues = state.draft.issues.filter(record => record.id !== issueId);
        history = []; touch(); persist();
      },
      discard() { const previous = state; state = fresh(); try { persist(); history = []; } catch (exception) { state = previous; throw exception; } },
      save(next = false) {
        if (error) { if (reconcile()) return { recovered: true }; persist(); }
        const d = state.draft;
        if (!d) throw new Error('没有待保存的单据');
        if (!d.customer && !d.walkIn) throw new Error('请先选择客户，或明确选择散客');
        if (d.customer && !store.getCustomer(d.customer.id)) throw new Error('客户已不存在，请重新选择');
        if (d.issues.length) throw new Error('请先处理未登记、缺价等待处理扫码');
        if (d.items.some(item => item.needsPrice)) throw new Error('客户切换后有商品缺少默认售价，请逐项确认单价');
        if (!d.items.length) throw new Error('请至少加入一个商品');
        if (state.queued.length && !next) throw new Error('请先决定暂存扫码属于本单还是下一单');
        if (d.items.some(item => !money(item.price) || !Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0)) throw new Error('请检查商品数量和售价');
        state.afterSave = next ? 'next' : 'idle'; persist();
        const saved = store.getOrder(d.id) || store.transaction(() => {
          const items = d.items.map(item => ({ pid: item.pid, name: item.name, spec: item.spec, unit: item.unit, qty: Number(item.qty), price: Number(item.price), amount: Math.round(Number(item.qty) * Number(item.price) * 100) / 100, remark: item.remark || '' }));
          const total = items.reduce((cents, item) => cents + Math.round(item.amount * 100), 0) / 100;
          if (!Number.isSafeInteger(Math.round(total * 100))) throw new Error('合计金额超出范围');
          const prices = new Map(); items.forEach(item => prices.set(item.pid, item.price));
          if (d.customer) for (const [pid, price] of prices) store.setLastPrice(d.customer.id, pid, price);
          return store.addOrder({ id: d.id, no: store.nextOrderNo(d.date), date: d.date, operator: d.operator, customer: d.customer, items, total });
        });
        try { finish(); }
        catch (_) { const exception = new Error('单据已保存，草稿状态更新失败。请重试恢复状态，不要重新录入。'); exception.saved = saved; throw exception; }
        return saved;
      },
    };
  }
  const api = { create, KEY, validCode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ScanSession = api;
})(typeof window !== 'undefined' ? window : null);
