'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createV3,missingV3}=require('../server/wechat-v3');
const {sign,verify}=require('../server/wechat-crypto');
const {createWechat}=require('../server/wechat');
const {fixture}=require('./helpers/payment-fixture');
const keys=()=>crypto.generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const merchant=keys(),platform=keys();
const config={payMode:'direct',appId:'wx0123456789abcdef',mchId:'1900000001',mchSerial:'ABC123',privateKey:merchant.privateKey,platformPublicKeyId:'PUB_KEY_ID_TEST',platformPublicKey:platform.publicKey,apiV3Key:'0123456789abcdef0123456789abcdef',publicOrigin:'https://shop.example.test'};
function signed(body,{status=200,timestamp=String(Math.floor(Date.now()/1000)),serial=config.platformPublicKeyId}={}){
 const nonce='test-nonce';const headers=new Headers({'wechatpay-timestamp':timestamp,'wechatpay-nonce':nonce,'wechatpay-serial':serial,'wechatpay-signature':sign(platform.privateKey,`${timestamp}\n${nonce}\n${body}\n`)});
 return {ok:status>=200&&status<300,status,headers,text:async()=>body};
}
async function setup(store){
 const f=await fixture(store),remote=new Map(),calls=[];let timeoutOnce=false,refundState='PROCESSING';
 const settings={payReady:true,config};
 const fetch=async(url,options)=>{
  if(url.startsWith('http://api.weixin.qq.com/_/pay/'))return f.fetch(url,options);
  const u=new URL(url),body=options.body||'',data=JSON.parse(body||'{}');calls.push({path:u.pathname,method:options.method,data});
  const fields=Object.fromEntries([...options.headers.Authorization.matchAll(/(\w+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
  assert.equal(fields.mchid,config.mchId);assert.equal(fields.serial_no,config.mchSerial);
  assert.equal(options.headers['Wechatpay-Serial'],config.platformPublicKeyId);
  assert.ok(verify(merchant.publicKey,`${options.method}\n${u.pathname+u.search}\n${fields.timestamp}\n${fields.nonce_str}\n${body}\n`,fields.signature));
  if(u.pathname==='/v3/pay/transactions/jsapi'){
   assert.equal(data.appid,config.appId);assert.equal(data.notify_url,config.publicOrigin+'/wechat/pay/v3/notify');
   if(!remote.has(data.out_trade_no))remote.set(data.out_trade_no,{...data,state:'NOTPAY'});
   if(timeoutOnce){timeoutOnce=false;throw Error('ETIMEDOUT');}
   return signed(JSON.stringify({prepay_id:'prepay-'+data.out_trade_no}));
  }
  if(u.pathname.startsWith('/v3/pay/transactions/out-trade-no/')){
   const id=u.pathname.split('/')[5],row=remote.get(id);
   if(!row)return signed(JSON.stringify({code:'ORDER_NOT_EXIST'}),{status:404});
   if(u.pathname.endsWith('/close')){row.state='CLOSED';return signed('',{status:204});}
   return signed(JSON.stringify({appid:config.appId,mchid:config.mchId,out_trade_no:id,transaction_id:'tx-'+id,trade_state:row.state,amount:row.amount,payer:row.payer}));
  }
  if(u.pathname==='/v3/refund/domestic/refunds'){
   const row=remote.get(data.out_trade_no);row.refund=data;
   assert.equal(data.notify_url,config.publicOrigin+'/wechat/refund/v3/notify');
   return signed(JSON.stringify({...data,refund_id:'r-'+data.out_refund_no,status:refundState}));
  }
  if(u.pathname.startsWith('/v3/refund/domestic/refunds/')){
   const id=u.pathname.split('/').at(-1),row=[...remote.values()].find(r=>r.refund?.out_refund_no===id);
   return signed(JSON.stringify({...row.refund,refund_id:'r-'+id,status:refundState}));
  }
  throw Error('UNEXPECTED_REQUEST');
 };
 const gateway=other=>createWechat({settings,store:other||f.store,fetch});
 return {...f,settings,fetch,gateway,remote,calls,timeout:()=>timeoutOnce=true,refundSuccess:()=>refundState='SUCCESS'};
}
function notify(data,kind='payment'){
 const nonce='123456789012',associated='transaction';
 const cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(config.apiV3Key),Buffer.from(nonce));cipher.setAAD(Buffer.from(associated));
 const ciphertext=Buffer.concat([cipher.update(JSON.stringify(data)),cipher.final(),cipher.getAuthTag()]).toString('base64');
 const raw=JSON.stringify({id:'event-test',event_type:kind==='payment'?'TRANSACTION.SUCCESS':'REFUND.SUCCESS',resource:{algorithm:'AEAD_AES_256_GCM',nonce,associated_data:associated,ciphertext}});
 return {raw,headers:signed(raw).headers};
}
test('直连配置缺失或密钥格式错误时关闭真实支付',()=>{
 assert.deepEqual(missingV3(config),[]);
 for(const field of ['appId','mchId','mchSerial','privateKey','platformPublicKey','platformPublicKeyId','apiV3Key','publicOrigin'])assert.ok(missingV3({...config,[field]:''}).includes(field));
 assert.ok(missingV3({...config,publicOrigin:'http://shop.example.test'}).includes('publicOrigin'));
});
test('直连下单签名、RSA收银台参数与超时重试保持同一交易号',async()=>{
 const f=await setup();f.timeout();await assert.rejects(f.gateway().createPayment(f.actor,{id:f.order.id},{}),/ETIMEDOUT/);
 const results=await Promise.all([f.gateway().createPayment(f.actor,{id:f.order.id},{}),f.gateway().createPayment(f.actor,{id:f.order.id},{})]);
 assert.equal(f.remote.size,1);assert.equal(results[0].outTradeNo,results[1].outTradeNo);
 const p=results[0].wechat;assert.equal(p.signType,'RSA');assert.ok(verify(merchant.publicKey,`${config.appId}\n${p.timeStamp}\n${p.nonceStr}\n${p.package}\n`,p.paySign));
 assert.equal((await f.store.getTrade(results[0].outTradeNo)).transport,'direct');
});
test('响应验签拒绝被改写的报文、错误公钥ID和过期签名',async()=>{
 for(const mode of ['tamper','serial','expired']){
  const response=signed('{"prepay_id":"good"}',{...(mode==='serial'?{serial:'PUB_KEY_ID_OTHER'}:{}),...(mode==='expired'?{timestamp:'1'}:{})});
  if(mode==='tamper')response.text=async()=>'{"prepay_id":"changed"}';
  const client=createV3({config,fetch:async()=>response});
  await assert.rejects(client.call('unifiedOrder',{sub_mch_id:config.mchId,out_trade_no:'Ptest',body:'test',total_fee:1,openid:'test'}),/WECHAT_(SIGNATURE|PUBLIC_KEY_ID|TIMESTAMP)/);
 }
});
test('直连查单校验应用、商户、订单和币种，错误金额不能入账',async()=>{
 const good={appid:config.appId,mchid:config.mchId,out_trade_no:'Ptest',trade_state:'SUCCESS',transaction_id:'tx',amount:{total:1,currency:'CNY'},payer:{openid:'test'}};
 for(const override of [{appid:'wxother'},{mchid:'other'},{out_trade_no:'other'},{amount:{total:1,currency:'USD'}}]){
  const client=createV3({config,fetch:async()=>signed(JSON.stringify({...good,...override}))});
  await assert.rejects(client.call('queryorder',{out_trade_no:'Ptest',sub_mch_id:config.mchId}),/WECHAT_.*MISMATCH/);
 }
 const f=await setup(),pay=await f.gateway().createPayment(f.actor,{id:f.order.id},{});const row=f.remote.get(pay.outTradeNo);row.state='SUCCESS';row.amount.total++;
 await assert.rejects(f.gateway().syncPayment(f.actor,{id:f.order.id}),/WECHAT_AMOUNT_MISMATCH/);assert.equal(f.store.state().orders[0].status,'PENDING');
});
test('切换默认模式后旧云托管交易仍按原通道查单',async()=>{
 const f=await setup();const old=createWechat({settings:{payReady:true,config:{mchId:'test-merchant',cloudEnv:'test-env',cloudService:'pet-shop'}},store:f.store,fetch:f.fetch,now:f.now});
 const pay=await old.createPayment(f.actor,{id:f.order.id},{});
 // A persisted old record has no transport field and must not be converted.
 const record=await f.store.getTrade(pay.outTradeNo);delete record.transport;f.store.trades.set(record.outTradeNo,record);
 await f.gateway().syncPayment(f.actor,{id:f.order.id});assert.equal(f.calls.length,0);
});
test('已签名加密通知验真后入账，伪造通知不查单，重复通知不重复扣库存',async()=>{
 const f=await setup(),pay=await f.gateway().createPayment(f.actor,{id:f.order.id},{});f.remote.get(pay.outTradeNo).state='SUCCESS';
 const {createServer}=require('../server/http'),{Auth}=require('../server/auth');
 const server=createServer(f.store,{auth:new Auth([]),wechat:f.settings,fetch:f.fetch});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const packet=notify({appid:config.appId,mchid:config.mchId,out_trade_no:pay.outTradeNo,trade_state:'SUCCESS',amount:{total:f.order.total,currency:'CNY'},payer:{openid:f.actor.openid}});
  const url='http://127.0.0.1:'+server.address().port+'/wechat/pay/v3/notify';const before=f.calls.length;
  assert.equal((await fetch(url,{method:'POST',headers:packet.headers,body:packet.raw+' '})).status,500);assert.equal(f.calls.length,before);
  for(let i=0;i<2;i++){const r=await fetch(url,{method:'POST',headers:packet.headers,body:packet.raw});assert.equal(r.status,200);assert.equal((await r.json()).code,'SUCCESS');}
  assert.equal(f.store.state().orders[0].status,'PAID');assert.equal(f.store.state().products[0].skus[0].stock,19);
 }finally{await new Promise(r=>server.close(r));}
});
test('直连取消后到账自动退款，PROCESSING不算退款成功，退款通知可重复',async()=>{
 const f=await setup(),pay=await f.gateway().createPayment(f.actor,{id:f.order.id},{});await f.store.execute(f.actor,'cancel',{id:f.order.id});f.remote.get(pay.outTradeNo).state='SUCCESS';
 await f.gateway().syncPayment(f.actor,{id:f.order.id});assert.equal(f.store.state().orders[0].status,'REFUNDING');assert.equal(f.store.state().products[0].skus[0].stock,20);
 const trade=await f.store.getTrade(pay.outTradeNo);f.refundSuccess();
 const packet=notify({mchid:config.mchId,out_trade_no:pay.outTradeNo,out_refund_no:trade.outRefundNo,refund_status:'SUCCESS',refund_id:'r-'+trade.outRefundNo,amount:{refund:f.order.total,total:f.order.total,payer_total:f.order.total,payer_refund:f.order.total}},'refund');
 const {createServer}=require('../server/http'),{Auth}=require('../server/auth');const server=createServer(f.store,{auth:new Auth([]),wechat:f.settings,fetch:f.fetch});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{for(let i=0;i<2;i++)assert.equal((await fetch('http://127.0.0.1:'+server.address().port+'/wechat/refund/v3/notify',{method:'POST',headers:packet.headers,body:packet.raw})).status,200);
  assert.equal(f.store.state().orders[0].status,'REFUNDED');assert.equal(f.store.state().products[0].skus[0].stock,20);
 }finally{await new Promise(r=>server.close(r));}
});
test('无付款的直连订单取消后关单，204应答也验签',async()=>{
 const f=await setup(),pay=await f.gateway().createPayment(f.actor,{id:f.order.id},{});await f.store.execute(f.actor,'cancel',{id:f.order.id});
 await f.gateway().syncPayment(f.actor,{id:f.order.id});assert.equal((await f.store.getTrade(pay.outTradeNo)).status,'CLOSED');
 assert.ok(f.calls.some(c=>c.path.endsWith('/close')));
});
test('只读诊断仅查询随机不存在订单，不创建支付',async()=>{
 const f=await setup(),result=await require('../scripts/verify-wechat-v3').probe(config,f.fetch);
 assert.equal(result.authenticationVerified,true);assert.equal(f.remote.size,0);assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,'GET');
});
test('真实公钥签名也不能掩盖错误的通知解密密钥或错误商户',()=>{
 const data={appid:config.appId,mchid:config.mchId,out_trade_no:'Ptest',trade_state:'SUCCESS',amount:{total:1,currency:'CNY'},payer:{openid:'test'}};
 const packet=notify(data),client=createV3({config:{...config,apiV3Key:'x'.repeat(32)}});
 assert.throws(()=>client.notification(packet.headers,packet.raw,'payment'));
 const wrong=notify({...data,mchid:'other'});assert.throws(()=>createV3({config}).notification(wrong.headers,wrong.raw,'payment'),/WECHAT_MERCHANT_MISMATCH/);
});
test('密钥配置缺失时商家不能把真实退款降级成模拟退款',async()=>{
 const f=await setup(),pay=await f.gateway().createPayment(f.actor,{id:f.order.id},{});f.remote.get(pay.outTradeNo).state='SUCCESS';await f.gateway().syncPayment(f.actor,{id:f.order.id});
 const request=await f.store.execute(f.actor,'refundRequest',{id:f.order.id,type:'REFUND_ONLY',reason:'test'});
 await f.store.execute({id:'owner',merchant:true},'refundReview',{id:f.order.id,caseId:request.refund.caseId,approve:true,note:'test'});
 const before=f.store.state();
 const {createServer}=require('../server/http'),{Auth,createAccount}=require('../server/auth');const auth=new Auth([createAccount('owner','test-password','merchant','owner')]);const token=(await auth.login('owner','test-password')).token;
 const server=createServer(f.store,{auth,wechat:{...f.settings,payReady:false,payMissing:['apiV3Key']},fetch:f.fetch});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{for(const action of ['mockRefund','refundFail']){
  const r=await fetch('http://127.0.0.1:'+server.address().port+'/api',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action,input:{id:f.order.id,caseId:request.refund.caseId}})});
  assert.equal((await r.json()).error,'REAL_PAYMENT_NOT_CONFIGURED');assert.deepEqual(f.store.state(),before);
 }}finally{await new Promise(r=>server.close(r));}
});
for(const engine of ['mysql','mongo'])test('真实 '+engine+'：直连通道持久化、并发重试和退款恢复',{skip:process.env['PET_'+engine.toUpperCase()+'_TEST']!=='1'},async()=>{
 const database='pet_shop_v3_test_'+crypto.randomUUID().replaceAll('-','');
 const Store=engine==='mysql'?require('../server/mysql-store').MysqlStore:require('../server/mongo-store').MongoStore;
 const store=await Store.connect({database});let second;
 try{
  second=await Store.connect({database});const f=await setup(store);f.timeout();await assert.rejects(f.gateway().createPayment(f.actor,{id:f.order.id},{}),/ETIMEDOUT/);
  const results=await Promise.all([f.gateway().createPayment(f.actor,{id:f.order.id},{}),f.gateway(second).createPayment(f.actor,{id:f.order.id},{})]);
  assert.equal(results[0].outTradeNo,results[1].outTradeNo);const id=results[0].outTradeNo;assert.equal((await second.getTrade(id)).transport,'direct');
  await store.execute(f.actor,'cancel',{id:f.order.id});f.remote.get(id).state='SUCCESS';await f.gateway(second).syncPayment(f.actor,{id:f.order.id});assert.equal((await store.execute(f.actor,'order',{id:f.order.id})).status,'REFUNDING');
  f.refundSuccess();await f.gateway().syncPayment(f.actor,{id:f.order.id});assert.equal((await second.execute(f.actor,'order',{id:f.order.id})).status,'REFUNDED');assert.equal((await second.execute(f.actor,'catalog'))[0].skus[0].stock,20);
 }finally{
  if(second)await second.close();if(!/^pet_shop_v3_test_[a-f0-9]{32}$/.test(database))throw Error('TEST_DATABASE_NAME');
  if(engine==='mysql')await store.query('DROP DATABASE `'+database+'`');else await store.db.dropDatabase();await store.close();
 }
});
