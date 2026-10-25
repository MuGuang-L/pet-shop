'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const domain=require('../cloudfunctions/shop/domain');
const buyer={id:'settings-buyer'},merchant={id:'settings-owner',merchant:true};
const now=Date.parse('2026-10-26T04:00:00Z'); // Monday noon in Asia/Shanghai.
function fixture(){let state=domain.seed();return {get state(){return state;},call(action,input={},actor=buyer,time=now){const out=domain.execute(state,actor,action,input,{mock:true,now:time});state=out.state;return out.result;},save(input){return this.call('saveShopSettings',input,merchant);}};}
const lines=[{productId:'toy',skuId:'toy-1',qty:1}];
const pickup=key=>({key,fulfillment:'PICKUP',contact:{name:'模拟提货人',phone:'13800000000'},lines});
test('旧数据库无需迁移，默认地址、营业时间、外送费及旧下单参数兼容',()=>{
  const f=fixture(),settings=f.call('shopSettings');assert.equal(settings.revision,0);assert.equal(settings.delivery.fee,800);assert.equal(settings.hours.enforce,false);assert.equal(settings.canOrder,true);assert.equal(f.state.shopSettings,undefined);
  const address=f.call('saveAddress',{name:'模拟',phone:'13800000000',detail:'模拟市测试路 1 号'});
  const o=f.call('createOrder',{key:'legacy-settings-order',addressId:address.id,lines});assert.equal(o.shippingFee,800);assert.equal(o.total,2700);
  assert.equal(f.call('createOrder',pickup('legacy-pickup-order')).shippingFee,0);
});
test('经营设置仅商家可写，版本冲突及非法参数不产生部分写入',()=>{
  const f=fixture(),s=f.call('shopSettings');assert.throws(()=>f.call('saveShopSettings',s),/FORBIDDEN/);
  const invalid=[x=>x.delivery.fee=-1,x=>x.delivery.fee=1.5,x=>x.hours.days=[1,1],x=>x.hours.open='24:00',x=>x.hours.close='09:00',x=>x.pickup.enabled='false',x=>{x.pickup.enabled=false;x.delivery.enabled=false;},x=>x.store.phone='abc',x=>x.delivery.estimateMinutes=0];
  for(const change of invalid){const candidate=structuredClone(s),before=structuredClone(f.state);change(candidate);assert.throws(()=>f.save(candidate));assert.deepEqual(f.state,before);}
  const saved=f.save(s);assert.equal(saved.revision,1);assert.throws(()=>f.save(s),/已更新/);assert.equal(f.call('shopSettings').revision,1);
});
test('按北京时间校验营业日和时段，闭店不影响现有订单付款与重试',()=>{
  const f=fixture(),s=f.call('shopSettings');s.hours={days:[1],open:'10:00',close:'20:00',allDay:false,enforce:true};f.save(s);
  assert.equal(f.call('shopSettings',{},buyer,Date.parse('2026-10-26T02:00:00Z')).canOrder,true);
  assert.equal(f.call('shopSettings',{},buyer,Date.parse('2026-10-26T12:00:00Z')).canOrder,false);
  assert.throws(()=>f.call('quoteOrder',{fulfillment:'PICKUP',lines},buyer,Date.parse('2026-10-27T04:00:00Z')),/接单时间/);
  const input=pickup('hours-existing-order'),o=f.call('createOrder',input);
  const paused=f.call('shopSettings');paused.acceptingOrders=false;f.save(paused);
  assert.throws(()=>f.call('createOrder',pickup('hours-new-order')),/暂停接单/);
  assert.equal(f.call('createOrder',input).id,o.id);assert.equal(f.call('mockPay',{id:o.id}).status,'PAID');
});
test('外送起送、满额免配送费、开关和报价均由服务端计算，报价不占库存',()=>{
  const f=fixture(),s=f.call('shopSettings');s.delivery={...s.delivery,fee:650,minimum:3000,freeAbove:5000};f.save(s);
  const before=structuredClone(f.state);assert.throws(()=>f.call('quoteOrder',{lines}),/须满 30.00/);assert.deepEqual(f.state,before);
  const q=f.call('quoteOrder',{lines:[{...lines[0],qty:2}]});assert.equal(q.total,4450);assert.equal(q.shippingFee,650);assert.deepEqual(f.state,before);
  assert.equal(f.call('quoteOrder',{lines:[{...lines[0],qty:3}]}).shippingFee,0);
  assert.equal(f.call('quoteOrder',{fulfillment:'PICKUP',lines}).total,1900);
  const updated=f.call('shopSettings');updated.pickup.enabled=false;f.save(updated);assert.throws(()=>f.call('createOrder',pickup('disabled-pickup')),/暂未开放到店自提/);
});
test('设置变更保留旧订单地址与费用，新订单保存履约规则快照',()=>{
  const f=fixture(),old=f.call('createOrder',pickup('snapshot-before'));
  const s=f.call('shopSettings');s.store.detail='模拟市新门店 99 号';s.hours.open='09:00';s.delivery.fee=1200;f.save(s);
  const fresh=f.call('createOrder',pickup('snapshot-after'));assert.equal(fresh.fulfillment.store.detail,s.store.detail);assert.match(fresh.fulfillment.store.hours,/09:00/);assert.deepEqual(f.call('order',{id:old.id}).fulfillment,old.fulfillment);
  const a=f.call('saveAddress',{name:'模拟',phone:'13800000000',detail:'模拟市测试路 1 号'});
  const delivery=f.call('createOrder',{key:'snapshot-delivery',addressId:a.id,lines});assert.equal(delivery.shippingFee,1200);assert.equal(delivery.fulfillment.delivery.fee,1200);
  const next=f.call('shopSettings');next.delivery.fee=600;f.save(next);assert.equal(f.call('order',{id:delivery.id}).shippingFee,1200);
});
test('确认后设置或价格变化拒绝新订单，失败不扣库存，幂等重试不重算金额',()=>{
  const f=fixture(),q=f.call('quoteOrder',{fulfillment:'PICKUP',lines}),input={...pickup('quote-confirmed'),settingsRevision:q.settingsRevision,expectedTotal:q.total};
  const o=f.call('createOrder',input);const s=f.call('shopSettings');s.store.name='模拟新店名';f.save(s);
  assert.equal(f.call('createOrder',input).id,o.id);
  const before=structuredClone(f.state);assert.throws(()=>f.call('createOrder',{...input,key:'quote-stale-key'}),/设置已变化/);assert.deepEqual(f.state,before);
  assert.throws(()=>f.call('createOrder',{...input,key:'quote-price-key',settingsRevision:1,expectedTotal:1}),/金额已变化/);assert.deepEqual(f.state,before);
});
