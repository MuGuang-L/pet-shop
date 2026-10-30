const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createServer}=require('../server/http');
const {Auth,createAccount}=require('../server/auth');
const {decryptResource,verify}=require('../server/wechat-crypto');
const domain=require('../cloudfunctions/shop/domain');

const apiV3Key='12345678901234567890123456789012';
const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const privatePem=privateKey.export({type:'pkcs8',format:'pem'});
const publicPem=publicKey.export({type:'spki',format:'pem'});

function encrypt(plain,nonce='nonce-012345',associated='transaction'){
  const cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(apiV3Key),Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associated));
  return Buffer.concat([cipher.update(plain),cipher.final(),cipher.getAuthTag()]).toString('base64');
}
function memory(){
  let state=domain.seed();
  return {state:()=>state,db:{command:async()=>({ok:1})},async execute(actor,action,input,options){const out=domain.execute(state,actor,action,input,options);state=out.state;return out.result;},async settlePayment(payload,now){const out=domain.settleVerifiedPayment(state,payload,now);state=out.state;return out.result;},async settleRefund(payload,now){const out=domain.settleVerifiedRefund(state,payload,now);state=out.state;return out.result;}};
}
function settings(now){
  return {payReady:true,oauthReady:true,payNotifyUrl:'https://shop.example.com/wechat/pay/notify',refundNotifyUrl:'https://shop.example.com/wechat/refund/notify',config:{appId:'wx-test-app',appSecret:'secret',mchId:'1900000001',mchSerial:'SERIALTEST',apiV3Key,privateKey:privatePem,platformPublicKey:publicPem,platformPublicKeyId:'PUB_KEY_ID_TEST',publicOrigin:'https://shop.example.com'},now};
}
const buyerHeaders={'x-wx-openid':'openid-buyer','x-wx-source':'wx_client','x-wx-appid':'wx-test-app'};
async function boot(now=Date.now()){
  const store=memory();
  const auth=new Auth([createAccount('owner','owner-test-password','merchant','owner')]);
  const calls=[];
  const fetchImpl=async(url,options={})=>{calls.push({url,options});if(String(url).includes('oauth2/access_token'))return {ok:true,json:async()=>({openid:'openid-buyer'})};const body=JSON.parse(options.body||'{}');return {ok:true,status:200,text:async()=>JSON.stringify(String(url).includes('/refunds')?{status:'SUCCESS',refund_id:'refund-1',amount:{refund:body.amount?.refund||4700,currency:'CNY'}}:{prepay_id:'prepay-1'})};};
  const server=createServer(store,{auth,publicOrigin:'https://shop.example.com',wechat:settings(now),fetch:fetchImpl});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const post=async(url,body,token,headers={})=>{const response=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},body:JSON.stringify(body)});return {status:response.status,body:await response.json(),headers:response.headers};};
  return {store,auth,server,base,post,calls,close:()=>new Promise(resolve=>server.close(resolve))};
}

test('未配置时支付动作和回调保持关闭',async()=>{const store=memory();const auth=new Auth([createAccount('alice','buyer-test-password','buyer','alice')]);const server=createServer(store,{auth});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;try{const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'alice',password:'buyer-test-password'})});const token=(await login.json()).data.token;const address=await fetch(base+'/api',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'saveAddress',input:{name:'样例',phone:'13800000000',detail:'样例街道 1 号'}})});const addressId=(await address.json()).data.id;const order=await fetch(base+'/api',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'createOrder',input:{key:'unconfigured1',addressId,lines:[{productId:'food',skuId:'food-1',qty:1}]}})});const id=(await order.json()).data.id;const pay=await fetch(base+'/api',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'payment',input:{id}})});assert.equal((await pay.json()).error,'REAL_PAYMENT_NOT_CONFIGURED');const notify=await fetch(base+'/wechat/pay/notify',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(notify.status,503);assert.equal((await fetch(base+'/shop/')).status,404);}finally{await new Promise(resolve=>server.close(resolve));}});

