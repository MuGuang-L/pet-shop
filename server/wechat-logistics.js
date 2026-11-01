'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {carriers}=require('../cloudfunctions/shop/studio');
// Official query plugin: tokens are scoped to a paid transaction and its buyer.
function createWechatLogistics({store,env=process.env,fetch=globalThis.fetch,now=Date.now}={}){
 let access=null,pending=null;
 async function token(){
  if(access&&access.until>now())return access.value;
  if(pending)return pending;
  pending=(async()=>{const r=await fetch('https://api.weixin.qq.com/cgi-bin/stable_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'client_credential',appid:env.WECHAT_APPID,secret:env.WECHAT_MINIPROGRAM_SECRET,force_refresh:false}),signal:AbortSignal.timeout(8000)});const b=await r.json();if(!r.ok||b.errcode||typeof b.access_token!=='string'||!(b.expires_in>0))throw Error('TOKEN_UNAVAILABLE');access={value:b.access_token,until:now()+Math.max(0,b.expires_in-300)*1000};return access.value;})();
  try{return await pending;}finally{pending=null;}
 }
 async function trace(payload){
  for(let attempt=0;attempt<2;attempt++){
   const t=await token(),r=await fetch('https://api.weixin.qq.com/cgi-bin/express/delivery/open_msg/trace_waybill?access_token='+encodeURIComponent(t),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)}),b=await r.json();
   if(attempt===0&&[40001,40014,42001].includes(b.errcode)){access=null;continue;}
   if(!r.ok||b.errcode||typeof b.waybill_token!=='string'||!b.waybill_token.length)throw Error('TRACE_UNAVAILABLE');return b.waybill_token;
  }
 }
 return {async tracking(actor,input){
  const o=await store.execute(actor,'order',{id:input.id},{mock:actor.channel!=='wechat'}),s=o.shipping;
  const base={provider:'wechat',company:s?.company||'',number:s?.number||'',events:[],notice:'',canOpen:false};
  if(o.fulfillment?.type==='PICKUP')return {...base,notice:'自提订单无需查询快递物流'};
  if(!s)return {...base,notice:'商家尚未发货，发货后可查看快递单号及物流'};
  if(!Object.hasOwn(carriers,s.carrier)||!/^[A-Za-z0-9-]{6,32}$/.test(s.number||''))return {...base,notice:'历史配送记录缺少有效快递公司或运单号，请联系商家核实'};
  if(env.WECHAT_LOGISTICS_ENABLED!=='1'||!env.WECHAT_APPID||!env.WECHAT_MINIPROGRAM_SECRET)return {...base,notice:'物流查询服务尚未开通，可复制快递单号向承运公司查询'};
  // Merchant sessions must never receive a buyer's waybill token.
  if(actor.merchant||actor.channel!=='wechat'||!actor.openid||o.userId!==actor.id)return {...base,notice:'请由下单用户在微信小程序中查看物流'};
  if(o.payment?.provider!=='WECHAT'||!o.payment.transactionId)return {...base,notice:'此订单没有真实微信支付记录，暂不能使用微信物流查询'};
  if(!o.address?.phone)return {...base,notice:'收件手机号不完整，请联系商家核实'};
  if(input.open!==true)return {...base,canOpen:true,notice:'点击查看物流，在微信官方页面查看运输进度'};
  const detail=[];
  for(const line of o.lines||[]){let url;try{if(!line.image)throw Error('MISSING_IMAGE');url=new URL(line.image,env.PUBLIC_ORIGIN);}catch{return {...base,notice:'商品图片资料不完整，请联系商家核实'};}if(url.protocol!=='https:')return {...base,notice:'商品图片资料不完整，请联系商家核实'};detail.push({goods_name:line.name,goods_img_url:url.href});}
  if(!detail.length||detail.some(x=>!x.goods_name))return {...base,notice:'商品资料不完整，请联系商家核实'};
  const payload={openid:actor.openid,receiver_phone:o.address.phone,waybill_id:s.number,trans_id:o.payment.transactionId,order_detail_path:'pages/shop/index?order_id='+encodeURIComponent(o.id),goods_info:{detail_list:detail}};
  // delivery_id is optional in the official API; WeChat recognizes mainstream carriers.
  const id=createHash('sha256').update(JSON.stringify(['wechat',env.WECHAT_APPID,o.id,actor.openid,s.carrier,s.number,o.payment.transactionId,o.address.phone])).digest('hex'),lease=randomUUID(),at=now();
  const record=await store.claimLogistics(id,at,at+60000,lease);
  if(record.result?.waybillToken)return {...base,canOpen:true,waybillToken:record.result.waybillToken,notice:'物流信息由微信官方提供'};
  if(record.token!==lease)return {...base,canOpen:true,notice:record.result?.notice||'物流正在准备，请稍后再试'};
  let result;
  try{result={waybillToken:await trace(payload),notice:'物流信息由微信官方提供'};}
  catch{result={notice:'微信物流暂不可用，请稍后重试或联系商家核实；也可复制运单号查询'};}
  await store.saveLogistics(id,lease,result);
  return {...base,...result,canOpen:true};
 }};
}
module.exports={createWechatLogistics};
