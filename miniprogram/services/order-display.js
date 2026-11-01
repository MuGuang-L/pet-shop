const studio=require('../lib/studio');
function primary(o){
 if(o.status==='PENDING')return {label:'去付款',section:'payment'};
 if(o.refund&&!['WITHDRAWN','REJECTED'].includes(o.refund.stage))return {label:'查看售后',section:'aftersale'};
 if(o.status==='PAID'&&o.fulfillment?.type==='PICKUP')return {label:o.fulfillment.readyAt?'查看提货码':'查看备货',section:'fulfillment'};
 if(o.status==='SHIPPED'||o.status==='PAID')return {label:'查看配送',section:'fulfillment'};
 return {label:'查看详情',section:'overview'};
}
function card(o){return {primaryAction:primary(o),fulfillmentText:o.fulfillment?.type==='PICKUP'?'到店自提':'商家外送',itemCount:o.lines.reduce((n,l)=>n+l.qty,0),statusText:studio.afterStages[o.refund?.stage]&&o.status.startsWith('REFUND')?studio.afterStages[o.refund.stage]:studio.fulfillmentLabel(o)};}
module.exports={primary,card};
