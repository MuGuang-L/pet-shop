'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {MongoStore}=require('../server/mongo-store'),{createServer}=require('../server/http'),{Auth,createAccount}=require('../server/auth');
const Studio=require('../cloudfunctions/shop/studio');
const source=name=>fs.readFileSync(require.resolve('../'+name),'utf8');
const event=dataset=>({currentTarget:{dataset}});
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
async function idle(page){for(let i=0;i<500&&page.data.busy;i++)await new Promise(r=>setTimeout(r,10));assert.equal(page.data.busy,false,'buyer operation did not finish');}

// Run the actual client controllers and transport against HTTP + an isolated MongoDB.
// wx/DOM bindings are test adapters; this does not replace WeChat rendering verification.
async function fixture(run){
 const database='pet_shop_test_fullstack_'+Date.now()+'_'+Math.random().toString(36).slice(2);
 const store=await MongoStore.connect({database});
 const auth=new Auth([createAccount('buyer','integration-password','buyer','integration-buyer'),createAccount('merchant','integration-password','merchant','integration-merchant')]);
 const server=createServer(store,{auth});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const raw=async(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const login=await raw('/auth/login',{username:'merchant',password:'integration-password'});const cookie=login.headers.get('set-cookie').split(';')[0];
 const nodes={},node=id=>nodes[id]||={innerHTML:'',textContent:'',value:'',checked:false,style:{},open:false,setAttribute(){},showModal(){this.open=true;},close(){this.open=false;},addEventListener(){},querySelector(){return null;},appendChild(){}};
 const merchant=vm.createContext({Studio,console,AbortController,setTimeout,clearTimeout,document:{getElementById:node,querySelectorAll:()=>[],createElement:()=>({style:{}})},window:{addEventListener(){}},fetch:(path,options)=>fetch(base+path,{...options,headers:{...options.headers,Cookie:cookie,Origin:'http://127.0.0.1:4173'}})});
 vm.runInContext(source('apps/merchant-web/app.js').replace(/boot\(\);\s*$/,''),merchant);
 vm.runInContext(source('apps/merchant-web/settings.js'),merchant);
 const m=code=>vm.runInContext(code,merchant);
 const storage={},errors=[],calls=[];let dropCreate=false,page;
 const wx={getStorageSync:key=>clone(storage[key]),setStorageSync:(key,value)=>storage[key]=clone(value),removeStorageSync:key=>delete storage[key],showToast(){},showModal(o){if(o.showCancel===false)errors.push(o.content);else o.success?.({confirm:true});},stopPullDownRefresh(){},request(o){
  calls.push(clone(o.data));raw(new URL(o.url).pathname,o.data,o.header).then(async r=>{const data=await r.json();if(dropCreate&&o.data.action==='createOrder'&&data.ok){dropCreate=false;o.fail({errMsg:'lost response'});return;}o.success({statusCode:r.status,data});}).catch(()=>o.fail({errMsg:'network error'}));
 }};
 const apiContext={wx,module:{exports:{}},require:()=>({apiBase:'http://127.0.0.1:4173'}),setTimeout};vm.runInNewContext(source('miniprogram/services/api'),apiContext);const api=apiContext.module.exports;
 const helper={wx,module:{exports:{}}};vm.runInNewContext(source('miniprogram/services/checkout'),helper);
 function restart(){vm.runInNewContext(source('miniprogram/pages/shop/index'),{Page:p=>page=p,require:name=>name.includes('studio')?Studio:name.includes('checkout')?helper.module.exports:api,wx,setInterval:()=>1,clearInterval(){}});page.setData=function(values){for(const [key,value] of Object.entries(values)){const parts=key.replace(/\[(\d+)\]/g,'.$1').split('.');let target=this.data;for(const part of parts.slice(0,-1))target=target[part]||=( {} );target[parts.at(-1)]=value;}};return page;}
 restart();
 try{await api.login('buyer','integration-password');await page.refresh();assert.deepEqual(errors,[]);await run({store,api,m,node,storage,errors,calls,wx,get page(){return page;},restart,drop(){dropCreate=true;}});}
 finally{await new Promise(r=>server.close(r));assert.ok(database.startsWith('pet_shop_test_fullstack_'));await store.db.dropDatabase();await store.close();}
}
const options={skip:process.env.PET_MONGO_TEST!=='1'};
test('三方联调：商家模板建品与设置 → 小程序外送付款 → 商家送出 → 收货退货入库退款',options,async()=>fixture(async f=>{
 await f.m("show('products');");f.m("editor(null,'toy')");
 const draft=JSON.parse(f.m('JSON.stringify(editing)'));
 for(const [key,value] of Object.entries({pname:'联调测试绳结',category:draft.category,'pet-scope':'通用','pick-note':'',description:'仅用于隔离联调验收'}))f.node(key).value=value;
 f.node('active').checked=true;f.node('featured').checked=false;
 draft.skus.forEach((sku,i)=>{f.node('sku-name-'+i).value=sku.name;f.node('sku-price-'+i).value='20.00';f.node('sku-stock-'+i).value='5';});
 await f.m('saveProduct({preventDefault(){}})');
 const product=(await f.m("api('merchantProducts')")).find(p=>p.name==='联调测试绳结');assert.ok(product);
 await f.m("api('shopSettings').then(s=>api('saveShopSettings',{...s,store:{...s.store,detail:'隔离联调门店 88 号',phone:'010-12345678'},delivery:{...s.delivery,fee:650},hours:{...s.hours,enforce:false}}))");
 await f.page.refresh();assert.equal(f.page.data.support.phone,'010-12345678');assert.equal(f.page.data.pickupStore.detail,'隔离联调门店 88 号');
 f.page.newAddress();f.page.setData({'addressForm.name':'测试买家','addressForm.phone':'13800000000','addressForm.detail':'隔离联调收货路 1 号'});f.page.saveAddress();await idle(f.page);
 f.page.detail(event({id:product.id}));f.page.buy();assert.equal(f.page.data.checkoutTotal,'26.50');f.page.checkout();await idle(f.page);
 const id=f.page.data.selectedOrder?.id;assert.ok(id);assert.equal(f.page.data.selectedOrder.total,2650);
 f.page.action(event({action:'mockPay'}));await idle(f.page);assert.equal(f.page.data.selectedOrder.status,'PAID');
 await f.m(`viewOrder(${JSON.stringify(id)})`);f.node('number').value='LOCAL-DELIVERY-01';f.node('delivery-note').value='模拟店员配送';await f.m('ship()');
 f.page.refreshOrder();await idle(f.page);assert.equal(f.page.data.selectedOrder.shipping.number,'LOCAL-DELIVERY-01');assert.equal(f.page.data.selectedOrder.status,'SHIPPED');
 f.page.action(event({action:'confirmReceipt'}));await idle(f.page);assert.equal(f.page.data.selectedOrder.status,'COMPLETED');
 f.page.setData({afterForm:{type:'RETURN_REFUND',reason:'隔离测试退货'}});f.page.action(event({action:'refundRequest'}));await idle(f.page);
 await f.m(`viewOrder(${JSON.stringify(id)})`);f.node('after-review-note').value='同意模拟退货';f.node('return-name').value='测试收件人';f.node('return-phone').value='13800000000';f.node('return-address').value='隔离联调退货处 2 号';await f.m('reviewAftersale(true)');
 f.page.refreshOrder();await idle(f.page);assert.equal(f.page.data.selectedOrder.refund.stage,'WAIT_RETURN');
 f.page.setData({'afterForm.company':'模拟退回','afterForm.number':'RETURN-LOCAL-01'});f.page.action(event({action:'returnShip'}));await idle(f.page);
 await f.m(`viewOrder(${JSON.stringify(id)})`);f.node('received-0').value='1';f.node('restock-0').value='1';f.node('inspection-note').value='模拟验收可售';f.node('inspection-confirm').checked=true;await f.m('inspectReturn()');await f.m("orderAction('mockRefund')");
 f.page.refreshOrder();await idle(f.page);assert.equal(f.page.data.selectedOrder.status,'REFUNDED');
 const snapshot=await f.store.snapshot();assert.equal(snapshot.products.find(p=>p.id===product.id).skus[0].stock,5);assert.equal(snapshot.stockMovements.length,1);assert.equal(snapshot.orders.length,1);assert.deepEqual(f.errors,[]);
 await f.m(`api('merchantProducts').then(ps=>api('saveProduct',{...ps.find(p=>p.id===${JSON.stringify(product.id)}),active:false}))`);await f.page.refresh();assert.ok(!f.page.data.products.some(p=>p.id===product.id));
}));

test('三方联调：立即购买丢失响应后重开恢复，不扣原购物车，自提核销与取消释放一致',options,async()=>fixture(async f=>{
 const p=f.page;p.setData({cart:[{productId:'toy',skuId:'toy-1',qty:2}],deliveryMode:'PICKUP',pickupContact:{name:'模拟提货人',phone:'13800000000'}});p.cartTotal();p.detail(event({id:'toy'}));p.buy();f.drop();p.checkout();await idle(p);
 assert.equal((await f.store.snapshot()).orders.length,1);assert.equal(p.data.cart[0].qty,2);
 f.errors.length=0;f.restart().onLoad();await idle(f.page);const o=f.page.data.selectedOrder;assert.ok(o);assert.equal(f.page.data.cart[0].qty,2);
 const creates=f.calls.filter(c=>c.action==='createOrder');assert.equal(creates.length,2);assert.equal(creates[0].input.key,creates[1].input.key);
 f.page.action(event({action:'mockPay'}));await idle(f.page);await f.m(`viewOrder(${JSON.stringify(o.id)})`);await f.m("orderAction('pickupReady')");
 f.page.refreshOrder();await idle(f.page);assert.ok(f.page.data.selectedOrder.fulfillment.readyAt);
 await assert.rejects(f.m("orderAction('pickupRedeem',{code:'bad'})"));assert.equal((await f.api.call('order',{id:o.id})).status,'PAID');
 await f.m(`orderAction('pickupRedeem',{code:${JSON.stringify(o.fulfillment.code)}})`);f.page.refreshOrder();await idle(f.page);assert.equal(f.page.data.selectedOrder.status,'COMPLETED');
 f.page.setData({deliveryMode:'PICKUP',pickupContact:{name:'模拟',phone:'13800000000'}});f.page.prepareCheckout();f.page.checkout();await idle(f.page);const cancelled=f.page.data.selectedOrder.id;assert.notEqual(cancelled,o.id);f.page.action(event({action:'cancel'}));await idle(f.page);
 assert.equal(f.page.data.selectedOrder.status,'CANCELLED');const snapshot=await f.store.snapshot();assert.equal(snapshot.orders.length,2);assert.equal(snapshot.products.find(p=>p.id==='toy').skus[0].stock,29);assert.deepEqual(f.errors,[]);
}));
