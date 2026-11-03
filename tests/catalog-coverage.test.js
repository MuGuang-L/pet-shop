const test=require('node:test'),assert=require('node:assert/strict');
const {coverage}=require('../scripts/catalog-coverage.cjs');
const product=(extra={})=>({name:'通用食碗',category:'用品',petScope:'通用',active:true,image:'/assets/bowl-v3.jpg',skus:[{price:2500,stock:1}],...extra});
test('分类覆盖检查区分草稿、售罄、缺图和可售，通用商品同时覆盖猫狗',()=>{
 const rows=coverage([product(),product({name:'咖啡草稿',category:'咖啡',active:false}),product({name:'售罄面包',category:'烘焙',skus:[{price:1200,stock:0}]}),product({name:'猫粮无图',category:'主粮',petScope:'猫咪',image:''})]);
 assert.equal(rows.length,12);
 assert.equal(rows.find(r=>r.category==='咖啡').status,'缺少上架商品');
 assert.equal(rows.find(r=>r.category==='烘焙').status,'无可售库存');
 assert.equal(rows.find(r=>r.category==='主粮'&&r.pet==='猫咪').status,'缺少商品图');
 for(const pet of ['猫咪','狗狗'])assert.equal(rows.find(r=>r.category==='用品'&&r.pet===pet).status,'齐全');
 assert.equal(rows.find(r=>r.category==='主粮'&&r.pet==='狗狗').active,0);
});
