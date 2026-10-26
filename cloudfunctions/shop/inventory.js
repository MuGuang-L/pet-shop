'use strict';
const need=(ok,code)=>{if(!ok)throw Error(code);};
const actions=new Set(['adjustStock','stockHistory']);
const types=['RECEIVE','COUNT','LOSS','PRODUCT_EDIT','INITIAL','RETURN_INSPECTION'];
function record(state,actor,product,sku,before,after,type,reason,now){
  const row={id:'sm'+(++state.sequence),productId:product.id,skuId:sku.id,name:product.name,spec:sku.name,
    actor:actor.id,at:now,type,reason,before,after,delta:after-before};
  (state.stockMovements ||= []).push(row);return row;
}
// Older clients may still edit stock through saveProduct. Keep the API compatible
// while recording those changes with the same transaction as the product update.
function productChanges(state,actor,before,after,input,now){
  const reason=input.stockReason===undefined?(before?'商品编辑调整':'商品初始入库'):input.stockReason;
  need(typeof reason==='string'&&reason.trim().length>0&&reason.length<=200,'STOCK_REASON_REQUIRED');
  const old=new Map((before?.skus||[]).map(s=>[s.id,s]));
  for(const sku of after.skus){const previous=old.get(sku.id);if((previous?.stock||0)!==sku.stock)record(state,actor,after,sku,previous?.stock||0,sku.stock,previous?'PRODUCT_EDIT':'INITIAL',reason.trim(),now);old.delete(sku.id);}
  for(const sku of old.values())if(sku.stock)record(state,actor,before,sku,sku.stock,0,'PRODUCT_EDIT',reason.trim()+'（移除规格）',now);
}
function historyArgs(input={}){
  const {page=1,pageSize=10,productId='',type='ALL'}=input;
  need(Number.isSafeInteger(page)&&page>=1&&page<=100000,'INVALID_PAGE');
  need(Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=50,'INVALID_PAGE_SIZE');
  need(typeof productId==='string'&&productId.length<=80,'PRODUCT_NOT_FOUND');
  need(type==='ALL'||types.includes(type),'INVALID_STOCK_TYPE');return {page,pageSize,productId,type};
}
function normalize(row){return {...row,delta:row.delta??row.restockQty??0,reason:row.reason||(row.type==='RETURN_INSPECTION'?'退货验收入库':'库存调整')};}
function handle(state,actor,action,input,{now,reservedStock}){
  need(actor.merchant===true,'FORBIDDEN');
  if(action==='stockHistory'){
    const args=historyArgs(input),rows=(state.stockMovements||[]).filter(r=>(!args.productId||r.productId===args.productId)&&(args.type==='ALL'||r.type===args.type)).slice().sort((a,b)=>b.at-a.at||b.id.localeCompare(a.id));
    const total=rows.length,pages=Math.max(1,Math.ceil(total/args.pageSize)),page=Math.min(args.page,pages);
    return {items:rows.slice((page-1)*args.pageSize,page*args.pageSize).map(normalize),total,pages,page,pageSize:args.pageSize};
  }
  need(typeof input.requestKey==='string'&&/^[a-zA-Z0-9_-]{8,80}$/.test(input.requestKey),'INVALID_REQUEST_KEY');
  const {productId,skuId,revision,type,quantity,reason}=input;
  need(['RECEIVE','COUNT','LOSS'].includes(type),'INVALID_STOCK_TYPE');
  need(Number.isSafeInteger(quantity)&&quantity>=(type==='COUNT'?0:1)&&quantity<=100000,'INVALID_STOCK_QUANTITY');
  need(typeof reason==='string'&&reason.trim().length>0&&reason.length<=200,'STOCK_REASON_REQUIRED');
  const key=JSON.stringify(['inventory',actor.id,input.requestKey]);
  const fingerprint=JSON.stringify([productId,skuId,revision,type,quantity,reason.trim()]);
  if(state.keys[key]){need(state.keys[key].fingerprint===fingerprint,'STOCK_REQUEST_CONFLICT');return state.keys[key].result;}
  const product=state.products.find(p=>p.id===productId);need(product,'PRODUCT_NOT_FOUND');
  need(Number.isSafeInteger(revision)&&revision===(product.revision??0),'PRODUCT_REVISION_CONFLICT');
  const sku=product.skus.find(s=>s.id===skuId);need(sku,'SKU_NOT_FOUND');
  const before=sku.stock,after=type==='COUNT'?quantity:before+(type==='LOSS'?-quantity:quantity);
  need(after>=0,'INSUFFICIENT_AVAILABLE_STOCK');
  need(after+reservedStock(state,productId,skuId)<=100000,'STOCK_CAPACITY_EXCEEDED');
  sku.stock=after;product.revision=(product.revision??0)+1;
  const result=record(state,actor,product,sku,before,after,type,reason.trim(),now);
  state.keys[key]={fingerprint,result:{...result}};return result;
}
module.exports={actions,handle,productChanges,historyArgs,normalize};
