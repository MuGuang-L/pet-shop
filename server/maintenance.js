'use strict';
// Idle scans remain bounded so work left by another instance is rediscovered.
// Known unfinished orders/payments never use the idle interval.
function createMaintenance({getStore,reconcile,paymentEnabled=false,paymentInterval=60000,idleInterval=15*60000,now=Date.now,logger=console}){
 let nextScan=0,nextPayment=0,generation=0,busy=0,expiryTask=null,paymentTask=null,discoveryTask=null,failures=0;
 function activity(){generation++;busy++;nextScan=0;let ended=false;return ()=>{if(!ended){ended=true;busy--;generation++;nextScan=0;}};}
 function tick(){
  if(now()<nextScan)return Promise.resolve();
  const store=getStore();if(!store)return Promise.resolve();
  const stamp=generation,failStamp=failures;
  if(!expiryTask)expiryTask=(async()=>{
   try{await store.execute({id:'system',merchant:true},'expire',{},{mock:true});}
   catch(error){failures++;logger.error('Order expiry unavailable:',error.name);}
  })().finally(()=>{expiryTask=null;});
  if(!paymentTask&&paymentEnabled&&now()>=nextPayment){
   nextPayment=now()+paymentInterval;
   paymentTask=(async()=>{
    try{const result=await reconcile();if(result.failed){failures++;logger.error('Payment reconciliation pending retries:',result.failed);}}
    catch{failures++;logger.error('Payment reconciliation unavailable; will retry.');}
   })().finally(()=>{paymentTask=null;});
  }
  // A slow payment provider must not hold up order expiry. Each worker is
  // single-flight independently; callers can tick again while payment runs.
  return Promise.all([expiryTask,paymentTask,discoveryTask]).then(async()=>{
   if(failures!==failStamp||busy||generation!==stamp||expiryTask||paymentTask||discoveryTask||now()<nextScan)return;
   if(store.engine!=='mysql'||typeof store.hasBackgroundWork!=='function')return;
   discoveryTask=(async()=>{
    try{const pending=await store.hasBackgroundWork();if(!pending&&!busy&&generation===stamp&&!expiryTask&&!paymentTask&&failures===failStamp)nextScan=now()+idleInterval;}
    catch(error){failures++;logger.error('Background work discovery unavailable:',error.name);}
   })().finally(()=>{discoveryTask=null;});
   await discoveryTask;
  });
 }

 return {tick,activity};
}
module.exports={createMaintenance};
