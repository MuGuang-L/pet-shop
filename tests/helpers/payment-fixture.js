'use strict';
const domain=require('../../cloudfunctions/shop/domain');
const {createWechat}=require('../../server/wechat');
const copy=value=>structuredClone(value);
function memory(){
 let state=domain.seed();const trades=new Map();
 return {trades,state:()=>copy(state),db:{command:async()=>({ok:1})},close:async()=>{},
  async execute(actor,action,input,options){const out=domain.execute(state,actor,action,input,options);state=out.state;return out.result;},
  async settlePayment(payload,now){const out=domain.settleVerifiedPayment(state,payload,now);state=out.state;return out.result;},
  async settleRefund(payload,now){const out=domain.settleVerifiedRefund(state,payload,now);state=out.state;return out.result;},
  async reserveTrade(doc){const old=[...trades.values()].find(row=>row.orderId===doc.orderId);if(old)return copy(old);const saved={...doc,version:1};trades.set(doc.outTradeNo,copy(saved));return copy(saved);},
  async saveTrade(doc){if((trades.get(doc.outTradeNo)?.version||0)!==(doc.version||0))throw Error('PAYMENT_REVISION_CONFLICT');const saved={...doc,version:(doc.version||0)+1};trades.set(doc.outTradeNo,copy(saved));return copy(saved);},
  async getTrade(id){return copy(trades.get(id)||null);},
  async tradesByOrder(id){return [...trades.values()].filter(row=>row.orderId===id).map(copy);},
  async pendingTrades(at,limit=10){return [...trades.values()].filter(row=>!['SUCCESS','CLOSED','REFUNDED','DUPLICATE_REFUNDED'].includes(row.status)&&(row.nextCheckAt||0)<=at).sort((a,b)=>(a.nextCheckAt||0)-(b.nextCheckAt||0)).slice(0,limit).map(copy);}
 };
}
async function fixture(store=memory()){
 let clock=Date.now();const actor={id:'wx:test-openid-123',openid:'test-openid-123',channel:'wechat'};
 const order=await store.execute(actor,'createOrder',{key:'payment-recovery-test',fulfillment:'PICKUP',contact:{name:'模拟验收',phone:'13800000000'},lines:[{productId:'food',skuId:'food-1',qty:1}]},{mock:false,now:clock});
 const calls=[],remote=new Map();const behavior={timeoutOnce:false,refundFailure:false,closeRace:false};
 const settings={payReady:true,config:{mchId:'test-merchant',cloudEnv:'test-env',cloudService:'pet-shop'}};
 const fetch=async(url,options)=>{
  const body=JSON.parse(options.body),action=url.split('/').at(-1);calls.push({action,body});
  await new Promise(resolve=>setTimeout(resolve,3));
  let row=remote.get(body.out_trade_no),data={return_code:'SUCCESS',result_code:'SUCCESS'};
  if(action==='unifiedOrder'){
   if(!row){row={state:'NOTPAY',body,transactionId:'tx-'+body.out_trade_no};remote.set(body.out_trade_no,row);}
   if(behavior.timeoutOnce){behavior.timeoutOnce=false;throw Error('ETIMEDOUT');}
   Object.assign(data,{prepay_id:'prepay-'+body.out_trade_no,payment:{timeStamp:'1700000000',nonceStr:'test-nonce',package:'prepay_id='+body.out_trade_no,signType:'MD5',paySign:'test-signature'}});
  }else if(action==='queryorder'){
   if(!row)Object.assign(data,{result_code:'FAIL',err_code:'ORDERNOTEXIST'});
   else Object.assign(data,{trade_state:row.state,transaction_id:row.transactionId,out_trade_no:body.out_trade_no,total_fee:row.body.total_fee,sub_mch_id:row.body.sub_mch_id,sub_openid:actor.openid,fee_type:'CNY'});
  }else if(action==='closeorder'){
   if(behavior.closeRace){row.state='SUCCESS';Object.assign(data,{result_code:'FAIL',err_code:'ORDERPAID'});}else row.state='CLOSED';
  }else if(action==='refund'||action==='queryrefund'){
   if(behavior.refundFailure)throw Error('UPSTREAM_TEMPORARY');
   Object.assign(data,{refund_status:'SUCCESS',out_refund_no:body.out_refund_no,refund_id:'refund-'+body.out_trade_no,refund_fee:order.total});
  }else throw Error('UNEXPECTED_ACTION');
  return {ok:true,status:200,text:async()=>JSON.stringify({errcode:0,respdata:data})};
 };
 const gateway=otherStore=>createWechat({store:otherStore||store,settings,fetch,now:()=>clock});
 return {store,actor,order,calls,remote,behavior,settings,fetch,gateway,now:()=>clock,advance:ms=>clock+=ms};
}
module.exports={memory,fixture};
