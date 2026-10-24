'use strict';
const cloud=require('wx-server-sdk');
const {execute}=require('./domain');
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});
// No input role, OPENID, mode or payment callback is trusted from event data.
exports.main=async(event)=>{
  try {
    const {OPENID}=cloud.getWXContext();
    if(!OPENID)throw Error('AUTH_REQUIRED');
    if(!event||typeof event.action!=='string')throw Error('INVALID_REQUEST');
    const db=cloud.database();
    const transactionResult=await db.runTransaction(async tx=>{
      // Transactions support doc(), not where(). Membership is keyed by OPENID.
      const member=await tx.collection('merchants').doc(OPENID).get().catch(()=>({data:null}));
      const actor={id:OPENID,merchant:!!(member.data&&member.data.enabled===true)};
      const doc=await tx.collection('shop_state').doc('singleton').get();
      if(!doc.data||!doc.data.value)throw Error('STORE_NOT_INITIALIZED');
      const {state,result}=execute(doc.data.value,actor,event.action,event.input||{},{mock:false});
      if(Buffer.byteLength(JSON.stringify(state),'utf8')>750000)throw Error('DEV_CAPACITY_LIMIT');
      await tx.collection('shop_state').doc('singleton').update({data:{value:state}});
      return {ok:true,data:result};
    });
    return transactionResult.result || transactionResult;
  } catch(e) { return {ok:false,error:e.message||'SERVER_ERROR'}; }
};
