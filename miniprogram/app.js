const config=require('./config');
App({
 globalData:{orderEntry:null,homeEntry:false},
 onLaunch(){if(config.mode==='cloud'&&config.cloud&&config.cloud.env)wx.cloud.init({env:config.cloud.env,traceUser:true});},
 onShow(options={}){
  // Capture external order links even when the existing page is resumed.
  if([1011,1012,1013,1047,1048,1049].includes(Number(options.scene))&&options.path==='pages/shop/index'&&!options.query?.out_trade_no&&!options.query?.order_id&&!options.query?.tab){this.globalData.homeEntry=true;this.globalData.orderEntry=null;}
  if(options.path==='pages/shop/index'&&Object.prototype.hasOwnProperty.call(options.query||{},'out_trade_no'))this.globalData.orderEntry={outTradeNo:options.query.out_trade_no};
 }
});
