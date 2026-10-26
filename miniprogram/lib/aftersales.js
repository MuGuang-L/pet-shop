'use strict';
const fulfillment=require('./fulfillment');
const actions=new Set(['refundRequest','refundWithdraw','refundReview','returnShip','returnInspect','refundFail','mockRefund']);
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
function text(value,label,max=300){requireValue(typeof value==='string'&&value.trim().length>0&&value.length<=max,`${label}请填写 1～${max} 字`);return value.trim();}
function normalized(order){if(!order.refund)return null;const r=order.refund;const type=r.type||(r.latePayment||r.previous==='PAID'?'REFUND_ONLY':'RETURN_REFUND');return {...r,caseId:r.caseId||'legacy-'+order.id,type,amount:r.amount??order.total,stage:r.stage||({REQUESTED:'REQUESTED',REJECTED:'REJECTED',WITHDRAWN:'WITHDRAWN',SUCCEEDED:'SUCCEEDED'}[r.status]||(type==='RETURN_REFUND'?'WAIT_RETURN':'WAIT_REFUND')),timeline:r.timeline||[]};}
function handle(state,actor,action,input,options,{release,address,reservedStock}){
 const merchant=['refundReview','returnInspect','refundFail','mockRefund'].includes(action);
 if(merchant)requireValue(actor.merchant===true,'FORBIDDEN');
 if(['refundFail','mockRefund'].includes(action))requireValue(options.mock===true,'MOCK_DISABLED');
 const o=state.orders.find(o=>o.id===input.id);requireValue(o,'ORDER_NOT_FOUND');
 requireValue(merchant||o.userId===actor.id,'FORBIDDEN');
 const now=options.now??Date.now();const event=(label,detail)=>{o.refund.timeline.push({at:now,actor:merchant?'商家':'买家',action,label,detail});o.updatedAt=now;};
 o.refund=normalized(o);
 if(action==='refundRequest'){
  const reason=text(input.reason,'售后原因');
  const type=input.type||(o.status==='PAID'?'REFUND_ONLY':'RETURN_REFUND');requireValue(['REFUND_ONLY','RETURN_REFUND'].includes(type),'请选择有效售后类型');
  if(o.status==='REFUND_REQUESTED'){requireValue(o.refund.reason===reason&&o.refund.type===type,'已有售后申请，请先撤回再修改');return o;}
  requireValue(['PAID','SHIPPED','COMPLETED'].includes(o.status),'INVALID_STATE');
  requireValue(o.status!=='PAID'||type==='REFUND_ONLY','未发货订单请选择仅退款');
  o.refundHistory=o.refundHistory||[];requireValue(o.refundHistory.length<20,'售后记录已达上限，请人工处理');if(o.refund)o.refundHistory.push(o.refund);
  o.refund={caseId:'r'+(++state.sequence),type,amount:o.total,reason,status:'REQUESTED',stage:'REQUESTED',previous:o.status,timeline:[]};o.status='REFUND_REQUESTED';event('提交售后申请',reason);return o;
 }
 requireValue(o.refund&&input.caseId===o.refund.caseId,'售后单已变化，请刷新后重试');const r=o.refund;
 if(action==='refundWithdraw'){
  if(r.stage==='WITHDRAWN')return o;requireValue(o.status==='REFUND_REQUESTED','只能撤回待审核的申请');r.stage='WITHDRAWN';r.status='WITHDRAWN';o.status=r.previous;event('买家撤回申请','订单恢复原状态');return o;
 }
 if(action==='refundReview'){
  requireValue(typeof input.approve==='boolean','请选择审核结果');const reviewNote=text(input.note,'审核意见');const reviewFingerprint=JSON.stringify([input.approve,reviewNote,input.items??null,input.confirm??null,input.waiveReturn??null,input.returnAddress??null]);
  if(r.review){requireValue(r.review.approve===input.approve&&r.review.note===reviewNote&&(!r.review.fingerprint||r.review.fingerprint===reviewFingerprint),'审核结果已提交，不能覆盖');return o;}
  requireValue(o.status==='REFUND_REQUESTED','INVALID_STATE');
  if(input.approve&&r.type==='RETURN_REFUND')r.returnAddress=address(input.returnAddress);
  if(input.approve&&r.type==='REFUND_ONLY'&&(input.items!==undefined||o.fulfillment?.issue?.status==='OPEN')){requireValue(input.confirm===true,'请确认整单退款金额和实际可售数量');r.stockDisposition=fulfillment.stockPlan(o,input.items);r.stockDispositionApplied=false;}
  if(input.approve&&r.type==='REFUND_ONLY'&&!r.stockDisposition&&['SHIPPED','COMPLETED'].includes(r.previous))requireValue(input.waiveReturn===true,'请确认已发货商品仅退款且不回补库存');
  r.review={approve:input.approve,note:reviewNote,at:now,fingerprint:reviewFingerprint};
  if(input.approve){o.status='REFUNDING';r.status='PROCESSING';r.stage=r.type==='RETURN_REFUND'?'WAIT_RETURN':'WAIT_REFUND';event('商家同意售后',reviewNote);}else{o.status=r.previous;r.status='REJECTED';r.stage='REJECTED';event('商家拒绝申请',reviewNote);}return o;
 }
 if(action==='returnShip'){
  const company=text(input.company,'退货快递公司',30);requireValue(typeof input.number==='string'&&/^[A-Za-z0-9-]{5,40}$/.test(input.number),'请填写 5～40 位字母、数字或横线组成的退货单号');
  if(r.returnShipping){requireValue(r.returnShipping.company===company&&r.returnShipping.number===input.number,'退货运单已提交，不能重复覆盖');return o;}
  requireValue(o.status==='REFUNDING'&&r.stage==='WAIT_RETURN','当前不能提交退货物流');r.returnShipping={company,number:input.number,at:now};r.stage='RETURN_TRANSIT';event('买家提交退货物流',company+' / '+input.number);return o;
 }
 if(action==='returnInspect'){
  const note=text(input.note,'验收说明');requireValue(Array.isArray(input.items)&&input.items.length===o.lines.length,'请核对全部退货规格');
  const seen=new Set();const items=o.lines.map(line=>{const matches=input.items.filter(i=>i.productId===line.productId&&i.skuId===line.skuId);requireValue(matches.length===1,'退货规格重复或不匹配');const i=matches[0],key=i.productId+'|'+i.skuId;requireValue(!seen.has(key),'退货规格重复');seen.add(key);requireValue(Number.isInteger(i.receivedQty)&&i.receivedQty>=0&&i.receivedQty<=line.qty,'实收数量不能超过购买数量');requireValue(Number.isInteger(i.restockQty)&&i.restockQty>=0&&i.restockQty<=i.receivedQty,'可售入库数量不能超过实收数量');return {productId:i.productId,skuId:i.skuId,name:line.name,spec:line.spec,orderedQty:line.qty,receivedQty:i.receivedQty,restockQty:i.restockQty,quarantineQty:i.receivedQty-i.restockQty,missingQty:line.qty-i.receivedQty};});
  const fingerprint=JSON.stringify({items,note});if(r.inspection){requireValue(r.inspection.fingerprint===fingerprint,'验收已入账，不能重复或覆盖入库');return o;}
  requireValue(o.status==='REFUNDING'&&r.stage==='RETURN_TRANSIT','请先等待买家提交退货物流');requireValue(input.confirm===true,'请确认验收数量与整单退款金额');
  for(const i of items){if(i.restockQty){const p=state.products.find(p=>p.id===i.productId),sku=p&&p.skus.find(k=>k.id===i.skuId);requireValue(sku,'原规格不存在，不能入库；请将可售入库数量设为 0 并说明原因');requireValue(sku.stock+i.restockQty+reservedStock(state,p.id,sku.id)<=100000,'入库后库存超过上限');sku.stock+=i.restockQty;p.revision=(p.revision??0)+1;}}
  r.inspection={at:now,note,items,fingerprint};state.stockMovements=state.stockMovements||[];for(const i of items)state.stockMovements.push({id:r.caseId+'-'+i.productId+'-'+i.skuId,orderId:o.id,caseId:r.caseId,at:now,actor:actor.id,type:'RETURN_INSPECTION',...i});
  r.stage='WAIT_REFUND';event('商家验收退货并记账',note);return o;
 }
 if(action==='refundFail'){
  const reason=text(input.reason,'失败原因');if(r.stage==='REFUND_FAILED'&&r.failureReason===reason)return o;requireValue(o.status==='REFUNDING'&&['WAIT_REFUND','REFUND_FAILED'].includes(r.stage),'当前不能模拟退款失败');r.stage='REFUND_FAILED';r.failureReason=reason;event('模拟退款失败',reason);return o;
 }
 if(action==='mockRefund'){
  if(o.status==='REFUNDED')return o;requireValue(o.status==='REFUNDING'&&['WAIT_REFUND','REFUND_FAILED'].includes(r.stage),'退货尚未验收，不能退款');
  if(r.stockDisposition)fulfillment.settleStock(state,o,actor,now,reservedStock);else if(r.previous==='PAID')release(state,o);o.status='REFUNDED';fulfillment.finishIssue(o,now,'REFUNDED','整单退款完成，履约结束');r.status='SUCCEEDED';r.stage='SUCCEEDED';r.provider='MOCK';r.refundedAt=now;event('模拟退款成功','整单退还 ¥'+(r.amount/100).toFixed(2)+'，未产生真实资金流');return o;
 }
 throw Error('UNKNOWN_ACTION');
}
module.exports={actions,handle,normalized};
