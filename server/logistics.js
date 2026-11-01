'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {carriers}=require('../cloudfunctions/shop/studio');
const INTERVAL=31*60*1000;
const states={'0':'运输中','1':'已揽收','2':'物流异常','3':'已签收','4':'退签','5':'派送中','6':'退回中','7':'转投','8':'清关中','14':'拒签'};
function createLogistics({store,env=process.env,fetch=globalThis.fetch,now=Date.now}={}){
 if(env.LOGISTICS_PROVIDER!=='kuaidi100')return require('./wechat-logistics').createWechatLogistics({store,env,fetch,now});
 const key=env.KUAIDI100_KEY,customer=env.KUAIDI100_CUSTOMER;
 return {async tracking(actor,input){
  // Always authorize the order before touching cache or making paid external requests.
  const order=await store.execute(actor,'order',{id:input.id},{mock:actor.channel!=='wechat'}),s=order.shipping;
  const base={company:s?.company||'',number:s?.number||'',events:[],provider:'kuaidi100',notice:''};
  if(order.fulfillment?.type==='PICKUP')return {...base,notice:'自提订单无需查询快递物流'};
  if(!s)return {...base,notice:'商家尚未发货，发货后可查看快递单号及物流'};
  if(!Object.prototype.hasOwnProperty.call(carriers,s.carrier)||! /^[A-Za-z0-9-]{6,32}$/.test(s.number||''))return {...base,notice:'历史配送记录缺少有效快递公司或运单号，请联系商家核实'};
  if(!key||!customer)return {...base,notice:'物流查询服务尚未开通，可复制快递单号向承运公司查询'};
  const phone=['shunfeng','shunfengkuaiyun','zhongtong'].includes(s.carrier)?order.address?.phone||'':'';
  const id=createHash('sha256').update(JSON.stringify([s.carrier,s.number,phone])).digest('hex'),token=randomUUID(),at=now();
  const record=await store.claimLogistics(id,at,at+INTERVAL,token);
  if(record.token!==token)return {...base,...record.result,cached:true,nextCheckAt:record.nextAt,notice:record.result?.notice||'物流正在查询，请稍后刷新'};
  let result;
  try{
   const param=JSON.stringify({com:s.carrier,num:s.number,phone,show:'0',order:'desc',lang:'zh'});
   const sign=createHash('md5').update(param+key+customer).digest('hex').toUpperCase();
   const response=await fetch('https://poll.kuaidi100.com/poll/query.do',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({customer,sign,param}).toString(),signal:AbortSignal.timeout(8000)});
   if(!response.ok)throw Error('UPSTREAM_UNAVAILABLE');
   const body=await response.json();
   if(body.result===false||String(body.status)!=='200'){
    const code=String(body.returnCode||body.status||'');
    const notice=code==='500'?'快递公司暂未返回轨迹，请稍后查看':code==='408'?'运单手机号校验未通过，请联系商家核对收件手机号':'物流服务暂不可用，请稍后查询或联系商家核对接口额度';
    result={...(record.result||{}),notice,stale:!!record.result?.events?.length};
   }else{
    if(String(body.nu).toLowerCase()!==s.number.toLowerCase()||body.com!==s.carrier||!Array.isArray(body.data))throw Error('MISMATCHED_TRACKING');
    const events=body.data.slice(0,200).map((e,i)=>({key:'express-'+i,timeText:String(e.ftime||e.time||'').slice(0,40),text:String(e.context||'').slice(0,2000),status:String(e.status||'物流更新').slice(0,80)}));
    result={events,state:String(body.state||''),statusText:states[String(body.state)]||'物流更新',updatedAt:now(),stale:false,notice:events.length?'物流由快递公司提供；物流签收不等于您已确认收货':'快递公司暂未返回轨迹，请稍后查看'};
   }
  }catch{result={...(record.result||{}),stale:!!record.result?.events?.length,notice:'物流查询暂时失败，已保留上次记录，请稍后再试'};}
  await store.saveLogistics(id,token,result);
  return {...base,...result,cached:false,nextCheckAt:at+INTERVAL};
 }};
}
module.exports={createLogistics,INTERVAL};