test('小程序身份可以拉起 JSAPI 支付，回调入账且重复通知幂等',async()=>{const now=Date.now();const fx=await boot(()=>now);try{
  const forged=await fx.post('/auth/me',{},undefined,{'x-wx-openid':'openid-buyer'});assert.equal(forged.status,401);
  const me=await fx.post('/auth/me',{},undefined,buyerHeaders);assert.equal(me.body.data.openid,'openid-buyer');assert.equal(me.body.data.channel,'wechat');
  const address=await fx.post('/api',{action:'saveAddress',input:{name:'微信买家',phone:'13800000000',detail:'样例街道 8 号'}},undefined,buyerHeaders);
  const order=await fx.post('/api',{action:'createOrder',input:{key:'wechat-pay-1',addressId:address.body.data.id,lines:[{productId:'food',skuId:'food-1',qty:1}]}},undefined,buyerHeaders);
  const pay=await fx.post('/api',{action:'payment',input:{id:order.body.data.id}},undefined,buyerHeaders);
  assert.equal(pay.body.data.wechat.package,'prepay_id=prepay-1');assert.equal(pay.body.data.order.status,'PENDING');
  assert.equal(verify(publicPem,`${pay.body.data.wechat.appId}\n${pay.body.data.wechat.timeStamp}\n${pay.body.data.wechat.nonceStr}\n${pay.body.data.wechat.package}\n`,pay.body.data.wechat.paySign),true);
  const resource={appid:'wx-test-app',mchid:'1900000001',out_trade_no:pay.body.data.outTradeNo,transaction_id:'tx-real-1',trade_state:'SUCCESS',attach:order.body.data.id,payer:{openid:'openid-buyer'},amount:{total:4700,currency:'CNY'}};
  const raw=JSON.stringify({id:'evt-real-1',event_type:'TRANSACTION.SUCCESS',resource:{algorithm:'AEAD_AES_256_GCM',nonce:'nonce-012345',associated_data:'transaction',ciphertext:encrypt(JSON.stringify(resource))}});
  const timestamp=Math.floor(now/1000).toString(),nonce='notify-nonce';
  const signature=crypto.createSign('RSA-SHA256').update(`${timestamp}\n${nonce}\n${raw}\n`).sign(privatePem,'base64');
  const headers={'Content-Type':'application/json','Wechatpay-Timestamp':timestamp,'Wechatpay-Nonce':nonce,'Wechatpay-Signature':signature,'Wechatpay-Serial':'PUB_KEY_ID_TEST'};
  const notify=await fetch(fx.base+'/wechat/pay/notify',{method:'POST',headers,body:raw});assert.equal(notify.status,200);assert.equal(fx.store.state().orders[0].status,'PAID');assert.equal(fx.store.state().orders[0].payment.transactionId,'tx-real-1');assert.equal(fx.store.state().products[0].skus[0].stock,19);
  const again=await fetch(fx.base+'/wechat/pay/notify',{method:'POST',headers,body:raw});assert.equal(again.status,200);assert.equal(fx.store.state().orders.filter(item=>item.status==='PAID').length,1);
  const bad=await fetch(fx.base+'/wechat/pay/notify',{method:'POST',headers:{...headers,'Wechatpay-Signature':'bad'},body:raw});assert.equal(bad.status,401);assert.equal(fx.store.state().orders[0].status,'PAID');
}finally{await fx.close();}});

