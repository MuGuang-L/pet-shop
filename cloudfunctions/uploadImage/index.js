const cloud=require('wx-server-sdk'),crypto=require('node:crypto');
cloud.init({env:cloud.DYNAMIC_CURRENT_ENV});
exports.main=async event=>{try{
  const {OPENID}=cloud.getWXContext();if(!OPENID)throw Error('AUTH_REQUIRED');
  const r=await cloud.database().collection('merchants').doc(OPENID).get().catch(()=>({data:null}));
  if(!r.data||r.data.enabled!==true)throw Error('FORBIDDEN');
  if(typeof event.base64!=='string'||event.base64.length>2800000)throw Error('IMAGE_TOO_LARGE');
  const data=Buffer.from(event.base64,'base64');
  const png=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpg=data[0]===255&&data[1]===216&&data[2]===255;
  if(!png&&!jpg)throw Error('JPEG_OR_PNG_REQUIRED');
  const result=await cloud.uploadFile({cloudPath:'products/'+crypto.randomUUID()+ (png?'.png':'.jpg'),fileContent:data});
  return {ok:true,data:result.fileID};
}catch(e){return {ok:false,error:e.message};}};
