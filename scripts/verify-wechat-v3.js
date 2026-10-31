'use strict';
// Read-only: query a random nonexistent order. Never create orders or refunds.
const crypto=require('node:crypto');
const {authorization,verifyNotify}=require('../server/wechat-crypto');
async function probe(config,fetchImpl=global.fetch){
 for(const field of ['mchId','mchSerial','privateKey','platformPublicKeyId','platformPublicKey'])if(!config[field])throw Error('WECHAT_PROBE_CONFIG_REQUIRED');
 const urlPath='/v3/pay/transactions/out-trade-no/VERIFY'+crypto.randomBytes(10).toString('hex')+'?mchid='+encodeURIComponent(config.mchId);
 const headers=authorization({mchId:config.mchId,serial:config.mchSerial,privateKey:config.privateKey,method:'GET',urlPath,body:''});headers['Wechatpay-Serial']=config.platformPublicKeyId;
 const response=await fetchImpl('https://api.mch.weixin.qq.com'+urlPath,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(15000)});
 const body=await response.text();
 if(response.headers.get('wechatpay-serial')!==config.platformPublicKeyId)throw Error('WECHAT_PUBLIC_KEY_ID');
 verifyNotify({publicKey:config.platformPublicKey,timestamp:response.headers.get('wechatpay-timestamp'),nonce:response.headers.get('wechatpay-nonce'),signature:response.headers.get('wechatpay-signature'),body});
 const data=JSON.parse(body),code=typeof data.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(data.code)?data.code:null;
 return {readOnly:true,httpStatus:response.status,code,signatureValid:true,authenticationVerified:response.status===404&&code==='ORDER_NOT_EXIST'};
}
if(require.main===module)probe(require('../server/wechat-config').loadWechat().config).then(result=>{console.log(JSON.stringify(result));if(!result.authenticationVerified)process.exitCode=1;}).catch(error=>{console.error(/^[A-Z0-9_]{1,80}$/.test(error.message||'')?error.message:'WECHAT_PROBE_FAILED');process.exitCode=1;});
module.exports={probe};
