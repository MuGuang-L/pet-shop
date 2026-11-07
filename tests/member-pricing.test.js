'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const domain=require('../cloudfunctions/shop/domain');
const buyer={id:'price-member'},other={id:'price-nonmember'},merchant={id:'owner',merchant:true},now=Date.UTC(2026,10,8,4),contact={name:'顾客',phone:'13800000000'};
function fixture(){let state=domain.seed();return {get state(){return state;},run(actor,action,input={}){const out=domain.execute(state,actor,action,input,{mock:true,now});state=out.state;return out.result;},fund(amount=10000){const s=this.run(merchant,'shopSettings');s.store.phone=contact.phone;s.membership.enabled=true;this.run(merchant,'saveShopSettings',s);const o=this.run(buyer,'createRecharge',{key:'topup-'+amount,amount,custom:true});state=domain.settleVerifiedPayment(state,{orderId:o.id,eventId:'event-'+o.id,transactionId:'tx-'+o.id,amount,currency:'CNY'},now+1).state;},product(memberPrice=1500){const p=this.run(merchant,'merchantProducts').find(p=>p.id==='toy');p.skus[0].memberPrice=memberPrice;return this.run(merchant,'saveProduct',p);}};}
const input=(extra={})=>({fulfillment:'DINE_IN',contact,lines:[{productId:'toy',skuId:'toy-1',qty:1}],...extra});

test('商品普通价与会员价分别保存，未填写默认等于普通价，旧商品无需迁移',()=>{
 const f=fixture();assert.equal(f.run(other,'quoteOrder',input()).total,1900);
 const p=f.run(merchant,'merchantProducts')[1];assert.equal(p.skus[0].memberPrice,undefined);const saved=f.run(merchant,'saveProduct',p);assert.equal(saved.skus[0].memberPrice,1900);
 assert.equal(f.product().skus[0].memberPrice,1500);assert.equal(f.run(other,'quoteOrder',input()).total,1900);
 for(const memberPrice of [0,-1,1.2,10000001,null,'1500'])assert.throws(()=>f.product(memberPrice),/INVALID_MEMBER_PRICE/);
});

test('只有储值余额大于零才是会员，绑定手机号、打开会员中心或伪造标记都不算',()=>{
 const f=fixture();f.product();f.run(buyer,'bindPhone',{phone:contact.phone});assert.equal(f.run(buyer,'membership').isMember,false);assert.equal(f.run(buyer,'identity').isMember,false);
 assert.equal(f.run(buyer,'quoteOrder',input({isMember:true,memberPrice:1,total:1})).total,1900);
 f.fund();assert.equal(f.run(buyer,'membership').isMember,true);assert.equal(f.run(buyer,'identity').isMember,true);assert.equal(f.run(other,'identity').isMember,false);
 const member=f.run(buyer,'quoteOrder',input({isMember:false}));assert.equal(member.isMember,true);assert.equal(member.total,1500);assert.equal(member.regularSubtotal,1900);assert.equal(member.lines[0].price,1500);
 assert.equal(f.run(other,'quoteOrder',input({isMember:true})).total,1900);
});

test('会员身份与付款方式无关，有少量余额但不足支付整单时仍可按会员价使用微信付款',()=>{
 const f=fixture();f.product();f.fund(100);
 const o=f.run(buyer,'createOrder',input({key:'small-wallet-order'}));assert.equal(o.total,1500);assert.equal(o.pricing.isMember,true);assert.equal(o.lines[0].regularPrice,1900);assert.equal(o.lines[0].memberPrice,1500);assert.equal(o.lines[0].priceType,'MEMBER');
 assert.throws(()=>f.run(buyer,'balancePay',{id:o.id}),/余额不足/);
 const paid=domain.settleVerifiedPayment(f.state,{orderId:o.id,eventId:'goods-pay',transactionId:'goods-tx',amount:1500,currency:'CNY'},now+2);assert.equal(paid.result.total,1500);assert.equal(paid.result.status,'PAID');
});

