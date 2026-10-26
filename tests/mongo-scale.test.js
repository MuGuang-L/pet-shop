'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {MongoStore}=require('../server/mongo-store'),{EXPIRY_BATCH}=require('../server/mongo-scope');
const enabled=process.env.PET_MONGO_TEST==='1',buyer={id:'scale-buyer'},merchant={id:'scale-owner',merchant:true};
const contact={name:'模拟买家',phone:'13800000000',detail:'模拟街道 1 号'},options={mock:true,now:1000};
const orderInput=key=>({key,fulfillment:'PICKUP',contact,lines:[{productId:'food',skuId:'food-1',qty:1}]});
const hash=s=>createHash('sha256').update(s).digest('hex');
async function fixture(fn){
 const database='pet_shop_test_scale_'+Date.now()+'_'+Math.random().toString(36).slice(2),store=await MongoStore.connect({database,monitorCommands:true});
 try{await fn(store,database);}finally{assert.match(database,/^pet_shop_test_scale_/);await store.db.dropDatabase();await store.close();}
}
function observe(store){
 const rows={},commands=[];
 const onStart=e=>{if(e.databaseName===store.db.databaseName)commands.push(e.command);};
 const onDone=e=>{const cursor=e.reply?.cursor;if(!cursor||!cursor.ns.startsWith(store.db.databaseName+'.'))return;const name=cursor.ns.split('.').slice(1).join('.');rows[name]=(rows[name]||0)+(cursor.firstBatch||cursor.nextBatch||[]).length;};
 store.client.on('commandStarted',onStart);store.client.on('commandSucceeded',onDone);
 return {rows,commands,stop(){store.client.off('commandStarted',onStart);store.client.off('commandSucceeded',onDone);}};
}
async function historicalData(store,count=2000){
 const product=(await store.snapshot()).products[0],line={productId:'food',skuId:'food-1',qty:1,name:product.name,spec:product.skus[0].name,price:3900,image:''};
 const orders=[],keys=[],addresses=[],movements=[];
 for(let i=0;i<count;i++){
  const id='historical-'+i,value={id,userId:'history-user-'+i,status:'COMPLETED',createdAt:i,updatedAt:i,expiresAt:i,lines:[line],released:false,fulfillment:{type:'PICKUP',code:'100000'},refund:null,total:3900,subtotal:3900,shippingFee:0,address:contact};
  orders.push({_id:id,userId:value.userId,status:value.status,createdAt:i,expiresAt:i,position:i,value});
  const key=JSON.stringify([value.userId,'history-key-'+i]);keys.push({_id:hash(key),key,value:{id,fingerprint:'historical'}});
  addresses.push({_id:value.userId,value:[{...contact,id:'a-history-'+i}]});
  movements.push({_id:'history-move-'+i,position:i,value:{id:'history-move-'+i,productId:'food',skuId:'food-1',at:i,type:'RECEIVE',delta:1}});
 }
 for(const [name,docs] of [['orders',orders],['idempotency_keys',keys],['address_books',addresses],['stock_movements',movements]])await store.db.collection(name).insertMany(docs);
 const products=Array.from({length:120},(_,i)=>({_id:'history-product-'+i,position:i+3,value:{...product,id:'history-product-'+i}}));await store.db.collection('products').insertMany(products);
 return {orders,keys,addresses,movements,products};
}
test('历史规模：超过 500 订单和 100 商品仍可经营，日常请求不读取历史全集且旧记录不变',{skip:!enabled},async t=>fixture(async store=>{
 const baseline=await historicalData(store),before=await store.snapshot();
 const trace=observe(store);let order,product;
 try{
  order=await store.execute(buyer,'createOrder',orderInput('scale-new-order'),options);
  assert.equal((await store.execute(buyer,'createOrder',orderInput('scale-new-order'),options)).id,order.id);
  product=await store.execute(merchant,'saveProduct',{name:'超过百件后的新增商品',category:'用品',active:true,skus:[{id:'new-one',name:'标准款',price:1000,stock:5}],requestKey:'scale-new-product'},options);
  await store.execute(merchant,'saveProduct',{...product,name:'修改新商品名称'},options);
  await store.execute(merchant,'adjustStock',{productId:product.id,skuId:'new-one',revision:1,type:'RECEIVE',quantity:2,reason:'模拟采购',requestKey:'scale-stock-key'},options);
  await store.execute(buyer,'saveAddress',{...contact,requestKey:'scale-address-key'},options);
  await store.execute(buyer,'cancel',{id:order.id},options);
 }finally{trace.stop();}
 for(const name of ['products','orders','address_books','idempotency_keys','stock_movements'])assert.ok((trace.rows[name]||0)<40,`${name} unexpectedly returned ${trace.rows[name]} records`);
 assert.equal(trace.rows.payment_events||0,0);assert.ok(trace.commands.some(c=>c.find==='orders'));
 t.diagnostic('Seven operations, returned database rows: '+JSON.stringify(trace.rows));
 const after=await store.snapshot();
 assert.deepEqual(after.orders.slice(0,baseline.orders.length),before.orders);
 assert.deepEqual(after.products.slice(1,before.products.length),before.products.slice(1));
 assert.deepEqual(after.products[0],{...before.products[0],revision:before.products[0].revision+2});
 assert.deepEqual(after.stockMovements.slice(0,before.stockMovements.length),before.stockMovements);
 for(const [key,value] of Object.entries(before.keys))assert.deepEqual(after.keys[key],value);
 for(const [key,value] of Object.entries(before.addresses))assert.deepEqual(after.addresses[key],value);
 assert.equal(after.products.at(-1).skus[0].stock,7);assert.equal(after.orders.at(-1).status,'CANCELLED');
 assert.equal((await store.execute(merchant,'merchantOrdersPage',{page:2,pageSize:50},options)).total,2001);
 assert.equal((await store.execute(buyer,'ordersPage',{},options)).total,1);
 const expiryPlan=await store.db.collection('orders').find({status:'PENDING',expiresAt:{$lte:1000}}).sort({expiresAt:1,_id:1}).limit(EXPIRY_BATCH).explain('executionStats');
 assert.ok(expiryPlan.executionStats.totalDocsExamined<10,'expiry lookup must not scan completed history');
 const pagePlan=await store.db.collection('orders').find({}).sort({createdAt:-1,_id:-1}).limit(50).explain('executionStats');
 assert.equal(pagePlan.executionStats.totalDocsExamined,50,'first merchant page must not sort the entire history');
 // Backup must traverse every batch even though daily writes use scoped reads.
 const backup=await store.backupSnapshot();assert.deepEqual(backup.state,after);
 assert.equal(backup.state.orders.length,2001);assert.equal(backup.state.stockMovements.length,2002);
 const restore=await MongoStore.connect({database:'pet_shop_restore_scale_'+Date.now()});
 try{await restore.restoreSnapshot({...backup,backupId:'scale-test'});assert.deepEqual(await restore.snapshot(),after);assert.equal(await restore.db.collection('audit_log').countDocuments(),backup.audit.length+1);}
 finally{await restore.db.dropDatabase();await restore.close();}
}));
test('跨订单退货：局部事务仍计入其他订单预留，失败不入账，取消后容量准确',{skip:!enabled},async()=>fixture(async store=>{
 const address=await store.execute(buyer,'saveAddress',contact,options);
 let o=await store.execute(buyer,'createOrder',{...orderInput('return-capacity-order'),fulfillment:'DELIVERY',addressId:address.id},options);
 await store.execute(buyer,'mockPay',{id:o.id},options);await store.execute(merchant,'ship',{id:o.id,note:'模拟送出'},options);
 o=await store.execute(buyer,'refundRequest',{id:o.id,type:'RETURN_REFUND',reason:'模拟退货'},options);const ref={id:o.id,caseId:o.refund.caseId};
 await store.execute(merchant,'refundReview',{...ref,approve:true,note:'同意退回',returnAddress:contact},options);
 await store.execute(buyer,'returnShip',{...ref,company:'模拟快递',number:'RETURN1234'},options);
 const pending=await store.execute({id:'different-buyer'},'createOrder',orderInput('other-capacity-order'),options);
 let p=(await store.execute(merchant,'merchantProducts',{},options))[0];p.skus[0].stock=99999;await store.execute(merchant,'saveProduct',p,options);
 const inspect={...ref,confirm:true,note:'完好可售',items:[{productId:'food',skuId:'food-1',receivedQty:1,restockQty:1}]},before=await store.snapshot();
 await assert.rejects(store.execute(merchant,'returnInspect',inspect,options),/上限/);assert.deepEqual(await store.snapshot(),before);
 p=(await store.execute(merchant,'merchantProducts',{},options))[0];p.skus[0].stock=99998;await store.execute(merchant,'saveProduct',p,options);
 await store.execute(merchant,'returnInspect',inspect,options);await store.execute(merchant,'returnInspect',inspect,options);
 await store.execute(merchant,'mockRefund',ref,options);await store.execute({id:'different-buyer'},'cancel',{id:pending.id},options);
 assert.equal((await store.execute(buyer,'catalog',{},options))[0].skus[0].stock,100000);
 assert.equal(await store.db.collection('stock_movements').countDocuments({'value.type':'RETURN_INSPECTION'}),1);
}));
test('库存聚合：未加载的其他订单仍预留容量并保护规格，已完成订单不占预留',{skip:!enabled},async()=>fixture(async store=>{
 await historicalData(store,600);
 const order=await store.execute(buyer,'createOrder',orderInput('reserved-other-order'),options);
 let p=(await store.execute(merchant,'merchantProducts',{},options))[0];
 await assert.rejects(store.execute(merchant,'adjustStock',{productId:p.id,skuId:'food-1',revision:p.revision,type:'COUNT',quantity:100000,reason:'容量验证',requestKey:'reserved-count-key'},options),/STOCK_CAPACITY_EXCEEDED/);
 await assert.rejects(store.execute(merchant,'saveProduct',{...p,skus:p.skus.slice(1)},options),/RESERVED_SKU_CANNOT_REMOVE/);
 p.skus[0].stock=99999;await store.execute(merchant,'saveProduct',p,options);
 await store.execute(buyer,'cancel',{id:order.id},options);
 assert.equal((await store.execute(buyer,'catalog',{},options))[0].skus[0].stock,100000);
 const plan=await store.db.collection('orders').find({'value.lines.productId':'food','value.released':{$ne:true},status:{$in:['PENDING','PAID']}}).explain('executionStats');
 assert.equal(plan.executionStats.totalDocsExamined,0);
}));
test('超时批次：每次最多关闭 100 条，指定的过期单仍不能支付，重复批次不二次回补',{skip:!enabled},async()=>fixture(async store=>{
 const template=(await store.execute(buyer,'createOrder',orderInput('expiry-template'),options));
 await store.execute(buyer,'cancel',{id:template.id},options);
 const count=EXPIRY_BATCH*2+7,docs=Array.from({length:count},(_,i)=>{const id='due-'+String(i).padStart(4,'0'),value={...template,id,status:'PENDING',createdAt:i,expiresAt:500+i,released:false};return {_id:id,userId:buyer.id,status:'PENDING',createdAt:i,expiresAt:value.expiresAt,position:i+1,value};});
 await store.db.collection('orders').insertMany(docs);
 await store.db.collection('products').updateOne({_id:'food'},{$set:{'value.skus.0.stock':0}});
 const later={mock:true,now:5000};
 const trace=observe(store);try{await store.execute(merchant,'expire',{},later);}finally{trace.stop();}
 assert.equal(trace.rows.orders,EXPIRY_BATCH);assert.equal(await store.db.collection('orders').countDocuments({status:'EXPIRED'}),EXPIRY_BATCH);
 await assert.rejects(store.execute(buyer,'mockPay',{id:docs.at(-1)._id},later),/INVALID_STATE/);
 assert.equal(await store.db.collection('orders').countDocuments({status:'EXPIRED'}),EXPIRY_BATCH,'failed payment must leave no partial expiry writes');
 await store.execute(merchant,'expire',{},later);await store.execute(merchant,'expire',{},later);await store.execute(merchant,'expire',{},later);
 assert.equal(await store.db.collection('orders').countDocuments({status:'EXPIRED'}),count);
 assert.equal((await store.execute(buyer,'catalog',{},later))[0].skus[0].stock,count);
 assert.equal(await store.db.collection('orders').countDocuments({status:'PENDING'}),0);
}));
test('历史订单重试与读取：幂等键跨重连仍指向原订单，不创建新单或覆盖历史位置',{skip:!enabled},async()=>fixture(async(store,database)=>{
 const input=orderInput('archived-idempotency'),o=await store.execute(buyer,'createOrder',input,options);
 await store.execute(buyer,'mockPay',{id:o.id},options);await store.execute(merchant,'pickupReady',{id:o.id},options);await store.execute(merchant,'pickupRedeem',{id:o.id,code:o.fulfillment.code},options);
 const before=await store.db.collection('orders').findOne({_id:o.id});
 const second=await MongoStore.connect({database});try{
  assert.equal((await second.execute(buyer,'createOrder',input,options)).status,'COMPLETED');
  await assert.rejects(second.execute(buyer,'createOrder',{...input,lines:[{...input.lines[0],qty:2}]},options),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(second.execute({id:'another-buyer'},'order',{id:o.id},options),/FORBIDDEN/);
  assert.deepEqual(await second.db.collection('orders').findOne({_id:o.id}),before);
  assert.equal(await second.db.collection('orders').countDocuments(),1);
 }finally{await second.close();}
}));
