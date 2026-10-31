'use strict';
const {tradeNo,clip}=require('./wechat-crypto');

class TradeBook{
  constructor(store){this.store=store||null;this.rows=new Map();}
  async save(doc){
    if(typeof this.store?.saveTrade==='function')return this.store.saveTrade(doc);
    const previous=this.rows.get(doc.outTradeNo);
    if(previous&&(previous.version||0)!==(doc.version||0))throw Error('PAYMENT_REVISION_CONFLICT');
    const stored={...doc,_id:doc.outTradeNo,version:(doc.version||0)+1};
    this.rows.set(doc.outTradeNo,stored);
    return stored;
  }
  async get(outTradeNo){
    if(typeof this.store?.getTrade==='function')return this.store.getTrade(outTradeNo);
    return this.rows.get(outTradeNo)||null;
  }
  async byOrder(orderId){
    if(typeof this.store?.tradesByOrder==='function'){
      return this.store.tradesByOrder(orderId);
    }
    return [...this.rows.values()].filter(row=>row.orderId===orderId);
  }
  async reserve(doc){
    if(typeof this.store?.reserveTrade==='function')return this.store.reserveTrade(doc);
    const existing=[...this.rows.values()].find(row=>row.orderId===doc.orderId);
    if(existing)return existing;
    return this.save(doc);
  }
  async pending(at){
    if(typeof this.store?.pendingTrades==='function')return this.store.pendingTrades(at,10);
    return [...this.rows.values()].filter(row=>!['SUCCESS','CLOSED','REFUNDED','DUPLICATE_REFUNDED'].includes(row.status)&&(row.nextCheckAt||0)<=at).sort((a,b)=>(a.nextCheckAt||0)-(b.nextCheckAt||0)).slice(0,10);
  }
}

