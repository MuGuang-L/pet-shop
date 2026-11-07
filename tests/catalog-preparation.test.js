const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const studio=require('../cloudfunctions/shop/studio');
test('猫狗五分类都有独立配图模板，价格待填且默认不上架',()=>{
 for(const pet of ['猫咪','狗狗'])for(const category of ['主粮','零食','玩具','清洁','用品']){
  const t=studio.templates.find(t=>t.petScope===pet&&t.category===category);assert.ok(t);
  const p=studio.create(t.id);assert.equal(p.petScope,pet);assert.equal(p.active,false);assert.equal(p.skus[0].stock,0);assert.equal(p.skus[0].priceYuan,'');assert.ok(p.name);
  assert.ok(studio.images('product').some(a=>a.src===p.image));assert.ok(fs.existsSync('miniprogram'+p.image));
 }
});
test('商品慢请求与失败不会被当成已成功加载的空分类',async()=>{
 let p,resolve,reject;const api={mode:'cloud',call:()=>new Promise((a,b)=>{resolve=a;reject=b;})};
 vm.runInNewContext(fs.readFileSync('miniprogram/pages/shop/index.js','utf8'),{Page:x=>p=x,require:n=>n.includes('order-display')?require('../miniprogram/services/order-display'):n.includes('studio')?studio:api,wx:{showToast(){},getStorageSync(){},setStorageSync(){}}});
 p.setData=function(x){Object.assign(this.data,x);};
 const work=p.refresh();assert.equal(p.data.catalogLoading,true);assert.equal(p.data.catalogLoaded,false);reject(Error('网络连接失败'));await work;
 assert.equal(p.data.catalogLoading,false);assert.equal(p.data.catalogLoaded,false);assert.match(p.data.loadError,/网络连接失败/);
});
test('咖啡独立分类，报价和下单均拒绝快递，混合订单可以自提',()=>{
 const domain=require('../cloudfunctions/shop/domain');let s=domain.seed();const buyer={id:'coffee-buyer'},merchant={id:'m',merchant:true};
 const coffee={...studio.create('latte'),active:true,skus:[{id:'cup',name:'热拿铁',price:2000,stock:10}]};
 const saved=domain.execute(s,merchant,'saveProduct',coffee,{mock:true});s=saved.state;const p=saved.result;
 assert.equal(p.petScope,'不适用');assert.equal(studio.matches(p,'猫咪'),false);assert.equal(studio.matches(p,'狗狗'),false);
 const address=domain.execute(s,buyer,'saveAddress',{name:'测试',phone:'13800000000',detail:'测试市测试路 1 号'});s=address.state;
 const lines=[{productId:p.id,skuId:'cup',qty:1},{productId:'toy',skuId:'toy-1',qty:1}];
 const input={lines,fulfillment:'DELIVERY',addressId:address.result.id,key:'coffee-delivery'};
 const before=structuredClone(s);assert.throws(()=>domain.execute(s,buyer,'quoteOrder',input),/咖啡.*仅支持到店自提/);assert.throws(()=>domain.execute(s,buyer,'createOrder',input),/咖啡.*仅支持到店自提/);assert.deepEqual(s,before);
 const order=domain.execute(s,buyer,'createOrder',{...input,key:'coffee-pickup',fulfillment:'PICKUP',contact:{name:'测试',phone:'13800000000'}},{mock:true}).result;
 assert.equal(order.fulfillment.type,'PICKUP');assert.equal(order.shippingFee,0);assert.equal(order.lines.length,2);
});
test('买家咖啡入口不混入宠物商品，选中咖啡保持堂食或自提且取消选择后恢复配送可选',()=>{
 let p;vm.runInNewContext(fs.readFileSync('miniprogram/pages/shop/index.js','utf8'),{Page:x=>p=x,require:n=>n.includes('order-display')?require('../miniprogram/services/order-display'):n.includes('studio')?studio:{mode:'cloud'},wx:{setStorageSync(){},pageScrollTo(){}}});
 p.setData=function(x,done){Object.assign(this.data,x);if(done)done();};
 p.data.products=[{id:'coffee',category:'咖啡',name:'拿铁',skus:[{id:'cup',price:2000,stock:5}]},{id:'pet',category:'用品',petScope:'通用',name:'食碗',skus:[{id:'bowl',price:3000,stock:5}]}];
 p.shopSection({currentTarget:{dataset:{value:'coffee'}}});assert.equal(p.data.visible.length,1);assert.equal(p.data.visible[0].id,'coffee');
 p.goPet({currentTarget:{dataset:{value:'狗狗'}}});assert.equal(p.data.shopSection,'pet');assert.equal(p.data.visible.length,1);assert.equal(p.data.visible[0].id,'pet');
 p.data.deliveryEnabled=true;p.data.pickupEnabled=true;p.data.cart=[{productId:'coffee',skuId:'cup',qty:1},{productId:'pet',skuId:'bowl',qty:1}];p.cartTotal();assert.equal(p.data.checkoutPickupOnly,true);assert.equal(p.data.deliveryMode,'DINE_IN');assert.equal(p.data.shippingEstimate,'0.00');
 p.deliveryMode({currentTarget:{dataset:{value:'DELIVERY'}}});assert.equal(p.data.deliveryMode,'DINE_IN');p.data.cart[0].selected=false;p.cartTotal();assert.equal(p.data.checkoutPickupOnly,false);p.deliveryMode({currentTarget:{dataset:{value:'DELIVERY'}}});assert.equal(p.data.deliveryMode,'DELIVERY');
});
