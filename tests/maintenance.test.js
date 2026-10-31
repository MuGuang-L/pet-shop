'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMaintenance}=require('../server/maintenance');
function fixture(){
 let time=0,pending=false,fail=false,expires=0,payments=0,scans=0;
 const store={engine:'mysql',execute:async()=>{expires++;if(fail)throw Error('offline');},hasBackgroundWork:async()=>{scans++;return pending;}};
 const worker=createMaintenance({getStore:()=>store,reconcile:async()=>{payments++;return {failed:0};},paymentEnabled:true,now:()=>time,logger:{error(){}}});
 return {store,worker,setTime:value=>time=value,setPending:value=>pending=value,setFail:value=>fail=value,counts:()=>({expires,payments,scans})};
}
test('空闲十五分钟内不访问数据库，到期重新发现其他实例留下的任务',async()=>{
 const f=fixture();await f.worker.tick();assert.deepEqual(f.counts(),{expires:1,payments:1,scans:1});
 for(let t=10000;t<900000;t+=10000){f.setTime(t);await f.worker.tick();}
 assert.deepEqual(f.counts(),{expires:1,payments:1,scans:1});
 f.setPending(true);f.setTime(900000);await f.worker.tick();
 f.setTime(910000);await f.worker.tick();assert.deepEqual(f.counts(),{expires:3,payments:2,scans:3});
});
test('待支付及退款任务维持十秒到期检查和一分钟补查，处理完才退避',async()=>{
 const f=fixture();f.setPending(true);await f.worker.tick();
 for(let t=10000;t<=120000;t+=10000){f.setTime(t);await f.worker.tick();}
 assert.deepEqual(f.counts(),{expires:13,payments:3,scans:13});
 f.setPending(false);f.setTime(130000);await f.worker.tick();
 f.setTime(140000);await f.worker.tick();assert.equal(f.counts().expires,14);
});
test('空闲期间新请求唤醒任务，执行中的请求及并发写入不会被空快照覆盖',async()=>{
 const f=fixture();await f.worker.tick();f.setTime(10000);
 const end=f.worker.activity();await f.worker.tick();f.setTime(20000);await f.worker.tick();
 assert.equal(f.counts().expires,3);end();
 let finish;f.store.hasBackgroundWork=()=>new Promise(r=>finish=r);
 const tick=f.worker.tick();await new Promise(r=>setImmediate(r));
 const endWrite=f.worker.activity();endWrite();finish(false);await tick;
 f.store.hasBackgroundWork=async()=>true;f.setTime(30000);await f.worker.tick();assert.equal(f.counts().expires,5);
});
test('扫描或支付失败保持重试，不将故障当空闲；同一时间不重入',async()=>{
 const f=fixture();f.setFail(true);await f.worker.tick();f.setTime(10000);await f.worker.tick();assert.equal(f.counts().expires,2);
 f.setFail(false);f.store.hasBackgroundWork=async()=>{throw Error('offline');};await f.worker.tick();await f.worker.tick();assert.equal(f.counts().expires,4);
 let calls=0,release;const worker=createMaintenance({getStore:()=>({execute:async()=>{},engine:'mysql',hasBackgroundWork:async()=>false}),paymentEnabled:true,reconcile:()=>{calls++;return new Promise(r=>release=r);},now:()=>0,logger:{error(){}}});
 const a=worker.tick(),b=worker.tick();await new Promise(r=>setImmediate(r));assert.equal(calls,1);release({failed:1});await Promise.all([a,b]);
 const c=worker.tick();await c; // Payment interval has not elapsed, but expiry/discovery still run.
});
test('存活探针完全不访问数据库，原健康检查保留断库报错',async()=>{
 const {createServer}=require('../server/http'),{Auth}=require('../server/auth');let reads=0;
 const server=createServer({ping:async()=>{reads++;throw Object.assign(Error('offline'),{name:'MysqlUnavailable'});}},{auth:new Auth([])});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{for(let i=0;i<5;i++)assert.deepEqual(await (await fetch(base+'/live')).json(),{ok:true});assert.equal(reads,0);assert.equal((await fetch(base+'/health')).status,503);assert.equal(reads,1);}
 finally{await new Promise(r=>server.close(r));}
});
test('支付平台响应缓慢时，过期订单仍按周期处理且支付不并发重入',async()=>{
 let time=0,expires=0,payments=0,release;
 const worker=createMaintenance({getStore:()=>({engine:'mysql',execute:async()=>{expires++;},hasBackgroundWork:async()=>true}),paymentEnabled:true,now:()=>time,reconcile:()=>{payments++;return new Promise(r=>release=r);}});
 const first=worker.tick();await new Promise(r=>setImmediate(r));
 time=10000;const second=worker.tick();await new Promise(r=>setImmediate(r));
 assert.equal(expires,2);assert.equal(payments,1);
 time=70000;const third=worker.tick();await new Promise(r=>setImmediate(r));
 assert.equal(expires,3);assert.equal(payments,1);
 release({failed:0});await Promise.all([first,second,third]);
});
