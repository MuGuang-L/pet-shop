'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {Auth,createAccount}=require('../server/auth');
const pause=ms=>new Promise(r=>setTimeout(r,ms));

function merchant(fetch){
 const nodes={};const node=id=>nodes[id]||=( {style:{},close(){},addEventListener(){}} );
 const context=vm.createContext({Studio:require('../cloudfunctions/shop/studio'),fetch,AbortController,
  setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,20)),clearTimeout,
  document:{getElementById:node,querySelectorAll:()=>[]},window:{addEventListener(){}}});
 vm.runInContext(fs.readFileSync(require.resolve('../apps/merchant-web/app'),'utf8').replace(/boot\(\);\s*$/,''),context);
 return code=>vm.runInContext(code,context);
}
test('商家读取遇到网关 HTML 或 503 有限重试，正常响应恢复显示',async()=>{
 for(const scenario of ['html','503']){let calls=0;const run=merchant(async()=>{calls++;return calls===1?{status:503,json:async()=>{if(scenario==='html')throw SyntaxError('private proxy detail');return {ok:false,error:'DATABASE_TEMPORARILY_UNAVAILABLE'};}}:{status:200,json:async()=>({ok:true,data:['loaded']})};});
 assert.equal((await run("api('merchantProducts')"))[0],'loaded');assert.equal(calls,2);}
});
test('商家保存超时会终止等待，不自动重发；读取最多尝试两次',async()=>{
 for(const action of ['saveProduct','merchantOrders']){let calls=0,aborted=0;const run=merchant(async(_,{signal})=>{calls++;signal.addEventListener('abort',()=>aborted++);return new Promise(()=>{});});
 await assert.rejects(run(`api('${action}',{})`),action==='saveProduct'?/未收到确认结果/:/暂时不可用/);
 assert.equal(calls,action==='saveProduct'?1:2);assert.equal(aborted,calls);}
});
test('商家业务校验失败不会当作网络故障重试',async()=>{
 let calls=0;const run=merchant(async()=>{calls++;return {status:400,json:async()=>({ok:false,error:'PRODUCT_REVISION_CONFLICT'})};});
 await assert.rejects(run("api('saveProduct')"),/商品或库存已变化/);assert.equal(calls,1);
});

function buyer(handler){const storage={'pet-shop-session-v2':{apiBase:'https://shop.example.test',token:'session-a',id:'a'}},calls=[];
 const wx={getStorageSync:k=>storage[k],setStorageSync:(k,v)=>storage[k]=v,removeStorageSync:k=>delete storage[k],request:o=>{calls.push(o);handler(o,calls.length);}};
 const context={wx,module:{exports:{}},require:()=>({apiBase:'https://shop.example.test'}),setTimeout:(fn)=>setTimeout(fn,1)};
 vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/api'),'utf8'),context);return {api:context.module.exports,calls,storage};
}
test('小程序地址校验显示中文说明，保留错误码且不重试保存',async()=>{
 for(const [code,message] of [['ADDRESS_NAME','请填写收货人姓名，最多 40 个字'],['ADDRESS_PHONE','请填写 11 位手机号码'],['ADDRESS_DETAIL','请填写 5～200 个字的详细地址'],['ADDRESS_REQUIRED','请选择收货地址']]){
  const f=buyer(o=>o.success({statusCode:400,data:{ok:false,error:code}}));
  await assert.rejects(f.api.call('saveAddress',{}),e=>e.message===message&&e.code===code&&e.definitive===true);assert.equal(f.calls.length,1);
 }
});
test('小程序断网读取可恢复，下单超时不自动重发并保留不确定标记',async()=>{
 const f=buyer((o,n)=>n===1?o.fail({errMsg:'timeout'}):o.success({statusCode:200,data:{ok:true,data:[]}}));
 await f.api.call('catalog');assert.equal(f.calls.length,2);assert.equal(f.calls[0].timeout,15000);
 const g=buyer(o=>o.fail({errMsg:'timeout'}));await assert.rejects(g.api.call('createOrder',{key:'retained-key'}),e=>e.retryable===true&&e.definitive===false);assert.equal(g.calls.length,1);
});
test('小程序旧请求的 401 不清除新账号会话，迟到成功响应也不回填新账号',async()=>{
 for(const status of [401,200]){let request;const f=buyer(o=>request=o);const pending=f.api.call('catalog');
 f.storage['pet-shop-session-v2']={apiBase:'https://shop.example.test',token:'session-b',id:'b'};
 request.success({statusCode:status,data:status===200?{ok:true,data:['old-account-data']}:{ok:false,error:'AUTH_REQUIRED'}});
 await assert.rejects(pending,/AUTH_REQUIRED/);assert.equal(f.storage['pet-shop-session-v2'].token,'session-b');assert.equal(f.calls.length,1);}
});