test('关闭后的到账不复活订单，并自动退款',async()=>{let clock=Date.now();const fx=await boot(()=>clock);try{
  const address=await fx.post('/api',{action:'saveAddress',input:{name:'微信买家',phone:'13800000000',detail:'样例街道 8 号'}},undefined,buyerHeaders);
  const order=await fx.post('/api',{action:'createOrder',input:{key:'late-wechat-1',addressId:address.body.data.id,lines:[{productId:'food',skuId:'food-1',qty:1}]}},undefined,buyerHeaders);
  const pay=await fx.post('/api',{action:'payment',input:{id:order.body.data.id}},undefined,buyerHeaders);
  assert.equal(pay.status,200);
  clock+=16*60*1000;
  const resource={appid:'wx-test-app',mchid:'1900000001',out_trade_no:pay.body.data.outTradeNo,transaction_id:'tx-late-1',trade_state:'SUCCESS',attach:order.body.data.id,payer:{openid:'openid-buyer'},amount:{total:order.body.data.total,currency:'CNY'}};
  const raw=JSON.stringify({id:'evt-late-1',event_type:'TRANSACTION.SUCCESS',resource:{algorithm:'AEAD_AES_256_GCM',nonce:'nonce-012345',associated_data:'transaction',ciphertext:encrypt(JSON.stringify(resource))}});
  const timestamp=Math.floor(clock/1000).toString(),nonce='late-nonce',signature=crypto.createSign('RSA-SHA256').update(`${timestamp}\n${nonce}\n${raw}\n`).sign(privatePem,'base64');
  const notify=await fetch(fx.base+'/wechat/pay/notify',{method:'POST',headers:{'Content-Type':'application/json','Wechatpay-Timestamp':timestamp,'Wechatpay-Nonce':nonce,'Wechatpay-Signature':signature,'Wechatpay-Serial':'PUB_KEY_ID_TEST'},body:raw});
  assert.equal(notify.status,200);assert.equal(fx.store.state().orders[0].status,'REFUNDED');assert.equal(fx.store.state().orders[0].refund.latePayment,true);assert.equal(fx.store.state().products[0].skus[0].stock,20);
}finally{await fx.close();}});

test('未发货微信退款成功后释放库存，重复退款不重复入库',()=>{let state=domain.seed();const buyer={id:'a',merchant:false},merchant={id:'m',merchant:true};const run=(actor,action,input,options)=>domain.execute(state,actor,action,input,{mock:true,now:1000,...options});const address=run(buyer,'saveAddress',{name:'样例',phone:'13800000000',detail:'样例街道 1 号'}).result;state=run(buyer,'saveAddress',{name:'样例',phone:'13800000000',detail:'样例街道 1 号'}).state;const order=domain.execute(state,buyer,'createOrder',{key:'refund-wechat-1',addressId:address.id,lines:[{productId:'food',skuId:'food-1',qty:1}]},{mock:true,now:1000});state=order.state;state=domain.execute(state,buyer,'mockPay',{id:order.result.id},{mock:true,now:1000}).state;state.orders[0].payment={provider:'WECHAT',transactionId:'tx-refund',amount:state.orders[0].total,outTradeNo:'P1234567890abcdef1234567'};const requested=domain.execute(state,buyer,'refundRequest',{id:order.result.id,reason:'不想要了',type:'REFUND_ONLY'},{mock:true,now:1000});state=requested.state;state=domain.execute(state,merchant,'refundReview',{id:order.result.id,caseId:requested.result.refund.caseId,approve:true,note:'同意退款'},{mock:true,now:1000}).state;const paid=domain.settleVerifiedRefund(state,{eventId:'refund-evt',refundId:'refund-1',orderId:order.result.id,amount:state.orders[0].total,currency:'CNY'},1000);assert.equal(paid.result.status,'REFUNDED');assert.equal(paid.state.products[0].skus[0].stock,20);const again=domain.settleVerifiedRefund(paid.state,{eventId:'refund-evt-2',refundId:'refund-1',orderId:order.result.id,amount:state.orders[0].total,currency:'CNY'},1000);assert.equal(again.result.status,'REFUNDED');assert.equal(again.state.products[0].skus[0].stock,20);assert.throws(()=>domain.settleVerifiedRefund(paid.state,{eventId:'refund-evt',refundId:'other',orderId:order.result.id,amount:state.orders[0].total,currency:'CNY'},1000),/REFUND_EVENT_CONFLICT/);});
