const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');let count=0;
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.local','.git'].includes(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(p.endsWith('.json')){JSON.parse(fs.readFileSync(p,'utf8'));count++;}else if(p.endsWith('.js')){cp.execFileSync(process.execPath,['--check',p]);count++;}}}
walk(root);
if(fs.readFileSync(path.join(root,'miniprogram/lib/domain.js'),'utf8')!==fs.readFileSync(path.join(root,'cloudfunctions/shop/domain.js'),'utf8'))throw Error('Run npm run build to synchronize mock domain');
console.log('Syntax/JSON checked '+count+' files; shared domain synchronized. WXML needs WeChat developer tool validation.');
