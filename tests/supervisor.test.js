'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Supervisor}=require('../server/supervisor'),control=require('../server/runtime-control'),{attachShutdown}=require('../server/process-lifecycle');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let sequence=100;
class Child extends EventEmitter{
 constructor(stopLog=[]){super();this.pid=++sequence;this.exitCode=null;this.signalCode=null;this.connected=true;this.stopLog=stopLog;this.stubborn=false;}
 finish(value=1){this.exitCode=value;this.emit('exit',value,null);}
 send(message,callback){callback?.();this.stopLog.push(this.pid);if(!this.stubborn)queueMicrotask(()=>this.finish(0));}
 kill(){this.stopLog.push(this.pid);queueMicrotask(()=>this.finish(0));}
}
function fixture(services=[{id:'backend',probe:async()=>true}],options={}){
 const children=[],spawnOptions=[],stopLog=[];let time=0;
 const manager=new Supervisor(services.map(s=>({command:'fake-command',ipc:true,...s})),{now:()=>time,launch:(_command,_args,opts)=>{spawnOptions.push(opts);const c=new Child(stopLog);children.push(c);return c;},...options});
 return {manager,children,spawnOptions,stopLog,setTime:t=>time=t,record:id=>manager.records.get(id||'backend')};
}
test('守护：确认退出后按 1、2 秒退避重启，稳定运行后恢复短退避',async()=>{
 const f=fixture();await f.manager.tick();assert.equal(f.children.length,1);assert.equal(f.spawnOptions[0].windowsHide,true);
 f.children[0].finish();await f.manager.tick();assert.equal(f.children.length,1);f.setTime(1000);await f.manager.tick();assert.equal(f.children.length,2);
 f.children[1].finish();f.setTime(2999);await f.manager.tick();assert.equal(f.children.length,2);f.setTime(3000);await f.manager.tick();assert.equal(f.children.length,3);
 await f.manager.tick();f.setTime(63001);await f.manager.tick();assert.equal(f.record().failures,0);f.children[2].finish();assert.equal(f.record().nextAttemptAt,64001);await f.manager.stop();
});
test('守护：进程仍活着时探测超时、IPC 错误和迟到探测均不能触发重复启动',async()=>{
 let probe=async()=>false;const f=fixture([{id:'backend',probe:()=>probe()}],{checkTimeout:5});await f.manager.tick();
 await f.manager.tick();assert.equal(f.record().state,'unhealthy');f.children[0].emit('error',Object.assign(Error('private location'),{code:'EPIPE'}));
 probe=()=>new Promise(()=>{});await f.manager.tick();assert.equal(f.record().error,'CHECK_TIMEOUT');assert.equal(f.children.length,1);
 let finish;probe=()=>new Promise(r=>finish=r);const pending=f.manager.tick();await sleep(0);f.children[0].finish();finish(true);await pending;
 assert.equal(f.record().state,'backoff');assert.equal(f.children.length,1);await f.manager.stop();
});
test('守护：依赖就绪后依次启动，重复 tick 合并，停止顺序为隧道、后端、数据库',async()=>{
 let done;const f=fixture([{id:'database',probe:async()=>true},{id:'backend',dependencies:['database'],probe:()=>new Promise(r=>done=r)},{id:'tunnel',dependencies:['backend'],probe:async()=>true}]);
 await f.manager.tick();assert.equal(f.children.length,1);await f.manager.tick();assert.equal(f.children.length,2);
 const a=f.manager.tick(),b=f.manager.tick();assert.equal(a,b);await sleep(0);done(true);await a;assert.equal(f.children.length,3);
 await f.manager.stop();assert.deepEqual(f.stopLog,[...f.children].reverse().map(c=>c.pid));await f.manager.tick();assert.equal(f.children.length,3);
});
test('守护：外部数据库只观察；后端停止超时会保留其依赖，不误报停机完成',async()=>{
 const f=fixture([{id:'database',external:true,probe:async()=>true},{id:'backend',dependencies:['database'],probe:async()=>true}]);
 await f.manager.tick();assert.equal(f.children.length,1);assert.equal(f.record('database').starts,0);f.children[0].stubborn=true;
 await assert.rejects(f.manager.stop({graceMs:5}),/STOP_TIMEOUT/);assert.equal(f.record().state,'stop-timeout');assert.equal(f.record('database').state,'healthy');
 f.children[0].stubborn=false;await f.manager.stop();assert.equal(f.record().state,'stopped');
});
test('守护：启动失败和日志写入失败不会失去退避，状态中不带路径、环境或令牌',async()=>{
 let time=0;const m=new Supervisor([{id:'backend',command:'private-path',args:['private-token'],env:{secret:'private-secret'},probe:async()=>true}],{now:()=>time,launch(){throw Object.assign(Error('private-path'),{code:'ENOENT'});},log(){throw Error('disk full');}});
 await m.tick();assert.equal(m.records.get('backend').nextAttemptAt,1000);time=500;await m.tick();assert.equal(m.records.get('backend').starts,1);
 const status=JSON.stringify(m.status());assert.doesNotMatch(status,/private-/);assert.match(status,/EVENT_LOG_UNAVAILABLE/);await m.stop();
});
test('真实子进程退出后自动恢复，停止后不复活；测试不监听 HTTP、不触碰共享数据库',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pet-runtime-test-'));
 const m=new Supervisor([{id:'fixture',command:process.execPath,args:[path.join(__dirname,'fixtures/runtime-worker.cjs'),directory],ipc:true,probe:async()=>fs.existsSync(path.join(directory,'ready'))}],{baseDelay:10,maxDelay:20});
 try{const deadline=Date.now()+5000;while(Date.now()<deadline&&m.records.get('fixture').state!=='healthy'){await m.tick();await sleep(10);}
  assert.equal(m.records.get('fixture').state,'healthy');assert.equal(m.records.get('fixture').starts,2);assert.equal(fs.readFileSync(path.join(directory,'attempt'),'utf8'),'2');
  await m.stop({graceMs:2000});await m.tick();assert.equal(m.records.get('fixture').child,null);assert.equal(m.records.get('fixture').starts,2);
 }finally{await m.stop({graceMs:2000});assert.ok(path.basename(directory).startsWith('pet-runtime-test-'));fs.rmSync(directory,{recursive:true,force:true});}
});
test('本地控制：独占运行、状态读取、停机鉴权；遗留状态文件不代表进程活着',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pet-runtime-test-'));let stopped=0;
 const server=await control.listen(directory,{token:'only-this-control-token',status:()=>({services:[{id:'backend',state:'healthy'}]}),stop:async()=>stopped++});
 try{
  await assert.rejects(control.listen(directory,{token:'another',status:()=>({}),stop:async()=>{}}),e=>e.code==='EADDRINUSE');
  assert.equal((await control.request(directory,{action:'status'})).data.services[0].state,'healthy');
  assert.equal((await control.request(directory,{action:'stop',token:'wrong'})).ok,false);assert.equal(stopped,0);
  assert.equal((await control.request(directory,{action:'stop',token:'only-this-control-token'})).ok,true);assert.equal(stopped,1);
 }finally{await new Promise(r=>server.close(r));}
 control.atomicJson(path.join(directory,'status.json'),{running:true});await assert.rejects(control.request(directory,{action:'status'}));
 assert.ok(path.basename(directory).startsWith('pet-runtime-test-'));fs.rmSync(directory,{recursive:true,force:true});
});
test('工作进程：父进程断连与停机指令只清理一次，清理结束后才退出',async()=>{
 const target=new EventEmitter();target.send=()=>{};let cleanup=0,finish,exitCode=null;target.exit=code=>exitCode=code;
 const lifecycle=attachShutdown(()=>{cleanup++;return new Promise(r=>finish=r);},{target,log:{error(){}}});
 target.emit('disconnect');target.emit('message',{type:'stop'});assert.equal(cleanup,1);assert.equal(exitCode,null);finish();await sleep(0);assert.equal(exitCode,0);lifecycle.dispose();
});
test('启动前检查：端口已有服务时明确拒绝，不关闭占用者',async()=>{
 const net=require('node:net'),{available}=require('../scripts/service-runtime');const existing=net.createServer();await new Promise(r=>existing.listen(0,'127.0.0.1',r));
 try{const port=existing.address().port;await assert.rejects(available(port),e=>e.code==='EXISTING_SERVICE_ON_'+port);assert.equal(existing.listening,true);}finally{await new Promise(r=>existing.close(r));}
});
test('健康检查带运行标记时只认当前实例，数据库故障仍返回 503',async()=>{
 const {createServer}=require('../server/http'),{Auth}=require('../server/auth'),{httpReady}=require('../scripts/service-runtime');let online=true;const runtimeId='11111111-2222-3333-4444-555555555555';
 const server=createServer({db:{command:async()=>{if(!online)throw Object.assign(Error(),{name:'MongoServerSelectionError'});return {ok:1};}}},{auth:new Auth([]),runtimeId});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{assert.equal(await httpReady(base,runtimeId),true);assert.equal(await httpReady(base,'different-instance'),false);online=false;assert.equal(await httpReady(base,runtimeId),false);}
 finally{await new Promise(r=>server.close(r));}
});
test('数据库停止：关闭命令失败或进程不退出时不强杀，确认退出后才清理启动助手',async()=>{
 const {stopMongoChild}=require('../server/mongo-shutdown');const child=new Child();let cleaned=0,killed=0;child.kill=()=>killed++;
 await assert.rejects(stopMongoChild({child,shutdown:async()=>{throw Error('connection unavailable');},cleanup:async()=>cleaned++,timeoutMs:5}),/MONGO_STOP_TIMEOUT/);
 assert.equal(killed,0);assert.equal(cleaned,0);
 await stopMongoChild({child,shutdown:async()=>{queueMicrotask(()=>child.finish(0));throw Error('connection closed during shutdown');},cleanup:async()=>cleaned++,timeoutMs:20});
 assert.equal(cleaned,1);assert.equal(killed,0);
});
test('隧道包装：已有客户端时不启动，正常停止仅关闭持有的客户端',async()=>{
 const {startTunnel}=require('../scripts/tunnel-worker');let launches=0,exits=0;const child=new Child();child.kill=()=>{child.exitCode=0;child.emit('close',0);};
 const launch=()=>{launches++;queueMicrotask(()=>child.emit('spawn'));return child;};
 await assert.rejects(startTunnel({binary:'natapp.exe',config:'private.ini',launch,check:async()=>{throw Error('EXISTING_TUNNEL_PROCESS');}}),/EXISTING_TUNNEL_PROCESS/);assert.equal(launches,0);
 const tunnel=await startTunnel({binary:'natapp.exe',config:'private.ini',launch,check:async()=>{},onExit:()=>exits++});await tunnel.stop();assert.equal(launches,1);assert.equal(exits,0);
});
