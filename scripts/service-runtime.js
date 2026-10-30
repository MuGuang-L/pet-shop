'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),{execFile}=require('node:child_process');
const {MongoClient}=require('mongodb');
const {Supervisor}=require('../server/supervisor'),control=require('../server/runtime-control');
const root=path.resolve(__dirname,'..'),{dataDirectory}=require('../server/data-paths');
const directory=path.join(dataDirectory,'runtime');
function error(code){return Object.assign(Error(code),{code});}
function readConfig(){
 const file=path.join(directory,'config.json');if(!fs.existsSync(file))throw error('RUNTIME_CONFIG_MISSING');
 let c;try{c=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw error('RUNTIME_CONFIG_INVALID');}
 if(c.version!==1||typeof c.manageMongo!=='boolean'||typeof c.publicOrigin!=='string'||(c.publicOrigin&&!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(c.publicOrigin))||typeof c.natapp?.enabled!=='boolean')throw error('RUNTIME_CONFIG_INVALID');
 const uri=process.env.MONGODB_URI||'mongodb://127.0.0.1:27018/?replicaSet=petshop';
 if(c.manageMongo&&uri!=='mongodb://127.0.0.1:27018/?replicaSet=petshop')throw error('MANAGED_MONGO_URI_MISMATCH');
 if(c.manageMongo){try{require.resolve('mongodb-memory-server-core');}catch{throw error('MANAGED_MONGO_HELPER_MISSING');}}
 if(c.natapp.enabled){
  if(process.platform!=='win32')throw error('NATAPP_CONFIGURATION_WINDOWS_ONLY');
  if(!c.publicOrigin)throw error('PUBLIC_ORIGIN_REQUIRED');
  for(const key of ['binary','config']){
   if(typeof c.natapp[key]!=='string')throw error('NATAPP_CONFIGURATION_MISSING');
   const target=path.resolve(root,c.natapp[key]);if(!fs.existsSync(target)||!fs.statSync(target).isFile())throw error('NATAPP_CONFIGURATION_MISSING');
   const real=fs.realpathSync(target),allowed=[path.join(root,'.local'),dataDirectory].some(base=>{const rel=path.relative(fs.realpathSync(base),real);return rel&&!rel.startsWith('..')&&!path.isAbsolute(rel);});
   if(!allowed)throw error('NATAPP_FILES_MUST_BE_PRIVATE');c.natapp[key]=real;
  }
  if(path.basename(c.natapp.binary).toLowerCase()!=='natapp.exe')throw error('NATAPP_BINARY_NAME_INVALID');
  if(!/^\s*authtoken\s*=\s*\S+/mi.test(fs.readFileSync(c.natapp.config,'utf8')))throw error('NATAPP_TOKEN_MISSING');
 }
 return {...c,uri};
}
async function available(port){return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',e=>reject(error(e.code==='EADDRINUSE'?'EXISTING_SERVICE_ON_'+port:'PORT_CHECK_FAILED')));server.listen(port,'127.0.0.1',()=>server.close(resolve));});}
async function checkTunnelAbsent(binary){
 const command="$target=[Environment]::GetEnvironmentVariable('PET_RUNTIME_BINARY'); $items=@(Get-CimInstance Win32_Process -Filter \"Name='natapp.exe'\" | Where-Object { $_.ExecutablePath -eq $target }); Write-Output $items.Count";
 const count=await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:10000,env:{...process.env,PET_RUNTIME_BINARY:binary}},(e,out)=>e?reject(error('TUNNEL_PROCESS_CHECK_FAILED')):resolve(Number(out.trim()))));
 if(!Number.isInteger(count))throw error('TUNNEL_PROCESS_CHECK_FAILED');if(count)throw error('EXISTING_TUNNEL_PROCESS');
}
async function preflight(config){
 // Refuse the entire start before spawning anything when older processes exist.
 await available(4173);if(config.manageMongo)await available(27018);if(config.natapp.enabled)await checkTunnelAbsent(config.natapp.binary);
 if(!fs.existsSync(path.join(dataDirectory,'auth/accounts.json')))throw error('ACCOUNTS_NOT_CONFIGURED');
}
async function httpReady(origin,runtimeId){try{const r=await fetch(origin+'/health',{signal:AbortSignal.timeout(2500)});if(!r.ok)return false;const h=await r.json();return h.ok===true&&h.database==='mongodb'&&h.runtimeId===runtimeId;}catch{return false;}}
async function start({config=readConfig(),check=preflight,intervalMs=5000}={}){
 const token=crypto.randomBytes(32).toString('hex'),runtimeId=crypto.randomUUID(),startedAt=new Date().toISOString();let manager,server,timer,stopPromise,stateWriteError=null;
 const mongo=new MongoClient(config.uri,{serverSelectionTimeoutMS:2000,connectTimeoutMS:2000,socketTimeoutMS:2500,maxPoolSize:1});
 const status=()=>({running:true,runtimeId,startedAt,updatedAt:new Date().toISOString(),stateWriteError,...(manager?manager.status():{stopping:false,services:[],phase:'preflight'})});
 const writeStatus=value=>{try{control.atomicJson(path.join(directory,'status.json'),value||status());stateWriteError=null;}catch{stateWriteError='STATUS_WRITE_FAILED';}};
 const stop=()=>stopPromise||=(async()=>{
  clearInterval(timer);if(manager)await manager.stop();await mongo.close();
  writeStatus({...status(),running:false});server?.close();
 })().catch(e=>{stopPromise=null;writeStatus();throw e;});
 try{
  server=await control.listen(root,{token,status,stop});await check(config);
  control.atomicJson(path.join(directory,'control.json'),{token});
  const env={...process.env,SHOP_DATA_DIR:dataDirectory,SHOP_RUNTIME_ID:runtimeId,MONGODB_URI:config.uri,SHOP_MONGO_DIR:path.join(dataDirectory,'mongodb')};
  if(config.publicOrigin)env.PUBLIC_ORIGIN=config.publicOrigin;
  const services=[{id:'database',external:!config.manageMongo,command:process.execPath,args:['scripts/mongo-local.js'],cwd:root,env,ipc:true,probe:async()=>{try{await mongo.connect();const h=await mongo.db('admin').command({hello:1});return (config.manageMongo?h.setName==='petshop':Boolean(h.setName))&&h.isWritablePrimary===true;}catch{return false;}}},
   {id:'backend',dependencies:['database'],command:process.execPath,args:['server/index.js'],cwd:root,env,ipc:true,probe:()=>httpReady('http://127.0.0.1:4173',runtimeId)}];
  if(config.natapp.enabled)services.push({id:'tunnel',dependencies:['backend'],command:process.execPath,args:['scripts/tunnel-worker.js'],cwd:root,env:{...env,PET_TUNNEL_BINARY:config.natapp.binary,PET_TUNNEL_CONFIG:config.natapp.config},ipc:true,probe:()=>httpReady(config.publicOrigin,runtimeId)});
  manager=new Supervisor(services,{log:event=>control.eventLog(directory,event)});
  const tick=async()=>{try{await manager.tick();writeStatus();}catch{manager.emit({event:'monitor-error',code:'MONITOR_FAILED'});}};
  await tick();timer=setInterval(tick,intervalMs);
  return {manager,stop,status};
 }catch(e){server?.close();await mongo.close();throw e;}
}
async function command(action){
 if(action==='status'){
  try{const r=await control.request(root,{action:'status'});console.log(JSON.stringify(r));return r;}
  catch(e){if(!['ENOENT','ECONNREFUSED'].includes(e.code))throw e;const r={ok:true,data:{running:false,message:'No active supervisor; independent services may still be running.'}};console.log(JSON.stringify(r));return r;}
 }
 if(action==='stop'){
  const {token}=JSON.parse(fs.readFileSync(path.join(directory,'control.json'),'utf8'));const result=await control.request(root,{action:'stop',token},100000);console.log(JSON.stringify(result));if(!result.ok)throw error('STOP_FAILED');return;
 }
 if(action==='check'){const config=readConfig();await preflight(config);console.log(JSON.stringify({ok:true,message:'Ready for supervised start; no processes started.'}));return;}
 if(action==='validate'){readConfig();console.log(JSON.stringify({ok:true,message:'Runtime configuration valid; no processes started.'}));return;}
 if(action!=='start')throw error('USAGE_START_STOP_STATUS_CHECK');
 const runtime=await start();console.log('Supervisor started. Use npm run service:status to check readiness.');
 const stop=()=>runtime.stop().catch(()=>console.error('STOP_TIMEOUT: inspect service status before closing.'));
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
if(require.main===module)command(process.argv[2]||'status').catch(e=>{console.error(/^[A-Z0-9_]{1,60}$/.test(e.code||'')?e.code:'RUNTIME_COMMAND_FAILED');process.exitCode=1;});
module.exports={readConfig,preflight,available,checkTunnelAbsent,httpReady,start,command};
