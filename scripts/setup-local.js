'use strict';
const fs=require('node:fs'),path=require('node:path');
const {setupAccounts}=require('./setup-accounts');
function setupLocal({root=path.resolve(__dirname,'..'),dataDirectory=require('../server/data-paths').dataDirectory}={}){
 const created=[];
 for(const [source,target] of [
  ['miniprogram/config.example.js','miniprogram/config.local.js'],
  ['project.example.json','project.config.json'],
  ['deploy/runtime.example.json',path.join(dataDirectory,'runtime/config.json')]
 ]){
  const destination=path.resolve(root,target);
  if(fs.existsSync(destination))continue;
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.copyFileSync(path.join(root,source),destination,fs.constants.COPYFILE_EXCL);created.push(source);
 }
 const accountsCreated=setupAccounts(path.join(dataDirectory,'auth/accounts.json'));
 return {created,accountsCreated};
}
if(require.main===module){
 try{const result=setupLocal();console.log(`Local setup ready (${result.created.length} configuration files created; accounts ${result.accountsCreated?'created':'retained'}). Existing settings and data were not replaced.`);console.log('Default local URL: http://127.0.0.1:4173/admin/ . Start with npm run service:start. Credentials: auth/credentials.txt in the local data directory (default .local/).');}
 catch{console.error('Local setup failed; check template files and write access. Existing files were not replaced.');process.exitCode=1;}
}
module.exports={setupLocal};
