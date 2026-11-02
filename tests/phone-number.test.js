const test=require('node:test'),assert=require('node:assert/strict');
const {phoneFromWechat,createPhoneBinder}=require('../server/phone-number');
const appId='wx77ec437338f58b60';
const info=phone=>({errcode:0,errmsg:'ok',phone_info:{phoneNumber:phone,purePhoneNumber:phone,countryCode:'86',watermark:{timestamp:1,appid:appId}}});

test('微信手机号只接受本小程序的大陆号码',()=>{
 assert.equal(phoneFromWechat(info('13800138000'),appId),'13800138000');
 assert.throws(()=>phoneFromWechat({errcode:40029,errmsg:'invalid code'},appId),/过期/);
 assert.throws(()=>phoneFromWechat({errcode:40001,errmsg:'invalid credential'},appId),/微信令牌/);
 assert.throws(()=>phoneFromWechat({errcode:40013,errmsg:'invalid appid'},appId),/不一致/);
 assert.throws(()=>phoneFromWechat({...info('13800138000'),phone_info:{...info('13800138000').phone_info,watermark:{appid:'wx0000000000000000'}}},appId),/不一致/);
 assert.throws(()=>phoneFromWechat({...info('13800138000'),phone_info:{...info('13800138000').phone_info,countryCode:'1'}},appId),/中国大陆/);
});

test('微信用户必须用快速验证码换号，本地账号仍可写入已核对号码',async()=>{
 const calls=[];
 const bind=createPhoneBinder({appId,cloud:true,fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,text:async()=>JSON.stringify(info('13900001111'))};}});
 const wechat={channel:'wechat',openid:'openid-a'};
 await assert.rejects(bind(wechat,{phone:'13800138000'}),/请使用微信验证手机号/);
 assert.equal((await bind(wechat,{code:'a1b2c3d4'})).phone,'13900001111');
 assert.equal(calls[0].url,'http://api.weixin.qq.com/wxa/business/getuserphonenumber');
 assert.equal(calls[0].url.includes('access_token'),false);
 assert.deepEqual(calls[0].body,{code:'a1b2c3d4',openid:'openid-a'});
 assert.deepEqual(await createPhoneBinder({cloud:false})({channel:'local'},{phone:'13800138000'}),{phone:'13800138000'});
 await assert.rejects(createPhoneBinder({cloud:false})(wechat,{code:'a1b2c3d4'},{headers:{}}),/云托管/);
});
