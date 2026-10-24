'use strict';
const config=require('../config');const key='pet-shop-session-v2';
function base(){const url=(config.apiBase||'http://127.0.0.1:4173').replace(/\/$/,'');if(!/^http:\/\/(127\.0\.0\.1|localhost):4173$/.test(url)&&!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(url))throw Error('API 地址须为本机 4173 端口或 HTTPS 域名');return url;}
function session(){const s=wx.getStorageSync(key);return s&&s.apiBase===base()?s:null;}
function paths(value){if(typeof value==='string')return /^\/(assets|uploads)\//.test(value)?base()+value:value;if(Array.isArray(value))return value.map(paths);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,paths(v)]));return value;}
function request(endpoint,data){const token=session()?.token;return new Promise((resolve,reject)=>wx.request({url:base()+endpoint,method:'POST',data,header:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},timeout:15000,success:r=>{if(r.statusCode===401)wx.removeStorageSync(key);if(r.statusCode!==200||!r.data?.ok)return reject(Error(r.data?.error||'服务请求失败'));resolve(r.data.data);},fail:()=>reject(Error('连接联调服务失败，请检查服务地址、服务状态和网络'))}));}
async function login(username,password){const out=await request('/auth/login',{username,password});if(out.identity.merchant)throw Error('小程序请使用买家测试账号，商家账号用于网页后台');const previous=session();if(previous?.id!==out.identity.id)wx.removeStorageSync('pet-cart');wx.setStorageSync(key,{apiBase:base(),token:out.token,id:out.identity.id});return out.identity;}
async function logout(){try{await request('/auth/logout',{});}finally{wx.removeStorageSync(key);wx.removeStorageSync('pet-cart');}}
async function call(action,input={}){return paths(await request('/api',{action,input}));}
module.exports={call,login,logout,hasSession:()=>!!session()?.token,mode:'api'};
