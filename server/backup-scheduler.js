'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {createBackup,pruneBackups}=require('./backup');
const {dataDirectory:defaultDataDirectory}=require('./data-paths');
async function saveStatus(file,state){await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const temporary=file+'.'+crypto.randomBytes(4).toString('hex')+'.tmp';try{await fs.writeFile(temporary,JSON.stringify(state,null,2),{flag:'wx',mode:0o600});await fs.rename(temporary,file);}finally{await fs.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
function createBackupScheduler({getStore,dataDirectory=defaultDataDirectory,backupRoot=process.env.SHOP_BACKUP_DIR||path.join(dataDirectory,'backups'),intervalMs=86400000,retryMs=900000,keep=14,minAgeDays=7,now=Date.now,logger=console,runBackup}={}){
 if(!Number.isFinite(intervalMs)||intervalMs<60000||!Number.isFinite(retryMs)||retryMs<1000)throw Error('BACKUP_INTERVAL_INVALID');
 if(!Number.isSafeInteger(keep)||keep<2||!Number.isFinite(minAgeDays)||minAgeDays<1)throw Error('BACKUP_RETENTION_INVALID');
 const statusFile=path.join(dataDirectory,'backup-status.json');let state={format:1,lastSuccessAt:0,lastAttemptAt:0,nextAttemptAt:0},task=null,timer=null,stopped=false;
 const initialized=(async()=>{try{const saved=JSON.parse(await fs.readFile(statusFile,'utf8'));if(saved.format!==1||!Number.isFinite(saved.nextAttemptAt)||!Number.isFinite(saved.lastSuccessAt)||!Number.isFinite(saved.lastAttemptAt))throw Error('INVALID_BACKUP_STATUS');state={...saved,nextAttemptAt:Math.min(saved.nextAttemptAt,now()+intervalMs)};}catch(e){if(e.code!=='ENOENT')logger.error('Backup status unavailable; a new verified backup will be attempted.');}})();
 const backup=runBackup||(()=>createBackup({store:getStore(),dataDirectory,backupRoot,now:new Date(now())}));
 const tick=()=>{
  if(stopped)return Promise.resolve();if(task)return task;
  task=(async()=>{await initialized;if(stopped||now()<state.nextAttemptAt)return;
   state.lastAttemptAt=now();
   try{
    const result=await backup();
    state={...state,lastSuccessAt:now(),lastBackupId:result.id,nextAttemptAt:now()+intervalMs,error:null};
    try{await pruneBackups({backupRoot,keep,minAgeDays,now:now()});state.retentionError=null;}catch{state.retentionError='RETENTION_FAILED';logger.error('Backup retention failed; existing packages were kept.');}
    logger.log('Verified backup completed.');
   }catch{state={...state,nextAttemptAt:now()+retryMs,error:'BACKUP_FAILED'};logger.error('Backup failed; retry scheduled. Existing backups were kept.');}
   try{await saveStatus(statusFile,state);}catch{logger.error('Backup status could not be saved.');}
  })().finally(()=>{task=null;});return task;
 };
 return {tick,status:()=>({...state,running:!!task}),start(){if(!timer&&!stopped){timer=setInterval(()=>{void tick();},60000);timer.unref();}},async stop(){stopped=true;clearInterval(timer);if(task)await task;}};
}
module.exports={createBackupScheduler};
