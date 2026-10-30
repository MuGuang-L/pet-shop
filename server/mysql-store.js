'use strict';
const {randomUUID}=require('node:crypto');
const {seed,execute,orderPage,settleVerifiedPayment,settleVerifiedRefund}=require('../cloudfunctions/shop/domain');
const inventory=require('../cloudfunctions/shop/inventory');

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const retryable=new Set(['ECONNREFUSED','ETIMEDOUT','ENOTFOUND','ECONNRESET','EPIPE','EAI_AGAIN','PROTOCOL_CONNECTION_LOST','ER_CON_COUNT_ERROR','ER_LOCK_WAIT_TIMEOUT','ER_LOCK_DEADLOCK']);
function parseValue(value){return typeof value==='string'?JSON.parse(value):value;}
function configError(code){const error=Error(code);error.name='MysqlConfigError';return error;}
function unavailable(error){error.name='MysqlUnavailable';return error;}
function mysqlSettings(env=process.env){
 const address=String(env.MYSQL_ADDRESS||env.MYSQL_HOST||'').trim();
 if(!address)return null;
 let host=address,port=Number(env.MYSQL_PORT)||3306;
 const colon=address.lastIndexOf(':');
 if(colon>0&&/^\d+$/.test(address.slice(colon+1))){host=address.slice(0,colon);port=Number(address.slice(colon+1));}
 return {host,port,user:String(env.MYSQL_USER||env.MYSQL_USERNAME||''),password:String(env.MYSQL_PASSWORD||''),database:String(env.MYSQL_DATABASE||'pet_shop')};
}

