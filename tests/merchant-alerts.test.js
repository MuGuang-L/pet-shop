'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {create}=require('../apps/merchant-web/alerts');
const order=(id,type='DELIVERY',extra={})=>({id,status:'PAID',fulfillment:{type},...extra});
function fixture(storage=new Map()){
 const events=[],frames=[],timers=new Map();let next=0,response={items:[],pages:1},read=async()=>response,expired=0;
 const options={read:i=>read(i),render:s=>frames.push(s),notify:(o,m)=>events.push({orders:o,...m}),expired:()=>expired++,storage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},schedule:(fn,delay)=>{timers.set(++next,{fn,delay});return next;},cancel:id=>timers.delete(id)};
 return {service:create(options),events,frames,timers,options,storage,set:r=>response=r,read:fn=>read=fn,expired:()=>expired};
}
async function settle(){for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));}
test('首次提示待办，付款后新单区分快递/自提，未付款及已备好自提不提醒',async()=>{
 const f=fixture();f.set({items:[order('old'),order('pending','DELIVERY',{status:'PENDING'}),order('ready','PICKUP',{fulfillment:{type:'PICKUP',readyAt:10}})],pages:1});f.service.start('owner');await settle();assert.equal(f.events[0].initial,true);assert.deepEqual(f.events[0].orders.map(o=>o.id),['old']);
 f.set({items:[order('old'),order('pending'),order('pickup','PICKUP')],pages:1});await f.service.poll();assert.equal(f.events[1].initial,false);assert.deepEqual(f.events[1].orders.map(o=>o.id),['pending','pickup']);await f.service.poll();assert.equal(f.events.length,2);f.service.stop();
});
test('刷新、重复请求及同账号其他标签页复用去重记录；不同账号隔离',async()=>{
 const storage=new Map(),f=fixture(storage);f.set({items:[order('same')],pages:1});f.service.start('alice');await settle();f.service.start('alice');await settle();assert.equal(f.events.length,1);
 const g=fixture(storage);g.set({items:[order('same')],pages:1});g.service.start('alice');await settle();assert.equal(g.events.length,0);g.service.start('bob');await settle();assert.equal(g.events.length,1);f.service.stop();g.service.stop();
});
test('超过一页的订单不漏掉，部分分页失败不提前标记已提醒',async()=>{
 const f=fixture();let broken=true;f.read(async i=>{if(i.page===2&&broken)throw Error('offline');return {pages:2,items:[order('page-'+i.page)]};});f.service.start('owner');await settle();assert.equal(f.events.length,0);assert.equal(f.frames.at(-1).error,true);broken=false;await f.service.poll();assert.equal(f.events[0].orders.length,2);assert.equal(f.frames.at(-1).error,false);f.service.stop();
});
test('请求未返回不重叠轮询，退出及切换账号后的迟到结果被丢弃',async()=>{
 const f=fixture();let resolve,calls=0;f.read(()=>{calls++;return new Promise(r=>resolve=r);});f.service.start('old');await f.service.poll();assert.equal(calls,1);f.service.stop();resolve({pages:1,items:[order('secret')]});await settle();assert.equal(f.events.length,0);assert.equal(f.timers.size,0);
 f.service.start('old');const old=resolve;f.service.start('new');resolve({pages:1,items:[order('new')]});await settle();old({pages:1,items:[order('old')]});await settle();assert.deepEqual(f.events.map(e=>e.orders[0].id),['new']);f.service.stop();
});
test('断网保留待办数量且不循环弹错误，恢复后继续发现新单',async()=>{
 const f=fixture();f.set({pages:1,items:[order('one')]});f.service.start('owner');await settle();f.read(async()=>{throw Error('offline');});await f.service.poll();assert.equal(f.frames.at(-1).orders.length,1);assert.equal(f.frames.at(-1).error,true);assert.equal(f.events.length,1);assert.equal([...f.timers.values()][0].delay,20000);
 f.read(async()=>({pages:1,items:[order('two')]}));await f.service.poll();assert.equal(f.events.length,2);f.service.stop();
});
test('会话过期停止提醒，旧账号迟到的401不关闭新账号',async()=>{
 const f=fixture();let reject;f.read(()=>new Promise((_,r)=>reject=r));f.service.start('old');const oldReject=reject;f.read(async()=>({pages:1,items:[]}));f.service.start('new');await settle();oldReject(Object.assign(Error('expired'),{status:401}));await settle();assert.equal(f.expired(),0);
 f.read(async()=>{throw Object.assign(Error('expired'),{status:401});});await f.service.poll();assert.equal(f.expired(),1);assert.equal(f.timers.size,0);assert.equal(f.frames.at(-1).active,false);
});
