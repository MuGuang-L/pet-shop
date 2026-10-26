"use strict";
const fs=require('node:fs/promises'),path=require('node:path');
const {MongoStore}=require('../server/mongo-store');
const {dataDirectory}=require('../server/data-paths');
const {createBackup,verifyBackup,restoreBackup,sha256}=require('../server/backup');
async function main(){
 const [action,source,database,destination]=process.argv.slice(2);
 if(action==='backup'){
  const store=await MongoStore.connect();try{const out=await createBackup({store});console.log(JSON.stringify({ok:true,id:out.id,counts:out.manifest.counts}));}finally{await store.close();}
 }else if(action==='status'){
  try{const status=JSON.parse(await fs.readFile(path.join(dataDirectory,'backup-status.json'),'utf8'));console.log(JSON.stringify({lastSuccessAt:status.lastSuccessAt,lastAttemptAt:status.lastAttemptAt,nextAttemptAt:status.nextAttemptAt,lastBackupId:status.lastBackupId,error:status.error,retentionError:status.retentionError,overdue:Date.now()>status.nextAttemptAt+120000}));}catch(e){if(e.code!=='ENOENT')throw e;console.log(JSON.stringify({status:'NOT_STARTED',message:'No scheduled backup has run in this data directory.'}));}
 }else if(action==='verify'){
  if(!source)throw Error('Usage: npm run db:verify -- <backup-folder>');const out=await verifyBackup(path.resolve(source));console.log(JSON.stringify({ok:true,id:out.manifest.id,counts:out.manifest.counts}));
 }else if(action==='restore'){
  if(!source||!/^pet_shop_restore_[a-zA-Z0-9_]+$/.test(database||''))throw Error('Usage: npm run db:restore -- <backup-folder> pet_shop_restore_<new_name> [new-data-directory]');
  if((await fs.stat(source)).isFile()){
   const backup=JSON.parse(await fs.readFile(source,'utf8'));if(backup.format!==1||sha256(JSON.stringify(backup.state))!==backup.sha256)throw Error('BACKUP_CHECKSUM_MISMATCH');
   const store=await MongoStore.connect({database});try{await store.restore(backup.state);console.log(JSON.stringify({ok:true,database,legacy:true,warning:'Business data only. Accounts, audit and images were not restored.'}));}finally{await store.close();}
  }else{
   const parent=path.join(dataDirectory,'restores');if(!destination)await fs.mkdir(parent,{recursive:true,mode:0o700});
   const report=await restoreBackup({directory:path.resolve(source),database,destination:destination?path.resolve(destination):path.join(parent,database)});console.log(JSON.stringify({ok:true,...report}));
  }
 }else throw Error('Expected backup, verify, restore or status');
}
main().catch(e=>{const known=/^(BACKUP_|RESTORE_|INVALID_BACKUP|Usage:|Expected )/.test(e.message);console.error(known?e.message:'Backup operation failed ('+(e.code||e.name)+'). Current shop data was not replaced.');process.exitCode=1;});
