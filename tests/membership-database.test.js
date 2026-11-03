'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
for(const engine of ['mongo','mysql'])test('真实 '+engine+'：会员到账幂等、并发余额防超扣及重连持久化',{skip:process.env['PET_'+engine.toUpperCase()+'_TEST']!=='1'},async()=>{
 const database='pet_shop_wallet_test_'+randomUUID().replaceAll('-','');
 const Store=engine==='mysql'?require('../server/mysql-store').MysqlStore:require('../server/mongo-store').MongoStore;
 const store=await Store.connect({database});let second;
 try{
  second=await Store.connect({database});
  const merchant={id:'merchant',merchant:true},buyer={id:'wallet-buyer'},options={mock:false};
  const config=await store.execute(merchant,'shopSettings');config.store.phone='13800000000';config.hours.allDay=true;config.membership.enabled=true;
  await store.execute(merchant,'saveShopSettings',config);
  const recharge=await store.execute(buyer,'createRecharge',{key:'wallet-concurrency',amount:10000},options);
  const payload={orderId:recharge.id,eventId:'wallet-event',transactionId:'wallet-transaction',amount:10000,currency:'CNY'};
  await Promise.all([store.settlePayment(payload),second.settlePayment(payload)]);
  assert.equal((await store.execute(buyer,'membership')).balance,10000);
  assert.equal((await second.execute(buyer,'membership')).entries.length,1);
  const input={fulfillment:'PICKUP',contact:{name:'隔离会员',phone:'13800000000'},lines:[{productId:'toy',skuId:'toy-1',qty:4}]};
  const a=await store.execute(buyer,'createOrder',{...input,key:'wallet-purchase-one'},options);
  const b=await store.execute(buyer,'createOrder',{...input,key:'wallet-purchase-two'},options);
  const results=await Promise.allSettled([store.execute(buyer,'balancePay',{id:a.id},options),second.execute(buyer,'balancePay',{id:b.id},options)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.message,/余额不足/);
  const paid=results.find(r=>r.status==='fulfilled').value;
  await second.execute(buyer,'balancePay',{id:paid.id},options);
  await second.close();second=await Store.connect({database});
  const wallet=await second.execute(buyer,'membership');assert.equal(wallet.balance,2400);assert.equal(wallet.entries.length,2);
  assert.equal((await second.execute({id:'another-buyer'},'membership')).balance,0);
 }finally{
  if(second)await second.close();
  if(!/^pet_shop_wallet_test_[a-f0-9]{32}$/.test(database))throw Error('TEST_DATABASE_NAME');
  if(engine==='mysql')await store.query('DROP DATABASE `'+database+'`');else await store.db.dropDatabase();
  await store.close();
 }
});
