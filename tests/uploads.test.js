const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),sharp=require('sharp');
const uploads=require('../server/uploads'),{createServer}=require('../server/http');
async function fixture(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'pet-shop-images-'));try{await fn(root);}finally{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'pet-shop-images-'));await fs.rm(root,{recursive:true,force:true});}}
const image=(format='png')=>sharp({create:{width:32,height:16,channels:4,background:{r:20,g:130,b:90,alpha:0.5}}}).toFormat(format).toBuffer();
const input=data=>({role:'merchant',base64:data.toString('base64')});

test('上传完整解码 PNG/JPEG，保留透明度，校正照片朝向并去除元数据',()=>fixture(async directory=>{
 const png=await image();const p=await uploads.save(input(png),{directory});assert.match(p,/\.png$/);
 const decoded=await sharp(await fs.readFile(path.join(directory,path.basename(p)))).metadata();assert.equal(decoded.width,32);assert.equal(decoded.hasAlpha,true);
 const jpeg=await sharp(await image('jpeg')).withMetadata({orientation:6}).jpeg().toBuffer();const j=await uploads.save(input(jpeg),{directory});
 const out=await sharp(await fs.readFile(path.join(directory,path.basename(j)))).metadata();assert.equal(out.width,16);assert.equal(out.height,32);assert.equal(out.exif,undefined);assert.equal(out.orientation,undefined);
 assert.equal((await fs.readdir(directory)).length,2);
}));

test('伪造文件头、截断图片、非法编码和超限数据不落盘',()=>fixture(async directory=>{
 const png=await image(),jpeg=await image('jpeg');
 for(const buffer of [png.subarray(0,8),jpeg.subarray(0,3),png.subarray(0,40),jpeg.subarray(0,Math.floor(jpeg.length/2))])await assert.rejects(uploads.save(input(buffer),{directory}),/图片损坏/);
 for(const base64 of ['','a===','ab==','a'.repeat(2796208)])await assert.rejects(uploads.save({role:'merchant',base64},{directory}),/编码无效/);
 await assert.rejects(uploads.save({role:'buyer',base64:png.toString('base64')},{directory}),/权限/);
 await assert.rejects(uploads.save(input(Buffer.from('<svg/>')),{directory}),/JPG/);
 assert.deepEqual(await fs.readdir(directory),[]);
}));

test('大尺寸图片在上限内缩至展示尺寸，像素超限拒绝',()=>fixture(async directory=>{
 const large=await sharp({create:{width:3000,height:30,channels:3,background:'red'}}).png().toBuffer();
 const saved=await uploads.save(input(large),{directory});const meta=await sharp(await fs.readFile(path.join(directory,path.basename(saved)))).metadata();assert.equal(meta.width,2048);
 const huge=await sharp({create:{width:6500,height:6500,channels:3,background:'white'}}).png().toBuffer();assert.ok(huge.length<2*1024*1024);
 await assert.rejects(uploads.save(input(huge),{directory}),/4000 万像素/);assert.equal((await fs.readdir(directory)).length,1);
}));

test('图片并发有上限且失败释放名额，不积压无限解码任务',()=>fixture(async directory=>{
 const data=input(await image());const results=await Promise.allSettled([uploads.save(data,{directory}),uploads.save(data,{directory}),uploads.save(data,{directory})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,2);assert.equal(results.find(r=>r.status==='rejected').reason.message,'UPLOAD_BUSY');
 await assert.rejects(uploads.save(input(Buffer.from([255,216,255])),{directory}),/图片损坏/);
 await uploads.save(data,{directory});assert.equal((await fs.readdir(directory)).length,3);
}));

test('HTTP 等待图片落盘后返回路径，坏图拒绝后服务仍健康',()=>fixture(async directory=>{
 const store={db:{command:async()=>({ok:1})}},auth={identity:()=>({merchant:true,id:'test'})};
 const server=createServer(store,{auth,publicOrigin:'',uploadsDirectory:directory});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port,post=base64=>fetch(base+'/upload',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test'},body:JSON.stringify({base64})});
  const bad=await post(Buffer.from([255,216,255]).toString('base64'));assert.equal(bad.status,400);assert.match((await bad.json()).error,/图片损坏/);
  assert.equal((await fetch(base+'/health')).status,200);
  const response=await post((await image()).toString('base64'));assert.equal(response.status,200);const body=await response.json();assert.equal(typeof body.path,'string');
  const file=await fetch(base+body.path);assert.equal(file.status,200);assert.equal(file.headers.get('content-type'),'image/png');assert.equal((await sharp(Buffer.from(await file.arrayBuffer())).metadata()).width,32);
 }finally{await new Promise(resolve=>server.close(resolve));}
}));
