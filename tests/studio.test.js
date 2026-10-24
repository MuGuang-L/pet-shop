const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const studio=require('../cloudfunctions/shop/studio'),domain=require('../cloudfunctions/shop/domain');
const merchant={id:'m',merchant:true},buyer={id:'b',merchant:false};
test('店铺图片只允许商家保存，旧数据有默认值，更新后买家可读',()=>{
 const s=domain.seed();assert.equal(domain.execute(s,buyer,'storefront').result.hero,studio.defaults.hero);
 assert.throws(()=>domain.execute(s,buyer,'saveStorefront',{hero:'/assets/cat-v2.jpg'}),/FORBIDDEN/);
 const out=domain.execute(s,merchant,'saveStorefront',{hero:'/assets/cat-v2.jpg'},{mock:true});
 assert.equal(domain.execute(out.state,buyer,'storefront').result.hero,'/assets/cat-v2.jpg');assert.equal(s.storefront,undefined);
 assert.throws(()=>domain.execute(s,merchant,'saveStorefront',{hero:'javascript:alert(1)'},{mock:true}),/IMAGE_PATH/);
 assert.throws(()=>domain.execute(s,merchant,'saveStorefront',{hero:'wxfile://saved'}),/CLOUD_IMAGE_REQUIRED/);
 assert.doesNotThrow(()=>domain.execute(s,merchant,'saveStorefront',{hero:studio.defaults.hero}));
});
test('模板草稿、金额转换和图库资源完整，内置图片在云模式可保存',()=>{
 for(const template of studio.templates){const p=studio.create(template.id);assert.equal(p.active,false);assert.equal(p.skus[0].stock,0);p.name='验收';assert.doesNotThrow(()=>domain.execute(domain.seed(),merchant,'saveProduct',p));}
 for(const a of studio.assets)assert.ok(fs.existsSync(path.join(__dirname,'../miniprogram',a.src)),a.src);
 assert.equal(studio.cents('19.90'),1990);assert.equal(studio.cents('0.01'),1);assert.equal(studio.cents('99'),9900);
 for(const value of ['0','-1','1.001','abc','1e2','100000.01'])assert.throws(()=>studio.cents(value));
 assert.throws(()=>domain.execute(domain.seed(),merchant,'saveProduct',{...studio.create(),name:'x',image:'/assets/missing.jpg'}),/IMAGE_PATH/);
});
test('本地图片上传拒绝非商家、超限和非图片，不信任扩展名',()=>{
 const uploads=require('../preview/uploads');assert.throws(()=>uploads.save({role:'buyer',base64:''}),/商家权限/);
 assert.throws(()=>uploads.save({role:'merchant',base64:Buffer.from('<svg></svg>').toString('base64')}),/JPG/);
 assert.throws(()=>uploads.save({role:'merchant',base64:'a'.repeat(2800004)}),/2MB/);
 const buffer=fs.readFileSync(path.join(__dirname,'../miniprogram/assets/bowl-v3.jpg'));
 const location=uploads.save({role:'merchant',base64:buffer.toString('base64')});const file=path.join(uploads.directory,path.basename(location));try{assert.deepEqual(fs.readFileSync(file),buffer);}finally{fs.unlinkSync(file);}
});
test('首页配置权限、文案校验、场景白名单与商品推荐元数据',()=>{let s=domain.seed();assert.throws(()=>domain.execute(s,buyer,'saveHomeContent',{headline:'更新'}),/FORBIDDEN/);assert.throws(()=>domain.execute(s,merchant,'saveHomeContent',{headline:'x'.repeat(25)}));assert.throws(()=>domain.execute(s,merchant,'saveHomeContent',{scenes:[]}));const h={...studio.homeDefaults,headline:'给它的日常好物'};s=domain.execute(s,merchant,'saveHomeContent',h).state;assert.equal(domain.execute(s,buyer,'homeContent').result.headline,h.headline);assert.throws(()=>domain.execute(s,merchant,'saveHomeContent',{scenes:h.scenes.map(x=>({...x,image:'../../bad'}))}));const p={...s.products[0],petScope:'猫咪',featured:true,pickNote:'按规格选择适合的份量'};s=domain.execute(s,merchant,'saveProduct',p,{mock:true}).state;assert.equal(s.products[0].pickNote,p.pickNote);assert.equal(s.products[0].featured,true);assert.throws(()=>domain.execute(s,merchant,'saveProduct',{...p,petScope:'随便'}));});
test('首页精选剔除下架与缺货，狗狗筛选排除猫粮和适用待确认商品',()=>{const ps=domain.seed().products;assert.equal(studio.matches(ps[0],'狗狗'),false);assert.equal(studio.matches({id:'new'},'狗狗'),false);assert.equal(studio.matches({petScope:'通用'},'猫咪'),true);const result=studio.homeProducts([...ps,{...ps[0],id:'off',active:false,featured:true},{...ps[0],id:'zero',featured:true,skus:[{stock:0}]}]);assert.ok(result.featured.length);assert.ok(result.featured.every(p=>!['off','zero'].includes(p.id)));assert.equal(result.latest[0].id,ps.at(-1).id);});
test('商品相册：最多六张、首图为封面、危险路径拒绝、旧数据兼容',()=>{const s=domain.seed(),p={...s.products[0],images:['/assets/toy-v2.jpg','/assets/food-v2.jpg']};let out=domain.execute(s,merchant,'saveProduct',p,{mock:true});assert.equal(out.result.image,p.images[0]);assert.deepEqual(out.result.images,p.images);assert.throws(()=>domain.execute(s,merchant,'saveProduct',{...p,images:Array(7).fill('/assets/toy-v2.jpg')},{mock:true}),/6/);assert.throws(()=>domain.execute(s,merchant,'saveProduct',{...p,images:['javascript:alert(1)']},{mock:true}),/IMAGE_PATH/);assert.equal(studio.withImage(p,'/assets/food-v2.jpg').images[0],'/assets/food-v2.jpg');assert.equal(studio.withoutImage(p,0).image,'/assets/food-v2.jpg');assert.deepEqual(studio.productImages({image:'/assets/toy-v2.jpg'}),['/assets/toy-v2.jpg']);});
test('订单分页：买家隔离、商家权限、状态与关键词交集、非法页码拒绝',()=>{const s=domain.seed();s.orders=Array.from({length:23},(_,i)=>({id:'o'+i,userId:i<20?'b':'other',status:i%2?'PAID':'SHIPPED',createdAt:i,lines:[{name:i===3?'特殊[商品]':'玩具'}]}));let r=domain.execute(s,buyer,'ordersPage',{page:2,pageSize:5}).result;assert.equal(r.total,20);assert.equal(r.items.length,5);assert.ok(r.items.every(o=>o.userId==='b'));r=domain.execute(s,buyer,'ordersPage',{q:'[商品]',status:'PAID'}).result;assert.equal(r.total,1);assert.equal(r.items[0].id,'o3');assert.throws(()=>domain.execute(s,buyer,'merchantOrdersPage'),/FORBIDDEN/);assert.equal(domain.execute(s,merchant,'merchantOrdersPage').result.total,23);assert.throws(()=>domain.execute(s,buyer,'ordersPage',{pageSize:1000}),/PAGE_SIZE/);assert.throws(()=>domain.execute(s,buyer,'ordersPage',{page:0}),/PAGE/);});
