'use strict';
const studio=require('../cloudfunctions/shop/studio');
const groups=[{pet:'不适用',category:'咖啡'},{pet:'不适用',category:'烘焙'},...['猫咪','狗狗'].flatMap(pet=>['主粮','零食','玩具','清洁','用品'].map(category=>({pet,category})))];
function coverage(products){
 if(!Array.isArray(products))throw Error('Expected a product array');
 return groups.map(group=>{
  const matching=products.filter(p=>p.category===group.category&&(group.pet==='不适用'||studio.matches(p,group.pet)));
  const active=matching.filter(p=>p.active===true);
  const orderable=active.filter(p=>p.skus?.some(s=>Number.isSafeInteger(s.price)&&s.price>0&&Number.isInteger(s.stock)&&s.stock>0));
  const illustrated=orderable.filter(p=>studio.productImages(p).length>0);
  return {...group,status:!active.length?'缺少上架商品':!orderable.length?'无可售库存':!illustrated.length?'缺少商品图':'齐全',active:active.length,orderable:orderable.length,illustrated:illustrated.length,products:active.map(p=>p.name)};
 });
}
if(require.main===module){
 const fs=require('node:fs'),file=process.argv[2];
 if(!file){console.error('Usage: node scripts/catalog-coverage.cjs <merchantProducts.json>');process.exitCode=2;}
 else{const rows=coverage(JSON.parse(fs.readFileSync(file,'utf8')));console.table(rows.map(r=>({...r,products:r.products.join('、')})));if(rows.some(r=>r.status!=='齐全'))process.exitCode=1;}
}
module.exports={coverage};
