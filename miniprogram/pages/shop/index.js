const api=require('../../services/api');
const checkout=require('../../services/checkout');
const studio=require('../../lib/studio');
const categories=['全部','主粮','零食','玩具','清洁','用品'];
const labels={PENDING:'待付款',PAID:'待发货',SHIPPED:'已发货',COMPLETED:'已完成',CANCELLED:'已取消',EXPIRED:'已超时',REFUND_REQUESTED:'待审核售后',REFUNDING:'退款处理中',REFUNDED:'已退款'};
const money=n=>(n/100).toFixed(2);
const picture=p=>p.image||'/assets/'+(['food','toy','care'].includes(p.id||p.productId)?(p.id||p.productId)+'-v2':'empty-v2')+'.jpg';
const decorate=p=>({...p,gallery:studio.productImages(p).length?studio.productImages(p):[picture(p)],petText:studio.petOf(p),displayImage:picture(p),displayName:p.name.replace('样例 · ',''),priceText:money(p.skus[0].price),skus:p.skus.map(k=>({...k,priceText:money(k.price)}))});
const order=o=>({...o,totalText:money(o.total),shippingText:money(o.shippingFee),fulfillmentText:o.fulfillment?.type==='PICKUP'?'到店自提':'商家外送',isPickup:o.fulfillment?.type==='PICKUP',statusText:(o.status.startsWith('REFUND')&&o.refund&&studio.afterStages[o.refund.stage])||studio.fulfillmentLabel(o)||labels[o.status],refund:o.refund?{...o.refund,amountText:money(o.refund.amount??o.total),stageText:studio.afterStages[o.refund.stage],timeline:(o.refund.timeline||[]).map(t=>({...t,timeText:new Date(t.at).toLocaleString()}))}:null});
Page({
 data:{shopSettings:null,pickupEnabled:true,deliveryEnabled:true,canOrder:true,shippingText:'8.00',cartAmountText:'0.00',shopNotice:'',loginRequired:false,loginForm:{username:'',password:''},deliveryMode:'DELIVERY',pickupContact:{name:'',phone:''},pickupStore:studio.pickupStore,addressEditing:false,fulfillmentFilter:'ALL',fulfillmentOptions:[{id:'ALL',name:'全部订单'},{id:'PICKUP',name:'到店自提'},{id:'DELIVERY',name:'商家外送'}],redeemCode:'',afterForm:{},receiptItems:[],afterTypes:['退货退款','仅退款'],orderQuery:'',orderStatus:'ALL',orderPageNumber:1,orderPages:1,orderTotal:0,orderStatusOptions:[{id:'ALL',name:'全部状态'},...Object.entries(labels).map(([id,name])=>({id,name})),{id:'AFTERSALE',name:'全部售后'}],orderStatusIndex:0,pet:'全部',petOptions:['全部','猫咪','狗狗'],productPets:studio.pets,homeContent:studio.homeDefaults,homeEditor:null,homeFields:[{key:'headline',label:'首页大标题',max:24},{key:'subtitle',label:'首页副标题',max:40},{key:'featuredTitle',label:'精选栏目标题',max:18},{key:'featuredIntro',label:'精选栏目说明',max:60},{key:'newTitle',label:'上新栏目标题',max:18}],assets:studio.assets,templates:studio.templates,storeSlots:studio.slots,storefront:studio.defaults,imageTarget:'',storeEditor:null,mode:api.mode,tab:'catalog',categories,productCategories:categories.slice(1),category:'全部',search:'',products:[],cart:[],addresses:[],orders:[],merchant:false,busy:false,addressForm:{},editor:null,shipment:{number:'',note:''}},
 onLoad(){this.setData({cart:wx.getStorageSync('pet-cart')||[]});if(api.hasSession())this.run(async()=>{await this.refresh();const scope=api.checkoutScope();if(checkout.read(scope))await this.finishPendingCheckout(scope);});else this.setData({loginRequired:true});},
 loginField(e){this.setData({['loginForm.'+e.currentTarget.dataset.key]:e.detail.value});},
 login(){this.run(async()=>{await api.login(this.data.loginForm.username,this.data.loginForm.password);this.setData({cart:wx.getStorageSync('pet-cart')||[],loginRequired:false,loginForm:{username:'',password:''}});await this.refresh();const scope=api.checkoutScope();if(checkout.read(scope))await this.finishPendingCheckout(scope);});},
 logout(){this.run(async()=>{await api.logout();this.setData({loginRequired:true,cart:[],addresses:[],orders:[],selectedOrder:null,tab:'catalog'});});},
 async run(fn){if(this.data.busy)return;this.setData({busy:true});try{await fn();}catch(e){if(e.message==='AUTH_REQUIRED')this.setData({loginRequired:true});wx.showModal({title:'操作未完成',content:e.message||String(e),showCancel:false});}finally{this.setData({busy:false});}},
 async refresh(){try{const settings=await api.call('shopSettings');const products=await api.call('catalog');const addresses=await api.call('addresses');const identity=await api.call('identity');this.setData({shopSettings:settings,pickupStore:settings.pickupStore,pickupEnabled:settings.pickup.enabled,deliveryEnabled:settings.delivery.enabled,canOrder:settings.canOrder,shopNotice:settings.canOrder?'':settings.acceptingOrders?'当前不在接单时间内':'门店暂停接单',products:products.map(decorate),addresses,merchant:identity.merchant,storefront:await api.call('storefront'),homeContent:await api.call('homeContent'),...studio.homeProducts(products.map(decorate))});this.filter();this.cartTotal();}catch(e){if(e.message==='AUTH_REQUIRED')this.setData({loginRequired:true});wx.showToast({title:e.message,icon:'none'});}},
 filter(){this.setData({visible:this.data.products.filter(p=>studio.matches(p,this.data.pet)&&(this.data.category==='全部'||p.category===this.data.category)&&p.name.toLowerCase().includes(this.data.search.trim().toLowerCase()))});},
 searchProducts(e){this.setData({search:e.detail.value});this.filter();},
 category(e){this.setData({category:e.currentTarget.dataset.value});this.filter();},
 goPet(e){this.setData({tab:'category',pet:e.currentTarget.dataset.value,category:'全部',search:''});this.filter();},
 browseCategory(e){this.setData({tab:'category',pet:'全部',search:'',category:e.currentTarget.dataset.value});this.filter();},
 tab(e){if(!['catalog','category','cart','account','orders','addresses'].includes(e.currentTarget.dataset.tab))return;this.setData({tab:e.currentTarget.dataset.tab,detail:null,selectedOrder:null});this.run(async()=>{await this.refresh();if(this.data.tab==='orders')await this.loadOrderPage();});},
 detail(e){const p=this.data.products.find(p=>p.id===e.currentTarget.dataset.id);this.setData({detail:p,skuIndex:0,detailQty:1});},
 spec(e){this.setData({skuIndex:Number(e.detail.value)});},
 close(){this.setData({detail:null,selectedOrder:null,editor:null});},
 add(){const p=this.data.detail,k=p.skus[this.data.skuIndex];const cart=this.data.cart.map(l=>({...l})),old=cart.find(l=>l.skuId===k.id&&l.productId===p.id);const qty=(old?old.qty:0)+this.data.detailQty;if(!this.validCartQty(qty,k))return false;if(old)old.qty=qty;else cart.push({productId:p.id,skuId:k.id,name:p.name,spec:k.name,price:k.price,image:p.image,qty});this.checkoutKey=null;this.setData({cart,detail:null});this.cartTotal();wx.showToast({title:'已加入购物车'});return true;},
 validCartQty(qty,sku){const message=!Number.isInteger(qty)||qty<1||qty>99?'每种规格请选择 1～99 件':!sku?'商品已下架或规格不可用':qty>sku.stock?'所选规格库存不足':'';if(message)wx.showModal({title:'操作未完成',content:message,showCancel:false});return !message;},
 detailQty(e){this.setData({detailQty:Math.max(1,Math.min(99,this.data.detailQty+Number(e.currentTarget.dataset.delta)))});},
 buy(){if(this.add())this.setData({tab:'cart'});},
 orderFilter(e){this.run(async()=>{const status=e.currentTarget.dataset.status;this.setData({tab:'orders',fulfillmentFilter:'ALL',orderStatus:status,orderStatusIndex:this.data.orderStatusOptions.findIndex(x=>x.id===status),orderQuery:'',orderPageNumber:1});await this.loadOrderPage();});},
 orderQueryField(e){this.setData({orderQuery:e.detail.value});},
 orderStatusField(e){const i=Number(e.detail.value);this.setData({orderStatusIndex:i,orderStatus:this.data.orderStatusOptions[i].id});},
 searchOrders(){this.run(async()=>{this.setData({orderPageNumber:1});await this.loadOrderPage();});},
 turnOrderPage(e){this.run(async()=>{this.setData({orderPageNumber:Math.max(1,Math.min(this.data.orderPages,this.data.orderPageNumber+Number(e.currentTarget.dataset.delta)))});await this.loadOrderPage();});},
 async loadOrderPage(){const merchant=false;const p=await api.call('ordersPage',{page:this.data.orderPageNumber,q:this.data.orderQuery,status:this.data.orderStatus,fulfillment:this.data.fulfillmentFilter});this.setData({[merchant?'merchantOrders':'orders']:p.items.map(order),orderPageNumber:p.page,orderPages:p.pages,orderTotal:p.total});},
 cartTotal(){const cart=this.data.cart.map(l=>({...l,displayImage:picture(l),priceText:money(l.price)}));wx.setStorageSync('pet-cart',cart);const subtotal=cart.reduce((sum,l)=>sum+l.price*l.qty,0),d=this.data.shopSettings?.delivery;const fee=this.data.deliveryMode==='PICKUP'?0:d?(d.freeAbove!==null&&subtotal>=d.freeAbove?0:d.fee):800;this.setData({cart,cartTotal:money(subtotal),shippingText:money(fee),cartAmountText:money(subtotal+fee)});},
 qty(e){const i=Number(e.currentTarget.dataset.i),delta=Number(e.currentTarget.dataset.delta);const cart=this.data.cart.map(x=>({...x})),line=cart[i];const qty=line.qty+delta;const product=this.data.products.find(p=>p.id===line.productId),sku=product&&product.skus.find(k=>k.id===line.skuId);if(delta>0&&!this.validCartQty(qty,sku))return;line.qty=qty;this.setData({cart:cart.filter(x=>x.qty>0)});this.cartTotal();this.checkoutKey=null;},
 newAddress(){this.setData({addressForm:{requestKey:'address-'+Date.now()+'-'+Math.random().toString(36).slice(2)},addressEditing:true});},
 closeAddress(){this.setData({addressEditing:false});},
 deliveryMode(e){this.setData({deliveryMode:e.currentTarget.dataset.value});this.checkoutKey=null;this.cartTotal();},
 pickupField(e){this.setData({['pickupContact.'+e.currentTarget.dataset.key]:e.detail.value});this.checkoutKey=null;},
 redeemField(e){this.setData({redeemCode:e.detail.value});},
 fulfillmentFilter(e){this.run(async()=>{this.setData({fulfillmentFilter:e.currentTarget.dataset.value,orderPageNumber:1});await this.loadOrderPage();});},
 fulfillmentOrders(e){this.run(async()=>{this.setData({tab:'orders',fulfillmentFilter:e.currentTarget.dataset.value,orderStatus:'ALL',orderStatusIndex:0,orderPageNumber:1,orderQuery:''});await this.loadOrderPage();});},
 field(e){this.setData({['addressForm.'+e.currentTarget.dataset.key]:e.detail.value});},
 editAddress(e){this.setData({addressEditing:true,addressForm:{...this.data.addresses[Number(e.currentTarget.dataset.i)]}});},
 saveAddress(){this.run(async()=>{await api.call('saveAddress',this.data.addressForm);this.setData({addressForm:{},addressEditing:false});await this.refresh();});},
 deleteAddress(e){this.run(async()=>{await api.call('deleteAddress',{id:e.currentTarget.dataset.id});await this.refresh();});},
 pickAddress(e){this.setData({addressIndex:Number(e.detail.value)});this.checkoutKey=null;},
 checkout(){this.run(async()=>{
  const scope=api.checkoutScope();const pending=checkout.read(scope);
  const a=this.data.addresses[this.data.addressIndex||0];if(!pending&&this.data.deliveryMode==='DELIVERY'&&!a)throw Error('请先在地址页保存收货地址');
  if(!pending){
    const input={addressId:this.data.deliveryMode==='DELIVERY'?a.id:undefined,fulfillment:this.data.deliveryMode,contact:this.data.pickupContact,lines:this.data.cart.map(l=>({productId:l.productId,skuId:l.skuId,qty:l.qty}))};
    const q=await api.call('quoteOrder',input);
    const confirmed=await new Promise(resolve=>wx.showModal({title:'确认订单',content:(q.fulfillment==='PICKUP'?'到店自提：'+q.pickupStore.name+'，'+q.pickupStore.detail+'，'+q.pickupStore.hours:'商家外送：'+a.detail+'。'+q.delivery.area)+'。商品 ¥'+money(q.subtotal)+'，外送费 ¥'+money(q.shippingFee)+'，合计 ¥'+money(q.total)+'。',confirmText:'提交订单',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));
    if(!confirmed)return;
    this.checkoutKey='checkout-'+Date.now()+'-'+Math.random().toString(36).slice(2);this.pendingCheckout={...input,key:this.checkoutKey,settingsRevision:q.settingsRevision,expectedTotal:q.total};
    checkout.write(scope,{input:this.pendingCheckout});
  }
  await this.finishPendingCheckout(scope);
 });},
 async finishPendingCheckout(scope){
  const completed=await checkout.submit(scope,api.call,this.data.cart);
  this.checkoutKey=null;this.pendingCheckout=null;this.setData({cart:completed.cart,tab:'orders',selectedOrder:order(completed.order),orderQuery:'',orderStatus:'ALL',orderStatusIndex:0,orderPageNumber:1});this.cartTotal();await this.loadOrderPage();
 },
 showOrder(e){this.run(async()=>{const o=await api.call('order',{id:e.currentTarget.dataset.id});this.setData({selectedOrder:order(o),tracking:null,shipment:{number:'',note:''},redeemCode:'',afterForm:{type:o.status==='PAID'?'REFUND_ONLY':'RETURN_REFUND',reason:'',note:'',returnName:'模拟退货收件人',returnPhone:'13800000000',returnAddress:'模拟省模拟市测试仓库 1 号（请勿实际寄件）',company:'',number:'',receiptNote:'',receiptConfirmed:false,waiveReturn:false,failReason:''},receiptItems:o.lines.map(l=>({...l,receivedQty:0,restockQty:0}))});});},
 afterField(e){this.setData({['afterForm.'+e.currentTarget.dataset.key]:e.detail.value});},
 afterType(e){this.setData({'afterForm.type':Number(e.detail.value)===0?'RETURN_REFUND':'REFUND_ONLY'});},
 receiptField(e){this.setData({['receiptItems['+e.currentTarget.dataset.i+'].'+e.currentTarget.dataset.key]:e.detail.value===''?null:Number(e.detail.value)});},
 action(e){const action=e.currentTarget.dataset.action;this.run(async()=>{if(!['mockPay','payment','cancel','confirmReceipt','refundRequest','refundWithdraw','returnShip'].includes(action))throw Error('此操作请在商家网页处理');const f=this.data.afterForm||{},input={id:this.data.selectedOrder.id,caseId:this.data.selectedOrder.refund?.caseId};if(action==='refundRequest')Object.assign(input,{reason:f.reason,type:f.type});if(action==='returnShip')Object.assign(input,{company:f.company,number:f.number});const o=await api.call(action,input);this.setData({selectedOrder:order(o)});if(this.data.tab==='orders')await this.loadOrderPage();});},
 tracking(){this.run(async()=>this.setData({tracking:await api.call('tracking',{id:this.data.selectedOrder.id})}));},
});
