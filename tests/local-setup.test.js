'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {setupLocal}=require('../scripts/setup-local'),{Auth}=require('../server/auth');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-shop-setup-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const name of ['miniprogram/config.example.js','project.example.json','deploy/runtime.example.json']){
  const dest=path.join(root,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(__dirname,'..',name),dest);
 }
 return {root,dataDirectory:path.join(root,'.local')};
}
test('fresh local setup creates usable separate identities and loopback configuration',async t=>{
 const options=fixture(t),result=setupLocal(options),read=p=>fs.readFileSync(path.join(options.root,p),'utf8');
 assert.equal(result.created.length,3);assert.equal(result.accountsCreated,true);
 assert.equal(require(path.join(options.root,'miniprogram/config.local.js')).apiBase,'http://127.0.0.1:4173');
 assert.equal(JSON.parse(read('project.config.json')).appid,'touristappid');
 const runtime=JSON.parse(read('.local/runtime/config.json'));assert.equal(runtime.publicOrigin,'');assert.equal(runtime.manageMongo,true);assert.equal(runtime.natapp.enabled,false);
 const auth=new Auth(JSON.parse(read('.local/auth/accounts.json'))),credentials=read('.local/auth/credentials.txt');
 assert.ok(!credentials.includes('\\n'));
 for(const [name,role] of [['buyer','buyer'],['merchant','merchant'],['friend','buyer']]){
  const password=credentials.match(new RegExp(name+' \\('+role+'\\)\\n([^\\n]+)'))?.[1];assert.ok(password);
  const login=await auth.login(name,password);assert.equal(login.identity.merchant,role==='merchant');
 }
 const second=fixture(t);setupLocal(second);assert.notEqual(read('.local/auth/credentials.txt'),fs.readFileSync(path.join(second.dataDirectory,'auth/credentials.txt'),'utf8'));
});
test('repeated setup preserves private endpoint, AppID, runtime, accounts and data',t=>{
 const options=fixture(t);setupLocal(options);
 const names=['miniprogram/config.local.js','project.config.json','.local/runtime/config.json'];
 for(const name of names)fs.writeFileSync(path.join(options.root,name),'private-existing-value');
 fs.writeFileSync(path.join(options.dataDirectory,'business-data.txt'),'existing-orders');
 const account=fs.readFileSync(path.join(options.dataDirectory,'auth/accounts.json'),'utf8');
 assert.deepEqual(setupLocal(options),{created:[],accountsCreated:false});
 for(const name of names)assert.equal(fs.readFileSync(path.join(options.root,name),'utf8'),'private-existing-value');
 assert.equal(fs.readFileSync(path.join(options.dataDirectory,'auth/accounts.json'),'utf8'),account);
 assert.equal(fs.readFileSync(path.join(options.dataDirectory,'business-data.txt'),'utf8'),'existing-orders');
});
