const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const domain=require('../cloudfunctions/shop/domain');
test('云函数使用微信上下文，忽略伪造身份及 mock 参数',async()=>{
 let stored=domain.seed(),writes=0;const cloud={DYNAMIC_CURRENT_ENV:'test',init(){},getWXContext(){return {OPENID:'actual-user'};},database(){return {runTransaction:async fn=>fn({collection(name){return name==='merchants'?{doc:id=>{assert.equal(id,'actual-user');return {get:async()=>({data:null})};}}:{doc:id=>({get:async()=>({data:{value:stored}}),update:async({data})=>{stored=data.value;writes++;}})};}})};}};
 const sandbox={require:n=>n==='wx-server-sdk'?cloud:domain,exports:{},Buffer};vm.runInNewContext(fs.readFileSync(require.resolve('../cloudfunctions/shop/index'),'utf8'),sandbox);
 let r=await sandbox.exports.main({action:'merchantOrders',input:{merchant:true},OPENID:'owner',mock:true});assert.equal(r.ok,false);assert.equal(r.error,'FORBIDDEN');assert.equal(writes,0);
 r=await sandbox.exports.main({action:'mockPay',input:{id:'fake'},mock:true});assert.equal(r.error,'MOCK_DISABLED');assert.equal(writes,0);
 r=await sandbox.exports.main({action:'identity'});assert.equal(r.data.id,'actual-user');assert.equal(r.data.mode,'cloud');
});
test('小程序模拟适配器本地持久化，云模式不回退到本地',async()=>{
 const storage={};let config={mode:'mock'};const mock={getStorageSync:k=>storage[k],setStorageSync:(k,v)=>storage[k]=v};
 const context={wx:mock,module:{exports:{}},require:n=>n.includes('config')?config:domain};
 vm.runInNewContext(fs.readFileSync(require.resolve('./fixtures/legacy/api'),'utf8'),context);const api=context.module.exports;
 assert.equal((await api.call('catalog')).length,3);await assert.rejects(api.call('merchantOrders'),/FORBIDDEN/);api.setDemoMerchant(true);assert.equal((await api.call('merchantProducts')).length,3);
 config.mode='cloud';await assert.rejects(api.call('catalog'),/CLOUDBASE_ENV_REQUIRED/);assert.throws(()=>api.setDemoMerchant(true),/MOCK_DISABLED/);
});
test('上传云函数拒绝未授权身份，不调用存储',async()=>{
 const cloud={init(){},getWXContext:()=>({OPENID:'buyer'}),database:()=>({collection:()=>({doc:()=>({get:async()=>({data:null})})})}),uploadFile:()=>{throw Error('must not call');}};
 const sandbox={require:n=>n==='wx-server-sdk'?cloud:require(n),exports:{},Buffer};vm.runInNewContext(fs.readFileSync(require.resolve('../cloudfunctions/uploadImage/index'),'utf8'),sandbox);
 const r=await sandbox.exports.main({base64:'fake',merchant:true});assert.equal(r.error,'FORBIDDEN');
});

test('小程序本地 HTTP 模式：图片路径转换、模拟角色、失败不降级',async()=>{let config={mode:'local',apiBase:'http://127.0.0.1:4173'},last;const wx={request:o=>{last=o;o.success({statusCode:200,data:{ok:true,data:{image:'/uploads/abc.jpg',title:'normal'}}});}};const c={wx,module:{exports:{}},require:n=>n.includes('config')?config:domain};vm.runInNewContext(fs.readFileSync(require.resolve('./fixtures/legacy/api'),'utf8'),c);const api=c.module.exports;api.setDemoMerchant(true);const p=await api.call('saveProduct',{image:'http://127.0.0.1:4173/uploads/abc.jpg'});assert.equal(p.image,'http://127.0.0.1:4173/uploads/abc.jpg');assert.equal(last.data.input.image,'/uploads/abc.jpg');assert.equal(last.data.role,'merchant');wx.request=o=>o.fail({});await assert.rejects(api.call('catalog'),/连接本地服务失败/);config.apiBase='http://example.com:4173';await assert.rejects(api.call('catalog'),/LOOPBACK/);});
