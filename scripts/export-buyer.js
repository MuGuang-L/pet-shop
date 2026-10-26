const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),stamp=new Date().toISOString().replace(/[:.]/g,'-'),out=path.join(root,'.local/handoff/buyer-client-'+stamp);
fs.mkdirSync(out,{recursive:true});
fs.cpSync(path.join(root,'miniprogram'),path.join(out,'miniprogram'),{recursive:true,filter:p=>!['domain.js','aftersales.js','config.local.js'].includes(path.basename(p))});
// Never distribute the checkout's private API destination.
fs.copyFileSync(path.join(root,'miniprogram/config.example.js'),path.join(out,'miniprogram/config.local.js'));
fs.copyFileSync(path.join(root,'docs/BUYER-API.md'),path.join(out,'BUYER-API.md'));
fs.writeFileSync(path.join(out,'project.config.json'),JSON.stringify({description:'爪爪小铺小程序侧联调',miniprogramRoot:'miniprogram/',compileType:'miniprogram',appid:'touristappid',projectname:'pet-shop-buyer',setting:{es6:true,enhance:true,urlCheck:true}},null,2));
fs.writeFileSync(path.join(out,'README.md'),`# 小程序侧源码包

使用微信开发者工具导入本目录，配置有权限使用的 AppID 或工具支持的测试模式。
miniprogram/config.local.js 默认连接 http://127.0.0.1:4173，需要先在同一台电脑运行服务侧。
连接共享服务时，将 apiBase 改为维护者提供的 HTTPS 根地址（不加 /api）；使用该服务分配的买家测试账号。
本地 HTTP 联调需在开发工具中临时关闭合法域名校验；真机不能用电脑的 127.0.0.1。

本包仅包含小程序侧，不能独立启动后端或数据库；完整本地环境请克隆仓库并按 README 初始化。
接口见 BUYER-API.md。本包不含账号密码、私有连接配置、数据库数据或服务侧源码。
`);
const zip=out+'.zip';
cp.execFileSync('python',['-c','import sys,zipfile,pathlib; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); [z.write(f,f.relative_to(p)) for f in p.rglob("*") if f.is_file()]; z.close()',out,zip]);
console.log(path.relative(root,zip));
