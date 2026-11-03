// Compress generated raster originals for the mini-program. No network calls.
const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
const root=path.resolve(__dirname,'..'),source=path.join(root,'source-assets/cozy'),assets=path.join(root,'miniprogram/assets');
const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));
const targets={
 cat:['kigi-cat-cute.png','cat-v2.jpg','cat.png'],
 dog:['kigi-dog-cute.png','dog-v2.jpg','dog.png'],
 empty:['empty-v2.jpg','empty.png'],
 bakery:['catalog-bakery.jpg'],
 'cat-food':['catalog-cat-food.jpg','food-v2.jpg','food.png'],
 'cat-snack':['catalog-cat-snack.jpg','snack-v3.jpg'],
 'cat-toy':['catalog-cat-toy.jpg'],
 'cat-clean':['catalog-cat-clean.jpg'],
 'cat-supply':['catalog-cat-supply.jpg','bowl-v3.jpg'],
 'dog-food':['catalog-dog-food.jpg'],
 'dog-snack':['catalog-dog-snack.jpg'],
 'dog-toy':['catalog-dog-toy.jpg','toy-v2.jpg','toy.png'],
 'dog-clean':['catalog-dog-clean.jpg'],
 brush:['care-v2.jpg','care.png'],bed:['bed-v3.jpg'],
 'dog-supply':['catalog-dog-supply.jpg'],
 americano:['catalog-americano.jpg'],latte:['catalog-latte.jpg'],
 'nav-home':['nav-home.png'],'nav-category':['nav-category.png'],'nav-cart':['nav-cart.png'],'nav-account':['nav-account.png'],
 hero:['kigi-cafe-hero.jpg','hero-v2.jpg','hero-calm-v3.jpg','hero.png']
};
(async()=>{
 for(const item of manifest){
  const original=path.join(source,item.id+'.png');
  if(item.source&&path.resolve(item.source)!==path.resolve(original))fs.copyFileSync(item.source,original);
  for(const filename of targets[item.id]||[]){
   const png=filename.endsWith('.png');
   const width=item.id.startsWith('nav-')?96:png?(filename.startsWith('kigi-')?240:item.id==='hero'?320:180):item.id==='hero'?800:320;
   let pipeline=sharp(original).resize({width,withoutEnlargement:true});
   pipeline=png?pipeline.png({palette:true,colours:48,effort:10}):pipeline.jpeg({quality:68,mozjpeg:true});
   await pipeline.toFile(path.join(assets,filename));
  }
 }
 console.log('Compressed',manifest.length,'originals; linked assets:',Object.values(targets).flat().length);
})();
