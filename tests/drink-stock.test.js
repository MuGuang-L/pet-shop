'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const domain=require('../cloudfunctions/shop/domain'),studio=require('../cloudfunctions/shop/studio');
const buyer={id:'drink-buyer'},merchant={id:'owner',merchant:true},contact={name:'测试顾客',phone:'13800000000'},now=Date.UTC(2026,10,8,3);
function fixture(){let state=domain.seed();return {get state(){return state;},run(actor,action,input={},at=now){const out=domain.execute(state,actor,action,input,{mock:true,now:at});state=out.state;return out.result;},product(category='咖啡'){return this.run(merchant,'saveProduct',{name:'现做饮品',category,active:true,skus:[{id:'cup',name:'大杯',price:2000}]});},order(p,extra=[]){return this.run(buyer,'createOrder',{key:'drink-order-'+state.orders.length,fulfillment:'DINE_IN',contact,lines:[{productId:p.id,skuId:'cup',qty:2},...extra]});},paid(o){const out=domain.settleVerifiedPayment(state,{orderId:o.id,eventId:'pay-'+o.id,transactionId:'tx-'+o.id,amount:o.total,currency:'CNY'},now+1);state=out.state;return out.result;}};}

for(const category of ['咖啡','饮品'])test(category+' 不填写库存即可上架；报价、下单、取消与超时均不增减库存',()=>{
 const f=fixture(),p=f.product(category);assert.equal(p.skus[0].stock,0);assert.equal(studio.tracksStock(p),false);
 assert.ok(studio.homeProducts([p]).latest.some(x=>x.id===p.id));
 const quote=f.run(buyer,'quoteOrder',{fulfillment:'DINE_IN',lines:[{productId:p.id,skuId:'cup',qty:99}]});assert.equal(quote.total,198000);
 const o=f.order(p);assert.equal(o.lines[0].stockTracked,false);assert.equal(f.state.products.at(-1).skus[0].stock,0);
 f.run(buyer,'cancel',{id:o.id});f.run(buyer,'cancel',{id:o.id});assert.equal(f.state.products.at(-1).skus[0].stock,0);
 const expired=f.order(p);f.run(buyer,'order',{id:expired.id},now+16*60000);assert.equal(f.state.orders.at(-1).status,'EXPIRED');assert.equal(f.state.products.at(-1).skus[0].stock,0);
 assert.equal(f.state.stockMovements.length,0);
 assert.throws(()=>f.run(merchant,'adjustStock',{productId:p.id,skuId:'cup',revision:p.revision,type:'RECEIVE',quantity:1,reason:'测试',requestKey:'drink-inventory'}),/不需要管理库存/);
});

test('咖啡与实体商品混合订单只占用、释放实体商品；客户端不能伪造不管理库存',()=>{
 const f=fixture(),p=f.product(),o=f.order(p,[{productId:'toy',skuId:'toy-1',qty:3,stockTracked:false}]);
 assert.equal(o.lines[0].stockTracked,false);assert.notEqual(o.lines[1].stockTracked,false);assert.equal(f.state.products[1].skus[0].stock,27);
 f.run(buyer,'cancel',{id:o.id});assert.equal(f.state.products[1].skus[0].stock,30);assert.equal(f.state.products.at(-1).skus[0].stock,0);
 assert.throws(()=>f.order(p,[{productId:'toy',skuId:'toy-1',qty:31,stockTracked:false}]),/OUT_OF_STOCK/);
});

test('现做饮品的退款不生成库存流水、不回补数量；旧订单仍释放当时占用的库存',()=>{
 const f=fixture(),p=f.product(),o=f.order(p);f.paid(o);
 const r=f.run(buyer,'refundRequest',{id:o.id,type:'REFUND_ONLY',reason:'取消现做饮品'});
 const args={id:o.id,caseId:r.refund.caseId};
 assert.throws(()=>f.run(merchant,'refundReview',{...args,approve:true,note:'核对退款',confirm:true,items:[{productId:p.id,skuId:'cup',receivedQty:2,restockQty:2}]}),/无需回补库存/);
 f.run(merchant,'refundReview',{...args,simple:true,approve:true});f.run(merchant,'mockRefund',args);f.run(merchant,'mockRefund',args);
 assert.equal(f.state.orders[0].status,'REFUNDED');assert.equal(f.state.products.at(-1).skus[0].stock,0);assert.equal(f.state.stockMovements.length,0);
 const legacy=f.order(p);delete f.state.orders.at(-1).lines[0].stockTracked;f.state.products.at(-1).skus[0].stock=8;
 f.run(buyer,'cancel',{id:legacy.id});assert.equal(f.state.products.at(-1).skus[0].stock,10);
});

test('下单时固定库存规则，改分类后取消不凭空增加库存；烘焙仍校验库存',()=>{
 const f=fixture(),p=f.product(),o=f.order(p);const saved=f.run(merchant,'saveProduct',{...f.state.products.at(-1),category:'用品',skus:[{...p.skus[0],stock:100000}]});
 assert.equal(saved.skus[0].stock,100000);f.run(buyer,'cancel',{id:o.id});assert.equal(f.state.products.at(-1).skus[0].stock,100000);
 const bread=f.run(merchant,'saveProduct',{name:'可颂',category:'烘焙',active:true,skus:[{id:'cup',name:'一个',price:1000,stock:0}]});
 assert.equal(studio.tracksStock(bread),true);assert.throws(()=>f.order(bread),/OUT_OF_STOCK/);
});
