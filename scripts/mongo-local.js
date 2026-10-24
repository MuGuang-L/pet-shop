'use strict';
// Starts the official MongoDB binary in an isolated persistent local directory.
// mongodb-memory-server-core is only a process/download helper; dbPath is durable.
const path=require('node:path'),fs=require('node:fs');
const {MongoMemoryReplSet}=require('mongodb-memory-server-core');
async function main(){
 await new Promise((resolve,reject)=>{const probe=require('node:net').createServer();probe.once('error',()=>reject(Error('Port 27018 is occupied; use the existing MongoDB or stop this project instance first.')));probe.listen(27018,'127.0.0.1',()=>probe.close(resolve));});
 const root=path.resolve(__dirname,'..','.local','mongodb');fs.mkdirSync(path.join(root,'data'),{recursive:true});
 const rs=await MongoMemoryReplSet.create({binary:{version:'8.0.16',downloadDir:path.join(root,'bin')},instanceOpts:[{port:27018,dbPath:path.join(root,'data')}],replSet:{name:'petshop',count:1,ip:'127.0.0.1',storageEngine:'wiredTiger'}});
 if(rs.servers[0].instanceInfo.port!==27018){await rs.stop({doCleanup:false,force:false});throw Error('MongoDB started on an unexpected port; refusing to use another database.');}
 console.log('MongoDB ready: mongodb://127.0.0.1:27018/?replicaSet=petshop');console.log('Persistent data: '+path.join(root,'data'));
 let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await rs.stop({doCleanup:false,force:false});process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
