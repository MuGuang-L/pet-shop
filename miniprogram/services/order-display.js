const studio=require('../lib/studio');
function primary(o){
 if(o.status==='PENDING')return {label:'去付款',section:'payment'};
 if(o.refund&&!['WITHDRAWN','REJECTED'].includes(o.refund.stage))return {label:'查看售后',section:'aftersale'};
 if(o.status==='PAID'&&studio.isInStore(o))return {label:o.fulfillment.readyAt?'出示订单':'查看备货',section:'fulfillment'};
 if(o.status==='SHIPPED'||o.status==='PAID')return {label:'查看配送',section:'fulfillment'};
 return {label:'查看详情',section:'overview'};
}
function card(o){return {orderDateText:(o.orderDate||'').replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),primaryAction:primary(o),fulfillmentText:studio.fulfillmentName(o),itemCount:o.lines.reduce((n,l)=>n+l.qty,0),statusText:studio.afterStages[o.refund?.stage]&&o.status.startsWith('REFUND')?studio.afterStages[o.refund.stage]:studio.fulfillmentLabel(o)};}
// Only persisted event times are shown; updatedAt is not a historical payment time.
function timeline(o){
 const f=o.fulfillment||{},pickup=studio.isInStore(o),events=[];
 const add=(key,title,time,detail='')=>{if(Number.isFinite(time)&&time>0)events.push({key,title,time,detail});};
 add('created','订单已提交',o.createdAt,'订单号 '+(o.orderNo||o.id));
 if(pickup){add('ready',f.type==='DINE_IN'?'餐品已备好，请取餐':'商品已备好，等待自提',f.readyAt,'请出示订单领取');add('redeemed',f.type==='DINE_IN'?'堂食已完成':'已完成自提',f.redeemedAt,'商家已确认交付商品');}
 else [...(f.deliveryHistory||[]),...(o.shipping?[o.shipping]:[])].forEach((s,i)=>add('delivery-'+i,s.carrier?(i?'已登记补发':'商家已登记发货'):(i?'再次发货':'商家已发货'),s.at,[s.number?'快递单号 '+s.number:'',s.note].filter(Boolean).join(' · ')));
 for(const issue of [...(f.issueHistory||[]),...(f.issue?[f.issue]:[])])
  (issue.timeline||[]).forEach((e,i)=>{if(e.action!=='REDELIVER')add('issue-'+issue.id+'-'+i,e.label||'配送进度更新',e.at,e.detail||'');});
 if(o.status==='COMPLETED'&&!pickup)add('received','买家已确认收货',o.updatedAt,'本次配送已完成');
 if(o.status==='CANCELLED'||o.status==='EXPIRED')add('closed',o.status==='EXPIRED'?'订单超时关闭':'订单已取消',o.updatedAt,'无需继续付款');
 (o.refund?.timeline||[]).forEach((e,i)=>add('refund-'+i,e.label||'售后进度更新',e.at,e.detail||''));
 events.reverse();events.sort((a,b)=>b.time-a.time);
 // Current state can be known even when its transition time was not persisted.
 if(o.status==='PENDING')events.unshift({key:'current',title:'等待付款',detail:'付款完成后由商家安排备货'});
 if(o.status==='PAID'&&!f.readyAt&&f.issue?.status!=='OPEN')events.unshift({key:'current',title:'已付款，等待备货',detail:pickup?(f.type==='DINE_IN'?'已立即取单，请在订单中查看取餐进度':'备好后可出示订单到店领取'):'商家寄出后将在这里更新配送进度'});
 return events;
}
module.exports={primary,card,timeline};
