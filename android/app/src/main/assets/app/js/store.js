/* ============================================================
 * store.js — 数据层：设置/客户/商品/单据/一客一价/序号
 * 全部存于 localStorage，纯本地、离线可用
 * ============================================================ */
'use strict';

const Store = (() => {
  const K = {
    settings: 'sd_v1_settings',
    customers: 'sd_v1_customers',
    products: 'sd_v1_products',
    orders: 'sd_v1_orders',
    lastPrices: 'sd_v1_lastprices',
    seqMap: 'sd_v1_seqmap',
  };
  const DEFAULTS = {
    settings: {
      company: '',
      phone: '',
      address: '',
      contact: '',
      noPrefix: 'SD',
      operator: '',
      note: '以上货物请当面核对，清楚无误后签字，如有质量问题，请在收货3天内通知本公司，感谢您的支持与配合！',
      billTitle: '{year}年{customer}与{company}{month}月账单',
      // 商品图片存储目录；留空表示使用默认目录（应用所在目录下的 CommercesData）
      imageDir: '',
    },
    customers: [],
    products: [],
    orders: [],
    lastPrices: {},
    seqMap: {},
  };

  let cache = null;
  function load() {
    if (cache) return cache;
    cache = {};
    Object.keys(K).forEach(k => {
      try {
        const raw = localStorage.getItem(K[k]);
        cache[k] = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(DEFAULTS[k]));
      } catch (e) {
        cache[k] = JSON.parse(JSON.stringify(DEFAULTS[k]));
      }
    });
    return cache;
  }
  function persist() {
    Object.keys(K).forEach(k => {
      try { localStorage.setItem(K[k], JSON.stringify(cache[k])); } catch (e) { /* 容量超限 */ }
    });
  }

  /* ---------- 初始商品目录 ----------
   * 首次运行把随应用附带的初始商品写入商品库（barcode/name/unit/spec/category）。
   * 用一次性标记，且按条码或「名称+规格」去重，避免重复写入或覆盖用户数据。
   */
  const SEED_FLAG = 'sd_v1_seed_products_v1';
  const SEED_CAT_FLAG = 'sd_v1_seed_products_cat_v1';
  function seedKey(name, spec) {
    const norm = v => String(v == null ? '' : v).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    return norm(name) + '\u0000' + norm(spec);
  }
  function seedInitialProducts() {
    try {
      const seeds = Array.isArray(window.SEED_PRODUCTS) ? window.SEED_PRODUCTS : [];
      if (localStorage.getItem(SEED_FLAG) !== '1') {
        const seenBarcode = new Set(d.products.filter(p => p.barcode).map(p => String(p.barcode).trim()));
        const seenKey = new Set(d.products.map(p => seedKey(p.name, p.spec)));
        const now = Date.now();
        let added = 0;
        seeds.forEach((s, i) => {
          const item = {
            barcode: String(s && s.barcode || '').trim(),
            name: String(s && s.name || '').trim(),
            unit: String(s && s.unit || '').trim(),
            spec: String(s && s.spec || '').trim(),
            category: String(s && s.category || '').trim(),
          };
          if (!item.name) return;
          if (item.barcode && seenBarcode.has(item.barcode)) return;
          const key = seedKey(item.name, item.spec);
          if (seenKey.has(key)) return;
          d.products.push({ id: uid(), createdAt: now - i, ...item });
          if (item.barcode) seenBarcode.add(item.barcode);
          seenKey.add(key);
          added++;
        });
        if (added) persist();
        localStorage.setItem(SEED_FLAG, '1');
      }
      // 老版本已入库的初始商品没有分类，这里按「名称+规格」补一次（不覆盖用户自己设的分类）
      if (localStorage.getItem(SEED_CAT_FLAG) !== '1') {
        const catMap = new Map();
        seeds.forEach(s => {
          const c = String(s && s.category || '').trim();
          if (c) catMap.set(seedKey(s.name, s.spec), c);
        });
        let patched = 0;
        d.products.forEach(p => {
          if (p && p.category) return;
          const c = catMap.get(seedKey(p.name, p.spec));
          if (c) { p.category = c; patched++; }
        });
        if (patched) persist();
        localStorage.setItem(SEED_CAT_FLAG, '1');
      }
    } catch (_) { /* localStorage 不可用时忽略 */ }
  }
  const d = load();
  seedInitialProducts();

  /* ---------- 设置 ---------- */
  function getSettings() { return d.settings; }
  function setSettings(patch) {
    Object.assign(d.settings, patch);
    persist();
  }

  /* ---------- 客户 ---------- */
  function listCustomers(keyword) {
    let arr = d.customers.slice();
    if (keyword) {
      const kw = String(keyword).trim().toLowerCase();
      arr = arr.filter(c => (c.name + (c.phone || '') + (c.address || '') + (c.contact || '')).toLowerCase().includes(kw));
    }
    return arr.sort(compareCustomerNames);
  }
  function getCustomer(id) { return d.customers.find(c => c.id === id); }
  function upsertCustomer(data) {
    if (data.id && getCustomer(data.id)) {
      Object.assign(getCustomer(data.id), data);
      persist();
      return getCustomer(data.id);
    }
    const c = { id: uid(), createdAt: Date.now(), ...data };
    d.customers.unshift(c);
    persist();
    return c;
  }
  function deleteCustomer(id) {
    d.customers = d.customers.filter(c => c.id !== id);
    persist();
  }
  function countCustomerOrders(id) {
    return d.orders.filter(o => o.customer && o.customer.id === id).length;
  }

  /* ---------- 商品 ---------- */
  function listProducts(keyword) {
    let arr = d.products.slice();
    if (keyword) {
      const kw = String(keyword).trim().toLowerCase();
      arr = arr.filter(p => (p.name + (p.code || '') + (p.spec || '')).toLowerCase().includes(kw));
    }
    return arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  function getProduct(id) { return d.products.find(p => p.id === id); }
  function upsertProduct(data) {
    if (data.id && getProduct(data.id)) {
      Object.assign(getProduct(data.id), data);
      persist();
      return getProduct(data.id);
    }
    const p = { id: uid(), createdAt: Date.now(), ...data };
    d.products.unshift(p);
    persist();
    return p;
  }
  function deleteProduct(id) {
    d.products = d.products.filter(p => p.id !== id);
    persist();
  }

  /* ---------- 单据 ---------- */
  function listOrders(filter) {
    let arr = d.orders.slice();
    if (filter) {
      if (filter.from) arr = arr.filter(o => o.date >= filter.from);
      if (filter.to) arr = arr.filter(o => o.date <= filter.to);
      if (filter.keyword) {
        const kw = String(filter.keyword).trim().toLowerCase();
        arr = arr.filter(o =>
          (o.no + ' ' + ((o.customer && o.customer.name) || '')).toLowerCase().includes(kw));
      }
    }
    return arr.sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : (a.date < b.date ? 1 : -1)));
  }
  function getOrder(id) { return d.orders.find(o => o.id === id); }
  function addOrder(data) {
    const o = { id: uid(), createdAt: Date.now(), updatedAt: Date.now(), ...data };
    d.orders.unshift(o);
    persist();
    return o;
  }
  function updateOrder(id, data) {
    const o = getOrder(id);
    if (!o) return null;
    Object.assign(o, data, { updatedAt: Date.now() });
    persist();
    return o;
  }
  function deleteOrder(id) {
    d.orders = d.orders.filter(o => o.id !== id);
    persist();
  }
  function orderIndex(id) {
    const sorted = listOrders();
    return sorted.findIndex(o => o.id === id);
  }
  function siblingOrder(id, dir) {
    const sorted = listOrders();
    const i = sorted.findIndex(o => o.id === id);
    if (i < 0) return null;
    const j = i + dir;
    return sorted[j] || null;
  }

  /* ---------- 单号 ---------- */
  function nextOrderNo(date) {
    const day = date || todayStr();
    const s = d.seqMap[day] || 0;
    d.seqMap[day] = s + 1;
    persist();
    const prefix = (d.settings.noPrefix || 'SD').trim();
    const ymd = day.replace(/-/g, '');
    return prefix + '-' + ymd + '-' + pad3(s + 1);
  }
  function pad3(n) { return (n < 100 ? '0' : '') + (n < 10 ? '0' : '') + n; }
  function reclaimNo(no) { // 删除单据后回退序号（仅当是当天最后一张）
    const m = String(no || '').match(/-(\d{8})-(\d{3})$/);
    if (!m) return;
    const day = m[1].slice(0, 4) + '-' + m[1].slice(4, 6) + '-' + m[1].slice(6, 8);
    const seq = parseInt(m[2], 10);
    if (d.seqMap[day] === seq) {
      d.seqMap[day] = seq - 1;
      persist();
    }
  }

  /* ---------- 一客一价 ---------- */
  function getLastPrice(custId, pid) {
    if (!custId || !pid) return null;
    const v = d.lastPrices[custId + ':' + pid];
    return v == null ? null : Number(v);
  }
  function setLastPrice(custId, pid, price) {
    if (!custId || !pid || price == null || price === '') return;
    d.lastPrices[custId + ':' + pid] = Number(price);
    persist();
  }

  /* ---------- 备份 / 恢复 ---------- */
  function exportJSON() {
    return JSON.stringify({
      app: 'songhuodan',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        settings: d.settings,
        customers: d.customers,
        products: d.products,
        orders: d.orders,
        lastPrices: d.lastPrices,
        seqMap: d.seqMap,
      },
    }, null, 2);
  }
  function importJSON(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error('备份文件内容不是有效的 JSON，已取消恢复。'); }
    if (!obj || obj.app !== 'songhuodan' || !obj.data) throw new Error('不是有效的送货单统计备份文件');
    const src = obj.data;
    // 先校验类型，全部通过后再落盘，避免写入一半导致数据半新半旧
    const isArr = v => Array.isArray(v);
    const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
    if (src.settings != null && !isObj(src.settings)) throw new Error('备份中的设置数据格式不正确');
    if (src.customers != null && !isArr(src.customers)) throw new Error('备份中的客户数据格式不正确');
    if (src.products != null && !isArr(src.products)) throw new Error('备份中的商品数据格式不正确');
    if (src.orders != null && !isArr(src.orders)) throw new Error('备份中的单据数据格式不正确');
    if (src.lastPrices != null && !isObj(src.lastPrices)) throw new Error('备份中的价格记录格式不正确');
    if (src.seqMap != null && !isObj(src.seqMap)) throw new Error('备份中的单号序号格式不正确');
    // 完整覆盖：备份里缺的字段回落到默认值，而不是保留当前旧数据
    Object.keys(K).forEach(k => {
      if (src[k] != null) d[k] = src[k];
      else d[k] = JSON.parse(JSON.stringify(DEFAULTS[k]));
    });
    // 合并默认设置，保证新增设置项有值
    d.settings = Object.assign(JSON.parse(JSON.stringify(DEFAULTS.settings)), d.settings);
    persist();
  }

  /* ---------- CSV 导出 ---------- */
  function csvEscape(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(rows) {
    return rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  }
  function ordersCSV(filter) {
    const rows = [['单号', '日期', '客户名称', '客户电话', '联系人', '产品名称', '规格', '单位', '数量', '单价', '金额', '备注', '制单人']];
    listOrders(filter).forEach(o => {
      (o.items || []).forEach(it => {
        rows.push([o.no, o.date, (o.customer && o.customer.name) || '', (o.customer && o.customer.phone) || '', (o.customer && o.customer.contact) || '',
          it.name, it.spec || '', it.unit || '', it.qty, it.price, it.amount, it.remark || '', o.operator || '']);
      });
    });
    return toCSV(rows);
  }
  function customersCSV() {
    const rows = [['编号', '客户名称', '电话', '地址', '联系人', '备注']];
    listCustomers().forEach((c, i) => rows.push([i + 1, c.name, c.phone || '', c.address || '', c.contact || '', c.remark || '']));
    return toCSV(rows);
  }
  function productsCSV() {
    const rows = [['编号', '条码', '产品名称', '型号规格', '单位', '零售价', '成本价', '产品备注']];
    listProducts().forEach((p, i) => rows.push([p.code || (i + 1), p.barcode || '', p.name, p.spec || '', p.unit || '', p.price == null ? '' : p.price, p.cost == null ? '' : p.cost, p.remark || '']));
    return toCSV(rows);
  }

  /* ---------- CSV 导入 ---------- */
  function parseCSV(text) {
    text = assertImportText(String(text)).replace(/\r\n?/g, '\n');
    const firstLine = text.split('\n', 1)[0];
    const separators = [',', '\t', ';'];
    const counts = separators.map(separator => {
      let count = 0, quoted = false;
      for (const ch of firstLine) { if (ch === '"') quoted = !quoted; else if (!quoted && ch === separator) count++; }
      return count;
    });
    const separator = separators[counts.indexOf(Math.max(...counts))];
    const rows = [];
    let row = [], cur = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else if (ch === '"') {
        if (cur.trim()) throw new Error('CSV 引号格式不正确，请重新导出文件。');
        cur = ''; inQ = true;
      } else if (ch === separator) {
        row.push(cur); cur = '';
      } else if (ch === '\n') {
        row.push(cur);
        if (row.some(cell => cell.trim())) rows.push(row);
        row = []; cur = '';
      } else cur += ch;
    }
    if (inQ) throw new Error('CSV 引号未闭合，请重新导出文件。');
    row.push(cur);
    if (row.some(cell => cell.trim())) rows.push(row);
    if (rows.length) {
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].length > rows[0].length) throw new Error('CSV 第 ' + (i + 1) + ' 行列数不正确，请检查逗号或引号。');
      }
    }
    return rows;
  }
  function importProductsCSV(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('没有可导入的商品数据');
    const header = rows[0].map(h => h.trim());
    const idx = {
      code: header.findIndex(h => /编号|编码/.test(h)),
      barcode: header.findIndex(h => /条码/.test(h)),
      name: header.findIndex(h => /^(?:(?:产品|商品|货品)(?:名称|名)|名称|品名|productname|name)$/i.test(h.replace(/\s/g, ''))),
      spec: header.findIndex(h => /规格|型号/.test(h)),
      unit: header.findIndex(h => /单位/.test(h)),
      price: header.findIndex(h => /零售价|价格|售价|单价/.test(h)),
      cost: header.findIndex(h => /成本/.test(h)),
      remark: header.findIndex(h => /备注/.test(h)),
    };
    if (idx.name < 0) throw new Error('未识别到“产品名称”表头，请选择正确的商品 CSV 文件。');
    function parseMoney(v) {
      if (v == null) return undefined;
      const s = String(v).trim();
      if (s === '') return undefined;
      const n = Number(s);
      return Number.isFinite(n) ? n : undefined;
    }
    let added = 0, skipped = 0;
    const existsName = new Set(d.products.map(p => p.name));
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[idx.name] || '').trim();
      if (!name) continue;
      if (existsName.has(name)) { skipped++; continue; }
      upsertProduct({
        name,
        code: String(idx.code >= 0 ? r[idx.code] || '' : '').trim(),
        barcode: String(idx.barcode >= 0 ? r[idx.barcode] || '' : '').trim(),
        spec: String(idx.spec >= 0 ? r[idx.spec] || '' : '').trim(),
        unit: String(idx.unit >= 0 ? r[idx.unit] || '' : '').trim(),
        price: idx.price >= 0 ? parseMoney(r[idx.price]) : undefined,
        cost: idx.cost >= 0 ? parseMoney(r[idx.cost]) : undefined,
        remark: String(idx.remark >= 0 ? r[idx.remark] || '' : '').trim(),
      });
      existsName.add(name);
      added++;
    }
    return { added, skipped };
  }
  function importCustomersCSV(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('没有可导入的客户数据');
    const header = rows[0].map(h => h.trim());
    const idx = {
      name: header.findIndex(h => /^(?:客户名称|客户名|名称|姓名|customer(?:name)?|name)$/i.test(h.replace(/\s/g, ''))),
      phone: header.findIndex(h => /电话|手机|联系电话/.test(h)),
      address: header.findIndex(h => /地址/.test(h)),
      contact: header.findIndex(h => /联系人/.test(h)),
      remark: header.findIndex(h => /备注/.test(h)),
    };
    if (idx.name < 0) throw new Error('未识别到“客户名称”表头，请选择正确的客户 CSV 文件，Excel 文件需先另存为 CSV。');
    let skipped = 0;
    const pending = [];
    const nameKey = name => String(name || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    const existsName = new Set(d.customers.map(c => nameKey(c.name)));
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[idx.name] || '').trim();
      if (!name) continue;
      if (existsName.has(nameKey(name))) { skipped++; continue; }
      pending.push({
        name,
        phone: String(idx.phone >= 0 ? r[idx.phone] || '' : '').trim(),
        address: String(idx.address >= 0 ? r[idx.address] || '' : '').trim(),
        contact: String(idx.contact >= 0 ? r[idx.contact] || '' : '').trim(),
        remark: String(idx.remark >= 0 ? r[idx.remark] || '' : '').trim(),
      });
      existsName.add(nameKey(name));
    }
    if (pending.length) {
      d.customers = pending.map(customer => ({ id: uid(), createdAt: Date.now(), ...customer })).concat(d.customers);
      persist();
    }
    return { added: pending.length, skipped };
  }

  /* ---------- 月度账单（按客户分组） ---------- */
  function billGroups(ym) {
    const from = ym + '-01', to = ym + '-31';
    const list = listOrders({ from, to });
    const groups = {};
    list.forEach(o => {
      const key = o.customer && o.customer.id ? o.customer.id : '__san__';
      const name = o.customer ? o.customer.name : '散客';
      if (!groups[key]) groups[key] = { key, name, orders: [], total: 0 };
      groups[key].orders.push(o);
      groups[key].total += o.total || 0;
    });
    const arr = Object.values(groups);
    arr.forEach(g => {
      g.orders.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      g.total = Math.round(g.total * 100) / 100;
    });
    arr.sort((a, b) => b.total - a.total);
    return arr;
  }

  /* 单据明细表（供 Excel 导出） */
  function ordersTable(from, to) {
    return listOrders({ from, to }).map(o => ({
      date: o.date, no: o.no,
      customer: o.customer ? o.customer.name : '散客',
      qty: o.items.reduce((a, i) => a + (Number(i.qty) || 0), 0),
      total: o.total || 0,
      note: o.note || '',
    }));
  }

  function clearAll() {
    Object.keys(K).forEach(k => { d[k] = JSON.parse(JSON.stringify(DEFAULTS[k])); });
    persist();
  }
  function countAll() {
    return { orders: d.orders.length, customers: d.customers.length, products: d.products.length };
  }

  return {
    getSettings, setSettings,
    listCustomers, getCustomer, upsertCustomer, deleteCustomer, countCustomerOrders,
    listProducts, getProduct, upsertProduct, deleteProduct,
    listOrders, getOrder, addOrder, updateOrder, deleteOrder, orderIndex, siblingOrder,
    nextOrderNo, reclaimNo,
    getLastPrice, setLastPrice,
    exportJSON, importJSON,
    ordersCSV, customersCSV, productsCSV,
    billGroups, ordersTable,
    importProductsCSV, importCustomersCSV,
    clearAll, countAll,
  };
})();
