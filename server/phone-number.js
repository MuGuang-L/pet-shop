'use strict';
// Exchanges a getPhoneNumber code inside cloud hosting. The code is single-use and lasts 5 minutes.
// The open-interface sidecar injects the token for http://api.weixin.qq.com; a public HTTPS call does not.
function wechatCode(body){
 if(!body||typeof body!=='object'||body.errcode===undefined||body.errcode===null||body.errcode==='')return 0;
 const code=Number(body.errcode);
 return Number.isFinite(code)?code:0;
}
function phoneFromWechat(body,appId){
 const code=wechatCode(body);
 if(code){
  if(code===40029)throw Error('手机号验证已过期，请重新授权');
  if(code===40013)throw Error('手机号验证与当前小程序不一致');
  if(code===45011)throw Error('手机号验证过于频繁，请稍后再试');
  if(code===40001||code===40014||code===41001||code===42001||code===48001)throw Error('云托管还不能调用获取手机号。请在云托管「云调用 → 微信令牌」中加入 /wxa/business/getuserphonenumber，保存后再发布一个版本');
  throw Error('微信暂时无法验证手机号（'+code+'）');
 }
 const info=body?.phone_info;
 if(!info||typeof info.purePhoneNumber!=='string')throw Error('微信没有返回手机号');
 if(appId&&info.watermark?.appid&&info.watermark.appid!==appId)throw Error('手机号验证与当前小程序不一致');
 if(String(info.countryCode)!=='86'||!/^1\d{10}$/.test(info.purePhoneNumber))throw Error('请使用中国大陆手机号');
 return info.purePhoneNumber;
}
function createPhoneBinder({fetch:fetchImpl=globalThis.fetch,appId='',cloud=false}={}){
 return async function bindInput(actor,input={}){
  if(actor.channel!=='wechat')return input;
  const code=input.code;
  if(typeof code!=='string'||!/^[A-Za-z0-9]{8,128}$/.test(code))throw Error('请使用微信验证手机号');
  if(!cloud)throw Error('手机号验证需在云托管内完成');
  if(typeof actor.openid!=='string'||!actor.openid)throw Error('AUTH_REQUIRED');
  let response;
  try{response=await fetchImpl('http://api.weixin.qq.com/wxa/business/getuserphonenumber',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,openid:actor.openid}),redirect:'error',signal:AbortSignal.timeout(8000)});}
  catch{throw Error('暂时联系不上微信的手机号接口，请稍后再试');}
  const text=await response.text();
  let body={};
  if(text){try{body=JSON.parse(text);}catch{throw Error('微信暂时无法验证手机号（HTTP '+response.status+'）');}}
  if(!response.ok&&!wechatCode(body))throw Error('微信暂时无法验证手机号（HTTP '+response.status+'）');
  return {phone:phoneFromWechat(body,appId)};
 };
}
module.exports={phoneFromWechat,createPhoneBinder};
