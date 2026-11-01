const test=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('../server/http');
const {Auth}=require('../server/auth');
const domain=require('../cloudfunctions/shop/domain');
test('云网关身份链路：不同微信订单与地址隔离，伪造业务参数不能越权',async()=>{
 let state=domain.seed();const store={db:{command:async()=>({ok:1})},async execute(actor,action,input,options){const out=domain.execute(state,actor,action,input,options);state=out.state;return out.result;}};
 const server=createServer(store,{auth:new Auth([]),cloudIdentity:{enabled:true,appId:'wx-test-app'}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const call=async(user,action,input={})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api',{method:'POST',headers:{'Content-Type':'application/json','x-wx-openid':user,'x-wx-source':'wx_client','x-wx-appid':'wx-test-app'},body:JSON.stringify({action,input,role:'merchant',userId:'wx:openid-alice'})});return {status:r.status,...await r.json()};};
 try{
  const address=await call('openid-alice','saveAddress',{name:'隔离验收',phone:'13800000000',detail:'隔离验收地址一号'});assert.equal(address.status,200);
  const created=await call('openid-alice','createOrder',{key:'cloud-isolation-order',fulfillment:'PICKUP',contact:{name:'隔离验收',phone:'13800000000'},lines:[{productId:'toy',skuId:'toy-1',qty:1}]});assert.equal(created.status,200);const id=created.data.id;
  assert.equal((await call('openid-alice','ordersPage')).data.total,1);
  assert.equal((await call('openid-bobby','ordersPage')).data.total,0);
  assert.equal((await call('openid-bobby','addresses')).data.length,0);
  for(const action of ['order','cancel','tracking'])assert.equal((await call('openid-bobby',action,{id})).status,403,action);
  assert.equal((await call('openid-bobby','merchantOrders')).status,403);
  assert.equal((await call('openid-alice','order',{id})).data.id,id);
 }finally{await new Promise(r=>server.close(r));}
});
