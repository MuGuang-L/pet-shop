'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const domain=require('../cloudfunctions/shop/domain');
const buyer={id:'drink-buyer'},merchant={id:'owner',merchant:true},contact={name:'顾客',phone:'13800000000'},now=Date.UTC(2026,10,8,4);
const groups=[{id:'temperature',name:'温度',options:[{id:'hot',name:'热',extraPrice:0},{id:'ice',name:'全冰',extraPrice:100}]},{id:'milk',name:'奶',options:[{id:'regular',name:'牛奶',extraPrice:0},{id:'oat',name:'燕麦奶',extraPrice:300}]}];
const choices=(milk='regular',temperature='hot')=>[{groupId:'temperature',optionId:temperature},{groupId:'milk',optionId:milk}];
function fixture(){let state=domain.seed();const f={get state(){return state;},run(actor,action,input={}){const out=domain.execute(state,actor,action,input,{now,mock:true});state=out.state;return out.result;},paid(o){const out=domain.settleVerifiedPayment(state,{orderId:o.id,eventId:'pay-'+o.id,transactionId:'tx-'+o.id,amount:o.total,currency:'CNY'},now+1);state=out.state;return out.result;},refund(o){const out=domain.settleVerifiedRefund(state,{orderId:o.id,eventId:'refund-'+o.id,refundId:'r-'+o.id,amount:o.total,currency:'CNY'},now+2);state=out.state;return out.result;}};f.product=f.run(merchant,'saveProduct',{name:'拿铁',category:'咖啡',active:true,skus:[{id:'cup',name:'大杯',price:2000,memberPrice:1500}],optionGroups:structuredClone(groups)});f.line=(selections=choices(),qty=1)=>({productId:f.product.id,skuId:'cup',qty,selections});f.input=(lines=[f.line()],key='drink-options-order')=>({key,fulfillment:'DINE_IN',contact,lines});return f;}

test('选项加价由服务端计算，会员只切换基础售价，客户端不能伪造价格或名称',()=>{
 const f=fixture(),line={...f.line(choices('oat','ice'),2),price:1,optionsExtra:0,options:[{extraPrice:0}],optionsText:'免费'};
 let q=f.run(buyer,'quoteOrder',f.input([line]));assert.equal(q.total,4800);assert.equal(q.lines[0].price,2400);assert.equal(q.lines[0].optionsExtra,400);
 f.state.wallets={[buyer.id]:{balance:1,entries:[]}};q=f.run(buyer,'quoteOrder',f.input([line]));assert.equal(q.isMember,true);assert.equal(q.total,3800);assert.equal(q.regularSubtotal,4800);
 const o=f.run(buyer,'createOrder',f.input([line]));assert.equal(o.total,3800);assert.equal(o.lines[0].basePrice,1500);assert.equal(o.lines[0].optionsText,'温度：全冰 / 奶：燕麦奶');assert.equal(o.lines[0].options[1].extraPrice,300);
});

test('同款不同搭配可同时下单；完全相同搭配不重复，幂等重试不受选项顺序或后续编辑影响',()=>{
 const f=fixture(),input=f.input([f.line(),f.line(choices('oat'),2)]),o=f.run(buyer,'createOrder',input);assert.equal(o.lines.length,2);assert.notEqual(o.lines[0].lineKey,o.lines[1].lineKey);assert.equal(o.total,6600);
 assert.equal(f.run(buyer,'createOrder',{...input,lines:input.lines.map(l=>({...l,selections:l.selections.slice().reverse()}))}).id,o.id);
 assert.throws(()=>f.run(buyer,'createOrder',{...input,lines:[f.line(choices('oat')),f.line(choices())]}),/IDEMPOTENCY_CONFLICT/);
 assert.throws(()=>f.run(buyer,'quoteOrder',f.input([f.line(),f.line(choices().reverse())])),/DUPLICATE_SKU/);
 const p=f.state.products.find(p=>p.id===f.product.id),next=structuredClone(p);next.optionGroups[1].options[1].name='新燕麦奶';next.optionGroups[1].options[1].extraPrice=500;f.run(merchant,'saveProduct',next);
 assert.equal(f.run(buyer,'createOrder',input).total,6600);const old=f.run(buyer,'order',{id:o.id});assert.match(old.lines[1].optionsText,/奶：燕麦奶/);assert.equal(old.lines[1].price,2300);
 assert.equal(f.run(buyer,'quoteOrder',f.input([f.line(choices('oat'))])).total,2500);
});

