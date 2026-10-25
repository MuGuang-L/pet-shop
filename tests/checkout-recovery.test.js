const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){const storage={},wx={getStorageSync:k=>structuredClone(storage[k]),setStorageSync:(k,v)=>{storage[k]=structuredClone(v);}};const context={wx,module:{exports:{}}};vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/checkout'),'utf8'),context);return {storage,wx,checkout:context.module.exports};}
const line={productId:'toy',skuId:'toy-1',qty:1},input={key:'persistent-checkout',lines:[line]};
test('账号隔离、未知响应保留请求，确定业务失败才允许重新提交',async()=>{
 const f=fixture();f.checkout.write('buyer-a',{input});assert.equal(f.checkout.read('buyer-b'),null);
 await assert.rejects(f.checkout.submit('buyer-a',async()=>{throw Error('unknown response');},[line]));assert.ok(f.checkout.read('buyer-a'));
 await assert.rejects(f.checkout.submit('buyer-a',async()=>{throw Object.assign(Error('OUT_OF_STOCK'),{definitive:true});},[line]));assert.equal(f.checkout.read('buyer-a'),null);
});
test('购物车写入后清理待确认记录失败，重试不再扣购物车也不再发请求',async()=>{
 const f=fixture();f.checkout.write('scope',{input});let calls=0;
 const call=async()=>{calls++;return {id:'order-1'};},write=f.wx.setStorageSync;
 f.wx.setStorageSync=(key,value)=>{if(key==='scope'&&value===null)throw Error('storage failure');write(key,value);};
 await assert.rejects(f.checkout.submit('scope',call,[{...line,qty:3}]),/storage failure/);
 assert.equal(f.storage['pet-cart'][0].qty,2);assert.ok(f.storage.scope.completed);
 f.wx.setStorageSync=write;const result=await f.checkout.submit('scope',call,f.storage['pet-cart']);
 assert.equal(result.cart[0].qty,2);assert.equal(calls,1);assert.equal(f.storage.scope,null);
});
test('完成记录写入失败，重试保留原幂等键，新增购物车商品不丢失',async()=>{
 const f=fixture();f.checkout.write('scope',{input});const write=f.wx.setStorageSync,keys=[];
 const call=async(_,data)=>{keys.push(data.key);return {id:'order-1'};};
 f.wx.setStorageSync=(key,value)=>{if(value?.completed)throw Error('disk full');write(key,value);};
 await assert.rejects(f.checkout.submit('scope',call,[line]),/disk full/);f.wx.setStorageSync=write;
 const result=await f.checkout.submit('scope',call,[line,{productId:'care',skuId:'care-1',qty:2}]);
 assert.deepEqual(keys,[input.key,input.key]);assert.equal(result.cart.length,1);assert.equal(result.cart[0].productId,'care');
});
