(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.Studio=factory();})(this,function(){
const assets=[['hero-v2','猫狗日常','横幅'],['hero-calm-v3','午后猫咪','横幅'],['cat-v2','猫咪肖像','分类'],['dog-v2','狗狗肖像','分类'],['food-v2','主粮示意','商品'],['toy-v2','绳结玩具','商品'],['care-v2','日常梳理','商品'],['empty-v2','猫咪与收纳篮','场景'],['bowl-v3','陶瓷食碗','商品'],['bed-v3','柔软窝垫','商品'],['snack-v3','冻干零食','商品']].map(([id,name,kind])=>({id,name,kind,src:'/assets/'+id+'.jpg'}));
const slots=[{key:'hero',name:'首页主视觉',hint:'建议横向构图，左侧留空放标题'},{key:'cat',name:'主粮分类图片',hint:'建议正方形，主体居中'},{key:'dog',name:'玩具分类图片',hint:'建议正方形，主体居中'},{key:'care',name:'清洁分类图片',hint:'建议正方形，主体居中'},{key:'toy',name:'全部好物图片',hint:'建议正方形，主体居中'},{key:'avatar',name:'个人中心欢迎图',hint:'建议正方形，主体居中'},{key:'empty',name:'空购物车图片',hint:'建议清晰简洁的场景图片'}];
const defaults={hero:'/assets/hero-v2.jpg',cat:'/assets/cat-v2.jpg',dog:'/assets/dog-v2.jpg',care:'/assets/care-v2.jpg',toy:'/assets/toy-v2.jpg',avatar:'/assets/cat-v2.jpg',empty:'/assets/empty-v2.jpg'};
const afterStages={REQUESTED:'售后待审核',REJECTED:'售后已拒绝',WITHDRAWN:'售后已撤回',WAIT_RETURN:'待买家退货',RETURN_TRANSIT:'退货待验收',WAIT_REFUND:'待模拟退款',REFUND_FAILED:'模拟退款失败',SUCCEEDED:'退款完成'};
const pets=['待确认','猫咪','狗狗','通用'];
const homeDefaults={headline:'好好吃饭，\n快乐长大。',subtitle:'给毛孩子的日常小美好',featuredTitle:'店主精选',featuredIntro:'从吃饭到玩耍，把日常照顾得刚刚好。',newTitle:'上新小货架',scenes:[{key:'meal',category:'主粮',title:'把饭点变成期待',text:'主粮按需选，日常好好吃',image:'food-v2'},{key:'play',category:'玩具',title:'今天，陪它玩一会儿',text:'把陪伴放进日常',image:'toy-v2'},{key:'care',category:'清洁',title:'蓬松干净的小日子',text:'梳理与清洁，一起慢慢来',image:'care-v2'}]};
function petOf(p){return p.petScope||({food:'猫咪',toy:'通用',care:'通用'}[p.id])||'待确认';}
function featuredOf(p){return p.featured===undefined?['food','toy'].includes(p.id):p.featured;}
function matches(p,pet){return pet==='全部'||petOf(p)===pet||petOf(p)==='通用';}
function homeProducts(products){const available=products.filter(p=>p.active!==false&&p.skus.some(s=>s.stock>0));return {featured:available.filter(featuredOf).slice(0,4),latest:available.slice().reverse().slice(0,4)};}
const templates=[
 {id:'food',name:'主粮',hint:'猫粮 / 狗粮',category:'主粮',image:'food-v2',spec:'1kg',fields:'品牌：\n适用宠物与年龄：\n净含量：\n配料与营养信息：\n保质期与储存方式：\n生产信息：'},
 {id:'snack',name:'零食',hint:'冻干 / 罐头 / 奖励零食',category:'零食',image:'snack-v3',spec:'单包',fields:'品牌：\n适用宠物与年龄：\n口味与净含量：\n配料：\n喂食建议：\n保质期与储存方式：'},
 {id:'toy',name:'玩具',hint:'互动 / 解闷 / 磨牙',category:'玩具',image:'toy-v2',spec:'标准款',fields:'品牌：\n适用宠物与体型：\n材质：\n尺寸：\n玩法与清洁方式：\n使用注意事项：'},
 {id:'care',name:'清洁洗护',hint:'梳子 / 清洁用品',category:'清洁',image:'care-v2',spec:'标准款',fields:'品牌：\n适用宠物：\n材质或成分：\n尺寸或容量：\n使用方法：\n使用注意事项：'},
 {id:'living',name:'日常用品',hint:'食碗 / 窝垫 / 出行',category:'用品',image:'bowl-v3',spec:'标准款',fields:'品牌：\n适用宠物与体型：\n材质：\n尺寸：\n清洁与保养：\n使用注意事项：'}
];
function create(id='living'){const t=templates.find(t=>t.id===id)||templates[4];return {name:'',petScope:'待确认',featured:false,pickNote:'',category:t.category,description:t.fields,image:'/assets/'+t.image+'.jpg',active:false,skus:[{id:'sku-'+Date.now(),name:t.spec,price:1000,stock:0}]};}
function productImages(p){return p.images&&p.images.length?p.images.slice():(p.image?[p.image]:['food','toy','care'].includes(p.id)?['/assets/'+p.id+'-v2.jpg']:[]);}
function withImage(p,src){const images=productImages(p).filter(x=>x!==src);if(images.length>=6)throw Error('最多 6 张图片，请先移除一张');images.unshift(src);return {image:src,images};}
function withoutImage(p,index){const images=productImages(p);images.splice(index,1);return {image:images[0]||'',images};}
function cents(value){const s=String(value).trim();if(!/^\d+(\.\d{1,2})?$/.test(s))throw Error('售价请填写大于 0 的金额，最多两位小数');const [a,b='']=s.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(n)||n<=0||n>10000000)throw Error('售价须在 0.01～100000 元之间');return n;}
function images(target){return assets.filter(a=>target==='hero'?a.kind==='横幅':target==='empty'?a.kind==='场景'||a.kind==='分类':target==='avatar'?a.kind==='分类':target==='product'?a.kind==='商品':a.kind!=='横幅'&&a.kind!=='场景');}
const pickupStore={name:'爪爪小铺 · 演示门店',detail:'示例市花园路 18 号（模拟地址）',hours:'每日 10:00—20:00',phone:'13800000000'};
function fulfillmentLabel(o){if(o.fulfillment?.type==='PICKUP'){if(o.status==='PAID')return o.fulfillment.readyAt?'待到店自提':'门店备货中';if(o.status==='COMPLETED')return '已自提';}return ({PAID:'商家备货中',SHIPPED:'商家配送中'})[o.status]||'';}
return {assets,slots,defaults,templates,create,cents,images,pets,homeDefaults,petOf,featuredOf,matches,homeProducts,productImages,withImage,withoutImage,afterStages,pickupStore,fulfillmentLabel};
});
