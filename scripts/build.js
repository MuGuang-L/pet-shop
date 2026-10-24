const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
fs.mkdirSync(path.join(root,'miniprogram/lib'),{recursive:true});
fs.copyFileSync(path.join(root,'cloudfunctions/shop/domain.js'),path.join(root,'miniprogram/lib/domain.js'));
fs.writeFileSync(path.join(root,'cloudbase/seed.json'),JSON.stringify({_id:'singleton',value:require('../cloudfunctions/shop/domain').seed()},null,2));
console.log('Built local mock domain and CloudBase seed. No deployment.');

fs.copyFileSync(path.join(root,'cloudfunctions/shop/studio.js'),path.join(root,'miniprogram/lib/studio.js'));

fs.copyFileSync(path.join(root,'cloudfunctions/shop/aftersales.js'),path.join(root,'miniprogram/lib/aftersales.js'));
