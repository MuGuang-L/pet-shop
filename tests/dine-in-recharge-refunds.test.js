'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const domain=require('../cloudfunctions/shop/domain');
const studio=require('../cloudfunctions/shop/studio');
const display=require('../miniprogram/services/order-display');
const buyer={id:'buyer'},merchant={id:'merchant',merchant:true},now=Date.UTC(2026,10,7,4);
const contact={name:'顾客',phone:'13800000000'};
function fixture(){let state=domain.seed();return {get state(){return state;},run(actor,action,input={}){const out=domain.execute(state,actor,action,input,{now,mock:true});state=out.state;return out.result;},paid(o){const out=domain.settleVerifiedPayment(state,{orderId:o.id,eventId:'pay-'+o.id,transactionId:'tx-'+o.id,amount:o.total,currency:'CNY'},now+1);state=out.state;return out.result;},refund(o){const out=domain.settleVerifiedRefund(state,{orderId:o.id,eventId:'refund-'+o.id,refundId:'r-'+o.id,amount:o.total,currency:'CNY'},now+2);state=out.state;return out.result;},enable(){const s=this.run(merchant,'shopSettings');s.store.phone=contact.phone;s.membership.enabled=true;s.membership.tiers=[{pay:10000,credit:12000}];return this.run(merchant,'saveShopSettings',s);}};}
function create(f,type,key=type){return f.run(buyer,'createOrder',{key:'order-'+key,fulfillment:type,contact,lines:[{productId:'toy',skuId:'toy-1',qty:1}]});}

test('自定义充值按分校验且无档位赠送；金额与方式均参与幂等，重试保持到账快照',()=>{
 const f=fixture();f.enable();
 for(const amount of [0,-100,1.2,500001,'10000',NaN,Infinity])assert.throws(()=>f.run(buyer,'createRecharge',{key:'invalid-topup',amount,custom:true}),/大于 0 元且不超过 5000 元/);
 for(const amount of [1,99,500000]){const o=f.run(buyer,'createRecharge',{key:'custom-boundary-'+amount,amount,custom:true});assert.equal(o.total,amount);assert.equal(o.walletCredit,amount);}
 const custom=f.run(buyer,'createRecharge',{key:'custom-recharge',amount:10000,custom:true});assert.equal(custom.walletCredit,10000);
 assert.equal(f.run(buyer,'createRecharge',{key:'custom-recharge',amount:10000,custom:true}).id,custom.id);
 assert.throws(()=>f.run(buyer,'createRecharge',{key:'custom-recharge',amount:10000}),/其他金额或方式/);
 const arbitrary=f.run(buyer,'createRecharge',{key:'arbitrary-topup',amount:12345,custom:true});assert.equal(arbitrary.total,12345);assert.equal(arbitrary.walletCredit,12345);
 const tier=f.run(buyer,'createRecharge',{key:'fixed-recharge',amount:10000});assert.equal(tier.walletCredit,12000);
 const s=f.run(merchant,'shopSettings');s.membership.tiers=[{pay:10000,credit:15000}];f.run(merchant,'saveShopSettings',s);
 assert.equal(f.run(buyer,'createRecharge',{key:'fixed-recharge',amount:10000}).walletCredit,12000);
 f.paid(arbitrary);f.paid(arbitrary);assert.equal(f.run(buyer,'membership').balance,12345);
 const r=f.run(buyer,'refundRequest',{id:arbitrary.id,type:'REFUND_ONLY',reason:'退回充值'});
 f.run(merchant,'refundReview',{id:r.id,caseId:r.refund.caseId,approve:true,note:'核对充值退款'});assert.equal(f.run(buyer,'membership').balance,0);
 f.refund(r);f.refund(r);assert.equal(f.run(buyer,'membership').balance,0);assert.equal(f.run(buyer,'order',{id:r.id}).status,'REFUNDED');
});

