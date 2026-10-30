'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fixture}=require('./helpers/payment-fixture');
// Explicit test flags only. Never use the application's shared database.
for(const engine of ['mongo','mysql'])test('真实 '+engine+'：多连接支付预约、超时恢复、持久化补查与版本冲突',{skip:process.env['PET_'+engine.toUpperCase()+'_TEST']!=='1'},async()=>{
 const database='pet_shop_payment_test_'+randomUUID().replaceAll('-','');
 const Store=engine==='mysql'?require('../server/mysql-store').MysqlStore:require('../server/mongo-store').MongoStore;
 const store=await Store.connect({database});let second;
 try{
  second=await Store.connect({database});
  const reservation={orderId:'reservation-only',openid:'test-openid',amount:1,status:'CLOSED',createdAt:1};
  const reservations=await Promise.all([store.reserveTrade({...reservation,outTradeNo:'Pcandidate-one'}),second.reserveTrade({...reservation,outTradeNo:'Pcandidate-two'})]);
  assert.equal(reservations[0].outTradeNo,reservations[1].outTradeNo);assert.equal((await store.tradesByOrder(reservation.orderId)).length,1);
  const f=await fixture(store);
  f.behavior.timeoutOnce=true;
  await assert.rejects(f.gateway().createPayment(f.actor,{id:f.order.id},{}),/ETIMEDOUT/);
  const results=await Promise.all([f.gateway().createPayment(f.actor,{id:f.order.id},{}),f.gateway(second).createPayment(f.actor,{id:f.order.id},{})]);
  assert.equal(results[0].outTradeNo,results[1].outTradeNo);assert.equal(f.remote.size,1);
  assert.equal((await second.tradesByOrder(f.order.id)).length,1);
  const old=await store.getTrade(results[0].outTradeNo);
  await store.execute(f.actor,'cancel',{id:f.order.id});f.remote.get(old.outTradeNo).state='SUCCESS';f.advance(60001);
  assert.equal((await f.gateway(second).reconcile()).failed,0);
  const order=await store.execute(f.actor,'order',{id:f.order.id});assert.equal(order.status,'REFUNDED');
  assert.equal((await store.execute(f.actor,'catalog'))[0].skus[0].stock,20);
  await assert.rejects(store.saveTrade({...old,status:'CREATED'}),/PAYMENT_REVISION_CONFLICT/);
  assert.equal((await second.getTrade(old.outTradeNo)).status,'REFUNDED');
  assert.equal((await second.pendingTrades(f.now())).length,0);
  // Legacy records have no version field. Keep their number, do not mint a
  // new payment, and migrate their version on the first successful write.
  const legacy={outTradeNo:'Plegacy-test',orderId:'legacy-order',openid:f.actor.openid,amount:1,status:'CREATED',createdAt:1};
  await store.upsertTrade(legacy);
  const reserved=await second.reserveTrade({...legacy,outTradeNo:'Pmust-not-be-created'});assert.equal(reserved.outTradeNo,legacy.outTradeNo);
  const saved=await second.saveTrade({...reserved,status:'CLOSED'});assert.equal(saved.version,1);
  await assert.rejects(store.saveTrade({...reserved,status:'CREATED'}),/PAYMENT_REVISION_CONFLICT/);
 }finally{
  if(second)await second.close();
  // Only the random, explicitly named test database created above is removed.
  if(!/^pet_shop_payment_test_[a-f0-9]{32}$/.test(database))throw Error('TEST_DATABASE_NAME');
  if(engine==='mysql')await store.query('DROP DATABASE `'+database+'`');else await store.db.dropDatabase();
  await store.close();
 }
});
