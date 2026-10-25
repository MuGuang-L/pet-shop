const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const domain=require('../cloudfunctions/shop/domain'),studio=require('../cloudfunctions/shop/studio');
function fixture(){let state=domain.seed(),page;const calls=[],errors=[],confirms=[],storage={};let approve=true,dropResponse=false;
 const call=async(action,input={})=>{calls.push({action,input});const out=domain.execute(state,{id:'buyer-settings-test'},action,input,{mock:true});state=out.state;if(action==='createOrder'&&dropResponse){dropResponse=false;throw Error('连接联调服务失败');}return out.result;};
 const wx={getStorageSync:k=>storage[k],setStorageSync:(k,v)=>storage[k]=v,showToast(){},showModal(o){if(o.title==='确认订单'){confirms.push(o.content);o.success({confirm:approve});}else errors.push(o.content);}};
 const helper={module:{exports:{}},wx};vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/checkout'),'utf8'),helper);
 const makePage=()=>{vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/shop/index'),'utf8'),{Page:p=>page=p,require:n=>n.includes('studio')?studio:n.includes('checkout')?helper.module.exports:{call,mode:'api',hasSession:()=>true,checkoutScope:()=>'checkout-test'},wx,setInterval:()=>1,clearInterval(){}});page.setData=function(values){Object.assign(this.data,values);};return page;};makePage();
 page.setData=function(values){Object.assign(this.data,values);};
 return {get page(){return page;},restart:makePage,storage,calls,errors,confirms,call,approve(value){approve=value;},drop(){dropResponse=true;},get state(){return state;},save(change){const s=domain.execute(state,{id:'owner',merchant:true},'shopSettings',{}, {mock:true}).result;change(s);state=domain.execute(state,{id:'owner',merchant:true},'saveShopSettings',s,{mock:true}).state;}};
}
async function idle(page){for(let i=0;i<100&&page.data.busy;i++)await new Promise(r=>setImmediate(r));assert.equal(page.data.busy,false);}
test('小程序读取动态外送费和门店地址，服务端报价确认后下单',async()=>{
 const f=fixture();f.save(s=>{s.delivery.fee=650;s.store.detail='模拟市新地址 88 号';});
 await f.call('saveAddress',{name:'模拟',phone:'13800000000',detail:'模拟市收货路 1 号'});await f.page.refresh();
 f.page.setData({cart:[{productId:'toy',skuId:'toy-1',qty:1,price:1900}]});f.page.cartTotal();
 assert.equal(f.page.data.shippingEstimate,'6.50');assert.equal(f.page.data.pickupStore.detail,'模拟市新地址 88 号');
 f.page.checkout();await idle(f.page);assert.match(f.confirms[0],/25.50/);assert.equal(f.page.data.selectedOrder.total,2550);assert.equal(f.calls.find(c=>c.action==='createOrder').input.settingsRevision,1);assert.deepEqual(f.errors,[]);
});
test('小程序取消确认不下单，网络失败重试复用原报价和幂等键',async()=>{
 const f=fixture();await f.page.refresh();f.page.setData({deliveryMode:'PICKUP',pickupContact:{name:'模拟',phone:'13800000000'},cart:[{productId:'toy',skuId:'toy-1',qty:1,price:1900}]});
 f.approve(false);f.page.checkout();await idle(f.page);assert.equal(f.state.orders.length,0);assert.equal(f.page.data.cart.length,1);
 f.approve(true);f.drop();f.page.checkout();await idle(f.page);assert.equal(f.state.orders.length,1);const key=f.page.checkoutKey;
 f.page.checkout();await idle(f.page);assert.equal(f.state.orders.length,1);const created=f.calls.filter(c=>c.action==='createOrder');assert.equal(created[0].input.key,key);assert.equal(created[1].input.key,key);assert.equal(f.page.data.cart.length,0);
});

test('创建成功但响应丢失，重开页面自动找回原订单，只扣一次库存',async()=>{
 const f=fixture();await f.page.refresh();f.page.setData({deliveryMode:'PICKUP',pickupContact:{name:'模拟',phone:'13800000000'},cart:[{productId:'toy',skuId:'toy-1',qty:1,price:1900}]});f.page.cartTotal();
 f.drop();f.page.checkout();await idle(f.page);const original=f.state.orders[0].id;
 f.restart();f.page.onLoad();await idle(f.page);
 assert.equal(f.state.orders.length,1);assert.equal(f.state.products[1].skus[0].stock,29);
 assert.equal(f.page.data.selectedOrder.id,original);assert.equal(f.page.data.cart.length,0);
 const calls=f.calls.filter(c=>c.action==='createOrder');assert.equal(calls[0].input.key,calls[1].input.key);
 assert.equal(f.confirms.length,1);assert.equal(f.storage['checkout-test'],null);
});


test('立即购买最后一件响应丢失，重新打开时不因库存不足阻止恢复，也不修改原购物车',async()=>{
 const f=fixture();await f.page.refresh();f.page.setData({deliveryMode:'PICKUP',pickupContact:{name:'模拟',phone:'13800000000'},cart:[{productId:'food',skuId:'food-1',qty:2,price:5900}]});f.page.cartTotal();
 f.page.detail({currentTarget:{dataset:{id:'toy'}}});f.page.setData({detailQty:30});f.page.buy();f.drop();f.page.checkout();await idle(f.page);
 assert.equal(f.state.products[1].skus[0].stock,0);f.restart().onLoad();await idle(f.page);
 assert.equal(f.state.orders.length,1);assert.equal(f.page.data.selectedOrder.lines[0].qty,30);assert.equal(f.page.data.cart[0].productId,'food');assert.equal(f.page.data.cart[0].qty,2);
});

test('只按勾选商品核算免外送费门槛，商家关闭外送后切换到自提',async()=>{
 const f=fixture();f.save(s=>{s.delivery.fee=650;s.delivery.freeAbove=3000;});await f.page.refresh();
 f.page.setData({cart:[{productId:'toy',skuId:'toy-1',qty:1},{productId:'food',skuId:'food-1',qty:2,selected:false}]});f.page.cartTotal();assert.equal(f.page.data.shippingEstimate,'6.50');
 f.page.setData({cart:[{productId:'toy',skuId:'toy-1',qty:2}]});f.page.cartTotal();assert.equal(f.page.data.shippingEstimate,'0.00');
 f.save(s=>{s.delivery.enabled=false;});await f.page.refresh();assert.equal(f.page.data.deliveryMode,'PICKUP');assert.equal(f.page.data.deliveryEnabled,false);
 f.page.deliveryMode({currentTarget:{dataset:{value:'DELIVERY'}}});assert.equal(f.page.data.deliveryMode,'PICKUP');
});

test('商家暂停接单后前端不发新订单；确认期间金额变化由服务端拒绝',async()=>{
 const f=fixture();await f.page.refresh();f.page.setData({deliveryMode:'PICKUP',pickupContact:{name:'模拟',phone:'13800000000'},cart:[{productId:'toy',skuId:'toy-1',qty:1}]});
 f.save(s=>{s.acceptingOrders=false;});await f.page.refresh();f.page.checkout();await idle(f.page);assert.equal(f.state.orders.length,0);assert.equal(f.calls.filter(c=>c.action==='createOrder').length,0);
 f.save(s=>{s.acceptingOrders=true;});await f.page.refresh();f.page.confirm=async()=>{f.save(s=>{s.store.detail='模拟门店变更 88 号';});return true;};f.page.checkout();await idle(f.page);assert.equal(f.state.orders.length,0);assert.match(f.errors.at(-1),/设置已变化/);
});
