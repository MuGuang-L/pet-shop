const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const products=require('../source-assets/cozy/catalog-products.json'),domain=require('../cloudfunctions/shop/domain'),studio=require('../cloudfunctions/shop/studio');
const {coverage}=require('../scripts/catalog-coverage.cjs');
test('发布商品清单覆盖全部 12 个细类，13 件商品的图片存在且未混入测试商品',()=>{
 assert.equal(products.length,13);assert.ok(coverage(products).every(r=>r.status==='齐全'));
 for(const p of products){assert.ok(!/样例|勿销售/.test(p.name));assert.ok(fs.existsSync('miniprogram'+p.image));}
});
for(const product of products)for(const type of studio.isCoffee(product)?['PICKUP']:['PICKUP','DELIVERY'])test(product.name+'：本地模拟下单、付款及'+(type==='PICKUP'?'自提':'发货收货')+'闭环',()=>{
 let state=domain.seed();state.products=structuredClone(products);
 const buyer={id:'local-catalog-buyer'},merchant={id:'local-merchant',merchant:true},now=Date.UTC(2026,10,3,4);
 const run=(actor,action,input={})=>{const out=domain.execute(state,actor,action,input,{mock:true,now});state=out.state;return out.result;};
 const address=run(buyer,'saveAddress',{name:'本地测试',phone:'13800000000',detail:'测试地址测试路 1 号'});
 const sku=product.skus[0],lines=[{productId:product.id,skuId:sku.id,qty:1}];
 if(studio.isCoffee(product))assert.throws(()=>run(buyer,'quoteOrder',{lines,fulfillment:'DELIVERY',addressId:address.id}),/仅支持到店自提/);
 const order=run(buyer,'createOrder',{key:'local-'+product.id+'-'+type,lines,fulfillment:type,addressId:address.id,contact:{name:'本地测试',phone:'13800000000'}});
 run(buyer,'mockPay',{id:order.id});
 if(type==='PICKUP'){run(merchant,'pickupReady',{id:order.id});run(merchant,'pickupComplete',{id:order.id,confirm:true});}
 else{run(merchant,'ship',{id:order.id,carrier:'shunfeng',number:'LOCAL123456'});run(buyer,'confirmReceipt',{id:order.id});}
 assert.equal(run(buyer,'order',{id:order.id}).status,'COMPLETED');
 assert.equal(state.products.find(p=>p.id===product.id).skus[0].stock,['咖啡','饮品'].includes(product.category)?sku.stock:sku.stock-1);
});
