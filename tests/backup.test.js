'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createBackup,verifyBackup,restoreBackup,pruneBackups,sha256}=require('../server/backup');
const {createBackupScheduler}=require('../server/backup-scheduler');
const {createAccount,Auth}=require('../server/auth'),{seed}=require('../cloudfunctions/shop/domain');
const {MongoStore}=require('../server/mongo-store'),{createServer}=require('../server/http');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFuoAAAAASUVORK5CYII=','base64');
const accounts=[createAccount('merchant','restore-test-password','merchant','backup-owner'),createAccount('buyer','buyer-test-password','buyer','backup-buyer')];
async function fixture(fn){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pet-backup-test-'));
 try{const data=path.join(root,'data');await fs.mkdir(path.join(data,'auth'),{recursive:true});await fs.mkdir(path.join(data,'uploads'));await fs.writeFile(path.join(data,'auth/accounts.json'),JSON.stringify(accounts));await fs.writeFile(path.join(data,'auth/credentials.txt'),'NOT INCLUDED');await fs.writeFile(path.join(data,'uploads/abc-123.png'),png);
  const state=seed();state.products[0].image='/uploads/abc-123.png';const snapshot={state,audit:[],revision:0},store={db:{databaseName:'pet_shop_test_fake'},backupSnapshot:async()=>structuredClone(snapshot)};
  await fn({root,data,store,snapshot,backupRoot:path.join(data,'backups')});
 }finally{const resolved=await fs.realpath(root),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(resolved),parent);assert.match(path.basename(resolved),/^pet-backup-test-/);await fs.rm(resolved,{recursive:true});}
}
test('完整备份：校验业务、审计、密码哈希和图片，不包含明文密码或会话',async()=>fixture(async f=>{
 const out=await createBackup({store:f.store,dataDirectory:f.data}),verified=await verifyBackup(out.directory);
 assert.deepEqual(verified.state,f.snapshot.state);assert.deepEqual(verified.accounts,accounts);assert.deepEqual(await fs.readFile(path.join(out.directory,'uploads/abc-123.png')),png);assert.equal(verified.contents['uploads/abc-123.png'],undefined);
 assert.deepEqual(Object.keys(verified.manifest.files).sort(),['audit.json','auth/accounts.json','business.json','uploads/abc-123.png']);assert.doesNotMatch(JSON.stringify(verified),/NOT INCLUDED|restore-test-password|buyer-test-password/);
 assert.equal(verified.manifest.counts.uploads,1);assert.equal(verified.manifest.counts.accounts,2);
}));
test('完整备份：图片丢失、文件损坏、缺少账号均不能通过校验',async()=>fixture(async f=>{
 const out=await createBackup({store:f.store,dataDirectory:f.data});await fs.appendFile(path.join(out.directory,'business.json'),' ');await assert.rejects(verifyBackup(out.directory),/BACKUP_CHECKSUM_MISMATCH/);
 await fs.unlink(path.join(f.data,'uploads/abc-123.png'));await assert.rejects(createBackup({store:f.store,dataDirectory:f.data}),/BACKUP_REFERENCED_IMAGE_MISSING/);
 await fs.unlink(path.join(f.data,'auth/accounts.json'));await assert.rejects(createBackup({store:f.store,dataDirectory:f.data}),/ENOENT/);
}));
test('完整备份：恢复前拒绝越界文件、错误目标、损坏包及已有目录',async()=>fixture(async f=>{
 const out=await createBackup({store:f.store,dataDirectory:f.data});let connections=0;const connect=()=>{connections++;throw Error('must not connect');};
 await assert.rejects(restoreBackup({directory:out.directory,database:'pet_shop_demo',destination:path.join(f.root,'restore'),connect}),/RESTORE_REQUIRES_NEW/);
 await assert.rejects(restoreBackup({directory:out.directory,database:'pet_shop_restore_test',destination:f.data,connect}),/EEXIST/);
 const manifest=out.manifest;manifest.files['../escape.json']={bytes:0,sha256:sha256('')};await fs.writeFile(path.join(out.directory,'manifest.json'),JSON.stringify(manifest));
 await assert.rejects(restoreBackup({directory:out.directory,database:'pet_shop_restore_test',destination:path.join(f.root,'restore'),connect}),/BACKUP_INVALID_FILE/);assert.equal(connections,0);
}));
test('完整备份：图片目录链接不能夹带目录外文件',async()=>fixture(async f=>{
 const linked=path.join(f.root,'linked');await fs.mkdir(linked);await fs.writeFile(path.join(linked,'abc-123.png'),png);await fs.rename(path.join(f.data,'uploads'),path.join(f.data,'original-uploads'));
 await fs.symlink(linked,path.join(f.data,'uploads'),'junction');await assert.rejects(createBackup({store:f.store,dataDirectory:f.data}),/BACKUP_LINK_OR_NONFILE/);
}));
test('备份保留策略：只清理足够旧的完整包，保留最新、损坏及未完成包',async()=>fixture(async f=>{
 const days=[1,2,3,4,19,20];const backups=[];for(const day of days)backups.push(await createBackup({store:f.store,dataDirectory:f.data,now:new Date(`2026-10-${String(day).padStart(2,'0')}T00:00:00Z`)}));
 await fs.appendFile(path.join(backups[0].directory,'audit.json'),'broken');await fs.mkdir(path.join(f.backupRoot,'unfinished'));
 const removed=await pruneBackups({backupRoot:f.backupRoot,keep:2,minAgeDays:7,now:Date.parse('2026-10-21T00:00:00Z')});assert.equal(removed.length,3);
 assert.ok((await fs.stat(backups[0].directory)).isDirectory());assert.ok((await fs.stat(backups[4].directory)).isDirectory());assert.ok((await fs.stat(backups[5].directory)).isDirectory());assert.ok((await fs.stat(path.join(f.backupRoot,'unfinished'))).isDirectory());
}));
test('自动备份：失败限时重试、任务不重叠、重启读取上次状态',async()=>fixture(async f=>{
 await fs.mkdir(f.backupRoot);let clock=100000,calls=0,release;const logs=[];
 const options={dataDirectory:f.data,backupRoot:f.backupRoot,intervalMs:86400000,retryMs:1000,now:()=>clock,logger:{log:m=>logs.push(m),error:m=>logs.push(m)}};
 const scheduler=createBackupScheduler({...options,runBackup:async()=>{calls++;if(calls===1)throw Error('secret connection path');await new Promise(r=>{release=r;});return {id:'test-backup'};}});
 await scheduler.tick();assert.equal(calls,1);assert.equal(scheduler.status().error,'BACKUP_FAILED');await scheduler.tick();assert.equal(calls,1);
 clock+=1000;const first=scheduler.tick(),second=scheduler.tick();while(!release)await new Promise(r=>setImmediate(r));assert.equal(calls,2);release();await Promise.all([first,second]);assert.equal(scheduler.status().lastSuccessAt,clock);assert.equal(scheduler.status().error,null);await scheduler.stop();
 const restarted=createBackupScheduler({...options,runBackup:async()=>{calls++;return {id:'next'};}});await restarted.tick();assert.equal(calls,2);clock+=86400000;await restarted.tick();assert.equal(calls,3);await restarted.stop();assert.doesNotMatch(logs.join('\n'),/secret connection path/);
}));

