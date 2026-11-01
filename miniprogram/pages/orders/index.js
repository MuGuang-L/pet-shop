const api=require('../../services/api');
const statusText={PENDING:'待付款',PAID:'备货中',SHIPPED:'配送中',COMPLETED:'已完成',CANCELLED:'已取消',EXPIRED:'已超时',REFUND_REQUESTED:'售后审核中',REFUNDING:'退款处理中',REFUNDED:'已退款'};
const display=o=>({...o,statusText:statusText[o.status]||o.status,totalText:(o.total/100).toFixed(2),lines:o.lines.map(line=>({...line,priceText:(line.price/100).toFixed(2),image:line.image||'/assets/empty-v2.jpg'}))});
Page({
 data:{orders:[],status:'ALL',filters:[{id:'ALL',name:'全部'},{id:'PENDING',name:'待付款'},{id:'PAID',name:'备货中'},{id:'SHIPPED',name:'配送中'},{id:'COMPLETED',name:'已完成'},{id:'AFTERSALE',name:'售后'}],page:0,pages:0,total:0,busy:false,error:'',loginRequired:false},
 onShow(){return this.load();},
 onPullDownRefresh(){return this.load().finally(()=>wx.stopPullDownRefresh());},
 async load(page=1,append=false){
  if(this.data.busy)return;
  if(!api.hasSession()){this.setData({orders:[],loginRequired:true,error:''});return;}
  this.setData({busy:true,error:'',loginRequired:false});
  try{
   const result=await api.call('ordersPage',{page,pageSize:10,status:this.data.status,fulfillment:'ALL',q:''});
   const orders=result.items.map(display);
   this.setData({orders:append?this.data.orders.concat(orders):orders,page:result.page,pages:result.pages,total:result.total});
  }catch(e){
   const expired=e.code==='AUTH_REQUIRED'||e.message==='AUTH_REQUIRED';
   this.setData({error:expired?'请使用下单时的微信账号重新进入后重试':e.message||'订单读取失败，请重试',...(expired?{orders:[],loginRequired:true,page:0,pages:0,total:0}:{})});
  }finally{this.setData({busy:false});}
 },
 retry(){return this.load();},
 filter(e){
  const status=e.currentTarget.dataset.status;
  if(this.data.busy||!this.data.filters.some(f=>f.id===status)||status===this.data.status)return;
  this.setData({status,orders:[],page:0,pages:0,total:0});return this.load();
 },
 more(){if(!this.data.busy&&this.data.page<this.data.pages)return this.load(this.data.page+1,true);},
 openOrder(e){const id=e.currentTarget.dataset.id;if(this.data.orders.some(o=>o.id===id))wx.navigateTo({url:'/pages/shop/index?order_id='+encodeURIComponent(id)});},
 shop(){wx.reLaunch({url:'/pages/shop/index'});}
});
