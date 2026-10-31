'use strict';
const fs=require('node:fs');
const {MysqlStore,mysqlSettings}=require('./mysql-store');
const {createServer}=require('./http');
const {loadWechat}=require('./wechat-config');
const {Auth,createAccount,location}=require('./auth');
function resolveAuth(){
 if(fs.existsSync(location))return new Auth();
 const username=String(process.env.MERCHANT_USERNAME||'').trim().toLowerCase();
 const password=process.env.MERCHANT_PASSWORD||'';
 if(!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(username)||password.length<8||password.length>200)throw Error('MERCHANT_ACCOUNT_REQUIRED');
 return new Auth([createAccount(username,password,'merchant','merchant')]);
}

function connectDatabase(){return mysqlSettings()?MysqlStore.connect():require('./mongo-store').MongoStore.connect();}
// Keep HTTP available while the database starts, including a paused serverless MySQL instance. Never buffer writes while offline.
async function start({connect=connectDatabase,port=4173,host='127.0.0.1',retryDelay=1000,logger=console,httpOptions={},backupOptions=null,paymentInterval=60000}={}){
 let store=null,stopping=false,retryTimer=null,connecting=null,tickTask=null,delay=retryDelay;
 const backups=backupOptions?require('./backup-scheduler').createBackupScheduler({...backupOptions,getStore:()=>current(),logger}):null;
 const current=()=>{if(store)return store;const error=Error('DATABASE_NOT_READY');error.name='MysqlUnavailable';throw error;};
 const wechat=httpOptions.wechat===undefined?loadWechat():httpOptions.wechat;
 const facade={get engine(){return current().engine;},ping:()=>{const db=current();return typeof db.ping==='function'?db.ping():db.db.command({ping:1});},get db(){return current().db;},execute:(...args)=>current().execute(...args),settlePayment:(payload,at)=>current().settlePayment(payload,at),settleRefund:(payload,at)=>current().settleRefund(payload,at),upsertTrade:doc=>current().upsertTrade(doc),getTrade:id=>current().getTrade(id),tradesByOrder:id=>current().tradesByOrder(id)};
 for(const method of ['reserveTrade','saveTrade','pendingTrades'])facade[method]=(...args)=>current()[method](...args);
 const maintenance=require('./maintenance').createMaintenance({getStore:()=>store,reconcile:()=>server.reconcilePayments(),paymentEnabled:!!wechat?.payReady,paymentInterval,logger});
 const server=createServer(facade,{...httpOptions,auth:httpOptions.auth||resolveAuth(),wechat,onActivity:maintenance.activity});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve();});});
 const attempt=()=>{
  connecting=(async()=>{
   try{const connected=await connect();if(stopping){await connected.close();return;}store=connected;logger.log('Database connection ready.');if(backups){backups.start();void backups.tick();}}
   catch(e){
    if(stopping)return;
    logger.error('Database initialization unavailable:',e.name,e.message||'');
    // Retry paused or unreachable MySQL. A wrong database name or password is logged once.
    if(e.name==='MysqlUnavailable'||/Mongo(Network|ServerSelection|Timeout|PoolCleared|WaitQueueTimeout)/.test(e.name)){
     retryTimer=setTimeout(attempt,delay);retryTimer.unref();delay=Math.min(delay*2,30000);
    }
   }
  })().finally(()=>{connecting=null;});
 };
 attempt();
 const timer=setInterval(()=>{
  if(stopping||!store)return;
  tickTask=maintenance.tick();
 },Math.min(10000,paymentInterval));timer.unref();
 let shutdown;
 const stop=()=>shutdown||(shutdown=(async()=>{
  stopping=true;clearTimeout(retryTimer);clearInterval(timer);
  await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});
  if(backups)await backups.stop();if(connecting)await connecting;if(tickTask)await tickTask;if(store)await store.close();
 })());
 logger.log('Shop HTTP service listening; database readiness is reported by /health.');
 logger.log(wechat?.payReady?'WeChat Pay ready.':'WeChat Pay is not configured: '+(wechat?.payMissing||['config']).join(', '));
 return {server,stop};
}
if(require.main===module){
 const port=Number(process.env.PORT)||4173,host=process.env.PORT?'0.0.0.0':'127.0.0.1';
 const mysql=Boolean(mysqlSettings());
 const ready=start({port,host,backupOptions:mysql?null:{intervalMs:Number(process.env.BACKUP_INTERVAL_HOURS||24)*3600000,keep:Number(process.env.BACKUP_KEEP||14),minAgeDays:Number(process.env.BACKUP_MIN_AGE_DAYS||7)}});
 require('./process-lifecycle').attachShutdown(async()=>{const service=await ready.catch(()=>null);if(service)await service.stop();});
 // Keep the error code visible in platform logs.  CloudBase only reports a
 // generic restart loop when PID 1 exits, so printing just `Error` makes a
 // missing runtime variable impossible to diagnose.
 ready.catch(e=>{console.error('Shop startup failed:',e?.message||e?.name||'UNKNOWN_STARTUP_ERROR');process.exit(1);});
}
module.exports={start};
