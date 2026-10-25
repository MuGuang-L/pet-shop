const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const domain=require('../cloudfunctions/shop/domain'),studio=require('../cloudfunctions/shop/studio');
function fixture(){let state=domain.seed(),page;const calls=[],errors=[],confirms=[],storage={};let approve=true,dropResponse=false;
 const call=async(action,input={})=>{calls.push({action,input});const out=domain.execute(state,{id:'buyer-settings-test'},action,input,{mock:true});state=out.state;if(action==='createOrder'&&dropResponse){dropResponse=false;throw Error('连接联调服务失败');}return out.result;};
 const wx={getStorageSync:k=>storage[k],setStorageSync:(k,v)=>storage[k]=v,showToast(){},showModal(o){if(o.title==='确认订单'){confirms.push(o.content);o.success({confirm:approve});}else errors.push(o.content);}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/shop/index'),'utf8'),{Page:p=>page=p,require:n=>n.includes('studio')?studio:{call,mode:'api',hasSession:()=>true},wx});
 page.setData=function(values){Object.assign(this.data,values);};
 return {page,calls,errors,confirms,call,approve(value){approve=value;},drop(){dropResponse=true;},get state(){return state;},save(change){const s=domain.execute(state,{id:'owner',merchant:true},'shopSettings',{}, {mock:true}).result;change(s);state=domain.execute(state,{id:'owner',merchant:true},'saveShopSettings',s,{mock:true}).state;}};
}
async function idle(page){for(let i=0;i<100&&page.data.busy;i++)await new Promise(r=>setImmediate(r));assert.equal(page.data.busy,false);}
test('小程序读取动态外送费和门店地址，服务端报价确认后下单',async()=>{
 const f=fixture();f.save(s=>{s.delivery.fee=650;s.store.detail='模拟市新地址 88 号';});
 await f.call('saveAddress',{name:'模拟',phone:'13800000000',detail:'模拟市收货路 1 号'});await f.page.refresh();
 f.page.setData({cart:[{productId:'toy',skuId:'toy-1',qty:1,price:1900}]});f.page.cartTotal();
 assert.equal(f.page.data.shippingText,'6.50');assert.equal(f.page.data.pickupStore.detail,'模拟市新地址 88 号');
 f.page.checkout();await idle(f.page);assert.match(f.confirms[0],/25.50/);assert.equal(f.page.data.selectedOrder.total,2550);assert.equal(f.calls.find(c=>c.action==='createOrder').input.settingsRevision,1);assert.deepEqual(f.errors,[]);
});
test('小程序取消确认不下单，网络失败重试复用原报价和幂等键',async()=>{
 const f=fixture();await f.page.refresh();f.page.setData({deliveryMode:'PICKUP',pickupContact:{name:'模拟',phone:'13800000000'},cart:[{productId:'toy',skuId:'toy-1',qty:1,price:1900}]});
 f.approve(false);f.page.checkout();await idle(f.page);assert.equal(f.state.orders.length,0);assert.equal(f.page.data.cart.length,1);
 f.approve(true);f.drop();f.page.checkout();await idle(f.page);assert.equal(f.state.orders.length,1);const key=f.page.checkoutKey;
 f.page.checkout();await idle(f.page);assert.equal(f.state.orders.length,1);const created=f.calls.filter(c=>c.action==='createOrder');assert.equal(created[0].input.key,key);assert.equal(created[1].input.key,key);assert.equal(f.page.data.cart.length,0);
});
