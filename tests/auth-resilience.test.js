'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Auth,createAccount}=require('../server/auth');
const {createServer}=require('../server/http');
const account=createAccount('buyer','auth-test-password','buyer','auth-buyer');
const merchant=createAccount('owner','merchant-test-password','merchant','auth-owner');
const credentials={username:'buyer',password:'auth-test-password'};
const request=token=>({headers:{authorization:'Bearer '+token}});

test('真实密码校验异步让出执行，不阻塞事件循环，保持原账号哈希兼容',async()=>{
 const auth=new Auth([account]);let settled=false;
 const pending=auth.login(credentials.username,credentials.password);
 assert.equal(typeof pending.then,'function');pending.finally(()=>{settled=true;});
 await new Promise(resolve=>queueMicrotask(resolve));assert.equal(settled,false);
 const result=await pending;assert.equal(auth.identity(request(result.token)).id,account.id);
 await assert.rejects(auth.login('unknown','auth-test-password'),/INVALID_CREDENTIALS/);
 await assert.rejects(auth.login('buyer','wrong'),/INVALID_CREDENTIALS/);
});

test('登录校验等待时健康检查与已有会话仍可用，超出并发直接拒绝而不排队',async()=>{
 let release;const gate=new Promise(r=>{release=r;});let computations=0;
 const auth=new Auth([account,merchant],{deriveKey:async()=>{computations++;await gate;return Buffer.from(account.hash,'hex');}});
 // Existing sessions remain usable independently of login work.
 const ownerToken='a'.repeat(64);auth.sessions.set(ownerToken,{identity:{id:merchant.id,merchant:true,username:'owner'},expiresAt:Date.now()+60000});
 const server=createServer({db:{command:async()=>({ok:1})},execute:async actor=>({merchant:actor.merchant})},{auth});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const login=()=>fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)});
 let first,second;
 try{
  first=login();second=login();
  for(let n=0;n<100&&computations<2;n++)await new Promise(r=>setTimeout(r,5));assert.equal(computations,2);
  const rejected=await login();assert.equal(rejected.status,503);assert.equal((await rejected.json()).error,'LOGIN_BUSY');assert.equal(rejected.headers.get('retry-after'),'1');assert.equal(computations,2);
  assert.equal((await fetch(base+'/health')).status,200);
  const me=await fetch(base+'/auth/me',{method:'POST',headers:{Authorization:'Bearer '+ownerToken},body:'{}'});assert.equal((await me.json()).data.merchant,true);
  release();for(const response of await Promise.all([first,second])){assert.equal(response.status,200);assert.match((await response.json()).data.token,/^[a-f0-9]{64}$/);}
  assert.equal(auth.activeLogins,0);
  for(let n=0;n<=10;n++){
   const r=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':'192.0.2.'+n},body:JSON.stringify({username:'missing-'+n,password:'wrong'})});
   assert.equal(r.status,n<10?400:429);const out=await r.json();assert.equal(out.error,n<10?'INVALID_CREDENTIALS':'LOGIN_RATE_LIMIT');
   if(n===10){assert.ok(Number(r.headers.get('retry-after'))>=1);assert.ok(Number(r.headers.get('retry-after'))<=60);assert.equal(r.headers.get('set-cookie'),null);}
  }
  assert.equal((await fetch(base+'/health')).status,200);
 }finally{release();await Promise.allSettled([first,second].filter(Boolean));await new Promise(r=>server.close(r));}
});

test('随机用户名不能无限扩大限流记录，限流到期可恢复，成功登录也受全局预算约束',async()=>{
 let now=1000,computations=0;
 const auth=new Auth([account],{now:()=>now,deriveKey:async()=>{computations++;return Buffer.from(account.hash,'hex');}});
 for(let i=0;i<1000;i++)await assert.rejects(auth.login('absent-'+i,'wrong'),/INVALID_CREDENTIALS|LOGIN_RATE_LIMIT/);
 assert.equal(computations,10);assert.equal(auth.attempts.size,1);
 now+=60000;const first=await auth.login('buyer','auth-test-password');assert.equal(auth.identity(request(first.token)).id,account.id);
 for(let i=1;i<60;i++)await auth.login('buyer','auth-test-password');
 await assert.rejects(auth.login('buyer','auth-test-password'),e=>e.message==='LOGIN_RATE_LIMIT'&&e.retryAfter===60);
 now+=60000;assert.ok((await auth.login('buyer','auth-test-password')).token);
});

