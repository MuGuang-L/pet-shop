const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const directory=path.join(__dirname,'../.local/uploads');
function save(input){
 if(input.role!=='merchant')throw Error('无商家权限');
 if(typeof input.base64!=='string'||input.base64.length>2800000||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64))throw Error('图片编码无效或超过 2MB');
 const data=Buffer.from(input.base64,'base64');if(!data.length||data.length>2*1024*1024)throw Error('图片须小于 2MB');
 const png=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));const jpg=data[0]===255&&data[1]===216&&data[2]===255;
 if(!png&&!jpg)throw Error('仅支持 JPG / PNG 图片');
 const name=crypto.randomUUID()+'.'+(png?'png':'jpg');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,name),data);return '/uploads/'+name;
}
module.exports={save,directory};
