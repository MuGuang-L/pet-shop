'use strict';
const crypto=require('node:crypto');

function sign(privateKey,message){
  return crypto.createSign('RSA-SHA256').update(message).sign(privateKey,'base64');
}
function verify(publicKey,message,signature){
  return crypto.createVerify('RSA-SHA256').update(message).verify(publicKey,signature,'base64');
}
function authorization({mchId,serial,privateKey,method,urlPath,body}){
  const timestamp=Math.floor(Date.now()/1000).toString();
  const nonce=crypto.randomBytes(16).toString('hex');
  const signature=sign(privateKey,`${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`);
  return {
    Authorization:`WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serial}",signature="${signature}"`,
    Accept:'application/json','Content-Type':'application/json','User-Agent':'pet-shop-wechat-pay'
  };
}
function verifyNotify({publicKey,timestamp,nonce,body,signature,now=Date.now()}){
  const ts=Number(timestamp);
  if(!Number.isFinite(ts)||Math.abs(Math.floor(now/1000)-ts)>300)throw Error('WECHAT_TIMESTAMP');
  if(!nonce||typeof signature!=='string'||!signature)throw Error('WECHAT_SIGNATURE');
  if(!verify(publicKey,`${timestamp}\n${nonce}\n${body}\n`,signature))throw Error('WECHAT_SIGNATURE');
}
function decryptResource({apiV3Key,nonce,associatedData,ciphertext}){
  if(typeof apiV3Key!=='string'||Buffer.byteLength(apiV3Key)!==32)throw Error('WECHAT_API_V3_KEY');
  const buf=Buffer.from(String(ciphertext||''),'base64');
  if(buf.length<=16)throw Error('WECHAT_CIPHERTEXT');
  const decipher=crypto.createDecipheriv('aes-256-gcm',Buffer.from(apiV3Key),Buffer.from(nonce));
  if(associatedData)decipher.setAAD(Buffer.from(associatedData));
  decipher.setAuthTag(buf.subarray(buf.length-16));
  return Buffer.concat([decipher.update(buf.subarray(0,buf.length-16)),decipher.final()]).toString('utf8');
}
function jsapiParams({appId,privateKey,prepayId}){
  const timeStamp=Math.floor(Date.now()/1000).toString();
  const nonceStr=crypto.randomBytes(16).toString('hex');
  const pack=`prepay_id=${prepayId}`;
  return {appId,timeStamp,nonceStr,package:pack,signType:'RSA',paySign:sign(privateKey,`${appId}\n${timeStamp}\n${nonceStr}\n${pack}\n`)};
}
function tradeNo(prefix){return prefix+crypto.randomBytes(12).toString('hex');}
function clip(text,max=120){
  const buf=Buffer.from(String(text||''));
  if(buf.length<=max)return String(text||'');
  let end=max;while(end>0&&(buf[end]&0b11000000)===0b10000000)end--;
  return buf.subarray(0,end).toString('utf8');
}
module.exports={sign,verify,authorization,verifyNotify,decryptResource,jsapiParams,tradeNo,clip};
