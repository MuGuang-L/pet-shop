'use strict';
const {randomInt}=require('node:crypto');
const aftersales=require('../cloudfunctions/shop/aftersales');
const fulfillment=require('../cloudfunctions/shop/fulfillment');
const EXPIRY_BATCH=100;
const orderActions=new Set(['order','cancel','payment','mockPay','confirmReceipt','tracking','ship','pickupReady','pickupRedeem',...aftersales.actions,...fulfillment.actions]);
const activePickup=['PENDING','PAID','REFUND_REQUESTED','REFUNDING'];
const strings=values=>[...new Set(values.filter(v=>typeof v==='string'&&v.length<=100))];
function requestKey(actor,action,input){
 if(action==='createOrder')return JSON.stringify([actor.id,input.key]);
 if(['saveProduct','saveAddress'].includes(action)&&!input.id&&input.requestKey!==undefined)return JSON.stringify(['create',action,actor.id,input.requestKey]);
 if(action==='adjustStock')return JSON.stringify(['inventory',actor.id,input.requestKey]);
 if(fulfillment.actions.has(action))return JSON.stringify(['fulfillment',actor.id,input.requestKey]);
 return null;
}
function stateFrom(meta,docs){return {...meta.value,
 products:docs.products.map(d=>d.value),orders:docs.orders.map(d=>d.value),stockMovements:docs.stock_movements.map(d=>d.value),
 addresses:Object.fromEntries(docs.address_books.map(d=>[d._id,d.value])),keys:Object.fromEntries(docs.idempotency_keys.map(d=>[d.key,d.value])),events:Object.fromEntries(docs.payment_events.map(d=>[d.key,d.value]))};}
async function loadScope(store,session,actor,action,input,options,hash){
 const db=store.db,meta=await db.collection('shop_meta').findOne({_id:'settings'},{session});
 if(!meta)throw Error('DATABASE_NOT_INITIALIZED');
 const docs={products:[],orders:[],address_books:[],idempotency_keys:[],payment_events:[],stock_movements:[]},now=options.now??Date.now();
 const key=requestKey(actor,action,input);
 if(key){const row=await db.collection('idempotency_keys').findOne({_id:hash(key)},{session});if(row)docs.idempotency_keys.push(row);}
 // A request and each timer tick expire at most one batch. The exact requested
 // order is also loaded, so an expired order can never be paid between batches.
 const due=await store.read('orders').find({status:'PENDING',expiresAt:{$lte:now}},{session}).sort({expiresAt:1,_id:1}).limit(EXPIRY_BATCH).toArray();
 const ids=strings([...(orderActions.has(action)?[input.id]:[]),...docs.idempotency_keys.map(d=>action==='createOrder'?d.value.id:null)]);
 let requested=[];
 if(action==='orders'||action==='merchantOrders'){
  if(action==='merchantOrders'&&actor.merchant!==true)throw Error('FORBIDDEN');
  // Compatibility for legacy clients; current clients use ordersPage.
  requested=await store.read('orders').find(action==='orders'?{userId:actor.id}:{},{session}).sort({position:1,_id:1}).toArray();
 }else if(ids.length)requested=await store.read('orders').find({_id:{$in:ids}},{session}).toArray();
 docs.orders=[...new Map([...due,...requested].map(d=>[d._id,d])).values()].sort((a,b)=>a.position-b.position||a._id.localeCompare(b._id));
 const productIds=strings([...docs.orders.flatMap(d=>d.value.lines.map(l=>l.productId)),...(Array.isArray(input.lines)?input.lines.map(l=>l?.productId):[]),action==='saveProduct'?input.id:null,action==='adjustStock'?input.productId:null]);
 const allProducts=['catalog','merchantProducts'].includes(action);
 if(allProducts||productIds.length)docs.products=await store.read('products').find(allProducts?{}:{_id:{$in:productIds}},{session}).sort({position:1,_id:1}).toArray();
 if(['addresses','saveAddress','deleteAddress','createOrder'].includes(action)){
  const row=await db.collection('address_books').findOne({_id:actor.id},{session});if(row)docs.address_books.push(row);
 }
 const context={};
 if(['saveProduct','adjustStock','returnInspect','mockRefund'].includes(action)&&productIds.length){
  // Aggregate only outstanding reservations for the affected products. Loaded
  // orders are excluded; the domain adds their current in-transaction values.
  const match={'value.lines.productId':{$in:productIds},'value.released':{$ne:true},_id:{$nin:docs.orders.map(d=>d._id)}};
  const reserved=await store.read('orders').aggregate([
   {$match:{...match,$or:[{status:{$in:['PENDING','PAID']}},{status:{$in:['REFUND_REQUESTED','REFUNDING','REFUNDED']},'value.refund.previous':'PAID'}]}},
   {$unwind:'$value.lines'},{$match:{'value.lines.productId':{$in:productIds}}},
   {$group:{_id:{productId:'$value.lines.productId',skuId:'$value.lines.skuId'},quantity:{$sum:'$value.lines.qty'}}}
  ],{session}).toArray();
  context.reservations=Object.fromEntries(reserved.map(r=>[JSON.stringify([r._id.productId,r._id.skuId]),r.quantity]));
  if(action==='saveProduct'&&typeof input.id==='string'){
   const protectedRows=await store.read('orders').aggregate([
    {$match:{...match,status:{$nin:['REFUNDED','COMPLETED']}}},{$unwind:'$value.lines'},
    {$match:{'value.lines.productId':input.id}},{$group:{_id:'$value.lines.skuId'}}
   ],{session}).toArray();context.protectedSkus=protectedRows.map(r=>r._id);
  }
 }
 if(action==='createOrder'&&input.fulfillment==='PICKUP'&&!docs.idempotency_keys.length){
  for(let attempt=0;attempt<20;attempt++){
   const code=String(randomInt(100000,1000000));
   if(!await db.collection('orders').findOne({'value.fulfillment.code':code,status:{$in:activePickup}},{session,projection:{_id:1}})){context.pickupCode=code;break;}
  }
  if(!context.pickupCode)throw Error('PICKUP_CODE_UNAVAILABLE');
 }
 return {state:stateFrom(meta,docs),meta,docs,context};
}
module.exports={loadScope,stateFrom,EXPIRY_BATCH};