test('服务生命周期：数据库就绪后启动备份，备份期间可查询，正常退出等待备份结束',async()=>fixture(async f=>{
 const {start}=require('../server/index');await fs.mkdir(f.backupRoot);let release,closed=false,finished=false;
 const service=await start({port:0,connect:async()=>({db:{command:async()=>({ok:1})},execute:async()=>({ok:true}),close:async()=>{closed=true;}}),httpOptions:{auth:new Auth([]),publicOrigin:''},logger:{log(){},error(){}},backupOptions:{dataDirectory:f.data,backupRoot:f.backupRoot,runBackup:async()=>{await new Promise(r=>{release=r;});return {id:'lifecycle-test'};}}});
 try{
  for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,10));assert.equal(typeof release,'function');
  const health=await fetch('http://127.0.0.1:'+service.server.address().port+'/health');assert.equal(health.status,200);
  const stopped=service.stop().then(()=>{finished=true;});await new Promise(r=>setTimeout(r,20));assert.equal(finished,false);assert.equal(closed,false);
  release();await stopped;assert.equal(closed,true);const status=JSON.parse(await fs.readFile(path.join(f.data,'backup-status.json'),'utf8'));assert.equal(status.lastBackupId,'lifecycle-test');assert.equal(status.error,null);
 }finally{if(release)release();await service.stop();}
}));

