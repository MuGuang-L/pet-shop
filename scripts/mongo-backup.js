'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {MongoStore}=require('../server/mongo-store');
const root=path.resolve(__dirname,'..');
async function main(){const action=process.argv[2];
 if(action==='backup'){
  const store=await MongoStore.connect();try{const state=await store.snapshot();const payload=JSON.stringify(state);const dir=path.join(root,'.local','backups',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'business.json'),JSON.stringify({format:1,createdAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(payload).digest('hex'),state},null,2));const uploads=path.join(root,'.local','uploads');if(fs.existsSync(uploads))fs.cpSync(uploads,path.join(dir,'uploads'),{recursive:true});console.log('Backup saved: '+dir);console.log('Business snapshot and uploaded pictures. Audit logs are not included.');}finally{await store.close();}
 }else if(action==='restore'){
  const [file,database]=process.argv.slice(3);if(!file||!/^pet_shop_restore_[a-zA-Z0-9_]+$/.test(database||''))throw Error('Usage: npm run db:restore -- <business.json> pet_shop_restore_<new_name>');
  const backup=JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));if(backup.format!==1||crypto.createHash('sha256').update(JSON.stringify(backup.state)).digest('hex')!==backup.sha256)throw Error('BACKUP_CHECKSUM_MISMATCH');
  const store=await MongoStore.connect({database});try{await store.restore(backup.state);console.log('Business snapshot restored into '+database+'; current database unchanged.');console.log('Keep the uploads/ folder with this backup; existing local uploads have not been overwritten.');}finally{await store.close();}
 }else throw Error('Expected backup or restore');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
