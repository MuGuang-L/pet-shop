'use strict';
const config=require('../config');const key='pet-shop-session-v2';
const cloud=config.mode==='cloud';
function base(){const url=(config.apiBase||'http://127.0.0.1:4173').replace(/\/$/,'');if(!/^http:\/\/(127\.0\.0\.1|localhost):4173$/.test(url)&&!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(url))throw Error('API 地址须为本机 4173 端口或 HTTPS 域名');return url;}
function assetOrigin(){const value=String(config.cloud&&config.cloud.assetBase||'').replace(/\/$/,'');return /^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(value)?value:'';}
function session(){const s=wx.getStorageSync(key);return s&&s.apiBase===base()?s:null;}
function paths(value){const prefix=cloud?assetOrigin():base();if(typeof value==='string')return /^\/(assets|uploads)\//.test(value)&&prefix?prefix+value:value;if(Array.isArray(value))return value.map(paths);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,paths(v)]));return value;}
const loginMessages={INVALID_CREDENTIALS:'账号或密码不正确',LOGIN_RATE_LIMIT:'登录尝试过多，请一分钟后再试',LOGIN_BUSY:'当前登录人数较多，请稍后再试'};
const addressMessages={ADDRESS_NAME:'请填写收货人姓名，最多 40 个字',ADDRESS_PHONE:'请填写 11 位手机号码',ADDRESS_DETAIL:'请填写 5～200 个字的详细地址',ADDRESS_REQUIRED:'请选择收货地址',CREATE_REQUEST_CONFLICT:'上次地址可能已保存，请先关闭编辑并刷新地址列表核对。'};
const readActions=new Set(['catalog','storefront','homeContent','identity','addresses','orders','ordersPage','order','tracking','shopSettings','quoteOrder']);
function accept(endpoint,token,r,resolve,reject){
 if(endpoint==='/auth/login'&&[400,429,503].includes(r.statusCode)&&Object.prototype.hasOwnProperty.call(loginMessages,r.data?.error))return reject(Object.assign(Error(loginMessages[r.data.error]),{code:r.data.error,definitive:true}));
 if(r.statusCode===401){if(!cloud&&session()?.token===token)wx.removeStorageSync(key);return reject(Object.assign(Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED',definitive:false}));}
 if([408,429,500,502,503,504].includes(r.statusCode)||!r.data||typeof r.data.ok!=='boolean')return reject(Object.assign(Error('服务暂时不可用，请稍后重试'),{retryable:true,definitive:false}));
 if(r.statusCode!==200||!r.data.ok){const code=r.data.error;const error=Error(Object.prototype.hasOwnProperty.call(addressMessages,code)?addressMessages[code]:code||'服务请求失败');error.code=code;error.definitive=r.statusCode===400&&r.data.retryable!==true;return reject(error);}
 if(!Object.prototype.hasOwnProperty.call(r.data,'data'))return reject(Object.assign(Error('服务响应不完整，请稍后重试'),{retryable:true,definitive:false}));
 resolve(r.data.data);
}
function requestOnce(endpoint,data,apiBase,token){
 if(cloud){
  const target=config.cloud||{};
  if(!target.env||!target.service)return Promise.reject(Error('请在 miniprogram/config.local.js 填写云托管环境 ID 和服务名'));
  return new Promise((resolve,reject)=>wx.cloud.callContainer({config:{env:target.env},path:endpoint,method:'POST',header:{'X-WX-SERVICE':target.service,'Content-Type':'application/json'},data,timeout:15000,success:r=>accept(endpoint,token,r,resolve,reject),fail:()=>reject(Object.assign(Error('连接云托管失败，请检查环境 ID、服务名和云托管服务状态'),{retryable:true,definitive:false}))}));
 }
 return new Promise((resolve,reject)=>wx.request({url:apiBase+endpoint,method:'POST',data,header:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},timeout:15000,success:r=>accept(endpoint,token,r,resolve,reject),fail:()=>reject(Object.assign(Error('连接联调服务失败，请检查服务地址、服务状态和网络'),{retryable:true,definitive:false}))}));
}
async function request(endpoint,data){
 const apiBase=cloud?'':base(),token=cloud?null:session()?.token,canRetry=endpoint==='/api'&&readActions.has(data?.action);
 for(let attempt=0;attempt<2;attempt++){
  if(!cloud&&(base()!==apiBase||session()?.token!==token))throw Error('AUTH_REQUIRED');
  try{const result=await requestOnce(endpoint,data,apiBase,token);if(!cloud&&(base()!==apiBase||session()?.token!==token))throw Error('AUTH_REQUIRED');return result;}catch(e){
   if(e.retryable&&canRetry&&attempt===0){await new Promise(r=>setTimeout(r,300));continue;}
   throw e;
  }
 }
}
async function login(username,password){if(cloud)throw Error('云托管使用微信身份，不需要测试账号');const out=await request('/auth/login',{username,password});if(out.identity.merchant)throw Error('小程序请使用买家测试账号，商家账号用于网页后台');const previous=session();if(previous?.id!==out.identity.id)wx.removeStorageSync('pet-cart');wx.setStorageSync(key,{apiBase:base(),token:out.token,id:out.identity.id});return out.identity;}
async function logout(){if(cloud){wx.removeStorageSync('pet-cart');return;}try{await request('/auth/logout',{});}finally{wx.removeStorageSync(key);wx.removeStorageSync('pet-cart');}}
async function call(action,input={}){return paths(await request('/api',{action,input}));}
function requestPayment(params){return new Promise((resolve,reject)=>{if(!params){resolve();return;}wx.requestPayment({timeStamp:String(params.timeStamp),nonceStr:params.nonceStr,package:params.package,signType:params.signType||'RSA',paySign:params.paySign,success:resolve,fail:err=>reject(Error(err&&err.errMsg&&err.errMsg.includes('cancel')?'已取消支付':(err&&err.errMsg)||'支付未完成'))});});}
function checkoutScope(){const identity=cloud?'cloud':session()?.id;if(!identity)throw Error('AUTH_REQUIRED');return 'pet-checkout-v1:'+JSON.stringify([cloud?String(config.cloud&&config.cloud.env||''):base(),identity]);}
function getSupport(settings){const source=config.buyerSupport||{};const configured=settings&&settings.revision>0;const phone=String(configured?settings.store.phone:source.phone||'').trim();return {name:'联系商家',phone:/^(?:1\d{10}|0\d{2,3}-?\d{7,8}|400-?\d{3}-?\d{4})$/.test(phone)?phone:'',hours:configured?settings.hoursText:String(source.hours||'')};}
module.exports={getSupport,call,login,logout,requestPayment,checkoutScope,hasSession:()=>cloud||!!session()?.token,mode:cloud?'cloud':'api'};
