'use strict';
const {MongoClient}=require('mongodb');
const {seed,execute,orderQuery}=require('../cloudfunctions/shop/domain');
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
 static async connect({uri=process.env.MONGODB_URI||'mongodb://127.0.0.1:27018/?replicaSet=petshop',database=process.env.MONGODB_DATABASE||'pet_shop_demo'}={}){
  if(!/^pet_shop_[a-zA-Z0-9_]+$/.test(database))throw Error('DATABASE_NAME_MUST_START_WITH_pet_shop_');
  const client=new MongoClient(uri,{serverSelectionTimeoutMS:5000,connectTimeoutMS:5000,waitQueueTimeoutMS:5000,socketTimeoutMS:10000,maxPoolSize:10});
  try{await client.connect();const hello=await client.db('admin').command({hello:1});if(!hello.setName)throw Error('MONGODB_REPLICA_SET_REQUIRED');const store=new MongoStore(client,client.db(database));await store.initialize();return store;}catch(e){await client.close();throw e;}
 }
 async initialize(){
  for(const name of ['shop_meta',...collections,'audit_log']){try{await this.db.createCollection(name);}catch(e){if(e.code!==48)throw e;}}
  await this.db.collection('orders').createIndex({userId:1,createdAt:-1});
  await this.db.collection('orders').createIndex({status:1,expiresAt:1});
  await this.db.collection('audit_log').createIndex({at:-1});
  await this.db.collection('stock_movements').createIndex({orderId:1,caseId:1});
  // Seed only once. An existing database is never reset at startup.
  const session=this.client.startSession();try{await transaction(session,async()=>{const meta=await this.db.collection('shop_meta').findOne({_id:'settings'},{session});if(meta){if(meta.schemaVersion!==1)throw Error('UNSUPPORTED_DATABASE_SCHEMA');return;}const state=seed();await this.db.collection('shop_meta').insertOne({_id:'settings',schemaVersion:1,revision:0,value:metadata(state)},{session});const docs=documents(state);for(const name of collections)if(docs[name].length)await this.db.collection(name).insertMany(docs[name],{session});});}finally{await session.endSession();}
 }
 async load(session){
  const meta=await this.db.collection('shop_meta').findOne({_id:'settings'},{session});if(!meta)throw Error('DATABASE_NOT_INITIALIZED');
  const docs={};for(const name of collections)docs[name]=await this.db.collection(name).find({},{session}).sort({position:1,_id:1}).toArray();
  const state={...meta.value,stockMovements:docs.stock_movements.map(d=>d.value),products:docs.products.map(d=>d.value),orders:docs.orders.map(d=>d.value),addresses:Object.fromEntries(docs.address_books.map(d=>[d._id,d.value])),keys:Object.fromEntries(docs.idempotency_keys.map(d=>[d.key,d.value])),events:Object.fromEntries(docs.payment_events.map(d=>[d.key,d.value]))};return {state,meta};
 }
 async persist(before,after,meta,session,actor,action){
  if(same(before,after))return;
  // Low-QPS single-shop writes serialize on this revision. A competing write
  // causes MongoDB to retry the complete transaction using a fresh snapshot.
  const lock=await this.db.collection('shop_meta').updateOne({_id:'settings',revision:meta.revision},{$set:{value:metadata(after)},$inc:{revision:1}},{session});if(lock.matchedCount!==1)throw Error('REVISION_CONFLICT');
  const oldDocs=documents(before),newDocs=documents(after);
  for(const name of collections){const old=new Map(oldDocs[name].map(d=>[d._id,d])),current=new Map(newDocs[name].map(d=>[d._id,d]));const ops=[];for(const [id,doc] of current)if(!same(old.get(id),doc))ops.push({replaceOne:{filter:{_id:id},replacement:doc,upsert:true}});for(const id of old.keys())if(!current.has(id))ops.push({deleteOne:{filter:{_id:id}}});if(ops.length)await this.db.collection(name).bulkWrite(ops,{session});}
  await this.db.collection('audit_log').insertOne({_id:randomUUID(),at:new Date(),actor:actor.id,action,revision:meta.revision+1,orderIds:after.orders.filter(o=>!same(before.orders.find(p=>p.id===o.id),o)).map(o=>o.id)},{session});
 }
 async execute(actor,action,input={},options={mock:true}){
  if(action==='ordersPage'||action==='merchantOrdersPage')return this.orderPage(actor,action,input,options);
  const session=this.client.startSession();let result;try{await transaction(session,async()=>{const {state,meta}=await this.load(session);const out=execute(state,actor,action,input,options);await this.persist(state,out.state,meta,session,actor,action);result=out.result;},{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});return result;}finally{await session.endSession();}
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
  const session=this.client.startSession();let result;try{await transaction(session,async()=>{const col=this.db.collection('orders');const total=await col.countDocuments(filter,{session}),pages=Math.max(1,Math.ceil(total/args.pageSize)),page=Math.min(args.page,pages);const rows=await col.find(filter,{session}).sort({createdAt:-1,_id:-1}).skip((page-1)*args.pageSize).limit(args.pageSize).toArray();const paidCount=await col.countDocuments({...scope,status:'PAID'},{session});result={items:rows.map(x=>x.value),page,pageSize:args.pageSize,total,pages,paidCount};},{readConcern:{level:'snapshot'}});return result;}finally{await session.endSession();}
 }
 async snapshot(){const session=this.client.startSession();let state;try{await transaction(session,async()=>{state=(await this.load(session)).state;},{readConcern:{level:'snapshot'}});return state;}finally{await session.endSession();}}
 async restore(state){
  if(!this.db.databaseName.startsWith('pet_shop_restore_'))throw Error('RESTORE_REQUIRES_NEW_pet_shop_restore_DATABASE');
  if(!state||state.version!==1||!Array.isArray(state.products)||!Array.isArray(state.orders)||!state.addresses||!state.keys||!state.events)throw Error('INVALID_BACKUP');
  const session=this.client.startSession();try{await transaction(session,async()=>{const before=await this.load(session);if(before.meta.revision!==0)throw Error('RESTORE_TARGET_NOT_EMPTY');await this.persist(before.state,state,before.meta,session,{id:'system'},'restore');});}finally{await session.endSession();}
 }
 async close(){await this.client.close();}
}
module.exports={MongoStore};
