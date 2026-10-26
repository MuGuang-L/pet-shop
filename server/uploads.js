const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp');
const directory=path.join(require('./data-paths').dataDirectory,'uploads');
const maxBytes=2*1024*1024,maxPixels=40000000,maxActive=2;
let active=0;
async function save(input,{directory:targetDirectory=directory}={}){
 if(input.role!=='merchant')throw Error('无商家权限');
 if(typeof input.base64!=='string'||!input.base64.length||input.base64.length>2796204||input.base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))throw Error('图片编码无效或超过 2MB');
 const data=Buffer.from(input.base64,'base64');if(!data.length||data.length>maxBytes||data.toString('base64')!==input.base64)throw Error('图片编码无效或超过 2MB');
 const png=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=data[0]===255&&data[1]===216&&data[2]===255;
 if(!png&&!jpg)throw Error('仅支持 JPG / PNG 图片');
 if(active>=maxActive)throw Error('UPLOAD_BUSY');
 active++;
 try{
  let normalized;
  try{
   const image=sharp(data,{failOn:'warning',limitInputPixels:maxPixels});
   const metadata=await image.metadata();
   if(!['jpeg','png'].includes(metadata.format)||!metadata.width||!metadata.height||(metadata.pages||1)!==1)throw Error('INVALID_IMAGE');
   // Decode before publishing. Rotate phone photos and strip metadata by re-encoding.
   const pipeline=image.autoOrient().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true});
   normalized=await (png?pipeline.png():pipeline.jpeg({quality:90})).toBuffer();
  }catch{throw Error('图片损坏、像素过大或格式不支持，请重新导出 JPG / PNG（不超过 4000 万像素）');}
  if(normalized.length>maxBytes)throw Error('图片处理后仍超过 2MB，请缩小尺寸后重试');
  const name=crypto.randomUUID()+'.'+(png?'png':'jpg');await fs.mkdir(targetDirectory,{recursive:true});const temporary=path.join(targetDirectory,'.'+name+'.tmp');
  try{await fs.writeFile(temporary,normalized,{flag:'wx',mode:0o600});await fs.rename(temporary,path.join(targetDirectory,name));}
  finally{await fs.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  return '/uploads/'+name;
 }finally{active--;}
}
module.exports={save,directory};
