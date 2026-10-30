'use strict';
const {authorization,verifyNotify,decryptResource,jsapiParams,tradeNo,clip}=require('./wechat-crypto');

class TradeBook{
  constructor(store){this.store=store||null;this.rows=new Map();}
  database(){const db=this.store?.db;return db&&typeof db.collection==='function'?db:null;}
  async save(doc){
    const stored={...doc,_id:doc.outTradeNo};
    this.rows.set(doc.outTradeNo,stored);
    const db=this.database();
    if(db)await db.collection('wechat_trades').updateOne({_id:doc.outTradeNo},{$set:stored},{upsert:true});
    return stored;
  }
  async get(outTradeNo){
    if(this.rows.has(outTradeNo))return this.rows.get(outTradeNo);
    const db=this.database();
    if(!db)return null;
    const doc=await db.collection('wechat_trades').findOne({_id:outTradeNo});
    if(doc)this.rows.set(outTradeNo,doc);
    return doc;
  }
  async byOrder(orderId){
    const db=this.database();
    if(db){
      const remote=await db.collection('wechat_trades').find({orderId}).toArray();
      for(const doc of remote)this.rows.set(doc.outTradeNo,doc);
    }
    return [...this.rows.values()].filter(row=>row.orderId===orderId);
  }
}

function createWechat({settings,store,auth,fetch:fetchImpl=global.fetch,now=()=>Date.now()}={}){
  const config=settings?.config||{};
  const book=new TradeBook(store);
  const certs=new Map();
  if(config.platformPublicKey)certs.set(config.platformPublicKeyId||'configured',config.platformPublicKey);
  const payReady=()=>settings?.payReady===true;
  const missing=()=>settings?.payReady?[]:(settings?.payMissing||[]);

  async function payRequest(method,urlPath,bodyObj){
    const body=bodyObj?JSON.stringify(bodyObj):'';
    const headers=authorization({mchId:config.mchId,serial:config.mchSerial,privateKey:config.privateKey,method,urlPath,body});
    const response=await fetchImpl('https://api.mch.weixin.qq.com'+urlPath,{method,headers,body:method==='GET'?undefined:body,signal:AbortSignal.timeout(15000)});
    const text=await response.text();
    let json={};
    if(text){try{json=JSON.parse(text);}catch{throw Error('WECHAT_BAD_RESPONSE');}}
    if(!response.ok)throw Error(json.code||('WECHAT_HTTP_'+response.status));
    return json;
  }
  async function platformKey(serial){
    if(serial&&certs.has(serial))return certs.get(serial);
    if(!payReady())throw Error('REAL_PAYMENT_NOT_CONFIGURED');
    const listed=await payRequest('GET','/v3/certificates');
    for(const item of listed.data||[]){
      const pem=decryptResource({apiV3Key:config.apiV3Key,nonce:item.encrypt_certificate.nonce,associatedData:item.encrypt_certificate.associated_data,ciphertext:item.encrypt_certificate.ciphertext});
      if(pem.includes('BEGIN'))certs.set(item.serial_no,pem);
    }
    if(!certs.has(serial))throw Error('WECHAT_PLATFORM_CERT');
    return certs.get(serial);
  }
  async function orderOf(actor,id){
    if(!id||typeof id!=='string')throw Error('ORDER_NOT_FOUND');
    return store.execute(actor,'order',{id},{mock:actor.channel!=='wechat'});
  }
  async function settle(kind,payload){
    if(kind==='payment'&&typeof store.settlePayment==='function')return store.settlePayment(payload,now());
    if(kind==='refund'&&typeof store.settleRefund==='function')return store.settleRefund(payload,now());
    throw Error('STORE_SETTLE_UNSUPPORTED');
  }
  async function createPayment(actor,input){
    if(!payReady())throw Error('REAL_PAYMENT_NOT_CONFIGURED');
    if(!settings.payNotifyUrl)throw Error('PUBLIC_ORIGIN_REQUIRED');
    if(!actor.openid)throw Error('WECHAT_OPENID_REQUIRED');
    if(actor.appid&&actor.appid!==config.appId)throw Error('WECHAT_APPID_MISMATCH');
    const order=await orderOf(actor,input.id);
    if(order.userId!==actor.id)throw Error('FORBIDDEN');
    if(order.status==='PAID')return {order,wechat:null};
    if(order.status!=='PENDING')throw Error('INVALID_STATE');
    const existing=(await book.byOrder(order.id)).find(row=>row.status==='CREATED'&&row.amount===order.total&&row.openid===actor.openid&&now()-row.createdAt<90*60*1000&&row.prepayId);
    let outTradeNo=existing?.outTradeNo,prepayId=existing?.prepayId;
    if(!prepayId){
      outTradeNo=tradeNo('P');
      const created=await payRequest('POST','/v3/pay/transactions/jsapi',{
        appid:config.appId,mchid:config.mchId,description:clip(order.lines.map(line=>line.name).join('、')||'爪爪小铺订单'),
        out_trade_no:outTradeNo,notify_url:settings.payNotifyUrl,attach:order.id,
        amount:{total:order.total,currency:'CNY'},payer:{openid:actor.openid}
      });
      if(!created.prepay_id)throw Error('WECHAT_PREPAY');
      prepayId=created.prepay_id;
      await book.save({outTradeNo,orderId:order.id,openid:actor.openid,amount:order.total,prepayId,status:'CREATED',createdAt:now()});
    }
    return {order,outTradeNo,wechat:jsapiParams({appId:config.appId,privateKey:config.privateKey,prepayId})};
  }
  async function applyPaid(trade,resource,eventId){
    if(resource.appid!==config.appId||resource.mchid!==config.mchId)throw Error('WECHAT_MERCHANT_MISMATCH');
    if(resource.payer?.openid!==trade.openid)throw Error('WECHAT_OPENID_MISMATCH');
    if(resource.attach&&resource.attach!==trade.orderId)throw Error('WECHAT_ORDER_MISMATCH');
    const order=await settle('payment',{
      eventId,transactionId:resource.transaction_id,orderId:trade.orderId,outTradeNo:trade.outTradeNo,
      amount:resource.amount.total,currency:resource.amount.currency||'CNY'
    });
    await book.save({...trade,status:order.status==='PAID'?'SUCCESS':'REFUNDING',transactionId:resource.transaction_id,paidAt:now()});
    if(order.status==='REFUNDING'&&order.refund?.latePayment)await submitRefund(order,{...trade,transactionId:resource.transaction_id},'关闭后到账，自动退款');
    return order;
  }
  async function syncPayment(actor,input){
    if(!payReady())throw Error('REAL_PAYMENT_NOT_CONFIGURED');
    const order=await orderOf(actor,input.id);
    if(order.userId!==actor.id)throw Error('FORBIDDEN');
    if(order.status!=='PENDING')return order;
    const trade=(await book.byOrder(order.id)).sort((a,b)=>b.createdAt-a.createdAt)[0];
    if(!trade)return order;
    const remote=await payRequest('GET','/v3/pay/transactions/out-trade-no/'+encodeURIComponent(trade.outTradeNo)+'?mchid='+encodeURIComponent(config.mchId));
    if(remote.trade_state!=='SUCCESS')return order;
    return applyPaid(trade,remote,'query:'+remote.transaction_id);
  }
  function tradeFor(order,rows){
    return rows.find(row=>row.transactionId&&row.transactionId===order.payment?.transactionId)||rows.sort((a,b)=>b.createdAt-a.createdAt)[0]||(order.payment?.outTradeNo?{outTradeNo:order.payment.outTradeNo,orderId:order.id,transactionId:order.payment.transactionId,amount:order.total,status:'SUCCESS',createdAt:now()}:null);
  }
  async function submitRefund(order,trade,reason){
    const outRefundNo=trade.outRefundNo||('R'+trade.outTradeNo.slice(1));
    await book.save({...trade,outTradeNo:trade.outTradeNo,outRefundNo,orderId:order.id,status:'REFUNDING'});
    let remote;
    try{
      remote=await payRequest('POST','/v3/refund/domestic/refunds',{
        out_trade_no:trade.outTradeNo,out_refund_no:outRefundNo,reason:clip(reason,80),notify_url:settings.refundNotifyUrl,
        amount:{refund:order.total,total:order.total,currency:'CNY'}
      });
    }catch(error){
      if(error.message!=='RESOURCE_ALREADY_EXISTS'&&error.message!=='INVALID_REQUEST')throw error;
      remote=await payRequest('GET','/v3/refund/domestic/refunds/'+encodeURIComponent(outRefundNo));
    }
    if(remote.status==='SUCCESS')return settle('refund',{eventId:'sync:'+remote.refund_id,refundId:remote.refund_id,orderId:order.id,amount:remote.amount.refund,currency:remote.amount.currency||'CNY'});
    return order;
  }
  async function refund(actor,input){
    if(!payReady())throw Error('REAL_PAYMENT_NOT_CONFIGURED');
    if(actor.merchant!==true)throw Error('FORBIDDEN');
    const order=await orderOf(actor,input.id);
    if(order.payment?.provider!=='WECHAT')throw Error('WECHAT_PAYMENT_REQUIRED');
    if(!['WAIT_REFUND','REFUND_FAILED'].includes(order.refund?.stage))throw Error('INVALID_STATE');
    const trade=tradeFor(order,await book.byOrder(order.id));
    if(!trade?.outTradeNo)throw Error('WECHAT_TRADE_NOT_FOUND');
    return submitRefund(order,trade,order.refund.reason||'商家同意退款');
  }
  async function readRaw(req){
    let raw='',size=0;
    for await(const chunk of req){size+=chunk.length;if(size>100000)throw Error('BODY_TOO_LARGE');raw+=chunk;}
    return raw;
  }
  async function authenticatedResource(req,raw){
    const serial=req.headers['wechatpay-serial'];
    verifyNotify({publicKey:await platformKey(serial),timestamp:req.headers['wechatpay-timestamp'],nonce:req.headers['wechatpay-nonce'],body:raw,signature:req.headers['wechatpay-signature'],now:now()});
    const body=JSON.parse(raw||'{}');
    if(body.resource?.algorithm!=='AEAD_AES_256_GCM')throw Error('WECHAT_ALGORITHM');
    const plain=decryptResource({apiV3Key:config.apiV3Key,nonce:body.resource.nonce,associatedData:body.resource.associated_data,ciphertext:body.resource.ciphertext});
    return {body,resource:JSON.parse(plain)};
  }
  function ack(res,status,message){
    if(res.writableEnded)return;
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({code:status===200?'SUCCESS':'FAIL',message}));
  }
  async function payNotify(req,res){
    if(!payReady())return ack(res,503,'REAL_PAYMENT_NOT_CONFIGURED');
    try{
      const raw=await readRaw(req);
      const {body,resource}=await authenticatedResource(req,raw);
      if(body.event_type!=='TRANSACTION.SUCCESS'||resource.trade_state!=='SUCCESS')throw Error('WECHAT_TRADE_STATE');
      const trade=await book.get(resource.out_trade_no);
      if(!trade)throw Error('WECHAT_TRADE_NOT_FOUND');
      await applyPaid(trade,resource,body.id);
      ack(res,200,'成功');
    }catch(error){
      console.error('WeChat pay notify failed:',error.message);
      ack(res,error.message==='WECHAT_SIGNATURE'||error.message==='WECHAT_TIMESTAMP'?401:500,error.message);
    }
  }
  async function refundNotify(req,res){
    if(!payReady())return ack(res,503,'REAL_PAYMENT_NOT_CONFIGURED');
    try{
      const raw=await readRaw(req);
      const {body,resource}=await authenticatedResource(req,raw);
      if(body.event_type!=='REFUND.SUCCESS'||resource.refund_status!=='SUCCESS')throw Error('WECHAT_REFUND_STATE');
      if(resource.mchid!==config.mchId)throw Error('WECHAT_MERCHANT_MISMATCH');
      const trade=await book.get(resource.out_trade_no);
      if(!trade||(trade.outRefundNo&&trade.outRefundNo!==resource.out_refund_no))throw Error('WECHAT_TRADE_NOT_FOUND');
      await settle('refund',{eventId:body.id,refundId:resource.refund_id,orderId:trade.orderId,amount:resource.amount.refund,currency:resource.amount.currency||'CNY'});
      await book.save({...trade,status:'REFUNDED',refundId:resource.refund_id});
      ack(res,200,'成功');
    }catch(error){
      console.error('WeChat refund notify failed:',error.message);
      ack(res,error.message==='WECHAT_SIGNATURE'||error.message==='WECHAT_TIMESTAMP'?401:500,error.message);
    }
  }
  async function handle(req,res,url){
    if(url.pathname==='/wechat/pay/notify'&&req.method==='POST'){await payNotify(req,res);return true;}
    if(url.pathname==='/wechat/refund/notify'&&req.method==='POST'){await refundNotify(req,res);return true;}
    return false;
  }
  return {handle,createPayment,syncPayment,refund,payReady,missing,book};
}
module.exports={createWechat,TradeBook};
