const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const domain=require('../cloudfunctions/shop/domain');
function cloudFixture(){
 let stored=domain.seed(),user='buyer',enabled=false,writes=0;
 const cloud={init(){},getWXContext:()=>({OPENID:user}),database:()=>({runTransaction:async fn=>{
   let draft=JSON.parse(JSON.stringify(stored));let pending=false;
   const result=await fn({collection:name=>({doc:id=>({
     get:async()=>name==='merchants'?{data:enabled?{_id:id,enabled:true}:null}:{data:{value:draft}},
     update:async({data})=>{assert.equal(name,'shop_state');assert.equal(id,'singleton');draft=data.value;pending=true;}
   })})});
   if(pending){stored=draft;writes++;}return {result,errMsg:'runTransaction:ok'};
 }})};
 const sandbox={require:n=>n==='wx-server-sdk'?cloud:domain,exports:{},Buffer};
 vm.runInNewContext(fs.readFileSync(require.resolve('../cloudfunctions/shop/index'),'utf8'),sandbox);
 return {call:(action,input={},extra={})=>sandbox.exports.main({action,input,...extra}),state:()=>stored,writes:()=>writes,identity:(id,merchant=false)=>{user=id;enabled=merchant;}};
}
test('复核：实际云函数路径完成建地址和下单，金额库存来自服务端且解析事务包装',async()=>{
 const f=cloudFixture();const a=await f.call('saveAddress',{name:'验收买家',phone:'13800000000',detail:'样例街道 1 号'});assert.equal(a.ok,true);
 const payload={key:'review-order-1',addressId:a.data.id,lines:[{productId:'food',skuId:'food-1',qty:2}],total:1};
 const o=await f.call('createOrder',payload);assert.equal(o.ok,true);assert.equal(o.data.total,8600);assert.equal(f.state().products[0].skus[0].stock,18);
 const repeated=await f.call('createOrder',payload);assert.equal(repeated.data.id,o.data.id);assert.equal(f.state().orders.length,1);assert.equal(f.state().products[0].skus[0].stock,18);
 const before=JSON.stringify(f.state()),writes=f.writes();const bad=await f.call('createOrder',{...payload,key:'review-order-2',lines:[{productId:'food',skuId:'food-1',qty:99}]});assert.equal(bad.error,'OUT_OF_STOCK');assert.equal(JSON.stringify(f.state()),before);assert.equal(f.writes(),writes);
});
test('复核：有效订单也不能从云端模拟付款，授权商家也不能模拟退款',async()=>{
 const f=cloudFixture();const a=await f.call('saveAddress',{name:'验收',phone:'13800000000',detail:'样例街道 1 号'});const o=await f.call('createOrder',{key:'review-payment',addressId:a.data.id,lines:[{productId:'food',skuId:'food-1',qty:1}]});
 for(const extra of [{mock:true},{mode:'mock'},{options:{mock:true}}])assert.equal((await f.call('mockPay',{id:o.data.id,mock:true},extra)).error,'MOCK_DISABLED');
 assert.equal((await f.call('payment',{id:o.data.id})).error,'REAL_PAYMENT_NOT_CONFIGURED');assert.equal(f.state().orders[0].status,'PENDING');
 f.identity('merchant',true);assert.equal((await f.call('mockRefund',{id:o.data.id},{mock:true})).error,'MOCK_DISABLED');
 assert.equal((await f.call('settleVerifiedPayment',{orderId:o.data.id,amount:o.data.total,paid:true})).error,'UNKNOWN_ACTION');
});
test('复核：云端订单隔离与商家授权文档生效',async()=>{
 const f=cloudFixture();const a=await f.call('saveAddress',{name:'验收',phone:'13800000000',detail:'样例街道 1 号'});const o=await f.call('createOrder',{key:'review-auth-1',addressId:a.data.id,lines:[{productId:'food',skuId:'food-1',qty:1}]});
 f.identity('other');assert.equal((await f.call('order',{id:o.data.id,merchant:true})).error,'FORBIDDEN');assert.equal((await f.call('merchantOrders',{}, {role:'merchant',OPENID:'buyer'})).error,'FORBIDDEN');
 f.identity('merchant',true);assert.equal((await f.call('merchantOrders')).data.length,1);assert.equal((await f.call('cancel',{id:o.data.id})).data.status,'CANCELLED');assert.equal(f.state().products[0].skus[0].stock,20);
 f.identity('merchant',false);assert.equal((await f.call('merchantOrders')).error,'FORBIDDEN');
});
test('复核：WXML 标签结构闭合，长详情使用滚动容器（不等同微信编译）',()=>{
 const xml=fs.readFileSync(require.resolve('../miniprogram/pages/shop/index.wxml'),'utf8');
 const source=xml.replace(/\{\{[\s\S]*?\}\}/g,'EXPR');const stack=[];
 for(const tag of source.matchAll(/<\/?([a-z][\w-]*)\b[^>]*>/g)){const full=tag[0];if(full.startsWith('</'))assert.equal(stack.pop(),tag[1],full);else if(!full.endsWith('/>'))stack.push(tag[1]);}
 assert.deepEqual(stack,[]);assert.match(xml,/<view wx:if="\{\{detail\}\}" class="overlay"><scroll-view scroll-y class="sheet">/);
});
test('复核：模拟包逐字同步，MongoDB 适配器引用同一领域文件，源码 UTF-8 完整',()=>{
 const root=path.resolve(__dirname,'..');assert.equal(fs.readFileSync(path.join(root,'miniprogram/lib/domain.js'),'utf8'),fs.readFileSync(path.join(root,'cloudfunctions/shop/domain.js'),'utf8'));
 assert.match(fs.readFileSync(path.join(root,'server/mongo-store.js'),'utf8'),/require\('\.\.\/cloudfunctions\/shop\/domain'\)/);
 for(const file of ['miniprogram/pages/shop/index.wxml','miniprogram/pages/shop/index.js','cloudfunctions/shop/domain.js'])assert.ok(!fs.readFileSync(path.join(root,file),'utf8').includes('\uFFFD'),file);
});
