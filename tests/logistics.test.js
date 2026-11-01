'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {createLogistics,INTERVAL}=require('../server/logistics');
const env={LOGISTICS_PROVIDER:'kuaidi100',KUAIDI100_KEY:'test-only-key',KUAIDI100_CUSTOMER:'test-customer'};
function fixture(){
 let at=100000,requests=0;const records=new Map();
 const order={id:'o1',userId:'alice',status:'SHIPPED',address:{phone:'13800000000'},fulfillment:{type:'DELIVERY'},shipping:{company:'顺丰速运',carrier:'shunfeng',number:'SF123456789',at:100}};
 const store={async execute(actor,action,input){assert.equal(action,'order');if(input.id!==order.id)throw Error('ORDER_NOT_FOUND');if(actor.id!==order.userId&&!actor.merchant)throw Error('FORBIDDEN');return structuredClone(order);},async claimLogistics(id,time,nextAt,token){let record=records.get(id);if(!record||record.nextAt<=time){record={...record,nextAt,token};records.set(id,record);}return structuredClone(record);},async saveLogistics(id,token,result){const record=records.get(id);if(record.token===token)record.result=result;}};
 let responder=async(url,options)=>{assert.equal(url,'https://poll.kuaidi100.com/poll/query.do');const body=new URLSearchParams(options.body),param=body.get('param'),p=JSON.parse(param);assert.equal(body.get('sign'),createHash('md5').update(param+env.KUAIDI100_KEY+env.KUAIDI100_CUSTOMER).digest('hex').toUpperCase());assert.equal(p.num,order.shipping.number);assert.equal(p.phone,'13800000000');assert.equal(p.address,undefined);return {ok:true,json:async()=>({status:'200',state:'3',com:p.com,nu:p.num,data:[{ftime:'2026-11-01 12:00:00',context:'快递已签收'}]})};};
 const options={store,env,now:()=>at,fetch:async(...args)=>{requests++;return responder(...args);}};
 return {store,order,options,client:createLogistics(options),records,count:()=>requests,advance:()=>at+=INTERVAL+1,respond:fn=>responder=fn};
}
const alice={id:'alice'};
test('运单查询只使用订单内数据，签名正确，物流签收不改变商城订单',async()=>{const f=fixture();const r=await f.client.tracking(alice,{id:'o1',number:'ATTACK',carrier:'bad'});assert.equal(r.statusText,'已签收');assert.equal(r.events[0].text,'快递已签收');assert.equal(f.order.status,'SHIPPED');assert.equal(JSON.stringify(r).includes(env.KUAIDI100_KEY),false);});
test('跨账号查询在命中缓存之前拒绝，不消耗第三方额度',async()=>{const f=fixture();await f.client.tracking(alice,{id:'o1'});await assert.rejects(f.client.tracking({id:'bob'},{id:'o1'}),/FORBIDDEN/);assert.equal(f.count(),1);});
test('并发、重复查询及服务重建复用数据库间隔，过期才再次请求',async()=>{const f=fixture();await Promise.all(Array.from({length:8},()=>f.client.tracking(alice,{id:'o1'})));assert.equal(f.count(),1);await createLogistics(f.options).tracking(alice,{id:'o1'});assert.equal(f.count(),1);f.advance();await f.client.tracking(alice,{id:'o1'});assert.equal(f.count(),2);});
test('接口失败保留旧轨迹，失败也进入冷却，不泄露第三方原始错误',async()=>{const f=fixture();await f.client.tracking(alice,{id:'o1'});f.advance();f.respond(async()=>{throw Error('secret upstream detail');});const r=await f.client.tracking(alice,{id:'o1'});assert.equal(r.events.length,1);assert.equal(r.stale,true);assert.match(r.notice,/失败/);assert.ok(!JSON.stringify(r).includes('secret'));await f.client.tracking(alice,{id:'o1'});assert.equal(f.count(),2);});
test('错单响应不展示，未配置、自提及历史缺少公司不发外部请求',async()=>{const f=fixture();f.respond(async()=>({ok:true,json:async()=>({status:'200',com:'shunfeng',nu:'OTHER123',data:[{context:'其他人的包裹'}]})}));const r=await f.client.tracking(alice,{id:'o1'});assert.equal(r.events.length,0);assert.match(r.notice,/失败/);const g=fixture();assert.match((await createLogistics({...g.options,env:{}}).tracking(alice,{id:'o1'})).notice,/尚未开通/);g.order.fulfillment.type='PICKUP';assert.match((await g.client.tracking(alice,{id:'o1'})).notice,/自提/);g.order.fulfillment.type='DELIVERY';delete g.order.shipping.carrier;assert.match((await g.client.tracking(alice,{id:'o1'})).notice,/历史/);assert.equal(g.count(),0);});
test('补发新运单不会读取旧运单缓存，空轨迹不伪装揽收',async()=>{const f=fixture();await f.client.tracking(alice,{id:'o1'});f.order.shipping.number='SF987654321';f.respond(async()=>({ok:true,json:async()=>({result:false,returnCode:'500'})}));const r=await f.client.tracking(alice,{id:'o1'});assert.equal(r.events.length,0);assert.match(r.notice,/暂未返回/);assert.equal(f.count(),2);});