test('余额刚好用完后新订单恢复普通价；已建订单锁定成交价，退款仍按实际支付金额',()=>{
 const f=fixture();f.product();f.fund(1500);
 const o=f.run(buyer,'createOrder',input({key:'use-all-wallet'}));assert.equal(o.total,1500);f.run(buyer,'balancePay',{id:o.id});assert.equal(f.run(buyer,'identity').isMember,false);
 assert.equal(f.run(buyer,'quoteOrder',input()).total,1900);assert.equal(f.run(buyer,'createOrder',input({key:'after-wallet-empty'})).total,1900);
 f.product(1000);assert.equal(f.run(buyer,'createOrder',input({key:'use-all-wallet'})).total,1500);
 const r=f.run(buyer,'refundRequest',{id:o.id,type:'REFUND_ONLY',reason:'退款'});const ref={id:o.id,caseId:r.refund.caseId};f.run(merchant,'refundReview',{...ref,simple:true,approve:true});f.run(merchant,'mockRefund',ref);assert.equal(f.run(buyer,'membership').balance,1500);assert.equal(f.run(buyer,'identity').isMember,true);assert.equal(f.run(buyer,'quoteOrder',input()).total,1000);
});

test('报价与下单之间会员身份或价格变化时拒绝旧金额，不创建错价订单',()=>{
 const f=fixture();f.product();f.fund(1500);const quote=f.run(buyer,'quoteOrder',input());
 const consume=f.run(buyer,'createOrder',input({key:'consume-wallet'}));f.run(buyer,'balancePay',{id:consume.id});
 assert.throws(()=>f.run(buyer,'createOrder',input({key:'stale-member-quote',expectedTotal:quote.total,settingsRevision:quote.settingsRevision})),/金额已变化/);
 assert.equal(f.state.orders.filter(o=>o.kind!=='RECHARGE').length,1);
});

test('快递运费优惠和起送门槛按实际会员商品价计算',()=>{
 const f=fixture();f.product();f.fund();const a=f.run(buyer,'saveAddress',{...contact,detail:'测试街道 1 号'}),s=f.run(merchant,'shopSettings');s.delivery.freeAbove=3500;s.delivery.fee=800;f.run(merchant,'saveShopSettings',s);
 const delivery=input({fulfillment:'DELIVERY',addressId:a.id,lines:[{productId:'toy',skuId:'toy-1',qty:2}]});
 const member=f.run(buyer,'quoteOrder',delivery),normal=f.run(other,'quoteOrder',delivery);assert.equal(member.subtotal,3000);assert.equal(member.shippingFee,800);assert.equal(normal.subtotal,3800);assert.equal(normal.shippingFee,0);
 const next=f.run(merchant,'shopSettings');next.delivery.minimum=3200;f.run(merchant,'saveShopSettings',next);assert.throws(()=>f.run(buyer,'quoteOrder',delivery),/须满/);
});

test('HTTP 结算按登录账号的真实余额计价，客户端伪造会员与单价无效',async()=>{
 const {memory}=require('./helpers/payment-fixture'),{createServer}=require('../server/http'),{Auth,createAccount}=require('../server/auth');
 const store=memory(),options={mock:true},p=(await store.execute(merchant,'merchantProducts',{},options))[1];p.skus[0].memberPrice=1500;await store.execute(merchant,'saveProduct',p,options);
 const settings=await store.execute(merchant,'shopSettings',{},options);settings.store.phone=contact.phone;settings.membership.enabled=true;await store.execute(merchant,'saveShopSettings',settings,options);
 const topup=await store.execute(buyer,'createRecharge',{key:'http-member-topup',amount:10000,custom:true},options);await store.settlePayment({orderId:topup.id,eventId:'http-member-paid',transactionId:'http-member-tx',amount:10000,currency:'CNY'});
 const auth=new Auth([createAccount('member','test-member-password','buyer',buyer.id),createAccount('normal','test-normal-password','buyer',other.id)]),member=(await auth.login('member','test-member-password')).token,normal=(await auth.login('normal','test-normal-password')).token;
 const server=createServer(store,{auth});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const post=async(token,action,extra={})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action,input:input(extra)})});return {status:r.status,...await r.json()};};
 try{
  assert.equal((await post(member,'identity')).data.isMember,true);assert.equal((await post(normal,'identity')).data.isMember,false);
  assert.equal((await post(member,'quoteOrder')).data.total,1500);assert.equal((await post(normal,'quoteOrder',{isMember:true,userId:buyer.id,memberPrice:1})).data.total,1900);
  const order=await post(normal,'createOrder',{key:'http-normal-price',isMember:true,total:1,lines:[{productId:'toy',skuId:'toy-1',qty:1,price:1,memberPrice:1}]});assert.equal(order.status,200);assert.equal(order.data.total,1900);assert.equal(order.data.pricing.isMember,false);
 }finally{await new Promise(r=>server.close(r));}
});
