'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');const {Auth,authorize}=require('./auth');const uploads=require('./uploads');const {createWechat}=require('./wechat');
const root=path.join(__dirname,'..');
function createServer(store,{auth=new Auth(),publicOrigin=process.env.PUBLIC_ORIGIN||'',uploadsDirectory=uploads.directory,runtimeId=process.env.SHOP_RUNTIME_ID||'',wechat=null,cloudIdentity=wechat?.cloudIdentity,fetch,onActivity=()=>()=>{}}={}){
 if(runtimeId&&!/^[a-f0-9-]{36}$/.test(runtimeId))throw Error('INVALID_RUNTIME_ID');
 if(publicOrigin&&(!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(publicOrigin)))throw Error('PUBLIC_ORIGIN must be an HTTPS origin without path');
 const gateway=createWechat({settings:wechat,store,auth,fetch,now:wechat?.now});
 const server=http.createServer(async(req,res)=>{let endActivity=()=>{};try{const send=(status,data)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
 const origin=req.headers.origin,allowed=[publicOrigin,'http://127.0.0.1:4173','http://localhost:4173'].filter(Boolean);
 if(origin&&!allowed.includes(origin))return send(403,{ok:false,error:'ORIGIN_NOT_ALLOWED'});
 if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Vary','Origin');}
 if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.writeHead(204);return res.end();}
 let parsed;
 try{parsed=new URL(req.url,'http://localhost');}catch{return send(400,{ok:false,error:'INVALID_REQUEST_URL'});}
 const url=parsed.pathname;
 // Track the full asynchronous request, including callbacks and failures.
 if(req.method==='POST')endActivity=onActivity();
 try{if(await gateway.handle(req,res,parsed))return;}catch(e){if(!res.writableEnded)return send(400,{ok:false,error:e.message||'WECHAT_NOTIFY_FAILED'});return;}
 const file=(target,type)=>{res.setHeader('Content-Type',type);res.end(fs.readFileSync(target));};
 try{
 if(req.method==='GET'){
 if(url==='/live')return send(200,{ok:true});
 if(url==='/health'){await (typeof store.ping==='function'?store.ping():store.db.command({ping:1}));const missing=gateway.missing();return send(200,{ok:true,mode:gateway.payReady()?'wechat':'simulation',database:store.engine==='mysql'?'mysql':'mongodb',wechatPay:gateway.payReady(),...(missing.length?{wechatMissing:missing}:{}),...(runtimeId?{runtimeId}:{})});}
 if(url==='/'){res.writeHead(302,{Location:'/admin/'});return res.end();}
 if(url==='/admin/'||url==='/admin')return file(path.join(root,'apps/merchant-web/index.html'),'text/html; charset=utf-8');
 if(['/admin/settings.js','/admin/app.js','/admin/app.css','/admin/base.css'].includes(url))return file(path.join(root,'apps/merchant-web',path.basename(url)),url.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');
 if(url==='/studio.js')return file(path.join(root,'cloudfunctions/shop/studio.js'),'text/javascript; charset=utf-8');
 if(/^\/assets\/[a-z0-9-]+\.(png|jpg)$/.test(url)){const p=path.join(root,'miniprogram',url);if(fs.existsSync(p))return file(p,url.endsWith('png')?'image/png':'image/jpeg');}
 if(/^\/uploads\/[a-f0-9-]+\.(png|jpg)$/.test(url)){const p=path.join(uploadsDirectory,path.basename(url));if(fs.existsSync(p))return file(p,url.endsWith('png')?'image/png':'image/jpeg');}
 return send(404,{ok:false,error:'NOT_FOUND'});}
 if(req.method!=='POST'||!['/auth/login','/auth/me','/auth/logout','/api','/upload'].includes(url))return send(404,{ok:false,error:'NOT_FOUND'});
 let raw='',size=0;for await(const chunk of req){size+=chunk.length;if(size>(url==='/upload'?2900000:100000))throw Error('BODY_TOO_LARGE');raw+=chunk;}let body;try{body=JSON.parse(raw||'{}');}catch{throw Error('INVALID_JSON');}if(!body||typeof body!=='object'||Array.isArray(body))throw Error('INVALID_BODY');
 if(url==='/auth/login'){if(typeof body.username!=='string'||body.username.length>80||typeof body.password!=='string'||body.password.length>200)throw Error('INVALID_CREDENTIALS');const login=await auth.login(body.username,body.password);res.setHeader('Set-Cookie',`pet_session=${login.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${publicOrigin?'; Secure':''}`);return send(200,{ok:true,data:login});}
 const cloud=!auth.token?.(req)&&typeof auth.cloudBuyer==='function'?auth.cloudBuyer(req,cloudIdentity):null,actor=cloud||auth.identity(req);
 if(url==='/auth/logout'){if(!cloud)auth.logout(req);res.setHeader('Set-Cookie','pet_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(200,{ok:true,data:true});}
 if(url==='/auth/me')return send(200,{ok:true,data:actor});
 // Cookies require an explicitly trusted Origin for browser mutations; native clients use Bearer tokens.
 if(!cloud&&!req.headers.authorization&&(!origin||!allowed.includes(origin)))return send(403,{ok:false,error:'ORIGIN_REQUIRED'});
 if(url==='/upload'){if(!actor.merchant)throw Error('FORBIDDEN');return send(200,{ok:true,path:await uploads.save({...body,role:'merchant'},{directory:uploadsDirectory})});}
 const mock=actor.channel!=='wechat';
 if(body.action==='payment'&&gateway.payReady())return send(200,{ok:true,data:await gateway.createPayment(actor,body.input||{},req)});
 if(body.action==='paymentSync'){if(!gateway.payReady())throw Error('REAL_PAYMENT_NOT_CONFIGURED');return send(200,{ok:true,data:await gateway.syncPayment(actor,body.input||{},req)});}
 if(actor.merchant&&['mockRefund','refundFail'].includes(body.action)){const preview=await store.execute(actor,'order',body.input||{},{mock:true});if(preview.payment?.provider==='WECHAT'){if(!gateway.payReady())throw Error('REAL_PAYMENT_NOT_CONFIGURED');if(body.action==='refundFail')throw Error('WECHAT_REFUND_IS_REAL');return send(200,{ok:true,data:await gateway.refund(actor,body.input||{},req)});}}
 authorize(actor,body.action);const data=await store.execute(actor,body.action,body.input||{},{mock});return send(200,{ok:true,data});
 }catch(e){if(e.message==='UPLOAD_BUSY'){res.setHeader('Retry-After','1');return send(503,{ok:false,error:'UPLOAD_BUSY',retryable:true});}const databaseError=/^(Mongo|MysqlUnavailable)/.test(e.name),internalError=['TypeError','RangeError'].includes(e.name)||typeof e.code==='string';const loginBusy=e.message==='LOGIN_BUSY'||e.message==='PAYMENT_REVISION_CONFLICT';const retryable=databaseError||internalError||loginBusy;const status=databaseError||loginBusy?503:internalError?500:e.message==='AUTH_REQUIRED'?401:e.message==='FORBIDDEN'?403:e.message==='LOGIN_RATE_LIMIT'?429:e.message==='BODY_TOO_LARGE'?413:400;if((status===429||loginBusy)&&Number.isInteger(e.retryAfter))res.setHeader('Retry-After',String(Math.min(60,Math.max(1,e.retryAfter))));send(status,{ok:false,error:databaseError?'DATABASE_TEMPORARILY_UNAVAILABLE':internalError?'SERVICE_TEMPORARILY_UNAVAILABLE':e.message,...(retryable?{retryable:true}:{})});}
 }finally{endActivity();}
 });
 server.requestTimeout=20000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
 server.reconcilePayments=()=>gateway.reconcile();
 return server;
}
module.exports={createServer};
