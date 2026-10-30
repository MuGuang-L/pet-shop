'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,memory}=require('./helpers/payment-fixture');
const {Auth,createAccount}=require('../server/auth');
const {createServer}=require('../server/http');
test('普通 HTTP / 隧道入口拒绝伪造微信身份，不能读取其他买家地址',async()=>{
 const store=memory(),victim={id:'wx:victim-openid'};
 await store.execute(victim,'saveAddress',{name:'模拟',phone:'13800000000',detail:'模拟市验收街道 1 号'});
 const server=createServer(store,{auth:new Auth([])});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api',{method:'POST',headers:{'Content-Type':'application/json','x-wx-openid':'victim-openid','x-wx-source':'cloudbase','x-wx-appid':'wx-test'},body:JSON.stringify({action:'addresses'})});assert.equal(response.status,401);assert.equal((await response.json()).data,undefined);}
 finally{await new Promise(r=>server.close(r));}
});
test('可信入口也必须匹配小程序；资源复用身份和应用成对检查',()=>{
 const auth=new Auth([]),options={enabled:true,appId:'wx-test'};
 const req={headers:{'x-wx-openid':'test-openid','x-wx-source':'cloudbase','x-wx-appid':'wx-test'}};
 assert.equal(auth.cloudBuyer(req),null);assert.equal(auth.cloudBuyer(req,options).id,'wx:test-openid');
 for(const appid of ['','wx-other'])assert.throws(()=>auth.cloudBuyer({headers:{...req.headers,'x-wx-appid':appid}},options),/AUTH_REQUIRED/);
 assert.throws(()=>auth.cloudBuyer(req,{enabled:true}),/AUTH_REQUIRED/);
 const reused={headers:{...req.headers,'x-wx-from-openid':'reused-openid'}};
 assert.throws(()=>auth.cloudBuyer(reused,options),/AUTH_REQUIRED/);
 reused.headers['x-wx-from-appid']='wx-test';assert.equal(auth.cloudBuyer(reused,options).id,'wx:reused-openid');
});
test('商家有效会话不会被网关附带的买家身份覆盖',async()=>{
 const auth=new Auth([createAccount('owner','test-password','merchant','owner')]);
 const token=(await auth.login('owner','test-password')).token;
 const server=createServer(memory(),{auth,cloudIdentity:{enabled:true,appId:'wx-test'}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/auth/me',{method:'POST',headers:{Authorization:'Bearer '+token,'x-wx-openid':'test-openid','x-wx-source':'cloudbase','x-wx-appid':'wx-test'},body:'{}'});assert.equal((await response.json()).data.merchant,true);}
 finally{await new Promise(r=>server.close(r));}
});
test('独立支付网关并发使用同一持久化交易号，重试请求内容完全一致',async()=>{
 const f=await fixture();const results=await Promise.all(Array.from({length:8},()=>f.gateway().createPayment(f.actor,{id:f.order.id},{})));
 assert.equal(new Set(results.map(row=>row.outTradeNo)).size,1);assert.equal(f.remote.size,1);
 assert.equal((await f.store.tradesByOrder(f.order.id)).length,1);
 const requests=f.calls.filter(row=>row.action==='unifiedOrder');assert.ok(requests.length>1);
 for(const request of requests)assert.deepEqual(request.body,requests[0].body);
});
test('微信已受理但响应超时，重建网关后仍使用原交易号',async()=>{
 const f=await fixture();f.behavior.timeoutOnce=true;
 await assert.rejects(f.gateway().createPayment(f.actor,{id:f.order.id},{}),/ETIMEDOUT/);
 const reserved=(await f.store.tradesByOrder(f.order.id))[0];assert.equal(reserved.status,'CREATING');
 const recovered=await f.gateway().createPayment(f.actor,{id:f.order.id},{});
 assert.equal(recovered.outTradeNo,reserved.outTradeNo);assert.equal(f.remote.size,1);
});
test('取消后漏支付通知：主动查单并退款，不再次扣减或释放库存',async()=>{
 const f=await fixture(),gw=f.gateway();const pay=await gw.createPayment(f.actor,{id:f.order.id},{});
 await f.store.execute(f.actor,'cancel',{id:f.order.id});f.remote.get(pay.outTradeNo).state='SUCCESS';
 const result=await gw.syncPayment(f.actor,{id:f.order.id});assert.equal(result.status,'REFUNDED');assert.equal(result.refund.latePayment,true);
 await gw.syncPayment(f.actor,{id:f.order.id});assert.equal(f.store.state().products[0].skus[0].stock,20);
 assert.equal((await f.store.getTrade(pay.outTradeNo)).status,'REFUNDED');
});
test('后台恢复补查处理过期订单，退款接口失败后在后续轮次重试',async()=>{
 const f=await fixture();const pay=await f.gateway().createPayment(f.actor,{id:f.order.id},{});f.remote.get(pay.outTradeNo).state='SUCCESS';
 f.advance(16*60000);f.behavior.refundFailure=true;
 assert.equal((await f.gateway().reconcile()).failed,1);assert.equal(f.store.state().orders[0].status,'REFUNDING');
 f.behavior.refundFailure=false;f.advance(60001);
 assert.equal((await f.gateway().reconcile()).failed,0);assert.equal(f.store.state().orders[0].status,'REFUNDED');
 assert.equal(f.store.state().products[0].skus[0].stock,20);
});
test('取消后尚未付款会关单；付款与关单竞争时仍核对到账并退款',async()=>{
 for(const race of [false,true]){
  const f=await fixture(),gw=f.gateway();const pay=await gw.createPayment(f.actor,{id:f.order.id},{});
  await f.store.execute(f.actor,'cancel',{id:f.order.id});f.behavior.closeRace=race;
  const order=await gw.syncPayment(f.actor,{id:f.order.id});
  assert.equal(order.status,race?'REFUNDED':'CANCELLED');assert.equal((await f.store.getTrade(pay.outTradeNo)).status,race?'REFUNDED':'CLOSED');
  assert.ok(f.calls.some(row=>row.action==='closeorder'));
 }
});
test('旧版本的额外支付单到账只退额外款，不修改已支付订单和库存',async()=>{
 const f=await fixture(),gw=f.gateway();const pay=await gw.createPayment(f.actor,{id:f.order.id},{});
 f.remote.get(pay.outTradeNo).state='SUCCESS';await gw.syncPayment(f.actor,{id:f.order.id});
 const first=await f.store.getTrade(pay.outTradeNo),extra={...first,outTradeNo:'Plegacy-extra',transactionId:undefined,status:'CREATED',version:1};
 f.store.trades.set(extra.outTradeNo,extra);f.remote.set(extra.outTradeNo,{state:'SUCCESS',transactionId:'tx-legacy-extra',body:{...first.request,out_trade_no:extra.outTradeNo}});
 const order=await gw.syncPayment(f.actor,{id:f.order.id});assert.equal(order.status,'PAID');assert.equal(order.payment.transactionId,first.transactionId);
 assert.equal((await f.store.getTrade(extra.outTradeNo)).status,'DUPLICATE_REFUNDED');assert.equal(f.store.state().products[0].skus[0].stock,19);
});
test('过时的支付响应不能覆盖另一实例已经确认的状态',async()=>{
 const f=await fixture(),gw=f.gateway();const pay=await gw.createPayment(f.actor,{id:f.order.id},{}),old=await f.store.getTrade(pay.outTradeNo);
 f.remote.get(pay.outTradeNo).state='SUCCESS';await gw.syncPayment(f.actor,{id:f.order.id});
 await assert.rejects(gw.book.save({...old,status:'CREATED'}),/PAYMENT_REVISION_CONFLICT/);
 assert.equal((await f.store.getTrade(pay.outTradeNo)).status,'SUCCESS');
});
test('服务生命周期启动自动补查，停止时等待补查完成',async()=>{
 const f=await fixture();const pay=await f.gateway().createPayment(f.actor,{id:f.order.id},{});f.remote.get(pay.outTradeNo).state='SUCCESS';f.advance(60001);
 const {start}=require('../server/index');
 const service=await start({port:0,connect:async()=>f.store,paymentInterval:15,httpOptions:{auth:new Auth([]),wechat:{...f.settings,now:f.now},fetch:f.fetch},logger:{log(){},error(){}}});
 try{const deadline=Date.now()+2000;while(f.store.state().orders[0].status!=='PAID'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));assert.equal(f.store.state().orders[0].status,'PAID');}
 finally{await service.stop();}
});
