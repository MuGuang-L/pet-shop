const api=require('../../services/api');
const studio=require('../../lib/studio');
const categories=['全部','主粮','零食','玩具','清洁','用品'];
const labels={PENDING:'待付款',PAID:'待发货',SHIPPED:'已发货',COMPLETED:'已完成',CANCELLED:'已取消',EXPIRED:'已超时',REFUND_REQUESTED:'待审核售后',REFUNDING:'退款处理中',REFUNDED:'已退款'};
const money=n=>(n/100).toFixed(2);
const picture=p=>p.image||'/assets/'+(['food','toy','care'].includes(p.id||p.productId)?(p.id||p.productId)+'-v2':'empty-v2')+'.jpg';
const decorate=p=>({...p,gallery:studio.productImages(p).length?studio.productImages(p):[picture(p)],petText:studio.petOf(p),displayImage:picture(p),displayName:p.name.replace('样例 · ',''),priceText:money(p.skus[0].price),skus:p.skus.map(k=>({...k,priceText:money(k.price)}))});
const order=o=>({...o,totalText:money(o.total),shippingText:money(o.shippingFee),fulfillmentText:o.fulfillment?.type==='PICKUP'?'到店自提':'商家外送',isPickup:o.fulfillment?.type==='PICKUP',statusText:(o.status.startsWith('REFUND')&&o.refund&&studio.afterStages[o.refund.stage])||studio.fulfillmentLabel(o)||labels[o.status],refund:o.refund?{...o.refund,amountText:money(o.refund.amount??o.total),stageText:studio.afterStages[o.refund.stage],timeline:(o.refund.timeline||[]).map(t=>({...t,timeText:new Date(t.at).toLocaleString()}))}:null});
Page({
 data:{deliveryMode:'DELIVERY',pickupContact:{name:'',phone:''},pickupStore:studio.pickupStore,addressEditing:false,fulfillmentFilter:'ALL',fulfillmentOptions:[{id:'ALL',name:'全部订单'},{id:'PICKUP',name:'到店自提'},{id:'DELIVERY',name:'商家外送'}],redeemCode:'',afterForm:{},receiptItems:[],afterTypes:['退货退款','仅退款'],orderQuery:'',orderStatus:'ALL',orderPageNumber:1,orderPages:1,orderTotal:0,orderStatusOptions:[{id:'ALL',name:'全部状态'},...Object.entries(labels).map(([id,name])=>({id,name})),{id:'AFTERSALE',name:'全部售后'}],orderStatusIndex:0,pet:'全部',petOptions:['全部','猫咪','狗狗'],productPets:studio.pets,homeContent:studio.homeDefaults,homeEditor:null,homeFields:[{key:'headline',label:'首页大标题',max:24},{key:'subtitle',label:'首页副标题',max:40},{key:'featuredTitle',label:'精选栏目标题',max:18},{key:'featuredIntro',label:'精选栏目说明',max:60},{key:'newTitle',label:'上新栏目标题',max:18}],assets:studio.assets,templates:studio.templates,storeSlots:studio.slots,storefront:studio.defaults,imageTarget:'',storeEditor:null,mode:api.mode,tab:'catalog',categories,productCategories:categories.slice(1),category:'全部',search:'',products:[],cart:[],addresses:[],orders:[],merchant:false,busy:false,addressForm:{},editor:null,shipment:{number:'',note:''}},
 onLoad(){this.setData({cart:wx.getStorageSync('pet-cart')||[]});this.refresh();},
 async run(fn){if(this.data.busy)return;this.setData({busy:true});try{await fn();}catch(e){wx.showModal({title:'操作未完成',content:e.message||String(e),showCancel:false});}finally{this.setData({busy:false});}},
 async refresh(){try{const products=await api.call('catalog');const addresses=await api.call('addresses');const identity=await api.call('identity');this.setData({products:products.map(decorate),addresses,merchant:identity.merchant,storefront:await api.call('storefront'),homeContent:await api.call('homeContent'),...studio.homeProducts(products.map(decorate))});this.filter();this.cartTotal();}catch(e){wx.showToast({title:e.message,icon:'none'});}},
 filter(){this.setData({visible:this.data.products.filter(p=>studio.matches(p,this.data.pet)&&(this.data.category==='全部'||p.category===this.data.category)&&p.name.toLowerCase().includes(this.data.search.trim().toLowerCase()))});},
 searchProducts(e){this.setData({search:e.detail.value});this.filter();},
 category(e){this.setData({category:e.currentTarget.dataset.value});this.filter();},
 goPet(e){this.setData({tab:'category',pet:e.currentTarget.dataset.value,category:'全部',search:''});this.filter();},
 browseCategory(e){this.setData({tab:'category',pet:'全部',search:'',category:e.currentTarget.dataset.value});this.filter();},
 tab(e){this.setData({tab:e.currentTarget.dataset.tab,detail:null,selectedOrder:null});this.run(async()=>{await this.refresh();if(this.data.tab==='orders')await this.loadOrderPage();if(this.data.tab==='merchant'&&this.data.merchant)await this.loadMerchant();});},
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
 async loadOrderPage(){const merchant=this.data.tab==='merchant';const p=await api.call(merchant?'merchantOrdersPage':'ordersPage',{page:this.data.orderPageNumber,q:this.data.orderQuery,status:this.data.orderStatus,fulfillment:this.data.fulfillmentFilter});this.setData({[merchant?'merchantOrders':'orders']:p.items.map(order),orderPageNumber:p.page,orderPages:p.pages,orderTotal:p.total});},
 cartTotal(){const cart=this.data.cart.map(l=>({...l,displayImage:picture(l),priceText:money(l.price)}));wx.setStorageSync('pet-cart',cart);this.setData({cart,cartTotal:money(cart.reduce((sum,l)=>sum+l.price*l.qty,0))});},
 qty(e){const i=Number(e.currentTarget.dataset.i),delta=Number(e.currentTarget.dataset.delta);const cart=this.data.cart.map(x=>({...x})),line=cart[i];const qty=line.qty+delta;const product=this.data.products.find(p=>p.id===line.productId),sku=product&&product.skus.find(k=>k.id===line.skuId);if(delta>0&&!this.validCartQty(qty,sku))return;line.qty=qty;this.setData({cart:cart.filter(x=>x.qty>0)});this.cartTotal();this.checkoutKey=null;},
 newAddress(){this.setData({addressForm:{},addressEditing:true});},
 closeAddress(){this.setData({addressEditing:false});},
 deliveryMode(e){this.setData({deliveryMode:e.currentTarget.dataset.value});this.checkoutKey=null;},
 pickupField(e){this.setData({['pickupContact.'+e.currentTarget.dataset.key]:e.detail.value});this.checkoutKey=null;},
 redeemField(e){this.setData({redeemCode:e.detail.value});},
 fulfillmentFilter(e){this.run(async()=>{this.setData({fulfillmentFilter:e.currentTarget.dataset.value,orderPageNumber:1});await this.loadOrderPage();});},
 fulfillmentOrders(e){this.run(async()=>{this.setData({tab:'orders',fulfillmentFilter:e.currentTarget.dataset.value,orderStatus:'ALL',orderStatusIndex:0,orderPageNumber:1,orderQuery:''});await this.loadOrderPage();});},
 field(e){this.setData({['addressForm.'+e.currentTarget.dataset.key]:e.detail.value});},
 editAddress(e){this.setData({addressEditing:true,addressForm:{...this.data.addresses[Number(e.currentTarget.dataset.i)]}});},
 saveAddress(){this.run(async()=>{await api.call('saveAddress',this.data.addressForm);this.setData({addressForm:{},addressEditing:false});await this.refresh();});},
 deleteAddress(e){this.run(async()=>{await api.call('deleteAddress',{id:e.currentTarget.dataset.id});await this.refresh();});},
 pickAddress(e){this.setData({addressIndex:Number(e.detail.value)});this.checkoutKey=null;},
 checkout(){this.run(async()=>{const a=this.data.addresses[this.data.addressIndex||0];if(this.data.deliveryMode==='DELIVERY'&&!a)throw Error('请先在地址页保存收货地址');this.checkoutKey=this.checkoutKey||'checkout-'+Date.now()+'-'+Math.random().toString(36).slice(2);const o=await api.call('createOrder',{key:this.checkoutKey,addressId:this.data.deliveryMode==='DELIVERY'?a.id:undefined,fulfillment:this.data.deliveryMode,contact:this.data.pickupContact,lines:this.data.cart.map(l=>({productId:l.productId,skuId:l.skuId,qty:l.qty}))});this.checkoutKey=null;this.setData({cart:[],tab:'orders',selectedOrder:order(o),orderQuery:'',orderStatus:'ALL',orderStatusIndex:0,orderPageNumber:1});await this.loadOrderPage();this.cartTotal();});},
 showOrder(e){this.run(async()=>{const o=await api.call('order',{id:e.currentTarget.dataset.id});this.setData({selectedOrder:order(o),tracking:null,shipment:{number:'',note:''},redeemCode:'',afterForm:{type:o.status==='PAID'?'REFUND_ONLY':'RETURN_REFUND',reason:'',note:'',returnName:'模拟退货收件人',returnPhone:'13800000000',returnAddress:'模拟省模拟市测试仓库 1 号（请勿实际寄件）',company:'',number:'',receiptNote:'',receiptConfirmed:false,waiveReturn:false,failReason:''},receiptItems:o.lines.map(l=>({...l,receivedQty:0,restockQty:0}))});});},
 afterField(e){this.setData({['afterForm.'+e.currentTarget.dataset.key]:e.detail.value});},
 afterType(e){this.setData({'afterForm.type':Number(e.detail.value)===0?'RETURN_REFUND':'REFUND_ONLY'});},
 receiptField(e){this.setData({['receiptItems['+e.currentTarget.dataset.i+'].'+e.currentTarget.dataset.key]:e.detail.value===''?null:Number(e.detail.value)});},
 action(e){const action=e.currentTarget.dataset.action;this.run(async()=>{const f=this.data.afterForm||{},input={id:this.data.selectedOrder.id,caseId:this.data.selectedOrder.refund&&this.data.selectedOrder.refund.caseId};
 if(action==='refundRequest')Object.assign(input,{reason:f.reason,type:f.type});
 if(action==='refundReview')Object.assign(input,{approve:e.currentTarget.dataset.approve===true,note:f.note,waiveReturn:f.waiveReturn,returnAddress:{name:f.returnName,phone:f.returnPhone,detail:f.returnAddress}});
 if(action==='returnShip')Object.assign(input,{company:f.company,number:f.number});
 if(action==='returnInspect')Object.assign(input,{items:this.data.receiptItems,note:f.receiptNote,confirm:f.receiptConfirmed});
 if(action==='refundFail')input.reason=f.failReason;
 if(action==='pickupRedeem')input.code=this.data.redeemCode;
 const o=await api.call(action,input);this.setData({selectedOrder:order(o)});if(this.data.tab==='orders')await this.loadOrderPage();if(this.data.merchant)await this.loadMerchant();});},
 tracking(){this.run(async()=>this.setData({tracking:await api.call('tracking',{id:this.data.selectedOrder.id})}));},
 demoRole(e){this.run(async()=>{api.setDemoMerchant(e.detail.value);await this.refresh();if(this.data.merchant)await this.loadMerchant();});},
 async loadMerchant(){this.setData({merchantProducts:(await api.call('merchantProducts')).map(decorate)});await this.loadOrderPage();},
 newProduct(){this.setData({editor:this.prepareEditor(studio.create())});},
 prepareEditor(p){return {...p,image:p.image||studio.productImages(p)[0]||'',images:studio.productImages(p),petScope:studio.petOf(p),featured:studio.featuredOf(p),pickNote:p.pickNote||'',skus:p.skus.map(k=>({...k,priceYuan:money(k.price)}))};},
 chooseTemplate(e){const apply=()=>this.setData({editor:this.prepareEditor(studio.create(e.currentTarget.dataset.id))});if(this.data.editor.name.trim())wx.showModal({title:'更换模板',content:'更换会重置当前未保存的商品内容，是否继续？',success:r=>{if(r.confirm)apply();}});else apply();},
 editProduct(e){this.setData({editor:this.prepareEditor(JSON.parse(JSON.stringify(this.data.merchantProducts.find(p=>p.id===e.currentTarget.dataset.id))))});},
 duplicateProduct(e){const p=JSON.parse(JSON.stringify(this.data.merchantProducts.find(p=>p.id===e.currentTarget.dataset.id)));delete p.id;p.name+='（副本）';p.active=false;p.skus=p.skus.map((k,i)=>({...k,id:'sku-'+Date.now()+'-'+i,stock:0}));this.setData({editor:this.prepareEditor(p)});},
 openHome(){this.setData({homeEditor:JSON.parse(JSON.stringify(this.data.homeContent))});},
 closeHome(){this.setData({homeEditor:null});},
 homeField(e){this.setData({['homeEditor.'+e.currentTarget.dataset.key]:e.detail.value});},
 sceneField(e){const {i,key}=e.currentTarget.dataset;this.setData({['homeEditor.scenes['+i+'].'+key]:key==='category'?this.data.productCategories[Number(e.detail.value)]:key==='image'?studio.assets[Number(e.detail.value)].id:e.detail.value});},
 saveHome(){this.run(async()=>{await api.call('saveHomeContent',this.data.homeEditor);this.setData({homeEditor:null});await this.refresh();wx.showToast({title:'首页内容已更新'});});},
 productPet(e){this.setData({'editor.petScope':studio.pets[Number(e.detail.value)]});},
 featured(e){this.setData({'editor.featured':e.detail.value});},
 openStore(){this.setData({storeEditor:{...this.data.storefront}});},
 closeStore(){this.setData({storeEditor:null,imageTarget:''});},
 saveStore(){this.run(async()=>{const settings=await api.call('saveStorefront',this.data.storeEditor);this.setData({storefront:settings,storeEditor:null});wx.showToast({title:'店铺图片已更新'});});},
 chooseImage(e){const target=e.currentTarget.dataset.target||'product';this.setData({imageTarget:target,availableAssets:studio.images(target)});},
 closeImages(){this.setData({imageTarget:''});},
 pickImage(e){const src=e.currentTarget.dataset.src,target=this.data.imageTarget;if(target==='product'&&this.data.editor){try{this.setProductImage(src);}catch(e){wx.showToast({title:e.message,icon:'none'});return;}}else if(this.data.storeEditor)this.setData({['storeEditor.'+target]:src});this.closeImages();},
 setProductImage(src){const p=studio.withImage(this.data.editor,src);this.setData({'editor.image':p.image,'editor.images':p.images});},
 coverPhoto(e){this.setProductImage(this.data.editor.images[Number(e.currentTarget.dataset.i)]);},
 removePhoto(e){const p=studio.withoutImage(this.data.editor,Number(e.currentTarget.dataset.i));this.setData({'editor.image':p.image,'editor.images':p.images});},
 uploadImage(){const target=this.data.imageTarget;this.photo(target);},
 productField(e){const key=e.currentTarget.dataset.key;this.setData({['editor.'+key]:e.detail.value});},
 productCategory(e){this.setData({'editor.category':categories[Number(e.detail.value)+1]});},
 active(e){this.setData({'editor.active':e.detail.value});},
 skuField(e){const {i,key}=e.currentTarget.dataset;this.setData({['editor.skus['+i+'].'+key]:key==='name'||key==='priceYuan'?e.detail.value:Number(e.detail.value)});},
 addSku(){if(this.data.editor.skus.length>=20){wx.showToast({title:'最多添加 20 个规格',icon:'none'});return;}this.setData({'editor.skus':this.data.editor.skus.concat({id:'sku-'+Date.now(),name:'新规格',price:1000,priceYuan:'10.00',stock:0})});},
 saveProduct(){this.run(async()=>{const p=this.data.editor;if(!p.name.trim())throw Error('请填写商品名称');const skus=p.skus.map(k=>{if(!k.name.trim())throw Error('请填写每个规格的名称');if(!Number.isInteger(k.stock)||k.stock<0||k.stock>100000)throw Error('库存请填写 0～100000 的整数');return {...k,price:studio.cents(k.priceYuan)};});await api.call('saveProduct',{...p,skus});this.setData({editor:null});await this.loadMerchant();await this.refresh();});},
 photo(target='product'){if(typeof target!=='string')target='product';const editorRef=target==='product'?this.data.editor:this.data.storeEditor;wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera'],success:r=>{if(!editorRef||(target==='product'?this.data.editor:this.data.storeEditor)!==editorRef)return;this.run(async()=>{const f=r.tempFiles[0];if(!f)throw Error('未获取到图片，请重试');if(f.size>2*1024*1024)throw Error('图片须小于 2MB');const src=await api.upload(f.tempFilePath);if((target==='product'?this.data.editor:this.data.storeEditor)!==editorRef)return;if(target==='product')this.setProductImage(src);else this.setData({['storeEditor.'+target]:src});this.setData({imageTarget:''});});},fail:r=>{if(r&&/cancel/i.test(r.errMsg||''))return;wx.showToast({title:'图片选择失败，请重试',icon:'none'});}});},
 shipment(e){this.setData({['shipment.'+e.currentTarget.dataset.key]:e.detail.value});},
 ship(){this.run(async()=>{const o=await api.call('ship',{id:this.data.selectedOrder.id,...this.data.shipment});this.setData({selectedOrder:order(o)});await this.loadMerchant();});}
});
