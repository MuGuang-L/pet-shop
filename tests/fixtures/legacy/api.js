const config=require('../config');
const domain=require('../lib/domain');
let demoMerchant=false;
const key='pet-shop-mock-v1';
function setDemoMerchant(value){if(!['mock','local'].includes(config.mode))throw Error('MOCK_DISABLED');demoMerchant=value;}
function base(){const url=config.apiBase||'http://127.0.0.1:4173';if(!/^http:\/\/(127\.0\.0\.1|localhost):4173$/.test(url))throw Error('LOCAL_API_MUST_USE_LOOPBACK');return url;}
function paths(value,incoming){if(typeof value==='string'){if(incoming&&/^\/(assets|uploads)\//.test(value))return base()+value;if(!incoming&&value.startsWith(base()+'/'))return value.slice(base().length);return value;}if(Array.isArray(value))return value.map(v=>paths(v,incoming));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,paths(v,incoming)]));return value;}
function request(endpoint,data){return new Promise((resolve,reject)=>wx.request({url:base()+endpoint,method:'POST',data,timeout:15000,success:r=>{if(r.statusCode!==200||!r.data||!r.data.ok)return reject(Error(r.data&&r.data.error||'本地服务请求失败'));resolve(r.data);},fail:()=>reject(Error('连接本地服务失败，请启动 MongoDB 和商城服务，并检查开发工具本地网络设置'))}));}
async function call(action,input={}){
  if(config.mode==='local'){const out=await request('/api',{action,input:paths(input,false),role:demoMerchant?'merchant':'buyer'});return paths(out.data,true);}
  if(config.mode==='mock'){
    const state=wx.getStorageSync(key)||domain.seed();
    const out=domain.execute(state,{id:'demo-buyer',merchant:demoMerchant},action,input,{mock:true});
    wx.setStorageSync(key,out.state);return out.result;
  }
  if(config.mode!=='cloud'||!config.cloudEnv)throw Error('CLOUDBASE_ENV_REQUIRED');
  const r=await wx.cloud.callFunction({name:'shop',data:{action,input}});
  if(!r.result||!r.result.ok)throw Error(r.result&&r.result.error||'CLOUD_ERROR');
  return r.result.data;
}
async function upload(path){
  if(config.mode==='mock')return new Promise((resolve,reject)=>wx.getFileSystemManager().saveFile({tempFilePath:path,success:r=>resolve(r.savedFilePath),fail:r=>reject(Error((r&&r.errMsg)||'图片保存失败'))}));
  const base64=await new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:path,encoding:'base64',success:r=>resolve(r.data),fail:r=>reject(Error((r&&r.errMsg)||'图片读取失败'))}));
  if(config.mode==='local'){const out=await request('/upload',{role:demoMerchant?'merchant':'buyer',base64});return base()+out.path;}
  const r=await wx.cloud.callFunction({name:'uploadImage',data:{base64}});if(!r.result.ok)throw Error(r.result.error);return r.result.data;
}
module.exports={call,upload,setDemoMerchant,mode:config.mode};