test('数据库晚启动时健康检查为 503，连接恢复后无需重启 HTTP；断连写请求不排队',async()=>{
 const {start}=require('../server/index');let attempts=0,online=false,writes=0,closed=0;
 const unavailable=()=>Object.assign(Error('private connection'),{name:'MongoServerSelectionError'});
 const store={db:{command:async()=>{if(!online)throw unavailable();return {ok:1};}},execute:async()=>{if(!online)throw unavailable();writes++;return [];},close:async()=>closed++};
 const auth=new Auth([createAccount('owner','test-password','merchant','owner')]),token=(await auth.login('owner','test-password')).token;
 const service=await start({port:0,retryDelay:5,logger:{log(){},error(){}},httpOptions:{auth},connect:async()=>{attempts++;if(attempts<3)throw unavailable();online=true;return store;}});
 const base='http://127.0.0.1:'+service.server.address().port;
 try{
  assert.equal((await fetch(base+'/admin/')).status,200);
  for(let n=0;n<100&&!online;n++)await pause(5);assert.equal(online,true);assert.equal(attempts,3);
  assert.equal((await fetch(base+'/health')).status,200);
  online=false;assert.equal((await fetch(base+'/health')).status,503);
  const save=()=>fetch(base+'/api',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({action:'saveProduct',input:{}})});
  assert.equal((await save()).status,503);assert.equal(writes,0);
  online=true;assert.equal((await fetch(base+'/health')).status,200);assert.equal(writes,0);
  assert.equal((await save()).status,200);assert.equal(writes,1);
 }finally{await service.stop();}assert.equal(closed,1);
});

test('新增商品和地址丢响应后复用请求键只保存一份，账号隔离且改载荷被拒绝',()=>{
 const domain=require('../cloudfunctions/shop/domain'),owner={id:'owner',merchant:true};let state=domain.seed();
 const run=(action,input,actor=owner)=>{const result=domain.execute(state,actor,action,input,{mock:true});state=result.state;return result.result;};
 const product={...require('../cloudfunctions/shop/studio').create(),name:'网络重试新品',requestKey:'new-product-request'};
 const first=run('saveProduct',product);assert.equal(run('saveProduct',product).id,first.id);assert.equal(state.products.length,4);
 assert.throws(()=>run('saveProduct',{...product,name:'改名后的重试'}),/CREATE_REQUEST_CONFLICT/);
 assert.throws(()=>run('saveProduct',product,{id:'owner',merchant:false}),/FORBIDDEN/);
 const address={name:'模拟',phone:'13800000000',detail:'模拟市地址 1 号',requestKey:'new-address-request'};
 const a=run('saveAddress',address,{id:'a'});assert.equal(run('saveAddress',address,{id:'a'}).id,a.id);assert.equal(state.addresses.a.length,1);
 assert.notEqual(run('saveAddress',address,{id:'b'}).id,a.id);
});

test('数据库初始化未完成可及时响应 503，停止时关闭迟到的连接',async()=>{
 const {start}=require('../server/index');let finish,closed=0;
 const service=await start({port:0,httpOptions:{auth:new Auth([])},logger:{log(){},error(){}},connect:()=>new Promise(r=>finish=r)});
 const base='http://127.0.0.1:'+service.server.address().port;
 assert.equal((await fetch(base+'/health')).status,503);
 const stopping=service.stop();finish({close:async()=>closed++});await stopping;assert.equal(closed,1);
});

test('JSON 语法错误和非对象请求返回明确错误，服务仍可处理后续请求',async()=>{
 const {createServer}=require('../server/http');const server=createServer({db:{command:async()=>({ok:1})}},{auth:new Auth([])});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{for(const [body,error] of [['{','INVALID_JSON'],['null','INVALID_BODY'],['[]','INVALID_BODY']]){
  const r=await fetch(base+'/api',{method:'POST',body});assert.equal(r.status,400);assert.equal((await r.json()).error,error);
 }assert.equal((await fetch(base+'/health')).status,200);assert.equal(server.requestTimeout,20000);}
 finally{await new Promise(r=>server.close(r));}
});

test('内部错误不向客户端回传文件位置或调试详情',async()=>{
 const {createServer}=require('../server/http');const server=createServer({db:{command:async()=>{throw Object.assign(Error('internal file location'),{code:'ENOENT'});}}},{auth:new Auth([])});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const r=await fetch('http://127.0.0.1:'+server.address().port+'/health');assert.equal(r.status,500);assert.deepEqual(await r.json(),{ok:false,error:'SERVICE_TEMPORARILY_UNAVAILABLE',retryable:true});}
 finally{await new Promise(r=>server.close(r));}
});


test('两侧登录限流和繁忙有可读提示，不自动重发，不误报商品保存结果',async()=>{
 for(const [status,error,message] of [[400,'INVALID_CREDENTIALS','账号或密码不正确'],[429,'LOGIN_RATE_LIMIT','登录尝试过多'],[503,'LOGIN_BUSY','当前登录人数较多']]){
  let calls=0;const run=merchant(async()=>{calls++;return {status,json:async()=>({ok:false,error})};});
  await assert.rejects(run("request('/auth/login',{username:'buyer',password:'test'})"),e=>e.message.includes(message));assert.equal(calls,1);
  const f=buyer(o=>o.success({statusCode:status,data:{ok:false,error}}));
  await assert.rejects(f.api.login('buyer','test'),e=>e.message.includes(message));assert.equal(f.calls.length,1);assert.equal(f.storage['pet-shop-session-v2'].token,'session-a');
 }
 const run=merchant(async()=>{throw Error('network failure');});await assert.rejects(run("request('/auth/login',{})"),e=>e.message==='登录请求未得到确认，请检查网络后重试。');
});
