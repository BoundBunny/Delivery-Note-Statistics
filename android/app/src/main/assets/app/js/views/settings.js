/* ============================================================
 * views/settings.js — 设置（公司信息 / 单据 / 数据备份恢复 / 导入导出）
 * ============================================================ */
'use strict';
window.Views = window.Views || {};

Views.settings = {
  render() {
    const el = document.createElement('div');
    el.className = 'view active settings-view';
    const s = Store.getSettings();
    const cnt = Store.countAll();
    const icons = {
      company: '<rect x="4" y="3" width="16" height="18" rx="3" fill="currentColor" opacity=".15" stroke="none"/><path d="M9 21v-5h6v5M8 7h1m6 0h1M8 11h1m6 0h1M5 21h14"/>',
      customers: '<circle cx="9" cy="7" r="3" fill="currentColor" opacity=".8" stroke="none"/><circle cx="17" cy="9" r="2.5" fill="currentColor" opacity=".45" stroke="none"/><path d="M2.5 20v-2a6.5 6.5 0 0 1 13 0v2z" fill="currentColor" stroke="none"/><path d="M17 14a5 5 0 0 1 4.5 5v1H18v-2a9 9 0 0 0-1-4" fill="currentColor" opacity=".45" stroke="none"/>',
      products: '<path d="m12 2 9 5v10l-9 5-9-5V7z" fill="currentColor" opacity=".15" stroke="none"/><path d="m3 7 9 5 9-5M12 12v10M3 7v10l9 5 9-5V7l-9-5zM7.5 4.5l9 5"/>',
      backup: '<path d="M4 8h16v12H4z" fill="currentColor" opacity=".15" stroke="none"/><path d="M4 8v12h16V8M3 4h18v4H3zM12 17v-6m-3 3 3-3 3 3"/>',
      restore: '<circle cx="12" cy="12" r="9" fill="currentColor" opacity=".15" stroke="none"/><path d="M5 8a8 8 0 1 1-1 7M5 3v5h5M12 7v5l3 2"/>',
      export: '<path d="M5 3h9l5 5v13H5z" fill="currentColor" opacity=".15" stroke="none"/><path d="M14 3v5h5M9 12h4M9 16h3M16 17h6m-3-3 3 3-3 3M5 21V3h9l5 5v3"/>',
      import: '<path d="M5 3h9l5 5v13H5z" fill="currentColor" opacity=".15" stroke="none"/><path d="M14 3v5h5M12 11v7m-3-3 3 3 3-3M5 21V3h9l5 5v13"/>',
      trash: '<path d="M6 7h12l-1 14H7z" fill="currentColor" opacity=".15" stroke="none"/><path d="M4 7h16M9 7V3h6v4M6 7l1 14h10l1-14M10 11v6m4-6v6"/>',
      image: '<rect x="3" y="4" width="18" height="16" rx="3" fill="currentColor" opacity=".15" stroke="none"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M4 17l4.5-4.5a2 2 0 0 1 2.7 0L15 16m-1.5-1.5 1.8-1.8a2 2 0 0 1 2.7 0L21 16"/>',
    };
    const row = ({ act, go, title, note, icon, tone, value = '' }) => `
      <button type="button" class="settings-row${act === 'company-info' ? ' company-info-entry' : ''}" ${act ? 'data-act="' + act + '"' : 'data-go="' + go + '"'}>
        <span class="settings-row-icon settings-icon-${tone}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[icon]}</svg></span>
        <span class="settings-row-main sr-main"><span class="settings-row-title sr-t${go ? ' li-title' : ''}">${esc(title)}</span>${note ? `<span class="settings-row-note sr-s">${esc(note)}</span>` : ''}</span>
        ${value ? `<span class="settings-row-value num">${esc(value)}</span>` : ''}
        <svg class="settings-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
      </button>`;

    el.innerHTML = `
      <div class="topbar"><h1>设置</h1></div>
      <div class="pad settings-content" data-role="body">
        <div class="settings-card">
          ${row({ act: 'company-info', title: '公司/店铺信息', note: s.company || '抬头、联系方式、单据备注和账单标题', icon: 'company', tone: 'amber' })}
        </div>
        <section class="settings-section" aria-labelledby="settings-basic-title">
          <h2 class="settings-section-title" id="settings-basic-title">基础资料</h2>
          <div class="settings-card">
            ${row({ go: 'customers', title: '客户管理', note: '名称、电话、地址', icon: 'customers', tone: 'green', value: cnt.customers + ' 个' })}
            ${row({ go: 'products', title: '商品管理', note: '名称、规格、单价', icon: 'products', tone: 'blue', value: cnt.products + ' 个' })}
          </div>
        </section>
        <section class="settings-section" aria-labelledby="settings-data-title">
          <h2 class="settings-section-title" id="settings-data-title">数据管理</h2>
          <div class="settings-card">
            ${row({ act: 'backup', title: '导出备份', note: cnt.orders + ' 张单据 · ' + cnt.customers + ' 个客户 · ' + cnt.products + ' 个商品', icon: 'backup', tone: 'purple' })}
            ${row({ act: 'restore', title: '恢复备份', note: '从备份文件恢复并覆盖当前数据', icon: 'restore', tone: 'green' })}
            ${row({ act: 'exp-orders', title: '导出单据 Excel', note: '导出日期、单号、客户和金额', icon: 'export', tone: 'blue' })}
            ${row({ act: 'exp-products', title: '导出商品 Excel', note: '导出名称、规格、单价等资料', icon: 'export', tone: 'teal' })}
            ${row({ act: 'exp-customers', title: '导出客户 Excel', note: '导出客户名称、电话和地址', icon: 'export', tone: 'violet' })}
            ${row({ act: 'imp-products', title: '导入商品 CSV', note: 'CSV 文本，须包含“产品名称”列', icon: 'import', tone: 'amber' })}
            ${row({ act: 'imp-customers', title: '导入客户 CSV', note: 'CSV 文本，须包含“客户名称”列', icon: 'import', tone: 'green' })}
            ${row({ act: 'clear', title: '清空全部数据', note: '删除所有单据、客户、商品，不可恢复', icon: 'trash', tone: 'red' })}
          </div>
        </section>
        <section class="settings-section" aria-labelledby="settings-image-title">
          <h2 class="settings-section-title" id="settings-image-title">商品图片</h2>
          <div class="settings-card">
            <div class="settings-row settings-image-row">
              <span class="settings-row-icon settings-icon-teal" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons.image}</svg></span>
              <span class="settings-row-main sr-main"><span class="settings-row-title">图片存储位置</span><span class="settings-row-note sr-s" data-role="image-dir">加载中…</span></span>
            </div>
            <div class="settings-image-actions" data-role="image-actions">
              <button type="button" class="btn btn-ghost btn-sm" data-act="choose-image-dir">更改文件夹</button>
              <button type="button" class="btn btn-ghost btn-sm" data-act="open-image-dir">打开文件夹</button>
              <button type="button" class="btn btn-ghost btn-sm" data-act="reset-image-dir">恢复默认</button>
            </div>
            <div class="settings-image-hint" data-role="image-hint">上传的商品图片会保存到这个文件夹，纯本地存储、不联网；默认目录为程序所在文件夹下的 CommercesData。</div>
          </div>
        </section>
        <section class="settings-section" aria-labelledby="settings-about-title">
          <h2 class="settings-section-title" id="settings-about-title">关于</h2>
          <div class="settings-card">
            <div class="settings-row settings-about-row">
              <img class="brand-icon brand-icon-about settings-brand-icon" src="assets/brand/dns-icon.svg" width="32" height="32" alt="DNS 标志">
              <span class="settings-row-main"><span class="settings-row-title">DNS · 送货单统计</span><span class="settings-row-note">完全本地离线运行</span></span>
              <span class="settings-row-value">v1.0</span>
            </div>
          </div>
        </section>
      </div>`;

    const imageDirNote = $('[data-role="image-dir"]', el);
    const imageActions = $('[data-role="image-actions"]', el);
    let imageDefaultDir = '';
    const updateImageDirNote = () => {
      if (!imageDirNote) return;
      const cur = Store.getSettings().imageDir;
      imageDirNote.textContent = cur || imageDefaultDir || '默认目录（CommercesData）';
      imageDirNote.title = imageDirNote.textContent;
    };
    if (window.Android && window.Android.getDefaultImageDir) {
      window.Android.getDefaultImageDir()
        .then(def => { imageDefaultDir = def || ''; updateImageDirNote(); })
        .catch(() => updateImageDirNote());
    } else {
      if (imageActions) imageActions.style.display = 'none';
      if (imageDirNote) imageDirNote.textContent = '网页版图片保存在浏览器本地存储中';
    }

    el.addEventListener('click', async e => {
      const go = e.target.closest('[data-go]');
      if (go) { location.hash = '#/' + go.dataset.go; return; }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const a = act.dataset.act;
      if (a === 'choose-image-dir') {
        if (!(window.Android && window.Android.chooseImageDir)) { toast('当前环境不支持设置文件夹', true); return; }
        try {
          const dir = await window.Android.chooseImageDir();
          if (dir) { Store.setSettings({ imageDir: dir }); updateImageDirNote(); toast('已更新图片存储位置'); }
        } catch (err) {
          toast('设置失败：' + (err && err.message || err), true);
        }
        return;
      }
      if (a === 'reset-image-dir') {
        Store.setSettings({ imageDir: '' });
        updateImageDirNote();
        toast('已恢复默认图片位置');
        return;
      }
      if (a === 'open-image-dir') {
        if (!(window.Android && window.Android.openImageDir)) { toast('当前环境不支持打开文件夹', true); return; }
        window.Android.openImageDir(Store.getSettings().imageDir || '');
        return;
      }
      if (a === 'company-info') {
        location.hash = '#/settings/company';
        return;
      }
      if (a === 'backup') {
        const json = Store.exportJSON();
        const name = '送货单统计备份_' + todayStr().replace(/-/g, '') + '.json';
        downloadBlob(name, new Blob([json], { type: 'application/json' }));
        toast('备份已导出');
        return;
      }
      if (a === 'restore') {
        const ok = await confirmDialog({ title: '恢复备份会覆盖当前全部数据，继续？', okText: '继续' });
        if (!ok) return;
        const text = await pickFileAsText('.json');
        if (text == null) return;
        try {
          Store.importJSON(text);
          toast('恢复成功');
          location.hash = '#/home';
        } catch (err) {
          toast(err.message || '恢复失败', true);
        }
        return;
      }
      if (a === 'exp-orders') {
        const rows = Store.ordersTable();
        const tq = rows.reduce((x, r) => x + r.qty, 0);
        const ta = Math.round(rows.reduce((x, r) => x + (r.total || 0), 0) * 100) / 100;
        const bytes = Xlsx.build([{ name: '送货单', title: '送货单统计表', headers: ['日期', '单号', '客户', '件数', '金额(元)', '备注'], rows: rows.map(r => [r.date, r.no, r.customer, r.qty, r.total, r.note]), widths: [12, 16, 16, 8, 12, 30], footer: ['', '', '合计', tq, ta, ''] }]);
        downloadBlob('送货单统计.xlsx', xlsxBlob(bytes));
        toast('已导出 Excel');
        return;
      }
      if (a === 'exp-products') {
        const ps = Store.listProducts('');
        const bytes = Xlsx.build([{ name: '商品', title: '商品资料', headers: ['编号', '条码', '产品名称', '规格', '单位', '零售价', '成本价', '备注'], rows: ps.map(p => [p.code || '', p.barcode || '', p.name, p.spec || '', p.unit || '', p.price != null ? p.price : '', p.cost != null ? p.cost : '', p.remark || '']), widths: [12, 14, 22, 12, 8, 10, 10, 20] }]);
        downloadBlob('商品.xlsx', xlsxBlob(bytes));
        toast('已导出 Excel');
        return;
      }
      if (a === 'exp-customers') {
        const cs = Store.listCustomers('');
        const bytes = Xlsx.build([{ name: '客户', title: '客户资料', headers: ['客户名称', '电话', '联系人', '地址', '备注'], rows: cs.map(c => [c.name, c.phone || '', c.contact || '', c.address || '', c.remark || '']), widths: [18, 16, 12, 28, 20] }]);
        downloadBlob('客户.xlsx', xlsxBlob(bytes));
        toast('已导出 Excel');
        return;
      }
      if (a === 'imp-products' || a === 'imp-customers') {
        const text = await pickFileAsText('.csv,text/csv');
        if (text == null) return;
        try {
          const r = a === 'imp-products' ? Store.importProductsCSV(text) : Store.importCustomersCSV(text);
          toast(`新增 ${r.added} 条，跳过重复 ${r.skipped} 条`);
        } catch (err) {
          toast(err.message || '导入失败', true);
        }
        return;
      }
      if (a === 'clear') {
        const ok = await confirmDialog({ title: '确定清空全部数据？', text: '所有单据、客户、商品将被删除，无法恢复。建议先导出备份。', okText: '清空', danger: true });
        if (!ok) return;
        Store.clearAll();
        toast('已清空');
        location.hash = '#/home';
      }
    });
    return el;
  }
};

