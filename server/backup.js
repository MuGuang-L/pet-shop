'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {dataDirectory:defaultDataDirectory}=require('./data-paths');
const {MongoStore}=require('./mongo-store');
const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
const folderPattern=/^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}$/;
const filePattern=/^(business\.json|audit\.json|auth\/accounts\.json|uploads\/[a-f0-9-]+\.(png|jpg))$/;
const need=(condition,code)=>{if(!condition)throw Error(code);};
function inside(root,relative){const target=path.resolve(root,relative),part=path.relative(path.resolve(root),target);need(part&&!part.startsWith('..')&&!path.isAbsolute(part),'BACKUP_PATH_OUTSIDE_ROOT');return target;}
async function regularFile(root,relative){
 need(filePattern.test(relative),'BACKUP_INVALID_FILE');
 const parts=relative.split('/');let target=root;
 for(let i=0;i<parts.length;i++){target=path.join(target,parts[i]);const stat=await fs.lstat(target);need(!stat.isSymbolicLink()&&(i===parts.length-1?stat.isFile():stat.isDirectory()),'BACKUP_LINK_OR_NONFILE');if(i===parts.length-1&&relative.startsWith('uploads/'))need(stat.size<=2*1024*1024,'BACKUP_IMAGE_TOO_LARGE');}
 return fs.readFile(target);
}
function accountsValid(accounts){
 need(Array.isArray(accounts)&&accounts.length>0,'BACKUP_ACCOUNTS_INVALID');
 const usernames=new Set(),identities=new Set();
 for(const a of accounts){need(a&&typeof a.username==='string'&&a.username.length>0&&!usernames.has(a.username)&&typeof a.id==='string'&&a.id.length>0&&!identities.has(a.id)&&['merchant','buyer'].includes(a.role)&&/^[a-f0-9]{32}$/.test(a.salt)&&/^[a-f0-9]{64}$/.test(a.hash),'BACKUP_ACCOUNTS_INVALID');usernames.add(a.username);identities.add(a.id);}
 need(accounts.some(a=>a.role==='merchant'),'BACKUP_MERCHANT_MISSING');
 // Plaintext passwords, sessions and tunnel credentials are deliberately excluded.
 return accounts.map(({username,role,id,salt,hash})=>({username,role,id,salt,hash}));
}
function references(state){const found=new Set();function walk(value){if(typeof value==='string'&&value.startsWith('/uploads/')){const name=value.slice(1);need(filePattern.test(name),'BACKUP_IMAGE_REFERENCE_INVALID');found.add(name);}else if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')Object.values(value).forEach(walk);}walk(state);return found;}
async function write(root,relative,data){const target=inside(root,relative);await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});await fs.writeFile(target,data,{flag:'wx',mode:0o600});return {bytes:Buffer.byteLength(data),sha256:sha256(data)};}
async function createBackup({store,dataDirectory=defaultDataDirectory,backupRoot=process.env.SHOP_BACKUP_DIR||path.join(dataDirectory,'backups'),now=new Date()}={}){
 const snapshot=await store.backupSnapshot();
 const accounts=accountsValid(JSON.parse(await regularFile(dataDirectory,'auth/accounts.json')));
 const id='backup-'+now.toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex');
 await fs.mkdir(backupRoot,{recursive:true,mode:0o700});const destination=inside(backupRoot,id);await fs.mkdir(destination,{mode:0o700});
 // Publish the manifest last. Interrupted copies are never accepted as backups.
 const files={};
 files['business.json']=await write(destination,'business.json',JSON.stringify(snapshot.state));
 files['audit.json']=await write(destination,'audit.json',JSON.stringify(snapshot.audit));
 files['auth/accounts.json']=await write(destination,'auth/accounts.json',JSON.stringify(accounts));
 const uploadRoot=path.join(dataDirectory,'uploads');let names=[];
 try{const stat=await fs.lstat(uploadRoot);need(stat.isDirectory()&&!stat.isSymbolicLink(),'BACKUP_LINK_OR_NONFILE');names=await fs.readdir(uploadRoot);}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const name of names.sort())if(filePattern.test('uploads/'+name)){const relative='uploads/'+name;files[relative]=await write(destination,relative,await regularFile(dataDirectory,relative));}
 for(const relative of references(snapshot.state))need(files[relative],'BACKUP_REFERENCED_IMAGE_MISSING');
 const manifest={format:2,id,createdAt:now.toISOString(),database:store.db.databaseName,schemaVersion:1,revision:snapshot.revision,files,
  counts:{products:snapshot.state.products.length,orders:snapshot.state.orders.length,audit:snapshot.audit.length,accounts:accounts.length,uploads:Object.keys(files).filter(n=>n.startsWith('uploads/')).length}};
 await fs.writeFile(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
 await verifyBackup(destination);return {id,directory:destination,manifest};
}
async function verifyBackup(directory){
 const stat=await fs.lstat(directory);need(stat.isDirectory()&&!stat.isSymbolicLink(),'BACKUP_LINK_OR_NONFILE');
 const manifestPath=path.join(directory,'manifest.json'),manifestStat=await fs.lstat(manifestPath);need(manifestStat.isFile()&&!manifestStat.isSymbolicLink(),'BACKUP_LINK_OR_NONFILE');
 const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
 need(manifest.format===2&&manifest.schemaVersion===1&&folderPattern.test(manifest.id)&&Number.isSafeInteger(manifest.revision)&&manifest.revision>=0&&Number.isFinite(Date.parse(manifest.createdAt))&&manifest.files&&typeof manifest.files==='object'&&!Array.isArray(manifest.files),'BACKUP_MANIFEST_INVALID');
 const contents={};
 for(const [relative,expected] of Object.entries(manifest.files)){
  need(expected&&Number.isSafeInteger(expected.bytes)&&expected.bytes>=0&&/^[a-f0-9]{64}$/.test(expected.sha256),'BACKUP_MANIFEST_INVALID');
  const data=await regularFile(directory,relative);need(data.length===expected.bytes&&sha256(data)===expected.sha256,'BACKUP_CHECKSUM_MISMATCH');if(!relative.startsWith('uploads/'))contents[relative]=data;
 }
 for(const required of ['business.json','audit.json','auth/accounts.json'])need(contents[required],'BACKUP_REQUIRED_FILE_MISSING');
 const state=JSON.parse(contents['business.json']),audit=JSON.parse(contents['audit.json']),accounts=accountsValid(JSON.parse(contents['auth/accounts.json']));
 need(state?.version===1&&Array.isArray(state.products)&&Array.isArray(state.orders)&&Array.isArray(audit),'BACKUP_CONTENT_INVALID');
 need(state.addresses&&state.keys&&state.events,'BACKUP_CONTENT_INVALID');
 const ids=new Set();for(const row of audit){need(row&&typeof row._id==='string'&&!ids.has(row._id)&&Number.isFinite(Date.parse(row.at))&&typeof row.actor==='string'&&typeof row.action==='string'&&Number.isSafeInteger(row.revision)&&row.revision>0&&row.revision<=manifest.revision&&Array.isArray(row.orderIds),'BACKUP_AUDIT_INVALID');ids.add(row._id);}
 for(const relative of references(state))need(manifest.files[relative],'BACKUP_REFERENCED_IMAGE_MISSING');
 const counts={products:state.products.length,orders:state.orders.length,audit:audit.length,accounts:accounts.length,uploads:Object.keys(manifest.files).filter(n=>n.startsWith('uploads/')).length};
 need(require('node:util').isDeepStrictEqual(manifest.counts,counts),'BACKUP_COUNTS_MISMATCH');
 return {manifest,state,audit,accounts,contents};
}
async function restoreBackup({directory,database,destination,connect=options=>MongoStore.connect(options)}={}){
 need(/^pet_shop_restore_[a-zA-Z0-9_]+$/.test(database||''),'RESTORE_REQUIRES_NEW_pet_shop_restore_DATABASE');
 need(typeof destination==='string'&&destination.length>0,'RESTORE_DESTINATION_REQUIRED');
 const backup=await verifyBackup(directory);destination=path.resolve(destination);
 // mkdir without recursive is deliberate: neither an existing directory nor its
 // files may be overwritten. The parent is selected explicitly by the operator.
 await fs.mkdir(destination,{mode:0o700});
 await fs.writeFile(path.join(destination,'RESTORE_INCOMPLETE'),'Do not start this instance. Restore has not completed.',{flag:'wx',mode:0o600});
 for(const relative of Object.keys(backup.manifest.files))if(relative==='auth/accounts.json'||relative.startsWith('uploads/')){const data=await regularFile(directory,relative);need(sha256(data)===backup.manifest.files[relative].sha256,'BACKUP_CHECKSUM_MISMATCH');await write(destination,relative,data);}
 let store;
 try{
  store=await connect({database});
  await store.restoreSnapshot({state:backup.state,audit:backup.audit,revision:backup.manifest.revision,backupId:backup.manifest.id});
  const restored=await store.backupSnapshot();need(sha256(JSON.stringify(restored.state))===sha256(JSON.stringify(backup.state)),'RESTORE_BUSINESS_MISMATCH');
  const restoredAudit=new Map(restored.audit.map(r=>[r._id,r]));for(const row of backup.audit)need(JSON.stringify(restoredAudit.get(row._id))===JSON.stringify({...row,at:new Date(row.at)}),'RESTORE_AUDIT_MISMATCH');
  for(const relative of Object.keys(backup.manifest.files).filter(n=>n==='auth/accounts.json'||n.startsWith('uploads/')))need(sha256(await regularFile(destination,relative))===backup.manifest.files[relative].sha256,'RESTORE_FILE_MISMATCH');
  const report={format:1,backupId:backup.manifest.id,database,restoredAt:new Date().toISOString(),verified:true,counts:backup.manifest.counts};
  await fs.writeFile(path.join(destination,'restore-report.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  await fs.unlink(path.join(destination,'RESTORE_INCOMPLETE'));return report;
 }finally{if(store)await store.close();}
}
async function pruneBackups({backupRoot,keep=14,minAgeDays=7,now=Date.now()}={}){
 need(Number.isSafeInteger(keep)&&keep>=2&&Number.isFinite(minAgeDays)&&minAgeDays>=1,'BACKUP_RETENTION_INVALID');
 const root=await fs.realpath(backupRoot),valid=[];
 for(const name of await fs.readdir(root))if(folderPattern.test(name))try{const candidate=inside(root,name),backup=await verifyBackup(candidate);if(backup.manifest.id===name)valid.push({name,createdAt:Date.parse(backup.manifest.createdAt)});}catch{/* Keep incomplete or damaged packages for investigation. */}
 valid.sort((a,b)=>b.createdAt-a.createdAt||b.name.localeCompare(a.name));const removed=[];
 for(const item of valid.slice(keep))if(item.createdAt<now-minAgeDays*86400000){
  const target=inside(root,item.name);need(await fs.realpath(target)===target,'BACKUP_PATH_OUTSIDE_ROOT');
  await fs.rm(target,{recursive:true});removed.push(item.name);
 }
 return removed;
}
module.exports={createBackup,verifyBackup,restoreBackup,pruneBackups,sha256};
