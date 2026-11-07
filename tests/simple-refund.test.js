'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('../server/http');
const {fixture,memory}=require('./helpers/payment-fixture');
const merchant={id:'simple-refund-owner',merchant:true},buyer={id:'simple-refund-buyer'};
async function http(store,options={}){
 const auth={token:()=> 'test',identity:req=>req.headers.authorization==='Bearer buyer'?buyer:merchant};
 const server=createServer(store,{auth,...options});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {async post(action,input,actor='merchant'){const r=await fetch('http://127.0.0.1:'+server.address().port+'/api',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+actor},body:JSON.stringify({action,input})});return {status:r.status,...await r.json()};},close:()=>new Promise(r=>server.close(r))};
}
async function request(store,order,actor=buyer,type='REFUND_ONLY'){
 const r=await store.execute(actor,'refundRequest',{id:order.id,type,reason:'申请退款'},{mock:true});return {id:r.id,caseId:r.refund.caseId,simple:true,approve:true};
}
async function localOrder(store,type='DINE_IN'){
 const input={key:'simple-refund-'+type,fulfillment:type,contact:{name:'测试',phone:'13800000000'},lines:[{productId:'toy',skuId:'toy-1',qty:1}]};
 if(type==='DELIVERY')input.addressId=(await store.execute(buyer,'saveAddress',{name:'测试',phone:'13800000000',detail:'测试街道 1 号'})).id;
 const o=await store.execute(buyer,'createOrder',input,{mock:true});await store.execute(buyer,'mockPay',{id:o.id},{mock:true});return o;
}

test('仅退款：商家一个同意请求完成退款，重复点击不重复入库，买家不能审批',async()=>{
 const store=memory(),o=await localOrder(store),input=await request(store,o),web=await http(store);
 try{
  const denied=await web.post('refundReview',input,'buyer');assert.equal(denied.status,403);
  const done=await web.post('refundReview',input);assert.equal(done.status,200,JSON.stringify(done));assert.equal(done.data.status,'REFUNDED');assert.equal(done.data.refund.review.note,'商家同意退款');
  const again=await web.post('refundReview',input);assert.equal(again.data.status,'REFUNDED');assert.equal(store.state().stockMovements.length,1);assert.equal(store.state().products[1].skus[0].stock,29);
 }finally{await web.close();}
});

test('不同意无需填写表单；不可改写已提交的决定，旧售后单不能审批新申请',async()=>{
 const store=memory(),o=await localOrder(store),input=await request(store,o),web=await http(store);
 try{
  const refused=await web.post('refundReview',{...input,approve:false});assert.equal(refused.data.status,'PAID');assert.equal(refused.data.refund.stage,'REJECTED');
  assert.equal((await web.post('refundReview',input)).status,400);
  const next=await request(store,o);assert.notEqual(next.caseId,input.caseId);assert.equal((await web.post('refundReview',input)).status,400);assert.equal((await web.post('refundReview',next)).data.status,'REFUNDED');
 }finally{await web.close();}
});

test('退货退款：同意后给出门店地址，寄回前不能退款，收齐确认一次完成退款',async()=>{
 const store=memory();let settings=await store.execute(merchant,'shopSettings',{},{});settings.store.phone='010-12345678';await store.execute(merchant,'saveShopSettings',settings,{});
 const o=await localOrder(store,'DELIVERY');await store.execute(merchant,'ship',{id:o.id,carrier:'shunfeng',number:'SHIP123456'},{mock:true});
 const input=await request(store,o,buyer,'RETURN_REFUND'),web=await http(store);
 try{
  const agreed=await web.post('refundReview',input);assert.equal(agreed.status,200,JSON.stringify(agreed));assert.equal(agreed.data.refund.stage,'WAIT_RETURN');assert.equal(agreed.data.refund.returnAddress.phone,'010-12345678');assert.equal(agreed.data.status,'REFUNDING');
  assert.equal((await web.post('returnInspect',{id:o.id,caseId:input.caseId,simple:true})).status,400);
  await store.execute(buyer,'returnShip',{id:o.id,caseId:input.caseId,company:'顺丰',number:'RETURN123456'},{mock:true});
  const done=await web.post('returnInspect',{id:o.id,caseId:input.caseId,simple:true});assert.equal(done.status,200,JSON.stringify(done));assert.equal(done.data.status,'REFUNDED');
  const again=await web.post('returnInspect',{id:o.id,caseId:input.caseId,simple:true});assert.equal(again.data.status,'REFUNDED');assert.equal(store.state().stockMovements.length,1);assert.equal(store.state().products[1].skus[0].stock,29);
 }finally{await web.close();}
});

async function paidWechat(){const f=await fixture();const gateway=f.gateway(),pay=await gateway.createPayment(f.actor,{id:f.order.id},{});f.remote.get(pay.outTradeNo).state='SUCCESS';await gateway.syncPayment(f.actor,{id:f.order.id},{});return f;}

test('微信仅退款通过同意按钮提交真实网关契约，重复请求不再创建退款单（微信使用替身）',async()=>{
 const f=await paidWechat(),input=await request(f.store,f.order,f.actor),web=await http(f.store,{wechat:{...f.settings,now:f.now},fetch:f.fetch});
 try{
  const done=await web.post('refundReview',input);assert.equal(done.status,200,JSON.stringify(done));assert.equal(done.data.status,'REFUNDED');assert.equal(done.data.refund.provider,'WECHAT');
  const count=f.calls.filter(c=>c.action==='refund').length;assert.equal(count,1);assert.equal((await web.post('refundReview',input)).data.status,'REFUNDED');assert.equal(f.calls.filter(c=>c.action==='refund').length,count);
 }finally{await web.close();}
});

