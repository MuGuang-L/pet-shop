'use strict';
const {spawn}=require('node:child_process');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function code(error){return /^[A-Z0-9_]{1,50}$/.test(error?.code||'')?error.code:'PROCESS_ERROR';}
async function bounded(work,ms){let timer;try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error(),{code:'CHECK_TIMEOUT'})),ms);})]);}finally{clearTimeout(timer);}}
class Supervisor{
 constructor(services,{launch=spawn,now=Date.now,log=()=>{},baseDelay=1000,maxDelay=30000,stableAfter=60000,checkTimeout=5000}={}){
  this.services=services;this.launch=launch;this.now=now;this.log=log;this.baseDelay=baseDelay;this.maxDelay=maxDelay;this.stableAfter=stableAfter;this.checkTimeout=checkTimeout;
  this.records=new Map();this.stopping=false;this.ticking=null;
  for(const service of services){if(!/^[a-z][a-z0-9-]{0,30}$/.test(service.id)||this.records.has(service.id))throw Error('INVALID_SERVICE_ID');this.records.set(service.id,{id:service.id,state:'waiting',child:null,starts:0,failures:0,nextAttemptAt:0,healthySince:null,lastExit:null,error:null});}
  const seen=new Set();for(const service of services){if((service.dependencies||[]).some(id=>!seen.has(id)))throw Error('DEPENDENCIES_MUST_PRECEDE_SERVICE');seen.add(service.id);}
 }
 status(){return {stopping:this.stopping,monitoringError:this.monitoringError||null,services:[...this.records.values()].map(({child,...r})=>({...r,pid:child?.pid||null}))};}
 emit(event){try{this.log(event);}catch{this.monitoringError='EVENT_LOG_UNAVAILABLE';}}
 tick(){if(this.ticking)return this.ticking;this.ticking=this.runTick().finally(()=>{this.ticking=null;});return this.ticking;}
 async runTick(){
  for(const service of this.services){
   if(this.stopping)return;const r=this.records.get(service.id);
   if(r.child||service.external){
    const observed=r.child;
    // An unhealthy probe is evidence of degraded service, not of process exit.
    // Only the owned ChildProcess exit/error event permits a replacement.
    try{const healthy=await bounded(()=>service.probe(),this.checkTimeout);if(this.stopping)return;if(r.child!==observed)continue;
     if(healthy){r.state='healthy';r.error=null;r.healthySince??=this.now();if(this.now()-r.healthySince>=this.stableAfter)r.failures=0;}
     else{r.state='unhealthy';r.error='NOT_READY';r.healthySince=null;}
    }catch(e){if(!this.stopping&&r.child===observed){r.state='unhealthy';r.error=code(e);r.healthySince=null;}}
    continue;
   }
   if((service.dependencies||[]).some(id=>this.records.get(id).state!=='healthy')){r.state='waiting';continue;}
   if(this.now()<r.nextAttemptAt){r.state='backoff';continue;}
   this.start(service,r);
  }
 }
 start(service,r){
  let child,finished=false;r.starts++;r.state='starting';r.error=null;r.healthySince=null;
  const exited=(exitCode,signal,error)=>{
   if(finished)return;finished=true;if(child&&r.child!==child)return;
   r.child=null;r.healthySince=null;r.lastExit={at:this.now(),code:exitCode??null,signal:signal||null};
   if(this.stopping){r.state='stopped';return;}
   r.failures++;r.error=error?code(error):'PROCESS_EXITED';r.nextAttemptAt=this.now()+Math.min(this.maxDelay,this.baseDelay*2**Math.min(r.failures-1,20));r.state='backoff';
   this.emit({service:r.id,event:'exit',code:r.error,exitCode:exitCode??null,retryAt:r.nextAttemptAt});
  };
  try{
   child=this.launch(service.command,service.args||[],{cwd:service.cwd,env:service.env||process.env,windowsHide:true,stdio:service.ipc?['ignore','ignore','ignore','ipc']:'ignore'});r.child=child;
   child.once('exit',(exitCode,signal)=>exited(exitCode,signal));child.on('error',error=>{
    if(child.pid&&child.exitCode===null&&child.signalCode===null){r.error=code(error);r.state='unhealthy';return;}
    exited(null,null,error);
   });
   this.emit({service:r.id,event:'start',pid:child.pid||null,attempt:r.starts});
  }catch(error){exited(null,null,error);}
 }
 async stop({graceMs=30000}={}){
  this.stopping=true;if(this.ticking)await this.ticking;
  const failures=[];
  for(const service of [...this.services].reverse()){
   const r=this.records.get(service.id),child=r.child;if(!child){r.state='stopped';continue;}
   r.state='stopping';
   let onExit;const closed=new Promise(resolve=>{onExit=resolve;child.once('exit',onExit);});
   try{if(service.ipc){if(child.connected)child.send({type:'stop'},()=>{});}else child.kill('SIGTERM');}catch{}
   const end=Date.now()+graceMs;while(r.child===child&&Date.now()<end)await Promise.race([closed,sleep(Math.min(50,Math.max(1,end-Date.now())))]);
   child.removeListener('exit',onExit);
   if(r.child===child){r.state='stop-timeout';r.error='STOP_TIMEOUT';failures.push(service.id);break;}
  }
  // A timed-out child remains owned and visible. Never claim stopped or force
  // kill a database just because graceful shutdown exceeded its wait window.
  if(failures.length)throw Object.assign(Error('STOP_TIMEOUT'),{code:'STOP_TIMEOUT',services:failures});
 }
}
module.exports={Supervisor,bounded};
