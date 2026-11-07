const api=require('../../services/api');
const logisticsPlugin=require('../../services/logistics-plugin');
const checkout=require('../../services/checkout');
const orderDisplay=require('../../services/order-display');
const studio=require('../../lib/studio');
const shopSettings=require('../../lib/shop-settings.js');
function slotGroups(slots){const groups=[];for(const slot of slots){const date=slot.at==null?'尽快取餐':slot.label.slice(0,5);const time=slot.at==null?(slot.label.includes('·')?slot.label.split('·').pop().trim():'按备餐时间'):slot.label.slice(6);const group=groups.find(item=>item.date===date)||groups[groups.push({date,times:[],slots:[]})-1];group.times.push(time);group.slots.push(slot);}return groups;}
function pickupState(slots,selectedAt){const list=slots.length?slots:[{label:'尽快取餐',at:null}];const groups=slotGroups(list);let dateIndex=0,timeIndex=0;groups.forEach((group,index)=>{const found=group.slots.findIndex(slot=>(slot.at??null)===(selectedAt??null));if(found>=0){dateIndex=index;timeIndex=found;}});const slot=groups[dateIndex].slots[timeIndex];return {pickupSlots:list,pickupLabels:list.map(item=>item.label),pickupDates:groups.map(group=>group.date),pickupTimes:groups[dateIndex].times,pickupRange:[groups.map(group=>group.date),groups[dateIndex].times],pickupColumnIndex:[dateIndex,timeIndex],pickupSlotIndex:Math.max(0,list.findIndex(item=>(item.at??null)===(slot.at??null))),pickupLabel:slot.label};}
function buyerSlots(settings){if(Array.isArray(settings?.pickupSlots)&&settings.pickupSlots.length>1)return settings.pickupSlots;try{return shopSettings.pickupSlots(settings,Date.now());}catch(e){return [{label:'尽快取餐',at:null}];}}
const categories=['全部','主粮','零食','玩具','清洁','用品'];
const labels={PENDING:'待付款',PAID:'待发货',SHIPPED:'已发货',COMPLETED:'已完成',CANCELLED:'已取消',EXPIRED:'已超时',REFUND_REQUESTED:'待审核售后',REFUNDING:'退款处理中',REFUNDED:'已退款'};
const money=n=>(n/100).toFixed(2);
const picture=p=>p.image||'/assets/'+(['food','toy','care'].includes(p.id||p.productId)?(p.id||p.productId)+'-v2':'empty-v2')+'.jpg';
const decorate=(p,isMember=false)=>{const skus=p.skus.map(k=>({...k,stockTracked:studio.tracksStock(p),...studio.priceFor(k,isMember),priceText:money(studio.priceFor(k,isMember).price),regularPriceText:money(studio.priceFor(k,isMember).regularPrice),memberPriceText:money(studio.priceFor(k,isMember).memberPrice)}));return {...p,stockTracked:studio.tracksStock(p),gallery:studio.productImages(p).length?studio.productImages(p):[picture(p)],petText:studio.isCoffee(p)?'堂食 / 自提':studio.petOf(p),displayImage:picture(p),displayName:p.name.replace('样例 · ',''),priceMin:Math.min(...skus.map(k=>k.price))+(p.optionGroups||[]).reduce((sum,g)=>sum+Math.min(...g.options.map(o=>o.extraPrice??0)),0),priceText:money(Math.min(...skus.map(k=>k.price))+(p.optionGroups||[]).reduce((sum,g)=>sum+Math.min(...g.options.map(o=>o.extraPrice??0)),0)),priceFrom:!!p.optionGroups?.length,priceType:isMember?'MEMBER':'REGULAR',skus};};
const formatTime=value=>{if(!value)return '—';const d=new Date(value);if(Number.isNaN(d.getTime()))return '—';const pad=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());};
function paymentClock(o,now=Date.now()){if(o.status!=='PENDING')return {remainingText:'',payExpired:false};const end=Number(o.expiresAt),seconds=Number.isFinite(end)?Math.max(0,Math.ceil((end-now)/1000)):null;return {remainingText:seconds===null?'请查看付款截止时间':seconds===0?'付款时间已到，请刷新订单':String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0'),payExpired:seconds===0};}
function nextStep(o){if(o.kind==='RECHARGE'&&o.status==='COMPLETED')return '充值已到账，去会员中心查看余额与流水吧。';const stages={REQUESTED:'申请已提交，请等待商家审核；如不再需要，可撤回申请。',WAIT_RETURN:'商家已同意退货，请先核对退货地址，再寄出并填写运单。',RETURN_TRANSIT:'已提交退货物流，请等待商家收货验收。',WAIT_REFUND:o.payment?.provider==='WECHAT'?'退款处理中，请稍后刷新；如长时间未完成，可联系商家重试。':(o.payment?.provider==='MOCK'?'已进入退款记录处理，请等待商家操作。':'已进入退款处理，请等待商家操作。'),REFUND_FAILED:'退款处理未完成，请联系商家处理后刷新查看。',SUCCEEDED:'售后已完成，可在下方查看处理记录。',REJECTED:'申请被拒绝，请查看审核意见，必要时联系商家。',WITHDRAWN:'申请已撤回；仍有问题时可重新申请售后。'};if(o.refund&&stages[o.refund.stage]&&!['REJECTED','WITHDRAWN'].includes(o.refund.stage))return stages[o.refund.stage];if(o.fulfillment?.issue?.status==='OPEN'&&['PAID','SHIPPED'].includes(o.status)){const issue=o.fulfillment.issue;return (studio.issueLabels[issue.type]||'履约待处理')+'：'+issue.note+(issue.nextAt?'。约定处理时间：'+formatTime(issue.nextAt):'。请联系商家确认后续安排。');}if(o.status==='PENDING')return '请在截止时间前完成付款；不需要时可取消订单。';if(o.status==='PAID')return studio.isInStore(o)?(o.fulfillment.readyAt?(o.fulfillment?.type==='DINE_IN'?'餐品已备好，请出示订单取餐。':'商品已备好，请按门店营业时间出示订单领取。'):(o.fulfillment?.type==='DINE_IN'?'已立即取单，门店正在备餐，请在订单中查看取餐进度。':'门店正在备货，请等到可提货后再到店。')):'商家正在备货，发货后可在这里查看快递公司、单号及物流。';if(o.status==='SHIPPED')return '商家已登记发货，请查看快递轨迹；收到并核对商品后再确认收货。';if(o.status==='COMPLETED')return '订单已完成，如有商品问题可查看下方售后入口。';if(['CANCELLED','EXPIRED'].includes(o.status))return '订单已关闭，无需付款；需要商品时请重新选购。';return '请刷新订单查看最新处理进度。';}
function issueInfo(o){const f=o.fulfillment||{},issue=f.issue;if(!issue)return null;return {...issue,title:(studio.issueLabels[issue.type]||'履约处理').replace('待处理',''),statusText:issue.status==='OPEN'?'处理中':'已处理',nextText:issue.nextAt?formatTime(issue.nextAt):'',timeline:[...(f.issueHistory||[]),issue].reduce((all,x)=>all.concat((x.timeline||[]).map((t,i)=>({...t,key:x.id+'-'+i,timeText:formatTime(t.at),nextText:t.nextAt?formatTime(t.nextAt):''}))),[])};}
function paymentNotice(o){if(o.payment?.provider==='BALANCE')return '本单使用会员余额支付，商品退款退回会员余额。';if(o.kind==='RECHARGE'&&o.status==='COMPLETED')return '充值已到账，可在会员中心查看余额与流水。';if(o.payment?.provider==='WECHAT')return '本单使用微信支付，付款与退款涉及真实资金。';if(o.payment?.provider==='MOCK')return '本单为未扣款，不产生真实扣款或退款。';if(o.status==='PENDING')return api.mode==='cloud'?'确认微信支付后将实际扣款，请核对金额。':'当前使用免扣款操作，不产生真实扣款。';return '本单尚无已付款记录。';}
function refundNotice(o){if(o.kind==='RECHARGE')return '申请整笔充值退款。商家审核时需扣回本笔到账余额（含赠送），可用余额不足请先联系商家。商家同意后自动发起原渠道退款。';if(o.payment?.provider==='BALANCE')return '整单退款含原运费，审核通过并完成退款后退回会员余额。';return o.payment?.provider==='WECHAT'?'整单退款含原运费，商家同意后自动发起退款，通过微信原路退回。':'整单退款记录含原运费，不涉及真实资金。';}
function refundStageLabel(o){const stage=o.refund?.stage;if(o.payment?.provider==='WECHAT'){if(stage==='WAIT_REFUND')return '待微信退款';if(stage==='REFUND_FAILED')return '微信退款待重试';}return studio.afterStages[stage];}
const order=o=>({...o,deliveryTimeline:orderDisplay.timeline(o).map(e=>({...e,timeText:e.time?formatTime(e.time):''})),primaryAction:orderDisplay.primary(o),pickupTimeText:o.fulfillment?.pickupAt?formatTime(o.fulfillment.pickupAt).slice(0,16):'立即取单',paymentNotice:paymentNotice(o),refundNotice:refundNotice(o),issueInfo:issueInfo(o),...paymentClock(o),nextStep:nextStep(o),itemCount:o.lines.reduce((n,l)=>n+l.qty,0),createdText:formatTime(o.createdAt),expiresText:formatTime(o.expiresAt),updatedText:formatTime(o.updatedAt),subtotalText:money(o.subtotal??o.lines.reduce((n,l)=>n+l.price*l.qty,0)),amountLabel:o.status==='PENDING'?'待付金额':o.payment?.provider==='WECHAT'?'已支付金额':o.payment?.provider==='MOCK'?'订单金额':'订单金额',lines:o.lines.map(l=>({...l,lineKey:studio.lineKey(l),displayImage:picture(l),unitText:money(l.price),lineTotalText:money(l.price*l.qty)})),totalText:money(o.total),shippingText:money(o.shippingFee),fulfillmentText:studio.fulfillmentName(o),isDineIn:o.fulfillment?.type==='DINE_IN',isPickup:studio.isInStore(o),statusText:(o.status.startsWith('REFUND')&&o.refund&&refundStageLabel(o))||studio.fulfillmentLabel(o)||labels[o.status],refund:o.refund?{...o.refund,...(o.refund.inspection?{inspection:{...o.refund.inspection,items:o.refund.inspection.items.map(item=>({...item,lineKey:item.lineKey||JSON.stringify([item.productId,item.skuId])}))}}:{}),amountText:money(o.refund.amount??o.total),stageText:refundStageLabel(o),timeline:(o.refund.timeline||[]).map(t=>({...t,timeText:new Date(t.at).toLocaleString()}))}:null});
function reconcileCart(lines,products){return lines.map(line=>{
 const p=products.find(p=>p.id===line.productId),sku=p&&p.skus.find(s=>s.id===line.skuId),unavailable=!p||p.active===false||!sku;
 let invalid=unavailable?'商品已下架或规格已失效':!Number.isInteger(line.qty)||line.qty<1||line.qty>99?'请选择1～99件':studio.tracksStock(p)&&sku.stock<line.qty?'库存不足，当前可售 '+sku.stock+' 件':'';
 let choices,pricing;try{if(sku){choices=studio.resolveOptions(p,line.selections);pricing=studio.priceWithOptions(sku,sku.priceType==='MEMBER',choices);}}catch(error){invalid=error.message;}
 return {...line,...(sku?{name:p.name,spec:sku.name,...(pricing||{price:sku.price}),...(choices?{selections:choices.selections,optionsText:choices.text}:{}),image:p.image}:{}),invalid};
});}

Page({
 feedbackEpoch:0,
 data:{detailSelections:[],detailOptionGroups:[],detailPriceText:'0.00',detailMemberPriceText:'0.00',detailExtraText:'0.00',editingCartIndex:null,isMember:false,customRecharge:'',customRechargeActive:false,contactVisible:false,membershipVisible:false,member:null,boundPhone:'',phonePrompt:false,pendingPurchase:'',pickupSlotIndex:0,pickupSlots:[],pickupLabels:[],pickupDates:['尽快取餐'],pickupTimes:['按备餐时间'],pickupRange:[['尽快取餐'],['按备餐时间']],pickupColumnIndex:[0,0],pickupLabel:'尽快取餐',shopSection:"coffee",checkoutPickupOnly:false,catalogLoading:false,catalogLoaded:false,feedbackVisible:false,feedback:null,feedbackAnswers:[],feedbackSubmitted:false,feedbackLoading:false,feedbackError:'',simulationNotes:api.mode==='cloud'?['当前连接云端店铺，微信支付可能产生真实扣款，请在确认前核对商品和金额。','退款按订单原付款方式处理；支付失败时请先查看订单状态，避免重复付款。','地址和联系电话用于订单履约；查询快递时，服务端会向物流服务商提供运单号及校验所需收件手机号。']:studio.simulationNotes,dataNoticeOpen:false,shopSettings:null,storeGuide:null,pickupEnabled:false,deliveryEnabled:false,canOrder:false,shopNotice:'正在读取门店设置',supportVisible:false,supportSection:'',support:{phone:'',hours:'',name:'联系商家'},orderQuickOptions:[{id:'ALL',name:'全部'},{id:'PENDING',name:'待付款'},{id:'PAID',name:'备货中'},{id:'SHIPPED',name:'配送中'},{id:'COMPLETED',name:'已完成'},{id:'AFTERSALE',name:'售后'}],checkoutSource:'cart',quickLines:[],checkoutLines:[],selectedCount:0,allSelected:false,selectedAddress:null,sort:'default',sortOptions:['默认排序','价格从低到高','价格从高到低'],sortIndex:0,stockOnly:false,loadError:'',addressReturn:'account',addressIndex:0,cartCount:0,checkoutTotal:'0.00',shippingEstimate:'8.00',cartInvalid:false,loginRequired:false,loginForm:{username:'',password:''},deliveryMode:'DINE_IN',pickupContact:{name:'',phone:''},pickupStore:studio.pickupStore,addressEditing:false,fulfillmentFilter:'ALL',fulfillmentOptions:[{id:'ALL',name:'全部订单'},{id:'DINE_IN',name:'堂食'},{id:'PICKUP',name:'到店自提'},{id:'DELIVERY',name:'快递配送'}],redeemCode:'',afterForm:{},receiptItems:[],afterTypes:['退货退款','仅退款'],orderQuery:'',orderStatus:'ALL',orderPageNumber:1,orderPages:1,orderTotal:0,orderStatusOptions:[{id:'ALL',name:'全部状态'},...Object.entries(labels).map(([id,name])=>({id,name})),{id:'AFTERSALE',name:'全部售后'}],orderStatusIndex:0,pet:'全部',petOptions:['全部','猫咪','狗狗'],productPets:studio.pets,homeContent:studio.homeDefaults,homeEditor:null,homeFields:[{key:'headline',label:'首页大标题',max:24},{key:'subtitle',label:'首页副标题',max:40},{key:'featuredTitle',label:'精选栏目标题',max:18},{key:'featuredIntro',label:'精选栏目说明',max:60},{key:'newTitle',label:'上新栏目标题',max:18}],assets:studio.assets,templates:studio.templates,storeSlots:studio.slots,storefront:studio.defaults,imageTarget:'',storeEditor:null,mode:api.mode,tab:'catalog',categories:['全部','咖啡','饮品','烘焙'],productCategories:['咖啡','饮品','烘焙',...categories.slice(1)],category:'全部',search:'',products:[],cart:[],addresses:[],orders:[],merchant:false,busy:false,addressForm:{},editor:null,shipment:{number:'',note:''}},
 backOrders(){this.navigate({tab:'account',selectedOrder:null});},
 toggleDataNotice(){this.setData({dataNoticeOpen:!this.data.dataNoticeOpen});},
 navigate(values){this.setData(values,()=>wx.pageScrollTo({scrollTop:0,duration:0}));},
 onLoad(options={}){if(options.tab==='account')this.setData({tab:'account'});this.orderDetailEntry=!!options.order_id;this.orderEntrySection=options.section;this.pendingOrderTrade=Object.prototype.hasOwnProperty.call(options,'out_trade_no')?options.out_trade_no:null;this.pendingOrderId=Object.prototype.hasOwnProperty.call(options,'order_id')?options.order_id:null;this.startCountdown();if(api.getSupport)this.setData({support:api.getSupport()});this.setData({cart:wx.getStorageSync('pet-cart')||[]});if(api.hasSession())this.run(async()=>{await this.refresh();if(!this.data.loginRequired&&!this.data.loadError){if(!await this.openLinkedOrder())await this.recoverCheckout();}});else this.setData({loginRequired:true});},
 onShow(){const app=typeof getApp==='function'?getApp():null;const entry=app?.globalData?.orderEntry;if(app?.globalData?.homeEntry){app.globalData.homeEntry=false;this.pendingOrderTrade=null;this.pendingOrderId=null;this.orderDetailEntry=false;this.navigate({tab:'catalog',selectedOrder:null,detail:null,supportVisible:false});}if(entry){this.pendingOrderTrade=entry.outTradeNo;this.pendingOrderId=null;app.globalData.orderEntry=null;}if(api.hasSession())this.run(()=>this.refreshView());this.startCountdown();},
 onHide(){this.stopCountdown();},
 onUnload(){this.feedbackEpoch++;this.stopCountdown();},
 stopCountdown(){if(this.countdownTimer){clearInterval(this.countdownTimer);this.countdownTimer=null;}},
 startCountdown(){this.stopCountdown();this.tickCountdown();this.countdownTimer=setInterval(()=>this.tickCountdown(),1000);},
 tickCountdown(now=Date.now()){const updates={};const selected=this.data.selectedOrder;if(selected?.status==='PENDING'){Object.assign(updates,{'selectedOrder.remainingText':paymentClock(selected,now).remainingText,'selectedOrder.payExpired':paymentClock(selected,now).payExpired});if(paymentClock(selected,now).payExpired&&!this.data.busy&&this.expirySyncId!==selected.id){this.expirySyncId=selected.id;this.refreshOrder();}}if(this.data.tab==='orders')this.data.orders.forEach((o,i)=>{if(o.status==='PENDING'){const clock=paymentClock(o,now);updates['orders['+i+'].remainingText']=clock.remainingText;updates['orders['+i+'].payExpired']=clock.payExpired;}});if(Object.keys(updates).length)this.setData(updates);},
 onPullDownRefresh(){if(this.data.busy){wx.stopPullDownRefresh();return;}this.run(async()=>{try{await this.refreshView();}finally{wx.stopPullDownRefresh();}});},
 retry(){this.run(()=>this.refreshView());},
 async refreshView(){
  await this.refresh();
  if(this.data.loginRequired||this.data.loadError)return;
  if(await this.openLinkedOrder())return;
  if(this.data.selectedOrder)await this.loadSelectedOrder();
  if(this.data.tab==='orders')await this.loadOrderPage();
 },
 loginField(e){this.setData({['loginForm.'+e.currentTarget.dataset.key]:e.detail.value});},
 resetBuyerState(){this.feedbackEpoch++;this.setData({membershipVisible:false,member:null,boundPhone:'',phonePrompt:false,pendingPurchase:'',feedbackVisible:false,feedback:null,feedbackAnswers:[],feedbackSubmitted:false,feedbackLoading:false,feedbackError:''});
  // Clear account-owned views and drafts, but keep persisted checkout recovery
  // records: each belongs to its original API origin and buyer identity.
  this.pickupContactScope=null;this.loaded=false;this.checkoutKey=null;this.expirySyncId=null;this.quickReturn=null;
  this.setData({...pickupState([],null),isMember:false,customRecharge:'',deliveryMode:'DINE_IN',loginRequired:true,loginForm:{username:'',password:''},tab:'catalog',cart:[],cartCount:0,orders:[],selectedOrder:null,addresses:[],selectedAddress:null,addressIndex:0,addressForm:{},addressEditing:false,addressReturn:'account',pickupContact:{name:'',phone:''},afterForm:{},tracking:null,receiptItems:[],shipment:{number:'',note:''},redeemCode:'',quickLines:[],checkoutLines:[],checkoutSource:'cart',selectedCount:0,allSelected:false,cartInvalid:false,cartTotal:'0.00',checkoutTotal:'0.00',shippingEstimate:'0.00',detail:null,editor:null,orderQuery:'',orderStatus:'ALL',orderStatusIndex:0,orderPageNumber:1,orderPages:1,orderTotal:0,fulfillmentFilter:'ALL',canOrder:false,merchant:false,loadError:'',supportVisible:false});
 },
 login(){this.run(async()=>{await api.login(this.data.loginForm.username,this.data.loginForm.password);this.resetBuyerState();this.setData({cart:wx.getStorageSync('pet-cart')||[],loginRequired:false});await this.refresh();if(!this.data.loginRequired&&!this.data.loadError){if(!await this.openLinkedOrder())await this.recoverCheckout();}});},
 logout(){this.run(async()=>{try{await api.logout();}finally{this.resetBuyerState();}});},
 async run(fn){if(this.data.busy)return;this.setData({busy:true});try{await fn();}catch(e){const expired=e.code==='AUTH_REQUIRED'||e.message==='AUTH_REQUIRED';if(expired&&api.mode==='cloud')this.setData({loadError:'云托管没有识别到微信用户，请用开发者工具重新编译'});else if(expired)this.resetBuyerState();wx.showModal({title:'操作未完成',content:expired&&api.mode!=='cloud'?'登录已失效，请重新登录':e.message||String(e),showCancel:false});}finally{this.setData({busy:false});}},
 async refresh(){this.setData({catalogLoading:true});try{const previous=this.data.addresses[this.data.addressIndex||0]?.id;const identity=await api.call('identity');if(identity.id){const ownerKey='pet-cart-owner';const previousOwner=wx.getStorageSync(ownerKey);if(previousOwner&&previousOwner!==identity.id){wx.setStorageSync('pet-cart',[]);this.resetBuyerState();this.setData({loginRequired:false});}wx.setStorageSync(ownerKey,identity.id);}const [products,addresses,storefront,homeContent,settings]=await Promise.all(['catalog','addresses','storefront','homeContent','shopSettings'].map(action=>api.call(action)));this.restorePickupContact();const boundPhone=/^1\d{10}$/.test(identity.phone)?identity.phone:'';if(boundPhone)this.setData({pickupContact:{...this.data.pickupContact,phone:boundPhone}});const isMember=identity.isMember===true,decorated=products.map(p=>decorate(p,isMember));const found=addresses.findIndex(a=>a.id===previous);const deliveryMode=this.data.deliveryMode==='DELIVERY'&&!settings.delivery.enabled&&settings.pickup.enabled?'PICKUP':this.data.deliveryMode!=='DELIVERY'&&!settings.pickup.enabled&&settings.delivery.enabled?'DELIVERY':this.data.deliveryMode;const pickup=pickupState(buyerSlots(settings),this.data.pickupSlots[this.data.pickupSlotIndex]?.at??null);this.setData({...pickup,isMember,...(this.data.detail?{detail:decorated.find(p=>p.id===this.data.detail.id)||null}:{}),boundPhone,shopSettings:settings,storeGuide:{fee:money(settings.delivery.fee),minimum:money(settings.delivery.minimum),freeAbove:settings.delivery.freeAbove===null?null:money(settings.delivery.freeAbove)},pickupStore:settings.pickupStore,pickupEnabled:settings.pickup.enabled,deliveryEnabled:settings.delivery.enabled,canOrder:settings.canOrder,deliveryMode,shopNotice:settings.canOrder?'':settings.acceptingOrders?'当前不在接单时间内':'门店暂停接单',support:api.getSupport?api.getSupport(settings):this.data.support,catalogLoaded:true,loadError:'',products:decorated,addresses,addressIndex:found<0?0:found,merchant:identity.merchant,storefront:studio.resolveStorefront(storefront),homeContent,...studio.homeProducts(decorated)});this.loaded=true;this.filter();this.cartTotal();}catch(e){const expired=e.code==='AUTH_REQUIRED'||e.message==='AUTH_REQUIRED';if(expired)this.resetBuyerState();const message=expired?(api.mode==='cloud'?'云托管没有识别到微信用户，请重新编译后重试':'登录已失效，请重新登录'):e.message;this.setData({loadError:message,canOrder:false,shopNotice:'门店信息未更新，请重新加载'});wx.showToast({title:message,icon:'none'});}finally{this.setData({catalogLoading:false});}},
 filter(){const visible=this.data.products.filter(p=>(this.data.shopSection==='coffee'?studio.isCoffee(p):!studio.isCoffee(p))&&studio.matches(p,this.data.pet)&&(this.data.category==='全部'||p.category===this.data.category)&&(p.name+' '+(p.description||'')).toLowerCase().includes(this.data.search.trim().toLowerCase())&&(!this.data.stockOnly||!studio.tracksStock(p)||p.skus.some(s=>s.stock>0)));if(this.data.sortIndex)visible.sort((a,b)=>((a.priceMin??Math.min(...a.skus.map(s=>s.price)))-(b.priceMin??Math.min(...b.skus.map(s=>s.price))))*(this.data.sortIndex===1?1:-1));this.setData({visible});},
 shopSection(e){const coffee=e.currentTarget.dataset.value==='coffee';this.navigate({tab:'category',shopSection:coffee?'coffee':'pet',categories:coffee?['全部','咖啡','饮品','烘焙']:categories,pet:'全部',category:'全部',search:''});this.filter();},
 sortProducts(e){this.setData({sortIndex:Number(e.detail.value)});this.filter();},
 stockFilter(e){this.setData({stockOnly:e.detail.value});this.filter();},
 searchProducts(e){this.setData({search:e.detail.value});this.filter();},
 category(e){this.setData({category:e.currentTarget.dataset.value});this.filter();},
 goPet(e){this.setData({shopSection:'pet',categories});this.navigate({tab:'category',pet:e.currentTarget.dataset.value,category:'全部',search:''});this.filter();},
 browseCategory(e){this.setData({shopSection:['咖啡','饮品','烘焙'].includes(e.currentTarget.dataset.value)?'coffee':'pet',categories:['咖啡','饮品','烘焙'].includes(e.currentTarget.dataset.value)?['全部','咖啡','饮品','烘焙']:categories});this.navigate({tab:'category',pet:'全部',search:'',category:e.currentTarget.dataset.value});this.filter();},
 tab(e){if(e.currentTarget.dataset.tab==='orders')return wx.navigateTo({url:'/pages/orders/index'});if(!['catalog','category','cart','account','orders','addresses'].includes(e.currentTarget.dataset.tab))return;this.navigate({tab:e.currentTarget.dataset.tab,detail:null,selectedOrder:null,quickLines:[],checkoutSource:'cart'});this.run(async()=>{await this.refresh();if(this.data.tab==='orders')await this.loadOrderPage();});},
 detail(e){const p=this.data.products.find(p=>p.id===e.currentTarget.dataset.id);this.setData({detail:p,skuIndex:0,detailQty:1,detailSelections:[],editingCartIndex:null});this.updateDetailOptions();},
 spec(e){this.setData({skuIndex:Number(e.detail.value)});this.updateDetailOptions();},
 keepOrderOpen(){},
 closeOrder(){this.close();if(this.orderDetailEntry&&typeof getCurrentPages==='function'&&getCurrentPages().length>1)wx.navigateBack();},
 toggleAfterForm(){this.setData({afterFormOpen:!this.data.afterFormOpen});},
 toggleAfterHistory(){this.setData({afterHistoryOpen:!this.data.afterHistoryOpen});},
 close(){this.expirySyncId=null;this.setData({detail:null,selectedOrder:null,editor:null});},
 updateDetailOptions(){const p=this.data.detail;if(!p)return;const previous=this.data.detailSelections||[];const selections=(p.optionGroups||[]).map(group=>({groupId:group.id,optionId:group.options.find(option=>previous.some(s=>s.groupId===group.id&&s.optionId===option.id))?.id||group.options[0].id}));
  const choices=studio.resolveOptions(p,selections),sku=p.skus[this.data.skuIndex]||p.skus[0],pricing=studio.priceWithOptions(sku,this.data.isMember,choices);
  this.setData({detailSelections:choices.selections,detailOptionGroups:(p.optionGroups||[]).map(group=>({...group,selectedId:selections.find(s=>s.groupId===group.id).optionId,options:group.options.map(option=>({...option,extraText:option.extraPrice?money(option.extraPrice):''}))})),detailPriceText:money(pricing.price),detailMemberPriceText:money(pricing.memberPrice),detailExtraText:money(choices.extra)});
 },
 chooseDrinkOption(e){const {group,option}=e.currentTarget.dataset;this.setData({detailSelections:this.data.detailSelections.map(s=>s.groupId===group?{groupId:group,optionId:option}:s)});this.updateDetailOptions();},
 drinkLine(){const p=this.data.detail,sku=p.skus[this.data.skuIndex],choices=studio.resolveOptions(p,this.data.detailSelections),pricing=studio.priceWithOptions(sku,this.data.isMember,choices);return {productId:p.id,skuId:sku.id,name:p.name,spec:sku.name,...pricing,image:p.image,qty:this.data.detailQty,...(choices.options.length?{selections:choices.selections,optionsText:choices.text}:{})};},
 editCartOptions(e){const i=Number(e.currentTarget.dataset.i),line=this.data.cart[i],p=this.data.products.find(p=>p.id===line.productId);if(!p)return;this.setData({detail:p,skuIndex:Math.max(0,p.skus.findIndex(s=>s.id===line.skuId)),detailQty:line.qty,detailSelections:line.selections||[],editingCartIndex:i});this.updateDetailOptions();},
 add(){const p=this.data.detail,k=p.skus[this.data.skuIndex],line=this.drinkLine();const cart=this.data.cart.filter((_,i)=>this.data.editingCartIndex===null||i!==this.data.editingCartIndex).map(l=>({...l})),old=cart.find(l=>studio.sameLine(l,line));const qty=(old?old.qty:0)+this.data.detailQty;if(!this.validCartQty(qty,k))return false;if(old){old.qty=qty;old.selected=true;}else cart.push(line);this.checkoutKey=null;this.setData({cart,detail:null,editingCartIndex:null});this.cartTotal();wx.showToast({title:'已更新购物车'});return true;},

 validCartQty(qty,sku){const message=!Number.isInteger(qty)||qty<1||qty>99?'每种规格请选择 1～99 件':!sku?'商品已下架或规格不可用':sku.stockTracked!==false&&qty>sku.stock?'所选规格库存不足':'';if(message)wx.showModal({title:'操作未完成',content:message,showCancel:false});return !message;},
 detailQty(e){this.setData({detailQty:Math.max(1,Math.min(99,this.data.detailQty+Number(e.currentTarget.dataset.delta)))});},
 buy(){const p=this.data.detail,sku=p?.skus[this.data.skuIndex];if(!this.validCartQty(this.data.detailQty,sku))return;if(!this.data.boundPhone){this.setData({phonePrompt:true,pendingPurchase:'buy'});return;}this.quickReturn=this.data.tab;this.checkoutKey=null;this.navigate({checkoutSource:'quick',quickLines:[this.drinkLine()],detail:null,tab:'checkout'});this.cartTotal();},
 prepareCheckout(){this.cartTotal();if(!this.data.selectedCount){wx.showToast({title:'请先勾选要购买的商品',icon:'none'});return;}if(this.data.cartInvalid){wx.showToast({title:'请调整所选商品的库存或规格',icon:'none'});return;}if(!this.data.boundPhone){this.setData({phonePrompt:true,pendingPurchase:'cart'});return;}this.checkoutKey=null;this.navigate({checkoutSource:'cart',quickLines:[],tab:'checkout'});this.cartTotal();},
 backCheckout(){const target=this.data.checkoutSource==='quick'?(this.quickReturn||'category'):'cart';this.navigate({tab:target,quickLines:[],checkoutSource:'cart'});this.checkoutKey=null;this.cartTotal();},
 toggleLine(e){const i=Number(e.currentTarget.dataset.i);this.setData({['cart['+i+'].selected']:this.data.cart[i].selected===false});this.checkoutKey=null;this.cartTotal();},
 toggleAll(){const selected=!this.data.allSelected;this.setData({cart:this.data.cart.map(l=>({...l,selected}))});this.checkoutKey=null;this.cartTotal();},
 orderFilter(e){if(this.data.tab==='account')return wx.navigateTo({url:'/pages/orders/index?status='+encodeURIComponent(e.currentTarget.dataset.status)});this.run(async()=>{const status=e.currentTarget.dataset.status;this.navigate({tab:'orders',fulfillmentFilter:'ALL',orderStatus:status,orderStatusIndex:this.data.orderStatusOptions.findIndex(x=>x.id===status),orderQuery:'',orderPageNumber:1});await this.loadOrderPage();});},
 orderQueryField(e){this.setData({orderQuery:e.detail.value});},
 orderStatusField(e){const i=Number(e.detail.value);this.setData({orderStatusIndex:i,orderStatus:this.data.orderStatusOptions[i].id});},
 searchOrders(){this.run(async()=>{this.setData({orderPageNumber:1});await this.loadOrderPage();});},
 turnOrderPage(e){this.run(async()=>{this.setData({orderPageNumber:Math.max(1,Math.min(this.data.orderPages,this.data.orderPageNumber+Number(e.currentTarget.dataset.delta)))});await this.loadOrderPage();});},
 async loadOrderPage(){const merchant=false;const p=await api.call('ordersPage',{page:this.data.orderPageNumber,q:this.data.orderQuery,status:this.data.orderStatus,fulfillment:this.data.fulfillmentFilter});this.setData({[merchant?'merchantOrders':'orders']:p.items.map(order),orderPageNumber:p.page,orderPages:p.pages,orderTotal:p.total});},
 cartTotal(){const decorateLine=l=>({...l,lineKey:studio.lineKey(l),displayImage:picture(l),priceText:money(l.price),lineTotalText:money(l.price*l.qty),selected:l.selected!==false});const cart=reconcileCart(this.data.cart,this.data.products).map(decorateLine),quickLines=reconcileCart(this.data.quickLines||[],this.data.products).map(decorateLine);const selected=cart.filter(l=>l.selected);const checkoutLines=this.data.checkoutSource==='quick'?quickLines:selected;const checkoutPickupOnly=checkoutLines.some(l=>studio.isCoffee(this.data.products.find(p=>p.id===l.productId)||{}));if(checkoutPickupOnly&&this.data.deliveryMode==='DELIVERY')this.setData({deliveryMode:'DINE_IN'});const subtotal=checkoutLines.reduce((n,l)=>n+l.price*l.qty,0);const d=this.data.shopSettings?.delivery;const fee=checkoutLines.length&&this.data.deliveryMode==='DELIVERY'&&d?(d.freeAbove!==null&&subtotal>=d.freeAbove?0:d.fee):0;wx.setStorageSync('pet-cart',cart);this.setData({checkoutPickupOnly,cart,quickLines,checkoutLines,selectedAddress:this.data.addresses[this.data.addressIndex||0]||null,cartCount:cart.reduce((n,l)=>n+(Number.isInteger(l.qty)?l.qty:0),0),selectedCount:checkoutLines.reduce((n,l)=>n+(Number.isInteger(l.qty)?l.qty:0),0),allSelected:cart.length>0&&cart.every(l=>l.selected),cartInvalid:checkoutLines.some(l=>!!l.invalid),cartTotal:money(subtotal),shippingEstimate:money(fee),checkoutTotal:money(subtotal+fee)});},
 removeCart(e){const i=Number(e.currentTarget.dataset.i);this.setData({cart:this.data.cart.filter((_,index)=>index!==i)});this.checkoutKey=null;this.cartTotal();},
 openAddresses(){this.navigate({addressReturn:['cart','checkout'].includes(this.data.tab)?this.data.tab:'account',tab:'addresses'});},
 backAddresses(){this.navigate({tab:this.data.addressReturn||'account',addressEditing:false});},
 useAddress(e){this.navigate({addressIndex:Number(e.currentTarget.dataset.i),tab:this.data.addressReturn||'checkout'});this.checkoutKey=null;this.cartTotal();},
 qty(e){const i=Number(e.currentTarget.dataset.i),delta=Number(e.currentTarget.dataset.delta);const cart=this.data.cart.map(x=>({...x})),line=cart[i];const qty=line.qty+delta;const product=this.data.products.find(p=>p.id===line.productId),sku=product&&product.skus.find(k=>k.id===line.skuId);if(delta>0&&!this.validCartQty(qty,sku))return;line.qty=qty;this.setData({cart:cart.filter(x=>x.qty>0)});this.cartTotal();this.checkoutKey=null;},
 newAddress(){this.setData({addressForm:{requestKey:'address-'+Date.now()+'-'+Math.random().toString(36).slice(2),phone:this.data.boundPhone||''},addressEditing:true});},
 closePhonePrompt(){this.setData({phonePrompt:false,pendingPurchase:''});},
 bindWechatPhone(e){const detail=e.detail||{};if(detail.errno===1400001){wx.showModal({title:'暂时无法验证',content:'手机号验证次数已用完，请稍后再试',showCancel:false});return;}if(!detail.code)return;this.run(async()=>{let saved;try{saved=await api.call('bindPhone',{code:detail.code});}catch(err){if(err.code==='FORBIDDEN'||err.message==='FORBIDDEN')throw Error('当前云托管还没有开放手机号绑定，请重新发布服务后再试');throw err;}const bound=saved?.phone;if(!/^1\d{10}$/.test(bound))throw Error('微信没有返回有效手机号');const next=this.data.pendingPurchase;this.setData({boundPhone:bound,phonePrompt:false,pendingPurchase:'',pickupContact:{...this.data.pickupContact,phone:bound}});if(next==='buy')this.buy();else if(next==='cart')this.prepareCheckout();});},
 closeAddress(){this.setData({addressEditing:false});},
 deliveryMode(e){if(this.data.checkoutPickupOnly&&e.currentTarget.dataset.value==='DELIVERY')return;if(!['DINE_IN','PICKUP','DELIVERY'].includes(e.currentTarget.dataset.value))return;if(e.currentTarget.dataset.value!=='DELIVERY'?!this.data.pickupEnabled:!this.data.deliveryEnabled)return;this.setData({deliveryMode:e.currentTarget.dataset.value});this.cartTotal();this.checkoutKey=null;},
 openFeedback(){
  const epoch=++this.feedbackEpoch;this.setData({feedbackVisible:true,feedback:null,feedbackAnswers:[],feedbackSubmitted:false,feedbackLoading:true,feedbackError:''});
  api.call('survey').then(r=>{if(epoch!==this.feedbackEpoch)return;this.setData({feedback:r.survey,feedbackSubmitted:r.submitted===true,feedbackAnswers:(r.survey?.questions||[]).map(()=>[])});}).catch(e=>{if(epoch===this.feedbackEpoch)this.setData({feedbackError:e.message});}).finally(()=>{if(epoch===this.feedbackEpoch)this.setData({feedbackLoading:false});});
 },
 closeFeedback(){this.feedbackEpoch++;this.setData({feedbackVisible:false,feedback:null,feedbackAnswers:[],feedbackError:'',feedbackLoading:false});},
 feedbackChoice(e){if(this.data.feedbackLoading||this.data.feedbackSubmitted)return;const i=Number(e.currentTarget.dataset.i),q=this.data.feedback?.questions[i];if(!q)return;const values=q.type==='single'?[Number(e.detail.value)]:e.detail.value.map(Number);this.setData({['feedbackAnswers['+i+']']:values});},
 async submitFeedback(){
  if(this.data.feedbackLoading||this.data.feedbackSubmitted||!this.data.feedback)return;
  const {feedback,feedbackAnswers}=this.data;if(feedback.questions.some((q,i)=>q.required&&!feedbackAnswers[i]?.length)){this.setData({feedbackError:'请完成必填题'});return;}if(!feedbackAnswers.some(a=>a.length)){this.setData({feedbackError:'请至少回答一道题'});return;}
  const epoch=this.feedbackEpoch;this.setData({feedbackLoading:true,feedbackError:''});
  try{await api.call('submitSurvey',{id:feedback.id,answers:feedbackAnswers});if(epoch===this.feedbackEpoch)this.setData({feedbackSubmitted:true});}catch(e){if(epoch===this.feedbackEpoch)this.setData({feedbackError:e.message||'提交未确认，请重试；不会重复记录'});}finally{if(epoch===this.feedbackEpoch)this.setData({feedbackLoading:false});}
 },
 restorePickupContact(){
  try{const scope='pet-pickup-contact-v1:'+api.checkoutScope();if(this.pickupContactScope===scope)return;this.pickupContactScope=scope;this.setData({pickupContact:{name:'',phone:''}});const saved=wx.getStorageSync(scope);this.setData({pickupContact:saved&&typeof saved.name==='string'&&saved.name.trim()&&saved.name.length<=40&&/^1\d{10}$/.test(saved.phone)?{name:saved.name,phone:saved.phone}:{name:'',phone:''}});}catch{}
 },
 rememberPickupContact(o){if(!studio.isInStore(o))return;try{const scope='pet-pickup-contact-v1:'+api.checkoutScope();wx.setStorageSync(scope,{name:o.address.name,phone:o.address.phone});}catch{}},
 pickupColumn(e){if(Number(e.detail.column)!==0)return;const groups=slotGroups(this.data.pickupSlots);const dateIndex=Number(e.detail.value);const times=groups[dateIndex]?.times||[];this.setData({pickupTimes:times,pickupRange:[this.data.pickupDates,times],pickupColumnIndex:[dateIndex,0]});},
 pickupTime(e){const value=(e.detail.value||[0,0]).map(Number);const groups=slotGroups(this.data.pickupSlots);const slot=groups[value[0]]?.slots[value[1]];this.setData(pickupState(this.data.pickupSlots,slot?.at??null));this.checkoutKey=null;},
 openContact(){this.setData({contactVisible:true});},
 closeContact(){this.setData({contactVisible:false});},
 applyMemberPricing(isMember){const products=this.data.products.map(p=>decorate(p,isMember));this.setData({isMember,products,...studio.homeProducts(products),...(this.data.detail?{detail:products.find(p=>p.id===this.data.detail.id)||null}:{})});this.updateDetailOptions();this.filter();this.cartTotal();},
 openMembership(){this.run(async()=>{const m=await api.call('membership');this.applyMemberPricing(m.isMember===true);const configured=m.tiers||m.amounts.map(pay=>({pay,credit:pay}));const tiers=[5000,10000,20000,30000,50000].map(amount=>{const tier=configured.find(t=>t.pay===amount);const credit=tier?.credit??amount;return {amount,credit,text:String(amount/100),creditText:money(credit),bonus:credit>amount,custom:!tier};});this.setData({member:{...m,balanceText:money(m.balance),tiers,entries:m.entries.map(e=>({...e,amountText:(e.amount>0?'+':'')+money(e.amount),timeText:formatTime(e.at)}))},customRecharge:'',customRechargeActive:false,membershipVisible:true});});},
 membershipOrders(){this.setData({membershipVisible:false});return wx.navigateTo({url:'/pages/orders/index'});},
 closeMembership(){this.setData({membershipVisible:false});},
 focusCustomRecharge(){this.setData({customRechargeActive:true});},
 customRechargeField(e){let value=String(e.detail.value);if(!/^\d*(?:\.\d*)?$/.test(value))return this.data.customRecharge;const dot=value.indexOf('.');if(dot>=0)value=value.slice(0,dot+1)+value.slice(dot+1).replace(/\./g,'').slice(0,2);if(value.startsWith('.'))value='0'+value;if(Number(value)>5000)value='5000';this.setData({customRecharge:value,customRechargeActive:true});return value;},
 recharge(e){this.run(async()=>{
  const customInput=e.currentTarget.dataset.custom===true||e.currentTarget.dataset.custom==='true';
  const value=String(this.data.customRecharge||'').trim();
  if(customInput&&!/^\d+(?:\.\d{1,2})?$/.test(value))throw Error('请输入充值金额，最多两位小数');
  const amount=customInput?Math.round(Number(value)*100):Number(e.currentTarget.dataset.amount);
  if(!Number.isSafeInteger(amount)||amount<=0||amount>500000)throw Error('充值金额须大于 0 元，且不超过 5000 元');
  const tier=customInput?null:this.data.member.tiers.find(t=>t.amount===amount);
  if(!customInput&&!tier)throw Error('请选择有效充值档位');
  const custom=customInput||tier.custom===true;
  const offer=tier?.bonus?'，到账 ¥'+tier.creditText:custom?'，按实付金额到账':'';
  if(!await this.confirm('会员充值','支付 ¥'+money(amount)+offer+'，微信付款确认后计入本店余额。'+this.data.member.terms))return;
  const scope=api.checkoutScope()+':recharge';let pending=wx.getStorageSync(scope);
  if(pending&&(pending.amount!==amount||(pending.custom===true)!==custom))throw Error('上次充值结果待确认，请先按原金额和方式重试，或前往我的订单核对');
  if(!pending){pending={key:'recharge-'+Date.now()+'-'+Math.random().toString(36).slice(2),amount,custom};wx.setStorageSync(scope,pending);}
  let result;try{result=await api.call('createRecharge',pending);}catch(error){if(error.definitive===true)wx.removeStorageSync(scope);throw error;}wx.removeStorageSync(scope);
  this.setData({membershipVisible:false,customRecharge:''});this.selectOrder(result);
 });},
 pickupField(e){this.setData({['pickupContact.'+e.currentTarget.dataset.key]:e.detail.value});this.checkoutKey=null;},
 redeemField(e){this.setData({redeemCode:e.detail.value});},
 fulfillmentFilter(e){this.run(async()=>{this.setData({fulfillmentFilter:e.currentTarget.dataset.value,orderPageNumber:1});await this.loadOrderPage();});},
 fulfillmentOrders(e){return wx.navigateTo({url:'/pages/orders/index?fulfillment='+encodeURIComponent(e.currentTarget.dataset.value)});},
 field(e){this.setData({['addressForm.'+e.currentTarget.dataset.key]:e.detail.value});},
 editAddress(e){this.setData({addressEditing:true,addressForm:{...this.data.addresses[Number(e.currentTarget.dataset.i)]}});},
 saveAddress(){this.run(async()=>{
  const saved=await api.call('saveAddress',this.data.addressForm);
  // Keep the acknowledged address even if the following refresh loses its response.
  const addresses=this.data.addresses.map(a=>a.id===saved.id?saved:a);
  if(!addresses.some(a=>a.id===saved.id))addresses.push(saved);
  const returning=['cart','checkout'].includes(this.data.addressReturn);
  this.setData({addresses,addressIndex:returning?addresses.findIndex(a=>a.id===saved.id):this.data.addressIndex,addressForm:{},addressEditing:false});
  this.cartTotal();this.checkoutKey=null;
  await this.refresh();
  if(returning)this.navigate({tab:this.data.addressReturn});
 });},
 deleteAddress(e){this.run(async()=>{if(!await this.confirm('删除收货地址','删除后需要重新添加，是否继续？'))return;await api.call('deleteAddress',{id:e.currentTarget.dataset.id});await this.refresh();});},
 pickAddress(e){this.setData({addressIndex:Number(e.detail.value)});this.checkoutKey=null;this.cartTotal();},
 checkout(){this.run(async()=>{
  const scope=api.checkoutScope();
  // A response may have been lost: resolve the stored request before validating a new cart.
  if(checkout.read(scope)){await this.finishPendingCheckout(scope);return;}
  this.cartTotal();
  if(!this.data.checkoutLines.length)throw Error('请先选择要购买的商品');
  if(this.data.cartInvalid)throw Error('所选商品有失效或库存不足，请调整后重试');
  if(!this.data.canOrder)throw Error(this.data.shopNotice||'门店信息未更新，请重新加载');
  const a=this.data.selectedAddress;
  if(this.data.deliveryMode==='DELIVERY'&&!a){this.navigate({addressReturn:'checkout',tab:'addresses'});this.newAddress();return;}
  if(this.data.boundPhone&&this.data.pickupContact.phone!==this.data.boundPhone)this.setData({pickupContact:{...this.data.pickupContact,phone:this.data.boundPhone}});if(this.data.deliveryMode!=='DELIVERY'&&!/^1\d{10}$/.test(this.data.pickupContact.phone))throw Error('请填写11位联系电话');
  const source=this.data.checkoutSource;
  const input={pickupAt:this.data.deliveryMode==='PICKUP'?(this.data.pickupSlots[this.data.pickupSlotIndex]?.at??null):null,fulfillment:this.data.deliveryMode,contact:{...this.data.pickupContact,name:this.data.pickupContact.name.trim()||(this.data.deliveryMode==='DINE_IN'?'堂食顾客':'自提顾客')},lines:this.data.checkoutLines.map(l=>({productId:l.productId,skuId:l.skuId,qty:l.qty,...(l.selections?.length?{selections:l.selections}:{})}))};
  if(input.fulfillment==='DELIVERY')input.addressId=a.id;
  const q=await api.call('quoteOrder',input);
  if(typeof q.isMember==='boolean')this.applyMemberPricing(q.isMember);this.setData({checkoutTotal:money(q.total),...(q.lines?{checkoutLines:this.data.checkoutLines.map((l,i)=>({...l,...q.lines[i],priceText:money(q.lines[i].price),lineTotalText:money(q.lines[i].price*l.qty)}))}:{} )});
  if(!await this.confirm('确认订单', ({DINE_IN:'堂食 · 立即取单',PICKUP:'到店自提',DELIVERY:'快递配送'}[q.fulfillment])+(q.isMember?' · 会员价':' · 普通价')+' · 合计 ¥'+money(q.total)+'\n请确认页面中的商品和'+(q.fulfillment==='DELIVERY'?'收货地址':'联系电话')+'无误。'))return;
  this.checkoutKey='checkout-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  checkout.write(scope,{source,input:{...input,key:this.checkoutKey,settingsRevision:q.settingsRevision,expectedTotal:q.total}});
  await this.finishPendingCheckout(scope);
 });},
 async recoverCheckout(){const scope=api.checkoutScope();if(checkout.read(scope))await this.finishPendingCheckout(scope,false);},
 async finishPendingCheckout(scope,open=true){
  const completed=await checkout.submit(scope,api.call,this.data.cart);this.rememberPickupContact(completed.order);
  if(!open){this.setData({cart:completed.cart});this.cartTotal();wx.showToast({title:'已恢复订单，可在我的订单查看',icon:'none'});return;}
  this.checkoutKey=null;this.expirySyncId=null;this.navigate({cart:completed.cart,quickLines:[],checkoutSource:'cart',tab:'orders',selectedOrder:order(completed.order),tracking:null,afterForm:{type:'REFUND_ONLY',reason:''},orderQuery:'',orderStatus:'ALL',orderStatusIndex:0,orderPageNumber:1});
  this.cartTotal();await this.loadOrderPage();
 },
 showOrder(e){this.run(async()=>{const o=await api.call('order',{id:e.currentTarget.dataset.id});this.selectOrder(o);this.focusOrderSection(e.currentTarget.dataset.section);});},
 focusOrderSection(section){if(section==='aftersale'&&['PAID','SHIPPED','COMPLETED'].includes(this.data.selectedOrder?.status))this.setData({afterFormOpen:true});const targets={payment:'order-payment',fulfillment:'order-fulfillment',aftersale:this.data.selectedOrder?.refund&&!['REJECTED','WITHDRAWN'].includes(this.data.selectedOrder.refund.stage)?'order-aftersale':'refund-apply'};this.setData({orderScrollTarget:targets[section]||''});},
 selectOrder(o){this.setData({deliveryExpanded:false,afterFormOpen:false,afterHistoryOpen:false,orderScrollTarget:'',selectedOrder:order(o),tracking:null,trackingLoading:false,trackingError:'',shipment:{number:'',note:''},redeemCode:'',afterForm:{type:o.status==='PAID'||studio.isInStore(o)||o.kind==='RECHARGE'||o.fulfillment?.issue?.status==='OPEN'?'REFUND_ONLY':'RETURN_REFUND',reason:'',note:'',returnName:'',returnPhone:'',returnAddress:'',company:'',number:'',receiptNote:'',receiptConfirmed:false,waiveReturn:false,failReason:''},receiptItems:o.lines.map(l=>({...l,receivedQty:0,restockQty:0}))});void this.tracking();},
 async openLinkedOrder(){
  const direct=this.pendingOrderTrade===null||this.pendingOrderTrade===undefined;
  const number=direct?this.pendingOrderId:this.pendingOrderTrade;if(number===null||number===undefined)return false;
  const pattern=direct?/^[A-Za-z0-9_-]{1,128}$/:/^[A-Za-z0-9_-]{6,32}$/;
  if(typeof number!=='string'||!pattern.test(number)){this.pendingOrderTrade=null;this.pendingOrderId=null;throw Error('订单链接无效，请从订单中心或微信购物订单重新进入');}
  let o;
  try{o=direct?await api.call('order',{id:number}):await api.call('orderByTradeNo',{outTradeNo:number});}
  catch(e){if(e.code==='ORDER_NOT_FOUND'||e.code==='FORBIDDEN'||e.message==='ORDER_NOT_FOUND'||e.message==='FORBIDDEN'){this.pendingOrderTrade=null;this.pendingOrderId=null;throw Error('未找到当前微信账号的订单，请核对账号或联系商家');}throw e;}
  this.selectOrder(o);this.focusOrderSection(this.orderEntrySection);this.orderEntrySection=null;this.pendingOrderTrade=null;this.pendingOrderId=null;this.navigate({tab:'orders',detail:null});return true;
 },
 afterField(e){this.setData({['afterForm.'+e.currentTarget.dataset.key]:e.detail.value});},
 afterType(e){this.setData({'afterForm.type':Number(e.detail.value)===0?'RETURN_REFUND':'REFUND_ONLY'});},
 receiptField(e){this.setData({['receiptItems['+e.currentTarget.dataset.i+'].'+e.currentTarget.dataset.key]:e.detail.value===''?null:Number(e.detail.value)});},
 confirm(title,content){return new Promise(resolve=>wx.showModal({title,content,success:r=>resolve(!!r.confirm),fail:()=>resolve(false)}));},
 openSupport(){if(api.getSupport)this.setData({support:api.getSupport(this.data.shopSettings)});this.setData({supportVisible:true});},
 copyStoreAddress(){const detail=this.data.shopSettings?.store?.detail;if(detail)wx.setClipboardData({data:detail});},
 closeSupport(){this.setData({supportVisible:false});},
 toggleSupportSection(e){const section=e.currentTarget.dataset.section;if(['delivery','pickup','after'].includes(section))this.setData({supportSection:this.data.supportSection===section?'':section});},
 callSupport(){const phone=this.data.support.phone;if(!phone)return;wx.makePhoneCall({phoneNumber:phone,fail:()=>wx.showToast({title:'未拨出，可复制号码联系商家',icon:'none'})});},
 copySupport(){if(this.data.support.phone)wx.setClipboardData({data:this.data.support.phone});},
 copyOrderNumber(){if(this.data.selectedOrder)wx.setClipboardData({data:this.data.selectedOrder.orderNo||this.data.selectedOrder.id});},
 copyTracking(){const number=this.data.selectedOrder?.shipping?.number;if(number)wx.setClipboardData({data:number});},
 async loadSelectedOrder(){
  const id=this.data.selectedOrder?.id;if(!id)return;
  const o=await api.call('order',{id});
  if(this.data.selectedOrder?.id!==id)return;
  this.setData({selectedOrder:order(o)});void this.tracking();
 },
 refreshOrder(){this.run(()=>this.loadSelectedOrder());},
 action(e){const action=e.currentTarget.dataset.action;this.run(async()=>{const prompts={refundRequest:['申请退款','申请提交后由商家审核。微信付款原路退回，余额付款退回会员余额，是否提交？'],balancePay:['余额支付','将从会员余额扣除本单金额，是否继续？'],mockPay:['免扣款操作','仅未扣款，不会产生真实扣款。是否继续？'],payment:['微信支付','将使用微信支付完成付款。是否继续？'],cancel:['取消订单','确认取消未付款订单？'],confirmReceipt:['确认收货','请确认商品已送到并核对无误，再确认收货。'],refundWithdraw:['撤回售后','确认撤回当前售后申请？'],returnShip:['提交退货物流','请核对退货运单，提交后将锁定。是否继续？']};if(prompts[action]&&!await this.confirm(...prompts[action]))return;if(['mockPay','payment'].includes(action)&&paymentClock(this.data.selectedOrder).payExpired){const fresh=await api.call('order',{id:this.data.selectedOrder.id});this.setData({selectedOrder:order(fresh)});throw Error('付款截止时间已到，请核对最新订单状态');}if(!['balancePay','mockPay','payment','cancel','confirmReceipt','refundRequest','refundWithdraw','returnShip'].includes(action))throw Error('此操作请在商家网页处理');const f=this.data.afterForm||{},input={id:this.data.selectedOrder.id,caseId:this.data.selectedOrder.refund?.caseId};if(action==='refundRequest')Object.assign(input,{reason:f.reason,type:f.type});if(action==='returnShip')Object.assign(input,{company:f.company,number:f.number});if(action==='payment'){const result=await api.call('payment',input);if(result.wechat)await api.requestPayment(result.wechat);const paid=await api.call('paymentSync',{id:input.id});this.setData({selectedOrder:order(paid)});}else{const o=await api.call(action,input);this.setData({selectedOrder:order(o)});}if(this.data.tab==='orders')await this.loadOrderPage();});},
 toggleDeliveryTimeline(){this.setData({deliveryExpanded:!this.data.deliveryExpanded});},
 copyOrderNumber(){if(this.data.selectedOrder)wx.setClipboardData({data:this.data.selectedOrder.orderNo||this.data.selectedOrder.id});},
 async openOfficialTracking(){
  if(this.data.trackingLoading)return;
  if(!logisticsPlugin.available()){wx.showToast({title:'物流查询尚未开通，请复制运单号查询',icon:'none'});return;}
  const id=this.data.selectedOrder?.id;
  const result=await this.tracking(true);
  if(this.data.selectedOrder?.id!==id)return;
  if(!result?.waybillToken){wx.showToast({title:result?.notice||'物流暂不可用，请稍后再试',icon:'none'});return;}
  try{await logisticsPlugin.open(result.waybillToken);}catch{wx.showToast({title:'微信物流暂无法打开，请稍后重试',icon:'none'});}
 },
 async tracking(open=false){
  const current=this.data.selectedOrder;if(!current||current.isPickup||current.kind==='RECHARGE')return;
  const id=current.id,number=current.shipping?.number;const requestId=this.trackingRequest=(this.trackingRequest||0)+1;
  this.setData({trackingLoading:true,trackingError:''});
  try{const result=await api.call('tracking',{id,open:open===true});if(this.trackingRequest!==requestId||this.data.selectedOrder?.id!==id||this.data.selectedOrder?.shipping?.number!==number)return;
   this.setData({tracking:result?{...result,updatedText:result.updatedAt?formatTime(result.updatedAt):''}:null});return result;
  }catch{if(this.trackingRequest===requestId&&this.data.selectedOrder?.id===id)this.setData({trackingError:'物流查询失败，请稍后重试；不影响订单状态'});}
  finally{if(this.trackingRequest===requestId&&this.data.selectedOrder?.id===id&&this.data.selectedOrder?.shipping?.number===number)this.setData({trackingLoading:false});}
 },

});