Views.companyInfo = {
  render() {
    const el = document.createElement('div');
    el.className = 'view active';
    const settings = Store.getSettings();
    const defaultTitle = '{year}年{customer}与{company}{month}月账单';
    const titleFields = [
      ['year', '年份'], ['month', '月份'], ['customer', '客户名称'], ['company', '公司/店铺名称'],
    ];
    const readableTitle = template => titleFields.reduce((text, [key, label]) => text.split('{' + key + '}').join('【' + label + '】'), String(template || defaultTitle));
    const storedTitle = text => titleFields.reduce((template, [key, label]) => template.split('【' + label + '】').join('{' + key + '}'), text.trim()) || defaultTitle;

    el.innerHTML = `
      <div class="topbar">
        <button class="icbtn" data-act="back" aria-label="返回设置"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
        <h1>公司/店铺信息</h1>
      </div>
      <div class="pad">
        <div class="order-meta company-info-form">
          <div class="field"><label class="lab" for="company-name">公司 / 店铺名称（打印抬头）</label><input id="company-name" data-s="company" value="${esc(settings.company)}"></div>
          <div class="field-row">
            <div class="field"><label class="lab" for="company-phone">联系电话</label><input id="company-phone" data-s="phone" value="${esc(settings.phone)}"></div>
            <div class="field"><label class="lab" for="company-contact">联系人</label><input id="company-contact" data-s="contact" value="${esc(settings.contact)}"></div>
          </div>
          <div class="field"><label class="lab" for="company-address">地址</label><input id="company-address" data-s="address" value="${esc(settings.address)}"></div>
          <div class="field-row">
            <div class="field"><label class="lab" for="company-prefix">单号前缀</label><input id="company-prefix" data-s="noPrefix" value="${esc(settings.noPrefix)}"></div>
            <div class="field"><label class="lab" for="company-operator">默认制单人</label><input id="company-operator" data-s="operator" value="${esc(settings.operator)}"></div>
          </div>
          <div class="field"><label class="lab" for="company-note">整单默认备注（打印在单据底部）</label><textarea id="company-note" data-s="note" rows="3">${esc(settings.note)}</textarea></div>
          <div class="field">
            <div class="bill-title-heading"><label class="lab" for="company-bill-title">月度账单标题</label><button type="button" class="bill-title-reset" data-act="reset-title">恢复默认</button></div>
            <textarea id="company-bill-title" class="bill-title-editor" data-s="billTitle" rows="3" aria-describedby="bill-title-help">${esc(readableTitle(settings.billTitle))}</textarea>
            <div class="bill-title-help" id="bill-title-help">可以直接改文字，点击下方按钮插入会自动填写的内容。</div>
            <div class="bill-title-tokens" aria-label="插入账单标题内容">
              ${titleFields.map(([key, label]) => `<button type="button" class="btn btn-ghost btn-sm" data-title-field="${key}">+ ${label}</button>`).join('')}
            </div>
            <div class="bill-title-preview">
              <div class="bill-title-preview-label">实际标题预览</div>
              <div class="bill-title-preview-value" data-role="bill-title-preview"></div>
              <div class="bill-title-help">以“示例客户”和当前月份演示，正式账单会自动换成对应客户、月份和上方填写的公司/店铺名称。</div>
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-block" data-act="save-info">保存信息</button>
        </div>
      </div>`;

    const titleInput = $('[data-s="billTitle"]', el);
    titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length);
    const updatePreview = () => {
      $('[data-role="bill-title-preview"]', el).textContent = billTitleFor('示例客户', todayStr().slice(0, 7), {
        billTitle: storedTitle(titleInput.value), company: $('[data-s="company"]', el).value.trim(),
      });
    };
    updatePreview();
    el.addEventListener('input', e => {
      if (e.target.matches('[data-s="billTitle"], [data-s="company"]')) updatePreview();
    });
    el.addEventListener('click', e => {
      const fieldButton = e.target.closest('[data-title-field]');
      if (fieldButton) {
        const field = titleFields.find(([key]) => key === fieldButton.dataset.titleField);
        const start = titleInput.selectionStart, end = titleInput.selectionEnd;
        titleInput.setRangeText('【' + field[1] + '】', start, end, 'end');
        titleInput.focus();
        updatePreview();
        return;
      }
      const button = e.target.closest('[data-act]');
      if (!button) return;
      if (button.dataset.act === 'back') { location.hash = '#/settings'; return; }
      if (button.dataset.act === 'reset-title') {
        titleInput.value = readableTitle(defaultTitle);
        updatePreview();
        return;
      }
      if (button.dataset.act === 'save-info') {
        const patch = {};
        ['company', 'phone', 'contact', 'address', 'noPrefix', 'operator', 'note'].forEach(key => {
          patch[key] = $('[data-s="' + key + '"]', el).value.trim();
        });
        patch.billTitle = storedTitle(titleInput.value);
        Store.setSettings(patch);
        toast('公司/店铺信息已保存');
        location.hash = '#/settings';
      }
    });
    return el;
  },
};
