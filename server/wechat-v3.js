'use strict';
const crypto=require('node:crypto');
const {authorization,verifyNotify,decryptResource,jsapiParams}=require('./wechat-crypto');
function missingV3(config){
 const missing=[];
 if(!/^wx[0-9a-f]{16}$/.test(config.appId||''))missing.push('appId');
 if(!/^\d+$/.test(config.mchId||''))missing.push('mchId');
 if(!/^[0-9a-f]+$/i.test(config.mchSerial||''))missing.push('mchSerial');
 if(Buffer.byteLength(config.apiV3Key||'')!==32)missing.push('apiV3Key');
 if(!/^PUB_KEY_ID_[A-Za-z0-9_]+$/.test(config.platformPublicKeyId||''))missing.push('platformPublicKeyId');
 for(const [field,parse] of [['privateKey',crypto.createPrivateKey],['platformPublicKey',crypto.createPublicKey]]){
  try{const key=parse(config[field]);if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<2048)throw Error();}
  catch{missing.push(field);}
 }
 if(!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(config.publicOrigin||''))missing.push('publicOrigin');
 return missing;
}
function createV3({config,fetch:fetchImpl=global.fetch,now=Date.now}){
 const missing=missingV3(config);if(missing.length)throw Error('WECHAT_V3_CONFIG_REQUIRED');
 function verifyResponse(headers,body){
  const get=name=>typeof headers.get==='function'?headers.get(name):headers[name.toLowerCase()];
  if(get('wechatpay-serial')!==config.platformPublicKeyId)throw Error('WECHAT_PUBLIC_KEY_ID');
  verifyNotify({publicKey:config.platformPublicKey,timestamp:get('wechatpay-timestamp'),nonce:get('wechatpay-nonce'),signature:get('wechatpay-signature'),body,now:now()});
 }
 async function request(method,urlPath,payload){
  const body=payload===undefined?'':JSON.stringify(payload);
  const headers=authorization({mchId:config.mchId,serial:config.mchSerial,privateKey:config.privateKey,method,urlPath,body});
  headers['Wechatpay-Serial']=config.platformPublicKeyId;
  const response=await fetchImpl('https://api.mch.weixin.qq.com'+urlPath,{method,headers,...(body?{body}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
  const raw=await response.text();verifyResponse(response.headers,raw);
  let data={};if(raw){try{data=JSON.parse(raw);}catch{throw Error('WECHAT_BAD_RESPONSE');}}
  if(!response.ok){const code=typeof data.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(data.code)?data.code:'WECHAT_HTTP_'+response.status;throw Error(({ORDER_PAID:'ORDERPAID',ORDER_CLOSED:'ORDERCLOSED'})[code]||code);}
  return data;
 }
 function order(data,expected){
  if(data.appid!==config.appId)throw Error('WECHAT_APPID_MISMATCH');
  if(data.mchid!==config.mchId)throw Error('WECHAT_MERCHANT_MISMATCH');
  if(data.out_trade_no!==expected)throw Error('WECHAT_ORDER_MISMATCH');
  if(data.amount?.currency!=='CNY')throw Error('WECHAT_AMOUNT_MISMATCH');
  return {trade_state:data.trade_state,transaction_id:data.transaction_id,out_trade_no:data.out_trade_no,total_fee:data.amount.total,fee_type:data.amount.currency,sub_mch_id:data.mchid,sub_openid:data.payer?.openid};
 }
 function refund(data,body){
  if(data.out_trade_no!==body.out_trade_no||data.out_refund_no!==body.out_refund_no)throw Error('WECHAT_ORDER_MISMATCH');
  if(data.amount?.currency!=='CNY')throw Error('WECHAT_AMOUNT_MISMATCH');
  if(body.total_fee!==undefined&&data.amount.total!==body.total_fee)throw Error('WECHAT_AMOUNT_MISMATCH');
  return {out_trade_no:data.out_trade_no,refund_status:data.status||data.refund_status,refund_id:data.refund_id,out_refund_no:data.out_refund_no,refund_fee:data.amount.refund};
 }
 async function call(action,b){
  if(b.sub_mch_id!==config.mchId)throw Error('WECHAT_MERCHANT_MISMATCH');
  if(action==='unifiedOrder'){
   const data=await request('POST','/v3/pay/transactions/jsapi',{appid:config.appId,mchid:config.mchId,description:b.body,out_trade_no:b.out_trade_no,notify_url:config.publicOrigin+'/wechat/pay/v3/notify',amount:{total:b.total_fee,currency:'CNY'},payer:{openid:b.openid}});
   if(typeof data.prepay_id!=='string'||!data.prepay_id)throw Error('WECHAT_PREPAY');
   return {prepay_id:data.prepay_id,payment:jsapiParams({appId:config.appId,privateKey:config.privateKey,prepayId:data.prepay_id})};
  }
  if(action==='queryorder')return order(await request('GET','/v3/pay/transactions/out-trade-no/'+encodeURIComponent(b.out_trade_no)+'?mchid='+encodeURIComponent(config.mchId)),b.out_trade_no);
  if(action==='closeorder')return request('POST','/v3/pay/transactions/out-trade-no/'+encodeURIComponent(b.out_trade_no)+'/close',{mchid:config.mchId});
  if(action==='refund')return refund(await request('POST','/v3/refund/domestic/refunds',{out_trade_no:b.out_trade_no,out_refund_no:b.out_refund_no,reason:b.refund_desc,notify_url:config.publicOrigin+'/wechat/refund/v3/notify',amount:{refund:b.refund_fee,total:b.total_fee,currency:'CNY'}}),b);
  if(action==='queryrefund')return refund(await request('GET','/v3/refund/domestic/refunds/'+encodeURIComponent(b.out_refund_no)),b);
  throw Error('WECHAT_V3_ACTION');
 }
 function notification(headers,raw,kind){
  verifyResponse(headers,raw);
  const envelope=JSON.parse(raw),resource=envelope.resource;
  if(envelope.event_type!==(kind==='payment'?'TRANSACTION.SUCCESS':'REFUND.SUCCESS')||resource?.algorithm!=='AEAD_AES_256_GCM')throw Error('WECHAT_NOTIFY_TYPE');
  const data=JSON.parse(decryptResource({apiV3Key:config.apiV3Key,nonce:resource.nonce,associatedData:resource.associated_data,ciphertext:resource.ciphertext}));
  if(data.mchid!==config.mchId)throw Error('WECHAT_MERCHANT_MISMATCH');
  if(kind==='payment')return order(data,data.out_trade_no);
  // Refund notifications do not include currency. Use their signed IDs to
  // query the refund; the query response must confirm CNY and exact amounts.
  if(data.refund_status!=='SUCCESS')throw Error('WECHAT_REFUND_STATE');
  return {out_trade_no:data.out_trade_no,out_refund_no:data.out_refund_no};
 }
 return {call,notification};
}
module.exports={createV3,missingV3};
