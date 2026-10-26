'use strict';
const actions=new Set(['recordFulfillmentIssue','resolveFulfillmentIssue','merchantRefund']);
const need=(ok,message)=>{if(!ok)throw Error(message);};
const titles={OUT_OF_STOCK:'缺货待处理',DELIVERY_FAILED:'外送未送达',PICKUP_DELAY:'自提延期',CONTACT_UNREACHABLE:'联系未果'};
function note(value){need(typeof value==='string'&&value.trim().length>0&&value.length<=300,'处理说明请填写 1～300 字');return value.trim();}
function event(order,now,action,label,detail,actor='商家'){
 order.fulfillment.issue.timeline.push({at:now,action,label,detail,actor});order.fulfillment.issue.revision=(order.fulfillment.issue.revision||0)+1;order.fulfillment.issue.updatedAt=now;order.updatedAt=now;
}
function finishIssue(order,now,resolution,detail,actor='商家'){
 const issue=order.fulfillment?.issue;if(!issue||issue.status!=='OPEN')return;
 issue.status='RESOLVED';issue.resolution=resolution;issue.closedAt=now;
 event(order,now,resolution,resolution==='REFUNDED'?'退款完成，履约结束':'履约问题已处理',detail,actor);
}
function stockPlan(order,items){
 need(Array.isArray(items)&&items.length===order.lines.length,'请核对全部商品的实际数量');
 return order.lines.map(line=>{const rows=items.filter(i=>i&&i.productId===line.productId&&i.skuId===line.skuId);need(rows.length===1,'商品规格重复或不匹配');const i=rows[0];
  need(Number.isSafeInteger(i.receivedQty)&&i.receivedQty>=0&&i.receivedQty<=line.qty,'在店或取回数量不能超过订单数量');
  need(Number.isSafeInteger(i.restockQty)&&i.restockQty>=0&&i.restockQty<=i.receivedQty,'可售数量不能超过在店或取回数量');
  return {productId:line.productId,skuId:line.skuId,name:line.name,spec:line.spec,orderedQty:line.qty,receivedQty:i.receivedQty,restockQty:i.restockQty,quarantineQty:i.receivedQty-i.restockQty,missingQty:line.qty-i.receivedQty};
 });
}
function settleStock(state,order,actor,now,reservedStock){
 const r=order.refund;if(r.stockDispositionApplied)return;
 for(const item of r.stockDisposition){
  const product=state.products.find(p=>p.id===item.productId),sku=product?.skus.find(s=>s.id===item.skuId),before=sku?.stock??0;
  if(item.restockQty){need(sku,'原商品规格不存在，暂不能完成入库');const otherReserved=reservedStock(state,item.productId,item.skuId)-(r.previous==='PAID'&&!order.released?item.orderedQty:0);need(before+item.restockQty+otherReserved<=100000,'入库后库存超过上限');sku.stock+=item.restockQty;product.revision=(product.revision??0)+1;}
  (state.stockMovements ||= []).push({id:'sm'+(++state.sequence),orderId:order.id,caseId:r.caseId,type:'FULFILLMENT_RETURN',at:now,actor:actor.id,reason:r.reason,...item,before,after:before+item.restockQty,delta:item.restockQty});
 }
 order.released=true;r.stockDispositionApplied=true;r.stockDispositionAt=now;
}
function handle(state,actor,action,input,{now}){
 need(actor.merchant===true,'FORBIDDEN');const order=state.orders.find(o=>o.id===input.id);need(order,'ORDER_NOT_FOUND');
 const detail=note(input.note);need(typeof input.requestKey==='string'&&/^[a-zA-Z0-9_-]{8,80}$/.test(input.requestKey),'INVALID_REQUEST_KEY');
 const key=JSON.stringify(['fulfillment',actor.id,input.requestKey]),fingerprint=JSON.stringify([action,input.id,input.issueId,input.issueRevision,input.type,input.resolution,detail,input.nextAt,input.number,input.confirm,input.items]);
 if(state.keys[key]){need(state.keys[key].fingerprint===fingerprint,'处理请求已提交，请勿改动原请求重试');return order;}
 need(['PAID','SHIPPED'].includes(order.status),'订单状态已变化，请先处理当前订单或售后');
 const f=order.fulfillment||=( {type:'DELIVERY'} ),pickup=f.type==='PICKUP';
 if(action==='recordFulfillmentIssue'){
  need(typeof input.type==='string'&&Object.prototype.hasOwnProperty.call(titles,input.type),'请选择有效的履约问题');need(!f.issue||f.issue.status!=='OPEN','已有待处理问题，请先处理或更新约定时间');
  if(input.type==='OUT_OF_STOCK')need(order.status==='PAID','已送出订单请登记外送问题');
  if(input.type==='DELIVERY_FAILED')need(!pickup&&order.status==='SHIPPED','仅已送出的外送订单可登记未送达');
  if(input.type==='PICKUP_DELAY')need(pickup&&order.status==='PAID'&&f.readyAt,'仅已备好的自提订单可登记延期');
  if(f.issue)(f.issueHistory ||= []).push(f.issue);
  f.issue={id:'f'+(++state.sequence),type:input.type,status:'OPEN',note:detail,createdAt:now,updatedAt:now,timeline:[]};
  event(order,now,action,titles[input.type],detail);
 }else{
  const issue=f.issue;need(issue&&issue.status==='OPEN'&&issue.id===input.issueId,'履约问题已变化，请刷新后重试');need(Number.isSafeInteger(input.issueRevision)&&input.issueRevision===issue.revision,'履约问题已更新，请刷新后核对');
  if(action==='resolveFulfillmentIssue'){
   need(['RESCHEDULE','RESUME','REDELIVER'].includes(input.resolution),'请选择有效处理方式');
   if(input.resolution==='RESCHEDULE'){
    need(Number.isSafeInteger(input.nextAt)&&input.nextAt>now&&input.nextAt<=now+30*86400000,'约定时间须在未来 30 天内');issue.nextAt=input.nextAt;issue.note=detail;
    event(order,now,'RESCHEDULE','已协商改期',detail);issue.timeline[issue.timeline.length-1].nextAt=input.nextAt;
   }else if(input.resolution==='RESUME'){
    need(order.status==='PAID','外送订单请登记重新送出或退款');finishIssue(order,now,'RESUME',detail);
   }else{
    need(!pickup&&order.status==='SHIPPED','仅外送中订单可以重新送出');const number=String(input.number||'').trim();need(!number||/^[A-Za-z0-9-]{3,40}$/.test(number),'配送单号请填写 3～40 位字母、数字或横线');
    if(order.shipping)(f.deliveryHistory ||= []).push(order.shipping);order.shipping={company:'商家自行配送',number,note:detail,at:now};finishIssue(order,now,'REDELIVER',detail);
   }
  }else if(action==='merchantRefund'){
   need(input.confirm===true,'请确认整单退款金额和实际可售数量');const items=stockPlan(order,input.items);
   order.refundHistory ||= [];if(order.refund)order.refundHistory.push(order.refund);
   order.refund={caseId:'r'+(++state.sequence),type:'REFUND_ONLY',amount:order.total,reason:detail,status:'PROCESSING',stage:'WAIT_REFUND',previous:order.status,merchantInitiated:true,issueId:issue.id,stockDisposition:items,stockDispositionApplied:false,
    review:{approve:true,note:detail,at:now},timeline:[{at:now,actor:'商家',action:'merchantRefund',label:'商家取消履约并发起整单退款',detail}]};
   order.status='REFUNDING';event(order,now,'merchantRefund','商家发起退款',detail);
  }
 }
 state.keys[key]={fingerprint,orderId:order.id};return order;
}
function trackingEvents(order){
 const f=order.fulfillment||{},events=[];
 if(f.type==='PICKUP'){if(f.readyAt)events.push({time:f.readyAt,text:'商品已备好，可到店自提'});if(f.redeemedAt)events.push({time:f.redeemedAt,text:'已凭提货码核销'});}
 else [...(f.deliveryHistory||[]),...(order.shipping?[order.shipping]:[])].forEach((s,i)=>events.push({time:s.at,text:(i?'商家已重新送出':'商家已登记送出')+(s.number?' · '+s.number:'')+(s.note?' · '+s.note:'')}));
 for(const issue of [...(f.issueHistory||[]),...(f.issue?[f.issue]:[])])for(const e of issue.timeline||[])if(e.action!=='REDELIVER')events.push({time:e.at,text:e.label+' · '+e.detail,...(e.nextAt?{nextAt:e.nextAt}:{})});
 if(order.status==='COMPLETED'&&f.type!=='PICKUP')events.push({time:order.updatedAt,text:'买家已确认收货'});
 return events.sort((a,b)=>a.time-b.time);
}
module.exports={actions,handle,titles,finishIssue,settleStock,stockPlan,trackingEvents};
