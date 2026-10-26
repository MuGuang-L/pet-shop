'use strict';
// Starts the official MongoDB binary in an isolated persistent local directory.
// mongodb-memory-server-core is only a process/download helper; dbPath is durable.
const path=require('node:path'),fs=require('node:fs');
const {MongoMemoryReplSet}=require('mongodb-memory-server-core');
async function startLocalMongo({onExit=()=>{}}={}){
 await new Promise((resolve,reject)=>{const probe=require('node:net').createServer();probe.once('error',()=>reject(Error('Port 27018 is occupied; use the existing MongoDB or stop this project instance first.')));probe.listen(27018,'127.0.0.1',()=>probe.close(resolve));});
 const root=path.resolve(process.env.SHOP_MONGO_DIR||path.join(__dirname,'..','.local','mongodb'));fs.mkdirSync(path.join(root,'data'),{recursive:true});
 const rs=await MongoMemoryReplSet.create({binary:{version:'8.0.16',downloadDir:path.join(root,'bin')},instanceOpts:[{port:27018,dbPath:path.join(root,'data')}],replSet:{name:'petshop',count:1,ip:'127.0.0.1',storageEngine:'wiredTiger',spawn:{windowsHide:true}}});
 if(rs.servers[0].instanceInfo.port!==27018){await rs.stop({doCleanup:false,force:false});throw Error('MongoDB started on an unexpected port; refusing to use another database.');}
 console.log('MongoDB ready on loopback port 27018; persistent data retained.');
 let stopping=false,stopPromise;const child=rs.servers[0].instanceInfo.instance.mongodProcess;
 const stop=()=>stopPromise||=(async()=>{
  stopping=true;
  await require('../server/mongo-shutdown').stopMongoChild({child,shutdown:async()=>{
   const client=new (require('mongodb').MongoClient)('mongodb://127.0.0.1:27018/admin?directConnection=true',{serverSelectionTimeoutMS:2000,connectTimeoutMS:2000,socketTimeoutMS:8000});
   try{await client.connect();await client.db('admin').command({shutdown:1,force:true,timeoutSecs:5});}finally{await client.close();}
  },cleanup:()=>rs.stop({doCleanup:false,force:false})});
 })().catch(e=>{stopPromise=null;throw e;});
 rs.servers[0].instanceInfo.instance.on('instanceClosed',()=>{if(!stopping)onExit();});
 return {stop};
}
if(require.main===module){
 let ready;const stop=async()=>{const service=await ready.catch(()=>null);if(service)await service.stop();};
 ready=startLocalMongo({onExit:()=>{void stop().then(()=>process.exit(1),()=>{console.error('Database cleanup failed.');});}});
 require('../server/process-lifecycle').attachShutdown(stop);
 ready.catch(()=>{console.error('MongoDB startup failed; inspect configuration and occupied ports.');process.exit(1);});
}
module.exports={startLocalMongo};
