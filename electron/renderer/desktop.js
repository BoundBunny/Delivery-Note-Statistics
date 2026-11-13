'use strict';
/* Workspace: fixed summaries, row-attached order previews, explicit task editors. */
window.DNSDesktop = (() => {
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const e = value => esc(value);
  const amount = value => fmtMoney(Number(value) || 0);
  const sum = list => list.reduce((n,o)=>n+Math.round((Number(o.total)||0)*100),0)/100;
  const categories = {all:'全部',snack:'休闲零食',drink:'酒水饮料',candy:'糖果巧克力',grain:'粮油副食',daily:'日用百货',tobacco:'香烟烟草'};
  const names = {orders:'送货单',products:'商品管理',customers:'客户管理',stats:'统计对账',settings:'本机设置'};
  const state = {panel:'orders',selectedId:null,selectionOpen:false,orderRange:'today',immersive:false,collapsed:false};
  const data = {orders:[],products:[],customers:[],settings:{}};
  let overview={today:[],month:[],todayAmount:0,monthAmount:0,groups:[],categoryCounts:{},trend:[]};
  let root,page,reader,container,originalApp,scene,currentView,ordersView,originalBack,oldBackground;
  let started=false,ready=false,sceneLoading=false,generation=0,routeKey='',mode='orders';
  let storeRevision=-1,snapshotDay='',renderedRevision=-1,renderedDay='',ordersRevision=-1,ordersDay='';
  let refreshTimer,unsubscribeStore,moduleResizeObserver,metricResizeObserver,metricFrame=0;
  let selectionFrame=0;
  let moduleLaunch=null,moduleOpener=null,moduleNoticeTimer=null,moduleTrace=null;
  const moduleAnimations=[];
  let draftBaseline='',moduleDirty=false,pendingNavigation=null,drag=null;
  let formAnchor=null,formBaseline='',approvedHash=null;
  let workspaceReturn='#/orders',taskReturn='#/orders',readerReturn='#/orders',detailReturn='#/orders';
  const scrollPositions=new Map(),scriptLoads=new Map();
  const moduleWindow={rect:null,restore:null,maximized:false};
  const assets=window.Android.desktopAssetsUrl;
  // 界面偏好同样落到「安装目录相对路径」的文件后端，浏览器环境回退 localStorage
  const prefStore=(typeof window!=='undefined'&&window.__DNSStorage)||(typeof localStorage!=='undefined'?localStorage:null);
  // Retain old preferences verbatim; the former focused flag no longer hides panels.
  const prefs={scene:true,motion:true,night:false,focused:false};
  try{const saved=JSON.parse((prefStore&&prefStore.getItem('sd_desktop_ui'))||'null');if(saved&&typeof saved==='object')for(const k of Object.keys(prefs))if(typeof saved[k]==='boolean')prefs[k]=saved[k];}catch(_){}
  const today=()=>todayStr();
  const ym=()=>today().slice(0,7);
  const selected=()=>data.orders.find(o=>o.id===state.selectedId)||null;
  // 单据行商品缩略图：按 pid 或 name+spec 找到商品图片（同一张图无需重复，走同一套缩略图缓存）
  const itemImage=it=>{let p=null;if(it&&it.pid)p=Store.getProduct(it.pid);if(!p&&it&&it.name){const list=Store.listProducts(it.name)||[];p=list.find(x=>x.name===it.name&&(x.spec||'')===(it.spec||''));}return p&&p.image?p.image:'';};
  const monoChar=name=>{const s=String(name||'').trim();if(!s)return '＋';const first=Array.from(s)[0];return /[\u4e00-\u9fff]/.test(first)?first:s.replace(/\s+/g,'').slice(0,2).toUpperCase();};
  const categoryOf=p=>({wine:'drink',other:'daily'}[p.category]||p.category||'');
  function savePrefs(){try{if(prefStore)prefStore.setItem('sd_desktop_ui',JSON.stringify(prefs));}catch(_){toast('界面偏好未能保存，请检查存储空间',true);}}
  function editableForm(){return mode==='task'&&!!currentView?.querySelector('[data-role="name"],[data-s="company"]');}
  function formSnapshot(){return JSON.stringify({fields:Array.from(currentView?.querySelectorAll('input,textarea,select')||[]).map(el=>[el.dataset.role||el.dataset.s||el.name,el.value,el.checked]),image:currentView?.querySelector('.pm-img-preview img')?.getAttribute('src')||''});}
  function captureFormBaseline(){formAnchor=currentView?.querySelector('[data-role="name"],[data-s="company"]')||null;formBaseline=formSnapshot();}
  function isDirty(){if(mode!=='task'||!currentView||currentView.__saved)return false;if(Array.from(document.querySelectorAll('#modal-root .mask')).some(mask=>mask.__isDirty?.()))return true;if(currentView.__draft)return JSON.stringify(currentView.__draft)!==draftBaseline;if(!editableForm())return false;if(currentView.querySelector('[data-role="name"],[data-s="company"]')!==formAnchor)captureFormBaseline();return formSnapshot()!==formBaseline;}
  function canonicalRoute(hash){
    const alias=/^#\/(?:home)?(\?.*)?$/.exec(hash||'#/');
    return alias?'#/orders'+(alias[1]||''):hash;
  }
  function go(hash){
    hash=canonicalRoute(hash);
    if(window.ScanOrders?.blocksNavigation(hash)){toast('请先保存当前扫码单，或选择继续本单',true);return Promise.resolve(false);}
    if(location.hash===hash){if(mode==='task'){if(['products','customers'].includes(page.dataset.module))revealModuleWindow(true);else page.focus({preventScroll:true});}return Promise.resolve(true);}
    if(pendingNavigation)return pendingNavigation;
    if(isDirty()){
      pendingNavigation=confirmDialog({title:'当前修改尚未保存',text:'切换或关闭任务会放弃本次未保存的修改，是否继续？',okText:'放弃修改并继续',danger:true})
        .then(ok=>{if(ok){approvedHash=hash;location.hash=hash;}else moduleLaunch=null;return ok;}).finally(()=>{pendingNavigation=null;});
      return pendingNavigation;
    }
    location.hash=hash;return Promise.resolve(true);
  }
  function readStore(){
    if(storeRevision!==Store.revision||snapshotDay!==today()){
      data.orders=Store.listOrders();data.products=Store.listProducts();data.customers=Store.listCustomers();data.settings=Store.getSettings();
      const daily=[],monthly=[],counts=Object.fromEntries(Object.keys(categories).filter(k=>k!=='all').map(k=>[k,0]));
      const dailyAmounts=new Map(),dailyCounts=new Map();
      for(const order of data.orders){if(order.date===today())daily.push(order);if(String(order.date||'').slice(0,7)===ym())monthly.push(order);dailyAmounts.set(order.date,(dailyAmounts.get(order.date)||0)+Math.round((Number(order.total)||0)*100));dailyCounts.set(order.date,(dailyCounts.get(order.date)||0)+1);}
      for(const product of data.products){const key=categoryOf(product);if(Object.hasOwn(counts,key))counts[key]++;}
      const trend=Array.from({length:7},(_,i)=>{const day=addDays(today(),i-6);return {day,total:(dailyAmounts.get(day)||0)/100,count:dailyCounts.get(day)||0};});
      overview={today:daily,month:monthly,todayAmount:sum(daily),monthAmount:sum(monthly),groups:Store.billGroups(ym()),categoryCounts:counts,trend};
      // 往来客户：只统计“有单据”的客户，与「数据统计」页口径一致
      // （按 customer.id 去重；散客没有 customer.id，不计入）。
      // 统计范围与同面板的「本月销售额 / 本月单据数」保持一致 → 本月。
      const activeCustomerIds=new Set();
      for(const order of monthly){if(order.customer&&order.customer.id)activeCustomerIds.add(order.customer.id);}
      overview.activeCustomerCount=activeCustomerIds.size;
      storeRevision=Store.revision;snapshotDay=today();
    }
    if(!data.orders.some(o=>o.id===state.selectedId)){if(state.selectionOpen)closeSelection();state.selectedId=data.orders[0]?.id||null;}
  }
  function renderDispatch(){
    ensureOrdersView();
  }
  function renderStatistics(){
    if(Store.recoveryState().blocked){root.querySelector('#statistics-summary').innerHTML='<div class="fixed-empty"><p>统计暂不可用</p><p>数据恢复后重新计算。</p></div>';return;}
    root.querySelector('#statistics-summary').innerHTML=`
      <div class="metric money"><div class="value" data-month-amount title="¥ ${amount(overview.monthAmount)}">${amount(overview.monthAmount)}</div></div>
      <div class="fixed-stat-foot"><span>本月单据 ${overview.month.length} 张</span><div class="metric"><span class="label">本月有单客户</span><span class="value">${overview.activeCustomerCount||0}<span class="unit">位</span></span></div></div>
      <div class="fixed-trend-section"><div class="fixed-trend-heading"><b>近7天每日销售额</b><span>${overview.trend[0].day.slice(5).replace('-', '/')}—${today().slice(5).replace('-', '/')}</span></div>
      ${salesTrendChart(overview.trend,{compact:true})}
      <div class="fixed-trend-today">今日销售额 <strong>¥${amount(overview.todayAmount)}</strong></div></div>`;
    scheduleMetrics();
  }
  function renderSelection(){
    const host=root.querySelector('#selection-summary'),scroll=host.scrollTop,order=selected();
    const actions=root.querySelector('#selection-actions');
    if(Store.recoveryState().blocked){actions.replaceChildren();actions.hidden=true;root.querySelector('[data-action=selection-expand]').disabled=true;host.innerHTML='<div class="fixed-empty"><p>单据读取已进入保护模式</p><p>原始记录已保留，恢复有效备份前不能保存或删除。</p><button class="fixed-text-button" data-route="#/settings">打开设置恢复</button></div>';return;}
    root.querySelector('[data-action=selection-expand]').disabled=!order;
    if(!order){actions.replaceChildren();actions.hidden=true;host.innerHTML=`<div class="fixed-empty first-order"><span class="section-icon">${icon('file')}</span><h3>从第一张送货单开始</h3><p>选择客户、填写货品并保存，<br>今日汇总和月度统计会自动更新。</p><button class="primary-button" data-route="#/order/new">${icon('plus')}新建送货单</button><button class="fixed-text-button" data-route="#/settings">从备份恢复已有数据</button></div>`;return;}
    host.innerHTML=`<div class="fixed-order-meta"><span title="${e(order.no)}">${e(order.no)}</span><span>${e(order.date)}</span></div>
      <button class="fixed-customer" ${order.customer?.id?'data-customer-id="'+e(order.customer.id)+'"':'data-route="#/customers"'}>${icon('people')}<span>${e(order.customer?.name||'散客')}</span>${icon('chevron')}</button>
      <div class="fixed-selection-items">${(order.items||[]).map(item=>{const img=itemImage(item);return `<div class="fixed-selection-item"><span class="fixed-selection-thumb">${img?`<img src="${e(productImageUrl(img))}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none';var m=this.nextElementSibling;if(m)m.style.display='flex';">`:''}<i class="fixed-selection-mono"${img?' style="display:none"':''}>${e(monoChar(item.name))}</i></span><span class="fixed-selection-text"><b>${e(item.name)}</b><small>${e([item.spec,fmtNum(item.qty)+' '+(item.unit||'件'),'× ¥'+fmtPrice(item.price)].filter(Boolean).join(' · '))}</small></span><strong>${amount(item.amount)}</strong></div>`;}).join('')}</div>
      <div class="order-total"><span>合计金额</span><strong title="¥ ${amount(order.total)}"><small>¥</small>${amount(order.total)}</strong></div>`;
    actions.innerHTML=`<button class="primary-button" data-route="#/print?id=${encodeURIComponent(order.id)}">${icon('print')}打印 / 导出</button><button class="secondary-button" data-route="#/order/edit?id=${encodeURIComponent(order.id)}" aria-label="编辑送货单" title="编辑送货单">${icon('file')}</button><button class="secondary-button" data-action="copy-order" aria-label="复制新增" title="复制新增">${icon('plus')}</button>`;
    actions.hidden=false;
    host.scrollTop=scroll;
  }
  function selectionSource(){return Array.from(root.querySelectorAll('#dispatch-body [data-order-id]')).find(row=>row.dataset.orderId===state.selectedId)||null;}
  function updateSelectionSource(){
    const preview=state.selectionOpen&&['orders','stats'].includes(mode);
    root.querySelectorAll('#dispatch-body [data-order-id]').forEach(row=>{
      const expanded=preview&&row.dataset.orderId===state.selectedId,on=expanded;
      row.classList.toggle('selected',on);row.classList.toggle('selection-source',expanded);row.setAttribute('aria-pressed',String(on));row.setAttribute('aria-expanded',String(expanded));
    });
  }
  function closeSelection(restoreFocus=false){
    const source=selectionSource();state.selectionOpen=false;
    const panel=root.querySelector('#context-panel');panel.hidden=true;
    panel.classList.remove('selection-entering');updateSelectionSource();
    if(restoreFocus&&source?.isConnected)source.focus({preventScroll:true});
  }
  function scheduleSelectionPosition(){
    if(!selectionFrame)selectionFrame=requestAnimationFrame(()=>{selectionFrame=0;if(started)positionSelection();});
  }
  function positionSelection(){
    const panel=root.querySelector('#context-panel');
    panel.classList.add('selection-flyout');
    if(!state.selectionOpen||!['orders','stats'].includes(mode)||Store.recoveryState().blocked){panel.hidden=true;updateSelectionSource();return;}
    const row=selectionSource(),list=root.querySelector('#dispatch-body');
    if(!row||list.hidden){closeSelection();return;}
    const r=row.getBoundingClientRect(),l=list.getBoundingClientRect();
    const anchorTop=Math.max(r.top,l.top),anchorBottom=Math.min(r.bottom,l.bottom);
    if(anchorBottom-anchorTop<12||r.width<=0){closeSelection();return;}
    const bounds=moduleBounds(),dispatch=root.querySelector('#dispatch-panel').getBoundingClientRect();
    const left=dispatch.right+12,width=Math.min(410,bounds.right-left),availableHeight=bounds.bottom-bounds.top;
    if(width<260||availableHeight<180){closeSelection();return;}
    panel.style.setProperty('--selection-left',left+'px');panel.style.setProperty('--selection-width',width+'px');panel.style.setProperty('--selection-height','auto');
    panel.hidden=false;
    const summary=root.querySelector('#selection-summary'),actions=root.querySelector('#selection-actions');
    const desired=panel.querySelector('.fixed-pane-heading').offsetHeight+summary.scrollHeight+(!actions.hidden?actions.offsetHeight:0)+2;
    const height=Math.min(Math.max(300,desired),580,availableHeight);
    const center=(anchorTop+anchorBottom)/2;
    const top=Math.max(bounds.top,Math.min(r.top,bounds.bottom-height));
    panel.style.setProperty('--selection-top',top+'px');panel.style.setProperty('--selection-height',height+'px');
    panel.style.setProperty('--selection-anchor-y',Math.max(18,Math.min(height-18,center-top))+'px');
    panel.style.setProperty('--selection-link-width',Math.max(12,left-r.right)+'px');
    updateSelectionSource();
  }
  function dismissSelection(event){
    if(!state.selectionOpen||!['orders','stats'].includes(mode))return;
    if(event.target.closest('#context-panel,#dispatch-body [data-order-id]'))return;
    closeSelection();
  }
  function scheduleMetrics(){if(!metricFrame)metricFrame=requestAnimationFrame(()=>{metricFrame=0;if(started)fitMetrics();});}
  function fitMetrics(){
    for(const value of root.querySelectorAll('.metric.money .value')){
      value.style.fontSize='';let size=parseFloat(getComputedStyle(value).fontSize);const width=value.parentElement.clientWidth;
      while(size>13&&value.scrollWidth>width){size--;value.style.fontSize=size+'px';}
      value.style.overflowWrap='anywhere';
    }
  }
  function updateSceneData(){
    if(!scene)return;
    scene.setCatalogCount(data.products.length);
    scene.setBusinessData({todayCount:overview.today.length,todayAmount:overview.todayAmount,monthCount:overview.month.length,monthAmount:overview.monthAmount,month:ym(),customerCount:overview.activeCustomerCount||0,company:data.settings.company||'',operator:data.settings.operator||'',categoryCounts:overview.categoryCounts,topCustomers:overview.groups.slice(0,3).map(g=>({name:g.name,total:g.total}))});
  }
  function ensureOrdersView(){
    const host=root.querySelector('#dispatch-collection');
    if(Store.recoveryState().blocked){ordersView?.dispose?.();ordersView=null;host.innerHTML='<div class="fixed-empty"><p>单据汇总暂不可用</p><p>请先导出原始数据并恢复有效备份。</p></div>';return;}
    const scroll=root.querySelector('#dispatch-body').scrollTop;
    if(!ordersView){
      host.replaceChildren();
      ordersView=Views.orders.render({desktop:true,onOpen:id=>{if(state.selectionOpen&&state.selectedId===id)closeSelection(true);else selectOrder(id);},onChange:list=>{
        state.orderRange=Views.orders.state.range;
        if(state.selectionOpen&&!list.some(order=>order.id===state.selectedId))closeSelection();
        updateSelectionSource();scheduleMetrics();scheduleSelectionPosition();
      }});
      host.appendChild(ordersView);ordersRevision=storeRevision;ordersDay=snapshotDay;
    }else if(ordersRevision!==storeRevision||ordersDay!==snapshotDay){
      ordersView.update();ordersRevision=storeRevision;ordersDay=snapshotDay;
    }
    root.querySelector('#dispatch-body').scrollTop=scroll;
    updateSelectionSource();scheduleSelectionPosition();
  }
  function refresh(){
    if(!started)return;readStore();syncRecoveryNotice();
    if(renderedRevision===storeRevision&&renderedDay===snapshotDay)return;
    renderDispatch();renderStatistics();renderSelection();ensureOrdersView();updateSceneData();
    root.querySelector('#today-label').textContent=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
    root.querySelector('.local-account b').textContent=data.settings.company||'本机设置';
    renderedRevision=storeRevision;renderedDay=snapshotDay;
  }
  function applyLayout(){
    const work=root.querySelector('.workspace');
    work.classList.toggle('statistics-expanded',mode==='stats');work.classList.toggle('module-open',mode==='task');
    work.inert=mode==='task'||mode==='reader'||mode==='detail';
    root.querySelector('#statistics-summary').hidden=mode==='stats';root.querySelector('#statistics-view').hidden=mode!=='stats';root.querySelector('#statistics-title').textContent=mode==='stats'?'统计对账':'本月销售概览';root.querySelector('[data-action=statistics-expand]').textContent=mode==='stats'?'返回概览':'统计 / 对账';
    root.querySelector('#selection-actions').hidden=!selected();
    positionSelection();
    document.body.classList.toggle('desktop-business-mode',mode==='task');document.body.classList.toggle('desktop-reader-mode',mode==='reader'||mode==='detail');
    scene?.setImmersive(true);syncControls();
  }
  function selectOrder(id){
    if(!Store.getOrder(id)||Store.recoveryState().blocked)return;
    state.selectedId=id;
    if(!['orders','stats'].includes(mode))return;
    state.selectionOpen=true;renderSelection();ensureOrdersView();positionSelection();
    const panel=root.querySelector('#context-panel');
    panel.classList.remove('selection-entering');void panel.offsetWidth;panel.classList.add('selection-entering');
  }
  function openSceneModule(kind,category){
    if(kind==='new'){go('#/order/new');return;}
    if(kind==='orders'){go('#/orders');return;}
    if(names[kind])go('#/'+kind+(category?'?cat='+encodeURIComponent(category):''));
  }
  function setPanel(kind,category,customerId){
    if(kind==='home'){restoreWorkspace();return;}
    if(kind==='customers'&&customerId){go('#/customers?edit='+encodeURIComponent(customerId));return;}
    openSceneModule(kind,category);
  }
  function setNavigation(module){root.querySelectorAll('.nav-item').forEach(button=>{const on=button.dataset.module===module;button.classList.toggle('active',on);if(on)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});}
  function rememberScroll(){if(!currentView||!routeKey)return;const host=container.closest('[data-desktop-scroll]');if(host)scrollPositions.set(routeKey,host.scrollTop);}
  function clearView(){rememberScroll();currentView?.dispose?.();currentView=null;container.replaceChildren();originalApp.prepend(container);}
  function mountView(view,host,params,hash){
    currentView=Views[view].render(params);
    if(canonicalRoute(location.hash)!==hash){currentView?.dispose?.();currentView=null;return false;}
    host.appendChild(container);if(currentView)container.appendChild(currentView);
    host.scrollTop=scrollPositions.get(hash)||0;moduleDirty=false;draftBaseline=currentView?.__draft?JSON.stringify(currentView.__draft):'';captureFormBaseline();return true;
  }
  function route(){
    if(!started)return;
    const hash=canonicalRoute(location.hash),url=new URL(hash.replace(/^#/,''),'https://desktop.invalid'),path=url.pathname,params=Object.fromEntries(url.searchParams);
    if(window.ScanOrders?.blocksNavigation(hash)){history.replaceState(null,'',location.pathname+location.search+(routeKey||'#/order/scan'));toast('请先确认当前扫码单',true);return;}
    if(location.hash!==hash)history.replaceState(null,'',location.pathname+location.search+hash);
    if(routeKey===hash)return;
    if(isDirty()&&hash!==approvedHash){history.replaceState(null,'',location.pathname+location.search+(routeKey||'#/orders'));go(hash);return;}
    approvedHash=null;
    if(Store.recoveryState().blocked&&/^\/order(?:\/new|\/edit|\/scan)?$/.test(path)){toast('数据处于只读保护，请先恢复备份',true);location.hash='#/settings';return;}
    const previousMode=mode,previousHash=routeKey,previousOpener=moduleOpener;
    clearModuleNotice();
    clearView();page.hidden=true;reader.hidden=true;moduleDirty=false;draftBaseline='';readStore();
    const detail=path==='/order/view';
    if(detail&&params.id&&Store.getOrder(params.id))state.selectedId=params.id;
    if(path==='/print'&&params.id&&Store.getOrder(params.id))state.selectedId=params.id;
    const tasks={'/order/scan':['scanOrder','orders','扫码送货单'],'/order/new':['order','orders','新建送货单'],'/order':['order','orders','新建送货单'],'/order/edit':['order','orders','编辑送货单'],'/products':['products','products','商品管理'],'/customers':['customers','customers','客户管理'],'/settings':['settings','settings','本机设置'],'/settings/company':['companyInfo','settings','公司 / 店铺信息']};
    if(path==='/orders'){mode='orders';state.panel='orders';if(params.order&&Store.getOrder(params.order))state.selectedId=params.order;const customerId=params.customer||'';if((Views.orders.state.customerId||'')!==customerId){Views.orders.state.customerId=customerId;if(customerId){Views.orders.state.range='all';Views.orders.state.kw='';}ordersRevision=-1;}setNavigation('orders');}
    else if(detail){
      if(previousMode!=='detail'&&previousMode!=='reader'&&!(previousMode==='task'&&taskReturn.startsWith('#/order/view')))detailReturn=previousMode==='task'?taskReturn:previousHash||'#/orders';
      mode='detail';state.panel='orders';setNavigation('orders');reader.hidden=false;reader.classList.add('reader-solo');
      reader.querySelector('#desktop-reader-title').textContent='单据详情';
      if(!mountView('order',reader.querySelector('.desktop-reader-body'),params,hash))return;
    }
    else if(path==='/stats'){mode='stats';state.panel='stats';setNavigation('stats');}
    else if(path==='/print'||path==='/bill'){
      mode='reader';state.panel=path==='/bill'?'stats':'orders';setNavigation(state.panel);
      if(previousMode!=='reader')readerReturn=previousMode==='task'?taskReturn:previousHash||workspaceReturn;
      reader.hidden=false;reader.classList.add('reader-solo');reader.querySelector('#desktop-reader-title').textContent=path==='/bill'?'客户月度账单':'打印与导出';
      if(!mountView(path==='/bill'?'bill':'print',reader.querySelector('.desktop-reader-body'),params,hash))return;
    }else if(tasks[path]){
      const [view,module,title]=tasks[path];
      if(previousMode!=='task')taskReturn=previousMode==='reader'?readerReturn:previousHash||workspaceReturn;
      mode='task';state.panel=module;setNavigation(module);showModuleWindow(title,module);
      if(!mountView(view,page.querySelector('.module-window-body'),params,hash))return;
    }else{go('#/orders');return;}
    if(mode==='stats'&&!mountView('stats',root.querySelector('#statistics-view'),params,hash))return;
    if(mode!=='task'&&mode!=='reader')workspaceReturn=hash;
    refresh();renderDispatch();renderSelection();ensureOrdersView();
    applyLayout();if(currentView){const host=container.closest('[data-desktop-scroll]');if(host)host.scrollTop=scrollPositions.get(hash)||0;}updateSceneData();updateScene();routeKey=hash;updateModuleGeometry();
    syncModuleButtons();
    if(mode==='task'&&['products','customers'].includes(page.dataset.module))revealModuleWindow();
    else {
      moduleLaunch=null;
      if(previousMode==='task'&&previousOpener&&['orders','stats'].includes(mode)){
        const source=previousOpener.element?.isConnected&&previousOpener.element.checkVisibility()?previousOpener.element:root.querySelector('.nav-item[data-module="'+previousOpener.module+'"]');
        source?.focus({preventScroll:true});
      }
      moduleOpener=null;
    }
  }
  function restoreWorkspace(){if(root)closeSelection();return go('#/orders');}
  function setFocused(){scene?.focus('home');return true;}
  function moduleBounds(){const s=getComputedStyle(document.body);return {left:(parseFloat(s.getPropertyValue('--dns-nav-width'))||82)+12,top:(parseFloat(s.getPropertyValue('--dns-header-height'))||78)+12,right:innerWidth-12,bottom:innerHeight-14};}
  function constrainRect(r){const b=moduleBounds(),width=Math.min(b.right-b.left,Math.max(620,r.width)),height=Math.min(b.bottom-b.top,Math.max(340,r.height));return {left:Math.min(Math.max(r.left,b.left),b.right-width),top:Math.min(Math.max(r.top,b.top),b.bottom-height),width,height};}
  function setModuleRect(rect){const r=constrainRect(rect);for(const key of ['left','top','width','height'])page.style[key]=r[key]+'px';moduleWindow.rect=r;updateModuleGeometry();}
  function updateModuleGeometry(){if(!page||page.hidden||matchMedia('print').matches)return;const r=page.getBoundingClientRect();page.style.setProperty('--module-top',r.top+'px');page.style.setProperty('--module-right',innerWidth-r.right+'px');page.style.setProperty('--module-bottom',innerHeight-r.bottom+'px');page.classList.toggle('module-compact',r.width<790);if(!moduleWindow.maximized)moduleWindow.rect={left:r.left,top:r.top,width:r.width,height:r.height};}
  function showModuleWindow(title,module){
    page.hidden=false;page.querySelector('#desktop-module-title').textContent=title;page.dataset.module=module;
    page.querySelector('.module-icon').innerHTML=icon(module==='products'?'box':module==='customers'?'people':'grid');
    if(!moduleWindow.rect){const b=moduleBounds(),width=Math.min(1060,Math.max(720,(b.right-b.left)*.76));setModuleRect({left:innerWidth-width-28,top:b.top+32,width,height:Math.min(780,b.bottom-b.top-32)});}else setModuleRect(moduleWindow.rect);
    if(moduleWindow.maximized){const b=moduleBounds();setModuleRect({left:b.left,top:b.top,width:b.right-b.left,height:b.bottom-b.top});}
  }
  function syncModuleButtons(){
    root.querySelectorAll('.nav-item[data-module="products"],.nav-item[data-module="customers"],.scene-marker[data-scene-module="products"],.scene-marker[data-scene-module="customers"]').forEach(button=>{
      const module=button.dataset.module||button.dataset.sceneModule;
      button.setAttribute('aria-controls','desktop-module-window');
      button.setAttribute('aria-expanded',String(mode==='task'&&!page.hidden&&page.dataset.module===module));
    });
  }
  function rememberModuleLaunch(event){
    const element=event.target.closest?.('.nav-item[data-module],.scene-marker[data-scene-module]');
    if(!element||!root.contains(element))return;
    const module=element.dataset.module||element.dataset.sceneModule;
    if(!['products','customers'].includes(module))return;
    const r=element.getBoundingClientRect();
    moduleLaunch={module,element,rect:{left:r.left,top:r.top,width:r.width,height:r.height}};
  }
  function clearModuleNotice(){
    clearTimeout(moduleNoticeTimer);moduleNoticeTimer=null;
    for(const animation of moduleAnimations.splice(0))animation.cancel();
    moduleTrace?.remove();moduleTrace=null;
    page?.classList.remove('module-noticed');
    root?.querySelectorAll('.module-launch-source').forEach(button=>button.classList.remove('module-launch-source'));
  }
  function revealModuleWindow(replay=false){
    if(mode!=='task'||page.hidden||!['products','customers'].includes(page.dataset.module))return;
    clearModuleNotice();
    const module=page.dataset.module;
    const source=moduleLaunch?.module===module?moduleLaunch:null;
    const element=source?.element||root.querySelector('.nav-item[data-module="'+module+'"]');
    const r=source?.rect||element?.getBoundingClientRect();
    moduleLaunch=null;moduleOpener={module,element};
    element?.classList.add('module-launch-source');page.classList.add('module-noticed');
    page.focus({preventScroll:true});
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
      if(r&&r.width>0&&r.height>0){
        const target=page.getBoundingClientRect(),trace=document.createElement('div');
        trace.className='module-launch-trace';trace.setAttribute('aria-hidden','true');
        Object.assign(trace.style,{left:target.left+'px',top:target.top+'px',width:target.width+'px',height:target.height+'px'});
        document.body.appendChild(trace);moduleTrace=trace;
        // Animate only compositor properties; window geometry never changes.
        const from=`translate(${r.left-target.left}px,${r.top-target.top}px) scale(${r.width/target.width},${r.height/target.height})`;
        const animation=trace.animate([
          {transform:from,opacity:.7},
          {transform:'translate(0px,0px) scale(1,1)',opacity:0}
        ],{duration:440,easing:'cubic-bezier(.22,1,.36,1)'});
        moduleAnimations.push(animation);animation.onfinish=()=>{trace.remove();if(moduleTrace===trace)moduleTrace=null;};
      }
      if(!replay)moduleAnimations.push(page.animate([{opacity:.8},{opacity:1}],{duration:300,easing:'cubic-bezier(.22,1,.36,1)'}));
    }
    moduleNoticeTimer=setTimeout(clearModuleNotice,1000);
    syncModuleButtons();
  }
  function maximizeModule(){
    if(page.hidden)return;
    clearModuleNotice();
    if(!moduleWindow.maximized){moduleWindow.restore={...moduleWindow.rect};moduleWindow.maximized=true;const b=moduleBounds();setModuleRect({left:b.left,top:b.top,width:b.right-b.left,height:b.bottom-b.top});}
    else{moduleWindow.maximized=false;setModuleRect(moduleWindow.restore||moduleWindow.rect);}
    page.classList.toggle('module-maximized',moduleWindow.maximized);const button=page.querySelector('[data-window-action=maximize]');button.title=moduleWindow.maximized?'还原任务窗口':'最大化任务窗口';button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(moduleWindow.maximized));
  }
  function viewportChanged(){clearModuleNotice();scheduleMetrics();scheduleSelectionPosition();scene?.repaint?.();if(!page||page.hidden)return;if(moduleWindow.maximized){const b=moduleBounds();setModuleRect({left:b.left,top:b.top,width:b.right-b.left,height:b.bottom-b.top});}else if(moduleWindow.rect)setModuleRect(moduleWindow.rect);}
  function dragStart(event){if(event.button!==0||event.target.closest('button')||moduleWindow.maximized)return;clearModuleNotice();const r=page.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:r.left,top:r.top,width:r.width,height:r.height};event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();}
  function dragMove(event){if(drag&&drag.id===event.pointerId)setModuleRect({...drag,left:drag.left+event.clientX-drag.x,top:drag.top+event.clientY-drag.y});}
  function dragEnd(){drag=null;}
  function loadScript(src){if(!scriptLoads.has(src))scriptLoads.set(src,new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>{scriptLoads.delete(src);s.remove();reject(new Error('Asset load failed: '+src));};document.head.appendChild(s);}));return scriptLoads.get(src);}
  function sceneMessage(message,enable){const el=root.querySelector('#scene-loading');el.hidden=false;el.classList.add('is-fallback');el.innerHTML=e(message)+(enable?'<button data-action="toggle-scene">开启 3D 场景</button>':'');if(scene)scene.setFallback(true);}
  function hideSceneMessage(){const el=root.querySelector('#scene-loading');if(el.classList.contains('is-fallback')){el.hidden=true;el.classList.remove('is-fallback');el.innerHTML='';}if(scene)scene.setFallback(false);}
  function syncControls(){
    root.querySelectorAll('[data-action=motion]').forEach(b=>b.setAttribute('aria-pressed',String(!prefs.motion)));root.querySelectorAll('[data-action=lighting]').forEach(b=>b.setAttribute('aria-pressed',String(prefs.night)));
    const reset=root.querySelector('[data-action=reset-view]');reset.title=mode==='orders'?'重置场景视角':'返回送货单';reset.setAttribute('aria-label',reset.title);
  }
  function updateScene(){
    if(!root)return;syncControls();
    const inactive=mode!=='orders'||document.hidden||window.__dnsWindowActive===false;
    root.classList.toggle('scene-paused',!prefs.scene||inactive||!prefs.motion||matchMedia('(prefers-reduced-motion: reduce)').matches);
    root.querySelector('#warehouse').style.visibility=prefs.scene?'visible':'hidden';root.querySelector('#scene-markers').hidden=!prefs.scene||mode==='task'||mode==='reader'||mode==='detail';
    if(!prefs.scene){scene?.pause();sceneMessage('3D 场景已关闭，固定分区和业务操作仍可使用。',true);return;}
    if(scene){hideSceneMessage();scene.setMotion(prefs.motion);scene.setNight(prefs.night);if(inactive)scene.pause();else scene.resume();return;}
    if(inactive||sceneLoading)return;sceneLoading=true;const token=generation;
    (async()=>{
      if(!window.THREE)await loadScript(new URL('vendor/three.min.js',location.href).href);
      if(!window.createDNSWorkspaceScene)await loadScript(assets+'warehouse-scene.js');
      if(!started||token!==generation)return;
      if(!prefs.scene||mode!=='orders'||document.hidden||window.__dnsWindowActive===false){sceneLoading=false;return;}
      scene=window.createDNSWorkspaceScene({onSelect:openSceneModule,pixelRatioCap:1.25,shadowSize:1024,maxFPS:30,motion:prefs.motion,fixedPanels:true});
      scene.setImmersive(true);updateSceneData();sceneLoading=false;updateScene();
    })().catch(err=>{scene=null;if(started&&token===generation){sceneLoading=false;sceneMessage('3D 场景暂不可用，固定分区和业务操作仍可正常使用。',false);}console.error('[3D] 场景初始化失败：',err);});
  }
  function setSceneEnabled(value){prefs.scene=!!value;savePrefs();updateScene();}
  function search(value){
    const host=root.querySelector('#search-results'),keyword=value.trim().toLowerCase();if(!keyword){host.hidden=true;return;}readStore();
    const matches=[...data.orders.filter(o=>[o.no,o.customer?.name].join(' ').toLowerCase().includes(keyword)).slice(0,4).map(o=>({icon:'file',title:o.no,sub:(o.customer?.name||'散客')+' · ¥'+amount(o.total),attribute:'data-search-order',id:o.id,type:'送货单'})),...data.customers.filter(c=>[c.name,c.phone,c.address].join(' ').toLowerCase().includes(keyword)).slice(0,3).map(c=>({icon:'people',title:c.name,sub:c.address||c.phone||'',attribute:'data-search-customer',id:c.id,type:'客户'})),...data.products.filter(p=>[p.name,p.spec,p.barcode].join(' ').toLowerCase().includes(keyword)).slice(0,3).map(p=>({icon:'box',title:p.name,sub:p.spec||'',attribute:'data-search-product',id:p.id,type:'商品'}))];
    host.innerHTML=matches.length?matches.map(m=>`<button class="search-result" ${m.attribute}="${e(m.id)}">${icon(m.icon)}<span><b>${e(m.title)}</b><small>${e(m.sub)}</small></span><span class="search-type">${m.type}</span></button>`).join(''):'<p class="empty-note">没有找到相关资料</p>';host.hidden=false;
  }
  function clicked(event){
    const button=event.target.closest('button,[data-route],[data-module]');if(!button||!root.contains(button))return;
    const v=button.dataset;
    if(v.route){go(v.route);return;}
    if(v.searchOrder){root.querySelector('#search-results').hidden=true;go('#/order/view?id='+encodeURIComponent(v.searchOrder));return;}
    if(v.searchCustomer){root.querySelector('#search-results').hidden=true;go('#/customers?edit='+encodeURIComponent(v.searchCustomer));return;}
    if(v.searchProduct){root.querySelector('#search-results').hidden=true;go('#/products?edit='+encodeURIComponent(v.searchProduct));return;}
    if(v.orderId){if(state.selectionOpen&&state.selectedId===v.orderId&&['orders','stats'].includes(mode))closeSelection(true);else selectOrder(v.orderId);return;}
    if(v.customerId){go('#/customers?edit='+encodeURIComponent(v.customerId));return;}
    if(v.module){go('#/'+v.module);return;}
    const action=v.action;
    if(action==='selection-close'){closeSelection(true);return;}
    if(action==='clear-search'){const inp=root.querySelector('#global-search');if(inp){inp.value='';inp.focus();}const cb=root.querySelector('.hs-clear');if(cb)cb.hidden=true;root.querySelector('#search-results').hidden=true;return;}
    if(action==='export-recovery'){downloadBlob('送货单原始数据_'+today()+'.json',new Blob([Store.exportRecoveryJSON()],{type:'application/json'}));return;}
    if(action==='new')go('#/order/new');
    if(action==='statistics-expand')go(mode==='stats'?'#/orders':'#/stats');
    if(action==='selection-expand'){const o=selected();if(o)go('#/order/view?id='+encodeURIComponent(o.id));}
    if(action==='copy-order'){const o=selected();if(o){window.__orderDraft={...o,id:null,customer:o.customer?{...o.customer}:null,items:o.items.map(i=>({...i})),_copy:true};go('#/order/new');}}
    if(action==='reset-view'){if(mode==='orders'){scene?.focus('home');scene?.reshowMarkers?.();setTimeout(()=>scene?.reshowMarkers?.(),180);}else go('#/orders');}
    if(action==='motion'){prefs.motion=!prefs.motion;savePrefs();updateScene();toast(prefs.motion?'场景动画已开启（遵循系统减少动态效果设置）':'场景动画已暂停');}
    if(action==='lighting'){prefs.night=!prefs.night;savePrefs();scene?.setNight(prefs.night);syncControls();}
    if(action==='toggle-scene')setSceneEnabled(!prefs.scene);
  }
  function keydown(event){
    const source=event.target.closest?.('#dispatch-body [data-order-id]');
    if(event.key==='ArrowRight'&&source&&['orders','stats'].includes(mode)){event.preventDefault();selectOrder(source.dataset.orderId);root.querySelector('[data-action=selection-expand]').focus({preventScroll:true});return;}
    if(event.key==='Escape'){
      if(!root.querySelector('#search-results').hidden){root.querySelector('#search-results').hidden=true;return;}
      if(document.activeElement&&document.activeElement.id==='global-search'){document.activeElement.blur();return;}
      if(document.querySelector('#modal-root .mask'))return;
      if(state.selectionOpen&&['orders','stats'].includes(mode)){event.preventDefault();closeSelection(true);return;}
      event.preventDefault();if(mode==='task'){if(moduleWindow.maximized)maximizeModule();else go(taskReturn);}else if(mode==='reader')go(readerReturn);else if(mode==='detail')go(detailReturn);else if(mode!=='orders')go('#/orders');return;
    }
    if(event.key==='/'&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)&&!document.querySelector('#modal-root .mask')){event.preventDefault();root.querySelector('#global-search').focus();}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='n'){event.preventDefault();go('#/order/new');}
  }
  function printCurrent(){
    if(!ensureExportable())return true; // handled: the native menu must not fall back to printing
    const url=new URL(canonicalRoute(location.hash).replace(/^#/,''),'https://desktop.invalid');
    if(url.pathname==='/print'||url.pathname==='/bill'){window.Android.printPdf(url.pathname==='/bill'?'客户账单':'送货单');return true;}
    if(mode!=='task'&&selected()){go('#/print?id='+encodeURIComponent(selected().id));return true;}
    toast('请先保存并选择一张送货单，或打开客户账单后打印',true);return true;
  }
  function dismissSearch(event){if(!event.target.closest('.header-search'))root.querySelector('#search-results').hidden=true;}
  function beforeUnload(event){if(isDirty()){event.preventDefault();event.returnValue='';}}
  function syncRecoveryNotice(){
    const blocked=Store.recoveryState().blocked;let notice=root.querySelector('#storage-recovery-notice');
    if(blocked&&!notice){notice=document.createElement('section');notice.id='storage-recovery-notice';notice.setAttribute('role','alert');notice.innerHTML='<span>本地数据异常，已启用只读保护。请先导出原始数据，再恢复有效备份。</span><button data-action="export-recovery">导出原始数据</button><button data-route="#/settings">打开设置恢复</button>';root.appendChild(notice);}
    if(notice)notice.hidden=!blocked;
  }
  function start(){
    if(started)return;started=true;originalApp=document.getElementById('app');container=document.getElementById('view-container');
    root=document.createElement('div');root.id='desktop-app';root.innerHTML=window.DNSDesktopMarkup;
    page=document.createElement('section');page.id='desktop-module-window';page.className='desktop-business-page';page.hidden=true;page.tabIndex=-1;page.setAttribute('role','dialog');page.setAttribute('aria-modal','false');page.setAttribute('aria-labelledby','desktop-module-title');
    page.innerHTML='<header class="module-window-header"><div class="module-window-title"><span class="module-icon">'+icon('grid')+'</span><span><strong id="desktop-module-title"></strong></span></div><div class="module-window-controls"><button data-window-action="maximize" title="最大化任务窗口" aria-label="最大化任务窗口" aria-pressed="false">'+icon('expand')+'</button><button data-window-action="close" title="关闭任务，返回原位置" aria-label="关闭任务，返回原位置">'+icon('close')+'</button></div></header><div class="module-window-body" data-desktop-scroll></div>';
    reader=document.createElement('section');reader.id='desktop-reader';reader.className='desktop-reading-page';reader.hidden=true;reader.setAttribute('role','region');reader.setAttribute('aria-labelledby','desktop-reader-title');
    reader.innerHTML='<header class="desktop-reader-header"><strong id="desktop-reader-title"></strong><button data-close-reader>返回原位置 '+icon('arrow')+'</button></header><div class="desktop-reader-body" data-desktop-scroll></div>';
    document.body.classList.add('dns-desktop');document.body.append(root,page,reader);
    root.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();restoreWorkspace();});
    const handle=page.querySelector('.module-window-header');handle.addEventListener('pointerdown',dragStart);handle.addEventListener('pointermove',dragMove);handle.addEventListener('pointerup',dragEnd);handle.addEventListener('pointercancel',dragEnd);handle.addEventListener('dblclick',event=>{if(!event.target.closest('button'))maximizeModule();});
    page.addEventListener('click',event=>{const a=event.target.closest('[data-window-action]')?.dataset.windowAction;if(a==='close')go(taskReturn);if(a==='maximize')maximizeModule();});
    reader.addEventListener('click',event=>{if(event.target.closest('[data-close-reader]'))go(readerReturn);});
    page.addEventListener('input',()=>{if(editableForm())moduleDirty=true;});page.addEventListener('change',()=>{if(editableForm())moduleDirty=true;});
    page.addEventListener('click',()=>{if(currentView?.querySelector('[data-role="name"],[data-s="company"]')!==formAnchor)captureFormBaseline();});
    page.addEventListener('dns-form-committed',()=>{moduleDirty=false;captureFormBaseline();});
    root.addEventListener('input',event=>{if(event.target.id==='global-search'){search(event.target.value);const cb=root.querySelector('.hs-clear');if(cb)cb.hidden=!event.target.value;}});
    document.addEventListener('click',rememberModuleLaunch,true);document.addEventListener('click',clicked);document.addEventListener('click',dismissSearch);document.addEventListener('keydown',keydown);document.addEventListener('pointerdown',dismissSelection);
    root.querySelector('#dispatch-body').addEventListener('scroll',scheduleSelectionPosition,{passive:true});
    window.addEventListener('hashchange',route);window.addEventListener('resize',viewportChanged);window.addEventListener('dns-window-activity',updateScene);document.addEventListener('visibilitychange',updateScene);
    window.addEventListener('beforeunload',beforeUnload);
    oldBackground=window.DNSBackground;originalBack=window.__appBack;
    window.DNSBackground={isEnabled:()=>prefs.scene,setEnabled:setSceneEnabled,refresh,stats:()=>({state:!prefs.scene?'off':mode!=='orders'?'skip':scene?'ready':sceneLoading?'loading':'fallback',fps:scene?.stats().fps||0,tier:'送货单首页',reducedMotion:!!(scene&&!scene.stats().motion),level:0})};
    window.__appBack=()=>{if(state.selectionOpen&&['orders','stats'].includes(mode))closeSelection(true);else if(mode==='task')go(taskReturn);else if(mode==='reader')go(readerReturn);else if(mode==='detail')go(detailReturn);else go('#/orders');return true;};
    route();ready=true;
    moduleResizeObserver=new ResizeObserver(updateModuleGeometry);moduleResizeObserver.observe(page);
    metricResizeObserver=new ResizeObserver(scheduleMetrics);metricResizeObserver.observe(root.querySelector('#dispatch-panel'));metricResizeObserver.observe(root.querySelector('#statistics-panel'));
    unsubscribeStore=Store.subscribe(()=>{if(started){if(!currentView?.__draft&&!editableForm())moduleDirty=false;refresh();}});
    refreshTimer=setInterval(()=>{if(!document.hidden&&snapshotDay!==today())refresh();},60000);
    window.ScanOrders?.start();
  }
  function destroy(){
    window.ScanOrders?.stop();
    if(!started)return;started=false;ready=false;generation++;clearInterval(refreshTimer);cancelAnimationFrame(metricFrame);metricFrame=0;cancelAnimationFrame(selectionFrame);selectionFrame=0;state.selectionOpen=false;
    clearModuleNotice();moduleLaunch=null;moduleOpener=null;
    unsubscribeStore?.();moduleResizeObserver?.disconnect();metricResizeObserver?.disconnect();currentView?.dispose?.();ordersView?.dispose?.();scene?.dispose();
    window.removeEventListener('hashchange',route);window.removeEventListener('resize',viewportChanged);window.removeEventListener('dns-window-activity',updateScene);document.removeEventListener('visibilitychange',updateScene);document.removeEventListener('click',rememberModuleLaunch,true);document.removeEventListener('click',clicked);document.removeEventListener('click',dismissSearch);document.removeEventListener('keydown',keydown);document.removeEventListener('pointerdown',dismissSelection);
    window.removeEventListener('beforeunload',beforeUnload);
    if(originalApp&&container){container.replaceChildren();originalApp.prepend(container);}root?.remove();page?.remove();reader?.remove();document.body.classList.remove('dns-desktop','desktop-business-mode','desktop-reader-mode','is-night');
    window.DNSBackground=oldBackground;window.__appBack=originalBack;scene=null;currentView=null;ordersView=null;ordersRevision=-1;sceneLoading=false;routeKey='';renderedRevision=-1;
  }
  return {start,destroy,refresh,setPanel,selectOrder,printCurrent,navigate:go,restoreWorkspace,setFocused,maximizeModule,sceneEnabled:()=>prefs.scene,setSceneEnabled,get ready(){return ready;},get scene(){return scene;},get state(){return state;},get moduleWindow(){return moduleWindow;},get mode(){return mode;}};
})();
