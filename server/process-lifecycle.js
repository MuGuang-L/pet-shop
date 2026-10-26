'use strict';
// IPC lets Windows workers drain HTTP requests and shut down MongoDB cleanly;
// sending SIGTERM to a Windows child would terminate it immediately.
function attachShutdown(stop,{target=process,log=console}={}){
 let stopping;
 const shutdown=()=>stopping||=(async()=>{await stop();target.exit(0);})().catch(()=>{log.error('Graceful shutdown failed; inspect supervisor status.');stopping=null;});
 target.on('SIGINT',shutdown);target.on('SIGTERM',shutdown);
 const message=m=>{if(m?.type==='stop')void shutdown();};
 if(typeof target.send==='function'){target.on('message',message);target.on('disconnect',shutdown);}
 return {shutdown,dispose(){target.removeListener('SIGINT',shutdown);target.removeListener('SIGTERM',shutdown);target.removeListener('message',message);target.removeListener('disconnect',shutdown);}};
}
module.exports={attachShutdown};