test('微信退款提交失败保留已审核申请，原按钮重试复用退款单号，不再次扣减或回补库存',async()=>{
 const f=await paidWechat(),input=await request(f.store,f.order,f.actor),web=await http(f.store,{wechat:{...f.settings,now:f.now},fetch:f.fetch});f.behavior.refundFailure=true;
 try{
  assert.equal((await web.post('refundReview',input)).status,400);assert.equal(f.store.state().orders[0].refund.stage,'WAIT_REFUND');assert.equal(f.store.state().orders[0].refund.review.simple,true);
  f.behavior.refundFailure=false;const done=await web.post('refundReview',input);assert.equal(done.data.status,'REFUNDED');const requests=f.calls.filter(c=>c.action==='refund');assert.equal(new Set(requests.map(c=>c.body.out_refund_no)).size,1);assert.equal(f.store.state().stockMovements.length,1);
 }finally{await web.close();}
});

test('会员余额付款同意后自动退回余额一次；充值余额不足时阻止审核且不改变账本',async()=>{
 const store=memory(),settings=await store.execute(merchant,'shopSettings',{},{});settings.store.phone='13800000000';settings.membership.enabled=true;await store.execute(merchant,'saveShopSettings',settings,{});
 const topup=await store.execute(buyer,'createRecharge',{key:'simple-wallet-topup',amount:10000,custom:true},{});await store.settlePayment({eventId:'wallet-event',transactionId:'wallet-tx',orderId:topup.id,amount:10000,currency:'CNY'});
 const o=await store.execute(buyer,'createOrder',{key:'simple-wallet-goods',fulfillment:'DINE_IN',contact:{name:'顾客',phone:'13800000000'},lines:[{productId:'toy',skuId:'toy-1',qty:1}]},{});await store.execute(buyer,'balancePay',{id:o.id},{});
 const topupInput=await request(store,topup),web=await http(store);
 try{
  assert.equal((await web.post('refundReview',topupInput)).status,400);assert.equal((await store.execute(buyer,'membership',{},{})).balance,8100);assert.equal((await store.execute(buyer,'order',{id:topup.id},{})).refund.stage,'REQUESTED');
  const input=await request(store,o);assert.equal((await web.post('refundReview',input)).data.refund.provider,'BALANCE');await web.post('refundReview',input);assert.equal((await store.execute(buyer,'membership',{},{})).balance,10000);
 }finally{await web.close();}
});

test('未配置微信退款时不先审批或冻结充值余额',async()=>{
 const f=await paidWechat(),input=await request(f.store,f.order,f.actor),web=await http(f.store);
 try{const result=await web.post('refundReview',input);assert.equal(result.status,400);assert.equal(result.error,'REAL_PAYMENT_NOT_CONFIGURED');const saved=f.store.state().orders[0];assert.equal(saved.status,'REFUND_REQUESTED');assert.equal(saved.refund.review,undefined);}finally{await web.close();}
});

test('微信退货退款完整链路：同意寄回、填运单、收齐确认，自动发起原路退款（网关替身）',async()=>{
 const f=await paidWechat(),settings=await f.store.execute(merchant,'shopSettings',{},{});settings.store.phone='13800000000';await f.store.execute(merchant,'saveShopSettings',settings,{});
 // A pickup order can also use the existing API to return physical goods.
 await f.store.execute(merchant,'pickupComplete',{id:f.order.id,confirm:true},{mock:true});
 const input=await request(f.store,f.order,f.actor,'RETURN_REFUND'),web=await http(f.store,{wechat:{...f.settings,now:f.now},fetch:f.fetch});
 try{
  const agreed=await web.post('refundReview',input);assert.equal(agreed.data.refund.stage,'WAIT_RETURN');assert.equal(f.calls.filter(c=>c.action==='refund').length,0);
  await f.store.execute(f.actor,'returnShip',{id:f.order.id,caseId:input.caseId,company:'顺丰',number:'RETURN789123'},{mock:false});
  const result=await web.post('returnInspect',{id:f.order.id,caseId:input.caseId,simple:true});assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.status,'REFUNDED');assert.equal(result.data.refund.provider,'WECHAT');assert.equal(f.calls.filter(c=>c.action==='refund').length,1);
 }finally{await web.close();}
});

test('微信充值退款：同意后扣回到账余额并自动原路退款，重复点击不再扣回（网关替身）',async()=>{
 const f=await fixture(),settings=await f.store.execute(merchant,'shopSettings',{},{});settings.store.phone='13800000000';settings.membership.enabled=true;await f.store.execute(merchant,'saveShopSettings',settings,{});
 const topup=await f.store.execute(f.actor,'createRecharge',{key:'simple-real-topup',amount:f.order.total,custom:true},{}),gateway=f.gateway();
 const pay=await gateway.createPayment(f.actor,{id:topup.id},{});f.remote.get(pay.outTradeNo).state='SUCCESS';await gateway.syncPayment(f.actor,{id:topup.id},{});
 assert.equal((await f.store.execute(f.actor,'membership',{},{})).balance,topup.total);
 const input=await request(f.store,topup,f.actor),web=await http(f.store,{wechat:{...f.settings,now:f.now},fetch:f.fetch});
 try{const result=await web.post('refundReview',input);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.status,'REFUNDED');await web.post('refundReview',input);assert.equal((await f.store.execute(f.actor,'membership',{},{})).balance,0);assert.equal(f.calls.filter(c=>c.action==='refund').length,1);}finally{await web.close();}
});
