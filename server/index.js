'use strict';
const {MongoStore}=require('./mongo-store');
const {createServer}=require('./http');

// Keep HTTP available while MongoDB starts. Never buffer writes while offline.
async function start({connect=()=>MongoStore.connect(),port=4173,host='127.0.0.1',retryDelay=1000,logger=console,httpOptions={},backupOptions=null}={}){
 let store=null,stopping=false,retryTimer=null,connecting=null,ticking=false,tickTask=null,delay=retryDelay;
 const backups=backupOptions?require('./backup-scheduler').createBackupScheduler({...backupOptions,getStore:()=>current(),logger}):null;
 const current=()=>{if(store)return store;const error=Error('DATABASE_NOT_READY');error.name='MongoServerSelectionError';throw error;};
 const server=createServer({db:{command:input=>current().db.command(input)},execute:(...args)=>current().execute(...args)},httpOptions);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve();});});
 const attempt=()=>{
  connecting=(async()=>{
   try{const connected=await connect();if(stopping){await connected.close();return;}store=connected;logger.log('Database connection ready.');if(backups){backups.start();void backups.tick();}}
   catch(e){
    if(stopping)return;
    logger.error('Database initialization unavailable:',e.name);
    // Retry transient connectivity failures; configuration errors need correction.
    if(/Mongo(Network|ServerSelection|Timeout|PoolCleared|WaitQueueTimeout)/.test(e.name)){
     retryTimer=setTimeout(attempt,delay);retryTimer.unref();delay=Math.min(delay*2,30000);
    }
   }
  })().finally(()=>{connecting=null;});
 };
 attempt();
 const timer=setInterval(()=>{
  if(stopping||!store||ticking)return;ticking=true;
  tickTask=store.execute({id:'system',merchant:true},'expire',{}, {mock:true})
   .catch(e=>logger.error('Order expiry unavailable:',e.name)).finally(()=>{ticking=false;tickTask=null;});
 },10000);timer.unref();
 let shutdown;
 const stop=()=>shutdown||(shutdown=(async()=>{
  stopping=true;clearTimeout(retryTimer);clearInterval(timer);
  await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});
  if(backups)await backups.stop();if(connecting)await connecting;if(tickTask)await tickTask;if(store)await store.close();
 })());
 logger.log('Shop HTTP service listening; database readiness is reported by /health.');
 return {server,stop};
}
if(require.main===module)start({backupOptions:{intervalMs:Number(process.env.BACKUP_INTERVAL_HOURS||24)*3600000,keep:Number(process.env.BACKUP_KEEP||14),minAgeDays:Number(process.env.BACKUP_MIN_AGE_DAYS||7)}}).then(({stop})=>{
 const shutdown=()=>{stop().then(()=>process.exit(0),()=>process.exit(1));};
 process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}).catch(e=>{console.error('Shop startup failed:',e.name);process.exitCode=1;});
module.exports={start};
