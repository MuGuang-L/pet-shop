'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
function endpoint(root){const real=fs.realpathSync(root),id=crypto.createHash('sha256').update(process.platform==='win32'?real.toLowerCase():real).digest('hex').slice(0,24);return process.platform==='win32'?'\\\\.\\pipe\\pet-shop-'+id:'\0pet-shop-'+id;}
function atomicJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
function eventLog(directory,event){
 fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'events.jsonl');
 if(fs.existsSync(file)&&fs.statSync(file).size>=1048576){for(let i=3;i>=1;i--){const source=i===1?file:file+'.'+(i-1),target=file+'.'+i;if(fs.existsSync(target))fs.unlinkSync(target);if(fs.existsSync(source))fs.renameSync(source,target);}}
 fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600});
}
async function listen(root,{token,status,stop}){
 const server=net.createServer(socket=>{
  socket.setTimeout(3000,()=>socket.destroy());let raw='';
  socket.on('error',()=>{});socket.on('data',chunk=>{
   raw+=chunk;if(Buffer.byteLength(raw)>2048){socket.destroy();return;}if(!raw.includes('\n'))return;socket.pause();
   void(async()=>{try{const request=JSON.parse(raw.slice(0,raw.indexOf('\n')));
    if(request.action==='status'){socket.end(JSON.stringify({ok:true,data:status()})+'\n');return;}
    const given=Buffer.from(typeof request.token==='string'?request.token:''),expected=Buffer.from(token);
    if(request.action!=='stop'||given.length!==expected.length||!crypto.timingSafeEqual(given,expected)){socket.end('{"ok":false,"error":"CONTROL_FORBIDDEN"}\n');return;}
    socket.setTimeout(0);await stop();socket.end('{"ok":true}\n');
   }catch{socket.end('{"ok":false,"error":"CONTROL_FAILED"}\n');}})();
  });
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(endpoint(root),()=>{server.removeListener('error',reject);resolve();});});return server;
}
async function request(root,input,timeout=5000){
 return new Promise((resolve,reject)=>{const socket=net.createConnection(endpoint(root));let raw='';
  socket.setTimeout(timeout,()=>socket.destroy(Object.assign(Error('CONTROL_TIMEOUT'),{code:'CONTROL_TIMEOUT'})));
  socket.on('connect',()=>socket.write(JSON.stringify(input)+'\n'));socket.on('error',reject);
  socket.on('data',chunk=>{raw+=chunk;if(Buffer.byteLength(raw)>32768)socket.destroy(Error('CONTROL_RESPONSE_TOO_LARGE'));});
  socket.on('end',()=>{try{resolve(JSON.parse(raw));}catch{reject(Error('CONTROL_INVALID_RESPONSE'));}});
 });
}
module.exports={endpoint,atomicJson,eventLog,listen,request};
