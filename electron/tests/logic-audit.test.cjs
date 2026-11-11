'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const JS=path.resolve(__dirname,'../webapp/js');
function create(initial={},seeds=[]){
  const values=new Map(Object.entries(initial));
  const context=vm.createContext({localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)},TextDecoder,TextEncoder,Intl,window:{SEED_PRODUCTS:seeds,pinyinPro:{pinyin:v=>v},addEventListener(){}},document:{addEventListener(){}},requestAnimationFrame(){}});
  vm.runInContext(fs.readFileSync(path.join(JS,'util.js'),'utf8'),context);context.toast=()=>{};
  vm.runInContext(fs.readFileSync(path.join(JS,'store.js'),'utf8'),context);
  return {store:vm.runInContext('Store',context),values};
}
const order=(patch={})=>({no:'AUDIT-20261109-001',date:'2026-11-09',customer:null,items:[{name:'Water',spec:'500ml',unit:'瓶',qty:2,price:3,amount:6}],total:6,...patch});
test('startup never merges different barcode identities or rewrites historical references',()=>{
  const products=[{id:'p1',name:'Water',spec:'500ml',unit:'瓶',barcode:'111',price:3},{id:'p2',name:'Water',spec:'500ml',unit:'瓶',barcode:'222',price:8}];
  const saved={id:'o',...order({items:[{pid:'p2',name:'Water',qty:1,price:8,amount:8}],total:8})};
  const {store}=create({sd_v1_seed_products_v3:'1',sd_v1_products:JSON.stringify(products),sd_v1_orders:JSON.stringify([saved]),sd_v1_lastprices:JSON.stringify({'c:p1':3,'c:p2':8})});
  assert.equal(store.listProducts().length,2);assert.equal(store.getOrder('o').items[0].pid,'p2');assert.equal(store.getLastPrice('c','p2'),8);
  const sameBarcode=products.map(p=>({...p,barcode:'111',price:3}));const conflicting=create({sd_v1_seed_products_v3:'1',sd_v1_products:JSON.stringify(sameBarcode),sd_v1_lastprices:JSON.stringify({'c:p1':3,'c:p2':8})});assert.equal(conflicting.store.listProducts().length,2);
});
test('negative or malformed product prices cannot enter the data layer',()=>{
  const {store}=create();
  for(const value of [-1,Infinity,NaN,'bad'])assert.throws(()=>store.upsertProduct({name:'Invalid',price:value}));
  assert.equal(store.listProducts().length,0);
});
test('CSV with invalid prices rejects the entire batch rather than dropping its price',()=>{
  const {store}=create();
  for(const price of ['oops','-2','1e309']){assert.throws(()=>store.importProductsCSV('产品名称,价格\nValid,3\nInvalid,'+price));assert.equal(store.listProducts().length,0);}
});
test('duplicate order numbers cannot be inserted or assigned to another record',()=>{
  const {store}=create();const first=store.addOrder(order());
  assert.throws(()=>store.addOrder(order()));assert.equal(store.countAll().orders,1);
  const second=store.addOrder(order({no:'AUDIT-20261109-002'}));assert.throws(()=>store.updateOrder(second.id,{no:first.no}));assert.equal(store.getOrder(second.id).no,'AUDIT-20261109-002');
  assert.throws(()=>store.addOrder(order({id:first.id,no:'NEW-NUMBER'})));assert.equal(store.countAll().orders,2);
});
test('customer identity filter includes all dates and excludes namesakes',()=>{
  const {store}=create();store.addOrder(order({customer:{id:'c1',name:'Same'},date:'2025-01-01'}));store.addOrder(order({no:'SECOND',customer:{id:'c2',name:'Same'}}));
  const matches=store.listOrders({customerId:'c1'});assert.equal(matches.length,1);assert.equal(matches[0].date,'2025-01-01');
});
test('a complete restore stays complete after restarting with bundled seed products',()=>{
  const seeds=[{name:'Bundled',spec:'500ml',unit:'瓶'}],first=create({},seeds);
  assert.equal(first.store.listProducts().length,1);
  const backup=JSON.stringify({app:'songhuodan',version:1,data:{products:[],customers:[],orders:[]}});
  const second=create();second.store.importJSON(backup);
  const reloaded=create(Object.fromEntries(second.values),seeds);assert.equal(reloaded.store.listProducts().length,0);
});
test('corrupt local data is preserved and writes are blocked until explicit restore',()=>{
  const raw='[{"id":"damaged"',initial={sd_v1_orders:raw};const {store,values}=create(initial,[{name:'Seed'}]);
  assert.equal(values.get('sd_v1_orders'),raw);assert.throws(()=>store.setSettings({company:'Should not overwrite'}));assert.equal(values.get('sd_v1_orders'),raw);
  assert.equal(store.recoveryState().blocked,true);assert.ok(store.exportRecoveryJSON().includes('damaged'));
  store.importJSON(JSON.stringify({app:'songhuodan',version:1,data:{orders:[]}}));assert.equal(store.recoveryState().blocked,false);
});
test('backup total and line amounts must match supported nonnegative order arithmetic',()=>{
  const {store}=create();
  for(const record of [order({total:7}),order({items:[{name:'Bad',qty:1,price:-3,amount:-3}],total:-3}),order({items:[{name:'Bad',qty:2,price:3,amount:9}],total:9})])assert.throws(()=>store.importJSON(JSON.stringify({app:'songhuodan',version:1,data:{orders:[{id:'bad',...record}]}})));
});
test('backup with duplicate order numbers is rejected before overwriting data',()=>{
  const {store}=create();assert.throws(()=>store.importJSON(JSON.stringify({app:'songhuodan',version:1,data:{orders:[{id:'one',...order()},{id:'two',...order()}]}})));assert.equal(store.countAll().orders,0);
});
