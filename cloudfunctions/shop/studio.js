(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.Studio=factory();})(this,function(){
const assets=[['kigi-cat-cute','可爱猫咪入口图','分类'],['kigi-dog-cute','可爱狗狗入口图','分类'],['kigi-cafe-hero','猫咪咖啡师与烘焙小狗','横幅'],['kigi-logo','商家官方标志','品牌'],['hero-v2','猫狗日常','横幅'],['hero-calm-v3','午后猫咪','横幅'],['cat-v2','猫咪肖像','分类'],['dog-v2','狗狗肖像','分类'],['food-v2','主粮示意','商品'],['toy-v2','绳结玩具','商品'],['care-v2','日常梳理','商品'],['empty-v2','猫咪与收纳篮','场景'],['bowl-v3','陶瓷食碗','商品'],['bed-v3','柔软窝垫','商品'],['snack-v3','冻干零食','商品']].map(([id,name,kind])=>({id,name,kind,src:'/assets/'+id+(['kigi-cat-cute','kigi-dog-cute','kigi-logo'].includes(id)?'.png':'.jpg')}));
assets.push({id:'catalog-bakery',name:'手作烘焙插画示意',kind:'商品',src:'/assets/catalog-bakery.jpg'});
assets.push({id:'kigi-logo-legacy',name:'官方标志（旧版）',kind:'品牌',src:'/assets/kigi-logo.jpg'},{id:'empty',name:'透明空状态插画',kind:'场景',src:'/assets/empty.png'});
const slots=[{key:'hero',name:'首页主视觉',hint:'建议横向构图，左侧留空放标题'},{key:'cat',name:'猫咪用品入口图片',hint:'建议正方形，主体居中'},{key:'dog',name:'狗狗用品入口图片',hint:'建议正方形，主体居中'},{key:'care',name:'清洁分类图片',hint:'建议正方形，主体居中'},{key:'toy',name:'全部好物图片',hint:'建议正方形，主体居中'},{key:'avatar',name:'个人中心欢迎图',hint:'建议正方形，主体居中'},{key:'empty',name:'空购物车图片',hint:'建议清晰简洁的场景图片'}];
function resolveStorefront(saved={}){const result={...defaults,...saved};const path=String(result.hero||'').replace(/^https?:\/\/[^/]+/,'').split(/[?#]/)[0];if(!path||['/assets/hero.png','/assets/hero.jpg','/assets/hero-v2.jpg','/assets/hero-calm-v3.jpg','/assets/kigi-cafe-hero.jpg'].includes(path))result.hero=defaults.hero;for(const slot of ['cat','dog','empty','avatar']){const savedPath=String(result[slot]||'').replace(/^https?:\/\/[^/]+/,'').split(/[?#]/)[0];if(!savedPath||['/assets/'+slot+'.png','/assets/'+slot+'.jpg','/assets/'+slot+'-v2.jpg',defaults[slot],...(slot==='avatar'?['/assets/kigi-logo.jpg']:[])].includes(savedPath))result[slot]=defaults[slot];}return result;} const defaults={hero:'/assets/kigi-cafe-hero.jpg',cat:'/assets/kigi-cat-cute.png',dog:'/assets/kigi-dog-cute.png',care:'/assets/care-v2.jpg',toy:'/assets/toy-v2.jpg',avatar:'/assets/kigi-logo.png',empty:'/assets/empty.png'};
const afterStages={REQUESTED:'售后待审核',REJECTED:'售后已拒绝',WITHDRAWN:'售后已撤回',WAIT_RETURN:'待买家退货',RETURN_TRANSIT:'退货待验收',WAIT_REFUND:'待退款记录',REFUND_FAILED:'退款记录失败',SUCCEEDED:'退款完成'};
const pets=['待确认','猫咪','狗狗','通用','不适用'];
const simulationNotes=[
 '此模式不发生真实付款或退款。到店或寄件前，请核对门店提供的信息。',
 '请使用虚构的收货人、电话、地址和可公开的示意图片。账号、商品、收货信息、订单及售后记录会保存到共享服务，用于联调和故障排查。',
 '买家账号只能查看自己的订单；商家账号可以查看处理订单所需的收货信息。不要把商家账号提供给买家使用。',
 '退出登录会清除当前登录状态，不会删除已保存的使用记录。记录会保留并备份，如需清理，请联系分配账号的维护者。'
];
const homeDefaults={headline:'奇迹空间\n宠物咖啡店',subtitle:'咖啡 · 烘焙 · 宠物友好',featuredTitle:'店主精选',featuredIntro:'一杯咖啡、一口甜点，和毛孩子的小日常',newTitle:'新品上架',scenes:[{key:'meal',category:'主粮',title:'主粮',text:'猫粮 · 狗粮',image:'food-v2'},{key:'play',category:'玩具',title:'玩具',text:'互动 · 磨牙',image:'toy-v2'},{key:'care',category:'清洁',title:'清洁护理',text:'梳理 · 清洁',image:'care-v2'}]};
function isCoffee(p){return ['咖啡','饮品','烘焙'].includes(p.category);}
function tracksStock(p){return !['咖啡','饮品'].includes(p.category);}
function normalizeOptionGroups(product,source=[]){
 const need=(ok,message)=>{if(!ok)throw Error(message);};
 need(Array.isArray(source)&&source.length<=8,'自定义选项最多 8 组');
 need(!source.length||!tracksStock(product),'自定义饮品选项仅适用于咖啡和饮品');
 const groups=new Set(),names=new Set(),validId=id=>typeof id==='string'&&/^[\w-]{1,60}$/.test(id);
 return source.map(group=>{
  need(group&&validId(group.id)&&!groups.has(group.id),'选项组编号无效或重复');groups.add(group.id);
  need(typeof group.name==='string'&&group.name.trim()&&group.name.trim().length<=20&&!names.has(group.name.trim()),'选项组名称须为 1～20 字且不能重复');names.add(group.name.trim());
  need(Array.isArray(group.options)&&group.options.length>=1&&group.options.length<=12,'每组选项须为 1～12 个');
  const ids=new Set(),labels=new Set();
  return {id:group.id,name:group.name.trim(),options:group.options.map(option=>{
   need(option&&validId(option.id)&&!ids.has(option.id),'选项编号无效或重复');ids.add(option.id);
   need(typeof option.name==='string'&&option.name.trim()&&option.name.trim().length<=30&&!labels.has(option.name.trim()),'选项名称须为 1～30 字且同组不能重复');labels.add(option.name.trim());
   const extraPrice=option.extraPrice??0;need(Number.isSafeInteger(extraPrice)&&extraPrice>=0&&extraPrice<=1000000,'选项加价须为 0～10000 元');
   return {id:option.id,name:option.name.trim(),extraPrice};
  })};
 });
}
function normalizeSelections(source=[]){
 if(!Array.isArray(source)||source.length>8)throw Error('请选择有效的饮品选项');
 const seen=new Set();return source.map(item=>{
  if(!item||typeof item.groupId!=='string'||typeof item.optionId!=='string'||! /^[\w-]{1,60}$/.test(item.groupId)||! /^[\w-]{1,60}$/.test(item.optionId)||seen.has(item.groupId))throw Error('饮品选项无效或重复');
  seen.add(item.groupId);return {groupId:item.groupId,optionId:item.optionId};
 }).sort((a,b)=>a.groupId.localeCompare(b.groupId));
}
function lineKey(line){const choices=normalizeSelections(line.selections);return JSON.stringify([line.productId,line.skuId,...choices.map(item=>[item.groupId,item.optionId])]);}
function sameLine(a,b){return lineKey(a)===lineKey(b);}
function resolveOptions(product,source=[]){
 const selections=normalizeSelections(source),groups=product.optionGroups||[];
 if(selections.length!==groups.length)throw Error('饮品选项已变化，请重新选择');
 const options=groups.map(group=>{const selected=selections.find(s=>s.groupId===group.id),option=selected&&group.options.find(o=>o.id===selected.optionId);
  if(!option)throw Error('请重新选择'+group.name+'，原选项已失效');
  return {groupId:group.id,groupName:group.name,optionId:option.id,optionName:option.name,extraPrice:option.extraPrice??0};
 });
 return {selections,options,extra:options.reduce((sum,o)=>sum+o.extraPrice,0),text:options.map(o=>o.groupName+'：'+o.optionName).join(' / ')};
}
function priceWithOptions(sku,isMember,options){
 const base=priceFor(sku,isMember);if(!options.options.length)return base;
 const extra=options.extra;for(const value of [base.price,base.regularPrice,base.memberPrice])if(!Number.isSafeInteger(extra)||extra<0||!Number.isSafeInteger(value+extra)||value+extra>10000000)throw Error('饮品搭配金额超出限额');
 return {...base,basePrice:base.price,optionsExtra:extra,price:base.price+extra,regularPrice:base.regularPrice+extra,memberPrice:base.memberPrice+extra};
}
function petOf(p){return isCoffee(p)?'不适用':p.petScope||({food:'猫咪',toy:'通用',care:'通用'}[p.id])||'待确认';}
function featuredOf(p){return p.featured===undefined?['food','toy'].includes(p.id):p.featured;}
function matches(p,pet){return pet==='全部'||(!isCoffee(p)&&(petOf(p)===pet||petOf(p)==='通用'));}
function homeProducts(products){const available=products.filter(p=>p.active!==false&&(!tracksStock(p)||p.skus.some(s=>s.stock>0)));return {featured:available.filter(featuredOf).slice(0,4),latest:available.slice().reverse().slice(0,4)};}
const templates=[
 {id:'food',name:'主粮',hint:'猫粮 / 狗粮',category:'主粮',image:'food-v2',spec:'1kg',fields:'品牌：\n适用宠物与年龄：\n净含量：\n配料与营养信息：\n保质期与储存方式：\n生产信息：'},
 {id:'snack',name:'零食',hint:'冻干 / 罐头 / 奖励零食',category:'零食',image:'snack-v3',spec:'单包',fields:'品牌：\n适用宠物与年龄：\n口味与净含量：\n配料：\n喂食建议：\n保质期与储存方式：'},
 {id:'toy',name:'玩具',hint:'互动 / 解闷 / 磨牙',category:'玩具',image:'toy-v2',spec:'标准款',fields:'品牌：\n适用宠物与体型：\n材质：\n尺寸：\n玩法与清洁方式：\n使用注意事项：'},
 {id:'care',name:'清洁洗护',hint:'梳子 / 清洁用品',category:'清洁',image:'care-v2',spec:'标准款',fields:'品牌：\n适用宠物：\n材质或成分：\n尺寸或容量：\n使用方法：\n使用注意事项：'},
 {id:'living',name:'日常用品',hint:'食碗 / 窝垫 / 出行',category:'用品',image:'bowl-v3',spec:'标准款',fields:'品牌：\n适用宠物与体型：\n材质：\n尺寸：\n清洁与保养：\n使用注意事项：'}
];
const categoryDrafts=[
 ['cat-food','猫咪','主粮','猫咪干粮','food'],
 ['cat-snack','猫咪','零食','猫咪冻干零食','snack'],
 ['cat-toy','猫咪','玩具','逗猫棒','toy'],
 ['cat-clean','猫咪','清洁','颗粒猫砂','care'],
 ['cat-supply','猫咪','用品','陶瓷猫食碗','living'],
 ['dog-food','狗狗','主粮','狗狗干粮','food'],
 ['dog-snack','狗狗','零食','狗狗肉干零食','snack'],
 ['dog-toy','狗狗','玩具','棉绳结玩具','toy'],
 ['dog-clean','狗狗','清洁','犬用洗护液','care'],
 ['dog-supply','狗狗','用品','胸背牵引套装','living']
];
for(const [id,petScope,category,productName,base] of categoryDrafts){
 const original=templates.find(t=>t.id===base);
 assets.push({id:'catalog-'+id,name:petScope+' · '+productName+'示意',kind:'商品',src:'/assets/catalog-'+id+'.jpg'});
 templates.push({...original,id,name:productName,hint:petScope+' · '+category,petScope,productName,image:'catalog-'+id,spec:'请填写实际规格'});
}
templates.unshift({id:'bakery',name:'手作烘焙',hint:'面包 / 蛋糕 / 点心 · 到店自提',category:'烘焙',petScope:'不适用',image:'catalog-bakery',spec:'单份',fields:'口味与净含量：\n配料与过敏原：\n保质期与储存方式：\n取餐说明：'});
for(const [id,name] of [['americano','美式咖啡'],['latte','拿铁咖啡']]){
 assets.push({id:'catalog-'+id,name:name+'示意',kind:'商品',src:'/assets/catalog-'+id+'.jpg'});
 templates.push({id,name,productName:name,hint:'咖啡 · 到店自提',category:'咖啡',petScope:'不适用',image:'catalog-'+id,spec:'请填写杯型和冷热',fields:'杯型与容量：\n冷热选择：\n咖啡豆信息：\n配料与过敏原：\n制作与取餐说明：'});
}
function create(id='living'){const t=templates.find(t=>t.id===id)||templates[4];return {name:t.productName||'',petScope:t.petScope||'待确认',featured:false,pickNote:'',category:t.category,description:t.fields,image:'/assets/'+t.image+'.jpg',active:false,skus:[{id:'sku-'+Date.now(),name:t.spec,price:1000,...(t.productName?{priceYuan:''}:{}),stock:0}]};}
function productImages(p){return p.images&&p.images.length?p.images.slice():(p.image?[p.image]:['food','toy','care'].includes(p.id)?['/assets/'+p.id+'-v2.jpg']:[]);}
function withImage(p,src){const images=productImages(p).filter(x=>x!==src);if(images.length>=6)throw Error('最多 6 张图片，请先移除一张');images.unshift(src);return {image:src,images};}
function withoutImage(p,index){const images=productImages(p);images.splice(index,1);return {image:images[0]||'',images};}
function priceFor(sku,isMember=false){const regularPrice=sku.regularPrice??sku.price,memberPrice=sku.memberPrice??regularPrice;return {regularPrice,memberPrice,price:isMember?memberPrice:regularPrice,priceType:isMember?'MEMBER':'REGULAR'};}
function cents(value){const s=String(value).trim();if(!/^\d+(\.\d{1,2})?$/.test(s))throw Error('售价请填写大于 0 的金额，最多两位小数');const [a,b='']=s.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(n)||n<=0||n>10000000)throw Error('售价须在 0.01～100000 元之间');return n;}
function images(target){return assets.filter(a=>target==='hero'?a.kind==='横幅':target==='empty'?a.kind==='场景'||a.kind==='分类':target==='avatar'?a.kind==='分类':target==='product'?a.kind==='商品':a.kind!=='横幅'&&a.kind!=='场景');}
const pickupStore={name:'奇迹空间宠物咖啡店',detail:'海口市美兰区蓝天街道大英山西二街3号海航豪庭A05商业街7#楼7-2#商铺第一层（KIGI Space 奇迹空间）',hours:'每日 10:00—24:00',phone:'19389977085'};
const issueLabels={OUT_OF_STOCK:'缺货待处理',DELIVERY_FAILED:'快递未送达',PICKUP_DELAY:'自提延期',CONTACT_UNREACHABLE:'联系未果'};
function isInStore(o){return ['DINE_IN','PICKUP'].includes(o?.fulfillment?.type);}
function fulfillmentName(o){return o.kind==='RECHARGE'?'会员充值':({DINE_IN:'堂食',PICKUP:'到店自提',DELIVERY:'快递配送'}[o.fulfillment?.type]||'快递配送');}
function fulfillmentLabel(o){if(o.fulfillment?.type==='DINE_IN'){if(o.status==='PAID')return o.fulfillment.readyAt?'待取餐':'门店备餐中';if(o.status==='COMPLETED')return '堂食已完成';}if(o.kind==='RECHARGE')return ({PENDING:'充值待付款',COMPLETED:'充值已到账',CANCELLED:'充值已取消',EXPIRED:'充值已关闭',REFUNDED:'充值已退回'})[o.status]||'';if(o.fulfillment?.issue?.status==='OPEN'&&['PAID','SHIPPED'].includes(o.status))return issueLabels[o.fulfillment.issue.type]||'履约待处理';if(o.fulfillment?.type==='PICKUP'){if(o.status==='PAID')return o.fulfillment.readyAt?'待到店自提':'门店备货中';if(o.status==='COMPLETED')return '已自提';}return ({PAID:'商家备货中',SHIPPED:'已发货'})[o.status]||'';}
const carriers={shunfeng:'顺丰速运',zhongtong:'中通快递',yuantong:'圆通速递',shentong:'申通快递',yunda:'韵达快递',jd:'京东物流',ems:'EMS',youzhengguonei:'邮政包裹',debangkuaidi:'德邦快递',jtexpress:'极兔速递'};
return {normalizeOptionGroups,normalizeSelections,lineKey,sameLine,resolveOptions,priceWithOptions,priceFor,isInStore,fulfillmentName,resolveStorefront, isCoffee,tracksStock,carriers,assets,slots,defaults,templates,create,cents,images,pets,simulationNotes,homeDefaults,petOf,featuredOf,matches,homeProducts,productImages,withImage,withoutImage,afterStages,pickupStore,fulfillmentLabel,issueLabels};
});
