'use strict';
// Exchanges a getPhoneNumber code. The code is single-use and lasts 5 minutes.
function phoneFromWechat(body,appId){
 if(!body||typeof body!=='object'||body.errcode){
  const code=body?.errcode;
  if(code===40029)throw Error('手机号验证已过期，请重新授权');
  if(code===40013)throw Error('手机号验证与当前小程序不一致');
  if(code===45011)throw Error('手机号验证过于频繁，请稍后再试');
  throw Error('微信暂时无法验证手机号');
 }
 const info=body.phone_info;
 if(!info||typeof info.purePhoneNumber!=='string')throw Error('微信没有返回手机号');
 if(appId&&info.watermark?.appid&&info.watermark.appid!==appId)throw Error('手机号验证与当前小程序不一致');
 if(String(info.countryCode)!=='86'||!/^1\d{10}$/.test(info.purePhoneNumber))throw Error('请使用中国大陆手机号');
 return info.purePhoneNumber;
}
function cloudCallToken(req){
 if(!req?.headers)return '';
 const reused=typeof req.headers['x-wx-from-openid']==='string'&&req.headers['x-wx-from-openid'].trim();
 const value=req.headers[reused?'x-wx-from-cloudbase-access-token':'x-wx-cloudbase-access-token'];
 return typeof value==='string'&&/^[A-Za-z0-9@._-]{16,512}$/.test(value.trim())?value.trim():'';
}
function createPhoneBinder({fetch:fetchImpl=globalThis.fetch,appId='',cloud=false}={}){
 return async function bindInput(actor,input={},req){
  if(actor.channel!=='wechat')return input;
  const code=input.code;
  if(typeof code!=='string'||!/^[A-Za-z0-9]{8,128}$/.test(code))throw Error('请使用微信验证手机号');
  if(typeof actor.openid!=='string'||!actor.openid)throw Error('AUTH_REQUIRED');
  const token=cloudCallToken(req);
  if(!token&&!cloud)throw Error('手机号验证需在云托管内完成');
  const url=token?'https://api.weixin.qq.com/wxa/business/getuserphonenumber?cloudbase_access_token='+encodeURIComponent(token):'http://api.weixin.qq.com/wxa/business/getuserphonenumber';
  let response;
  try{response=await fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,openid:actor.openid}),redirect:'error',signal:AbortSignal.timeout(8000)});}
  catch{throw Error('微信暂时无法验证手机号');}
  const text=await response.text();
  let body={};
  if(text){try{body=JSON.parse(text);}catch{throw Error('微信暂时无法验证手机号');}}
  if(!response.ok&&!body.errcode)throw Error('微信暂时无法验证手机号');
  return {phone:phoneFromWechat(body,appId)};
 };
}
module.exports={phoneFromWechat,createPhoneBinder};