function createWechat({settings,store,auth,fetch:fetchImpl=global.fetch,now=()=>Date.now()}={}){
  const config=settings?.config||{};
  const payMode=config.payMode||'cloud';
  let v3Client;
  const direct=()=>v3Client||(v3Client=require('./wechat-v3').createV3({config,fetch:fetchImpl,now}));
  const transport=trade=>trade.transport||'cloud';
  const book=new TradeBook(store);
  const payReady=()=>settings?.payReady===true;
  const missing=()=>settings?.payReady?[]:(settings?.payMissing||[]);
  const field=(obj,...keys)=>{for(const key of keys)if(obj&&obj[key]!==undefined&&obj[key]!==null&&obj[key]!=='')return obj[key];return undefined;};

  async function callPay(action,bodyObj,mode='cloud'){
    if(mode==='direct')return direct().call(action,bodyObj);
    if(mode!=='cloud')throw Error('WECHAT_PAY_MODE_INVALID');
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
  function at(data,key,index){const value=data?.[key];return Array.isArray(value)?value[index]:undefined;}
  function refundHit(data,outRefundNo){
    if(!data||typeof data!=='object')return null;
    const rows=[];
    const top=field(data,'refund_status','refundStatus');
    if(top)rows.push({status:top,outRefundNo:field(data,'out_refund_no','outRefundNo'),refundId:String(field(data,'refund_id','refundId')||''),amount:Number(field(data,'refund_fee','refundFee'))});
    const count=Number(data.refund_count||0);
    for(let i=0;i<Math.max(count,0)||data['refund_status_'+i]||at(data,'refund_status_list',i);i++){
      if(i>20)break;
      const status=data['refund_status_'+i]||at(data,'refund_status_list',i);
      if(status)rows.push({status,outRefundNo:data['out_refund_no_'+i]||at(data,'out_refund_no_list',i),refundId:String(data['refund_id_'+i]||at(data,'refund_id_list',i)||''),amount:Number(data['refund_fee_'+i]??at(data,'refund_fee_list',i))});
      if(i+1>=count&&!data['refund_status_'+(i+1)]&&!at(data,'refund_status_list',i+1))break;
    }
    return rows.find(row=>row.status==='SUCCESS'&&row.refundId&&(!outRefundNo||!row.outRefundNo||String(row.outRefundNo)===String(outRefundNo)))||null;
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
    const cloud=payMode==='direct'?{envId:'',service:'',ip:'127.0.0.1'}:target(req);
    const order=await orderOf(actor,input.id);
    if(order.userId!==actor.id)throw Error('FORBIDDEN');
    if(order.status==='PAID')return {order,wechat:null};
    if(order.status!=='PENDING')throw Error('INVALID_STATE');
    // Reserve before contacting WeChat. A timeout/restart must never mint a
    // second trade number, even when the first response was lost.
    const outTradeNo=tradeNo('P');
    const request={
      body:clip(order.lines.map(line=>line.name).join('、')||'爪爪小铺订单'),openid:actor.openid,out_trade_no:outTradeNo,
      spbill_create_ip:cloud.ip,sub_mch_id:config.mchId,total_fee:order.total,attach:order.id,trade_type:'JSAPI',
      env_id:cloud.envId,callback_type:2,container:{service:cloud.service,path:'/wechat/pay/notify'}
    };
    const trade=await book.reserve({outTradeNo,orderId:order.id,userId:actor.id,openid:actor.openid,amount:order.total,request,envId:cloud.envId,service:cloud.service,transport:payMode,status:'CREATING',createdAt:now(),nextCheckAt:now()+60000});
    if(trade.openid!==actor.openid||trade.amount!==order.total)throw Error('PAYMENT_CONFLICT');
    if(trade.status==='CREATED'&&trade.payment)return {order,outTradeNo:trade.outTradeNo,wechat:trade.payment};
    if(trade.status!=='CREATING')throw Error('INVALID_STATE');
    const created=await callPay('unifiedOrder',trade.request,transport(trade));
    const wechat=paymentFields(created);
    try{await book.save({...trade,prepayId:created.prepay_id,payment:wechat,status:'CREATED'});}
    catch(error){if(error.message!=='PAYMENT_REVISION_CONFLICT')throw error;const current=await book.get(trade.outTradeNo);if(current?.status!=='CREATED'||!current.payment)throw error;return {order:await orderOf(actor,input.id),outTradeNo:current.outTradeNo,wechat:current.payment};}
    const currentOrder=await orderOf(actor,input.id);
    if(currentOrder.status!=='PENDING')return {order:await syncPayment(actor,input),outTradeNo:trade.outTradeNo,wechat:null};
    return {order:currentOrder,outTradeNo:trade.outTradeNo,wechat};
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
    if((field(remote,'fee_type','feeType')||'CNY')!=='CNY')throw Error('WECHAT_AMOUNT_MISMATCH');
    let order;
    try{order=await settle('payment',{eventId:'pay:'+tx,transactionId:tx,orderId:trade.orderId,outTradeNo:trade.outTradeNo,amount:total,currency:'CNY'});}
    catch(error){
      if(error.message!=='PAYMENT_CONFLICT')throw error;
      order=await orderOf({id:trade.userId||'wx:'+trade.openid,channel:'wechat'},trade.orderId);
      const duplicate=await book.save({...trade,status:'DUPLICATE_REFUNDING',duplicate:true,transactionId:tx,paidAt:now()});
      await submitRefund(order,duplicate,'重复到账，自动退款');return order;
    }
    const late=order.status==='REFUNDING'&&order.refund?.latePayment;
    const refundPending=late||order.status==='REFUNDING'&&!!trade.outRefundNo;
    const saved=await book.save({...trade,status:order.status==='REFUNDED'?'REFUNDED':refundPending?'REFUNDING':'SUCCESS',transactionId:tx,paidAt:now()});
    if(late)return submitRefund(order,saved,'关闭后到账，自动退款');
    return order;
  }
  async function syncPayment(actor,input){
    if(!payReady())throw Error('REAL_PAYMENT_NOT_CONFIGURED');
    const order=await orderOf(actor,input.id);
    if(order.userId!==actor.id)throw Error('FORBIDDEN');
    const trades=(await book.byOrder(order.id)).sort((a,b)=>b.createdAt-a.createdAt);
    for(const trade of trades){
      await reconcileTrade(trade);
    }
    return orderOf(actor,input.id);
  }
  async function reconcileTrade(trade){
    if(['SUCCESS','CLOSED','REFUNDED','DUPLICATE_REFUNDED'].includes(trade.status))return;
    const order=await orderOf({id:trade.userId||'wx:'+trade.openid,channel:'wechat'},trade.orderId);
    if(['REFUNDING','DUPLICATE_REFUNDING'].includes(trade.status))return submitRefund(order,trade,trade.duplicate?'重复到账，自动退款':order.refund?.reason||'退款补查');
    let remote;
    try{remote=await callPay('queryorder',{out_trade_no:trade.outTradeNo,sub_mch_id:config.mchId},transport(trade));}
    catch(error){if(!['ORDERNOTEXIST','ORDER_NOT_EXIST'].includes(error.message))throw error;return;}
    const status=field(remote,'trade_state','tradeState');
    if(status==='SUCCESS')return applyPaid(trade,remote);
    if(status==='CLOSED'||status==='REVOKED')return book.save({...trade,status:'CLOSED'});
    if(['CANCELLED','EXPIRED'].includes(order.status)&&status==='NOTPAY'){
      try{await callPay('closeorder',{out_trade_no:trade.outTradeNo,sub_mch_id:config.mchId},transport(trade));}
      catch(error){if(!['ORDERPAID','ORDERCLOSED'].includes(error.message))throw error;}
      // Payment may win the race with closing; always query after closing.
      const checked=await callPay('queryorder',{out_trade_no:trade.outTradeNo,sub_mch_id:config.mchId},transport(trade));
      if(field(checked,'trade_state','tradeState')==='SUCCESS')return applyPaid(trade,checked);
      if(field(checked,'trade_state','tradeState')==='CLOSED')return book.save({...trade,status:'CLOSED'});
    }
  }
  async function reconcile(){
    if(!payReady())return {checked:0,failed:0};
    const trades=await book.pending(now());let failed=0;
    for(const trade of trades){
      try{
        // Claim this interval using optimistic concurrency. Other instances
        // cannot process the same version, and stale responses cannot undo it.
        const claimed=await book.save({...trade,nextCheckAt:now()+60000});
        await reconcileTrade(claimed);
      }catch(error){if(error.message!=='PAYMENT_REVISION_CONFLICT')failed++;}
    }
    return {checked:trades.length,failed};
  }
  function tradeFor(order,rows){
    return rows.find(row=>row.transactionId&&row.transactionId===order.payment?.transactionId)||rows.sort((a,b)=>b.createdAt-a.createdAt)[0]||(order.payment?.outTradeNo?{outTradeNo:order.payment.outTradeNo,orderId:order.id,transactionId:order.payment.transactionId,amount:order.total,status:'SUCCESS',createdAt:now()}:null);
  }
  async function submitRefund(order,trade,reason){
    const outRefundNo=trade.outRefundNo||('R'+trade.outTradeNo.slice(1));
    const cloud={envId:trade.envId||config.cloudEnv,service:trade.service||config.cloudService||'pet-shop'};
    if(transport(trade)==='cloud'&&!cloud.envId)throw Error('WECHAT_CLOUD_ENV_REQUIRED');
    trade=await book.save({...trade,outTradeNo:trade.outTradeNo,outRefundNo,orderId:order.id,status:trade.duplicate?'DUPLICATE_REFUNDING':'REFUNDING',nextCheckAt:now()+60000});
    let remote;
    try{remote=await callPay('refund',{
      out_trade_no:trade.outTradeNo,out_refund_no:outRefundNo,sub_mch_id:config.mchId,total_fee:order.total,refund_fee:order.total,
      refund_desc:clip(reason,80),env_id:cloud.envId,callback_type:2,container:{service:cloud.service,path:'/wechat/refund/notify'}
    },transport(trade));}catch(error){remote=await callPay('queryrefund',{out_trade_no:trade.outTradeNo,out_refund_no:outRefundNo,sub_mch_id:config.mchId},transport(trade)).catch(()=>{throw error;});}
    let done=refundHit(remote,outRefundNo);
    if(!done)done=refundHit(await callPay('queryrefund',{out_trade_no:trade.outTradeNo,out_refund_no:outRefundNo,sub_mch_id:config.mchId},transport(trade)),outRefundNo);
    if(done?.refundId&&done.amount===order.total){
      const result=trade.duplicate?order:await settle('refund',{eventId:'refund:'+done.refundId,refundId:done.refundId,orderId:order.id,amount:done.amount,currency:'CNY'});
      await book.save({...trade,status:trade.duplicate?'DUPLICATE_REFUNDED':'REFUNDED',refundId:done.refundId});
      return result;
    }
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
      if(!trade||transport(trade)!=='cloud')throw Error('WECHAT_TRADE_NOT_FOUND');
      const remote=await callPay('queryorder',{out_trade_no:trade.outTradeNo,sub_mch_id:config.mchId},transport(trade));
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
      if(!trade||transport(trade)!=='cloud'||(trade.outRefundNo&&trade.outRefundNo!==outRefundNo))throw Error('WECHAT_TRADE_NOT_FOUND');
      const remote=await callPay('queryrefund',{out_trade_no:trade.outTradeNo,sub_mch_id:config.mchId},transport(trade));
      const done=refundHit(remote,outRefundNo);
      if(!done?.refundId||done.amount!==trade.amount)throw Error('WECHAT_REFUND_STATE');
      if(!trade.duplicate)await settle('refund',{eventId:'refund:'+done.refundId,refundId:done.refundId,orderId:trade.orderId,amount:done.amount,currency:'CNY'});
      await book.save({...trade,status:trade.duplicate?'DUPLICATE_REFUNDED':'REFUNDED',refundId:done.refundId});
      ack(res,200,0,'ok');
    }catch(error){
      console.error('WeChat refund notify failed:',error.message);
      ack(res,200,1,error.message);
    }
  }
  async function directNotify(req,res,kind){
    const reply=(status,code)=>{if(!res.writableEnded){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({code,message:code}));}};
    if(!payReady())return reply(503,'FAIL');
    try{
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>100000)throw Error('BODY_TOO_LARGE');chunks.push(Buffer.from(chunk));}
      const notice=direct().notification(req.headers,Buffer.concat(chunks).toString('utf8'),kind);
      const trade=await book.get(notice.out_trade_no);
      if(!trade||transport(trade)!=='direct')throw Error('WECHAT_TRADE_NOT_FOUND');
      if(kind==='payment'){
        const remote=await callPay('queryorder',{out_trade_no:trade.outTradeNo,sub_mch_id:config.mchId},'direct');
        if(remote.trade_state!=='SUCCESS')throw Error('WECHAT_TRADE_STATE');
        await applyPaid(trade,remote);
      }else{
        if(!trade.outRefundNo||notice.out_refund_no!==trade.outRefundNo)throw Error('WECHAT_TRADE_NOT_FOUND');
        const remote=await callPay('queryrefund',{out_trade_no:trade.outTradeNo,out_refund_no:trade.outRefundNo,sub_mch_id:config.mchId,total_fee:trade.amount},'direct');
        const done=refundHit(remote,trade.outRefundNo);
        if(!done?.refundId||done.amount!==trade.amount)throw Error('WECHAT_REFUND_STATE');
        if(!trade.duplicate)await settle('refund',{eventId:'refund:'+done.refundId,refundId:done.refundId,orderId:trade.orderId,amount:done.amount,currency:'CNY'});
        await book.save({...trade,status:trade.duplicate?'DUPLICATE_REFUNDED':'REFUNDED',refundId:done.refundId});
      }
      reply(200,'SUCCESS');
    }catch(error){console.error('WeChat v3 notify failed:',/^[A-Z0-9_]{1,80}$/.test(error.message||'')?error.message:'VERIFY_OR_SETTLE_FAILED');reply(500,'FAIL');}
  }
  async function handle(req,res,url){
    if(url.pathname==='/wechat/pay/v3/notify'&&req.method==='POST'){await directNotify(req,res,'payment');return true;}
    if(url.pathname==='/wechat/refund/v3/notify'&&req.method==='POST'){await directNotify(req,res,'refund');return true;}
    if(url.pathname==='/wechat/pay/notify'&&req.method==='POST'){await payNotify(req,res);return true;}
    if(url.pathname==='/wechat/refund/notify'&&req.method==='POST'){await refundNotify(req,res);return true;}
    return false;
  }
  return {handle,createPayment,syncPayment,refund,payReady,missing,book,reconcile};
}
module.exports={createWechat,TradeBook};
