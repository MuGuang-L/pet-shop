const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('买家适配器：HTTPS 联调登录、Bearer 请求、图片路径、不发送角色',async()=>{const storage={},calls=[],config={apiBase:'https://shop.example.test'};const wx={getStorageSync:k=>storage[k],setStorageSync:(k,v)=>storage[k]=v,removeStorageSync:k=>delete storage[k],request:o=>{calls.push(o);o.success({statusCode:200,data:{ok:true,data:o.url.endsWith('/auth/login')?{token:'test-session',identity:{id:'friend',merchant:false}}:{image:'/assets/toy-v2.jpg'}}});}};const c={wx,module:{exports:{}},require:()=>config};vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/api'),'utf8'),c);const api=c.module.exports;await api.login('friend','test-password');const p=await api.call('catalog');assert.equal(calls.at(-1).header.Authorization,'Bearer test-session');assert.equal(calls.at(-1).data.role,undefined);assert.equal(p.image,'https://shop.example.test/assets/toy-v2.jpg');config.apiBase='https://another.example.test';assert.equal(api.hasSession(),false);config.apiBase='http://public.example';await assert.rejects(api.call('catalog'),/HTTPS/);});
test('云托管调用保留开发者工具返回的错误码',async()=>{const config={mode:'cloud',cloud:{env:'prod-demo',service:'pet-shop'}},wx={getStorageSync(){},setStorageSync(){},removeStorageSync(){},cloud:{callContainer:o=>o.fail({errMsg:'cloud.callContainer:fail service not found'})}};const c={wx,module:{exports:{}},require:()=>config};vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/api'),'utf8'),c);await assert.rejects(c.module.exports.call('createOrder'),/cloud\.callContainer:fail service not found/);});
test('当前买家小程序没有商家界面与商家操作入口，事件处理器完整',()=>{let page;const api={mode:'api',hasSession:()=>false};const context={Page:p=>page=p,require:n=>n.includes('studio')?require('../cloudfunctions/shop/studio'):api};vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/shop/index'),'utf8'),context);const xml=fs.readFileSync('miniprogram/pages/shop/index.wxml','utf8');assert.doesNotMatch(xml,/商家工作台|启用本地模拟商家|bindtap="ship"|bindtap="saveProduct"/);assert.equal(page.demoRole,undefined);assert.equal(page.saveProduct,undefined);assert.equal(page.ship,undefined);for(const m of xml.matchAll(/(?:bind|catch)\w+="(\w+)"/g))assert.equal(typeof page[m[1]],'function',m[1]);});

test('下单恢复记录按服务地址和账号隔离，401 与 503 不视为确定下单失败',async()=>{
 const storage={},config={apiBase:'https://a.example.test'};let status=200;
 const wx={getStorageSync:k=>storage[k],setStorageSync:(k,v)=>storage[k]=v,removeStorageSync:k=>delete storage[k],request:o=>o.success(status===200?{statusCode:200,data:{ok:true,data:{token:'session',identity:{id:o.data.username,merchant:false}}}}:{statusCode:status,data:{ok:false,error:'FAIL'}})};
 const c={wx,module:{exports:{}},require:()=>config};vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/api'),'utf8'),c);const api=c.module.exports;
 await api.login('alice','test');const a=api.checkoutScope();await api.login('bob','test');assert.notEqual(api.checkoutScope(),a);
 config.apiBase='https://b.example.test';await api.login('alice','test');assert.notEqual(api.checkoutScope(),a);
 for(const code of [503,401,400]){status=code;await assert.rejects(api.call('createOrder'),error=>error.definitive===(code===400));}
});

test('云托管支付授权错误解释原因并保留错误码',async()=>{
 for(const code of ['NOAUTH','NO_AUTH']){
  const config={mode:'cloud',cloud:{env:'test-env',service:'pet-shop'}};let requests=0;
  const wx={cloud:{callContainer:o=>{requests++;o.success({statusCode:400,data:{ok:false,error:code}});}}};
  const c={wx,module:{exports:{}},require:()=>config};vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/api'),'utf8'),c);
  await assert.rejects(c.module.exports.call('payment',{id:'test'}),error=>error.code===code&&/商家微信支付尚未获得授权/.test(error.message));assert.equal(requests,1);
 }
});

test('订单资金提示以实际付款渠道为准，云端真实支付不显示模拟退款',()=>{
 for(const mode of ['cloud','api']){
  const c={Page(){},require:n=>n.includes('studio')?require('../cloudfunctions/shop/studio'):{mode}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/shop/index'),'utf8'),c);
  const base={id:'audit',status:'REFUNDING',lines:[],total:1,shippingFee:0,payment:{provider:'WECHAT'},refund:{stage:'WAIT_REFUND'}};
  c.sample=base;let result=vm.runInNewContext('order(sample)',c);
  assert.match(result.paymentNotice,/真实资金/);assert.match(result.refundNotice,/原路退回/);assert.equal(result.refund.stageText,'待微信退款');assert.equal(result.statusText,'待微信退款');
  base.refund.stage='REFUND_FAILED';result=vm.runInNewContext('order(sample)',c);assert.equal(result.refund.stageText,'微信退款待重试');
  base.payment={provider:'MOCK'};result=vm.runInNewContext('order(sample)',c);assert.match(result.paymentNotice,/模拟支付/);assert.match(result.refundNotice,/不涉及真实资金/);
  base.payment=null;base.refund=null;base.status='CANCELLED';result=vm.runInNewContext('order(sample)',c);assert.match(result.paymentNotice,/尚无已付款记录/);
  base.status='PENDING';result=vm.runInNewContext('order(sample)',c);assert.match(result.paymentNotice,mode==='cloud'?/实际扣款/:/模拟付款/);
 }
});