test('真实 MongoDB：完整包恢复业务、账号、图片和审计，并可登录读取与重试原订单',{skip:process.env.PET_MONGO_TEST!=='1'},async()=>fixture(async f=>{
 const suffix=Date.now()+'_'+Math.random().toString(36).slice(2),source=await MongoStore.connect({database:'pet_shop_test_backup_'+suffix}),restoreName='pet_shop_restore_test_'+suffix;let restored,server;
 const merchant={id:'backup-owner',merchant:true},buyer={id:'backup-buyer'};
 try{
  const product=(await source.execute(merchant,'merchantProducts'))[0];product.image='/uploads/abc-123.png';await source.execute(merchant,'saveProduct',product,{mock:true});
  const orderInput={key:'backup-order-once',fulfillment:'PICKUP',contact:{name:'恢复验收',phone:'13800000000'},lines:[{productId:'food',skuId:'food-1',qty:1}]};
  const order=await source.execute(buyer,'createOrder',orderInput,{mock:true});const before=await source.backupSnapshot();
  const backup=await createBackup({store:source,dataDirectory:f.data});const destination=path.join(f.root,'restored');
  const report=await restoreBackup({directory:backup.directory,database:restoreName,destination});assert.equal(report.verified,true);
  restored=await MongoStore.connect({database:restoreName});const after=await restored.backupSnapshot();assert.deepEqual(after.state,before.state);assert.equal(after.audit.length,before.audit.length+1);assert.equal(after.revision,before.revision+1);
  const restoredAccounts=JSON.parse(await fs.readFile(path.join(destination,'auth/accounts.json'),'utf8'));const auth=new Auth(restoredAccounts);
  server=createServer(restored,{auth,publicOrigin:'',uploadsDirectory:path.join(destination,'uploads')});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const login=await (await fetch(base+'/auth/login',{method:'POST',body:JSON.stringify({username:'buyer',password:'buyer-test-password'})})).json();assert.equal(login.ok,true);
  const api=async(action,input={})=>(await (await fetch(base+'/api',{method:'POST',headers:{Authorization:'Bearer '+login.data.token},body:JSON.stringify({action,input})})).json());
  const catalog=await api('catalog');assert.equal(catalog.ok,true);assert.equal(catalog.data[0].image,'/uploads/abc-123.png');assert.deepEqual(Buffer.from(await (await fetch(base+catalog.data[0].image)).arrayBuffer()),png);
  const retried=await api('createOrder',orderInput);assert.equal(retried.ok,true);assert.equal(retried.data.id,order.id);assert.equal((await restored.snapshot()).orders.length,1);
  await assert.rejects(restoreBackup({directory:backup.directory,database:restoreName,destination:path.join(f.root,'second')}),/RESTORE_TARGET_NOT_EMPTY/);
  assert.ok(await fs.stat(path.join(f.root,'second/RESTORE_INCOMPLETE')));assert.deepEqual(await source.backupSnapshot(),before);
 }finally{if(server)await new Promise(r=>server.close(r));if(restored)await restored.close();assert.ok(restoreName.startsWith('pet_shop_restore_test_'));await source.client.db(restoreName).dropDatabase();assert.ok(source.db.databaseName.startsWith('pet_shop_test_backup_'));await source.db.dropDatabase();await source.close();}
}));
