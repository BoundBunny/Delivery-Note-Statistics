'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'.shots/fixed-workspace');fs.mkdirSync(OUT,{recursive:true});
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'dns-fixed-')));
app.commandLine.appendSwitch('enable-unsafe-swiftshader');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const pause=ms=>new Promise(r=>setTimeout(r,ms));const results=[],errors=[],requests=[];
app.on('web-contents-created',(_e,w)=>{w.on('console-message',(_e,l,m)=>{if(l>=3)errors.push(m);});});
const timeout=setTimeout(()=>{console.error('FIXED_TIMEOUT');app.exit(1);},120000);
require(path.join(ROOT,'main.js'));
app.whenReady().then(async()=>{
  let win;for(let i=0;i<200;i++){win=BrowserWindow.getAllWindows()[0];if(win)break;await pause(40);}
  const js=code=>win.webContents.executeJavaScript(code,true);
  const wait=async code=>{for(let i=0;i<150;i++){try{if(await js(code))return;}catch(_){}await pause(60);}throw Error('Timeout '+code+' '+errors.join('\n'));};
  const nav=async hash=>{await js('location.hash='+JSON.stringify(hash));await pause(150);};
  const check=async(name,fn)=>{try{await fn();results.push({name,ok:true});console.log('PASS '+name);}catch(error){results.push({name,ok:false,error:error.message});console.error('FAIL '+name+': '+error.message);}};
  const screenshot=async name=>fs.writeFileSync(path.join(OUT,name+'.png'),(await win.webContents.capturePage()).toPNG());
  const mouse=async(selector,hold=150)=>{
    await js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});void 0`);await pause(40);
    const before=await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};})()`);
    const point={x:Math.round(before.left+before.width/2),y:Math.round(before.top+before.height/2)};
    win.webContents.sendInputEvent({type:'mouseMove',...point});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});await pause(hold);
    const down=await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();return {left:r.left,top:r.top,hit:document.elementFromPoint(${point.x},${point.y})?.closest(${JSON.stringify(selector)})===el};})()`);
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await pause(180);return {before,down};
  };
  const frames=async()=>{const n=await js('DNSDesktop.scene.stats().frame');await pause(300);return await js('DNSDesktop.scene.stats().frame')-n;};
  await wait('!!window.DNSDesktop?.scene');win.show();win.setContentSize(1440,900);await pause(200);
  win.webContents.session.webRequest.onBeforeRequest((d,cb)=>{if(/^https?:/.test(d.url))requests.push(d.url);cb({cancel:false});});
  await js(`Store.clearAll();void 0`);await pause(80);await screenshot('empty');
  await js(`(()=>{const c=Store.upsertCustomer({name:'固定分区客户',phone:'12345678',address:'测试地址 18 号'}),p=Store.upsertProduct({name:'测试饮用水',spec:'500ml',unit:'瓶',price:3.33,category:'drink'});const make=(date,total,no)=>Store.addOrder({no,date,customer:c,items:[{pid:p.id,name:p.name,spec:p.spec,unit:'瓶',qty:2,price:total/2,amount:total}],total,note:'请当面核对货品'});const current=make(todayStr(),6.66,'FIXED-TODAY'),old=make(addDays(monthRange(todayStr())[0],-1),1234.56,'FIXED-HISTORY');window.fixture={c,p,current,old};DNSDesktop.refresh();DNSDesktop.selectOrder(old.id);})()`);await pause(100);
  await check('fixed zones visible and historic selection never changes today totals',async()=>{
    assert.equal(await js('document.querySelector("[data-today-count]").textContent'),'1张');assert.equal(await js('document.querySelector("[data-today-amount]").textContent'),'6.66');assert.equal(await js('document.querySelector("[data-month-amount]").textContent'),'6.66');
    assert.ok((await js('document.querySelector("#selection-summary").textContent')).includes('FIXED-HISTORY'));
    assert.equal(await js('document.querySelector(".desktop-business-page").hidden'),true);
    assert.ok(!(await js('document.querySelector("#dispatch-body").textContent')).includes('FIXED-HISTORY'));
  });
  await check('labels support actual held mouse down/up without jumping or missing',async()=>{
    const mappings={products:'#/products',customers:'#/customers',new:'#/order/new',settings:'#/settings'};
    for(const [kind,route] of Object.entries(mappings)){
      await nav('#/home');await pause(120);const r=await mouse('.scene-marker[data-scene-module="'+kind+'"]:not([data-scene-category])');
      assert.ok(Math.abs(r.down.left-r.before.left)<5&&Math.abs(r.down.top-r.before.top)<5,kind+' moved '+JSON.stringify(r));assert.equal(r.down.hit,true,kind+' blocked');
      assert.equal(await js('location.hash'),route,kind+' did not navigate');
    }
  });
  await check('two loading doors no longer open records through native ray picking',async()=>{
    await nav('#/home');await js('DNSDesktop.scene.setMotion(false);void 0');await pause(150);
    for(const x of [4.2,11.2]){
      const point=await js(`DNSDesktop.scene.project(${x},2.3,-1.4)`);
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:Math.round(point.x),y:Math.round(point.y)});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(point.x),y:Math.round(point.y)});await pause(100);
      assert.equal(await js('location.hash'),'#/home');assert.equal(await js('document.querySelector(".desktop-business-page").hidden'),true);
    }
    await js('DNSDesktop.scene.setMotion(true);void 0');
  });
  await check('truck model opens the fixed record collection instead of arbitrary detail',async()=>{
    await nav('#/home');await js('DNSDesktop.scene.setMotion(false);void 0');await pause(100);
    const point=await js('DNSDesktop.scene.project(9,2.7,13.8)');
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:Math.round(point.x),y:Math.round(point.y)});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:Math.round(point.x),y:Math.round(point.y)});await pause(130);
    assert.equal(await js('DNSDesktop.mode'),'orders');assert.equal(await js('document.querySelector(".desktop-business-page").hidden'),true);
    await nav('#/home');await js('DNSDesktop.scene.setMotion(true);void 0');
  });
  await check('summary row selection updates fixed detail without a modal',async()=>{
    await mouse('#dispatch-body [data-order-id]');assert.equal(await js('DNSDesktop.state.selectedId'),await js('fixture.current.id'));assert.equal(await js('DNSDesktop.mode'),'home');
    assert.ok((await js('document.querySelector("#selection-summary").textContent')).includes('FIXED-TODAY'));
    await nav('#/stats');await mouse('#dispatch-body [data-order-id]');assert.equal(await js('DNSDesktop.mode'),'detail');await nav('#/home');
  });
  await check('record collection, selection and filters stay in fixed positions',async()=>{
    await mouse('#desktop-app .nav-item[data-module=orders]');assert.equal(await js('DNSDesktop.mode'),'orders');assert.equal(await js('document.querySelector(".desktop-business-page").hidden'),true);
    const list='#dispatch-collection';await js(`const kw=document.querySelector('${list} [data-role=kw]');kw.value='HISTORY';kw.dispatchEvent(new Event('input',{bubbles:true}));void 0`);await pause(250);
    assert.equal(await js(`document.querySelectorAll('${list} [data-open]').length`),1);await mouse(list+' [data-open]');
    assert.equal(await js('DNSDesktop.mode'),'detail');assert.equal(await js('document.querySelector(".desktop-business-page").hidden'),true);
    assert.equal(await js(`document.querySelector('${list} [data-role=kw]').value`),'HISTORY');
    await js(`document.querySelector('#view-container [data-act=edit]').click();void 0`);await pause(130);assert.equal(await js('DNSDesktop.mode'),'task');
    await mouse('.module-window-controls [data-window-action=close]');assert.equal(await js('DNSDesktop.mode'),'detail');assert.equal(await js(`document.querySelector('${list} [data-role=kw]').value`),'HISTORY');
    await screenshot('fixed-detail');
  });
  await check('statistics expands in its fixed zone; month and bill controls remain functional',async()=>{
    await nav('#/home');await mouse('#desktop-app .nav-item[data-module=stats]');assert.equal(await js('DNSDesktop.mode'),'stats');assert.equal(await js('document.querySelector(".desktop-business-page").hidden'),true);
    assert.equal(await js('!!document.querySelector("#statistics-view #view-container [data-role=trend]")'),true);
    await js(`document.querySelector('#statistics-view [data-role=billYm]').value=todayStr().slice(0,7);document.querySelector('#statistics-view [data-role=billYm]').dispatchEvent(new Event('change',{bubbles:true}));void 0`);
    assert.ok((await js('document.querySelector("#statistics-view [data-role=billList]").textContent')).includes('固定分区客户'));await screenshot('fixed-statistics');
    await js('document.querySelector("#statistics-view [data-bill-go]").scrollIntoView({block:"nearest",behavior:"instant"});window.statsScroll=document.querySelector("#statistics-view").scrollTop;void 0');
    await mouse('#statistics-view [data-bill-go]');assert.equal(await js('DNSDesktop.mode'),'reader');assert.equal(await js('document.querySelector("#desktop-reader").hidden'),false);
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));void 0');await pause(120);assert.equal(await js('DNSDesktop.mode'),'stats');assert.ok(await js('Math.abs(document.querySelector("#statistics-view").scrollTop-window.statsScroll)<3'));
  });
  await check('dirty editor guards leaving; cancel and save preserve business correctness',async()=>{
    await nav('#/home');await nav('#/order/new');
    await js(`document.querySelector('#view-container .view').__draft.items=[{name:'测试饮用水',spec:'500ml',qty:'2',price:'3.33'}];document.querySelector('.module-window-controls [data-window-action=close]').click();void 0`);await pause(80);
    assert.equal(await js('!!document.querySelector("#modal-root .mask")'),true);await js('document.querySelector("#modal-root [data-act=no]").click();void 0');await pause(50);assert.equal(await js('DNSDesktop.mode'),'task');
    await js('document.querySelector("#view-container [data-act=save]").click();void 0');await pause(160);assert.equal(await js('DNSDesktop.mode'),'detail');assert.equal(await js('Store.countAll().orders'),3);assert.equal(await js('Store.getOrder(DNSDesktop.state.selectedId).total'),6.66);
  });
  await check('print preview uses reading surface and returns to the selected detail',async()=>{
    const id=await js('DNSDesktop.state.selectedId');await js('DNSDesktop.printCurrent();void 0');await pause(160);assert.equal(await js('DNSDesktop.mode'),'reader');assert.equal(await js('document.querySelector(".desktop-business-page").hidden'),true);
    const pdf=await win.webContents.printToPDF({printBackground:true});assert.ok(pdf.length>2000);fs.writeFileSync(path.join(OUT,'print-preview.pdf'),pdf);
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));void 0');await pause(120);assert.equal(await js('DNSDesktop.mode'),'detail');assert.equal(await js('DNSDesktop.state.selectedId'),id);
  });
  await check('fixed panes and visible labels fit desktop and minimum-size windows',async()=>{
    await nav('#/home');await pause(2300);
    for(const [w,h] of [[1920,1080],[1440,900],[1024,680]]){
      win.setContentSize(w,h);await pause(250);
      const layout=await js(`(()=>{const ids=['dispatch-panel','statistics-panel','context-panel'];const rects=ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};});return {rects,width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,markers:[...document.querySelectorAll('.scene-marker:not([hidden])')].map(el=>{const r=el.getBoundingClientRect();return {kind:el.dataset.sceneModule,left:r.left,top:r.top,right:r.right,bottom:r.bottom,hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('.scene-marker')===el};})};})()`);
      assert.ok(layout.scroll<=w);for(const r of layout.rects){assert.ok(r.left>=0&&r.right<=w&&r.top>=78&&r.bottom<=h&&r.height>100,JSON.stringify(layout));}
      const [a,b,c]=layout.rects;assert.ok(a.right<b.left&&b.bottom<c.top,JSON.stringify(layout));
      for(const r of layout.markers)assert.equal(r.hit,true,JSON.stringify(layout));await screenshot('home-'+w);
      assert.equal(await js(`(()=>{const b=document.querySelector('#selection-actions .primary-button'),r=b.getBoundingClientRect();return r.bottom<=innerHeight&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button')===b;})()`),true);
    }
  });
  await check('background animation remains stopped for reading, tasks and hidden windows',async()=>{
    win.setContentSize(1440,900);await nav('#/stats');assert.equal(await frames(),0);await nav('#/customers');assert.equal(await frames(),0);await nav('#/home');win.hide();await pause(100);assert.equal(await frames(),0);win.show();
  });
  await check('no remote requests or renderer exceptions',async()=>{assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);});
  fs.writeFileSync(path.join(OUT,'verification.json'),JSON.stringify({results,errors,requests},null,2));clearTimeout(timeout);app.exit(results.every(r=>r.ok)?0:1);
}).catch(e=>{console.error(e);app.exit(1);});
