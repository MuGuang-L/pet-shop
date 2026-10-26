'use strict';
// Wait for the exact owned process. A failed shutdown request or an elapsed wait
// never falls back to an OS kill; the caller retains ownership and can retry.
async function stopMongoChild({child,shutdown,cleanup,timeoutMs=20000}){
 const exited=()=>child.exitCode!==null||child.signalCode!==null;
 if(!exited()){
  try{await shutdown();}catch{}
  if(!exited())await new Promise((resolve,reject)=>{
   const done=()=>{clearTimeout(timer);child.removeListener('exit',done);resolve();};
   const timer=setTimeout(()=>{child.removeListener('exit',done);reject(Object.assign(Error('MONGO_STOP_TIMEOUT'),{code:'MONGO_STOP_TIMEOUT'}));},timeoutMs);
   child.once('exit',done);if(exited())done();
  });
 }
 await cleanup();
}
module.exports={stopMongoChild};
