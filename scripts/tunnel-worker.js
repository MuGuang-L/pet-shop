'use strict';
const {spawn}=require('node:child_process'),path=require('node:path');
const {checkTunnelAbsent}=require('./service-runtime');
async function startTunnel({binary,config,onExit=()=>{},launch=spawn,check=checkTunnelAbsent}={}){
 await check(binary);
 const child=launch(binary,['-config='+config],{cwd:path.dirname(binary),windowsHide:true,stdio:'ignore'});let stopping=false;
 const closed=new Promise(resolve=>child.once('close',()=>{resolve();if(!stopping)onExit();}));
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
 return {async stop(){stopping=true;if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await closed;}};
}
if(require.main===module){
 let ready;const stop=async()=>{const tunnel=await ready.catch(()=>null);if(tunnel)await tunnel.stop();};
 ready=startTunnel({binary:process.env.PET_TUNNEL_BINARY,config:process.env.PET_TUNNEL_CONFIG,onExit:()=>{void stop().then(()=>process.exit(1));}});
 require('../server/process-lifecycle').attachShutdown(stop);
 ready.catch(()=>{console.error('Tunnel startup failed; inspect configuration or existing tunnel process.');process.exit(1);});
}
module.exports={startTunnel};