test('堂食无运费无预约，商家可备餐和确认交付，列表不混入快递或自提',()=>{
 const f=fixture(),dine=create(f,'DINE_IN');assert.equal(dine.shippingFee,0);assert.equal(dine.fulfillment.pickupAt,null);assert.ok(dine.fulfillment.store.name);
 assert.equal(create(f,'DINE_IN').id,dine.id);
 assert.throws(()=>f.run(buyer,'createOrder',{key:'order-DINE_IN',fulfillment:'PICKUP',contact,lines:dine.lines}),/IDEMPOTENCY_CONFLICT/);
 assert.throws(()=>f.run(buyer,'quoteOrder',{fulfillment:'DINE_IN',pickupAt:now+1000,lines:dine.lines}),/立即取单/);
 f.paid(dine);assert.equal(studio.fulfillmentName(dine),'堂食');assert.equal(display.card(dine).fulfillmentText,'堂食');
 assert.throws(()=>f.run(merchant,'ship',{id:dine.id,carrier:'shunfeng',number:'SHIP123456'}),/确认已提货/);
 f.run(merchant,'pickupReady',{id:dine.id});const done=f.run(merchant,'pickupComplete',{id:dine.id,confirm:true});assert.equal(done.status,'COMPLETED');
 assert.equal(studio.fulfillmentLabel(done),'堂食已完成');assert.equal(display.timeline(done)[0].title,'堂食已完成');
 assert.equal(f.run(buyer,'ordersPage',{fulfillment:'DINE_IN'}).total,1);assert.equal(f.run(buyer,'ordersPage',{fulfillment:'DELIVERY'}).total,0);assert.equal(f.run(buyer,'ordersPage',{fulfillment:'PICKUP'}).total,0);
});

test('咖啡支持堂食与自提，立即自提不自动预约未来时间；暂停到店服务同时拦截堂食',()=>{
 const f=fixture(),p=f.run(merchant,'saveProduct',{name:'拿铁',category:'咖啡',active:true,skus:[{id:'cup',name:'一杯',price:2000,stock:5}]});
 const lines=[{productId:p.id,skuId:'cup',qty:1}];
 for(const fulfillment of ['DINE_IN','PICKUP'])assert.equal(f.run(buyer,'quoteOrder',{fulfillment,lines}).pickupAt,null);
 assert.throws(()=>f.run(buyer,'quoteOrder',{fulfillment:'DELIVERY',lines}),/仅支持到店自提或堂食/);
 const s=f.run(merchant,'shopSettings');s.store.phone=contact.phone;s.pickup.enabled=false;f.run(merchant,'saveShopSettings',s);
 assert.throws(()=>f.run(buyer,'quoteOrder',{fulfillment:'DINE_IN',lines}),/暂未开放堂食/);
});

for(const type of ['DINE_IN','PICKUP','DELIVERY'])test(type+' 微信订单可申请退款，商家审核后才退款，重复回调不重复入库',()=>{
 const f=fixture();let o;
 if(type==='DELIVERY'){const a=f.run(buyer,'saveAddress',{...contact,detail:'测试街道 1 号'});o=f.run(buyer,'createOrder',{key:'delivery-refund',fulfillment:type,addressId:a.id,lines:[{productId:'toy',skuId:'toy-1',qty:1}]});}else o=create(f,type);
 f.paid(o);const r=f.run(buyer,'refundRequest',{id:o.id,type:'REFUND_ONLY',reason:'取消订单'});
 assert.throws(()=>f.run(buyer,'refundReview',{id:r.id,caseId:r.refund.caseId,approve:true,note:'越权退款'}),/FORBIDDEN/);
 f.run(merchant,'refundReview',{id:r.id,caseId:r.refund.caseId,approve:true,note:'已核对商品',items:[{productId:'toy',skuId:'toy-1',receivedQty:1,restockQty:0}],confirm:true});
 assert.equal(f.run(buyer,'order',{id:o.id}).status,'REFUNDING');assert.equal(f.state.products[1].skus[0].stock,29);
 f.refund(r);f.refund(r);assert.equal(f.state.products[1].skus[0].stock,29);assert.equal(f.state.stockMovements.length,1);assert.equal(f.run(buyer,'order',{id:o.id}).status,'REFUNDED');
});

test('堂食已交付仍可仅退款，余额退款一次入账且不自动回补已交付商品',()=>{
 const f=fixture();f.enable();const topup=f.run(buyer,'createRecharge',{key:'wallet-for-dine',amount:10000,custom:true});f.paid(topup);
 const dine=create(f,'DINE_IN');f.run(buyer,'balancePay',{id:dine.id});f.run(merchant,'pickupComplete',{id:dine.id,confirm:true});
 const r=f.run(buyer,'refundRequest',{id:dine.id,type:'REFUND_ONLY',reason:'餐品问题'});f.run(merchant,'refundReview',{id:r.id,caseId:r.refund.caseId,approve:true,note:'已与顾客确认',waiveReturn:true});
 const args={id:r.id,caseId:r.refund.caseId};f.run(merchant,'mockRefund',args);f.run(merchant,'mockRefund',args);
 assert.equal(f.run(buyer,'membership').balance,10000);assert.equal(f.state.products[1].skus[0].stock,29);
});