test('缺选、失效或重复选项拒绝下单；客户端自带分组或新价格不能绕过校验',()=>{
 const f=fixture();for(const selections of [[],[{groupId:'milk',optionId:'oat'}],choices('missing'),[...choices(),choices()[0]],[{groupId:'fake',optionId:'hot'},choices()[1]]]){
  const before=structuredClone(f.state);assert.throws(()=>f.run(buyer,'createOrder',f.input([f.line(selections)])),/选项|重新选择/);assert.deepEqual(f.state,before);
 }
 const input=f.input([f.line(choices('oat'))]),quote=f.run(buyer,'quoteOrder',input);const p=structuredClone(f.state.products.find(p=>p.id===f.product.id));p.optionGroups[1].options[1].extraPrice=500;f.run(merchant,'saveProduct',p);
 assert.throws(()=>f.run(buyer,'createOrder',{...input,expectedTotal:quote.total}),/金额已变化/);
});

test('同款不同搭配的整单退款包含加价，简化审核和回调不会重复退款或创建饮品库存',()=>{
 const f=fixture(),o=f.run(buyer,'createOrder',f.input([f.line(),f.line(choices('oat'))]));f.paid(o);const r=f.run(buyer,'refundRequest',{id:o.id,type:'REFUND_ONLY',reason:'取消订单'}),args={id:o.id,caseId:r.refund.caseId};
 f.run(merchant,'refundReview',{...args,simple:true,approve:true});f.run(merchant,'refundReview',{...args,simple:true,approve:true});f.refund(o);f.refund(o);
 const done=f.run(buyer,'order',{id:o.id});assert.equal(done.status,'REFUNDED');assert.equal(done.refund.amount,4300);assert.equal(done.refund.stockDisposition.length,2);assert.equal(f.state.stockMovements.length,0);assert.equal(f.state.products.at(-1).skus[0].stock,0);
});

test('不同搭配的退货验收按订单明细匹配，支持简化收齐后退款',()=>{
 const f=fixture(),o=f.run(buyer,'createOrder',f.input([f.line(),f.line(choices('oat'))]));f.paid(o);f.run(merchant,'pickupComplete',{id:o.id,confirm:true});const r=f.run(buyer,'refundRequest',{id:o.id,type:'RETURN_REFUND',reason:'退回未饮用饮品'}),args={id:o.id,caseId:r.refund.caseId};
 f.run(merchant,'refundReview',{...args,approve:true,note:'已协商退回',returnAddress:{...contact,detail:'测试街道门店 1 号'}});f.run(buyer,'returnShip',{...args,company:'顺丰',number:'SF12345678'});f.run(merchant,'returnInspect',{...args,simple:true});f.refund(o);
 assert.equal(f.run(buyer,'order',{id:o.id}).status,'REFUNDED');assert.equal(f.state.stockMovements.length,0);
});

test('商家自定义分组保存前校验名称、编号、选项数量和加价',()=>{
 const f=fixture(),p=structuredClone(f.product);for(const optionGroups of [[...groups,groups[0]],[{...groups[0],options:[]}],[{...groups[0],options:[{id:'a',name:'坏价格',extraPrice:-1}]}],[{...groups[0],options:[{id:'a',name:'坏价格',extraPrice:1.2}]}]])assert.throws(()=>f.run(merchant,'saveProduct',{...p,optionGroups}),/选项|加价/);
 assert.throws(()=>f.run(merchant,'saveProduct',{...p,category:'用品'}),/仅适用于咖啡和饮品/);
});
