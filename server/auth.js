'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const location=path.join(require('./data-paths').dataDirectory,'auth/accounts.json');
const hash=(password,salt)=>crypto.scryptSync(password,salt,32).toString('hex');
function createAccount(username,password,role,id){const salt=crypto.randomBytes(16).toString('hex');return {username,role,id,salt,hash:hash(password,salt)};}
function loadAccounts(){if(!fs.existsSync(location))throw Error('Run npm run setup:accounts first');return JSON.parse(fs.readFileSync(location,'utf8'));}
class Auth{
 constructor(accounts=loadAccounts()){this.accounts=accounts;this.sessions=new Map();this.attempts=new Map();}
 login(username,password){const key=String(username||'').toLowerCase();const now=Date.now(),limit=this.attempts.get(key)||{count:0,until:now+60000};if(limit.until<now){limit.count=0;limit.until=now+60000;}if(limit.count>=10)throw Error('LOGIN_RATE_LIMIT');limit.count++;this.attempts.set(key,limit);if(this.attempts.size>10000){for(const [k,v] of this.attempts)if(v.until<now)this.attempts.delete(k);}const a=this.accounts.find(a=>a.username===key);const h=hash(String(password||''),a?.salt||'invalid-account');if(!a||!crypto.timingSafeEqual(Buffer.from(h,'hex'),Buffer.from(a.hash,'hex')))throw Error('INVALID_CREDENTIALS');this.attempts.delete(key);for(const [k,v] of this.sessions)if(v.expiresAt<now)this.sessions.delete(k);const token=crypto.randomBytes(32).toString('hex');const identity={id:a.id,merchant:a.role==='merchant',username:a.username};this.sessions.set(token,{identity,expiresAt:now+8*60*60*1000});return {token,identity,expiresIn:28800};}
 token(req){const bearer=req.headers.authorization;return bearer?.startsWith('Bearer ')?bearer.slice(7):String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('pet_session='))?.slice(12);}
 identity(req){const s=this.sessions.get(this.token(req));if(!s||s.expiresAt<=Date.now())throw Error('AUTH_REQUIRED');return s.identity;}
 logout(req){this.sessions.delete(this.token(req));}
}
const buyerActions=new Set(['catalog','storefront','homeContent','identity','addresses','saveAddress','deleteAddress','createOrder','orders','ordersPage','order','cancel','payment','mockPay','confirmReceipt','tracking','refundRequest','refundWithdraw','returnShip']);
const merchantActions=new Set(['catalog','storefront','homeContent','identity','merchantProducts','merchantOrders','merchantOrdersPage','order','tracking','saveProduct','saveStorefront','saveHomeContent','ship','pickupReady','pickupRedeem','refundReview','returnInspect','refundFail','mockRefund']);
buyerActions.add('shopSettings');buyerActions.add('quoteOrder');
merchantActions.add('adjustStock');merchantActions.add('stockHistory');
merchantActions.add('shopSettings');merchantActions.add('quoteOrder');merchantActions.add('saveShopSettings');
function authorize(actor,action){if(!(actor.merchant?merchantActions:buyerActions).has(action))throw Error('FORBIDDEN');}
module.exports={Auth,authorize,createAccount,location};