class MysqlStore{
 constructor(pool,database){this.pool=pool;this.databaseName=database;this.engine='mysql';this.db={command:()=>this.ping()};}
 static async connect(overrides={}){
  const base=mysqlSettings()||{};
  const host=overrides.host!==undefined?overrides.host:(base.host||'');
  const port=overrides.port||base.port||3306;
  const user=overrides.user!==undefined?overrides.user:(base.user||'');
  const password=overrides.password!==undefined?overrides.password:(base.password||'');
  const database=overrides.database||base.database||'pet_shop';
  if(!host)throw configError('MYSQL_NOT_CONFIGURED');
  if(!user)throw configError('MYSQL_USER_REQUIRED');
  if(!/^[A-Za-z0-9_]{1,64}$/.test(database))throw configError('MYSQL_DATABASE_NAME');
  const mysql=require('mysql2/promise');
  const options={host,port,user,password,database,waitForConnections:true,connectionLimit:10,connectTimeout:10000,enableKeepAlive:true,charset:'utf8mb4'};
  const open=async()=>{const pool=mysql.createPool(options);const store=new MysqlStore(pool,database);try{await store.initialize();return store;}catch(error){await store.close();throw error;}};
  try{return await open();}
  catch(error){
    if(error.code!=='ER_BAD_DB_ERROR')throw mark(error);
    const admin=await mysql.createConnection({host,port,user,password,connectTimeout:10000});
    try{await admin.query('CREATE DATABASE IF NOT EXISTS `'+database+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');}
    finally{await admin.end();}
    try{return await open();}catch(again){throw mark(again);}
  }
 }
 async query(sql,params){try{const [rows]=await this.pool.query(sql,params);return rows;}catch(error){throw mark(error);}}
 async ping(){await this.query('SELECT 1');return {ok:1};}
 async initialize(){
  await this.query(`CREATE TABLE IF NOT EXISTS shop_state (
    id VARCHAR(32) NOT NULL PRIMARY KEY,
    schema_version INT NOT NULL,
    revision BIGINT NOT NULL,
    value JSON NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await this.query(`CREATE TABLE IF NOT EXISTS audit_log (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    at DATETIME(3) NOT NULL,
    actor VARCHAR(128) NOT NULL,
    action VARCHAR(80) NOT NULL,
    revision BIGINT NOT NULL,
    order_ids JSON NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await this.query(`CREATE TABLE IF NOT EXISTS wechat_trades (
    out_trade_no VARCHAR(40) NOT NULL PRIMARY KEY,
    order_id VARCHAR(64) NOT NULL,
    payload JSON NOT NULL,
    created_at BIGINT NOT NULL,
    KEY idx_order_created (order_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await this.transaction(async connection=>{
    const [rows]=await connection.query('SELECT schema_version FROM shop_state WHERE id=? FOR UPDATE',['singleton']);
    if(rows.length){if(Number(rows[0].schema_version)!==1)throw Error('UNSUPPORTED_DATABASE_SCHEMA');return;}
    try{await connection.query('INSERT INTO shop_state (id, schema_version, revision, value) VALUES (?,?,?,CAST(? AS JSON))',['singleton',1,0,JSON.stringify(seed())]);}
    catch(error){if(error.code!=='ER_DUP_ENTRY')throw error;}
  });
 }
 async transaction(work){
  const connection=await this.pool.getConnection();
  try{
    await connection.beginTransaction();
    const result=await work(connection);
    await connection.commit();
    return result;
  }catch(error){try{await connection.rollback();}catch{}throw mark(error);}finally{connection.release();}
 }
 async readState(connection){
  const [rows]=await connection.query('SELECT revision, value FROM shop_state WHERE id=? FOR UPDATE',['singleton']);
  if(!rows.length)throw Error('DATABASE_NOT_INITIALIZED');
  return {revision:Number(rows[0].revision),state:parseValue(rows[0].value)};
 }
 async writeState(connection,before,after,revision,actor,action){
  if(same(before,after))return revision;
  const [result]=await connection.query('UPDATE shop_state SET value=CAST(? AS JSON), revision=revision+1 WHERE id=? AND revision=?',[JSON.stringify(after),'singleton',revision]);
  if(result.affectedRows!==1)throw Error('REVISION_CONFLICT');
  const orderIds=after.orders.filter(order=>!same(before.orders.find(item=>item.id===order.id),order)).map(order=>order.id);
  await connection.query('INSERT INTO audit_log (id, at, actor, action, revision, order_ids) VALUES (?,?,?,?,?,CAST(? AS JSON))',[randomUUID(),new Date(),actor.id,action,revision+1,JSON.stringify(orderIds)]);
  return revision+1;
 }
 async execute(actor,action,input={},options={mock:true}){
  if(!actor||typeof actor.id!=='string'||!actor.id)throw Error('AUTH_REQUIRED');
  if(action==='stockHistory')return this.stockHistory(actor,input);
  if(action==='ordersPage'||action==='merchantOrdersPage')return this.orderPage(actor,action,input,options);
  return this.transaction(async connection=>{
    const loaded=await this.readState(connection);
    const out=execute(loaded.state,actor,action,input,options);
    await this.writeState(connection,loaded.state,out.state,loaded.revision,actor,action);
    return out.result;
  });
 }
 async orderPage(actor,action,input,options){
  if(!actor||typeof actor.id!=='string'||!actor.id)throw Error('AUTH_REQUIRED');
  if(action==='merchantOrdersPage'&&actor.merchant!==true)throw Error('FORBIDDEN');
  const now=options.now??Date.now();
  let {state}=await this.transaction(connection=>this.readState(connection));
  if(state.orders.some(order=>order.status==='PENDING'&&order.expiresAt<=now)){
    await this.execute({id:'system',merchant:true},'expire',{},{mock:true,now});
    state=(await this.transaction(connection=>this.readState(connection))).state;
  }
  const orders=action==='ordersPage'?state.orders.filter(order=>order.userId===actor.id):state.orders;
  return orderPage(orders,input);
 }
 async stockHistory(actor,input){
  if(!actor||typeof actor.id!=='string'||!actor.id)throw Error('AUTH_REQUIRED');
  if(actor.merchant!==true)throw Error('FORBIDDEN');
  const {state}=await this.transaction(connection=>this.readState(connection));
  return inventory.handle(state,actor,'stockHistory',input,{now:Date.now()});
 }
 async settlePayment(payload,now=Date.now()){return this.settle('payment',payload,now);}
 async settleRefund(payload,now=Date.now()){return this.settle('refund',payload,now);}
 async settle(kind,payload,now){
  return this.transaction(async connection=>{
    const loaded=await this.readState(connection);
    const out=(kind==='payment'?settleVerifiedPayment:settleVerifiedRefund)(loaded.state,payload,now);
    await this.writeState(connection,loaded.state,out.state,loaded.revision,{id:'wechat-pay'},kind==='payment'?'settleVerifiedPayment':'settleVerifiedRefund');
    return out.result;
  });
 }
 async upsertTrade(doc){
  const stored={...doc,_id:doc.outTradeNo};
  await this.query('INSERT INTO wechat_trades (out_trade_no, order_id, payload, created_at) VALUES (?,?,CAST(? AS JSON),?) ON DUPLICATE KEY UPDATE order_id=VALUES(order_id), payload=VALUES(payload), created_at=VALUES(created_at)',[doc.outTradeNo,doc.orderId,JSON.stringify(stored),doc.createdAt||Date.now()]);
  return stored;
 }
 async getTrade(outTradeNo){
  const rows=await this.query('SELECT payload FROM wechat_trades WHERE out_trade_no=?',[outTradeNo]);
  return rows.length?parseValue(rows[0].payload):null;
 }
 async reserveTrade(doc){
  return this.transaction(async connection=>{
   // The existing singleton row also serializes reservations across instances.
   await this.readState(connection);
   const [rows]=await connection.query('SELECT payload FROM wechat_trades WHERE order_id=? ORDER BY created_at DESC',[doc.orderId]);
   if(rows.length)return parseValue(rows[0].payload);
   const stored={...doc,_id:doc.outTradeNo,version:1};
   await connection.query('INSERT INTO wechat_trades (out_trade_no, order_id, payload, created_at) VALUES (?,?,CAST(? AS JSON),?)',[doc.outTradeNo,doc.orderId,JSON.stringify(stored),doc.createdAt]);
   return stored;
  });
 }
 async saveTrade(doc){
  const stored={...doc,_id:doc.outTradeNo,version:(doc.version||0)+1};
  const result=await this.query("UPDATE wechat_trades SET payload=CAST(? AS JSON) WHERE out_trade_no=? AND COALESCE(JSON_EXTRACT(payload, '$.version'),0)=?",[JSON.stringify(stored),doc.outTradeNo,doc.version||0]);
  if(result.affectedRows!==1)throw Error('PAYMENT_REVISION_CONFLICT');
  return stored;
 }
 async pendingTrades(at,limit=10){
  const rows=await this.query("SELECT payload FROM wechat_trades WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.status')) NOT IN ('SUCCESS','CLOSED','REFUNDED','DUPLICATE_REFUNDED') AND COALESCE(JSON_EXTRACT(payload, '$.nextCheckAt'),0)<=? ORDER BY COALESCE(JSON_EXTRACT(payload, '$.nextCheckAt'),0), created_at LIMIT ?",[at,limit]);
  return rows.map(row=>parseValue(row.payload));
 }
 async tradesByOrder(orderId){
  const rows=await this.query('SELECT payload FROM wechat_trades WHERE order_id=? ORDER BY created_at DESC',[orderId]);
  return rows.map(row=>parseValue(row.payload));
 }
 async close(){await this.pool.end();}
}
function mark(error){
 if(error.name==='MysqlConfigError'||error.name==='MysqlUnavailable')return error;
 if(['ER_BAD_DB_ERROR','ER_ACCESS_DENIED_ERROR','ER_DBACCESS_DENIED_ERROR'].includes(error.code))return Object.assign(error,{name:'MysqlConfigError'});
 if(retryable.has(error.code)||/resuming|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(error.message||''))return unavailable(error);
 return error;
}
module.exports={MysqlStore,mysqlSettings};
