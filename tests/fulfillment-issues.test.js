'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {seed,execute}=require('../cloudfunctions/shop/domain'),{authorize}=require('../server/auth'),{MongoStore}=require('../server/mongo-store');
const buyer={id:'issue-buyer'},merchant={id:'issue-owner',merchant:true},contact={name:'履约验收',phone:'13800000000',detail:'模拟地址测试街 1 号'};
function fixture(pickup=false){let state=seed(),time=1000,sequence=0;
 const call=(action,input={},actor=merchant)=>{const out=execute(state,actor,action,input,{now:time,mock:true});state=out.state;return out.result;};
 const address=call('saveAddress',contact,buyer),order=call('createOrder',{key:'issue-order-once',fulfillment:pickup?'PICKUP':'DELIVERY',contact,addressId:address.id,lines:[{productId:'food',skuId:'food-1',qty:3}]},buyer);call('mockPay',{id:order.id},buyer);
 const input=(extra={})=>({id:order.id,issueId:state.orders[0].fulfillment.issue?.id,issueRevision:state.orders[0].fulfillment.issue?.revision,requestKey:'issue-key-'+(++sequence),note:'已与买家联系确认',...extra});
 const record=type=>call('recordFulfillmentIssue',input({type}));
 return {call,input,record,order,get state(){return state;},setTime(t){time=t;}};
}
const items=(receivedQty=2,restockQty=1)=>[{productId:'food',skuId:'food-1',receivedQty,restockQty}];
test('缺货：进入待办、阻止误发货、约定改期与版本冲突，恢复后可正常送出',()=>{
 const f=fixture();f.record('OUT_OF_STOCK');const stale=f.input({resolution:'RESUME'});
 assert.throws(()=>f.call('ship',{id:f.order.id,note:'送货'}),/履约问题/);
 const scheduled=f.input({resolution:'RESCHEDULE',nextAt:10000});f.call('resolveFulfillmentIssue',scheduled);f.call('resolveFulfillmentIssue',scheduled);
 assert.equal(f.state.orders[0].fulfillment.issue.timeline.length,2);assert.throws(()=>f.call('resolveFulfillmentIssue',stale),/已更新/);
 f.call('resolveFulfillmentIssue',f.input({resolution:'RESUME'}));f.call('ship',{id:f.order.id,note:'已重新备齐并送出'});
 assert.equal(f.state.orders[0].status,'SHIPPED');assert.equal(f.state.products[0].skus[0].stock,17);
 assert.ok(f.call('tracking',{id:f.order.id},buyer).events.some(e=>e.nextAt===10000));
});
test('自提延期：过期不擅自取消已付款订单，处理后凭正确提货码核销',()=>{
 const f=fixture(true);assert.throws(()=>f.record('PICKUP_DELAY'),/已备好/);f.call('pickupReady',{id:f.order.id});f.record('PICKUP_DELAY');
 f.call('resolveFulfillmentIssue',f.input({resolution:'RESCHEDULE',nextAt:10000}));f.setTime(20000);f.call('expire');assert.equal(f.state.orders[0].status,'PAID');
 assert.throws(()=>f.call('pickupRedeem',{id:f.order.id,code:f.state.orders[0].fulfillment.code}),/履约问题/);
 f.call('resolveFulfillmentIssue',f.input({resolution:'RESUME'}));f.call('pickupRedeem',{id:f.order.id,code:f.state.orders[0].fulfillment.code});
 assert.equal(f.state.orders[0].status,'COMPLETED');assert.equal(f.state.products[0].skus[0].stock,17);
});
test('外送失败：再次送出保留旧单号；买家收货可结束待处理问题',()=>{
 const f=fixture();f.call('ship',{id:f.order.id,number:'SHIP001',note:'第一次送出'});f.record('DELIVERY_FAILED');f.setTime(2000);
 f.call('resolveFulfillmentIssue',f.input({resolution:'REDELIVER',number:'SHIP002'}));assert.equal(f.state.orders[0].fulfillment.deliveryHistory[0].number,'SHIP001');assert.equal(f.state.orders[0].shipping.number,'SHIP002');
 f.record('DELIVERY_FAILED');f.setTime(3000);f.call('confirmReceipt',{id:f.order.id},buyer);f.call('confirmReceipt',{id:f.order.id},buyer);
 const o=f.state.orders[0];assert.equal(o.status,'COMPLETED');assert.equal(o.updatedAt,3000);assert.equal(o.fulfillment.issue.resolution,'RECEIVED');assert.equal(o.fulfillment.issueHistory.length,1);
 const t=f.call('tracking',{id:o.id},buyer);assert.ok(t.events.some(e=>e.text.includes('SHIP001')));assert.ok(t.events.some(e=>e.text.includes('SHIP002')));
});
test('缺货退款：仅回补实际可售数，失败重试和重复确认不二次入库',()=>{
 const f=fixture();f.record('OUT_OF_STOCK');const request=f.input({confirm:true,items:items()});let o=f.call('merchantRefund',request);
 assert.equal(o.status,'REFUNDING');assert.equal(f.state.products[0].skus[0].stock,17);const args={id:o.id,caseId:o.refund.caseId};
 f.call('refundFail',{...args,reason:'模拟超时'});assert.equal(f.state.stockMovements.length,0);
 f.call('mockRefund',args);f.call('mockRefund',args);f.call('merchantRefund',request);
 o=f.state.orders[0];assert.equal(o.status,'REFUNDED');assert.equal(o.fulfillment.issue.status,'RESOLVED');assert.equal(f.state.products[0].skus[0].stock,18);
 assert.equal(f.state.stockMovements.length,1);const row=f.state.stockMovements[0];assert.deepEqual([row.delta,row.quarantineQty,row.missingQty],[1,1,1]);assert.equal(row.type,'FULFILLMENT_RETURN');
 assert.equal(f.call('stockHistory',{type:'FULFILLMENT_RETURN'}).total,1);
});
test('外送丢失退款：未取回商品不回补；已有买家售后也必须核对缺货数量',()=>{
 const f=fixture();f.call('ship',{id:f.order.id,note:'送出'});f.record('DELIVERY_FAILED');const o=f.call('merchantRefund',f.input({confirm:true,items:items(0,0)}));f.call('mockRefund',{id:o.id,caseId:o.refund.caseId});assert.equal(f.state.products[0].skus[0].stock,17);
 const g=fixture();g.record('OUT_OF_STOCK');const r=g.call('refundRequest',{id:g.order.id,type:'REFUND_ONLY',reason:'缺货退款'},buyer),review={id:r.id,caseId:r.refund.caseId,approve:true,note:'核对缺货和损坏商品'};
 assert.throws(()=>g.call('refundReview',review),/确认/);g.call('refundReview',{...review,confirm:true,items:items(1,1)});
 assert.throws(()=>g.call('refundReview',{...review,confirm:true,items:items(3,3)}),/不能覆盖/);
 g.call('mockRefund',{id:r.id,caseId:r.refund.caseId});assert.equal(g.state.products[0].skus[0].stock,18);assert.equal(g.state.orders[0].fulfillment.issue.status,'RESOLVED');
});
test('履约处理：权限、旧问题、重复键改参数、越界数量及无效约定时间都被拒绝',()=>{
 const f=fixture();for(const action of ['recordFulfillmentIssue','resolveFulfillmentIssue','merchantRefund']){assert.throws(()=>authorize(buyer,action),/FORBIDDEN/);assert.throws(()=>f.call(action,{},buyer),/FORBIDDEN/);}
 const req=f.input({type:'OUT_OF_STOCK'});f.call('recordFulfillmentIssue',req);f.call('recordFulfillmentIssue',req);assert.throws(()=>f.call('recordFulfillmentIssue',{...req,note:'改动'}),/原请求/);
 const before=structuredClone(f.state);for(const nextAt of [1000,0,1000+31*86400000,NaN,'123'])assert.throws(()=>f.call('resolveFulfillmentIssue',f.input({resolution:'RESCHEDULE',nextAt})),/约定时间/);
 for(const plan of [[],items(-1,0),items(4,1),items(1,2),items(1.5,1),[...items(),...items()]])assert.throws(()=>f.call('merchantRefund',f.input({confirm:true,items:plan})));
 assert.throws(()=>f.call('merchantRefund',f.input({confirm:false,items:items()})),/确认/);assert.throws(()=>f.call('merchantRefund',f.input({issueId:'old',confirm:true,items:items()})),/已变化/);assert.deepEqual(f.state,before);
});
test('履约退款：库存容量冲突时整笔回滚，修正后可重试',()=>{
 const f=fixture();f.call('ship',{id:f.order.id,note:'已送出'});f.record('DELIVERY_FAILED');const o=f.call('merchantRefund',f.input({confirm:true,items:items(3,3)}));
 f.state.products[0].skus[0].stock=100000;const before=structuredClone(f.state),args={id:o.id,caseId:o.refund.caseId};
 assert.throws(()=>f.call('mockRefund',args),/库存超过上限/);assert.deepEqual(f.state,before);
 f.state.products[0].skus[0].stock=99997;f.call('mockRefund',args);assert.equal(f.state.products[0].skus[0].stock,100000);assert.equal(f.state.orders[0].status,'REFUNDED');assert.equal(f.state.stockMovements.length,1);
});

