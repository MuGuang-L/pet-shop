const test=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('../server/http');
const {Auth,createAccount}=require('../server/auth');
const domain=require('../cloudfunctions/shop/domain');

function memory(){
  let state=domain.seed();
  return {state:()=>state,db:{command:async()=>({ok:1})},async execute(actor,action,input,options){const out=domain.execute(state,actor,action,input,options);state=out.state;return out.result;},async settlePayment(payload,now){const out=domain.settleVerifiedPayment(state,payload,now);state=out.state;return out.result;},async settleRefund(payload,now){const out=domain.settleVerifiedRefund(state,payload,now);state=out.state;return out.result;}};
}
function settings(now){
  return {payReady:true,config:{mchId:'1900000001',cloudEnv:'prod-test',cloudService:'pet-shop'},now};
}
const buyerHeaders={'x-wx-openid':'openid-buyer','x-wx-source':'wx_client','x-wx-appid':'wx-test-app','x-wx-env':'prod-test','x-wx-service':'pet-shop','x-forwarded-for':'127.0.0.1'};
test('HTTP 会员充值经微信查单入账，余额付款和会员权限按身份隔离',async()=>{
 const fx=await boot(()=>Date.now());try{
  const merchant={id:'owner',merchant:true};const config=await fx.store.execute(merchant,'shopSettings',{});config.membership.enabled=true;config.store.phone='13800000000';await fx.store.execute(merchant,'saveShopSettings',config);
  const post=(action,input={})=>fx.post('/api',{action,input},undefined,buyerHeaders);
  const made=await post('createRecharge',{key:'http-recharge-01',amount:10000});assert.equal(made.status,200);
  const paid=await post('payment',{id:made.body.data.id});assert.equal(paid.status,200);assert.ok(paid.body.data.wechat);
  assert.equal((await post('membership')).body.data.balance,0);
  assert.equal((await post('paymentSync',{id:made.body.data.id})).body.data.status,'COMPLETED');
  await post('paymentSync',{id:made.body.data.id});assert.equal((await post('membership')).body.data.balance,10000);
  assert.equal((await post('merchantMembers')).status,403);
  const goods=await post('createOrder',{key:'http-wallet-order',fulfillment:'PICKUP',contact:{name:'会员',phone:'13800000000'},lines:[{productId:'toy',skuId:'toy-1',qty:1}]});assert.equal(goods.status,200);
  const result=await post('balancePay',{id:goods.body.data.id});assert.equal(result.body.data.payment.provider,'BALANCE');
  await post('balancePay',{id:goods.body.data.id});assert.equal((await post('membership')).body.data.balance,8100);
  const anonymous=await fx.post('/api',{action:'membership'});assert.equal(anonymous.status,401);
 }finally{await fx.close();}
});
function payText(payload){return {ok:true,status:200,text:async()=>JSON.stringify(payload)};}
async function boot(now=Date.now()){
  const store=memory();
  const auth=new Auth([createAccount('owner','owner-test-password','merchant','owner')]);
  const calls=[];
  let paidFee=0;
  const fetchImpl=async(url,options={})=>{calls.push({url,options});const body=JSON.parse(options.body||'{}');const action=String(url).split('/_/pay/')[1]||'';if(action==='unifiedOrder'){paidFee=body.total_fee;return payText({errcode:0,errmsg:'ok',respdata:{return_code:'SUCCESS',result_code:'SUCCESS',prepay_id:'prepay-1',payment:{timeStamp:'1700000000',nonceStr:'nonce',package:'prepay_id=prepay-1',signType:'MD5',paySign:'pay-sign'}}});}if(action==='queryorder')return payText({errcode:0,errmsg:'ok',respdata:{return_code:'SUCCESS',result_code:'SUCCESS',trade_state:'SUCCESS',transaction_id:'tx-real-1',out_trade_no:body.out_trade_no,total_fee:paidFee,sub_mch_id:body.sub_mch_id,sub_openid:'openid-buyer',fee_type:'CNY'}});if(action==='refund')return payText({errcode:0,errmsg:'ok',respdata:{return_code:'SUCCESS',result_code:'SUCCESS',refund_id:'refund-1',out_refund_no:body.out_refund_no}});if(action==='queryrefund')return payText({errcode:0,errmsg:'ok',respdata:{return_code:'SUCCESS',result_code:'SUCCESS',refund_count:1,out_refund_no_list:[body.out_refund_no],refund_id_list:['refund-1'],refund_fee_list:[paidFee],refund_status_list:['SUCCESS']}});return {ok:false,status:404,text:async()=>'{}'};};
  const server=createServer(store,{auth,publicOrigin:'https://shop.example.com',wechat:settings(now),cloudIdentity:{enabled:true,appId:'wx-test-app'},fetch:fetchImpl});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const post=async(url,body,token,headers={})=>{const response=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},body:JSON.stringify(body)});return {status:response.status,body:await response.json(),headers:response.headers};};
  return {store,auth,server,base,post,calls,close:()=>new Promise(resolve=>server.close(resolve))};
}

