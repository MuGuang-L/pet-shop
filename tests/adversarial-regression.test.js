'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {seed,execute}=require('../cloudfunctions/shop/domain');
const owner={id:'owner',merchant:true},buyer={id:'buyer'};
function fixture(){let state=seed();return {get state(){return state;},call(action,input={},actor=owner){const out=execute(state,actor,action,input,{mock:true,now:1000});state=out.state;return out.result;}};}
const input={key:'audit-inventory',fulfillment:'PICKUP',contact:{name:'模拟',phone:'13800000000'},lines:[{productId:'food',skuId:'food-1',qty:1}]};

test('旧编辑页不能覆盖下单库存，取消后恢复 20 而不是 21',()=>{
 const f=fixture(),stale=f.call('merchantProducts')[0];
 const o=f.call('createOrder',input,buyer);stale.name='只改名称';
 assert.throws(()=>f.call('saveProduct',stale),/PRODUCT_REVISION_CONFLICT/);
 assert.equal(f.state.products[0].skus[0].stock,19);
 const fresh=f.call('merchantProducts')[0];f.call('saveProduct',{...fresh,name:stale.name});
 f.call('cancel',{id:o.id},buyer);f.call('cancel',{id:o.id},buyer);
 assert.equal(f.state.products[0].skus[0].stock,20);
});

test('并发编辑与无版本旧商家请求被拒绝，旧数据库无需重置即可编辑',()=>{
 const f=fixture();delete f.state.products[0].revision;
 const a=f.call('merchantProducts')[0],b=structuredClone(a);assert.equal(a.revision,0);
 f.call('saveProduct',{...a,name:'修改后的名称'});
 assert.throws(()=>f.call('saveProduct',{...b,description:'另一页编辑'}),/PRODUCT_REVISION_CONFLICT/);
 const fresh=f.call('merchantProducts')[0];delete fresh.revision;
 assert.throws(()=>f.call('saveProduct',fresh),/PRODUCT_REVISION_CONFLICT/);
 assert.equal(f.state.products[0].name,'修改后的名称');
});

test('预留库存计入容量限制，取消和超时不会溢出或重复释放',()=>{
 const f=fixture(),o=f.call('createOrder',input,buyer),p=f.call('merchantProducts')[0];
 p.skus[0].stock=100000;assert.throws(()=>f.call('saveProduct',p),/100000/);
 p.skus[0].stock=99999;f.call('saveProduct',p);f.call('cancel',{id:o.id},buyer);
 assert.equal(f.state.products[0].skus[0].stock,100000);
});

test('退货入库使旧编辑页失效，容量检查保留其他订单的回补空间',()=>{
 const f=fixture();let o=f.call('createOrder',input,buyer);f.call('mockPay',{id:o.id},buyer);f.call('pickupReady',{id:o.id});f.call('pickupRedeem',{id:o.id,code:o.fulfillment.code});
 o=f.call('refundRequest',{id:o.id,type:'RETURN_REFUND',reason:'模拟退货'},buyer);const ref={id:o.id,caseId:o.refund.caseId};
 f.call('refundReview',{...ref,approve:true,note:'同意',returnAddress:{name:'测试仓',phone:'13800000000',detail:'模拟市仓库 1 号'}});
 f.call('returnShip',{...ref,company:'模拟',number:'RETURN-001'},buyer);
 const pending=f.call('createOrder',{...input,key:'another-reservation'},buyer);
 let p=f.call('merchantProducts')[0];p.skus[0].stock=99999;f.call('saveProduct',p);
 const inspection={...ref,confirm:true,note:'完好',items:[{productId:'food',skuId:'food-1',receivedQty:1,restockQty:1}]};
 assert.throws(()=>f.call('returnInspect',inspection),/上限/);
 assert.equal(f.state.stockMovements.filter(r=>r.type==='RETURN_INSPECTION').length,0);
 p=f.call('merchantProducts')[0];p.skus[0].stock=99998;f.call('saveProduct',p);
 const stale=f.call('merchantProducts')[0];f.call('returnInspect',inspection);f.call('returnInspect',inspection);
 assert.throws(()=>f.call('saveProduct',stale),/PRODUCT_REVISION_CONFLICT/);
 f.call('cancel',{id:pending.id},buyer);assert.equal(f.state.products[0].skus[0].stock,100000);
 assert.equal(f.state.stockMovements.filter(r=>r.type==='RETURN_INSPECTION').length,1);
});

test('畸形 URL 和断开连接不终止 HTTP 服务，随后健康检查正常',async()=>{
 const {createServer}=require('../server/http'),{Auth}=require('../server/auth'),net=require('node:net');
 const server=createServer({db:{command:async()=>({ok:1})}},{auth:new Auth([])});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 try {
  for(const path of ['http://[','http://%','http://[::1']){
   const response=await new Promise((resolve,reject)=>{let result='';const socket=net.connect(port,'127.0.0.1',()=>socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`));socket.setTimeout(2000,()=>socket.destroy(Error('timeout')));socket.on('data',d=>result+=d);socket.on('error',reject);socket.on('end',()=>resolve(result));});
   assert.match(response,/HTTP\/1.1 400/);assert.match(response,/INVALID_REQUEST_URL/);
  }
  await new Promise(resolve=>{const socket=net.connect(port,'127.0.0.1',()=>{socket.write('POST /api HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\n{');socket.destroy();});socket.on('close',resolve);});
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,200);
 }finally{await new Promise(r=>server.close(r));}
});

test('MongoDB 暂不可用返回可重试 503，不暴露连接详情',async()=>{
 const {createServer}=require('../server/http'),{Auth}=require('../server/auth');
 const server=createServer({db:{command:async()=>{const error=Error('private connection details');error.name='MongoServerSelectionError';throw error;}}},{auth:new Auth([])});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const r=await fetch(`http://127.0.0.1:${server.address().port}/health`);assert.equal(r.status,503);assert.deepEqual(await r.json(),{ok:false,error:'DATABASE_TEMPORARILY_UNAVAILABLE',retryable:true});}
 finally{await new Promise(r=>server.close(r));}
});