async function mongo(fn){const name='pet_shop_test_issue_'+Date.now()+'_'+Math.random().toString(36).slice(2),a=await MongoStore.connect({database:name}),b=await MongoStore.connect({database:name});try{const o=await a.execute(buyer,'createOrder',{key:'mongo-issue-order',fulfillment:'PICKUP',contact,lines:[{productId:'food',skuId:'food-1',qty:3}]});await a.execute(buyer,'mockPay',{id:o.id});const issueOrder=await a.execute(merchant,'recordFulfillmentIssue',{id:o.id,type:'OUT_OF_STOCK',note:'盘点缺货',requestKey:'mongo-report-once'});await fn(a,b,issueOrder);}finally{assert.ok(name.startsWith('pet_shop_test_issue_'));await a.db.dropDatabase();await a.close();await b.close();}}
test('真实 MongoDB：并发发起退款及完成退款只产生一个售后和一笔库存流水',{skip:process.env.PET_MONGO_TEST!=='1'},async()=>mongo(async(a,b,o)=>{
 const input={id:o.id,issueId:o.fulfillment.issue.id,issueRevision:o.fulfillment.issue.revision,requestKey:'mongo-refund-once',note:'缺货无法履约',confirm:true,items:items()};
 const result=await Promise.all([a.execute(merchant,'merchantRefund',input),b.execute(merchant,'merchantRefund',input)]);assert.equal(result[0].refund.caseId,result[1].refund.caseId);
 const args={id:o.id,caseId:result[0].refund.caseId};await Promise.all([a.execute(merchant,'mockRefund',args),b.execute(merchant,'mockRefund',args)]);
 const state=await a.snapshot();assert.equal(state.stockMovements.length,1);assert.equal(state.products[0].skus[0].stock,18);assert.equal(state.orders[0].refundHistory.length,0);
}));
test('真实 MongoDB：同一问题并发改期和退款，旧版本只能有一个成功',{skip:process.env.PET_MONGO_TEST!=='1'},async()=>mongo(async(a,b,o)=>{
 const common={id:o.id,issueId:o.fulfillment.issue.id,issueRevision:o.fulfillment.issue.revision,note:'沟通处理结果'};
 const results=await Promise.allSettled([a.execute(merchant,'resolveFulfillmentIssue',{...common,requestKey:'race-reschedule',resolution:'RESCHEDULE',nextAt:Date.now()+3600000}),b.execute(merchant,'merchantRefund',{...common,requestKey:'race-refund-once',confirm:true,items:items()})]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.match(results.find(x=>x.status==='rejected').reason.message,/已更新|状态已变化/);assert.equal((await a.snapshot()).products[0].skus[0].stock,17);
}));
