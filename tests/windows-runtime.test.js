'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
function run(codes){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pet-runtime-runner-'));
 try{
  fs.mkdirSync(path.join(root,'scripts'));
  fs.copyFileSync(path.join(__dirname,'../scripts/run-supervised.ps1'),path.join(root,'scripts/run-supervised.ps1'));
  fs.writeFileSync(path.join(root,'codes.json'),JSON.stringify(codes));
  fs.writeFileSync(path.join(root,'scripts/service-runtime.js'),`const fs=require('node:fs');const file='attempts.json';const a=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):[];a.push({pid:process.pid,args:process.argv.slice(2)});fs.writeFileSync(file,JSON.stringify(a));const codes=JSON.parse(fs.readFileSync('codes.json'));process.exit(codes[Math.min(a.length-1,codes.length-1)]);`);
  const child=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(root,'scripts/run-supervised.ps1'),'-RestartDelaySeconds','0'],{cwd:root,windowsHide:true,encoding:'utf8',timeout:20000});
  assert.ifError(child.error);const attempts=JSON.parse(fs.readFileSync(path.join(root,'attempts.json')));for(const a of attempts)assert.deepEqual(a.args,['start']);
  return {status:child.status,attempts,output:child.stdout+child.stderr};
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('Windows 启动入口：正常退出不重启',{skip:process.platform!=='win32'},()=>{const r=run([0]);assert.equal(r.status,0,r.output);assert.equal(r.attempts.length,1);});
test('Windows 启动入口：失败后恢复，随后正常退出终止重试',{skip:process.platform!=='win32'},()=>{const r=run([7,0]);assert.equal(r.status,0,r.output);assert.equal(r.attempts.length,2);assert.match(r.output,/retry 1 of 3/);});
test('Windows 启动入口：连续失败最多重试三次并保留失败状态',{skip:process.platform!=='win32'},()=>{const r=run([7]);assert.equal(r.status,7,r.output);assert.equal(r.attempts.length,4);assert.match(r.output,/retry 3 of 3/);});