test('未配置时支付动作和回调保持关闭',async()=>{const store=memory();const auth=new Auth([createAccount('alice','buyer-test-password','buyer','alice')]);const server=createServer(store,{auth});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;try{const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'alice',password:'buyer-test-password'})});const token=(await login.json()).data.token;const address=await fetch(base+'/api',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'saveAddress',input:{name:'样例',phone:'13800000000',detail:'样例街道 1 号'}})});const addressId=(await address.json()).data.id;const order=await fetch(base+'/api',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'createOrder',input:{key:'unconfigured1',addressId,lines:[{productId:'food',skuId:'food-1',qty:1}]}})});const id=(await order.json()).data.id;const pay=await fetch(base+'/api',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'payment',input:{id}})});assert.equal((await pay.json()).error,'REAL_PAYMENT_NOT_CONFIGURED');const notify=await fetch(base+'/wechat/pay/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(notify.status,503);assert.notEqual((await notify.clone().json()).errcode,0);assert.equal((await fetch(base+'/shop/')).status,404);}finally{await new Promise(resolve=>server.close(resolve));}});

test('小程序身份可以拉起 JSAPI 支付，回调入账且重复通知幂等',async()=>{const now=Date.now();const fx=await boot(()=>now);try{
  const forged=await fx.post('/auth/me',{},undefined,{'x-wx-openid':'openid-buyer'});assert.equal(forged.status,401);
  const me=await fx.post('/auth/me',{},undefined,buyerHeaders);assert.equal(me.body.data.openid,'openid-buyer');assert.equal(me.body.data.channel,'wechat');
  const reused=await fx.post('/auth/me',{},undefined,{'x-wx-from-openid':'openid-reused','x-wx-from-appid':'wx-test-app','x-wx-source':'wx_client'});assert.equal(reused.body.data.openid,'openid-reused');
  const platformSource=await fx.post('/auth/me',{},undefined,{'x-wx-openid':'openid-platform','x-wx-appid':'wx-test-app','x-wx-source':'cloudbase'});assert.equal(platformSource.body.data.openid,'openid-platform');
  const address=await fx.post('/api',{action:'saveAddress',input:{name:'微信买家',phone:'13800000000',detail:'样例街道 8 号'}},undefined,buyerHeaders);
  const order=await fx.post('/api',{action:'createOrder',input:{key:'wechat-pay-1',addressId:address.body.data.id,lines:[{productId:'food',skuId:'food-1',qty:1}]}},undefined,buyerHeaders);
  const pay=await fx.post('/api',{action:'payment',input:{id:order.body.data.id}},undefined,buyerHeaders);
  assert.equal(pay.status,200);assert.equal(pay.body.data.wechat.package,'prepay_id=prepay-1');assert.equal(pay.body.data.wechat.signType,'MD5');assert.equal(pay.body.data.order.status,'PENDING');
  const ordered=JSON.parse(fx.calls.find(call=>String(call.url).endsWith('/_/pay/unifiedOrder')).options.body);
  assert.equal(ordered.sub_mch_id,'1900000001');assert.equal(ordered.openid,'openid-buyer');assert.equal(ordered.callback_type,2);assert.equal(ordered.env_id,'prod-test');assert.deepEqual(ordered.container,{service:'pet-shop',path:'/wechat/pay/notify'});assert.equal(ordered.total_fee,order.body.data.total);
  const raw=JSON.stringify({returnCode:'SUCCESS',resultCode:'SUCCESS',subMchId:'1900000001',subOpenid:'openid-buyer',totalFee:order.body.data.total,transactionId:'tx-real-1',outTradeNo:pay.body.data.outTradeNo});
  const unknown=await fetch(fx.base+'/wechat/pay/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnCode:'SUCCESS',resultCode:'SUCCESS',outTradeNo:'Pdoesnotexist00000000001',totalFee:order.body.data.total,transactionId:'tx-forged'})});
  assert.notEqual((await unknown.json()).errcode,0);assert.equal(fx.store.state().orders[0].status,'PENDING');
  const notify=await fetch(fx.base+'/wechat/pay/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:raw});assert.equal(notify.status,200);assert.equal((await notify.json()).errcode,0);assert.equal(fx.store.state().orders[0].status,'PAID');assert.equal(fx.store.state().orders[0].payment.transactionId,'tx-real-1');assert.equal(fx.store.state().products[0].skus[0].stock,19);
  const again=await fetch(fx.base+'/wechat/pay/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:raw});assert.equal(again.status,200);assert.equal((await again.json()).errcode,0);assert.equal(fx.store.state().orders.filter(item=>item.status==='PAID').length,1);
}finally{await fx.close();}});

test('关闭后的到账不复活订单，并自动退款',async()=>{let clock=Date.now();const fx=await boot(()=>clock);try{
  const address=await fx.post('/api',{action:'saveAddress',input:{name:'微信买家',phone:'13800000000',detail:'样例街道 8 号'}},undefined,buyerHeaders);
  const order=await fx.post('/api',{action:'createOrder',input:{key:'late-wechat-1',addressId:address.body.data.id,lines:[{productId:'food',skuId:'food-1',qty:1}]}},undefined,buyerHeaders);
  const pay=await fx.post('/api',{action:'payment',input:{id:order.body.data.id}},undefined,buyerHeaders);
  assert.equal(pay.status,200);
  clock+=16*60*1000;
  const raw=JSON.stringify({returnCode:'SUCCESS',resultCode:'SUCCESS',subMchId:'1900000001',subOpenid:'openid-buyer',totalFee:order.body.data.total,transactionId:'tx-real-1',outTradeNo:pay.body.data.outTradeNo});
  const notify=await fetch(fx.base+'/wechat/pay/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:raw});
  assert.equal(notify.status,200);assert.equal((await notify.json()).errcode,0);assert.equal(fx.store.state().orders[0].status,'REFUNDED');assert.equal(fx.store.state().orders[0].refund.latePayment,true);assert.equal(fx.store.state().products[0].skus[0].stock,20);
  const refunded=JSON.parse(fx.calls.find(call=>String(call.url).endsWith('/_/pay/refund')).options.body);
  assert.equal(refunded.callback_type,2);assert.equal(refunded.container.path,'/wechat/refund/notify');assert.equal(refunded.sub_mch_id,'1900000001');
}finally{await fx.close();}});

test('未发货微信退款成功后释放库存，重复退款不重复入库',()=>{let state=domain.seed();const buyer={id:'a',merchant:false},merchant={id:'m',merchant:true};const run=(actor,action,input,options)=>domain.execute(state,actor,action,input,{mock:true,now:1000,...options});const address=run(buyer,'saveAddress',{name:'样例',phone:'13800000000',detail:'样例街道 1 号'}).result;state=run(buyer,'saveAddress',{name:'样例',phone:'13800000000',detail:'样例街道 1 号'}).state;const order=domain.execute(state,buyer,'createOrder',{key:'refund-wechat-1',addressId:address.id,lines:[{productId:'food',skuId:'food-1',qty:1}]},{mock:true,now:1000});state=order.state;state=domain.execute(state,buyer,'mockPay',{id:order.result.id},{mock:true,now:1000}).state;state.orders[0].payment={provider:'WECHAT',transactionId:'tx-refund',amount:state.orders[0].total,outTradeNo:'P1234567890abcdef1234567'};const requested=domain.execute(state,buyer,'refundRequest',{id:order.result.id,reason:'不想要了',type:'REFUND_ONLY'},{mock:true,now:1000});state=requested.state;state=domain.execute(state,merchant,'refundReview',{id:order.result.id,caseId:requested.result.refund.caseId,approve:true,note:'同意退款'},{mock:true,now:1000}).state;const paid=domain.settleVerifiedRefund(state,{eventId:'refund-evt',refundId:'refund-1',orderId:order.result.id,amount:state.orders[0].total,currency:'CNY'},1000);assert.equal(paid.result.status,'REFUNDED');assert.equal(paid.state.products[0].skus[0].stock,20);const again=domain.settleVerifiedRefund(paid.state,{eventId:'refund-evt-2',refundId:'refund-1',orderId:order.result.id,amount:state.orders[0].total,currency:'CNY'},1000);assert.equal(again.result.status,'REFUNDED');assert.equal(again.state.products[0].skus[0].stock,20);assert.throws(()=>domain.settleVerifiedRefund(paid.state,{eventId:'refund-evt',refundId:'other',orderId:order.result.id,amount:state.orders[0].total,currency:'CNY'},1000),/REFUND_EVENT_CONFLICT/);});


test('微信订单入口以商户交易号定位本人订单，不泄露支付记录或越权查询',async()=>{
 const fx=await boot(()=>Date.now());try{
  const address=await fx.post('/api',{action:'saveAddress',input:{name:'测试买家',phone:'13800000000',detail:'测试地址 8 号'}},undefined,buyerHeaders);
  const made=await fx.post('/api',{action:'createOrder',input:{key:'order-center-test',addressId:address.body.data.id,lines:[{productId:'food',skuId:'food-1',qty:1}]}},undefined,buyerHeaders);
  const pay=await fx.post('/api',{action:'payment',input:{id:made.body.data.id}},undefined,buyerHeaders);
  assert.equal(pay.status,200,JSON.stringify(pay.body));
  const number=pay.body.data.outTradeNo,request={action:'orderByTradeNo',input:{outTradeNo:number}},calls=fx.calls.length;
  assert.notEqual(number,made.body.data.id);
  const own=await fx.post('/api',request,undefined,buyerHeaders);
  assert.equal(own.status,200);assert.equal(own.body.data.id,made.body.data.id);assert.equal(own.body.data.status,'PENDING');
  for(const key of ['request','openid','prepayId','wechat','paySign','outTradeNo'])assert.equal(own.body.data[key],undefined);
  const other=await fx.post('/api',request,undefined,{...buyerHeaders,'x-wx-openid':'another-buyer'});
  assert.equal(other.body.error,'ORDER_NOT_FOUND');
  for(const value of [made.body.data.id,'Punknown00000000000000000','${商品订单号}',{},null,'x'.repeat(33)]){
   const result=await fx.post('/api',{action:'orderByTradeNo',input:{outTradeNo:value}},undefined,buyerHeaders);
   assert.equal(result.body.error,'ORDER_NOT_FOUND');
  }
  const anonymous=await fx.post('/api',request);assert.equal(anonymous.status,401);
  const login=await fx.post('/auth/login',{username:'owner',password:'owner-test-password'});
  const merchant=await fx.post('/api',request,login.body.data.token);assert.equal(merchant.status,403);
  assert.equal(fx.calls.length,calls,'读取详情不得查支付、扣款或退款');
 }finally{await fx.close();}
});

test('历史订单跳转在停用支付时仍可读，持久化交易映射不依赖进程缓存',async()=>{
 const {createWechat}=require('../server/wechat');let reads=0;
 const gateway=createWechat({settings:{payReady:false},store:{getTrade:async number=>{reads++;return {outTradeNo:number,userId:'wx:buyer',orderId:'o7',payment:{paySign:'private'}};},execute:async(actor,action,input)=>{assert.equal(action,'order');assert.equal(input.id,'o7');return {id:'o7',userId:actor.id,status:'COMPLETED'};}},fetch:()=>{throw Error('unexpected payment request');}});
 assert.equal((await gateway.orderByTradeNo({id:'wx:buyer',channel:'wechat'},{outTradeNo:'Ptest123456'})).id,'o7');assert.equal(reads,1);
 await assert.rejects(gateway.orderByTradeNo({id:'wx:other'},{outTradeNo:'Ptest123456'}),/ORDER_NOT_FOUND/);
});
