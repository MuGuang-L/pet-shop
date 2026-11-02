'use strict';
const need=(ok,message)=>{if(!ok)throw Error(message);};
const defaults={enabled:false,amounts:[10000,20000,50000],terms:'充值余额仅限本店消费，不计息；商品退款退回余额。充值退款请联系门店，按原支付渠道处理。'};
function normalizeTiers(member={}){
 const source=Array.isArray(member.tiers)&&member.tiers.length?member.tiers:(Array.isArray(member.amounts)&&member.amounts.length?member.amounts:defaults.amounts).map(item=>typeof item==='number'?{pay:item,credit:item}:item);
 const tiers=source.map(item=>({pay:item.pay,credit:item.credit??item.pay})).sort((a,b)=>a.pay-b.pay);
 need(tiers.length>=1&&tiers.length<=6,'充值档位须为 1 到 6 个');
 need(tiers.every(t=>Number.isSafeInteger(t.pay)&&t.pay>=100&&t.pay<=500000),'充值金额须为 1 到 5000 元');
 need(tiers.every(t=>Number.isSafeInteger(t.credit)&&t.credit>=t.pay&&t.credit<=1000000),'到账金额不能低于充值金额，且不超过 10000 元');
 need(new Set(tiers.map(t=>t.pay)).size===tiers.length,'充值金额不能重复');
 return tiers;
}
function settings(state){const saved={...defaults,...state.shopSettings?.membership};const tiers=normalizeTiers(saved);return {...saved,tiers,amounts:tiers.map(t=>t.pay)};}
function account(state,id){state.wallets ||= {};const wallet=state.wallets[id] ||= {balance:0,entries:[]};const phone=state.profiles?.[id]?.phone;if(phone)wallet.phone=phone;return wallet;}
function movement(state,id,amount,key,label,now){
 const wallet=account(state,id),previous=wallet.entries.find(e=>e.key===key);
 if(previous){need(previous.amount===amount,'储值流水冲突');return;}
 need(Number.isSafeInteger(amount)&&Number.isSafeInteger(wallet.balance+amount)&&wallet.balance+amount>=0&&wallet.balance+amount<=100000000,'余额不足或超出限额');
 wallet.balance+=amount;wallet.entries.push({key,amount,label,at:now,balance:wallet.balance});
}
const actions=new Set(['membership','merchantMembers','createRecharge','balancePay']);
function handle(state,actor,action,input,now,allocate){
 if(action==='membership'){const w=state.wallets?.[actor.id]||{balance:0,entries:[]};return {...settings(state),...w,entries:w.entries.slice(-50).reverse()};}
 if(action==='merchantMembers'){need(actor.merchant===true,'FORBIDDEN');return Object.entries(state.wallets||{}).map(([id,w])=>{const phone=state.profiles?.[id]?.phone||w.phone||'';return {phone:phone||'未绑定手机号',balance:w.balance,entries:w.entries.slice(-50).reverse()};});}
 need(!actor.merchant,'商家账号不能充值或消费');
 if(action==='createRecharge'){
  need(settings(state).enabled,'门店暂未开放充值');
  need(typeof input.key==='string'&&/^[a-zA-Z0-9_-]{8,80}$/.test(input.key),'IDEMPOTENCY_KEY_REQUIRED');
  const key=JSON.stringify(['recharge',actor.id,input.key]);
  const tier=settings(state).tiers.find(t=>t.pay===input.amount);need(tier,'请选择有效充值档位');
  const yuan=n=>(n/100).toFixed(2),spec=tier.credit===tier.pay?'充值 ¥'+yuan(tier.pay):'支付 ¥'+yuan(tier.pay)+'，到账 ¥'+yuan(tier.credit);
  if(state.keys[key]){const o=state.orders.find(o=>o.id===state.keys[key].id);need(o&&o.total===input.amount,'充值请求已用于其他金额');if(o.status==='PENDING'&&!o.payment){o.walletCredit=tier.credit;if(o.lines[0])o.lines[0].spec=spec;}else need((o.walletCredit??o.total)===tier.credit,'充值请求已用于其他金额');return o;}
  const order={id:'o'+(++state.sequence),orderNo:allocate(),kind:'RECHARGE',userId:actor.id,lines:[{productId:'membership',skuId:'recharge',qty:1,name:'会员储值充值',spec,price:tier.pay,image:''}],address:{name:'会员充值',phone:'',detail:'本店会员余额'},fulfillment:{type:'WALLET'},subtotal:tier.pay,shippingFee:0,total:tier.pay,walletCredit:tier.credit,status:'PENDING',createdAt:now,updatedAt:now,expiresAt:now+900000,released:true,refund:null};
  state.orders.push(order);state.keys[key]={id:order.id};return order;
 }
 const o=state.orders.find(o=>o.id===input.id);need(o&&o.userId===actor.id,'FORBIDDEN');need(o.kind!=='RECHARGE','充值订单不能使用余额支付');
 if(o.payment?.provider==='BALANCE')return o;
 need(o.status==='PENDING'&&!o.payment,'订单状态已变化，请刷新');
 movement(state,actor.id,-o.total,'pay:'+o.id,'余额支付 · '+o.orderNo,now);
 o.payment={provider:'BALANCE',transactionId:'balance-'+o.id,amount:o.total};o.status='PAID';o.updatedAt=now;return o;
}
function credited(order){return Number.isSafeInteger(order.walletCredit)?order.walletCredit:order.total;}
function creditRecharge(state,order,now){const amount=credited(order);movement(state,order.userId,amount,'recharge:'+order.id,(amount===order.total?'微信充值 · ':'微信充值到账 · ')+order.orderNo,now);order.status='COMPLETED';}
function reserveRechargeRefund(state,order,now){if(order.kind==='RECHARGE'&&order.status==='REFUNDING'&&!order.refund.latePayment)movement(state,order.userId,-credited(order),'recharge-refund:'+order.id,'充值退回原渠道 · '+order.orderNo,now);}
function refundBalance(state,order,now){if(order.payment?.provider==='BALANCE'){movement(state,order.userId,order.total,'refund:'+order.id,'退款退回余额 · '+order.orderNo,now);order.refund.provider='BALANCE';}}
module.exports={defaults,normalizeTiers,settings,actions,handle,creditRecharge,reserveRechargeRefund,refundBalance};
