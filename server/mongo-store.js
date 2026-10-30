'use strict';
const {MongoClient}=require('mongodb');
const {seed,execute,orderQuery,settleVerifiedPayment,settleVerifiedRefund}=require('../cloudfunctions/shop/domain');
const inventory=require('../cloudfunctions/shop/inventory');
const {loadScope,stateFrom}=require('./mongo-scope');
const {randomUUID,createHash}=require('node:crypto');
const collections=['products','orders','address_books','idempotency_keys','payment_events','stock_movements'];
const hash=s=>createHash('sha256').update(s).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const transaction=(session,work,options={})=>session.withTransaction(work,{timeoutMS:12000,...options});
function documents(state){return {
 stock_movements:(state.stockMovements||[]).map((value,position)=>({_id:value.id,orderId:value.orderId,caseId:value.caseId,position,value})),
 products:state.products.map((value,position)=>({_id:value.id,position,value})),
 orders:state.orders.map((value,position)=>({_id:value.id,userId:value.userId,status:value.status,createdAt:value.createdAt,expiresAt:value.expiresAt,position,value})),
 address_books:Object.entries(state.addresses).map(([userId,value])=>({_id:userId,value})),
 idempotency_keys:Object.entries(state.keys).map(([key,value])=>({_id:hash(key),key,value})),
 payment_events:Object.entries(state.events).map(([key,value])=>({_id:hash(key),key,value}))
};}
function metadata(state){const {products,orders,addresses,keys,events,stockMovements,...rest}=state;return rest;}
class MongoStore{
 constructor(client,db){this.client=client;this.db=db;}
 static async connect({uri=process.env.MONGODB_URI||'mongodb://127.0.0.1:27018/?replicaSet=petshop',database=process.env.MONGODB_DATABASE||'pet_shop_demo',monitorCommands=false}={}){
  if(!/^pet_shop_[a-zA-Z0-9_]+$/.test(database))throw Error('DATABASE_NAME_MUST_START_WITH_pet_shop_');
  const client=new MongoClient(uri,{serverSelectionTimeoutMS:5000,connectTimeoutMS:5000,waitQueueTimeoutMS:5000,socketTimeoutMS:10000,maxPoolSize:10,monitorCommands});
  try{await client.connect();const hello=await client.db('admin').command({hello:1});if(!hello.setName)throw Error('MONGODB_REPLICA_SET_REQUIRED');const store=new MongoStore(client,client.db(database));await store.initialize();return store;}catch(e){await client.close();throw e;}
 }
 async initialize(){
  for(const name of ['shop_meta',...collections,'audit_log']){try{await this.db.createCollection(name);}catch(e){if(e.code!==48)throw e;}}
  await this.db.collection('orders').createIndex({userId:1,createdAt:-1});
  await this.db.collection('orders').createIndex({userId:1,createdAt:-1,_id:-1});
  await this.db.collection('orders').createIndex({createdAt:-1,_id:-1});
  await this.db.collection('orders').createIndex({status:1,createdAt:-1,_id:-1});
  await this.db.collection('orders').createIndex({status:1,expiresAt:1,_id:1});
  await this.db.collection('orders').createIndex({'value.lines.productId':1,status:1});
  await this.db.collection('orders').createIndex({'value.fulfillment.code':1,status:1});
  await this.db.collection('orders').createIndex({'value.payment.transactionId':1},{unique:true,partialFilterExpression:{'value.payment.transactionId':{$type:'string'}}});
  try{await this.db.createCollection('wechat_trades');}catch(e){if(e.code!==48)throw e;}
  await this.db.collection('wechat_trades').createIndex({orderId:1,createdAt:-1});
  for(const name of ['products','orders','stock_movements'])await this.db.collection(name).createIndex({position:1,_id:1});
  await this.db.collection('audit_log').createIndex({at:-1});
  await this.db.collection('stock_movements').createIndex({orderId:1,caseId:1});
  await this.db.collection('stock_movements').createIndex({'value.productId':1,'value.at':-1,_id:-1});
  // Seed only once. An existing database is never reset at startup.
  const session=this.client.startSession();try{await transaction(session,async()=>{const meta=await this.db.collection('shop_meta').findOne({_id:'settings'},{session});if(meta){if(meta.schemaVersion!==1)throw Error('UNSUPPORTED_DATABASE_SCHEMA');return;}const state=seed();await this.db.collection('shop_meta').insertOne({_id:'settings',schemaVersion:1,revision:0,value:metadata(state)},{session});const docs=documents(state);for(const name of collections)if(docs[name].length)await this.db.collection(name).insertMany(docs[name],{session});});}finally{await session.endSession();}
 }
 // Collection-level cursor deadlines avoid the driver sending maxTimeMS on
 // non-tailable getMore. Keep write collections free of inherited timeoutMS:
 // insertMany resolves it twice and rejects it inside withTransaction in 6.x.
 read(name,timeoutMS=12000){return this.db.collection(name,{timeoutMS});}
 async load(session,timeoutMS=12000){
  const meta=await this.db.collection('shop_meta').findOne({_id:'settings'},{session});if(!meta)throw Error('DATABASE_NOT_INITIALIZED');
  const docs={};for(const name of collections)docs[name]=await this.read(name,timeoutMS).find({},{session}).sort({position:1,_id:1}).toArray();
  return {state:stateFrom(meta,docs),meta};
 }
 async persist(before,after,meta,session,actor,action,scopeDocs=null){
  if(same(before,after))return;
  // Low-QPS single-shop writes serialize on this revision. A competing write
  // causes MongoDB to retry the complete transaction using a fresh snapshot.
  const lock=await this.db.collection('shop_meta').updateOne({_id:'settings',revision:meta.revision},{$set:{value:metadata(after)},$inc:{revision:1}},{session});if(lock.matchedCount!==1)throw Error('REVISION_CONFLICT');
  const oldDocs=documents(before),newDocs=documents(after);
  if(scopeDocs)for(const name of ['products','orders','stock_movements']){
   const positions=new Map(scopeDocs[name].map(d=>[d._id,d.position]));
   const added=newDocs[name].filter(d=>!positions.has(d._id));
   if(added.length){const last=await this.read(name).find({},{session,projection:{position:1}}).sort({position:-1,_id:-1}).limit(1).next();let position=last?.position??-1;for(const doc of added)positions.set(doc._id,++position);}
   for(const doc of [...oldDocs[name],...newDocs[name]])doc.position=positions.get(doc._id);
  }
  for(const name of collections){const old=new Map(oldDocs[name].map(d=>[d._id,d])),current=new Map(newDocs[name].map(d=>[d._id,d]));const ops=[];for(const [id,doc] of current)if(!same(old.get(id),doc))ops.push({replaceOne:{filter:{_id:id},replacement:doc,upsert:true}});for(const id of old.keys())if(!current.has(id))ops.push({deleteOne:{filter:{_id:id}}});if(ops.length)await this.db.collection(name).bulkWrite(ops,{session});}
  await this.db.collection('audit_log').insertOne({_id:randomUUID(),at:new Date(),actor:actor.id,action,revision:meta.revision+1,orderIds:after.orders.filter(o=>!same(before.orders.find(p=>p.id===o.id),o)).map(o=>o.id)},{session});
 }
 async execute(actor,action,input={},options={mock:true}){
  if(!actor||typeof actor.id!=='string'||!actor.id)throw Error('AUTH_REQUIRED');
  if(action==='stockHistory')return this.stockHistory(actor,input);
  if(action==='ordersPage'||action==='merchantOrdersPage')return this.orderPage(actor,action,input,options);
  const session=this.client.startSession();let result;try{await transaction(session,async()=>{const {state,meta,docs,context}=await loadScope(this,session,actor,action,input,options,hash);const out=execute(state,actor,action,input,{...options,...context});await this.persist(state,out.state,meta,session,actor,action,docs);result=out.result;},{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});return result;}finally{await session.endSession();}
 }
 async orderPage(actor,action,input,options){
  if(!actor||typeof actor.id!=='string'||!actor.id)throw Error('AUTH_REQUIRED');
  if(action==='merchantOrdersPage'&&actor.merchant!==true)throw Error('FORBIDDEN');
  const args=orderQuery(input),scope=action==='ordersPage'?{userId:actor.id}:{},filter={...scope};
  const now=options.now??Date.now();
  if(await this.db.collection('orders').findOne({status:'PENDING',expiresAt:{$lte:now}},{projection:{_id:1}}))await this.execute({id:'system',merchant:true},'expire',{},options);
  if(args.status!=='ALL')filter.status=args.status==='AFTERSALE'?{$in:['REFUND_REQUESTED','REFUNDING','REFUNDED']}:args.status;
  if(args.fulfillment!=='ALL')filter['value.fulfillment.type']=args.fulfillment==='DELIVERY'?{$ne:'PICKUP'}:'PICKUP';
  if(args.q){const literal=args.q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');filter.$or=[{_id:{$regex:literal,$options:'i'}},{'value.lines.name':{$regex:literal,$options:'i'}}];}
  const session=this.client.startSession();let result;try{await transaction(session,async()=>{const col=this.db.collection('orders');const total=await col.countDocuments(filter,{session}),pages=Math.max(1,Math.ceil(total/args.pageSize)),page=Math.min(args.page,pages);const rows=await this.read('orders').find(filter,{session}).sort({createdAt:-1,_id:-1}).skip((page-1)*args.pageSize).limit(args.pageSize).toArray();const paidCount=await col.countDocuments({...scope,status:'PAID'},{session});result={items:rows.map(x=>x.value),page,pageSize:args.pageSize,total,pages,paidCount};},{readConcern:{level:'snapshot'}});return result;}finally{await session.endSession();}
 }
 async stockHistory(actor,input){
  if(!actor||typeof actor.id!=='string'||!actor.id)throw Error('AUTH_REQUIRED');
  if(actor.merchant!==true)throw Error('FORBIDDEN');
  const args=inventory.historyArgs(input),filter={};
  if(args.productId)filter['value.productId']=args.productId;
  if(args.type!=='ALL')filter['value.type']=args.type;
  const session=this.client.startSession();let result;
  try{await transaction(session,async()=>{const col=this.db.collection('stock_movements'),total=await col.countDocuments(filter,{session}),pages=Math.max(1,Math.ceil(total/args.pageSize)),page=Math.min(args.page,pages);
    const rows=await this.read('stock_movements').find(filter,{session}).sort({'value.at':-1,_id:-1}).skip((page-1)*args.pageSize).limit(args.pageSize).toArray();
    result={items:rows.map(r=>inventory.normalize(r.value)),total,pages,page,pageSize:args.pageSize};
  },{readConcern:{level:'snapshot'}});return result;}finally{await session.endSession();}
 }
 async snapshot(){const session=this.client.startSession();let state;try{await transaction(session,async()=>{state=(await this.load(session)).state;},{readConcern:{level:'snapshot'}});return state;}finally{await session.endSession();}}
 async backupSnapshot(){
  const session=this.client.startSession();let result;
  try{await transaction(session,async()=>{const {state,meta}=await this.load(session,60000);const audit=await this.read('audit_log',60000).find({},{session}).sort({revision:1,_id:1}).toArray();result={state,audit,revision:meta.revision};},{readConcern:{level:'snapshot'},timeoutMS:60000});return result;}finally{await session.endSession();}
 }
 async restoreSnapshot({state,audit,revision,backupId}){
  if(!/^pet_shop_restore_[a-zA-Z0-9_]+$/.test(this.db.databaseName))throw Error('RESTORE_REQUIRES_NEW_pet_shop_restore_DATABASE');
  if(!state||state.version!==1||!Array.isArray(state.products)||!Array.isArray(state.orders)||!state.addresses||!state.keys||!state.events||!Array.isArray(audit)||!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER)throw Error('INVALID_BACKUP');
  const session=this.client.startSession();
  try{await transaction(session,async()=>{
   const before=await this.load(session);
   if(before.meta.revision!==0||!require('node:util').isDeepStrictEqual(before.state,seed())||await this.db.collection('audit_log').countDocuments({},{session}))throw Error('RESTORE_TARGET_NOT_EMPTY');
   await this.persist(before.state,state,before.meta,session,{id:'system'},'restore');
   const restoreEvent=await this.db.collection('audit_log').findOne({action:'restore'},{session});
   if(restoreEvent)await this.db.collection('audit_log').updateOne({_id:restoreEvent._id},{$set:{revision:revision+1,backupId}},{session});
   else await this.db.collection('audit_log').insertOne({_id:randomUUID(),at:new Date(),actor:'system',action:'restore',revision:revision+1,backupId,orderIds:[]},{session});
   if(audit.length)await this.db.collection('audit_log').insertMany(audit.map(row=>({...row,at:new Date(row.at)})),{session});
   await this.db.collection('shop_meta').updateOne({_id:'settings'},{$set:{revision:revision+1}},{session});
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'},timeoutMS:60000});}finally{await session.endSession();}
 }
 async restore(state){return this.restoreSnapshot({state,audit:[],revision:0,backupId:'legacy-format-1'});}
 async settlePayment(payload,now=Date.now()){return this.settleVerified('payment',payload,now);}
 async settleRefund(payload,now=Date.now()){return this.settleVerified('refund',payload,now);}
 async settleVerified(kind,payload,now){
  const session=this.client.startSession();let result;
  try{await transaction(session,async()=>{
   const meta=await this.db.collection('shop_meta').findOne({_id:'settings'},{session});if(!meta)throw Error('DATABASE_NOT_INITIALIZED');
   const orderDoc=await this.read('orders').findOne({_id:payload.orderId},{session});if(!orderDoc)throw Error('ORDER_NOT_FOUND');
   if(kind==='payment'){const reused=await this.read('orders').findOne({_id:{$ne:payload.orderId},'value.payment.transactionId':payload.transactionId},{session,projection:{_id:1}});if(reused)throw Error('TRANSACTION_REUSED');}
   const productIds=[...new Set((orderDoc.value.lines||[]).map(line=>line.productId))];
   const products=productIds.length?await this.read('products').find({_id:{$in:productIds}},{session}).toArray():[];
   const eventKey=JSON.stringify([kind==='payment'?'payment':'refund',payload.eventId]);
   const eventDoc=await this.db.collection('payment_events').findOne({_id:hash(eventKey)},{session});
   const docs={products,orders:[orderDoc],address_books:[],idempotency_keys:[],payment_events:eventDoc?[eventDoc]:[],stock_movements:[]};
   const state=stateFrom(meta,docs);
   const out=(kind==='payment'?settleVerifiedPayment:settleVerifiedRefund)(state,payload,now);
   await this.persist(state,out.state,meta,session,{id:'wechat-pay'},kind==='payment'?'settleVerifiedPayment':'settleVerifiedRefund',docs);
   result=out.result;
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});return result;}finally{await session.endSession();}
 }
 async close(){await this.client.close();}
}
module.exports={MongoStore};
