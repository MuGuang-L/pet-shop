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
 const auth=new Auth([createAccount('buyer','integration-password','buyer','integration-buyer'),createAccount('buyer-b','integration-password','buyer','integration-buyer-b'),createAccount('merchant','integration-password','merchant','integration-merchant')]);
 const server=createServer(store,{auth});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const raw=async(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const login=await raw('/auth/login',{username:'merchant',password:'integration-password'});const cookie=login.headers.get('set-cookie').split(';')[0];
 const nodes={},node=id=>nodes[id]||={innerHTML:'',textContent:'',value:'',checked:false,style:{},open:false,setAttribute(){},showModal(){this.open=true;},close(){this.open=false;},addEventListener(){},querySelector(){return null;},appendChild(){}};
 const merchantStorage=new Map();
 const merchant=vm.createContext({Studio,console,crypto:{randomUUID:require('node:crypto').randomUUID},sessionStorage:{getItem:key=>merchantStorage.get(key)||null,setItem:(key,value)=>merchantStorage.set(key,value),removeItem:key=>merchantStorage.delete(key)},AbortController,setTimeout,clearTimeout,document:{getElementById:node,querySelectorAll:()=>[],createElement:()=>({style:{}})},window:{addEventListener(){}},fetch:(path,options)=>fetch(base+path,{...options,headers:{...options.headers,Cookie:cookie,Origin:'http://127.0.0.1:4173'}})});
 vm.runInContext(source('apps/merchant-web/app.js').replace(/boot\(\);\s*$/,''),merchant);
 vm.runInContext(source('apps/merchant-web/settings.js'),merchant);
 const m=code=>vm.runInContext(code,merchant);
 const storage={},errors=[],calls=[];let dropCreate=false,page;
 const wx={getStorageSync:key=>clone(storage[key]),setStorageSync:(key,value)=>storage[key]=clone(value),removeStorageSync:key=>delete storage[key],showToast(){},showModal(o){if(o.showCancel===false)errors.push(o.content);else o.success?.({confirm:wx.confirm!==false});},stopPullDownRefresh(){},request(o){
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

test('三方联调：下单丢响应后切换买家，恢复原账号只确认原订单且不泄露个人信息',options,async()=>fixture(async f=>{
 const p=f.page;p.setData({deliveryMode:'PICKUP',pickupContact:{name:'账号甲提货人',phone:'13800000000'}});p.detail(event({id:'toy'}));p.buy();f.drop();p.checkout();await idle(p);
 const state=await f.store.snapshot(),original=state.orders[0],scopeA=f.api.checkoutScope();assert.equal(state.orders.length,1);assert.ok(f.storage[scopeA]);
 p.setData({selectedOrder:{...original},orders:[{...original}],addressForm:{name:'账号甲地址草稿'},addressEditing:true,afterForm:{reason:'账号甲售后草稿'},loginForm:{username:'buyer-b',password:'integration-password'}});p.login();await idle(p);
 assert.notEqual(f.api.checkoutScope(),scopeA);assert.ok(f.storage[scopeA]);assert.equal(p.data.selectedOrder,null);assert.equal(p.data.orders.length,0);assert.equal(p.data.addressEditing,false);assert.equal(Object.keys(p.data.addressForm).length,0);assert.equal(Object.keys(p.data.afterForm).length,0);assert.equal(p.data.pickupContact.name,'');assert.equal(p.data.pickupContact.phone,'');assert.equal(f.calls.filter(c=>c.action==='createOrder').length,1);
 await assert.rejects(f.api.call('order',{id:original.id}),e=>e.code==='FORBIDDEN');assert.equal((await f.api.call('ordersPage')).total,0);
 p.logout();await idle(p);assert.equal(f.api.hasSession(),false);assert.equal(p.data.loginRequired,true);assert.ok(f.storage[scopeA]);
 p.setData({loginForm:{username:'buyer',password:'integration-password'}});p.login();await idle(p);assert.equal(p.data.selectedOrder.id,original.id);assert.equal(f.storage[scopeA],null);
 const creates=f.calls.filter(c=>c.action==='createOrder');assert.equal(creates.length,2);assert.equal(creates[0].input.key,creates[1].input.key);const after=await f.store.snapshot();assert.equal(after.orders.length,1);assert.equal(after.products.find(x=>x.id==='toy').skus[0].stock,29);assert.equal(after.orders[0].address.name,'账号甲提货人');
}));

test('三方联调：地址编辑和删除不改历史订单，取消删除不请求服务，已删地址不能再下单',options,async()=>fixture(async f=>{
 const p=f.page;p.newAddress();p.setData({'addressForm.name':'模拟地址验收','addressForm.phone':'13800000000','addressForm.detail':'模拟收货地址 1 号'});p.saveAddress();await idle(p);const address=p.data.addresses[0];assert.ok(address);
 const original=await f.api.call('createOrder',{key:'address-lifecycle-order',fulfillment:'DELIVERY',addressId:address.id,lines:[{productId:'toy',skuId:'toy-1',qty:1}]});
 p.editAddress(event({i:0}));p.setData({'addressForm.detail':'模拟收货地址 2 号'});p.saveAddress();await idle(p);assert.equal(p.data.addresses[0].detail,'模拟收货地址 2 号');assert.equal((await f.api.call('order',{id:original.id})).address.detail,'模拟收货地址 1 号');
 f.wx.confirm=false;const before=f.calls.length;p.deleteAddress(event({id:address.id}));await idle(p);assert.equal(f.calls.length,before);assert.equal((await f.api.call('addresses')).length,1);
 f.wx.confirm=true;p.deleteAddress(event({id:address.id}));await idle(p);assert.equal(p.data.addresses.length,0);assert.equal(p.data.selectedAddress,null);assert.equal((await f.api.call('addresses')).length,0);
 assert.equal((await f.api.call('order',{id:original.id})).address.detail,'模拟收货地址 1 号');await assert.rejects(f.api.call('createOrder',{key:'deleted-address-order',fulfillment:'DELIVERY',addressId:address.id,lines:[{productId:'toy',skuId:'toy-1',qty:1}]}),e=>e.code==='ADDRESS_REQUIRED');
 const after=await f.store.snapshot();assert.equal(after.orders.length,1);assert.equal(after.products.find(x=>x.id==='toy').skus[0].stock,29);assert.deepEqual(f.errors,[]);
}));
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
 f.page.onHide();await f.m(`viewOrder(${JSON.stringify(id)})`);f.node('number').value='LOCAL-DELIVERY-01';f.node('delivery-note').value='模拟店员配送';await f.m('ship()');
 f.page.onShow();await idle(f.page);assert.equal(f.page.data.selectedOrder.shipping.number,'LOCAL-DELIVERY-01');assert.equal(f.page.data.selectedOrder.status,'SHIPPED');assert.equal(f.page.data.orders.find(o=>o.id===id).status,'SHIPPED');
 f.page.action(event({action:'confirmReceipt'}));await idle(f.page);assert.equal(f.page.data.selectedOrder.status,'COMPLETED');
 f.page.setData({afterForm:{type:'RETURN_REFUND',reason:'隔离测试退货'}});f.page.action(event({action:'refundRequest'}));await idle(f.page);
 await f.m(`viewOrder(${JSON.stringify(id)})`);f.node('after-review-note').value='同意模拟退货';f.node('return-name').value='测试收件人';f.node('return-phone').value='13800000000';f.node('return-address').value='隔离联调退货处 2 号';await f.m('reviewAftersale(true)');
 f.page.refreshOrder();await idle(f.page);assert.equal(f.page.data.selectedOrder.refund.stage,'WAIT_RETURN');
 f.page.setData({'afterForm.company':'模拟退回','afterForm.number':'RETURN-LOCAL-01'});f.page.action(event({action:'returnShip'}));await idle(f.page);
 await f.m(`viewOrder(${JSON.stringify(id)})`);f.node('received-0').value='1';f.node('restock-0').value='1';f.node('inspection-note').value='模拟验收可售';f.node('inspection-confirm').checked=true;await f.m('inspectReturn()');await f.m("orderAction('mockRefund')");
 f.page.onPullDownRefresh();await idle(f.page);assert.equal(f.page.data.selectedOrder.status,'REFUNDED');assert.equal(f.page.data.orders.find(o=>o.id===id).status,'REFUNDED');
 const snapshot=await f.store.snapshot();assert.equal(snapshot.products.find(p=>p.id===product.id).skus[0].stock,5);assert.equal(snapshot.stockMovements.filter(r=>r.type==='RETURN_INSPECTION').length,1);assert.equal(snapshot.orders.length,1);assert.deepEqual(f.errors,[]);
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

test('三方联调：商家登记入库 → 小程序读取新库存 → 下单取消 → 流水与数据库一致',options,async()=>fixture(async f=>{
 const identity=await f.m("api('identity')");assert.ok(identity.capabilities.includes('inventory-v1'));
 const input={productId:'food',skuId:'food-1',revision:0,type:'RECEIVE',quantity:5,reason:'联调采购到货',requestKey:'fullstack-inventory'};
 const movement=await f.m(`api('adjustStock',${JSON.stringify(input)})`);
 assert.equal(movement.after,25);assert.equal((await f.api.call('catalog'))[0].skus[0].stock,25);
 const o=await f.api.call('createOrder',{key:'fullstack-inventory-order',fulfillment:'PICKUP',contact:{name:'验收',phone:'13800000000'},lines:[{productId:'food',skuId:'food-1',qty:2}]});
 assert.equal((await f.api.call('catalog'))[0].skus[0].stock,23);
 await f.api.call('cancel',{id:o.id});assert.equal((await f.api.call('catalog'))[0].skus[0].stock,25);
 assert.equal((await f.m(`api('adjustStock',${JSON.stringify(input)})`)).id,movement.id);
 const history=await f.m("api('stockHistory',{productId:'food'})");assert.equal(history.total,1);assert.equal(history.items[0].delta,5);
 await assert.rejects(f.api.call('adjustStock',input));await assert.rejects(f.api.call('stockHistory',{}));
 const state=await f.store.snapshot();assert.equal(state.products[0].skus[0].stock,25);assert.equal(state.stockMovements.length,1);assert.equal(state.orders[0].status,'CANCELLED');
}));

async function issueOrder(f,fulfillment='PICKUP'){
 const address=await f.api.call('saveAddress',{name:'履约联调',phone:'13800000000',detail:'模拟省模拟市联调路 1 号'});
 const o=await f.api.call('createOrder',{key:'fullstack-issue-order',fulfillment,contact:address,addressId:address.id,lines:[{productId:'food',skuId:'food-1',qty:3}]});await f.api.call('mockPay',{id:o.id});await f.m('boot()');await f.m(`viewOrder('${o.id}')`);return o;
}
async function buyerIssue(f,id){f.page.showOrder(event({id}));await idle(f.page);return f.page.data.selectedOrder;}
function fillStock(f,prefix,received,restock){f.node(prefix+'-received-0').value=String(received);f.node(prefix+'-restock-0').value=String(restock);f.node(prefix+'-confirm').checked=true;}

test('三方联调：缺货登记 → 买家查看原因 → 商家实际数量退款 → 库存只回补可售数',options,async()=>fixture(async f=>{
 const o=await issueOrder(f);f.node('issue-type').value='OUT_OF_STOCK';f.node('issue-note').value='盘点缺货，已联系买家取消';await f.m("submitFulfillment('recordFulfillmentIssue')");
 let buyer=await buyerIssue(f,o.id);assert.equal(buyer.statusText,'缺货待处理');assert.match(buyer.nextStep,/盘点缺货/);assert.equal(buyer.issueInfo.timeline.length,1);assert.match(f.node('app').innerHTML,/履约问题/);
 f.node('issue-refund-note').value='缺一件、破损一件，可售一件，整单退款';fillStock(f,'issue-stock',2,1);await f.m("submitFulfillment('merchantRefund')");buyer=await buyerIssue(f,o.id);assert.equal(buyer.status,'REFUNDING');assert.equal(buyer.refund.merchantInitiated,true);
 await f.m("orderAction('mockRefund')");buyer=await buyerIssue(f,o.id);assert.equal(buyer.status,'REFUNDED');assert.equal(buyer.issueInfo.status,'RESOLVED');assert.equal((await f.api.call('catalog'))[0].skus[0].stock,18);
 assert.equal((await f.store.snapshot()).stockMovements.length,1);assert.deepEqual(f.errors,[]);
}));

test('三方联调：自提改期后恢复核销、外送失败后再次送出并收货',options,async()=>{
 await fixture(async f=>{
  const o=await issueOrder(f);await f.m("orderAction('pickupReady')");f.node('issue-type').value='PICKUP_DELAY';f.node('issue-note').value='买家暂时无法到店，协商改期';await f.m("submitFulfillment('recordFulfillmentIssue')");
  f.node('issue-resolution').value='RESCHEDULE';f.node('issue-next-at').value=new Date(Date.now()+86400000).toISOString().slice(0,16);f.node('issue-note').value='改为次日到店';await f.m("submitFulfillment('resolveFulfillmentIssue')");
  let buyer=await buyerIssue(f,o.id);assert.match(buyer.nextStep,/约定处理时间/);assert.equal(buyer.issueInfo.status,'OPEN');assert.ok(buyer.issueInfo.nextText);
  f.node('issue-resolution').value='RESUME';f.node('issue-note').value='买家已到店，核对后提货';await f.m("submitFulfillment('resolveFulfillmentIssue')");const code=(await f.api.call('order',{id:o.id})).fulfillment.code;
  await f.m(`orderAction('pickupRedeem',{code:'${code}'})`);assert.equal((await buyerIssue(f,o.id)).status,'COMPLETED');
 });
 await fixture(async f=>{
  const o=await issueOrder(f,'DELIVERY');await f.m("orderAction('ship',{number:'SEND001',note:'第一次送出'})");f.node('issue-type').value='DELIVERY_FAILED';f.node('issue-note').value='送达时无人接收，商品已带回';await f.m("submitFulfillment('recordFulfillmentIssue')");assert.equal((await buyerIssue(f,o.id)).statusText,'外送未送达');
  f.node('issue-resolution').value='REDELIVER';f.node('issue-number').value='SEND002';f.node('issue-note').value='已联系买家并再次送出';await f.m("submitFulfillment('resolveFulfillmentIssue')");
  const buyer=await buyerIssue(f,o.id);assert.equal(buyer.shipping.number,'SEND002');assert.equal(buyer.fulfillment.deliveryHistory[0].number,'SEND001');f.page.action(event({action:'confirmReceipt'}));await idle(f.page);assert.equal(f.page.data.selectedOrder.status,'COMPLETED');assert.deepEqual(f.errors,[]);
 });
});

test('三方联调：履约登记响应丢失后重新打开订单，用原请求核对且不重复登记',options,async()=>fixture(async f=>{
 const o=await issueOrder(f);f.m("const fulfillmentFetch=fetch;let dropIssue=true;fetch=async(path,options)=>{const result=await fulfillmentFetch(path,options);if(dropIssue&&JSON.parse(options.body).action==='recordFulfillmentIssue'){dropIssue=false;throw Error('lost response');}return result;}");
 f.node('issue-type').value='OUT_OF_STOCK';f.node('issue-note').value='库存实物不一致';await f.m("submitFulfillment('recordFulfillmentIssue')");assert.equal(f.node('issue-fields').disabled,true);
 await f.m(`viewOrder('${o.id}')`);assert.match(f.node('modal').innerHTML,/上次处理待确认/);await f.m('submitFulfillment()');
 assert.equal((await f.store.snapshot()).orders[0].fulfillment.issue.timeline.length,1);assert.equal(f.m(`readIssuePending('${o.id}')`),null);assert.equal((await buyerIssue(f,o.id)).issueInfo.timeline.length,1);
}));

test('三方联调：买家先申请缺货退款，商家审核也必须核对实际库存数量',options,async()=>fixture(async f=>{
 const o=await issueOrder(f);f.node('issue-type').value='OUT_OF_STOCK';f.node('issue-note').value='有商品缺失，联系买家退款';await f.m("submitFulfillment('recordFulfillmentIssue')");
 await buyerIssue(f,o.id);f.page.setData({afterForm:{type:'REFUND_ONLY',reason:'缺货无法发出，申请退款'}});f.page.action(event({action:'refundRequest'}));await idle(f.page);assert.equal(f.page.data.selectedOrder.status,'REFUND_REQUESTED');
 await f.m(`viewOrder('${o.id}')`);assert.match(f.node('modal').innerHTML,/review-stock-received-0/);f.node('after-review-note').value='两件缺失，一件可售';fillStock(f,'review-stock',1,1);await f.m('reviewAftersale(true)');await f.m("orderAction('mockRefund')");
 assert.equal((await buyerIssue(f,o.id)).status,'REFUNDED');assert.equal((await f.api.call('catalog'))[0].skus[0].stock,18);assert.equal((await f.store.snapshot()).stockMovements.length,1);assert.deepEqual(f.errors,[]);
}));

test('三方联调：履约写入成功后详情刷新失败，明确已保存且不生成第二个请求',options,async()=>fixture(async f=>{
 const o=await issueOrder(f);f.m("const committedFetch=fetch;let issueCommitted=false,failedReads=0;fetch=async(path,options)=>{const action=JSON.parse(options.body).action;if(issueCommitted&&action==='order'&&failedReads<2){failedReads++;throw Error('read unavailable');}const result=await committedFetch(path,options);if(action==='recordFulfillmentIssue')issueCommitted=true;return result;}");
 f.node('issue-type').value='OUT_OF_STOCK';f.node('issue-note').value='缺货等待处理';await f.m("submitFulfillment('recordFulfillmentIssue')");assert.match(f.node('error').textContent,/已保存，但刷新失败/);assert.equal(f.m(`readIssuePending('${o.id}')`),null);assert.equal(f.node('issue-retry').hidden,true);
 await f.m(`viewOrder('${o.id}')`);assert.equal((await f.store.snapshot()).orders[0].fulfillment.issue.timeline.length,1);
}));