for(const engine of ['mongo','mysql'])test(engine+' 真实数据库物流查询预约互斥、持久化、超时及旧响应保护',{skip:process.env[engine==='mongo'?'PET_MONGO_TEST':'PET_MYSQL_TEST']!=='1'},async()=>{
 const database='pet_shop_logistics_'+Date.now()+'_'+Math.random().toString(16).slice(2,8);
 const Store=engine==='mongo'?require('../server/mongo-store').MongoStore:require('../server/mysql-store').MysqlStore;
 const a=await Store.connect({database}),b=await Store.connect({database});
 try{
  const id='a'.repeat(64),at=Date.now();const results=await Promise.all([a.claimLogistics(id,at,at+INTERVAL,'token-a'),b.claimLogistics(id,at,at+INTERVAL,'token-b')]);
  assert.equal(results[0].token,results[1].token);const winner=results[0].token;
  await a.saveLogistics(id,winner,{events:[{text:'测试轨迹'}]});const cached=await b.claimLogistics(id,at+1,at+INTERVAL,'token-c');assert.equal(cached.result.events[0].text,'测试轨迹');
  await b.claimLogistics(id,at+INTERVAL+1,at+INTERVAL*2,'token-new');await a.saveLogistics(id,winner,{events:[{text:'过时响应'}]});const fresh=await a.claimLogistics(id,at+INTERVAL+2,at+INTERVAL*2,'token-d');assert.equal(fresh.token,'token-new');assert.equal(fresh.result.events[0].text,'测试轨迹');
 }finally{if(engine==='mongo')await a.db.dropDatabase();else await a.query('DROP DATABASE `'+database+'`');await a.close();await b.close();}
});

test('HTTP tracking 按登录用户验证订单，并通过物流网关返回运单轨迹',async()=>{
 const f=fixture(),{Auth,createAccount}=require('../server/auth'),{createServer}=require('../server/http');
 const auth=new Auth([createAccount('alice','test-password-alice','buyer','alice'),createAccount('bob','test-password-bob','buyer','bob')]);
 const server=createServer(f.store,{auth,logisticsEnv:env,fetch:f.options.fetch});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const url='http://127.0.0.1:'+server.address().port+'/api';
  const call=async(token)=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'tracking',input:{id:'o1',number:'IGNORED'}})});return {status:r.status,body:await r.json()};};
  const aliceLogin=await auth.login('alice','test-password-alice'),bobLogin=await auth.login('bob','test-password-bob');
  assert.equal((await call(bobLogin.token)).status,403);assert.equal(f.count(),0);
  const r=await call(aliceLogin.token);assert.equal(r.status,200);assert.equal(r.body.data.number,'SF123456789');assert.equal(r.body.data.events.length,1);assert.equal(f.count(),1);
 }finally{await new Promise(r=>server.close(r));}
});
