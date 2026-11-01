'use strict';
const fs=require('node:fs'),path=require('node:path');
const mode=process.argv[2];if(!['enable','disable'].includes(mode))throw Error('Usage: node scripts/wechat-logistics-plugin.js enable|disable');
const root=path.resolve(__dirname,'..','miniprogram'),file=path.join(root,'app.json'),app=JSON.parse(fs.readFileSync(file,'utf8'));
if(mode==='enable'){app.plugins||={};app.plugins.logisticsPlugin={version:'2.1.5',provider:'wx9ad912bf20548d92'};}
else if(app.plugins){delete app.plugins.logisticsPlugin;if(!Object.keys(app.plugins).length)delete app.plugins;}
fs.writeFileSync(file,JSON.stringify(app,null,2)+'\n');
fs.writeFileSync(path.join(root,'services/logistics-plugin-config.js'),'module.exports='+JSON.stringify({enabled:mode==='enable'})+';\n');
console.log(mode==='enable'?'Official logistics plugin enabled. Compile and preview on a real phone after MP authorization.':'Plugin disabled; shipping numbers remain available.');
