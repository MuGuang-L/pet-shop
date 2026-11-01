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

const {timeline}=require('../miniprogram/services/order-display');
test('配送时间线按真实事件倒序，保留再次送出与异常记录且不修改原订单',()=>{
 const o={id:'o1',status:'COMPLETED',createdAt:100,updatedAt:600,shipping:{at:500,number:'D2',note:'店员配送'},fulfillment:{type:'DELIVERY',deliveryHistory:[{at:200,number:'D1'}],issueHistory:[{id:'i1',timeline:[{at:300,label:'外送失败',detail:'联系未果'},{at:500,action:'REDELIVER',label:'再次送出'}]}]}};
 const before=JSON.stringify(o),rows=timeline(o);
 assert.deepEqual(rows.map(e=>e.time),[600,500,300,200,100]);
 assert.equal(rows[0].title,'买家已确认收货');assert.match(rows[1].detail,/D2/);assert.equal(JSON.stringify(o),before);
});
test('自提时间线使用备好和核销时间，不生成外送事件',()=>{
 const rows=timeline({id:'o2',status:'COMPLETED',createdAt:100,updatedAt:900,fulfillment:{type:'PICKUP',readyAt:200,redeemedAt:300}});
 assert.deepEqual(rows.map(e=>e.time),[300,200,100]);assert.equal(rows[0].title,'已完成自提');
});
test('未付款、取消及旧付款订单不伪造接单和付款时间',()=>{
 const base={id:'o3',createdAt:100,updatedAt:500,fulfillment:{type:'DELIVERY'}};
 const paid=timeline({...base,status:'PAID'});assert.equal(paid[0].time,undefined);assert.match(paid[0].title,/已付款/);assert.equal(paid.length,2);
 const cancelled=timeline({...base,status:'CANCELLED'});assert.equal(cancelled[0].title,'订单已取消');assert.equal(cancelled.length,2);
 assert.equal(timeline({...base,status:'PENDING'})[0].title,'等待付款');
});
