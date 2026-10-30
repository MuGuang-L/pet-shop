'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {MysqlStore,mysqlSettings}=require('../server/mysql-store');

test('云托管内网地址带端口时拆成主机和端口',()=>{
  assert.deepEqual(mysqlSettings({MYSQL_ADDRESS:'10.0.0.8:3306',MYSQL_USERNAME:'app',MYSQL_PASSWORD:'secret',MYSQL_DATABASE:'shop_db'}),{host:'10.0.0.8',port:3306,user:'app',password:'secret',database:'shop_db'});
  assert.equal(mysqlSettings({MYSQL_HOST:'10.0.0.9',MYSQL_PORT:'3307',MYSQL_USER:'app'}).port,3307);
  assert.equal(mysqlSettings({}),null);
});

test('未配置 MySQL 地址时给出明确错误，不尝试连接',async()=>{
  await assert.rejects(MysqlStore.connect({host:''}),e=>e.name==='MysqlConfigError'&&e.message==='MYSQL_NOT_CONFIGURED');
});

test('MySQL 事务保存订单、幂等重放和支付单',async()=>{
  let row=null;const trades=new Map();
  const query=async(sql,params=[])=>{
    if(sql.startsWith('CREATE TABLE')||sql==='SELECT 1')return [[]];
    if(sql.startsWith('SELECT schema_version'))return [row?[{schema_version:1}]:[]];
    if(sql.startsWith('INSERT INTO shop_state')){row={revision:0,value:JSON.parse(params[3])};return [{affectedRows:1}];}
    if(sql.startsWith('SELECT revision'))return [row?[{revision:row.revision,value:row.value}]:[]];
    if(sql.startsWith('UPDATE shop_state')){
      if(Number(params[2])!==row.revision)return [{affectedRows:0}];
      row={revision:row.revision+1,value:JSON.parse(params[0])};return [{affectedRows:1}];
    }
    if(sql.startsWith('INSERT INTO audit_log'))return [{affectedRows:1}];
    if(sql.startsWith('INSERT INTO wechat_trades')){trades.set(params[0],JSON.parse(params[2]));return [{affectedRows:1}];}
    if(sql.startsWith('SELECT payload FROM wechat_trades WHERE out_trade_no')){const doc=trades.get(params[0]);return [doc?[{payload:doc}]:[]];}
    if(sql.startsWith('SELECT payload FROM wechat_trades WHERE order_id'))return [[...trades.values()].filter(doc=>doc.orderId===params[0]).map(payload=>({payload}))];
    throw Error('UNEXPECTED_SQL');
  };
  const store=new MysqlStore({query,async getConnection(){return {query,async beginTransaction(){},async commit(){},async rollback(){},release(){}};},async end(){}},'pet_shop');
  await store.initialize();
  const buyer={id:'buyer-1'};
  const address=await store.execute(buyer,'saveAddress',{name:'模拟',phone:'13800000000',detail:'模拟市地址 1 号',requestKey:'addr-key-01'});
  const input={key:'order-key-01',addressId:address.id,lines:[{productId:'food',skuId:'food-1',qty:1}]};
  const order=await store.execute(buyer,'createOrder',input);
  assert.equal(order.status,'PENDING');assert.equal(order.total,4700);
  assert.equal((await store.execute(buyer,'createOrder',input)).id,order.id);
  assert.equal(row.value.products.find(item=>item.id==='food').skus[0].stock,19);
  const page=await store.execute(buyer,'ordersPage',{});
  assert.equal(page.total,1);assert.equal(page.items[0].id,order.id);
  await store.upsertTrade({outTradeNo:'Pabc',orderId:order.id,amount:4700,createdAt:1});
  assert.equal((await store.getTrade('Pabc')).orderId,order.id);
  assert.equal((await store.tradesByOrder(order.id))[0].outTradeNo,'Pabc');
  const paid=await store.settlePayment({orderId:order.id,transactionId:'tx-1',amount:4700,currency:'CNY',eventId:'pay:tx-1'});
  assert.equal(paid.status,'PAID');assert.equal(row.revision>2,true);
});
