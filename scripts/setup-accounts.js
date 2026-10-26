'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createAccount,location}=require('../server/auth');
function setupAccounts(file=location){
 if(fs.existsSync(file))return false;
 const users=[['merchant','merchant','shop-owner'],['buyer','buyer','demo-buyer'],['friend','buyer','friend-buyer']]
  .map(([username,role,id])=>({username,role,id,password:crypto.randomBytes(15).toString('base64url')}));
 const directory=path.dirname(file);fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(file,JSON.stringify(users.map(x=>createAccount(x.username,x.password,x.role,x.id)),null,2),{mode:0o600,flag:'wx'});
 fs.writeFileSync(path.join(directory,'credentials.txt'),users.map(x=>`${x.username} (${x.role})\n${x.password}\n`).join('\n'),{mode:0o600,flag:'wx'});
 fs.writeFileSync(path.join(directory,'friend-credentials.txt'),`仅供小程序侧联调，不含商家权限\n用户名：friend\n密码：${users.find(x=>x.username==='friend').password}\n`,{mode:0o600,flag:'wx'});
 return true;
}
if(require.main===module){
 try{console.log(setupAccounts()?'Created development accounts. Read auth/credentials.txt in the local data directory. Passwords are not printed.':'Accounts already configured; nothing overwritten.');}
 catch{console.error('Account setup failed; inspect the local auth directory. Existing files were not replaced.');process.exitCode=1;}
}
module.exports={setupAccounts};