test('会话按账号限量，不能靠反复登录挤掉另一账号；过期即清理',async()=>{
 let now=1000;
 const auth=new Auth([account,merchant],{now:()=>now,deriveKey:async(_,salt)=>Buffer.from((salt===merchant.salt?merchant:account).hash,'hex')});
 const owner=await auth.login('owner','merchant-test-password'),tokens=[];
 for(let n=0;n<12;n++)tokens.push((await auth.login('buyer','auth-test-password')).token);
 assert.equal(auth.sessions.size,9);assert.throws(()=>auth.identity(request(tokens[0])),/AUTH_REQUIRED/);
 assert.equal(auth.identity(request(owner.token)).merchant,true);assert.equal(auth.identity(request(tokens.at(-1))).merchant,false);
 auth.logout(request(tokens.at(-1)));assert.throws(()=>auth.identity(request(tokens.at(-1))),/AUTH_REQUIRED/);
 now+=8*60*60*1000;assert.throws(()=>auth.identity(request(owner.token)),/AUTH_REQUIRED/);assert.equal(auth.sessions.has(owner.token),false);
 await auth.login('buyer','auth-test-password');assert.equal(auth.sessions.size,1);
});

test('校验失败和校验器异常释放并发槽位；账号配置冲突在启动前拒绝',async()=>{
 let fail=true;const auth=new Auth([account],{deriveKey:async()=>{if(fail)throw Error('TEST_HASH_UNAVAILABLE');return Buffer.from(account.hash,'hex');}});
 await assert.rejects(auth.login('buyer','auth-test-password'),/TEST_HASH_UNAVAILABLE/);assert.equal(auth.activeLogins,0);fail=false;
 assert.ok((await auth.login('buyer','auth-test-password')).token);
 for(const records of [[{...account,hash:'broken'}],[account,{...account,username:'second'}],[account,{...account,id:'second'}],[{...account,role:'administrator'}]])assert.throws(()=>new Auth(records),/INVALID_ACCOUNT_CONFIGURATION/);
});

test('跨账号会话总量有上限，异常 Authorization 不回退到 Cookie 身份',async()=>{
 let now=1000;
 const accounts=Array.from({length:33},(_,n)=>({...account,username:'buyer-'+n,id:'buyer-'+n}));
 const auth=new Auth(accounts,{now:()=>now,deriveKey:async()=>Buffer.from(account.hash,'hex')});let first,last;
 for(let n=0;n<accounts.length;n++){
  if(n%4===0)now+=60000;
  for(let i=0;i<8;i++){last=await auth.login(accounts[n].username,'auth-test-password');first||=last;}
 }
 assert.equal(auth.sessions.size,256);assert.throws(()=>auth.identity(request(first.token)),/AUTH_REQUIRED/);
 const cookie='pet_session='+last.token;assert.equal(auth.identity({headers:{cookie}}).id,'buyer-32');
 for(const authorization of ['Basic ignored','Bearer malformed',[],null])assert.throws(()=>auth.identity({headers:{authorization,cookie}}),/AUTH_REQUIRED/);
});

test('非法登录载荷无需密码计算，不生成尝试记录或会话',async()=>{
 let calculations=0;const auth=new Auth([account],{deriveKey:async()=>{calculations++;return Buffer.from(account.hash,'hex');}});
 for(const [username,password] of [[null,'password'],['','password'],['x'.repeat(81),'password'],['buyer',{}],['buyer','x'.repeat(201)]])await assert.rejects(auth.login(username,password),/INVALID_CREDENTIALS/);
 assert.equal(calculations,0);assert.equal(auth.attempts.size,0);assert.equal(auth.sessions.size,0);
});
