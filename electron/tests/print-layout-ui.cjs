'use strict';
// Exercise the real desktop preview, image export and A4 printing with isolated data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, '.shots/print-layout');
fs.mkdirSync(OUT, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dns-print-layout-'));
for (const [key, folder] of Object.entries({ DNS_TEST_USER_DATA: 'profile', DNS_TEST_DATA_DIR: 'data', DNS_TEST_BACKUP_DIR: 'backup', DNS_TEST_IMAGE_DIR: 'images', DNS_TEST_SAVE_DIR: 'exports' })) process.env[key] = path.join(temp, folder);
app.setPath('userData', process.env.DNS_TEST_USER_DATA);
app.disableHardwareAcceleration();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [];
const timeout = setTimeout(() => { console.error('PRINT_LAYOUT_TIMEOUT'); app.exit(1); }, 90000);
app.on('web-contents-created', (_event, contents) => contents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); }));
require(path.join(ROOT, 'main.js'));

app.whenReady().then(async () => {
  let win;
  for (let i = 0; i < 200; i++) { win = BrowserWindow.getAllWindows()[0]; if (win) break; await pause(30); }
  assert.ok(win);
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async code => {
    for (let i = 0; i < 200; i++) { try { if (await js(code)) return; } catch (_) {} await pause(30); }
    throw new Error('Timeout: ' + code);
  };
  const nav = async hash => { await js('location.hash=' + JSON.stringify(hash)); await pause(150); };
  await wait('!!window.DNSDesktop?.ready');
  win.setContentSize(1440, 1000);
  win.webContents.setBackgroundThrottling(false);
  await js(`Store.clearAll();DNSDesktop.setSceneEnabled(false);
    Store.setSettings({company:'众润',phone:'13250715760',address:'大源',contact:'张经理'});
    window.layoutFixture={};window.layoutMessages=[];
    const layoutToast=toast;window.toast=(message,...args)=>{layoutMessages.push(message);layoutToast(message,...args);};
    for(const count of [1,3,12,42]) {
      const items=Array.from({length:count},(_,i)=>({name:i===0?'怡宝饮用纯净水':'测试商品'+(i+1),spec:'555ml',unit:'瓶',qty:11,price:2,amount:22}));
      layoutFixture[count]=Store.addOrder({no:'LAYOUT-'+count,date:'2026-11-12',customer:null,items,total:22*count});
    }
    layoutFixture.large=Store.addOrder({no:'LAYOUT-LARGE',date:'2026-11-12',customer:{name:'散客',phone:'00123',address:'客户地址',contact:'李经理'},items:[{name:'大金额商品',unit:'件',qty:999999,price:999999,amount:999998000001}],total:999998000001});
    layoutFixture.sample=Store.addOrder({no:'SD-20261112-008',date:'2026-11-12',operator:'管理员',customer:{name:'城东商行',phone:'13800001234',address:'城东街道88号',contact:'王经理'},items:[
      {name:'怡宝饮用纯净水',spec:'555ml',unit:'瓶',qty:11,price:2,amount:22},
      {name:'红牛维生素饮料',spec:'250ml',unit:'罐',qty:12,price:6,amount:72},
      {name:'农夫山泉饮用水',spec:'380ml',unit:'瓶',qty:24,price:1.5,amount:36},
      {name:'五常大米',spec:'5kg',unit:'袋',qty:2,price:35,amount:70},
      {name:'金龙鱼食用油',spec:'5L',unit:'桶',qty:2,price:65,amount:130}
    ],total:330});
    window.layoutBefore=JSON.stringify(JSON.parse(Store.exportJSON()).data);void 0`);

  for (const count of [1, 3, 12, 42]) {
    const id = await js('layoutFixture[' + count + '].id');
    await nav('#/print?id=' + id);
    const state = await js(`(()=>{
      const doc=document.querySelector('#print-view .doc'),table=doc.querySelector('table');
      const total=doc.querySelector('.d-total'),amount=total.querySelector('.t-num');
      const rect=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}};
      return {customer:doc.querySelector('.d-customer-name')?.textContent || null,metaText:doc.querySelector('.d-meta').textContent,
        date:doc.querySelector('.d-date b').textContent,rows:table.tBodies[0].rows.length,
        company:doc.querySelector('.d-company').textContent,companySize:parseFloat(getComputedStyle(doc.querySelector('.d-company-name')).fontSize),
        amountSize:parseFloat(getComputedStyle(amount).fontSize),amount:amount.textContent,totalInTable:total.parentElement===table,
        table:rect(table),total:rect(total),doc:rect(doc),header:rect(doc.querySelector('.d-header')),
        title:rect(doc.querySelector('.d-title')),companyRect:rect(doc.querySelector('.d-company-name')),
        metaCells:doc.querySelector('.d-meta').children.length,quantity:doc.querySelector('.t-qty').textContent,
        noOverflow:amount.scrollWidth<=amount.clientWidth+1};
    })()`);
    assert.equal(state.customer, null);
    assert.doesNotMatch(state.metaText, /客户名称|客户电话|客户地址/);
    assert.equal(state.date, '2026-11-12');
    assert.equal(state.rows, count);
    for (const value of ['众润', '电话：13250715760', '地址：大源', '联系人：张经理']) assert.ok(state.company.includes(value), value);
    assert.ok(state.companySize >= 20 && state.amountSize >= 20);
    assert.ok(state.table.y - state.doc.y <= 100, 'Header uses too much vertical space');
    assert.ok(Math.abs(state.title.y - state.companyRect.y) < 5, 'Company and title must share a row');
    assert.equal(state.metaCells, 1, 'Unselected customer must have no labels or placeholder cells');
    assert.equal(state.quantity, String(count * 11));
    assert.equal(state.amount, '¥' + (22 * count).toFixed(2));
    assert.equal(state.totalInTable, true);
    assert.ok(Math.abs(state.table.bottom - state.total.bottom) <= 1);
    assert.ok(state.noOverflow);
    const drawn = await js(`(()=>{
      const original=CanvasRenderingContext2D.prototype.fillText,drawn=[];
      CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...args){drawn.push({text:String(text),font:this.font,align:this.textAlign,x,y});return original.call(this,text,x,y,...args)};
      try{window.layoutCanvas=drawDocToCanvas(Store.getOrder(${JSON.stringify(id)}),Store.getSettings());return {drawn,height:layoutCanvas.height,png:layoutCanvas.toDataURL('image/png').split(',')[1]};}
      finally{CanvasRenderingContext2D.prototype.fillText=original;}
    })()`);
    assert.equal(drawn.drawn.some(item => item.text === '散客'), false);
    assert.equal(drawn.drawn.some(item => /^客户(?:名称|电话|地址)：/.test(item.text)), false);
    assert.ok(drawn.drawn.some(item => item.text === '送货日期：2026-11-12'));
    assert.ok(drawn.drawn.some(item => item.text === '众润' && /22px/.test(item.font)));
    assert.ok(drawn.drawn.some(item => item.text === state.amount && /22px/.test(item.font)));
    assert.ok(drawn.drawn.some(item => item.text === '送货经手人：' && item.align === 'left' && item.x > 0));
    assert.ok(drawn.drawn.find(item => item.text === '序号').y <= 120, 'PNG header uses too much vertical space');
    const qtyX = drawn.drawn.find(item => item.text === '11').x;
    const totalY = drawn.drawn.find(item => item.text === '合　计').y;
    assert.equal(drawn.drawn.filter(item => item.text === '11' && item.x === qtyX && item.y < totalY).length, count);
    fs.writeFileSync(path.join(OUT, count + '-items.png'), Buffer.from(drawn.png, 'base64'));
    fs.writeFileSync(path.join(OUT, count + '-items.pdf'), await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }));
    if (count === 1 || count === 3) {
      fs.writeFileSync(path.join(OUT, count + '-items-preview.png'), (await win.webContents.capturePage()).toPNG());
    }
    console.log('PASS ' + count + ' actual item rows, compact header, hidden unselected customer and integrated quantity/amount total (preview/PNG/PDF)');
  }

  await nav('#/print?id=' + await js('layoutFixture.large.id'));
  assert.equal(await js('document.querySelector(".d-meta b").textContent'), '散客');
  assert.equal(await js('document.querySelector(".t-num").textContent'), '¥999,998,000,001.00');
  assert.ok(await js('(()=>{const el=document.querySelector(".t-num");return el.scrollWidth<=el.clientWidth+1})()'));
  fs.writeFileSync(path.join(OUT, 'large-amount.pdf'), await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }));
  const large = await js(`(()=>{const canvas=drawDocToCanvas(Store.getOrder(layoutFixture.large.id),Store.getSettings());return canvas.toDataURL('image/png').split(',')[1]})()`);
  fs.writeFileSync(path.join(OUT, 'large-amount.png'), Buffer.from(large, 'base64'));
  console.log('PASS explicitly selected customer and large total remain complete');

  await nav('#/print?id=' + await js('layoutFixture.sample.id'));
  assert.equal(await js('document.querySelector(".d-meta b").textContent'), '城东商行');
  assert.ok(await js('(()=>{const doc=document.querySelector(".doc");return doc.querySelector("table").getBoundingClientRect().top-doc.getBoundingClientRect().top<125})()'));
  assert.ok((await js('document.querySelector(".d-meta").textContent')).includes('客户地址：城东街道88号'));
  assert.ok((await js('document.querySelector(".d-sign").textContent')).includes('制单人：管理员'));
  assert.equal(await js('document.querySelector(".t-qty").textContent'), '51');
  const sample = await js('drawDocToCanvas(Store.getOrder(layoutFixture.sample.id),Store.getSettings()).toDataURL("image/png").split(",")[1]');
  fs.writeFileSync(path.join(OUT, 'compact-sample.png'), Buffer.from(sample, 'base64'));
  fs.writeFileSync(path.join(OUT, 'compact-sample.pdf'), await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }));
  fs.writeFileSync(path.join(OUT, 'compact-sample-preview.png'), (await win.webContents.capturePage()).toPNG());
  console.log('PASS filled customer fits two rows; operator stays in footer; five-item design sample saved');

  await nav('#/print?id=' + await js('layoutFixture[1].id'));
  await js('document.querySelector("[data-act=save-img]").click();void 0');
  await wait('layoutMessages.includes("图片已保存")');
  assert.ok(fs.existsSync(path.join(process.env.DNS_TEST_SAVE_DIR, '送货单_LAYOUT-1.png')));
  await nav('#/order/view?id=' + await js('layoutFixture[1].id'));
  assert.equal(await js('document.querySelector(".dc-customer .v").textContent'), '');
  assert.equal(await js('JSON.stringify(JSON.parse(Store.exportJSON()).data)'), await js('layoutBefore'));
  await nav('#/order/new');
  assert.ok((await js('document.querySelector("[data-role=csub]").textContent')).includes('不显示客户信息'));
  console.log('PASS real image save, blank customer details and optional-customer hint; stored data unchanged');

  // Company details must remain visible even when only a phone/address is configured.
  await js('Store.setSettings({company:"",contact:""});void 0');
  await nav('#/print?id=' + await js('layoutFixture[1].id'));
  assert.ok((await js('document.querySelector(".d-company").textContent')).includes('13250715760'));
  assert.equal(await js('!!document.querySelector(".d-company-name")'), false);
  await js('Store.setSettings({company:"众润商贸配送服务有限公司（城东分公司）",contact:"配送经理",address:"城东街道88号配送中心二楼仓储物流办公室",phone:"13250715760"});void 0');
  await nav('#/print?id=' + await js('layoutFixture.sample.id'));
  assert.ok(await js('(()=>{const name=document.querySelector(".d-company-name"),no=document.querySelector(".d-no"),title=document.querySelector(".d-title");return name.getBoundingClientRect().right<=title.getBoundingClientRect().left && title.getBoundingClientRect().right<=no.getBoundingClientRect().left})()'));
  const longCompany = await js('drawDocToCanvas(Store.getOrder(layoutFixture.sample.id),Store.getSettings()).toDataURL("image/png").split(",")[1]');
  fs.writeFileSync(path.join(OUT, 'long-company.png'), Buffer.from(longCompany, 'base64'));
  fs.writeFileSync(path.join(OUT, 'long-company.pdf'), await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }));
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS partial and long company information; no renderer errors');
  clearTimeout(timeout);
  console.log('PRINT_LAYOUT_PASS ' + OUT);
  app.exit(0);
}).catch(error => { console.error(error.stack || error); app.exit(1); });
