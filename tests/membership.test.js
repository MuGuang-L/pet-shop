const test=require('node:test'),assert=require('node:assert/strict');
const domain=require('../cloudfunctions/shop/domain'),settings=require('../cloudfunctions/shop/shop-settings');
const buyer={id:'member-a'},other={id:'member-b'},merchant={id:'merchant',merchant:true};
const now=Date.UTC(2026,10,2,4,0),contact={name:'会员',phone:'13800000000'};
function fixture(){let state=domain.seed();const run=(actor,action,input={},at=now)=>{const out=domain.execute(state,actor,action,input,{mock:false,now:at});state=out.state;return out.result;};return {run,get state(){return state;},set state(value){state=value;},enable(){const config=run(merchant,'shopSettings');config.membership.enabled=true;config.store.phone='13800000000';run(merchant,'saveShopSettings',config);},paid(id,amount=10000,tx='tx-'+id,at=now+1){const out=domain.settleVerifiedPayment(state,{orderId:id,eventId:'event-'+tx,transactionId:tx,amount,currency:'CNY'},at);state=out.state;return out.result;}};}
function recharge(f,key='recharge-001'){return f.run(buyer,'createRecharge',{key,amount:10000});}
function goods(f,key='purchase-001'){return f.run(buyer,'createOrder',{key,fulfillment:'PICKUP',contact,lines:[{productId:'toy',skuId:'toy-1',qty:1}]});}

test('真实充值校验金额与事件，重复通知和重试只入账一次，余额按账号隔离',()=>{
 const f=fixture();assert.throws(()=>recharge(f),/暂未开放/);f.enable();
 assert.throws(()=>f.run(buyer,'createRecharge',{key:'invalid-amount',amount:1}),/有效充值档位/);
 const o=recharge(f);assert.equal(recharge(f).id,o.id);assert.equal(f.run(buyer,'membership').balance,0);
 assert.throws(()=>domain.execute(f.state,buyer,'mockPay',{id:o.id},{mock:true,now}),/充值必须使用微信真实付款/);
 assert.throws(()=>f.paid(o.id,9999),/PAYMENT_AMOUNT_MISMATCH/);assert.equal(f.run(buyer,'membership').balance,0);
 assert.equal(f.paid(o.id).status,'COMPLETED');f.paid(o.id);f.paid(o.id,10000,'tx-'+o.id);
 assert.equal(f.run(buyer,'membership').balance,10000);assert.equal(f.run(buyer,'membership').entries.length,1);assert.equal(f.run(other,'membership').balance,0);
 assert.throws(()=>f.run(buyer,'merchantMembers'),/FORBIDDEN/);const unnamed=f.run(merchant,'merchantMembers');assert.equal(unnamed.length,1);assert.equal(unnamed[0].phone,'未绑定手机号');assert.equal(unnamed[0].id,undefined);f.run(buyer,'bindPhone',{phone:'13800138000'});assert.equal(f.run(buyer,'identity').phone,'13800138000');assert.equal(f.run(merchant,'merchantMembers')[0].phone,'13800138000');assert.throws(()=>f.run(buyer,'bindPhone',{phone:'123'}),/11 位手机号/);assert.throws(()=>f.run(merchant,'bindPhone',{phone:'13800138000'}),/不能绑定/);
});

test('余额付款原子扣减，重复请求不再扣款；余额不足和越权请求保持原数据',()=>{
 const f=fixture();f.enable();f.paid(recharge(f).id);const o=goods(f);
 assert.equal(f.run(buyer,'balancePay',{id:o.id}).status,'PAID');assert.equal(f.run(buyer,'membership').balance,8100);
 f.run(buyer,'balancePay',{id:o.id});assert.equal(f.run(buyer,'membership').balance,8100);
 assert.throws(()=>f.run(other,'balancePay',{id:o.id}),/FORBIDDEN/);
 const expensive=f.run(buyer,'createOrder',{key:'too-expensive',fulfillment:'PICKUP',contact,lines:[{productId:'food',skuId:'food-2',qty:2}]});
 const before=structuredClone(f.state);assert.throws(()=>f.run(buyer,'balancePay',{id:expensive.id}),/余额不足/);assert.deepEqual(f.state,before);
 const pending=recharge(f,'second-recharge');assert.throws(()=>f.run(buyer,'balancePay',{id:pending.id}),/不能使用余额/);
});

test('余额支付订单经商家审核后退款原路回余额，重复退款不重复入账或释放库存',()=>{
 const f=fixture();f.enable();f.paid(recharge(f).id);const o=goods(f);f.run(buyer,'balancePay',{id:o.id});
 const r=f.run(buyer,'refundRequest',{id:o.id,type:'REFUND_ONLY',reason:'取消取餐'});
 f.run(merchant,'refundReview',{id:o.id,caseId:r.refund.caseId,approve:true,note:'同意退款'});
 const refunded=f.run(merchant,'mockRefund',{id:o.id,caseId:r.refund.caseId});assert.equal(refunded.refund.provider,'BALANCE');
 assert.equal(f.run(buyer,'membership').balance,10000);assert.equal(f.state.products.find(p=>p.id==='toy').skus[0].stock,30);
 f.run(merchant,'mockRefund',{id:o.id,caseId:r.refund.caseId});assert.equal(f.run(buyer,'membership').balance,10000);
});

