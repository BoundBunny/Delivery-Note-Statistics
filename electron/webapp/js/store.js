/* ============================================================
 * store.js — 数据层：设置/客户/商品/单据/一客一价/序号
 * ------------------------------------------------------------
 * 存储适配：
 *  - 桌面端（Electron）：window.__DNSStorage → 主进程把数据写进
 *    「安装目录相对路径」下的普通文件，并同时在程序目录之外留备份；
 *    程序被误删后重装，启动时自动从备份恢复。
 *  - 浏览器 / 单元测试：回退到原生 localStorage（行为完全一致）。
 * ============================================================ */
'use strict';

  /* 存储适配层：桌面端走文件后端，其它环境回退原生 localStorage */
  const LS = (typeof window !== 'undefined' && window.__DNSStorage)
    || (typeof localStorage !== 'undefined' ? localStorage : null)
    || (function () { /* 极端兜底：既没有桥也没有 localStorage 时的内存存储 */
      const mem = new Map();
      return {
        getItem: k => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => { mem.set(k, String(v)); },
        removeItem: k => { mem.delete(k); },
      };
    })();

  /* 旧版（localStorage 时代）数据搬迁：桌面端首次运行时，把还留在
   * localStorage 里的 sd_v1_* 数据搬到文件后端（安装目录相对路径）。
   * 搬完并确认文件后端确实有数据后，才删掉 localStorage 里的旧副本——
   * 否则用户「清空全部数据」后旧副本会让数据复活。 */
  function migrateLegacyStorage() {
    try {
      if (typeof window === 'undefined' || !window.__DNSStorage) return 0;
      const legacy = window.localStorage;
      if (!legacy) return 0;
      const keys = [];
      for (let i = 0; i < legacy.length; i++) {
        const key = legacy.key(i);
        if (key && key.indexOf('sd_v1_') === 0) keys.push(key);
      }
      let moved = 0;
      keys.forEach(key => {
        if (LS.getItem(key) == null) {
          const raw = legacy.getItem(key);
          if (raw != null) { LS.setItem(key, raw); moved++; }
        }
        // 文件后端已确认存在该键，才删除 localStorage 旧副本
        if (LS.getItem(key) != null) {
          try { legacy.removeItem(key); } catch (_) { /* ignore */ }
        }
      });
      if (moved) repairSeedFlagsAfterMigration();
      return moved;
    } catch (_) { return 0; }
  }

  /* 迁移一致性修复：旧 localStorage 里可能残留「商品已初始化」标记，
   * 但它对应的初始商品早已被删除/清空（本地只剩零散测试商品）。
   * 若迁移后商品库里一条内置商品都没有，就丢掉标记，
   * 让随后的 seedInitialProducts() 重新灌入初始商品（不影响用户自建的商品）。 */
  function repairSeedFlagsAfterMigration() {
    try {
      const SEED_FLAGS = ['sd_v1_seed_products_v1', 'sd_v1_seed_products_v2', 'sd_v1_seed_products_v3',
        'sd_v1_seed_products_v4', 'sd_v1_seed_products_cat_v1', 'sd_v1_seed_products_price_v1',
        'sd_v1_seed_products_price_v2'];
      const anyFlag = SEED_FLAGS.some(flag => { try { return LS.getItem(flag) === '1'; } catch (_) { return false; } });
      if (!anyFlag) return;
      const seeds = Array.isArray(window.SEED_PRODUCTS) ? window.SEED_PRODUCTS : [];
      if (!seeds.length) return;
      let products = [];
      try { products = JSON.parse(LS.getItem('sd_v1_products') || '[]'); } catch (_) { products = []; }
      if (!Array.isArray(products)) products = [];
      const norm = v => String(v == null ? '' : v).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
      const seedBarcodes = new Set(seeds.filter(s => s && s.barcode).map(s => String(s.barcode).trim()));
      const seedKeys = new Set(seeds.map(s => norm(s && s.name) + '\u0000' + norm(s && s.spec)));
      const hasSeedProduct = products.some(p => {
        if (!p) return false;
        if (p.barcode && seedBarcodes.has(String(p.barcode).trim())) return true;
        return seedKeys.has(norm(p.name) + '\u0000' + norm(p.spec));
      });
      if (!hasSeedProduct) {
        // 标记说“已初始化”，但一条内置商品都不在 —— 视为未初始化，清掉标记以便重新灌入
        SEED_FLAGS.forEach(flag => { try { LS.removeItem(flag); } catch (_) { /* ignore */ } });
      }
    } catch (_) { /* ignore */ }
  }
  migrateLegacyStorage();

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
      note: '',
      watermark: true,
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
  let committed = null;
  let transactionDepth = 0;
  const listeners = new Set();
  let revision = 0;
  const damagedKeys = [];
  let recoveryBlocked = false;
  let recoveryRaw = null;
  function restoreCommitted() { Object.keys(K).forEach(k => { cache[k] = JSON.parse(committed[k]); }); }
  function assertWritable() {
    if (!recoveryBlocked) return;
    if (committed) restoreCommitted();
    throw new Error('本地数据损坏，已启用只读保护。请先导出原始数据，再从设置恢复有效备份。');
  }
  function load() {
    if (cache) return cache;
    cache = {};
    Object.keys(K).forEach(k => {
      try {
        const raw = LS.getItem(K[k]);
        cache[k] = raw == null ? JSON.parse(JSON.stringify(DEFAULTS[k])) : JSON.parse(raw);
        if (Array.isArray(DEFAULTS[k]) ? !Array.isArray(cache[k]) : !cache[k] || typeof cache[k] !== 'object' || Array.isArray(cache[k])) throw new Error('Invalid stored type');
        validateSnapshot({[k]:cache[k]});
      } catch (e) {
        damagedKeys.push(K[k]);
        cache[k] = JSON.parse(JSON.stringify(DEFAULTS[k]));
      }
    });
    if (damagedKeys.length) {
      recoveryBlocked = true;
      recoveryRaw = {};
      Object.values(K).forEach(key => { try { recoveryRaw[key] = LS.getItem(key); } catch (_) { recoveryRaw[key] = null; } });
    }
    cache.settings = Object.assign(JSON.parse(JSON.stringify(DEFAULTS.settings)), cache.settings);
    return cache;
  }
  function persist() {
    if (transactionDepth) return;
    assertWritable();
    const written = [];
    try {
      const next = {};
      const previous = {};
      Object.keys(K).forEach(k => {
        next[k] = JSON.stringify(cache[k]);
        previous[k] = LS.getItem(K[k]);
      });
      Object.keys(K).forEach(k => {
        if (next[k] === previous[k]) return;
        LS.setItem(K[k], next[k]);
        written.push([k, previous[k]]);
      });
      committed = next;
      if (!written.length) return;
      revision++;
      // Publish only successful commits, after the caller has completed its
      // synchronous save/navigation work. Subscribers must not break storage.
      for (const listener of listeners) Promise.resolve().then(() => { if (listeners.has(listener)) listener(); }).catch(() => {});
    } catch (cause) {
      // A restore changes several keys. Undo completed writes and the in-memory
      // mutation so a failed save cannot later be reported/exported as saved.
      let rollbackFailed = false;
      written.reverse().forEach(([k, value]) => {
        try {
          if (value == null) LS.removeItem(K[k]);
          else LS.setItem(K[k], value);
        } catch (_) { rollbackFailed = true; }
      });
      Object.keys(K).forEach(k => { cache[k] = JSON.parse(committed[k]); });
      const error = new Error(rollbackFailed
        ? '数据保存失败，存储回退也未完成。请立即导出备份并检查存储空间。'
        : '数据保存失败，修改未保存。请检查存储空间或导出备份。');
      error.code = 'SD_STORAGE_WRITE_FAILED';
      if (typeof toast === 'function') toast(error.message, true);
      throw error;
    }
  }

  // Synchronous business operations (order + new products + remembered prices)
  // must either all persist or all return to the last committed state.
  function transaction(action) {
    assertWritable();
    if (transactionDepth) return action();
    transactionDepth = 1;
    try {
      const result = action();
      transactionDepth = 0;
      persist();
      return result;
    } catch (error) {
      transactionDepth = 0;
      Object.keys(K).forEach(k => { cache[k] = JSON.parse(committed[k]); });
      throw error;
    }
  }
  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Store listener must be a function');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /* ---------- 初始商品目录 ----------
   * 首次运行把随应用附带的初始商品写入商品库（barcode/name/unit/spec/category）。
   * 用一次性标记，且按条码或「名称+规格」去重，避免重复写入或覆盖用户数据。
   */
  const SEED_FLAG = 'sd_v1_seed_products_v4';
  const SEED_CAT_FLAG = 'sd_v1_seed_products_cat_v1';
  const SEED_PRICE_FLAG = 'sd_v1_seed_products_price_v2';
  const DEDUPE_FLAG = 'sd_v1_dedupe_products_v1';
  const BUNDLED_IMG_FLAG = 'sd_v1_bundled_images_v2';
  function seedKey(name, spec) {
    const norm = v => String(v == null ? '' : v).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    return norm(name) + '\u0000' + norm(spec);
  }
  function seedIdentity(s) {
    const barcode = String(s.barcode || '').trim();
    return barcode ? 'barcode:' + barcode : 'name:' + seedKey(s.name, s.spec);
  }
  function seedProduct(s) {
    const product = {
      barcode: String(s.barcode || '').trim(), name: String(s.name || '').trim(),
      unit: String(s.unit || '').trim(), spec: String(s.spec || '').trim(), category: String(s.category || '').trim(),
      price: s.price != null && s.price !== '' && Number.isFinite(Number(s.price)) ? Number(s.price) : undefined,
      cost: s.cost != null && s.cost !== '' && Number.isFinite(Number(s.cost)) ? Number(s.cost) : undefined,
      remark: String(s.remark || '').trim(),
    };
    const image = bundledImageFor(product.name);
    if (image) product.image = image;
    return product;
  }
  function seedCatalog() {
    const catalog = new Map(), barcodes = new Set(), identities = new Set();
    (Array.isArray(window.SEED_PRODUCTS) ? window.SEED_PRODUCTS : []).forEach(s => {
      if (!s || !s.name) return;
      const product = seedProduct(s), identity = seedKey(product.name, product.spec);
      if ((product.barcode && barcodes.has(product.barcode)) || identities.has(identity)) return;
      catalog.set(seedIdentity(s), product);
      if (product.barcode) barcodes.add(product.barcode);
      identities.add(identity);
    });
    return catalog;
  }
  function builtinKeyFor(product, catalog) {
    if (product.origin === 'custom') return '';
    if (product.builtinKey && catalog.has(product.builtinKey)) return product.builtinKey;
    // Legacy records have no provenance. Match a barcode, or an exact identity
    // with compatible barcodes; never discard a distinct custom barcode.
    for (const [key, seed] of catalog) {
      if (product.barcode && seed.barcode && product.barcode === seed.barcode) return key;
      if ((!product.barcode || !seed.barcode) && seedKey(product.name, product.spec) === seedKey(seed.name, seed.spec)
          && (product.unit || '') === seed.unit) return key;
    }
    return '';
  }
  function seedInitialProducts() {
    try {
      const seeds = Array.isArray(window.SEED_PRODUCTS) ? window.SEED_PRODUCTS : [];
      // 判断商品库里是否已有内置商品（按条码或「名称+规格」）。仅用于决定“是否可以置位标记”，
      // 不会因为标记已置位而强行再灌种——尊重用户主动清空/恢复为空的场景。
      const hasSeedProduct = () => {
        if (!seeds.length || !d.products.length) return false;
        const seedBarcodes = new Set(seeds.filter(s => s && s.barcode).map(s => String(s.barcode).trim()));
        const seedKeys = new Set(seeds.map(s => seedKey(s && s.name, s && s.spec)));
        return d.products.some(p => {
          if (!p) return false;
          if (p.barcode && seedBarcodes.has(String(p.barcode).trim())) return true;
          return seedKeys.has(seedKey(p.name, p.spec));
        });
      };
      // 标记未置位才灌入初始商品；置位后一律不再自动补种（旧数据迁移导致的误置位由
      // repairSeedFlagsAfterMigration() 在迁移时纠正，不在日常启动时处理）。
      const needSeed = LS.getItem(SEED_FLAG) !== '1';
      if (needSeed && seeds.length) {
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
            price: s && s.price != null && s.price !== '' && Number.isFinite(Number(s.price)) ? Number(s.price) : undefined,
            cost: s && s.cost != null && s.cost !== '' && Number.isFinite(Number(s.cost)) ? Number(s.cost) : undefined,
            remark: String(s && s.remark || '').trim(),
          };
          if (!item.name) return;
          if (item.barcode && seenBarcode.has(item.barcode)) return;
          const key = seedKey(item.name, item.spec);
          if (seenKey.has(key)) return;
          d.products.push({ id: uid(), createdAt: now - i, ...item, builtinKey: seedIdentity(s) });
          if (item.barcode) seenBarcode.add(item.barcode);
          seenKey.add(key);
          added++;
        });
        if (added) persist();
        // 只有确实有可用的种子数据时才置位标记，避免“种子为空也把标记钉死”
        if (seeds.length && (added || hasSeedProduct())) LS.setItem(SEED_FLAG, '1');
      }
      // 老版本已入库的初始商品没有分类，这里按「名称+规格」补一次（不覆盖用户自己设的分类）
      if (LS.getItem(SEED_CAT_FLAG) !== '1') {
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
        LS.setItem(SEED_CAT_FLAG, '1');
      }
      // 初始商品若还没有单价（老版本入库时种子不含价格），按「名称+规格」补一次参考价（不覆盖用户自己改过的价）
      if (LS.getItem(SEED_PRICE_FLAG) !== '1') {
        const priceMap = new Map();
        seeds.forEach(s => {
          const p = s && s.price != null && s.price !== '' && Number.isFinite(Number(s.price)) ? Number(s.price) : null;
          if (p != null) priceMap.set(seedKey(s.name, s.spec), p);
        });
        let patched = 0;
        d.products.forEach(p => {
          if (!p || p.price != null) return;
          const price = priceMap.get(seedKey(p.name, p.spec));
          if (price != null) { p.price = price; patched++; }
        });
        if (patched) persist();
        LS.setItem(SEED_PRICE_FLAG, '1');
      }
    } catch (_) { /* 存储不可用时忽略 */ }
  }

  /* ---------- 商品分类归整 ----------
   * 把商品按「小卖铺货架」逻辑归到正确的类目：
   *  1) 与随应用附带的初始目录同名（或以初始目录名开头，如「康师傅红烧牛肉面袋装」）→ 用初始目录的类目；
   *  2) 初始目录里没有的，按关键字规则归类；
   *  3) 烟草的规格写法统一为「20支/盒」「10盒/条」。
   * 一次性迁移，只改分类与规格，不动用户自定的名称、价格与图片。
   */
  const RECAT_FLAG = 'sd_v1_recategorize_products_v1';
  const CAT_RULES = [
    ['daily', /(抽纸|卷纸|纸巾|牙膏|香皂|洗衣|电池|打火机|垃圾袋|抹布|洗发|沐浴|蚊香)/],
    ['candy', /(巧克力|棒棒糖|口香糖|糖果|奶糖|软糖)/],
    ['drink', /(牛奶|酸奶|乳|饮料|啤酒|白酒|二锅头|劲酒|可乐|雪碧|芬达|红茶|绿茶|奶茶|凉茶|矿泉水|纯净水|气泡水|快线|功能饮料|水$|水 )/],
    ['grain', /(米|油|盐|酱油|醋|蚝油|味精|鸡精|冰糖|砂糖|胡椒|料酒|豆瓣酱|豆豉|腐竹|粉丝|挂面|紫菜|木耳|香菇|辣椒|花椒|八角|榨菜|橄榄菜|腐乳|饺子|汤圆|燕麦|豆奶|罐头|粥|淀粉|生粉|绿豆|黄豆|红枣|枸杞|火腿肠|十三香|糖$)/],
    ['snack', /(薯片|瓜子|饼干|雪饼|仙贝|辣条|鸭脖|卤蛋|小鱼|豆干|方便面|拌面|拉面|自热|面$|肉肠|果冻|花生|开心果|米饼|锅巴)/],
  ];
  function recategorizeProducts() {
    try {
      if (LS.getItem(RECAT_FLAG) === '1') return 0;
      const seeds = Array.isArray(window.SEED_PRODUCTS) ? window.SEED_PRODUCTS : [];
      const catMap = new Map();
      const nameList = [];
      seeds.forEach(s => {
        const c = String(s && s.category || '').trim();
        const n = dedupeNorm(s && s.name);
        if (!c || !n) return;
        catMap.set(n, c);
        nameList.push({ n, c });
      });
      nameList.sort((a, b) => b.n.length - a.n.length);
      let patched = 0;
      d.products.forEach(p => {
        if (!p || !p.name) return;
        const n = dedupeNorm(p.name);
        let cat = catMap.get(n) || '';
        if (!cat) {
          for (let i = 0; i < nameList.length && !cat; i++) {
            const item = nameList[i];
            if (item.n.length >= 3 && n.indexOf(item.n) === 0) cat = item.c;
          }
        }
        if (!cat) {
          for (let i = 0; i < CAT_RULES.length && !cat; i++) {
            if (CAT_RULES[i][1].test(n)) cat = CAT_RULES[i][0];
          }
        }
        if (cat && p.category !== cat) { p.category = cat; patched++; }
        // 烟草规格统一
        if (p.category === 'tobacco') {
          const u = dedupeNorm(p.unit);
          if (u === '盒' && p.spec !== '20支/盒') { p.spec = '20支/盒'; patched++; }
          else if (u === '条' && p.spec !== '10盒/条') { p.spec = '10盒/条'; patched++; }
        }
      });
      if (patched) persist();
      LS.setItem(RECAT_FLAG, '1');
      return patched;
    } catch (_) { return 0; }
  }

  /* ---------- 商品去重 ----------
   * 历史原因：部分商品被重复录入（名称带规格 vs 不带规格、同款不同写法）。
   * 一次性迁移：把「同一商品」合并成一条，优先保留带图片的条目，
   * 并把被删条目上缺失的价格/条码/备注等信息合并到保留条目；
   * 历史单据与一客一价里引用的商品 id 同步改指向保留条目，避免悬空引用。
   */
  function dedupeNorm(v) {
    return String(v == null ? '' : v).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  }
  function dedupeKey(p) {
    const spec = dedupeNorm(p && p.spec);
    let name = dedupeNorm(p && p.name);
    // 名称末尾重复写了规格（如「可口可乐330ml」+ spec「330ml」）时按同一商品处理
    if (spec && name.length > spec.length && name.endsWith(spec)) {
      name = name.slice(0, name.length - spec.length).trim();
    }
    // 烟草同一款可能有「20支/盒」「20支」「盒」等多种规格写法，按「名称+计量单位」判定同一商品
    if (dedupeNorm(p && p.category) === 'tobacco') return name + '\u0000' + '\u0000' + dedupeNorm(p && p.unit);
    return name + '\u0000' + spec + '\u0000' + dedupeNorm(p && p.unit);
  }
  function dedupeRank(p) {
    return [
      p && p.image ? 1 : 0,
      p && p.barcode ? 1 : 0,
      p && p.price != null ? 1 : 0,
      p && p.code ? 1 : 0,
      p && p.remark ? 1 : 0,
      p && p.createdAt ? 1 : 0,
    ];
  }
  function dedupeBetter(a, b) {
    const ra = dedupeRank(a), rb = dedupeRank(b);
    for (let i = 0; i < ra.length; i++) {
      if (ra[i] !== rb[i]) return rb[i] - ra[i];
    }
    return (b && b.createdAt || 0) - (a && a.createdAt || 0);
  }
  function dedupeProducts() {
    try {
      // 每次启动都执行（幂等）：种子商品会随版本新增，若只靠一次性标记，
      // 之后入库的同款商品将永远无法与已有条目合并。
      const groups = new Map();
      d.products.forEach(p => {
        if (!p || !p.name) return;
        const k = dedupeKey(p);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(p);
      });
      const idMap = new Map();      // 被删 id -> 保留 id
      const drop = new Set();
      let merged = 0;
      groups.forEach(list => {
        if (list.length < 2) return;
        // A matching display name is not enough to merge distinct business IDs.
        const barcodes = new Set(list.map(p=>String(p.barcode||'').trim()).filter(Boolean));
        if (barcodes.size > 1) return;
        const sorted = list.slice().sort(dedupeBetter);
        const keep = sorted[0];
        sorted.slice(1).forEach(p => {
          if (['barcode','code','price','cost','remark','category'].some(key => p[key] != null && p[key] !== '' && keep[key] != null && keep[key] !== '' && p[key] !== keep[key])) return;
          if(Object.keys(d.lastPrices||{}).some(key=>key.endsWith(':'+p.id)&&d.lastPrices[key.slice(0,-p.id.length)+keep.id]!=null&&d.lastPrices[key.slice(0,-p.id.length)+keep.id]!==d.lastPrices[key]))return;
          idMap.set(p.id, keep.id);
          drop.add(p.id);
          // 保留条目缺失的字段用被删条目的补齐（不覆盖已有值）
          ['code', 'barcode', 'image', 'remark', 'category'].forEach(k => {
            if (!keep[k] && p[k]) keep[k] = p[k];
          });
          if (keep.price == null && p.price != null) keep.price = p.price;
          if (keep.cost == null && p.cost != null) keep.cost = p.cost;
          merged++;
        });
      });
      if (!drop.size) {
        LS.setItem(DEDUPE_FLAG, '1');
        return 0;
      }
      d.products = d.products.filter(p => !drop.has(p.id));
      // 历史单据明细与一客一价的商品引用改指向保留条目
      d.orders.forEach(o => {
        (o.items || []).forEach(it => {
          if (it && it.pid && idMap.has(it.pid)) it.pid = idMap.get(it.pid);
        });
      });
      const prices = {};
      Object.keys(d.lastPrices || {}).forEach(k => {
        const idx = k.lastIndexOf(':');
        if (idx < 0) { prices[k] = d.lastPrices[k]; return; }
        const custId = k.slice(0, idx), pid = k.slice(idx + 1);
        const target = idMap.get(pid) || pid;
        const nk = custId + ':' + target;
        if (prices[nk] == null) prices[nk] = d.lastPrices[k];
      });
      d.lastPrices = prices;
      persist();
      LS.setItem(DEDUPE_FLAG, '1');
      return merged;
    } catch (_) { return 0; }
  }
  /* ---------- 内置商品图片 ----------
   * 随应用打包的商品图片（webapp/assets/products/），按「商品名称」索引。
   * 一次性迁移：给没有图片的商品自动补上内置图片；
   * 用户自己设置过图片（本地绝对路径）的商品不覆盖。
   */
  function bundledImageFor(name) {
    const map = window.BUNDLED_IMAGES;
    if (!map || typeof map !== 'object') return '';
    const key = dedupeNorm(name);
    const file = map[key];
    return file ? 'bundle:' + file : '';
  }
  function bindBundledImages() {
    try {
      // 每次启动都执行（幂等）：内置图库会随版本新增条目，
      // 若只靠一次性标记，标记写入后新增的种子商品将永远绑不上图。
      // 只给没有图片的商品补图，不覆盖用户自己设置的图片。
      let patched = 0;
      d.products.forEach(p => {
        if (!p || !p.name || p.image) return;
        const img = bundledImageFor(p.name);
        if (img) { p.image = img; patched++; }
      });
      // 内置图库文件名变更时（如重命名/重排），把旧的 bundle: 路径重绑到当前文件
      d.products.forEach(p => {
        if (!p || !p.name || !p.image) return;
        if (!String(p.image).startsWith('bundle:')) return;
        const img = bundledImageFor(p.name);
        if (img && p.image !== img) { p.image = img; patched++; }
      });
      if (patched) persist();
      LS.setItem(BUNDLED_IMG_FLAG, '1');
      return patched;
    } catch (_) { return 0; }
  }
  const d = load();
  committed = {};
  Object.keys(K).forEach(k => { committed[k] = JSON.stringify(d[k]); });
  if (!recoveryBlocked) { seedInitialProducts(); recategorizeProducts(); dedupeProducts(); bindBundledImages(); }

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
  function listProducts(keyword, opts) {
    // 默认只返回「在售」商品；opts.includeArchived=true 时连同已下架一起返回
    const includeArchived = !!(opts && opts.includeArchived);
    let arr = d.products.filter(p => includeArchived || !p.archived);
    if (keyword) {
      const kw = String(keyword).trim().toLowerCase();
      arr = arr.filter(p => [p.name, p.code, p.barcode, p.spec].filter(Boolean).join(' ').toLowerCase().includes(kw));
    }
    return arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  function getProduct(id) { return d.products.find(p => p.id === id); }
  function upsertProduct(data) {
    if (!data || typeof data.name !== 'string' || !data.name.trim()) throw new Error('请填写商品名称');
    ['price','cost'].forEach(key => {
      if (data[key] != null && (typeof data[key] !== 'number' || !Number.isFinite(data[key]) || data[key] < 0 || !Number.isSafeInteger(Math.round(data[key] * 100)))) throw new Error('商品单价和成本价须为有效的非负金额');
    });
    if (data.id && getProduct(data.id)) {
      const current = getProduct(data.id);
      const builtinKey = builtinKeyFor(current, seedCatalog());
      Object.assign(current, data);
      if (builtinKey) current.builtinKey = builtinKey;
      persist();
      return getProduct(data.id);
    }
    const p = { id: uid(), createdAt: Date.now(), ...data, origin: 'custom' };
    if (p && !p.image && p.name) {
      const img = bundledImageFor(p.name);
      if (img) p.image = img;
    }
    d.products.unshift(p);
    persist();
    return p;
  }
  // 商品是否被任何历史单据引用（软删除判断用）
  function productHasOrders(id) {
    const p = getProduct(id);
    if (!p) return false;
    const key = seedKey(p.name, p.spec);
    return (d.orders || []).some(o => (o.items || []).some(i => i && (
      i.pid === id || (!i.pid && seedKey(i.name, i.spec || '') === key)
    )));
  }
  // 有历史单据的商品只「下架」（软删除，保留历史）；无历史单据的才彻底删除
  function deleteProduct(id) {
    const p = getProduct(id);
    if (!p) return { archived: false, deleted: false };
    if (productHasOrders(id)) {
      p.archived = true;
      p.archivedAt = Date.now();
      persist();
      return { archived: true, deleted: false };
    }
    d.products = d.products.filter(x => x.id !== id);
    persist();
    return { archived: false, deleted: true };
  }
  function restoreProduct(id) {
    const p = getProduct(id);
    if (!p) return false;
    delete p.archived;
    delete p.archivedAt;
    persist();
    return true;
  }

  /* ---------- 单据 ---------- */
  function listOrders(filter) {
    let arr = d.orders.slice();
    if (filter) {
      if (filter.customerId) arr = arr.filter(o => o.customer && o.customer.id === filter.customerId);
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
    if (!data || !data.no || d.orders.some(o => o.no === data.no)) throw new Error('单号已存在，请重新生成单号后保存');
    const o = { id: uid(), createdAt: Date.now(), updatedAt: Date.now(), ...data };
    if(d.orders.some(record=>record.id===o.id))throw new Error('单据标识已存在，不能重复保存');
    validateSnapshot({orders:[o]});
    d.orders.unshift(o);
    persist();
    return o;
  }
  function updateOrder(id, data) {
    const o = getOrder(id);
    if (!o) return null;
    if (data.no && d.orders.some(other => other.id !== id && other.no === data.no)) throw new Error('单号已存在，不能覆盖其他单据');
    validateSnapshot({orders:[{...o,...data}]});
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
    let s = Number.isSafeInteger(d.seqMap[day]) ? d.seqMap[day] : 0;
    // Older/partial backups may not contain seqMap. Existing numbers remain
    // authoritative even if their order date was edited afterwards.
    d.orders.forEach(o => {
      const m = String(o.no || '').match(/-(\d{8})-(\d{3,})$/);
      if (m && m[1] === day.replace(/-/g, '')) s = Math.max(s, Number(m[2]));
    });
    if (!Number.isSafeInteger(s + 1)) throw new Error('单号序号超出可用范围');
    d.seqMap[day] = s + 1;
    persist();
    const prefix = (d.settings.noPrefix || 'SD').trim();
    const ymd = day.replace(/-/g, '');
    return prefix + '-' + ymd + '-' + pad3(s + 1);
  }
  function pad3(n) { return (n < 100 ? '0' : '') + (n < 10 ? '0' : '') + n; }
  function reclaimNo(no) { // 删除单据后回退序号（仅当是当天最后一张）
    if (d.orders.some(o => o.no === no)) return;
    const m = String(no || '').match(/-(\d{8})-(\d{3,})$/);
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
    const value=Number(price);
    if(!Number.isFinite(value)||value<0||!Number.isSafeInteger(Math.round(value*100)))throw new Error('一客一价须为有效的非负金额');
    d.lastPrices[custId + ':' + pid] = value;
    persist();
  }

  /* ---------- 备份 / 恢复 ---------- */
  function assertExportable() {
    if (recoveryBlocked) throw new Error('本地数据异常，不能导出或打印不完整报表。请先导出原始数据，再恢复有效备份。');
  }
  const PRODUCT_BACKUP_FIELDS = ['name', 'barcode', 'spec', 'unit', 'category', 'price', 'cost', 'remark', 'image', 'code', 'archived', 'archivedAt'];
  function exportJSON() {
    if (recoveryBlocked) throw new Error('当前数据处于只读保护，请使用“导出原始数据”保留损坏前的记录');
    const catalog = seedCatalog(), products = [], entries = [];
    d.products.forEach(product => {
      const key = builtinKeyFor(product, catalog);
      if (!key) { products.push(product); return; }
      const baseline = catalog.get(key), changes = {}, unset = [];
      PRODUCT_BACKUP_FIELDS.forEach(field => {
        if (product[field] === undefined) { if (baseline[field] !== undefined) unset.push(field); }
        else if (product[field] !== baseline[field]) changes[field] = product[field];
      });
      // Definitions stay in the installed catalog. IDs keep historical orders
      // and customer-specific prices linked when restoring on another PC.
      entries.push({ key, id: product.id, createdAt: product.createdAt, changes, unset });
    });
    return JSON.stringify({
      app: 'songhuodan',
      version: 2,
      kind: 'portable',
      exportedAt: new Date().toISOString(),
      catalog: { entries },
      data: {
        settings: { ...d.settings, imageDir: '' },
        customers: d.customers,
        products,
        orders: d.orders,
        lastPrices: d.lastPrices,
        seqMap: d.seqMap,
      },
    }, null, 2);
  }
  function importJSON(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error('备份文件内容不是有效的 JSON，已取消恢复。'); }
    if (!obj || obj.app !== 'songhuodan' || !obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) throw new Error('不是有效的送货宝备份文件');
    if (obj.version != null && obj.version !== 1 && obj.version !== 2) throw new Error('不支持此备份版本，请使用对应版本的应用恢复');
    let src = obj.data;
    const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
    if (obj.version === 2) {
      if (obj.kind !== 'portable' || !Object.keys(K).every(key => owns(src, key) && src[key] != null)
          || !obj.catalog || !Array.isArray(obj.catalog.entries)) throw new Error('换机备份数据不完整，已取消恢复');
      validateSnapshot(src);
      const catalog = seedCatalog();
      const builtins = obj.catalog.entries.map(entry => {
        if (!entry || typeof entry !== 'object' || typeof entry.key !== 'string' || typeof entry.id !== 'string'
            || !entry.id || !entry.changes || typeof entry.changes !== 'object' || Array.isArray(entry.changes)
            || !Array.isArray(entry.unset) || !Object.keys(entry.changes).every(key => PRODUCT_BACKUP_FIELDS.includes(key))
            || !entry.unset.every(key => PRODUCT_BACKUP_FIELDS.includes(key))) throw new Error('初始化商品关联数据不正确，已取消恢复');
        if (!catalog.has(entry.key)) throw new Error('本机初始化商品目录与备份不兼容，请使用相同或兼容版本恢复');
        const product = { ...catalog.get(entry.key), ...entry.changes, id: entry.id, builtinKey: entry.key };
        if (entry.createdAt != null) product.createdAt = entry.createdAt;
        entry.unset.forEach(key => { delete product[key]; });
        return product;
      });
      src = { ...src, settings: { ...src.settings, imageDir: '' }, products: [...src.products, ...builtins] };
    } else {
      if (obj.kind != null && obj.kind !== 'storage') throw new Error('不能识别此备份类型，已取消恢复');
      const hasRawKeys = Object.values(K).some(key => owns(src, key));
      const hasDataKeys = Object.keys(K).some(key => owns(src, key));
      if (hasRawKeys && hasDataKeys) throw new Error('备份数据结构混杂，已取消恢复');
      if (hasRawKeys) {
        const decoded = {};
        Object.keys(K).forEach(key => {
          if (!owns(src, K[key])) return;
          if (typeof src[K[key]] !== 'string') throw new Error('自动备份中的数据格式不正确，已取消恢复');
          try { decoded[key] = JSON.parse(src[K[key]]); }
          catch (_) { throw new Error('自动备份中的数据已损坏，已取消恢复'); }
        });
        src = decoded;
      } else if (!hasDataKeys) throw new Error('备份中没有可识别的业务数据，已取消恢复');
    }
    if (!['customers', 'products', 'orders'].every(key => owns(src, key) && Array.isArray(src[key]))) {
      throw new Error('备份缺少完整的客户、商品或单据数据，已取消恢复');
    }
    if (Object.keys(K).some(key => owns(src, key) && src[key] == null)) throw new Error('备份中的业务数据为空值，已取消恢复');
    if (src.products.some(product => typeof product?.image === 'string' && product.image.startsWith('backup:'))) {
      throw new Error('备份包含图片文件，请通过设置选择完整 ZIP 备份包，或同时保留 JSON 旁的 images 文件夹');
    }
    validateSnapshot(src);
    // 完整覆盖：备份里缺的字段回落到默认值，而不是保留当前旧数据。
    const blocked = recoveryBlocked;
    const flags = [SEED_FLAG, SEED_CAT_FLAG, SEED_PRICE_FLAG, DEDUPE_FLAG, BUNDLED_IMG_FLAG, RECAT_FLAG];
    const previousFlags = flags.map(flag => [flag, LS.getItem(flag)]);
    recoveryBlocked = false;
    try {
      // Write flags before the business commit, so a flag failure cannot leave
      // a successful data replacement reported as a failed restore.
      flags.forEach(flag => { if (LS.getItem(flag) !== '1') LS.setItem(flag, '1'); });
      Object.keys(K).forEach(k => { d[k] = src[k] != null ? src[k] : JSON.parse(JSON.stringify(DEFAULTS[k])); });
      d.settings = Object.assign(JSON.parse(JSON.stringify(DEFAULTS.settings)), d.settings);
      persist();
    } catch (error) {
      restoreCommitted();
      previousFlags.forEach(([flag, value]) => {
        try { if (value == null) LS.removeItem(flag); else LS.setItem(flag, value); } catch (_) { /* retain the original storage error */ }
      });
      recoveryBlocked = blocked; throw error;
    }
    recoveryRaw = null;damagedKeys.length = 0;
  }
  function validateSnapshot(src) {
    const isArr = v => Array.isArray(v);
    const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
    if (!isObj(src)) throw new Error('备份中的数据格式不正确');
    if (src.settings != null && !isObj(src.settings)) throw new Error('备份中的设置数据格式不正确');
    if (src.customers != null && !isArr(src.customers)) throw new Error('备份中的客户数据格式不正确');
    if (src.products != null && !isArr(src.products)) throw new Error('备份中的商品数据格式不正确');
    if (src.orders != null && !isArr(src.orders)) throw new Error('备份中的单据数据格式不正确');
    if (src.lastPrices != null && !isObj(src.lastPrices)) throw new Error('备份中的价格记录格式不正确');
    if (src.seqMap != null && !isObj(src.seqMap)) throw new Error('备份中的单号序号格式不正确');
    const fail = label => { throw new Error('备份中的' + label + '格式不正确，已取消恢复'); };
    const textFields = (record, keys, label) => keys.forEach(key => {
      if (record[key] != null && typeof record[key] !== 'string') fail(label);
    });
    const namedRecords = (records, label) => {
      const ids = new Set();
      (records || []).forEach(record => {
        if (!isObj(record) || typeof record.id !== 'string' || !record.id || ids.has(record.id)
            || typeof record.name !== 'string' || !record.name.trim()) fail(label);
        ids.add(record.id);
        textFields(record, ['phone', 'address', 'contact', 'code', 'barcode', 'spec', 'unit', 'remark', 'image', 'category', 'builtinKey', 'origin'], label);
        if (record.archived != null && typeof record.archived !== 'boolean') fail(label);
        ['price', 'cost', 'createdAt'].forEach(key => {
          if (record[key] != null && !Number.isFinite(record[key])) fail(label);
        });
        ['price','cost'].forEach(key => { if (record[key] != null && (record[key] < 0 || !Number.isSafeInteger(Math.round(record[key]*100)))) fail(label); });
      });
    };
    textFields(src.settings || {}, Object.keys(DEFAULTS.settings).filter(k => typeof DEFAULTS.settings[k] === 'string'), '设置数据');
    namedRecords(src.customers, '客户记录');
    namedRecords(src.products, '商品记录');
    const orderIds = new Set(),orderNos=new Set();
    (src.orders || []).forEach(o => {
      if (!isObj(o) || typeof o.id !== 'string' || !o.id || orderIds.has(o.id)
          || typeof o.no !== 'string' || !o.no || typeof o.date !== 'string'
          || !/^\d{4}-\d{2}-\d{2}$/.test(o.date) || dateStr(dateOf(o.date)) !== o.date
          || !Array.isArray(o.items) || !Number.isFinite(o.total)) fail('单据记录');
      orderIds.add(o.id);
      if(orderNos.has(o.no))fail('重复单号');orderNos.add(o.no);
      textFields(o, ['operator', 'note'], '单据记录');
      if (o.customer != null) {
        if (!isObj(o.customer) || typeof o.customer.name !== 'string') fail('单据客户');
        textFields(o.customer, ['id', 'phone', 'address', 'contact'], '单据客户');
      }
      o.items.forEach(it => {
        if (!isObj(it) || typeof it.name !== 'string' || !it.name.trim()
            || !Number.isFinite(it.qty) || !Number.isFinite(it.price) || !Number.isFinite(it.amount)) fail('单据明细');
        textFields(it, ['pid', 'spec', 'unit', 'remark'], '单据明细');
        const cents = Math.round(it.qty * it.price * 100);
        if (it.qty <= 0 || it.price < 0 || it.amount < 0 || !Number.isSafeInteger(cents) || Math.abs(cents-Math.round(it.amount*100)) > 0) fail('单据明细金额');
      });
      const cents = o.items.reduce((n,it)=>n+Math.round(it.amount*100),0);
      if (!o.items.length || o.total < 0 || !Number.isSafeInteger(cents) || cents !== Math.round(o.total*100)) fail('单据合计金额');
    });
    Object.values(src.lastPrices || {}).forEach(price => { if (!Number.isFinite(price) || price<0 || !Number.isSafeInteger(Math.round(price*100))) fail('价格记录'); });
    Object.values(src.seqMap || {}).forEach(seq => { if (!Number.isSafeInteger(seq) || seq < 0) fail('单号序号'); });
  }

  /* ---------- CSV 导出 ---------- */
  function csvEscape(v) {
    let s = String(v == null ? '' : v);
    // Text cells must not become spreadsheet formulas; numeric cells stay numeric.
    if (typeof v !== 'number' && (/^[\s\uFEFF]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s))) s = "'" + s;
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(rows) {
    return rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  }
  function tableCSV(headers, rows) {
    assertExportable();
    return toCSV([headers, ...rows]);
  }
  function ordersCSV(filter) {
    assertExportable();
    const rows = [['单号', '日期', '客户名称', '客户电话', '联系人', '产品名称', '规格', '单位', '数量', '单价', '金额', '备注', '制单人']];
    // 日期在 CSV 中写成「2026年11月12日」这种中文日期文本，Excel 打开即按此显示
    const cnDate = s => {
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s || ''));
      if (!m) return s || '';
      return m[1] + '年' + Number(m[2]) + '月' + Number(m[3]) + '日';
    };
    let totalAmount = 0;
    listOrders(filter).forEach(o => {
      (o.items || []).forEach(it => {
        const amt = Number(it.amount) || 0;
        totalAmount += amt;
        rows.push([o.no, cnDate(o.date), (o.customer && o.customer.name) || '', (o.customer && o.customer.phone) || '', (o.customer && o.customer.contact) || '',
          it.name, it.spec || '', it.unit || '', it.qty, it.price, it.amount, it.remark || '', o.operator || '']);
      });
    });
    // 底部合计行：只在「金额」列填总额，其余列留空
    if (rows.length > 1) {
      totalAmount = Math.round(totalAmount * 100) / 100;
      rows.push(['合计', '', '', '', '', '', '', '', '', '', totalAmount, '', '']);
    }
    return toCSV(rows);
  }
  // 送货单 Excel 导出数据：返回 { headers, rows, widths, footer, footerMerge }，由页面交给 Xlsx.build
  function ordersSheet(filter) {
    assertExportable();
    const cnDate = s => {
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s || ''));
      if (!m) return s || '';
      return m[1] + '年' + Number(m[2]) + '月' + Number(m[3]) + '日';
    };
    const headers = ['单号', '日期', '客户名称', '客户电话', '联系人', '产品名称', '规格', '单位', '数量', '单价', '金额', '备注', '制单人'];
    const rows = [];
    let totalAmount = 0;
    listOrders(filter).forEach(o => {
      (o.items || []).forEach(it => {
        totalAmount += Number(it.amount) || 0;
        rows.push([o.no, cnDate(o.date), (o.customer && o.customer.name) || '', (o.customer && o.customer.phone) || '', (o.customer && o.customer.contact) || '',
          it.name, it.spec || '', it.unit || '', it.qty, it.price, it.amount, it.remark || '', o.operator || '']);
      });
    });
    totalAmount = Math.round(totalAmount * 100) / 100;
    // 合计行：金额列（索引10）单独显示总额；左右两侧各合并成一格，左侧写“合计”
    const footer = ['合计', '', '', '', '', '', '', '', '', '', totalAmount, '', ''];
    const footerMerge = [{ from: 0, to: 9 }, { from: 11, to: 12 }];
    // 列宽：日期 14，产品名称 22，客户名称/规格较宽；合计行也按此
    const widths = [16, 14, 16, 13, 10, 22, 12, 6, 8, 9, 12, 16, 9];
    return { headers, rows, widths, footer, footerMerge };
  }
  function customersCSV() {
    assertExportable();
    const rows = [['编号', '客户名称', '电话', '地址', '联系人', '备注']];
    listCustomers().forEach((c, i) => rows.push([i + 1, c.name, c.phone || '', c.address || '', c.contact || '', c.remark || '']));
    return toCSV(rows);
  }
  function productsCSV() {
    assertExportable();
    const rows = [['编号', '条码', '产品名称', '型号规格', '单位', '零售价', '成本价', '产品备注']];
    listProducts('', { includeArchived: true }).forEach((p, i) => rows.push([p.code || (i + 1), p.barcode || '', p.name, p.spec || '', p.unit || '', p.price == null ? '' : p.price, p.cost == null ? '' : p.cost, (p.archived ? '已下架' : '') + (p.remark || '')]));
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
    return importProductsRows(parseCSV(text));
  }
  function validateImportRows(rows) {
    if (!Array.isArray(rows) || !rows.every(row => Array.isArray(row) && row.length <= 128 && row.every(cell => cell == null || typeof cell === 'string' || typeof cell === 'number' && Number.isFinite(cell)))) throw new Error('资料表格数据格式不正确');
    if (rows.length > 100001) throw new Error('导入记录过多，请拆分文件');
    if (rows.length && rows.some(row => row.length > rows[0].length)) throw new Error('资料列数不一致，请检查原文件');
  }
  function importProductsRows(rows) {
    validateImportRows(rows);
    if (rows.length < 2) throw new Error('没有可导入的商品数据');
    const header = rows[0].map(h => String(h == null ? '' : h).trim());
    const idx = {
      code: header.findIndex(h => /编号|编码/.test(h)),
      barcode: header.findIndex(h => /条码/.test(h)),
      name: header.findIndex(h => /^(?:(?:产品|商品|货品)(?:名称|名)|名称|品名|productname|name)$/i.test(h.replace(/\s/g, ''))),
      spec: header.findIndex(h => /规格|型号/.test(h)),
      unit: header.findIndex(h => /单位/.test(h)),
      price: header.findIndex(h => /零售价|价格|售价|单价/.test(h)),
      cost: header.findIndex(h => /成本/.test(h)),
      remark: header.findIndex(h => /备注/.test(h)),
      archived: header.findIndex(h => /状态|上下架/.test(h)),
      category: header.findIndex(h => /分类|类别/.test(h)),
    };
    if (idx.name < 0) throw new Error('未识别到“产品名称”表头，请选择正确的商品资料文件');
    function parseMoney(v) {
      if (v == null) return undefined;
      const s = String(v).trim();
      if (s === '') return undefined;
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.round(n * 100))) throw new Error('文件中存在无效单价或成本价，已取消整批导入');
      return n;
    }
    function parseArchived(value) {
      const text = String(value == null ? '' : value).trim().toLowerCase();
      if (!text || /^(在售|上架|启用|active|0|false)$/.test(text)) return false;
      if (/^(已下架|下架|停用|archived|inactive|1|true)$/.test(text)) return true;
      throw new Error('文件中的商品状态无效，已取消整批导入');
    }
    let skipped = 0;
    const pending = [];
    const existsKey = new Set(d.products.map(p => seedKey(p.name, p.spec)));
    const existsBarcode = new Set(d.products.filter(p => p.barcode).map(p => String(p.barcode).trim()));
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[idx.name] ?? '').trim();
      if (!name) continue;
      const spec = String(idx.spec >= 0 ? r[idx.spec] || '' : '').trim();
      const barcode = String(idx.barcode >= 0 ? r[idx.barcode] ?? '' : '').trim();
      const key = seedKey(name, spec);
      if (existsKey.has(key) || (barcode && existsBarcode.has(barcode))) { skipped++; continue; }
      pending.push({
        name,
        code: String(idx.code >= 0 ? r[idx.code] ?? '' : '').trim(),
        barcode,
        spec,
        unit: String(idx.unit >= 0 ? r[idx.unit] || '' : '').trim(),
        price: idx.price >= 0 ? parseMoney(r[idx.price]) : undefined,
        cost: idx.cost >= 0 ? parseMoney(r[idx.cost]) : undefined,
        remark: String(idx.remark >= 0 ? r[idx.remark] || '' : '').trim(),
        ...(idx.archived >= 0 ? { archived: parseArchived(r[idx.archived]) } : {}),
        ...(idx.category >= 0 ? { category: String(r[idx.category] ?? '').trim() } : {}),
      });
      existsKey.add(key);
      if (barcode) existsBarcode.add(barcode);
    }
    if (pending.length) {
      d.products = pending.map(product => ({ id: uid(), createdAt: Date.now(), ...product, origin: 'custom' })).concat(d.products);
      persist();
    }
    return { added: pending.length, skipped };
  }
  function importCustomersCSV(text) {
    return importCustomersRows(parseCSV(text));
  }
  function importCustomersRows(rows) {
    validateImportRows(rows);
    if (rows.length < 2) throw new Error('没有可导入的客户数据');
    const header = rows[0].map(h => String(h == null ? '' : h).trim());
    const idx = {
      name: header.findIndex(h => /^(?:客户名称|客户名|名称|姓名|customer(?:name)?|name)$/i.test(h.replace(/\s/g, ''))),
      phone: header.findIndex(h => /电话|手机|联系电话/.test(h)),
      address: header.findIndex(h => /地址/.test(h)),
      contact: header.findIndex(h => /联系人/.test(h)),
      remark: header.findIndex(h => /备注/.test(h)),
    };
    if (idx.name < 0) throw new Error('未识别到“客户名称”表头，请选择正确的客户资料文件');
    let skipped = 0;
    const pending = [];
    const nameKey = name => String(name || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    const existsName = new Set(d.customers.map(c => nameKey(c.name)));
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[idx.name] ?? '').trim();
      if (!name) continue;
      if (existsName.has(nameKey(name))) { skipped++; continue; }
      pending.push({
        name,
        phone: String(idx.phone >= 0 ? r[idx.phone] ?? '' : '').trim(),
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

  function importTables(kind, sheets) {
    if (!['products', 'customers'].includes(kind) || !Array.isArray(sheets) || !sheets.length || sheets.length > 1000) throw new Error('没有可导入的资料表格');
    return transaction(() => {
      const total = { added: 0, skipped: 0 };
      for (const sheet of sheets) {
        try {
          const result = kind === 'products' ? importProductsRows(sheet.rows) : importCustomersRows(sheet.rows);
          total.added += result.added; total.skipped += result.skipped;
        } catch (error) { throw new Error((sheet.name ? '工作表“' + sheet.name + '”：' : '') + error.message); }
      }
      return total;
    });
  }

  /* ---------- 月度账单（按客户分组） ---------- */
  function billGroups(ym) {
    const from = ym + '-01', to = ym + '-31';
    const list = listOrders({ from, to });
    const groups = Object.create(null);
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
    assertExportable();
    return listOrders({ from, to }).map(o => ({
      date: o.date, no: o.no,
      customer: o.customer ? o.customer.name : '散客',
      qty: sumQuantities(o.items.map(i => i.qty)),
      total: o.total || 0,
      note: o.note || '',
    }));
  }

  function clearAll() {
    Object.keys(K).forEach(k => { d[k] = JSON.parse(JSON.stringify(DEFAULTS[k])); });
    // 清空后一并重置「商品已初始化」等一次性标记，
    // 这样重启时会重新灌入随应用附带的初始商品（客户/单据仍为空）。
    const seedFlags = [SEED_FLAG, SEED_CAT_FLAG, SEED_PRICE_FLAG, DEDUPE_FLAG, BUNDLED_IMG_FLAG, RECAT_FLAG];
    seedFlags.forEach(flag => { try { LS.removeItem(flag); } catch (_) { /* ignore */ } });
    persist();
  }
  function countAll() {
    return { orders: d.orders.length, customers: d.customers.length, products: d.products.length };
  }

  return {
    recoveryState: () => ({blocked:recoveryBlocked,keys:damagedKeys.slice()}),
    exportRecoveryJSON: () => JSON.stringify({app:'songhuodan-recovery',version:1,exportedAt:new Date().toISOString(),raw:recoveryRaw},null,2),
    get revision() { return revision; },
    getSettings, setSettings,
    listCustomers, getCustomer, upsertCustomer, deleteCustomer, countCustomerOrders,
    listProducts, getProduct, upsertProduct, deleteProduct, restoreProduct, productHasOrders,
    listOrders, getOrder, addOrder, updateOrder, deleteOrder, orderIndex, siblingOrder,
    nextOrderNo, reclaimNo,
    getLastPrice, setLastPrice,
    exportJSON, importJSON, assertExportable,
    ordersCSV, ordersSheet, customersCSV, productsCSV, tableCSV,
    billGroups, ordersTable,
    importProductsCSV, importCustomersCSV, importTables,
    clearAll, countAll, transaction, subscribe,
  };
})();
