'use strict';
const studio = require('./studio');
const aftersales = require('./aftersales');
const shopSettings = require('./shop-settings');
function validImage(image,mock){const bundled=studio.assets.some(a=>a.src===image);need(image.length<=1024&&(!image||bundled||/^(cloud:\/\/|wxfile:\/\/|http:\/\/(tmp|usr|store)\/|\/uploads\/[a-f0-9-]+\.(png|jpg)$)/.test(image)),'IMAGE_PATH');need(mock===true||!image||bundled||image.startsWith('cloud://'),'CLOUD_IMAGE_REQUIRED');return image;}
const clone = x => JSON.parse(JSON.stringify(x));
const fail = (code) => { throw new Error(code); };
const need = (yes, code) => { if (!yes) fail(code); };
function seed() {
  return {version:1, sequence:0, products:[
    {id:'food',name:'样例 · 鲜肉猫粮',category:'主粮',description:'虚构样例商品，用于流程验收。正式销售前填写配料、适用年龄、保质期及生产信息。',image:'',active:true,skus:[{id:'food-1',name:'1kg 体验装',price:3900,stock:20},{id:'food-2',name:'2kg 家庭装',price:7200,stock:10}]},
    {id:'toy',name:'样例 · 绳结玩具',category:'玩具',description:'虚构样例。适用于互动玩耍，规格与材质仅用于演示。',image:'',active:true,skus:[{id:'toy-1',name:'薄荷绿 / M',price:1900,stock:30}]},
    {id:'care',name:'样例 · 宠物梳',category:'清洁',description:'虚构样例。正式商品请填写材质、尺寸和使用注意事项。',image:'',active:true,skus:[{id:'care-1',name:'标准款',price:2900,stock:15}]}
  ],orders:[],stockMovements:[],addresses:{},keys:{},events:{},shippingFee:800};
}
function address(a) { need(a && typeof a.name==='string' && a.name.trim().length>0 && a.name.length<=40,'ADDRESS_NAME'); need(/^1\d{10}$/.test(a.phone),'ADDRESS_PHONE'); need(typeof a.detail==='string' && a.detail.trim().length>=5 && a.detail.length<=200,'ADDRESS_DETAIL'); return {name:a.name.trim(),phone:a.phone,detail:a.detail.trim()}; }
function release(s,o) { if(o.released) return; for(const line of o.lines) { const p=s.products.find(p=>p.id===line.productId); const sku=p&&p.skus.find(k=>k.id===line.skuId); need(sku,'RESERVED_SKU_MISSING'); sku.stock+=line.qty; } o.released=true; }
function expire(s,now) { for(const o of s.orders) if(o.status==='PENDING' && o.expiresAt<=now) { release(s,o); o.status='EXPIRED'; o.updatedAt=now; } }
// Internal settlement contract only. Never expose as a client action. The future
// gateway must verify/decrypt the provider notification and bind app/merchant first.
function settleVerifiedPayment(state,p,now=Date.now()) {
  const s=clone(state);expire(s,now);
  need(p&&typeof p.eventId==='string'&&p.eventId.length>0&&typeof p.transactionId==='string'&&p.transactionId.length>0,'PAYMENT_EVENT_REQUIRED');
  const o=s.orders.find(o=>o.id===p.orderId);need(o,'ORDER_NOT_FOUND');
  need(p.currency==='CNY'&&p.amount===o.total&&Number.isSafeInteger(p.amount),'PAYMENT_AMOUNT_MISMATCH');
  const key=JSON.stringify(['payment',p.eventId]);
  const fingerprint=JSON.stringify([p.orderId,p.transactionId,p.amount,p.currency]);
  if(s.events[key]){need(s.events[key]===fingerprint,'PAYMENT_EVENT_CONFLICT');return {state:s,result:clone(o)};}
  need(!s.orders.some(x=>x.id!==o.id&&x.payment&&x.payment.transactionId===p.transactionId),'TRANSACTION_REUSED');
  if(o.payment){need(o.payment.transactionId===p.transactionId,'PAYMENT_CONFLICT');s.events[key]=fingerprint;return {state:s,result:clone(o)};}
  need(['PENDING','CANCELLED','EXPIRED'].includes(o.status),'INVALID_STATE');
  o.payment={provider:'WECHAT',transactionId:p.transactionId,amount:p.amount};
  if(o.status==='PENDING')o.status='PAID';else {o.refund={status:'PROCESSING',previous:o.status,reason:'关闭后到账，待真实退款补偿',latePayment:true};o.status='REFUNDING';}
  o.updatedAt=now;s.events[key]=fingerprint;return {state:s,result:clone(o)};
}
function orderQuery(input={}){const page=input.page??1,pageSize=input.pageSize??10,q=input.q??'',status=input.status??'ALL';need(Number.isInteger(page)&&page>=1&&page<=100000,'INVALID_PAGE');need(Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=50,'INVALID_PAGE_SIZE');need(typeof q==='string'&&q.length<=80,'INVALID_SEARCH');need(['ALL','AFTERSALE','PENDING','PAID','SHIPPED','COMPLETED','CANCELLED','EXPIRED','REFUND_REQUESTED','REFUNDING','REFUNDED'].includes(status),'INVALID_STATUS');const fulfillment=input.fulfillment||'ALL';need(['ALL','PICKUP','DELIVERY'].includes(fulfillment),'INVALID_FULFILLMENT');return {page,pageSize,q:q.trim().toLowerCase(),status,fulfillment};}
function orderPage(orders,input){const args=orderQuery(input);const filtered=orders.filter(o=>(args.fulfillment==='ALL'||(o.fulfillment?.type||'DELIVERY')===args.fulfillment)&&(args.status==='ALL'||(args.status==='AFTERSALE'?o.status.startsWith('REFUND'):o.status===args.status))&&(!args.q||[o.id,...o.lines.map(l=>l.name)].some(v=>v.toLowerCase().includes(args.q)))).sort((a,b)=>b.createdAt-a.createdAt||b.id.localeCompare(a.id));const total=filtered.length,pages=Math.max(1,Math.ceil(total/args.pageSize)),page=Math.min(args.page,pages);return {items:filtered.slice((page-1)*args.pageSize,page*args.pageSize),page,pageSize:args.pageSize,total,pages,paidCount:orders.filter(o=>o.status==='PAID').length};}
function execute(state,actor,action,input={},options={}) {
  // Work on a copy: failed operations never partially reserve stock or write addresses.
  const s=clone(state), now=options.now===undefined?Date.now():options.now;
  need(actor && typeof actor.id==='string' && actor.id.length>0,'AUTH_REQUIRED');
  const merchant=()=>need(actor.merchant===true,'FORBIDDEN');
  expire(s,now);
  const owned=()=>{const o=s.orders.find(o=>o.id===input.id);need(o,'ORDER_NOT_FOUND');need(o.userId===actor.id || actor.merchant===true,'FORBIDDEN');return o;};
  if(aftersales.actions.has(action)){const result=aftersales.handle(s,actor,action,input,{...options,now},{release,address});return {state:s,result:clone(result)};}
  let result;
  switch(action) {
    case 'shopSettings': result=shopSettings.publicSettings(s,now);break;
    case 'saveShopSettings': merchant();result=shopSettings.save(s,input,now);break;
    case 'quoteOrder': result=shopSettings.quote(s,input,now);break;
    case 'storefront': result={...studio.defaults,...s.storefront};break;
    case 'saveStorefront': {merchant(); const next={...studio.defaults,...s.storefront};for(const slot of studio.slots){if(input[slot.key]!==undefined)next[slot.key]=validImage(String(input[slot.key]),options.mock)||studio.defaults[slot.key];}s.storefront=next;result=next;break;}
    case 'homeContent': result={...studio.homeDefaults,...s.homeContent};break;
    case 'saveHomeContent': {merchant();const next={...studio.homeDefaults,...s.homeContent};for(const [key,max] of Object.entries({headline:24,subtitle:40,featuredTitle:18,featuredIntro:60,newTitle:18})){if(input[key]!==undefined){need(typeof input[key]==='string'&&input[key].trim().length>0&&input[key].length<=max,'首页文案长度不正确');next[key]=input[key].trim();}}if(input.scenes!==undefined){need(Array.isArray(input.scenes)&&input.scenes.length===3,'请保留三个场景入口');next.scenes=input.scenes.map((item,i)=>{need(['主粮','零食','玩具','清洁','用品'].includes(item.category),'请选择有效分类');need(typeof item.title==='string'&&item.title.trim().length>0&&item.title.length<=18,'场景标题限 1～18 字');need(typeof item.text==='string'&&item.text.length<=40,'场景说明最多 40 字');need(studio.assets.some(a=>a.id===item.image),'请选择图库图片');return {key:studio.homeDefaults.scenes[i].key,category:item.category,title:item.title.trim(),text:item.text,image:item.image};});}s.homeContent=next;result=next;break;}
    case 'catalog': result=s.products.filter(p=>p.active); break;
    case 'identity': result={id:actor.id,merchant:actor.merchant===true,mode:options.mock?'mock':'cloud'};break;
    case 'addresses': result=s.addresses[actor.id]||[];break;
    case 'saveAddress': { const list=s.addresses[actor.id]||[]; const a=address(input); a.id=input.id||'a'+(++s.sequence); const i=list.findIndex(x=>x.id===a.id); if(input.id) need(i>=0,'ADDRESS_NOT_FOUND'); if(i>=0) list[i]=a;else {need(list.length<20,'ADDRESS_LIMIT');list.push(a);}s.addresses[actor.id]=list;result=a;break; }
    case 'deleteAddress': {const list=s.addresses[actor.id]||[];need(list.some(a=>a.id===input.id),'ADDRESS_NOT_FOUND');s.addresses[actor.id]=list.filter(a=>a.id!==input.id);result=true;break;}
    case 'createOrder': {
      need(typeof input.key==='string' && /^[a-zA-Z0-9_-]{8,80}$/.test(input.key),'IDEMPOTENCY_KEY_REQUIRED');
      need(Array.isArray(input.lines) && input.lines.length>0 && input.lines.length<=30,'INVALID_LINES');
      const normalized=input.lines.map(l=>({productId:l.productId,skuId:l.skuId,qty:l.qty}));
      const type=input.fulfillment||'DELIVERY';need(['PICKUP','DELIVERY'].includes(type),'请选择自提或商家外送');const fingerprint=type==='PICKUP'?JSON.stringify({lines:normalized,type,contact:input.contact}):JSON.stringify({lines:normalized,addressId:input.addressId});
      const key=JSON.stringify([actor.id,input.key]);
      if(s.keys[key]) {need(s.keys[key].fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT');result=s.orders.find(o=>o.id===s.keys[key].id);break;}
      const quote=shopSettings.quote(s,input,now);
      const a=type==='PICKUP'?address({...input.contact,detail:quote.pickupStore.detail}):(s.addresses[actor.id]||[]).find(a=>a.id===input.addressId);need(a,'ADDRESS_REQUIRED');
      const lines=[]; let subtotal=0; const seen=new Set();
      for(const l of normalized) {need(Number.isSafeInteger(l.qty)&&l.qty>0&&l.qty<=99,'INVALID_QUANTITY');need(!seen.has(l.productId+'|'+l.skuId),'DUPLICATE_SKU');seen.add(l.productId+'|'+l.skuId);const p=s.products.find(p=>p.id===l.productId&&p.active);need(p,'PRODUCT_UNAVAILABLE');const k=p.skus.find(k=>k.id===l.skuId);need(k,'SKU_NOT_FOUND');need(k.stock>=l.qty,'OUT_OF_STOCK');k.stock-=l.qty;subtotal+=k.price*l.qty;lines.push({...l,name:p.name,spec:k.name,price:k.price,image:p.image});}
      need(Number.isSafeInteger(subtotal)&&subtotal<=100000000,'AMOUNT_LIMIT');need(s.orders.length<500,'DEV_CAPACITY_LIMIT');
      const shippingFee=quote.shippingFee;const fulfillment={type,settingsRevision:quote.settingsRevision,instructions:quote.instructions};if(type==='DELIVERY')fulfillment.delivery=quote.delivery;if(type==='PICKUP'){fulfillment.store=clone(quote.pickupStore);let code;do{code=String(Math.floor(100000+Math.random()*900000));}while(s.orders.some(o=>o.fulfillment?.code===code));fulfillment.code=code;}
      result={fulfillment,id:'o'+(++s.sequence),userId:actor.id,lines,address:clone(a),subtotal,shippingFee,total:subtotal+shippingFee,status:'PENDING',createdAt:now,updatedAt:now,expiresAt:now+15*60*1000,released:false,refund:null,shipping:null};
      s.orders.push(result);s.keys[key]={fingerprint,id:result.id};break;
    }
    case 'ordersPage': result=orderPage(s.orders.filter(o=>o.userId===actor.id),input);break;
    case 'merchantOrdersPage': merchant();result=orderPage(s.orders,input);break;
    case 'orders': result=s.orders.filter(o=>o.userId===actor.id).reverse();break;
    case 'order':result=owned();result.refund=aftersales.normalized(result);break;
    case 'cancel': {const o=owned(); if(o.status==='CANCELLED'||o.status==='EXPIRED'){result=o;break;}need(o.status==='PENDING','INVALID_STATE');release(s,o);o.status='CANCELLED';o.updatedAt=now;result=o;break;}
    case 'payment': owned();fail('REAL_PAYMENT_NOT_CONFIGURED');break;
    case 'mockPay': {need(options.mock===true,'MOCK_DISABLED');const o=owned();need(o.userId===actor.id,'FORBIDDEN');if(o.status==='PAID'){result=o;break;}need(o.status==='PENDING','INVALID_STATE');o.status='PAID';o.payment={provider:'MOCK',transactionId:'mock-'+o.id,amount:o.total};o.updatedAt=now;result=o;break;}
    case 'confirmReceipt': {const o=owned();need(o.userId===actor.id,'FORBIDDEN');need(o.status==='SHIPPED','INVALID_STATE');o.status='COMPLETED';result=o;break;}
    case 'tracking': {const o=owned();result={mock:true,company:o.fulfillment?.type==='PICKUP'?'到店自提':'商家自行配送',number:o.shipping?.number,note:o.shipping?.note,events:o.shipping?[{time:o.shipping.at,text:'商家已登记送出'}]:[],notice:o.fulfillment?.type==='PICKUP'?'请在备货完成后凭提货码到店领取':'进度由商家登记，未接入实时位置或第三方物流轨迹'};break;}
    case 'merchantProducts':merchant();result=s.products;break;
    case 'merchantOrders':merchant();result=s.orders.slice().reverse();break;
    case 'saveProduct': {merchant();const p=input;need(typeof p.name==='string'&&p.name.trim().length>0&&p.name.length<=80,'PRODUCT_NAME');need(['主粮','零食','玩具','清洁','用品'].includes(p.category),'CATEGORY');need(Array.isArray(p.skus)&&p.skus.length>0&&p.skus.length<=20,'INVALID_SKUS');const ids=new Set();const skus=p.skus.map(k=>{need(typeof k.id==='string'&&/^[\w-]{1,60}$/.test(k.id)&&!ids.has(k.id),'SKU_ID');ids.add(k.id);need(typeof k.name==='string'&&k.name.length>0&&k.name.length<=80,'SKU_NAME');need(Number.isSafeInteger(k.price)&&k.price>0&&k.price<=10000000,'INVALID_PRICE');need(Number.isSafeInteger(k.stock)&&k.stock>=0&&k.stock<=100000,'INVALID_STOCK');return {id:k.id,name:k.name,price:k.price,stock:k.stock};});const old=s.products.find(x=>x.id===p.id);if(p.id)need(old,'PRODUCT_NOT_FOUND');if(old)for(const o of s.orders.filter(o=>!o.released&&!['REFUNDED','COMPLETED'].includes(o.status)))for(const l of o.lines.filter(l=>l.productId===old.id))need(ids.has(l.skuId),'RESERVED_SKU_CANNOT_REMOVE');let image=validImage(String(p.image||''),options.mock);const rawImages=p.images===undefined?(image?[image]:[]):p.images;need(Array.isArray(rawImages)&&rawImages.length<=6&&rawImages.every(x=>typeof x==='string'&&x.length>0),'商品图片最多 6 张');const images=[...new Set(rawImages.map(x=>validImage(x,options.mock)))];if(images.length)image=images[0];const petScope=p.petScope||studio.petOf(old||p);need(studio.pets.includes(petScope),'请选择适用宠物');need(typeof (p.pickNote||'')==='string'&&(p.pickNote||'').length<=80,'推荐语最多 80 字');result={id:old?old.id:'p'+(++s.sequence),name:p.name.trim(),category:p.category,petScope,featured:p.featured===undefined?studio.featuredOf(old||p):p.featured===true,pickNote:p.pickNote||'',description:String(p.description||'').slice(0,2000),image,images,active:p.active===true,skus};if(old)s.products[s.products.indexOf(old)]=result;else {need(s.products.length<100,'DEV_CAPACITY_LIMIT');s.products.push(result);}break;}
    case 'pickupReady': {merchant();const o=owned();need(o.fulfillment?.type==='PICKUP','仅自提订单可以备货');need(o.status==='PAID','INVALID_STATE');if(!o.fulfillment.readyAt)o.fulfillment.readyAt=now;o.updatedAt=now;result=o;break;}
    case 'pickupRedeem': {merchant();const o=owned();need(o.fulfillment?.type==='PICKUP','仅自提订单可以核销');need(input.code===o.fulfillment.code,'提货码不正确，请核对买家出示的号码');if(o.status==='COMPLETED'){result=o;break;}need(o.status==='PAID'&&o.fulfillment.readyAt,'请先完成备货');o.fulfillment.redeemedAt=now;o.status='COMPLETED';o.updatedAt=now;result=o;break;}
    case 'ship': {merchant();const o=owned();need(o.fulfillment?.type!=='PICKUP','自提订单请使用到店核销');const number=String(input.number||'').trim(),note=String(input.note||'').trim();need(!number||/^[A-Za-z0-9-]{3,40}$/.test(number),'配送单号请填写 3～40 位字母、数字或横线');need(note.length<=200,'配送备注最多 200 字');need(number||note,'请填写配送单号或配送备注');if(o.status==='SHIPPED'){need(o.shipping.number===number&&(o.shipping.note||'')===note,'配送信息已提交，请勿重复覆盖');result=o;break;}need(o.status==='PAID','INVALID_STATE');o.shipping={company:'商家自行配送',number,note,at:now};o.status='SHIPPED';o.updatedAt=now;result=o;break;}
    case 'expire':merchant();result={ok:true};break;
    default:fail('UNKNOWN_ACTION');
  }
  return {state:s,result:clone(result)};
}
module.exports={seed,execute,expire,settleVerifiedPayment,orderQuery,orderPage};