test('充值退款先冻结可用余额，余额不足时审核失败不写入；微信退款回调不再次扣款',()=>{
 const f=fixture();f.enable();const o=recharge(f);f.paid(o.id);const purchase=goods(f);f.run(buyer,'balancePay',{id:purchase.id});
 const r=f.run(buyer,'refundRequest',{id:o.id,type:'RETURN_REFUND',reason:'退回充值'});assert.equal(r.refund.type,'REFUND_ONLY');
 const review={id:o.id,caseId:r.refund.caseId,approve:true,note:'核对可用余额后退回'};
 const before=structuredClone(f.state);assert.throws(()=>f.run(merchant,'refundReview',review),/余额不足/);assert.deepEqual(f.state,before);
 f.paid(recharge(f,'another-recharge').id);f.run(merchant,'refundReview',review);assert.equal(f.run(buyer,'membership').balance,8100);
 f.run(merchant,'refundReview',review);assert.equal(f.run(buyer,'membership').balance,8100);
 const payload={orderId:o.id,eventId:'refund-event',refundId:'refund-1',amount:10000,currency:'CNY'};
 f.state=domain.settleVerifiedRefund(f.state,payload,now+2).state;f.state=domain.settleVerifiedRefund(f.state,payload,now+3).state;
 assert.equal(f.run(buyer,'membership').balance,8100);assert.equal(f.run(buyer,'order',{id:o.id}).status,'REFUNDED');
});

test('关闭后充值到账不计入余额，进入原渠道退款；重启后的账本保持余额',()=>{
 const f=fixture();f.enable();const o=recharge(f);f.run(buyer,'cancel',{id:o.id});
 assert.equal(f.paid(o.id).status,'REFUNDING');assert.equal(f.run(buyer,'membership').balance,0);
 const o2=recharge(f,'restart-recharge');f.paid(o2.id);f.state=JSON.parse(JSON.stringify(f.state));assert.equal(f.run(buyer,'membership').balance,10000);
});

test('充值档位可让到账高于实付，微信仍按实付收款，退款扣回当时到账额',()=>{
 const f=fixture();const config=f.run(merchant,'shopSettings');config.membership.enabled=true;config.membership.tiers=[{pay:10000,credit:12000},{pay:20000,credit:20000}];config.store.phone='13800000000';f.run(merchant,'saveShopSettings',config);
 const o=recharge(f);assert.equal(o.total,10000);assert.equal(o.walletCredit,12000);assert.match(o.lines[0].spec,/到账 ¥120.00/);
 assert.equal(f.paid(o.id).status,'COMPLETED');assert.equal(f.run(buyer,'membership').balance,12000);
 const purchase=goods(f);f.run(buyer,'balancePay',{id:purchase.id});
 const request=f.run(buyer,'refundRequest',{id:o.id,type:'REFUND_ONLY',reason:'退回充值'});
 assert.throws(()=>f.run(merchant,'refundReview',{id:o.id,caseId:request.refund.caseId,approve:true,note:'余额不足'}),/余额不足/);
 f.paid(recharge(f,'bonus-topup').id);f.run(merchant,'refundReview',{id:o.id,caseId:request.refund.caseId,approve:true,note:'扣回赠送'});
 assert.equal(f.run(buyer,'membership').balance,10100);
 const payload={orderId:o.id,eventId:'bonus-refund',refundId:'refund-bonus',amount:10000,currency:'CNY'};
 f.state=domain.settleVerifiedRefund(f.state,payload,now+2).state;
 assert.equal(f.run(buyer,'order',{id:o.id}).status,'REFUNDED');assert.equal(f.run(buyer,'membership').balance,10100);
 const current=f.run(merchant,'shopSettings');assert.throws(()=>f.run(merchant,'saveShopSettings',{...current,membership:{...current.membership,tiers:[{pay:10000,credit:5000}]}}),/不能低于充值金额/);
});

test('烘焙独立分类且仅自提；预约时间按上海营业时间校验、保存并参与幂等',()=>{
 const f=fixture();const product=f.run(merchant,'saveProduct',{name:'奶油可颂',category:'烘焙',active:true,image:'',skus:[{id:'piece',name:'单份',price:1200,stock:10}]});
 assert.equal(product.petScope,'不适用');const lines=[{productId:product.id,skuId:'piece',qty:1}];
 assert.throws(()=>f.run(buyer,'quoteOrder',{fulfillment:'DELIVERY',lines}),/仅支持到店自提/);
 const slots=f.run(buyer,'shopSettings').pickupSlots;assert.ok(slots.length>1);const at=slots[2].at;
 const input={key:'scheduled-pickup',fulfillment:'PICKUP',contact,lines,pickupAt:at};
 const o=f.run(buyer,'createOrder',input);assert.equal(o.fulfillment.pickupAt,at);assert.equal(f.run(buyer,'createOrder',input).id,o.id);
 assert.throws(()=>f.run(buyer,'createOrder',{...input,pickupAt:slots[3].at}),/IDEMPOTENCY_CONFLICT/);
 assert.throws(()=>f.run(buyer,'quoteOrder',{...input,pickupAt:now-60000}),/自提时间/);
 assert.throws(()=>f.run(buyer,'quoteOrder',{...input,pickupAt:Date.UTC(2026,10,3,0,0)}),/自提时间/);
 const saved=settings.read(f.state);saved.pickup.prepareMinutes=45;saved.store.phone='13800000000';f.run(merchant,'saveShopSettings',saved);assert.equal(f.run(buyer,'shopSettings').pickup.prepareMinutes,45);
});
