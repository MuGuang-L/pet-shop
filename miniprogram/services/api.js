'use strict';
const config=require('../config');const key='pet-shop-session-v2';
function base(){const url=(config.apiBase||'http://127.0.0.1:4173').replace(/\/$/,'');if(!/^http:\/\/(127\.0\.0\.1|localhost):4173$/.test(url)&&!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(url))throw Error('API 地址须为本机 4173 端口或 HTTPS 域名');return url;}
function session(){const s=wx.getStorageSync(key);return s&&s.apiBase===base()?s:null;}
function paths(value){if(typeof value==='string')return /^\/(assets|uploads)\//.test(value)?base()+value:value;if(Array.isArray(value))return value.map(paths);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,paths(v)]));return value;}
const readActions=new Set(['catalog','storefront','homeContent','identity','addresses','orders','ordersPage','order','tracking','shopSettings','quoteOrder']);
function requestOnce(endpoint,data,apiBase,token){
 return new Promise((resolve,reject)=>wx.request({url:apiBase+endpoint,method:'POST',data,header:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},timeout:15000,
 success:r=>{
  if(r.statusCode===401){if(session()?.token===token)wx.removeStorageSync(key);return reject(Object.assign(Error('AUTH_REQUIRED'),{definitive:false}));}
  if([408,429,500,502,503,504].includes(r.statusCode)||!r.data||typeof r.data.ok!=='boolean')return reject(Object.assign(Error('服务暂时不可用，请稍后重试'),{retryable:true,definitive:false}));
  if(r.statusCode!==200||!r.data.ok){const error=Error(r.data.error==='CREATE_REQUEST_CONFLICT'?'上次地址可能已保存，请先关闭编辑并刷新地址列表核对。':r.data.error||'服务请求失败');error.definitive=r.statusCode===400&&r.data.retryable!==true;return reject(error);}
  if(!Object.prototype.hasOwnProperty.call(r.data,'data'))return reject(Object.assign(Error('服务响应不完整，请稍后重试'),{retryable:true,definitive:false}));
  resolve(r.data.data);
 },fail:()=>reject(Object.assign(Error('连接联调服务失败，请检查服务地址、服务状态和网络'),{retryable:true,definitive:false}))}));
}
async function request(endpoint,data){
 const apiBase=base(),token=session()?.token,canRetry=endpoint==='/api'&&readActions.has(data?.action);
 for(let attempt=0;attempt<2;attempt++){
  if(base()!==apiBase||session()?.token!==token)throw Error('AUTH_REQUIRED');
  try{const result=await requestOnce(endpoint,data,apiBase,token);if(base()!==apiBase||session()?.token!==token)throw Error('AUTH_REQUIRED');return result;}catch(e){
   if(e.retryable&&canRetry&&attempt===0){await new Promise(r=>setTimeout(r,300));continue;}
   throw e;
  }
 }
}
async function login(username,password){const out=await request('/auth/login',{username,password});if(out.identity.merchant)throw Error('小程序请使用买家测试账号，商家账号用于网页后台');const previous=session();if(previous?.id!==out.identity.id)wx.removeStorageSync('pet-cart');wx.setStorageSync(key,{apiBase:base(),token:out.token,id:out.identity.id});return out.identity;}
async function logout(){try{await request('/auth/logout',{});}finally{wx.removeStorageSync(key);wx.removeStorageSync('pet-cart');}}
async function call(action,input={}){return paths(await request('/api',{action,input}));}
function checkoutScope(){const identity=session()?.id;if(!identity)throw Error('AUTH_REQUIRED');return 'pet-checkout-v1:'+JSON.stringify([base(),identity]);}
module.exports={call,login,logout,checkoutScope,hasSession:()=>!!session()?.token,mode:'api'};
