'use strict';
const fs=require('node:fs'),path=require('node:path');
const {dataDirectory}=require('./data-paths');
const root=path.join(__dirname,'..');

function loadDotEnv(file){
  if(!fs.existsSync(file))return;
  for(const line of fs.readFileSync(file,'utf8').split('\n')){
    const text=line.trim();
    if(!text||text.startsWith('#'))continue;
    const split=text.indexOf('=');
    if(split<1)continue;
    const key=text.slice(0,split).trim();
    let value=text.slice(split+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    if(process.env[key]===undefined)process.env[key]=value.replace(/\\n/g,'\n');
  }
}
function readKey(file){
  if(!file)return '';
  const target=path.isAbsolute(file)?file:path.resolve(root,file);
  return fs.existsSync(target)?fs.readFileSync(target,'utf8'):'';
}
function loadWechat(){
  loadDotEnv(path.join(root,'.env'));
  const jsonFile=path.join(dataDirectory,'wechat.json');
  const json=fs.existsSync(jsonFile)?JSON.parse(fs.readFileSync(jsonFile,'utf8')):{};
  const pick=(key,env)=>json[key]||process.env[env]||'';
  const fromEnv=typeof process.env.PUBLIC_ORIGIN==='string'?process.env.PUBLIC_ORIGIN.trim():'';
  let runtimeOrigin='';
  try{const runtime=JSON.parse(fs.readFileSync(path.join(dataDirectory,'runtime/config.json'),'utf8'));if(typeof runtime.publicOrigin==='string')runtimeOrigin=runtime.publicOrigin.trim();}catch{}
  const publicOrigin=fromEnv||String(json.publicOrigin||'').trim()||runtimeOrigin;
  const config={
    appId:String(pick('appId','WECHAT_APPID')||process.env.WECHAT_OA_APPID||''),
    appSecret:String(pick('appSecret','WECHAT_OA_SECRET')),
    mchId:String(pick('mchId','WECHAT_MCH_ID')),
    mchSerial:String(pick('mchSerial','WECHAT_MCH_SERIAL')),
    apiV3Key:String(pick('apiV3Key','WECHAT_API_V3_KEY')),
    privateKey:String(pick('privateKey','WECHAT_MCH_PRIVATE_KEY')||readKey(pick('privateKeyPath','WECHAT_MCH_PRIVATE_KEY_PATH'))),
    platformPublicKeyId:String(pick('platformPublicKeyId','WECHAT_PAY_PUBLIC_KEY_ID')),
    platformPublicKey:String(pick('platformPublicKey','WECHAT_PAY_PUBLIC_KEY')||readKey(pick('platformPublicKeyPath','WECHAT_PAY_PUBLIC_KEY_PATH')||pick('platformCertPath','WECHAT_PLATFORM_CERT_PATH'))),
    publicOrigin
  };
  const https=/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(publicOrigin);
  const payMissing=['appId','mchId','mchSerial','privateKey'].filter(key=>!config[key]);
  if(Buffer.byteLength(config.apiV3Key||'')!==32)payMissing.push('apiV3Key');
  return {
    config,payReady:payMissing.length===0,payMissing,
    payNotifyUrl:https?publicOrigin+'/wechat/pay/notify':'',
    refundNotifyUrl:https?publicOrigin+'/wechat/refund/notify':''
  };
}
module.exports={loadWechat};
