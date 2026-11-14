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
    const bg3dValueText = () => {
      if (!window.DNSDesktop.sceneEnabled()) return '关闭';
      const status=window.DNSDesktop.scene?.stats();
      return status?.paused ? '开启 · 业务窗口中暂停' : '开启';
    };
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
    const exportRow = ({ kind, title, note, tone }) => `
      <div class="settings-row settings-export-row" data-export-kind="${kind}">
        <span class="settings-row-icon settings-icon-${tone}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons.export}</svg></span>
        <span class="settings-row-main"><span class="settings-row-title">${title}</span><span class="settings-row-note">${note}</span></span>
        <div class="settings-export-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-act="imp-${kind}" aria-label="导入${kind === 'products' ? '商品' : '客户'}">导入</button>
          <div class="exp-format" data-role="export-format" data-value="xlsx" role="radiogroup" aria-label="${title}格式">
            <button type="button" class="exp-format-opt is-on" role="radio" aria-checked="true" tabindex="0" data-format="xlsx">Excel<em>.xlsx</em></button>
            <button type="button" class="exp-format-opt" role="radio" aria-checked="false" tabindex="-1" data-format="csv">CSV<em>.csv</em></button>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-act="exp-${kind}" aria-label="导出${kind === 'products' ? '商品' : '客户'}">导出</button>
        </div>
      </div>`;

    el.innerHTML = `
      <div class="topbar"><h1>设置</h1></div>
      <div class="pad settings-content" data-role="body">
        <div class="settings-card">
          ${row({ act: 'company-info', title: '公司/店铺信息', note: s.company || '抬头、联系方式和账单标题', icon: 'company', tone: 'amber' })}
        </div>
        <section class="settings-section" aria-labelledby="settings-basic-title">
          <h2 class="settings-section-title" id="settings-basic-title">基础资料</h2>
          <div class="settings-card">
            ${row({ go: 'customers', title: '客户管理', note: '名称、电话、地址', icon: 'customers', tone: 'green', value: cnt.customers + ' 个' })}
            ${row({ go: 'products', title: '商品管理', note: '名称、规格、单价', icon: 'products', tone: 'blue', value: cnt.products + ' 个' })}
            ${row({ act: 'toggle-bg3d', title: '3D 场景工作台', note: '以仓库场景导航业务；关闭场景后仍可正常开单与管理资料', icon: 'image', tone: 'violet', value: bg3dValueText() })}
          </div>
        </section>
        <section class="settings-section" aria-labelledby="settings-data-title">
          <h2 class="settings-section-title" id="settings-data-title">数据管理</h2>
          <div class="settings-card">
            <div class="settings-data-intro"><h3>备份与换机</h3><p>整份保存客户、单据、商品及图片，换电脑时使用。</p></div>
            ${row({ act: 'backup', title: '备份到文件', note: cnt.orders + ' 张单据 · ' + cnt.customers + ' 个客户 · 含商品图片', icon: 'backup', tone: 'purple' })}
            ${row({ act: 'restore', title: '从备份恢复', note: '导入以前保存的备份，会覆盖当前业务数据', icon: 'restore', tone: 'green' })}
          </div>
          <details class="settings-card settings-data-group" data-data-panel="tables">
            <summary class="settings-row">
              <span class="settings-row-icon settings-icon-teal" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons.export}</svg></span>
              <span class="settings-row-main"><span class="settings-row-title">表格导入导出</span><span class="settings-row-note">按商品、客户或单据分别操作</span></span>
              <svg class="settings-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
            </summary>
            <div class="settings-table-tools">
              <p class="settings-data-help">导入自动识别 Excel / CSV，只新增资料并跳过重复项；导出表格不包含图片。</p>
              ${exportRow({ kind: 'products', title: '商品资料', note: '名称、规格、单价等，包含已下架商品', tone: 'teal' })}
              ${exportRow({ kind: 'customers', title: '客户资料', note: '名称、电话、联系人和地址', tone: 'violet' })}
              ${row({ act: 'exp-orders', title: '导出单据汇总', note: '全部单据，一单一行，保存为 Excel', icon: 'export', tone: 'blue' })}
            </div>
          </details>
          <details class="settings-card settings-data-group" data-data-panel="advanced">
            <summary class="settings-row">
              <span class="settings-row-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16M4 12h16M4 19h16"/><circle cx="9" cy="5" r="2" fill="white"/><circle cx="15" cy="12" r="2" fill="white"/><circle cx="9" cy="19" r="2" fill="white"/></svg></span>
              <span class="settings-row-main"><span class="settings-row-title">高级选项</span><span class="settings-row-note">本机自动备份、存储目录和清空数据</span></span>
              <svg class="settings-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
            </summary>
            <div class="settings-data-advanced">
              <div class="settings-row settings-image-row">
                <span class="settings-row-main"><span class="settings-row-title">本机数据目录</span><span class="settings-row-note" data-role="data-dir">加载中…</span></span>
              </div>
              <div class="settings-image-actions" data-role="data-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-act="open-data-dir">打开数据目录</button>
                <button type="button" class="btn btn-ghost btn-sm" data-act="open-backup-dir">打开自动备份目录</button>
                <button type="button" class="btn btn-ghost btn-sm" data-act="backup-now">更新本机备份</button>
              </div>
              <div class="settings-image-hint" data-role="data-hint">本机自动备份在保存后更新；换电脑请使用上方“备份到文件”。</div>
              ${row({ act: 'clear', title: '清空全部数据', note: '删除当前客户、商品和单据，不可撤销；建议先备份', icon: 'trash', tone: 'red' })}
            </div>
          </details>
        </section>
        <section class="settings-section" aria-labelledby="settings-close-title">
          <h2 class="settings-section-title" id="settings-close-title">窗口与关闭</h2>
          <div class="settings-card">
            <div class="settings-choice" data-role="close-choice">
              <div class="settings-choice-title">关闭主界面时</div>
              <label class="settings-choice-item">
                <input type="radio" name="close-action" value="minimize" data-role="close-radio">
                <span>最小化到系统托盘</span>
              </label>
              <label class="settings-choice-item">
                <input type="radio" name="close-action" value="quit" data-role="close-radio">
                <span>退出程序</span>
              </label>
              <label class="settings-choice-item settings-choice-toggle">
                <input type="checkbox" data-role="close-prompt">
                <span>关闭时提示</span>
              </label>
            </div>
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
              <img class="brand-icon brand-icon-about settings-brand-icon" src="assets/brand/dns-icon.svg" width="32" height="32" alt="送货宝标志">
              <span class="settings-row-main"><span class="settings-row-title">送货宝</span><span class="settings-row-note">完全本地离线运行</span></span>
              <span class="settings-row-value">v2.0.0</span>
            </div>
          </div>
        </section>
      </div>`;

    const imageDirNote = $('[data-role="image-dir"]', el);
    let backupBusy = false;
    let importing = false;
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

    /* 数据保存位置（仅桌面端） */
    const dataDirNote = $('[data-role="data-dir"]', el);
    const dataActions = $('[data-role="data-actions"]', el);
    const dataHint = $('[data-role="data-hint"]', el);
    let storageInfo = null;
    const updateDataDirNote = () => {
      if (!dataDirNote) return;
      if (!storageInfo) { dataDirNote.textContent = '本环境使用浏览器本地存储'; return; }
      const t = storageInfo.dataDir || '';
      dataDirNote.textContent = t;
      dataDirNote.title = t;
      if (dataHint) {
        const b = storageInfo.backupDir || '';
        const extra = storageInfo.restored ? '（本次启动已从程序目录之外的备份自动恢复）' : '';
        const fb = storageInfo.fallback ? '（程序安装目录不可写，已自动改存到用户目录）' : '';
        dataHint.textContent = '本机自动备份目录：' + b + '。保存后自动更新；换电脑请使用“备份到文件”。' + extra + fb
          + (storageInfo.repaired?.length ? '（本次启动发现 ' + storageInfo.repaired.length + ' 个数据文件丢失或损坏，已从备份回填，请核对最近的单据）' : '');
      }
    };
    if (window.Android && window.Android.getStorageInfo) {
      window.Android.getStorageInfo()
        .then(res => {
          if (res && res.ok && res.info) { storageInfo = res.info; updateDataDirNote(); }
          else { storageInfo = null; updateDataDirNote(); }
        })
        .catch(() => { storageInfo = null; updateDataDirNote(); });
    } else {
      if (dataActions) dataActions.style.display = 'none';
      if (dataDirNote) dataDirNote.textContent = '本环境使用浏览器本地存储';
    }

    /* 关闭按钮行为（仅桌面端）：单选「最小化/退出」+ 勾选「关闭时提示」 */
    const closeChoice = $('[data-role="close-choice"]', el);
    const closePromptBox = $('[data-role="close-prompt"]', el);
    const closeRadios = () => Array.prototype.slice.call(el.querySelectorAll('[data-role="close-radio"]'));
    let closePrefs = { action: 'minimize', prompt: true };
    const fillCloseForm = prefs => {
      closePrefs = { action: prefs.action === 'quit' ? 'quit' : 'minimize', prompt: !!prefs.prompt };
      closeRadios().forEach(radio => { radio.checked = radio.value === closePrefs.action; });
      if (closePromptBox) closePromptBox.checked = closePrefs.prompt;
    };
    const saveClosePrefs = async () => {
      if (!(window.Android && window.Android.setClosePrefs)) { toast('当前环境不支持该设置', true); return; }
      const picked = closeRadios().find(radio => radio.checked);
      const action = picked ? picked.value : closePrefs.action;
      const prompt = closePromptBox ? !!closePromptBox.checked : closePrefs.prompt;
      try {
        const res = await window.Android.setClosePrefs({ action, prompt });
        if (res && res.ok === false) { toast('保存失败：' + (res.error || '未知错误'), true); return; }
        fillCloseForm({ action: res && res.action ? res.action : action, prompt: res && res.prompt != null ? res.prompt : prompt });
        toast('已保存关闭设置');
      } catch (err) {
        toast('保存失败：' + (err && err.message || err), true);
      }
    };
    if (window.Android && window.Android.getClosePrefs) {
      window.Android.getClosePrefs()
        .then(res => fillCloseForm(res && res.ok ? res : closePrefs))
        .catch(() => fillCloseForm(closePrefs));
    } else if (closeChoice) {
      closeChoice.style.display = 'none';
    }

    el.addEventListener('change', e => {
      const t = e.target;
      if (t && (t.getAttribute('data-role') === 'close-radio' || t.getAttribute('data-role') === 'close-prompt')) {
        saveClosePrefs();
      }
    });

    el.addEventListener('keydown', e => {
      const cur = e.target.closest && e.target.closest('.exp-format-opt');
      if (!cur || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      const box = cur.closest('[data-role="export-format"]');
      const opts = Array.prototype.slice.call(box.querySelectorAll('.exp-format-opt'));
      if (!opts.length) return;
      e.preventDefault();
      const i = opts.indexOf(cur);
      const next = opts[(i + (e.key === 'ArrowRight' ? 1 : opts.length - 1)) % opts.length];
      next.click(); next.focus();
    });

    el.addEventListener('click', async e => {
      const go = e.target.closest('[data-go]');
      if (go) { location.hash = '#/' + go.dataset.go; return; }
      const fmt = e.target.closest('.exp-format-opt');
      if (fmt) {
        const box = fmt.closest('[data-role="export-format"]');
        if (box && !box.classList.contains('is-busy')) {
          box.dataset.value = fmt.dataset.format;
          box.querySelectorAll('.exp-format-opt').forEach(b => {
            const on = b === fmt;
            b.classList.toggle('is-on', on);
            b.setAttribute('aria-checked', on ? 'true' : 'false');
            b.tabIndex = on ? 0 : -1;
          });
        }
        return;
      }
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
        try { Store.setSettings({ imageDir: '' }); } catch(error) { toast(error.message || '保存失败',true);return; }
        updateImageDirNote();
        toast('已恢复默认图片位置');
        return;
      }
      if (a === 'open-image-dir') {
        if (!(window.Android && window.Android.openImageDir)) { toast('当前环境不支持打开文件夹', true); return; }
        window.Android.openImageDir(Store.getSettings().imageDir || '');
        return;
      }
      if (a === 'open-data-dir') {
        if (!(window.Android && window.Android.openDataDir)) { toast('当前环境不支持打开文件夹', true); return; }
        const res = await window.Android.openDataDir('data');
        if (res && res.ok === false && res.error) toast('打开失败：' + res.error, true);
        return;
      }
      if (a === 'open-backup-dir') {
        if (!(window.Android && window.Android.openDataDir)) { toast('当前环境不支持打开文件夹', true); return; }
        const res = await window.Android.openDataDir('backup');
        if (res && res.ok === false && res.error) toast('打开失败：' + res.error, true);
        return;
      }
      if (a === 'backup-now') {
        if (!(window.Android && window.Android.backupNow)) { toast('当前环境不支持手动备份', true); return; }
        try {
          const res = await window.Android.backupNow();
          if (res && res.ok === false) { toast('备份失败：' + (res.error || '未知错误'), true); return; }
          if (res && res.info) { storageInfo = res.info; updateDataDirNote(); }
          toast('已备份到程序目录之外');
        } catch (err) {
          toast('备份失败：' + (err && err.message || err), true);
        }
        return;
      }
      if (a === 'company-info') {
        location.hash = '#/settings/company';
        return;
      }
      if (a === 'toggle-bg3d') {
        const next = !window.DNSDesktop.sceneEnabled();
        window.DNSDesktop.setSceneEnabled(next);
        act.querySelector('.settings-row-value').textContent=bg3dValueText();
        toast(next?'已开启场景工作台':'已关闭 3D 场景，业务操作不受影响');
        return;
      }
      if (a === 'backup') {
        if (backupBusy) return;
        backupBusy = true;
        act.disabled = true;
        try {
          const name = '送货宝备份_' + todayStr().replace(/-/g, '');
          if (window.Android?.exportBackup) {
            const result = await window.Android.exportBackup(Store.exportJSON(), name + '.zip');
            if (result.ok) toast('备份已导出');
            else if (!result.canceled) toast(result.error || '备份导出失败', true);
          } else {
            const json = await exportBackupJSON();
            if ((await downloadBlob(name + '.json', new Blob([json], { type: 'application/json' }))).ok) toast('备份已导出');
          }
        } catch(error) { toast(error.message || '备份导出失败',true); }
        finally { backupBusy = false; act.disabled = false; }
        return;
      }
      if (a === 'restore') {
        const ok = await confirmDialog({ title: '恢复备份会覆盖当前全部数据，继续？', okText: '继续' });
        if (!ok) return;
        const prepared = window.Android?.pickBackup ? await window.Android.pickBackup() : { ok: true, text: await pickFileAsText('.json') };
        if (prepared.canceled || prepared.text == null && prepared.ok) return;
        if (!prepared.ok) { toast(prepared.error || '备份读取失败', true); return; }
        let restored = false;
        try {
          Store.importJSON(prepared.text);
          restored = true;
          window.ScanOrders?.clearForReplacement();
          toast('恢复成功');
          location.hash = '#/home';
        } catch (err) {
          toast(err.message || '恢复失败', true);
        } finally {
          if (prepared.token) {
            const result = await window.Android.finishBackupImport(prepared.token, restored);
            if (!result.ok) toast('图片暂存目录处理失败：' + (result.error || '请检查存储空间'), true);
          }
        }
        return;
      }
      if (a === 'exp-orders') {
        if (!ensureExportable()) return;
        const rows = Store.ordersTable();
        const tq = sumQuantities(rows.map(r => r.qty));
        const ta = Math.round(rows.reduce((x, r) => x + (r.total || 0), 0) * 100) / 100;
        const bytes = Xlsx.build([{ name: '送货单', title: '送货宝统计表', headers: ['日期', '单号', '客户', '件数', '金额(元)'], rows: rows.map(r => [r.date, r.no, r.customer, r.qty, r.total]), widths: [12, 16, 16, 8, 12], footer: ['', '', '合计', tq, ta] }]);
        if ((await downloadBlob('送货宝.xlsx', xlsxBlob(bytes))).ok) toast('已导出 Excel');
        return;
      }
      if (a === 'exp-products' || a === 'exp-customers') {
        if (!ensureExportable()) return;
        if (act.disabled) return;
        const formatInput = act.closest('[data-export-kind]').querySelector('[data-role="export-format"]');
        const format = formatInput.value || formatInput.dataset.value;
        if (format !== 'xlsx' && format !== 'csv') { toast('请选择有效的导出格式', true); return; }
        act.disabled = true; formatInput.classList.add('is-busy');
        try {
          let sheet;
          if (a === 'exp-products') {
            const ps = Store.listProducts('', { includeArchived: true });
            sheet = { name: '商品', title: '商品资料', headers: ['编号', '条码', '产品名称', '规格', '单位', '零售价', '成本价', '状态', '备注'], rows: ps.map(p => [p.code || '', p.barcode || '', p.name, p.spec || '', p.unit || '', p.price != null ? p.price : '', p.cost != null ? p.cost : '', p.archived ? '已下架' : '在售', p.remark || '']), widths: [12, 14, 22, 12, 8, 10, 10, 8, 20] };
          } else {
            const cs = Store.listCustomers('');
            sheet = { name: '客户', title: '客户资料', headers: ['客户名称', '电话', '联系人', '地址', '备注'], rows: cs.map(c => [c.name, c.phone || '', c.contact || '', c.address || '', c.remark || '']), widths: [18, 16, 12, 28, 20] };
          }
          const blob = format === 'csv'
            ? new Blob(['\uFEFF' + Store.tableCSV(sheet.headers, sheet.rows)], { type: 'text/csv;charset=utf-8' })
            : xlsxBlob(Xlsx.build([sheet]));
          if ((await downloadBlob(sheet.name + '.' + format, blob)).ok) toast('已导出 ' + (format === 'csv' ? 'CSV' : 'Excel'));
        } catch (error) { toast(error.message || '资料导出失败', true); }
        finally { act.disabled = false; formatInput.classList.remove('is-busy'); }
        return;
      }
      if (a === 'imp-products' || a === 'imp-customers') {
        if (importing) return;
        if (Store.recoveryState().blocked) { toast('本地数据异常，请先导出原始数据并恢复有效备份，再导入资料', true); return; }
        importing = true;
        const buttons = $$('[data-act="imp-products"],[data-act="imp-customers"]', el);
        buttons.forEach(button => { button.disabled = true; });
        try {
          const kind = a === 'imp-products' ? 'products' : 'customers';
          const table = await pickDataTable(kind);
          if (!table) return;
          const r = Store.importTables(kind, table.sheets);
          toast(`已识别 ${table.format}，新增 ${r.added} 条，跳过重复 ${r.skipped} 条`);
        } catch (err) {
          toast(err.message || '导入失败', true);
        } finally {
          importing = false;
          buttons.forEach(button => { button.disabled = false; });
        }
        return;
      }
      if (a === 'clear') {
        const ok = await confirmDialog({ title: '确定清空全部数据？', text: '所有单据、客户、商品将被删除，无法恢复。建议先导出备份。', okText: '清空', danger: true });
        if (!ok) return;
        try { Store.clearAll(); } catch(error) { toast(error.message || '清空失败',true);return; }
        window.ScanOrders?.clearForReplacement();
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
          <div class="field"><label class="lab" for="company-name">公司 / 店铺名称（用于送货单水印）</label><input id="company-name" data-s="company" value="${esc(settings.company)}"></div>
          <div class="field-row">
            <div class="field"><label class="lab" for="company-phone">联系电话</label><input id="company-phone" data-s="phone" value="${esc(settings.phone)}"></div>
            <div class="field"><label class="lab" for="company-contact">联系人</label><input id="company-contact" data-s="contact" value="${esc(settings.contact)}"></div>
          </div>
          <div class="field"><label class="lab" for="company-address">地址</label><input id="company-address" data-s="address" value="${esc(settings.address)}"></div>
          <div class="field-row">
            <div class="field"><label class="lab" for="company-prefix">单号前缀</label><input id="company-prefix" data-s="noPrefix" value="${esc(settings.noPrefix)}"></div>
            <div class="field"><label class="lab" for="company-operator">默认制单人</label><input id="company-operator" data-s="operator" value="${esc(settings.operator)}"></div>
          </div>
          <div class="field wm-field">
            <label class="lab" for="company-watermark">送货单水印</label>
            <div class="wm-row">
              <div class="wm-preview" data-role="wm-preview" aria-hidden="true"></div>
              <div class="wm-copy">
                <span class="wm-title">斜向平铺公司名称</span>
                <span class="wm-desc">作为单据底纹，不影响金额与文字清晰度</span>
              </div>
              <label class="wm-switch">
                <input type="checkbox" id="company-watermark" data-s="watermark" ${settings.watermark !== false ? 'checked' : ''}>
                <span class="wm-slider" aria-hidden="true"></span>
              </label>
            </div>
          </div>
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
    const wmBox = $('[data-role="wm-preview"]', el);
    const wmToggle = $('#company-watermark', el);
    const paintWmPreview = () => {
      if (!wmBox) return;
      const nm = ($('[data-s="company"]', el).value || '').trim() || '公司/店铺名称';
      const tile = typeof watermarkTileWidth === 'function' ? watermarkTileWidth(nm) : 300;
      if (typeof watermarkSpriteUrl === 'function') {
        wmBox.style.backgroundImage = 'url("' + watermarkSpriteUrl(nm, tile, 0.2) + '")';
        wmBox.style.backgroundSize = Math.round(tile * 0.3) + 'px 51px';
      }
      wmBox.classList.toggle('is-off', !(wmToggle && wmToggle.checked));
    };
    paintWmPreview();
    if (wmToggle) wmToggle.addEventListener('change', paintWmPreview);
    const updatePreview = () => {
      $('[data-role="bill-title-preview"]', el).textContent = billTitleFor('示例客户', todayStr().slice(0, 7), {
        billTitle: storedTitle(titleInput.value), company: $('[data-s="company"]', el).value.trim(),
      });
    };
    updatePreview();
    el.addEventListener('input', e => {
      if (e.target.matches('[data-s="billTitle"], [data-s="company"]')) { updatePreview(); paintWmPreview(); }
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
        ['company', 'phone', 'contact', 'address', 'noPrefix', 'operator'].forEach(key => {
          patch[key] = $('[data-s="' + key + '"]', el).value.trim();
        });
        patch.billTitle = storedTitle(titleInput.value);
        const wmInput = $('[data-s="watermark"]', el);
        patch.watermark = !!(wmInput && wmInput.checked);
        try { Store.setSettings(patch); } catch(error) { toast(error.message || '保存失败',true);return; }
        el.dispatchEvent(new Event('dns-form-committed',{bubbles:true}));
        toast('公司/店铺信息已保存');
        location.hash = '#/settings';
      }
    });
    return el;
  },
};
