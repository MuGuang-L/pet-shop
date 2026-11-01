// Generate delivery-sized images from the preserved original artwork.
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const root=path.resolve(__dirname,'..');
(async()=>{
 let before=0,after=0;
 for(const name of fs.readdirSync(path.join(root,'source-assets')).filter(n=>n.endsWith('.png'))){
  const output=path.join(root,'miniprogram/assets',name.replace(/\.png$/,'.jpg'));
  if(!fs.existsSync(output))continue;
  const old=fs.statSync(output).size;
  const buffer=await sharp(path.join(root,'source-assets',name)).resize({width:name.startsWith('hero')?960:640,withoutEnlargement:true}).jpeg({quality:78,mozjpeg:true}).toBuffer();
  await sharp(buffer).metadata();
  fs.writeFileSync(output,buffer);before+=old;after+=buffer.length;
 }
 console.log(`Miniapp artwork: ${before} -> ${after} bytes. Original source-assets preserved.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
