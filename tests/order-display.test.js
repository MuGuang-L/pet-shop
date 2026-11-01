const test=require('node:test'),assert=require('node:assert/strict');
const {primary}=require('../miniprogram/services/order-display');
test('订单卡片动作覆盖付款、外送、自提和售后，全部只提供详情导航',()=>{
 assert.deepEqual(primary({status:'PENDING'}),{label:'去付款',section:'payment'});
 assert.deepEqual(primary({status:'SHIPPED'}),{label:'查看配送',section:'fulfillment'});
 assert.equal(primary({status:'PAID',fulfillment:{type:'PICKUP',readyAt:1}}).label,'查看提货码');
 assert.equal(primary({status:'PAID',fulfillment:{type:'PICKUP'}}).label,'查看备货');
 assert.equal(primary({status:'REFUNDING',refund:{stage:'WAIT_REFUND'}}).section,'aftersale');
 for(const status of ['COMPLETED','CANCELLED','EXPIRED'])assert.equal(primary({status}).section,'overview');
 assert.equal(primary({status:'PAID',refund:{stage:'REJECTED'}}).section,'fulfillment');
});
const fs=require('node:fs');
test('两个订单入口使用相同卡片模板，操作只打开详情',()=>{const read=n=>fs.readFileSync('miniprogram/pages/'+n+'/index.wxml','utf8').match(/<template name="buyer-order-card">[\s\S]*?<\/template>/)[0];assert.equal(read('shop'),read('orders'));assert.match(read('shop'),/catchtap="showOrder"/);assert.doesNotMatch(read('shop'),/bindtap="action"|catchtap="action"/);});
