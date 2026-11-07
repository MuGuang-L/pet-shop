const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const studio=require('../miniprogram/lib/studio');
const event=dataset=>({currentTarget:{dataset}});
function fixture(deliveryMode='DELIVERY'){let p;const app={globalData:{orderEntry:null}};const calls=[],modals=[],storage={},products=[{id:'p',name:'测试商品',category:'用品',description:'日常用品',image:'/assets/toy-v2.jpg',skus:[{id:'s',name:'标准',price:2000,stock:3}]}],addresses=[{id:'a',name:'测试',phone:'13800000000',detail:'虚构街道 1 号'}];const settings=require('../cloudfunctions/shop/shop-settings').publicSettings(require('../cloudfunctions/shop/domain').seed(),Date.now());const api={mode:'api',hasSession:()=>true,checkoutScope:()=>'buyer-flow-checkout',call:async(action,input)=>{calls.push({action,input});if(action==='quoteOrder'){const subtotal=input.lines.reduce((sum,l)=>sum+products.find(p=>p.id===l.productId).skus.find(k=>k.id===l.skuId).price*l.qty,0),shippingFee=input.fulfillment==='DELIVERY'?800:0;return {subtotal,shippingFee,total:subtotal+shippingFee,fulfillment:input.fulfillment,settingsRevision:settings.revision,pickupStore:settings.pickupStore,delivery:settings.delivery};}return ({shopSettings:settings,catalog:products,addresses,identity:{merchant:false,phone:'13800000000'},storefront:studio.defaults,homeContent:studio.homeDefaults,saveAddress:addresses[0],ordersPage:{items:[],page:1,pages:1,total:0}})[action];}};const wx={getStorageSync:k=>storage[k],setStorageSync:(k,v)=>storage[k]=v,showToast(){},showModal:o=>{modals.push(o.content);o.success?.({confirm:wx.accept!==false});},stopPullDownRefresh(){}};const helper={module:{exports:{}},wx};vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/checkout'),'utf8'),helper);const ctx={getApp:()=>app,Page:d=>p=d,require:n=>n.includes('order-display')?require('../miniprogram/services/order-display'):n.includes('studio')?studio:n.includes('checkout')?helper.module.exports:api,wx,setInterval:()=>1,clearInterval(){}};vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/shop/index'),'utf8'),ctx);p.setData=function(values){for(const [key,value] of Object.entries(values)){const parts=key.replace(/\[(\d+)\]/g,'.$1').split('.');let obj=this.data;for(const k of parts.slice(0,-1))obj=obj[k]||(obj[k]={});obj[parts.at(-1)]=value;}};if(deliveryMode)p.data.deliveryMode=deliveryMode;return {p,api,wx,calls,modals,products,addresses,app};}
async function idle(p){for(let i=0;i<50&&p.data.busy;i++)await new Promise(r=>setImmediate(r));assert.equal(p.data.busy,false);}
const refreshedOrder={id:'refresh-order',status:'SHIPPED',lines:[],subtotal:0,total:800,shippingFee:800,createdAt:1,updatedAt:2,shipping:{number:'SIM-DELIVERY'},fulfillment:{type:'DELIVERY'}};
for(const trigger of ['onShow','onPullDownRefresh','retry'])test('小程序 '+trigger+' 同步当前订单详情和列表，保留未提交售后内容',async()=>{
 const {p,api}=fixture();await p.refresh();p.setData({tab:'orders',selectedOrder:{...refreshedOrder,status:'PAID',shipping:null},orders:[{...refreshedOrder,status:'PAID'}],afterForm:{reason:'未提交的模拟原因'}});const original=api.call;
 api.call=async(action,input)=>action==='order'?refreshedOrder:action==='ordersPage'?{items:[refreshedOrder],page:1,pages:1,total:1}:original(action,input);
 p[trigger]();await idle(p);assert.equal(p.data.selectedOrder.status,'SHIPPED');assert.equal(p.data.selectedOrder.shipping.number,'SIM-DELIVERY');assert.equal(p.data.orders[0].status,'SHIPPED');assert.equal(p.data.afterForm.reason,'未提交的模拟原因');
});
test('订单刷新响应迟到时不重新打开已关闭详情，也不覆盖后来选中的订单',async()=>{
 for(const next of [null,{id:'another-order',status:'PAID'}]){const {p,api}=fixture();p.setData({selectedOrder:{...refreshedOrder,status:'PAID'}});let finish;api.call=async()=>new Promise(resolve=>finish=resolve);p.refreshOrder();assert.equal(typeof finish,'function');p.close();if(next)p.setData({selectedOrder:next});finish(refreshedOrder);await idle(p);assert.equal(p.data.selectedOrder,next);}
});
test('订单后台刷新失败保留旧详情并提示，重新加载后读到最新状态',async()=>{
 const {p,api,modals}=fixture();await p.refresh();p.setData({tab:'orders',selectedOrder:{...refreshedOrder,status:'PAID'}});const original=api.call;let fail=true;
 api.call=async(action,input)=>{if(action==='order'){if(fail)throw Error('模拟订单读取失败');return refreshedOrder;}return original(action,input);};
 p.onShow();await idle(p);assert.equal(p.data.selectedOrder.status,'PAID');assert.equal(modals.at(-1),'模拟订单读取失败');fail=false;p.retry();await idle(p);assert.equal(p.data.selectedOrder.status,'SHIPPED');
});
test('返回前台时付款倒计时已结束，仍同步详情和列表且不重复查单',async()=>{
 const {p,api}=fixture();await p.refresh();const pending={...refreshedOrder,status:'PENDING',expiresAt:1},expired={...pending,status:'EXPIRED'};p.setData({tab:'orders',selectedOrder:pending,orders:[pending]});const original=api.call;let reads=0;
 api.call=async(action,input)=>{if(action==='order'){reads++;return expired;}if(action==='ordersPage')return {items:[expired],page:1,pages:1,total:1};return original(action,input);};
 p.onShow();await idle(p);assert.equal(p.data.selectedOrder.status,'EXPIRED');assert.equal(p.data.orders[0].status,'EXPIRED');assert.equal(reads,1);
});
function privateBuyerState(p){p.setData({tab:'orders',cart:[{productId:'p',skuId:'s',qty:1}],orders:[{id:'private-order'}],selectedOrder:{id:'private-order'},selectedAddress:{id:'private-address'},addressForm:{name:'private-name',phone:'13800000000',detail:'private-address'},addressEditing:true,pickupContact:{name:'private-name',phone:'13800000000'},tracking:{number:'private-number'},afterForm:{reason:'private-reason'},receiptItems:[{name:'private-item'}],quickLines:[{productId:'p',skuId:'s',qty:1}],checkoutLines:[{productId:'p',skuId:'s',qty:1}]});}
function assertNoPrivateBuyerState(p){assert.equal(p.data.selectedOrder,null);assert.equal(p.data.selectedAddress,null);for(const key of ['orders','addresses','cart','quickLines','checkoutLines','receiptItems'])assert.equal(p.data[key].length,0,key);assert.equal(p.data.addressEditing,false);assert.equal(Object.keys(p.data.addressForm).length,0);assert.equal(Object.keys(p.data.afterForm).length,0);assert.equal(p.data.pickupContact.name,'');assert.equal(p.data.pickupContact.phone,'');assert.equal(p.data.tracking,null);assert.equal(p.data.tab,'catalog');assert.equal(p.data.canOrder,false);}
test('退出请求断网也清除页面个人数据并显示登录，保留待确认订单',async()=>{
 const {p,api,wx}=fixture();await p.refresh();privateBuyerState(p);const pending={input:{key:'old-pending'}};wx.setStorageSync('pet-checkout-v1:old-account',pending);api.logout=async()=>{throw Error('测试退出断网');};p.logout();await idle(p);
 assert.equal(p.data.loginRequired,true);assertNoPrivateBuyerState(p);assert.equal(wx.getStorageSync('pet-checkout-v1:old-account'),pending);
});
test('会话失效清除个人状态，另一账号登录后刷新失败不会展示旧订单或草稿',async()=>{
 const {p,api,wx}=fixture();await p.refresh();privateBuyerState(p);await p.run(async()=>{throw Object.assign(Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED'});});assert.equal(p.data.loginRequired,true);assertNoPrivateBuyerState(p);
 api.login=async()=>wx.setStorageSync('pet-cart',[]);api.call=async()=>{throw Error('测试读取断网');};p.login();await idle(p);assert.equal(p.data.loginRequired,false);assertNoPrivateBuyerState(p);
});
test('刷新遇到会话过期也清除当前订单和联系方式',async()=>{
 const {p,api}=fixture();await p.refresh();privateBuyerState(p);api.call=async()=>{throw Object.assign(Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED'});};await p.refresh();assert.equal(p.data.loginRequired,true);assertNoPrivateBuyerState(p);
});
test('地址保存校验失败保留表单和原地址，修正后可再次保存',async()=>{
 const {p,api,modals,addresses}=fixture();await p.refresh();const original=api.call;let saves=0;
 p.setData({tab:'addresses',addressEditing:true,addressReturn:'checkout',addressForm:{...addresses[0],phone:'123'}});
 api.call=async(action,input)=>{if(action==='saveAddress'){saves++;if(input.phone==='123')throw Object.assign(Error('请填写 11 位手机号码'),{code:'ADDRESS_PHONE'});addresses[0]={...input};return {...input};}return original(action,input);};
 p.saveAddress();await idle(p);assert.equal(p.data.addressEditing,true);assert.equal(p.data.addressForm.phone,'123');assert.equal(p.data.tab,'addresses');assert.equal(addresses[0].phone,'13800000000');assert.equal(modals.at(-1),'请填写 11 位手机号码');assert.equal(saves,1);
 p.setData({addressForm:{...p.data.addressForm,phone:'13800000000',detail:'模拟修正地址 2 号'}});p.saveAddress();await idle(p);assert.equal(p.data.tab,'checkout');assert.equal(p.data.addressEditing,false);assert.equal(p.data.selectedAddress.detail,'模拟修正地址 2 号');assert.equal(saves,2);
});

test('新增地址已保存但随后刷新失败，保留新地址选择并待刷新成功后结算',async()=>{
 const f=fixture(),{p,api,addresses,calls}=f,original=api.call;let failAddresses=false,saves=0;
 api.call=async(action,input)=>{
  if(action==='saveAddress'){saves++;const saved={...input,id:'new-saved-address'};addresses.push(saved);failAddresses=true;return {...saved};}
  if(action==='addresses'){if(failAddresses){failAddresses=false;throw Error('测试地址刷新断网');}return addresses.map(a=>({...a}));}
  return original(action,input);
 };
 p.data.cart=[{productId:'p',skuId:'s',qty:1}];await p.refresh();p.prepareCheckout();p.openAddresses();p.newAddress();p.setData({addressForm:{...p.data.addressForm,name:'模拟新地址',phone:'13800000000',detail:'模拟新街道2号'}});p.saveAddress();await idle(p);
 assert.equal(saves,1);assert.equal(p.data.tab,'checkout');assert.equal(p.data.selectedAddress.id,'new-saved-address');assert.equal(p.data.addresses.length,2);assert.equal(p.data.canOrder,false);
 p.checkout();await idle(p);assert.ok(!calls.some(c=>c.action==='createOrder'));
 await p.refresh();assert.equal(p.data.canOrder,true);assert.equal(p.data.selectedAddress.id,'new-saved-address');assert.equal(p.data.addresses.length,2);acceptOrders(f);p.checkout();await idle(p);assert.equal(calls.find(c=>c.action==='createOrder').input.addressId,'new-saved-address');assert.equal(saves,1);
});
test('购物车按最新目录同步名称价格，库存不足阻止提交',async()=>{const {p,calls}=fixture();p.data.cart=[{productId:'p',skuId:'s',name:'旧名称',price:1,qty:4}];await p.refresh();assert.equal(p.data.cart[0].price,2000);assert.match(p.data.cart[0].invalid,/库存不足/);assert.equal(p.data.checkoutTotal,'88.00');p.checkout();await idle(p);assert.ok(!calls.some(c=>c.action==='createOrder'));p.removeCart(event({i:0}));assert.equal(p.data.cartCount,0);assert.equal(p.data.cartInvalid,false);});
test('下架规格保留提示并允许显式移除，切换自提重算合计',async()=>{const {p}=fixture();p.data.cart=[{productId:'p',skuId:'s',price:1,qty:2},{productId:'gone',skuId:'old',price:100,qty:1}];await p.refresh();assert.match(p.data.cart[1].invalid,/下架/);p.removeCart(event({i:1}));assert.equal(p.data.checkoutTotal,'48.00');p.deliveryMode(event({value:'PICKUP'}));assert.equal(p.data.checkoutTotal,'40.00');});
test('从购物车选地址和新增地址后回到结算',async()=>{const {p}=fixture();await p.refresh();p.data.tab='cart';p.openAddresses();assert.equal(p.data.addressReturn,'cart');p.useAddress(event({i:0}));assert.equal(p.data.tab,'cart');p.openAddresses();p.data.addressForm={name:'测试',phone:'13800000000',detail:'虚构街道 1 号'};p.saveAddress();await idle(p);assert.equal(p.data.tab,'cart');assert.equal(p.data.addressIndex,0);});
test('用户取消确认框时不发送取消或收货请求',async()=>{const {p,wx,calls}=fixture();wx.accept=false;p.data.selectedOrder={id:'order'};p.action(event({action:'cancel'}));await idle(p);p.action(event({action:'confirmReceipt'}));await idle(p);assert.ok(!calls.some(c=>['cancel','confirmReceipt'].includes(c.action)));});
test('商品按价格排序并筛除无货，描述也可搜索',async()=>{const {p,products}=fixture();products.push({id:'p2',name:'第二件',description:'关键字',category:'用品',skus:[{id:'s2',name:'小号',price:500,stock:0}]});await p.refresh();p.shopSection(event({value:'pet'}));p.sortProducts({detail:{value:'1'}});assert.equal(p.data.visible[0].id,'p2');p.stockFilter({detail:{value:true}});assert.equal(p.data.visible.length,1);p.stockFilter({detail:{value:false}});p.searchProducts({detail:{value:'关键字'}});assert.equal(p.data.visible[0].id,'p2');});
test('401被识别为重新登录，清除过期会话',async()=>{const storage={'pet-shop-session-v2':{apiBase:'https://shop.example.test',token:'expired'}},wx={getStorageSync:k=>storage[k],removeStorageSync:k=>delete storage[k],request:o=>o.success({statusCode:401,data:{ok:false,error:'unauthorized'}})};const context={wx,module:{exports:{}},require:()=>({apiBase:'https://shop.example.test'})};vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/api'),'utf8'),context);await assert.rejects(context.module.exports.call('catalog'),e=>e.code==='AUTH_REQUIRED');assert.equal(storage['pet-shop-session-v2'],undefined);});
function acceptOrders(f,{failOnce=false}={}){const original=f.api.call;f.api.call=async(action,input)=>{if(action!=='createOrder')return original(action,input);f.calls.push({action,input});if(failOnce){failOnce=false;throw Error('测试网络故障');}const lines=input.lines.map(l=>{const p=f.products.find(p=>p.id===l.productId),sku=p.skus.find(s=>s.id===l.skuId);return {...l,name:p.name,spec:sku.name,price:sku.price};}),subtotal=lines.reduce((n,l)=>n+l.price*l.qty,0),shippingFee=input.fulfillment==='DELIVERY'?800:0;return {id:'test-order',lines,subtotal,shippingFee,total:subtotal+shippingFee,status:'PENDING',address:f.addresses[0],fulfillment:{type:input.fulfillment},createdAt:Date.UTC(2026,9,24,10),updatedAt:Date.UTC(2026,9,24,10),expiresAt:Date.UTC(2026,9,24,10,15)};};}
test('勾选部分商品结算只提交所选，未勾选商品完整保留',async()=>{const f=fixture(),{p,products,calls}=f;products.push({id:'other',name:'另一件',category:'用品',skus:[{id:'other-s',name:'标准',price:1000,stock:5}]});p.data.cart=[{productId:'p',skuId:'s',qty:1},{productId:'other',skuId:'other-s',qty:2,selected:false}];await p.refresh();acceptOrders(f);p.prepareCheckout();assert.equal(p.data.tab,'checkout');assert.equal(p.data.selectedCount,1);p.checkout();await idle(p);assert.equal(calls.find(c=>c.action==='createOrder').input.lines.length,1);assert.equal(p.data.cart.length,1);assert.equal(p.data.cart[0].skuId,'other-s');assert.equal(p.data.cart[0].qty,2);});
test('立即购买同一规格也不累加或清空原购物车',async()=>{const f=fixture(),{p,calls}=f;p.data.cart=[{productId:'p',skuId:'s',qty:2}];await p.refresh();p.detail(event({id:'p'}));p.setData({detailQty:1});p.buy();assert.equal(p.data.checkoutSource,'quick');assert.equal(p.data.cart[0].qty,2);assert.equal(p.data.checkoutLines[0].qty,1);acceptOrders(f);p.checkout();await idle(p);assert.equal(calls.find(c=>c.action==='createOrder').input.lines[0].qty,1);assert.equal(p.data.cart[0].qty,2);});
test('无地址直接进入新增表单，保存后回确认订单并选中新地址',async()=>{const f=fixture(),{p,addresses,calls}=f;addresses.length=0;p.data.cart=[{productId:'p',skuId:'s',qty:1}];await p.refresh();p.prepareCheckout();p.checkout();await idle(p);assert.equal(p.data.tab,'addresses');assert.equal(p.data.addressEditing,true);assert.ok(!calls.some(c=>c.action==='createOrder'));addresses.push({id:'new-address',name:'测试',phone:'13800000000',detail:'虚构街道2号'});p.saveAddress();await idle(p);assert.equal(p.data.tab,'checkout');assert.equal(p.data.selectedAddress.id,'new-address');});
test('全选反选影响金额，未选失效商品不阻止有效商品结算',async()=>{const {p}=fixture();p.data.cart=[{productId:'p',skuId:'s',qty:1},{productId:'gone',skuId:'gone-s',price:100,qty:1,selected:false}];await p.refresh();assert.equal(p.data.cartInvalid,false);assert.equal(p.data.cartTotal,'20.00');p.toggleAll();assert.equal(p.data.allSelected,true);assert.equal(p.data.cartInvalid,true);p.toggleAll();assert.equal(p.data.selectedCount,0);assert.equal(p.data.checkoutTotal,'0.00');p.toggleLine(event({i:0}));assert.equal(p.data.selectedCount,1);assert.equal(p.data.cartInvalid,false);});
test('下单失败保留商品和幂等键，重试成功才清理已提交行',async()=>{const f=fixture(),{p,calls}=f;p.data.cart=[{productId:'p',skuId:'s',qty:1}];await p.refresh();acceptOrders(f,{failOnce:true});p.prepareCheckout();p.checkout();await idle(p);assert.equal(p.data.cart.length,1);const key=p.checkoutKey;assert.ok(key);p.checkout();await idle(p);const submissions=calls.filter(c=>c.action==='createOrder');assert.equal(submissions[0].input.key,submissions[1].input.key);assert.equal(p.data.cart.length,0);assert.equal(p.data.selectedOrder.subtotalText,'20.00');assert.equal(p.data.selectedOrder.shippingText,'8.00');assert.equal(p.data.selectedOrder.totalText,'28.00');assert.match(p.data.selectedOrder.createdText,/2026-10-24/);assert.match(p.data.selectedOrder.expiresText,/:15:00$/);});
test('立即购买退出确认页不改变购物车，订单号可复制',async()=>{const f=fixture(),{p,wx}=f;p.data.cart=[{productId:'p',skuId:'s',qty:2}];await p.refresh();p.setData({tab:'category'});p.detail(event({id:'p'}));p.buy();p.backCheckout();assert.equal(p.data.tab,'category');assert.equal(p.data.cart[0].qty,2);assert.equal(p.data.quickLines.length,0);let copied;wx.setClipboardData=o=>copied=o.data;p.setData({selectedOrder:{id:'copy-id'}});p.copyOrderNumber();assert.equal(copied,'copy-id');});
test('待付款倒计时到期禁用付款并只自动查询一次，不伪造订单状态',()=>{const {p}=fixture();const end=Date.now()+60000;p.setData({tab:'orders',selectedOrder:{id:'pending',status:'PENDING',expiresAt:end},orders:[{id:'pending',status:'PENDING',expiresAt:end}]});let requests=0;p.refreshOrder=()=>requests++;p.tickCountdown(end-60000);assert.equal(p.data.selectedOrder.remainingText,'01:00');assert.equal(p.data.selectedOrder.payExpired,false);p.tickCountdown(end);p.tickCountdown(end+1000);assert.equal(p.data.selectedOrder.payExpired,true);assert.equal(p.data.selectedOrder.status,'PENDING');assert.equal(requests,1);assert.equal(p.data.orders[0].payExpired,true);});
test('忙碌期间不丢弃超时刷新，操作结束后下一次计时补查',()=>{const {p}=fixture();p.data.selectedOrder={id:'expired',status:'PENDING',expiresAt:Date.now()-1};let requests=0;p.refreshOrder=()=>requests++;p.data.busy=true;p.tickCountdown();assert.equal(requests,0);p.data.busy=false;p.tickCountdown();assert.equal(requests,1);});
test('确认付款期间到期时重新查单并阻止发送模拟付款',async()=>{const f=fixture(),{p,api,calls}=f;const old=api.call;p.data.selectedOrder={id:'late',status:'PENDING',expiresAt:Date.now()-1};api.call=async(action,input)=>{if(action==='order')return {id:'late',status:'EXPIRED',lines:[],total:0,shippingFee:0,createdAt:1,expiresAt:2};return old(action,input);};p.action(event({action:'mockPay'}));await idle(p);assert.equal(p.data.selectedOrder.status,'EXPIRED');assert.ok(!calls.some(c=>c.action==='mockPay'));});
test('订单展示完整商品件数，售后阶段提供下一步指引',async()=>{const f=fixture(),{p,api}=f;api.call=async action=>action==='ordersPage'?{items:[{id:'o',status:'REFUNDING',lines:[{productId:'p',skuId:'s',name:'第一件',spec:'标准',price:2000,qty:2},{productId:'x',skuId:'x',name:'第二件',spec:'大号',price:100,qty:1}],total:4100,shippingFee:0,createdAt:1,refund:{stage:'WAIT_RETURN'}}],page:1,pages:1,total:1}:null;await p.loadOrderPage();assert.equal(p.data.orders[0].itemCount,3);assert.equal(p.data.orders[0].lines.length,2);assert.equal(p.data.orders[0].lines[0].lineTotalText,'40.00');assert.match(p.data.orders[0].nextStep,/填写运单/);});
test('未配置客服号码时不拨号也不复制，服务适配器不使用示例电话',()=>{const {p,wx}=fixture();let calls=0;wx.makePhoneCall=()=>calls++;wx.setClipboardData=()=>calls++;p.openSupport();assert.equal(p.data.supportVisible,true);p.callSupport();p.copySupport();assert.equal(calls,0);const context={wx:{},module:{exports:{}},require:()=>({apiBase:'https://shop.example.test'})};vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/api'),'utf8'),context);assert.equal(context.module.exports.getSupport().phone,'');});


test('微信订单深链读取商户交易号对应详情，不恢复旧结账也不自动支付',async()=>{
 const {p,api,calls}=fixture();const original=api.call;let recovered=0;
 api.call=async(action,input)=>{if(action==='orderByTradeNo'){calls.push({action,input});return refreshedOrder;}return original(action,input);};
 p.recoverCheckout=async()=>{recovered++;};
 p.onLoad({out_trade_no:'Ptrade123456'});await idle(p);
 assert.equal(p.data.selectedOrder.id,refreshedOrder.id);assert.equal(p.data.tab,'orders');assert.equal(recovered,0);
 assert.equal(calls.find(c=>c.action==='orderByTradeNo').input.outTradeNo,'Ptrade123456');
 assert.ok(!calls.some(c=>['createOrder','payment','paymentSync','mockPay'].includes(c.action)));
 p.onShow();await idle(p);assert.equal(calls.filter(c=>c.action==='orderByTradeNo').length,1);
});

test('订单深链等待登录，短暂网络失败可重试，越权或错误链接有明确提示',async()=>{
 const {p,api,modals}=fixture();api.hasSession=()=>false;api.login=async()=>{};let attempts=0,recovered=0;const original=api.call;
 api.call=async(action,input)=>{if(action==='orderByTradeNo'){if(++attempts===1)throw Error('网络暂时不可用');return refreshedOrder;}return original(action,input);};
 p.recoverCheckout=async()=>{recovered++;};p.onLoad({out_trade_no:'Ptrade123456'});await idle(p);
 assert.equal(p.data.loginRequired,true);assert.equal(attempts,0);
 p.login();await idle(p);assert.equal(p.pendingOrderTrade,'Ptrade123456');assert.equal(modals.at(-1),'网络暂时不可用');
 p.retry();await idle(p);assert.equal(p.data.selectedOrder.id,refreshedOrder.id);assert.equal(p.pendingOrderTrade,null);assert.equal(recovered,0);
 p.pendingOrderTrade='Pother123456';api.call=async action=>{assert.equal(action,'orderByTradeNo');throw Object.assign(Error('ORDER_NOT_FOUND'),{code:'ORDER_NOT_FOUND'});};
 await assert.rejects(p.openLinkedOrder(),/当前微信账号/);assert.equal(p.pendingOrderTrade,null);
 p.pendingOrderTrade='${商品订单号}';await assert.rejects(p.openLinkedOrder(),/订单链接无效/);assert.equal(p.pendingOrderTrade,null);
});


test('微信订单入口热启动更新订单，普通前后台切换不重复跳转',async()=>{
 const {p,api,app}=fixture();const original=api.call;let reads=0;
 api.call=async(action,input)=>{if(action==='orderByTradeNo'){reads++;return {...refreshedOrder,id:input.outTradeNo};}return original(action,input);};
 let definition;vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/app'),'utf8'),{App:value=>definition=value,require:()=>({mode:'api'})});
 definition.globalData=app.globalData;
 definition.onShow({path:'pages/shop/index',query:{out_trade_no:'Ptrade789012'}});
 p.onShow();await idle(p);assert.equal(p.data.selectedOrder.id,'Ptrade789012');assert.equal(app.globalData.orderEntry,null);
 p.close();definition.onShow({path:'pages/shop/index',query:{}});p.onShow();await idle(p);assert.equal(p.data.selectedOrder,null);assert.equal(reads,1);
});

test('联系商家说明按需展开，切换不触发订单或付款请求',()=>{const {p,calls}=fixture();p.toggleSupportSection(event({section:'delivery'}));assert.equal(p.data.supportSection,'delivery');p.toggleSupportSection(event({section:'pickup'}));assert.equal(p.data.supportSection,'pickup');p.toggleSupportSection(event({section:'pickup'}));assert.equal(p.data.supportSection,'');p.toggleSupportSection(event({section:'payment'}));assert.equal(p.data.supportSection,'');assert.equal(calls.length,0);});

test('切换买家身份清空上一账号购物车、订单详情和收货草稿',async()=>{
 const {p,api,wx}=fixture();const original=api.call;let id='buyer-a';api.call=async(action,input)=>action==='identity'?{id,merchant:false}:original(action,input);
 await p.refresh();p.setData({cart:[{productId:'p',skuId:'s',qty:1}],orders:[{id:'private'}],selectedOrder:{id:'private'},pickupContact:{name:'A',phone:'13800000000'}});id='buyer-b';await p.refresh();
 assert.equal(p.data.cart.length,0);assert.equal(p.data.orders.length,0);assert.equal(p.data.selectedOrder,null);assert.equal(p.data.pickupContact.phone,'');assert.equal(wx.getStorageSync('pet-cart-owner'),'buyer-b');
});
test('订单列表返回个人中心不会下单或付款',()=>{const {p,calls}=fixture();p.setData({tab:'orders'});p.backOrders();assert.equal(p.data.tab,'account');assert.equal(calls.length,0);});

test('快递查询迟到不覆盖另一订单或同单较新的查询，失败保留已读轨迹',async()=>{
 const {p,api}=fixture();const pending=[];api.call=()=>new Promise((resolve,reject)=>pending.push({resolve,reject}));
 p.setData({selectedOrder:{id:'one',shipping:{number:'SF000001'}}});const first=p.tracking();
 p.setData({selectedOrder:{id:'two',shipping:{number:'SF000002'}},tracking:null});const second=p.tracking();
 pending[1].resolve({events:[{text:'第二单轨迹'}]});await second;pending[0].resolve({events:[{text:'第一单轨迹'}]});await first;assert.equal(p.data.tracking.events[0].text,'第二单轨迹');
 const older=p.tracking(),newer=p.tracking();pending[3].resolve({events:[{text:'最新轨迹'}]});await newer;pending[2].resolve({events:[{text:'旧响应'}]});await older;assert.equal(p.data.tracking.events[0].text,'最新轨迹');
 const failed=p.tracking();pending[4].reject(Error('network'));await failed;assert.equal(p.data.tracking.events[0].text,'最新轨迹');assert.match(p.data.trackingError,/失败/);assert.equal(p.data.trackingLoading,false);
});

test('自提联系人按账号环境记忆，刷新不覆盖草稿，切换账号不串数据',async()=>{const {p,api,wx}=fixture();let scope='alice-env1';api.checkoutScope=()=>scope;p.rememberPickupContact({fulfillment:{type:'PICKUP'},address:{name:'甲',phone:'13800000000'}});await p.refresh();assert.equal(p.data.pickupContact.name,'甲');p.setData({pickupContact:{name:'未提交',phone:'123'}});await p.refresh();assert.equal(p.data.pickupContact.name,'未提交');scope='bob-env1';await p.refresh();assert.equal(p.data.pickupContact.name,'');scope='alice-env2';await p.refresh();assert.equal(p.data.pickupContact.name,'');scope='alice-env1';await p.refresh();assert.equal(p.data.pickupContact.name,'甲');wx.setStorageSync('pet-pickup-contact-v1:broken',{name:'无效',phone:'123'});scope='broken';await p.refresh();assert.equal(p.data.pickupContact.name,'');});

test('重新进入页面恢复成功下单联系人，存储故障不泄露上一账号草稿',async()=>{const f=fixture();await f.p.refresh();f.p.rememberPickupContact({fulfillment:{type:'PICKUP'},address:{name:'已下单',phone:'13800000000'}});const g=fixture();const key='pet-pickup-contact-v1:buyer-flow-checkout';g.wx.setStorageSync(key,f.wx.getStorageSync(key));await g.p.refresh();assert.equal(g.p.data.pickupContact.name,'已下单');g.p.setData({pickupContact:{name:'私人草稿',phone:'13800000000'}});g.api.checkoutScope=()=>'other-account';const read=g.wx.getStorageSync;g.wx.getStorageSync=k=>{if(k.includes('pickup-contact'))throw Error('storage');return read(k)};await g.p.refresh();assert.equal(g.p.data.pickupContact.name,'');});

const feedbackSample={id:'survey-1',title:'反馈',questions:[{id:'q1',title:'体验',type:'single',required:true,options:['好','一般']},{id:'q2',title:'改进',type:'multiple',required:false,options:['服务','速度']}]};
async function feedbackIdle(p){for(let i=0;i<20&&p.data.feedbackLoading;i++)await new Promise(r=>setImmediate(r));assert.equal(p.data.feedbackLoading,false);}
test('反馈仅主动打开，必填阻止空交，单选多选一次提交且不重复点击',async()=>{const f=fixture(),old=f.api.call;let sends=0,finish;f.api.call=async(a,i)=>a==='survey'?{survey:feedbackSample,submitted:false}:a==='submitSurvey'?(sends++,new Promise(r=>finish=r)):old(a,i);await f.p.refresh();assert.equal(f.p.data.feedbackVisible,false);f.p.openFeedback();await feedbackIdle(f.p);await f.p.submitFeedback();assert.match(f.p.data.feedbackError,/必填/);assert.equal(sends,0);f.p.feedbackChoice({currentTarget:{dataset:{i:0}},detail:{value:'1'}});f.p.feedbackChoice({currentTarget:{dataset:{i:1}},detail:{value:['0','1']}});const pending=f.p.submitFeedback();await f.p.submitFeedback();assert.equal(sends,1);finish({submitted:true});await pending;assert.equal(f.p.data.feedbackSubmitted,true);await f.p.submitFeedback();assert.equal(sends,1);});
test('问卷断网保留答案允许原样重试，关闭后的迟到结果不弹回',async()=>{const f=fixture();let attempts=0;f.api.call=async a=>{if(a==='survey')return {survey:feedbackSample};if(++attempts===1)throw Error('模拟断网');return {submitted:true};};f.p.openFeedback();await feedbackIdle(f.p);f.p.feedbackChoice({currentTarget:{dataset:{i:0}},detail:{value:'0'}});await f.p.submitFeedback();assert.equal(f.p.data.feedbackAnswers[0][0],0);assert.equal(f.p.data.feedbackSubmitted,false);await f.p.submitFeedback();assert.equal(f.p.data.feedbackSubmitted,true);let resolve;f.api.call=()=>new Promise(r=>resolve=r);f.p.openFeedback();f.p.closeFeedback();resolve({survey:feedbackSample});await new Promise(r=>setImmediate(r));assert.equal(f.p.data.feedbackVisible,false);assert.equal(f.p.data.feedback,null);});
test('未开放和已提交问卷正确展示，退出账号清除回答及迟到结果',async()=>{const f=fixture();f.api.call=async()=>({survey:null});f.p.openFeedback();await feedbackIdle(f.p);assert.equal(f.p.data.feedback,null);f.api.call=async()=>({survey:feedbackSample,submitted:true});f.p.openFeedback();await feedbackIdle(f.p);assert.equal(f.p.data.feedbackSubmitted,true);let resolve;f.api.call=()=>new Promise(r=>resolve=r);f.p.openFeedback();f.p.resetBuyerState();resolve({survey:feedbackSample,submitted:true});await new Promise(r=>setImmediate(r));assert.equal(f.p.data.feedbackVisible,false);assert.equal(f.p.data.feedbackSubmitted,false);});

test('切换微信后即使地址加载失败，也先清除旧账号全部草稿和订单',async()=>{const {p,api,wx}=fixture();const old=api.call;let user='wx:alice',broken=false;api.mode='cloud';api.call=async(a,i)=>{if(a==='identity')return {id:user,merchant:false};if(a==='addresses'&&broken)throw Error('模拟断网');return old(a,i)};await p.refresh();privateBuyerState(p);user='wx:bob';broken=true;await p.refresh();assertNoPrivateBuyerState(p);assert.equal(wx.getStorageSync('pet-cart-owner'),'wx:bob');assert.equal(p.data.canOrder,false);});
test('订单号复制使用短编号而非内部ID',()=>{const {p,wx}=fixture();let copied;wx.setClipboardData=o=>copied=o.data;p.setData({selectedOrder:{id:'o987',orderNo:'A003'}});p.copyOrderNumber();assert.equal(copied,'A003');});
test('首次结算用微信快速验证手机号，取消不进入结算，成功后带出号码',async()=>{
 const {p,api,wx}=fixture();const original=api.call;let phone='',modals=[];
 wx.showModal=o=>modals.push(o.content);
 api.call=async(action,input)=>{if(action==='identity')return {merchant:false,phone};if(action==='bindPhone'){if(input.code!=='a1b2c3d4')throw Error('请使用微信验证手机号');phone='13900001111';return {phone};}return original(action,input);};
 await p.refresh();p.setData({cart:[{productId:'p',skuId:'s',qty:1,price:2000,name:'测试商品',spec:'标准',image:'',selected:true}]});
 p.prepareCheckout();assert.equal(p.data.phonePrompt,true);assert.notEqual(p.data.tab,'checkout');
 p.bindWechatPhone({detail:{errMsg:'getPhoneNumber:fail user deny'}});assert.equal(p.data.phonePrompt,true);assert.equal(p.data.tab!=='checkout',true);
 p.bindWechatPhone({detail:{errno:1400001,errMsg:'fail'}});assert.match(modals.at(-1),/次数已用完/);
 p.bindWechatPhone({detail:{code:'a1b2c3d4',errMsg:'getPhoneNumber:ok'}});await idle(p);
 assert.equal(p.data.phonePrompt,false);assert.equal(p.data.tab,'checkout');assert.equal(p.data.boundPhone,'13900001111');assert.equal(p.data.pickupContact.phone,'13900001111');
});

test('结算默认堂食且无需地址；切换自提保留预约，切回堂食不提交预约时间',async()=>{
 const f=fixture(null),{p,calls,addresses}=f;assert.equal(p.data.deliveryMode,'DINE_IN');addresses.length=0;
 p.data.cart=[{productId:'p',skuId:'s',qty:1}];await p.refresh();acceptOrders(f);p.prepareCheckout();assert.equal(p.data.checkoutTotal,'20.00');
 p.deliveryMode(event({value:'PICKUP'}));assert.equal(p.data.deliveryMode,'PICKUP');p.setData({pickupSlots:[{at:1234,label:'预约'}],pickupSlotIndex:0});
 p.deliveryMode(event({value:'DINE_IN'}));p.checkout();await idle(p);
 const input=calls.find(c=>c.action==='createOrder').input;assert.equal(input.fulfillment,'DINE_IN');assert.equal(input.pickupAt,null);assert.equal(input.contact.name,'堂食顾客');assert.equal(input.addressId,undefined);
 assert.equal(p.data.selectedOrder.isDineIn,true);assert.equal(p.data.selectedOrder.totalText,'20.00');
});

test('自定义充值拒绝非法金额，重试复用请求号且不擅自换金额',async()=>{
 const f=fixture(),{p,api,wx,calls,modals}=f;p.setData({member:{tiers:[],terms:'储值说明'}});wx.removeStorageSync=k=>wx.setStorageSync(k,null);
 const original=api.call;let failed=false;
 api.call=async(action,input)=>{if(action!=='createRecharge')return original(action,input);calls.push({action,input});if(!failed){failed=true;throw Error('网络中断');}return {id:'recharge-1',kind:'RECHARGE',status:'PENDING',lines:[],total:input.amount,shippingFee:0};};
 for(const value of ['','0','-1','1.001','1e2','5000.01']){p.setData({customRecharge:value});p.recharge(event({custom:'true'}));await idle(p);}assert.equal(calls.filter(c=>c.action==='createRecharge').length,0);
 p.customRechargeField({detail:{value:'123.45'}});p.recharge(event({custom:'true'}));await idle(p);assert.match(modals.at(-1),/网络中断/);
 p.customRechargeField({detail:{value:'124'}});p.recharge(event({custom:'true'}));await idle(p);assert.match(modals.at(-1),/上次充值结果待确认/);
 p.customRechargeField({detail:{value:'123.45'}});p.recharge(event({custom:'true'}));await idle(p);const topups=calls.filter(c=>c.action==='createRecharge');assert.equal(topups.length,2);assert.equal(topups[0].input.key,topups[1].input.key);assert.equal(topups[1].input.amount,12345);assert.equal(topups[1].input.custom,true);assert.equal(p.data.selectedOrder.kind,'RECHARGE');
});

test('小程序会员价与购物车、立即购买保持一致，余额耗尽刷新后恢复普通价',async()=>{
 const f=fixture(null),{p,api,products}=f;products[0].skus[0].memberPrice=1600;const old=api.call;let member=true;
 api.call=async(action,input)=>action==='identity'?{id:'buyer',merchant:false,phone:'13800000000',isMember:member}:old(action,input);
 p.data.cart=[{productId:'p',skuId:'s',qty:2}];await p.refresh();assert.equal(p.data.isMember,true);assert.equal(p.data.products[0].priceText,'16.00');assert.equal(p.data.cartTotal,'32.00');assert.equal(p.data.cart[0].price,1600);
 p.detail(event({id:'p'}));p.buy();assert.equal(p.data.quickLines[0].price,1600);assert.equal(p.data.checkoutTotal,'16.00');
 member=false;await p.refresh();assert.equal(p.data.isMember,false);assert.equal(p.data.products[0].priceText,'20.00');assert.equal(p.data.quickLines[0].price,2000);assert.equal(p.data.checkoutTotal,'20.00');assert.equal(p.data.cart[0].price,2000);
});

test('结算前后端报价会纠正过期会员身份，确认框显示真实普通价金额',async()=>{
 const f=fixture(null),{p,api,products,wx,modals}=f;products[0].skus[0].memberPrice=1600;const old=api.call;
 api.call=async(action,input)=>action==='identity'?{id:'buyer',isMember:true,phone:'13800000000'}:action==='quoteOrder'?{isMember:false,total:2000,fulfillment:'DINE_IN',settingsRevision:0}:old(action,input);
 p.data.cart=[{productId:'p',skuId:'s',qty:1}];await p.refresh();assert.equal(p.data.checkoutTotal,'16.00');wx.accept=false;p.checkout();await idle(p);assert.equal(p.data.isMember,false);assert.equal(p.data.checkoutTotal,'20.00');assert.match(modals.at(-1),/普通价.*20.00/);
});


test('充值固定展示五个金额，沿用已配置赠送，缺少的档位按实付充值',async()=>{
 const {p,api,wx,calls}=fixture();wx.removeStorageSync=k=>wx.setStorageSync(k,null);p.applyMemberPricing=()=>{};p.selectOrder=()=>{};
 api.call=async(action,input)=>{calls.push({action,input});if(action==='membership')return {enabled:true,balance:0,isMember:false,terms:'储值说明',entries:[],tiers:[{pay:10000,credit:12000},{pay:500,credit:500}]};if(action==='createRecharge')return {id:'topup',total:input.amount};};
 p.openMembership();await idle(p);assert.deepEqual(Array.from(p.data.member.tiers,t=>t.amount),[5000,10000,20000,30000,50000]);
 for(const amount of [5000,10000,20000,30000,50000]){p.recharge(event({amount}));await idle(p);const input=calls.filter(c=>c.action==='createRecharge').at(-1).input;assert.equal(input.amount,amount);assert.equal(input.custom,amount!==10000);}
 assert.equal(p.data.member.tiers[1].creditText,'120.00');
});

test('自定义卡片限制上限与两位小数，零金额不发起充值，支持按分充值',async()=>{
 const {p,api,wx,calls}=fixture();wx.removeStorageSync=k=>wx.setStorageSync(k,null);p.setData({member:{tiers:[],terms:'储值说明'}});p.selectOrder=()=>{};
 api.call=async(action,input)=>{calls.push({action,input});return {id:'topup',total:input.amount};};
 assert.equal(p.customRechargeField({detail:{value:'5000.01'}}),'5000');assert.equal(p.data.customRecharge,'5000');
 assert.equal(p.customRechargeField({detail:{value:'12.345'}}),'12.34');
 assert.equal(p.customRechargeField({detail:{value:'.5'}}),'0.5');
 p.customRechargeField({detail:{value:'0'}});p.recharge(event({custom:true}));await idle(p);assert.equal(calls.length,0);
 p.customRechargeField({detail:{value:'0.01'}});p.recharge(event({custom:true}));await idle(p);assert.equal(calls[0].input.amount,1);assert.equal(calls[0].input.custom,true);
});


test('咖啡零库存仍可浏览、加入购物车和立即购买，保留每规格数量上限',async()=>{
 const {p,products}=fixture();products[0].category='咖啡';products[0].skus[0].stock=0;await p.refresh();
 const coffee=p.data.products[0];assert.equal(coffee.stockTracked,false);assert.equal(coffee.skus[0].stockTracked,false);
 p.setData({stockOnly:true,shopSection:'coffee'});p.filter();assert.equal(p.data.visible.length,1);
 p.detail(event({id:coffee.id}));p.setData({detailQty:2});assert.equal(p.add(),true);assert.equal(p.data.cartInvalid,false);assert.equal(p.data.cart[0].qty,2);
 p.detail(event({id:coffee.id}));p.buy();assert.equal(p.data.tab,'checkout');assert.equal(p.data.quickLines[0].qty,1);
 assert.equal(p.validCartQty(99,coffee.skus[0]),true);assert.equal(p.validCartQty(100,coffee.skus[0]),false);
});

test('饮品不同搭配分行显示并加价，修改搭配可合并同款，结算只扣对应搭配',async()=>{
 const f=fixture(null),{p,products,calls}=f;products[0].category='咖啡';products[0].skus[0].stock=0;
 products[0].optionGroups=[{id:'milk',name:'奶',options:[{id:'regular',name:'牛奶',extraPrice:0},{id:'oat',name:'燕麦奶',extraPrice:300}]}];await p.refresh();
 p.detail(event({id:'p'}));assert.equal(p.data.detailPriceText,'20.00');p.add();
 p.detail(event({id:'p'}));p.chooseDrinkOption(event({group:'milk',option:'oat'}));p.setData({detailQty:2});assert.equal(p.data.detailPriceText,'23.00');p.add();
 assert.equal(p.data.cart.length,2);assert.equal(p.data.cartTotal,'66.00');assert.notEqual(p.data.cart[0].lineKey,p.data.cart[1].lineKey);
 p.editCartOptions(event({i:0}));p.chooseDrinkOption(event({group:'milk',option:'oat'}));p.add();assert.equal(p.data.cart.length,1);assert.equal(p.data.cart[0].qty,3);assert.equal(p.data.cartTotal,'69.00');
 p.detail(event({id:'p'}));p.add();p.toggleLine(event({i:0}));acceptOrders(f);p.prepareCheckout();p.checkout();await idle(p);
 const input=calls.find(c=>c.action==='createOrder').input;assert.equal(input.lines.length,1);assert.equal(input.lines[0].selections[0].optionId,'regular');
 assert.equal(p.data.cart.length,1);assert.equal(p.data.cart[0].selections[0].optionId,'oat');assert.equal(p.data.cart[0].qty,3);
});

test('饮品立即购买包含加价，会员身份切换仍保留搭配，选项删除后购物车阻止结算',async()=>{
 const {p,products}=fixture(null);products[0].category='饮品';products[0].skus[0].memberPrice=1600;
 products[0].optionGroups=[{id:'milk',name:'奶',options:[{id:'cow',name:'牛奶',extraPrice:0},{id:'oat',name:'燕麦奶',extraPrice:300}]}];await p.refresh();
 p.detail(event({id:'p'}));p.chooseDrinkOption(event({group:'milk',option:'oat'}));p.buy();assert.equal(p.data.quickLines[0].price,2300);assert.equal(p.data.checkoutTotal,'23.00');
 p.applyMemberPricing(true);assert.equal(p.data.checkoutTotal,'19.00');assert.match(p.data.quickLines[0].optionsText,/燕麦奶/);
 p.data.products[0].optionGroups[0].options.pop();p.cartTotal();assert.equal(p.data.cartInvalid,true);assert.match(p.data.quickLines[0].invalid,/失效/);
});


test('饮品所有搭配均加价时，商品列表展示实际最低可购价格',async()=>{
 const {p,products}=fixture();products[0].category='饮品';products[0].optionGroups=[{id:'milk',name:'奶',options:[{id:'oat',name:'燕麦奶',extraPrice:300},{id:'coconut',name:'椰奶',extraPrice:200}]}];await p.refresh();
 assert.equal(p.data.products[0].priceText,'22.00');assert.equal(p.data.products[0].priceFrom,true);p.detail(event({id:'p'}));assert.equal(p.data.detailPriceText,'23.00');
});
