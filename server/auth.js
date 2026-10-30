'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const location=path.join(require('./data-paths').dataDirectory,'auth/accounts.json');
const hash=(password,salt)=>crypto.scryptSync(password,salt,32).toString('hex');
function createAccount(username,password,role,id){const salt=crypto.randomBytes(16).toString('hex');return {username,role,id,salt,hash:hash(password,salt)};}
function loadAccounts(){if(!fs.existsSync(location))throw Error('Run npm run setup:accounts first');return JSON.parse(fs.readFileSync(location,'utf8'));}
const deriveKey=(password,salt)=>new Promise((resolve,reject)=>crypto.scrypt(password,salt,32,(error,key)=>error?reject(error):resolve(key)));
const sessionTtl=8*60*60*1000,windowMs=60000;
const invalidAccount=()=>{throw Error('INVALID_ACCOUNT_CONFIGURATION');};
function validateAccounts(accounts){
 if(!Array.isArray(accounts))invalidAccount();
 const names=new Set(),ids=new Set();
 for(const account of accounts){
  if(!account||typeof account.username!=='string'||!account.username.length||account.username.length>80||account.username!==account.username.toLowerCase()||
   typeof account.id!=='string'||!account.id.length||account.id.length>128||!['buyer','merchant'].includes(account.role)||
   typeof account.salt!=='string'||!(/^[a-f0-9]{32}$/).test(account.salt)||typeof account.hash!=='string'||!(/^[a-f0-9]{64}$/).test(account.hash)||
   names.has(account.username)||ids.has(account.id))invalidAccount();
  names.add(account.username);ids.add(account.id);
 }
 return accounts.map(account=>({...account}));
}
class Auth{
 constructor(accounts=loadAccounts(),{now=Date.now,deriveKey:derive=deriveKey}={}){
  this.accounts=validateAccounts(accounts);this.lookup=new Map(this.accounts.map(a=>[a.username,a]));
  this.sessions=new Map();this.attempts=new Map();this.globalAttempts={count:0,until:0};
  this.unknownAccount=Symbol('unknown-account');this.dummySalt=crypto.randomBytes(16).toString('hex');
  this.now=now;this.deriveKey=derive;this.activeLogins=0;
 }
 prune(now){
  for(const [key,value] of this.attempts)if(value.until<=now)this.attempts.delete(key);
  for(const [token,session] of this.sessions)if(session.expiresAt<=now)this.sessions.delete(token);
 }
 async login(username,password){
  if(typeof username!=='string'||!username.length||username.length>80||typeof password!=='string'||password.length>200)throw Error('INVALID_CREDENTIALS');
  const now=this.now();this.prune(now);
  const key=username.toLowerCase(),account=this.lookup.get(key),bucket=account?key:this.unknownAccount;
  if(this.globalAttempts.until<=now)this.globalAttempts={count:0,until:now+windowMs};
  const limit=this.attempts.get(bucket)||{count:0,until:now+windowMs};
  const exhausted=this.globalAttempts.count>=60?this.globalAttempts:limit.count>=10?limit:null;
  if(exhausted)throw Object.assign(Error('LOGIN_RATE_LIMIT'),{retryAfter:Math.max(1,Math.ceil((exhausted.until-now)/1000))});
  // Do not queue costly password work or occupy the event loop. Leave worker
  // capacity for other I/O, and never trust proxy IP headers for this budget.
  if(this.activeLogins>=2)throw Object.assign(Error('LOGIN_BUSY'),{retryAfter:1});
  limit.count++;this.attempts.set(bucket,limit);this.globalAttempts.count++;this.activeLogins++;
  try{
   const actual=await this.deriveKey(password,account?.salt||this.dummySalt);
   const expected=account?Buffer.from(account.hash,'hex'):Buffer.alloc(32);
   if(!crypto.timingSafeEqual(actual,expected)||!account)throw Error('INVALID_CREDENTIALS');
   if(this.attempts.get(bucket)===limit)this.attempts.delete(bucket);
   const issuedAt=this.now();this.prune(issuedAt);
   const ownTokens=[...this.sessions].filter(([,session])=>session.identity.id===account.id).map(([token])=>token);
   while(ownTokens.length>=8)this.sessions.delete(ownTokens.shift());
   while(this.sessions.size>=256)this.sessions.delete(this.sessions.keys().next().value);
   const token=crypto.randomBytes(32).toString('hex');
   const identity={id:account.id,merchant:account.role==='merchant',username:account.username};
   this.sessions.set(token,{identity,expiresAt:issuedAt+sessionTtl});return {token,identity,expiresIn:sessionTtl/1000};
  }finally{this.activeLogins--;}
 }
 token(req){
  const bearer=req.headers.authorization;
  const token=bearer!==undefined?(typeof bearer==='string'&&bearer.startsWith('Bearer ')?bearer.slice(7):undefined):String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('pet_session='))?.slice(12);
  return typeof token==='string'&&/^[a-f0-9]{64}$/.test(token)?token:undefined;
 }
 identity(req){const token=this.token(req),session=this.sessions.get(token);if(!session||session.expiresAt<=this.now()){this.sessions.delete(token);throw Error('AUTH_REQUIRED');}return session.identity;}
 cloudBuyer(req){
  const read=name=>{const value=req.headers[name];return typeof value==='string'?value.trim():'';};
  // CloudBase uses X-WX-FROM-OPENID when this service is reached through
  // resource reuse.  It is the end user's trusted identifier in that route.
  const openid=read('x-wx-openid')||read('x-wx-from-openid'),source=read('x-wx-source');
  if(!openid&&!source)return null;
  if(!/^[A-Za-z0-9_-]{8,64}$/.test(openid)||!['wx_client','wx_devtools'].includes(source))throw Error('AUTH_REQUIRED');
  return {id:'wx:'+openid,merchant:false,openid,appid:read('x-wx-appid'),channel:'wechat'};
 }
 logout(req){this.sessions.delete(this.token(req));}
 openSession(identity){
  if(!identity||typeof identity.id!=='string'||!identity.id.length||identity.id.length>128||identity.merchant!==false||typeof identity.openid!=='string'||!identity.openid.length)throw Error('AUTH_REQUIRED');
  const issuedAt=this.now();this.prune(issuedAt);
  const ownTokens=[...this.sessions].filter(([,session])=>session.identity.id===identity.id).map(([token])=>token);
  while(ownTokens.length>=8)this.sessions.delete(ownTokens.shift());
  while(this.sessions.size>=256)this.sessions.delete(this.sessions.keys().next().value);
  const token=crypto.randomBytes(32).toString('hex');
  const sessionIdentity={id:identity.id,merchant:false,openid:identity.openid,channel:'wechat'};
  this.sessions.set(token,{identity:sessionIdentity,expiresAt:issuedAt+sessionTtl});
  return {token,identity:sessionIdentity,expiresIn:sessionTtl/1000};
 }
}
const buyerActions=new Set(['catalog','storefront','homeContent','identity','addresses','saveAddress','deleteAddress','createOrder','orders','ordersPage','order','cancel','payment','mockPay','confirmReceipt','tracking','refundRequest','refundWithdraw','returnShip']);
const merchantActions=new Set(['catalog','storefront','homeContent','identity','merchantProducts','merchantOrders','merchantOrdersPage','order','tracking','saveProduct','saveStorefront','saveHomeContent','ship','pickupReady','pickupRedeem','refundReview','returnInspect','refundFail','mockRefund']);
buyerActions.add('shopSettings');buyerActions.add('quoteOrder');
for(const a of ['recordFulfillmentIssue','resolveFulfillmentIssue','merchantRefund'])merchantActions.add(a);
merchantActions.add('adjustStock');merchantActions.add('stockHistory');
merchantActions.add('shopSettings');merchantActions.add('quoteOrder');merchantActions.add('saveShopSettings');
function authorize(actor,action){if(!(actor.merchant?merchantActions:buyerActions).has(action))throw Error('FORBIDDEN');}
module.exports={Auth,authorize,createAccount,location};
