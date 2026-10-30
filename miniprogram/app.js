const config=require('./config');
App({onLaunch(){if(config.mode==='cloud'&&config.cloud&&config.cloud.env)wx.cloud.init({env:config.cloud.env,traceUser:true});}});
