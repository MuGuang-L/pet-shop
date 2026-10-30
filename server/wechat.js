'use strict';
const {tradeNo,clip}=require('./wechat-crypto');

class TradeBook{
  constructor(store){this.store=store||null;this.rows=new Map();}
  async save(doc){
    const stored={...doc,_id:doc.outTradeNo};
    this.rows.set(doc.outTradeNo,stored);
    if(typeof this.store?.upsertTrade==='function')await this.store.upsertTrade(stored);
    return stored;
  }
  async get(outTradeNo){
    if(this.rows.has(outTradeNo))return this.rows.get(outTradeNo);
    const doc=typeof this.store?.getTrade==='function'?await this.store.getTrade(outTradeNo):null;
    if(doc)this.rows.set(outTradeNo,doc);
    return doc;
  }
  async byOrder(orderId){
    if(typeof this.store?.tradesByOrder==='function'){
      for(const doc of await this.store.tradesByOrder(orderId))this.rows.set(doc.outTradeNo,doc);
    }
    return [...this.rows.values()].filter(row=>row.orderId===orderId);
  }
}

function createWechat({settings,store,auth,fetch:fetchImpl=global.fetch,now=()=>Date.now()}={}){
  const config=settings?.config||{};
  const book=new TradeBook(store);
  const payReady=()=>settings?.payReady===true;
  const missing=()=>settings?.payReady?[]:(settings?.payMissing||[]);
  const field=(obj,...keys)=>{for(const key of keys)if(obj&&obj[key]!==undefined&&obj[key]!==null&&obj[key]!=='')return obj[key];return undefined;};

  async function callPay(action,bodyObj){
    const response=await fetchImpl('http://api.weixin.qq.com/_/pay/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(bodyObj),signal:AbortSignal.timeout(15000)});
    const text=await response.text();
    let json={};
    if(text){try{json=JSON.parse(text);}catch{throw Error('WECHAT_BAD_RESPONSE');}}
    if(!response.ok||(json.errcode&&json.errcode!==0))throw Error(json.errmsg||json.errcode||('WECHAT_HTTP_'+response.status));
    const data=json.respdata||json;
    const returnCode=field(data,'return_code','returnCode');
    const resultCode=field(data,'result_code','resultCode');
    if(returnCode&&returnCode!=='SUCCESS')throw Error(field(data,'return_msg','returnMsg')||'WECHAT_PAY_FAILED');
    if(resultCode&&resultCode!=='SUCCESS')throw Error(field(data,'err_code','errCode')||'WECHAT_PAY_FAILED');
    return data;
  }
  function target(req){
    const headers=req?.headers||{};
    const envId=String(headers['x-wx-env']||config.cloudEnv||'').trim();
    const service=String(headers['x-wx-service']||config.cloudService||'pet-shop').trim();
    if(!/^[A-Za-z0-9_-]{1,64}$/.test(envId))throw Error('WECHAT_CLOUD_ENV_REQUIRED');
    if(!/^[A-Za-z0-9_-]{1,64}$/.test(service))throw Error('WECHAT_CLOUD_SERVICE');
    const ip=String(headers['x-forwarded-for']||headers['x-real-ip']||'127.0.0.1').split(',')[0].trim();
    if(!/^[0-9a-fA-F:.]+$/.test(ip))throw Error('WECHAT_CLIENT_IP');
    return {envId,service,ip};
  }
  function paymentFields(data){
    const payment=data.payment||{};
    const wechat={timeStamp:String(payment.timeStamp||''),nonceStr:String(payment.nonceStr||''),package:String(payment.package||''),signType:String(payment.signType||'MD5'),paySign:String(payment.paySign||'')};
    if(!wechat.timeStamp||!wechat.nonceStr||!wechat.package.startsWith('prepay_id=')||!wechat.paySign)throw Error('WECHAT_PREPAY');
    return wechat;
  }
  function refundHit(data,outRefundNo){
    const status=field(data,'refund_status','refundStatus');
    if(status==='SUCCESS'&&(!outRefundNo||field(data,'out_refund_no','outRefundNo')===outRefundNo||!field(data,'out_refund_no','outRefundNo')))return {refundId:String(field(data,'refund_id','refundId')||''),amount:Number(field(data,'refund_fee','refundFee'))};
    const count=Number(data.refund_count||0);
    for(let i=0;i<count||(i===0&&data.refund_status_0);i++){
      if(data['refund_status_'+i]==='SUCCESS'&&(!outRefundNo||data['out_refund_no_'+i]===outRefundNo))return {refundId:String(data['refund_id_'+i]||''),amount:Number(data['refund_fee_'+i])};
      if(count&&i+1>=count)break;
    }
    return null;
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
  async function createPayment(actor,input,req){
    if(!payReady())throw Error('REAL_PAYMENT_NOT_CONFIGURED');
    if(!actor.openid)throw Error('WECHAT_OPENID_REQUIRED');
    const cloud=target(req);
    const order=await orderOf(actor,input.id);
    if(order.userId!==actor.id)throw Error('FORBIDDEN');
    if(order.status==='PAID')return {order,wechat:null};
    if(order.status!=='PENDING')throw Error('INVALID_STATE');
    const existing=(await book.byOrder(order.id)).find(row=>row.status==='CREATED'&&row.amount===order.total&&row.openid===actor.openid&&now()-row.createdAt<90*60*1000&&row.payment);
    if(existing)return {order,outTradeNo:existing.outTradeNo,wechat:existing.payment};
    const outTradeNo=tradeNo('P');
    const created=await callPay('unifiedOrder',{
      body:clip(order.lines.map(line=>line.name).join('、')||'爪爪小铺订单'),openid:actor.openid,out_trade_no:outTradeNo,
      spbill_create_ip:cloud.ip,sub_mch_id:config.mchId,total_fee:order.total,attach:order.id,trade_type:'JSAPI',
      env_id:cloud.envId,callback_type:2,container:{service:cloud.service,path:'/wechat/pay/notify'}
    });
    const wechat=paymentFields(created);
    await book.save({outTradeNo,orderId:order.id,openid:actor.openid,amount:order.total,prepayId:created.prepay_id,payment:wechat,envId:cloud.envId,service:cloud.service,status:'CREATED',createdAt:now()});
    return {order,outTradeNo,wechat};
  }
  async function applyPaid(trade,remote){
    const subMch=field(remote,'sub_mch_id','subMchId');
    const openid=field(remote,'sub_openid','subOpenid')||field(remote,'openid');
    const total=Number(field(remote,'total_fee','totalFee'));
    const tx=String(field(remote,'transaction_id','transactionId')||'');
    if(subMch!==config.mchId)throw Error('WECHAT_MERCHANT_MISMATCH');
    if(field(remote,'out_trade_no','outTradeNo')!==trade.outTradeNo)throw Error('WECHAT_ORDER_MISMATCH');
    if(openid!==trade.openid)throw Error('WECHAT_OPENID_MISMATCH');
    if(total!==trade.amount)throw Error('WECHAT_AMOUNT_MISMATCH');
    if(!tx)throw Error('WECHAT_TRADE_STATE');
    const order=await settle('payment',{eventId:'pay:'+tx,transactionId:tx,orderId:trade.orderId,outTradeNo:trade.outTradeNo,amount:total,currency:field(remote,'fee_type','feeType')||'CNY'});
    const saved={...trade,status:order.status==='PAID'?'SUCCESS':'REFUNDING',transactionId:tx,paidAt:now()};
    await book.save(saved);
    if(order.status==='REFUNDING'&&order.refund?.latePayment)await submitRefund(order,saved,'关闭后到账，自动退款');
    return order;
  }
  async function syncPayment(actor,input){
    if(!payReady())throw Error('REAL_PAYMENT_NOT_CONFIGURED');
    const order=await orderOf(actor,input.id);
    if(order.userId!==actor.id)throw Error('FORBIDDEN');
    if(order.status!=='PENDING')return order;
    const trade=(await book.byOrder(order.id)).sort((a,b)=>b.createdAt-a.createdAt)[0];
    if(!trade)return order;
    const remote=await callPay('queryorder',{out_trade_no:trade.outTradeNo,sub_mch_id:config.mchId});
    if(field(remote,'trade_state','tradeState')!=='SUCCESS')return order;
    return applyPaid(trade,remote);
  }
  function tradeFor(order,rows){
    return rows.find(row=>row.transactionId&&row.transactionId===order.payment?.transactionId)||rows.sort((a,b)=>b.createdAt-a.createdAt)[0]||(order.payment?.outTradeNo?{outTradeNo:order.payment.outTradeNo,orderId:order.id,transactionId:order.payment.transactionId,amount:order.total,status:'SUCCESS',createdAt:now()}:null);
  }
  async function submitRefund(order,trade,reason){
    const outRefundNo=trade.outRefundNo||('R'+trade.outTradeNo.slice(1));
    const cloud={envId:trade.envId||config.cloudEnv,service:trade.service||config.cloudService||'pet-shop'};
    if(!cloud.envId)throw Error('WECHAT_CLOUD_ENV_REQUIRED');
    await book.save({...trade,outTradeNo:trade.outTradeNo,outRefundNo,orderId:order.id,status:'REFUNDING'});
    const remote=await callPay('refund',{
      out_trade_no:trade.outTradeNo,out_refund_no:outRefundNo,sub_mch_id:config.mchId,total_fee:order.total,refund_fee:order.total,
      refund_desc:clip(reason,80),env_id:cloud.envId,callback_type:2,container:{service:cloud.service,path:'/wechat/refund/notify'}
    });
    const done=refundHit(remote,outRefundNo);
    if(done?.refundId)return settle('refund',{eventId:'refund:'+done.refundId,refundId:done.refundId,orderId:order.id,amount:done.amount,currency:'CNY'});
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
  function ack(res,status,errcode,errmsg){
    if(res.writableEnded)return;
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({errcode,errmsg}));
  }
  async function payNotify(req,res){
    if(!payReady())return ack(res,503,1,'REAL_PAYMENT_NOT_CONFIGURED');
    try{
      const body=JSON.parse(await readRaw(req)||'{}');
      if(field(body,'result_code','resultCode')!=='SUCCESS'||field(body,'return_code','returnCode')!=='SUCCESS')throw Error('WECHAT_TRADE_STATE');
      const trade=await book.get(field(body,'out_trade_no','outTradeNo'));
      if(!trade)throw Error('WECHAT_TRADE_NOT_FOUND');
      const remote=await callPay('queryorder',{out_trade_no:trade.outTradeNo,sub_mch_id:config.mchId});
      if(field(remote,'trade_state','tradeState')!=='SUCCESS')throw Error('WECHAT_TRADE_STATE');
      await applyPaid(trade,remote);
      ack(res,200,0,'ok');
    }catch(error){
      console.error('WeChat pay notify failed:',error.message);
      ack(res,200,1,error.message);
    }
  }
  async function refundNotify(req,res){
    if(!payReady())return ack(res,503,1,'REAL_PAYMENT_NOT_CONFIGURED');
    try{
      const body=JSON.parse(await readRaw(req)||'{}');
      if(field(body,'refund_status','refundStatus')!=='SUCCESS')throw Error('WECHAT_REFUND_STATE');
      const subMch=field(body,'sub_mch_id','subMchId');
      if(subMch&&subMch!==config.mchId)throw Error('WECHAT_MERCHANT_MISMATCH');
      const trade=await book.get(field(body,'out_trade_no','outTradeNo'));
      const outRefundNo=field(body,'out_refund_no','outRefundNo');
      if(!trade||(trade.outRefundNo&&trade.outRefundNo!==outRefundNo))throw Error('WECHAT_TRADE_NOT_FOUND');
      const remote=await callPay('queryrefund',{out_trade_no:trade.outTradeNo,sub_mch_id:config.mchId});
      const done=refundHit(remote,outRefundNo);
      if(!done?.refundId||done.amount!==trade.amount)throw Error('WECHAT_REFUND_STATE');
      await settle('refund',{eventId:'refund:'+done.refundId,refundId:done.refundId,orderId:trade.orderId,amount:done.amount,currency:'CNY'});
      await book.save({...trade,status:'REFUNDED',refundId:done.refundId});
      ack(res,200,0,'ok');
    }catch(error){
      console.error('WeChat refund notify failed:',error.message);
      ack(res,200,1,error.message);
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
