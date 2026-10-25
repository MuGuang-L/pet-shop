'use strict';
const studio=require('./studio');
const copy=value=>JSON.parse(JSON.stringify(value));
const need=(ok,message)=>{if(!ok)throw Error(message);};
const days=['周一','周二','周三','周四','周五','周六','周日'];
function read(state){
  const saved=state.shopSettings;
  if(saved)return copy(saved);
  return {revision:0,updatedAt:null,store:{name:studio.pickupStore.name,detail:studio.pickupStore.detail,phone:studio.pickupStore.phone},
    acceptingOrders:true,hours:{days:[1,2,3,4,5,6,7],open:'10:00',close:'20:00',allDay:false,enforce:false},
    pickup:{enabled:true,instructions:'请收到备货完成通知后，凭提货码到店领取。'},
    delivery:{enabled:true,fee:state.shippingFee??800,minimum:0,freeAbove:null,area:'请先与门店确认是否在外送范围内。',estimateMinutes:60,instructions:'由商家安排配送，送出后登记单号或备注。'}};
}
function hoursText(hours){return (hours.days.length===7?'每日':hours.days.map(d=>days[d-1]).join('、'))+' '+(hours.allDay?'全天':hours.open+'—'+hours.close);}
function pickupStore(settings){return {...settings.store,hours:hoursText(settings.hours)};}
function openNow(settings,now){
  if(!settings.acceptingOrders)return false;
  if(!settings.hours.enforce)return true;
  const date=new Date(now+8*60*60*1000),day=date.getUTCDay()||7,minutes=date.getUTCHours()*60+date.getUTCMinutes();
  const time=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
  return settings.hours.days.includes(day)&&(settings.hours.allDay||(minutes>=time(settings.hours.open)&&minutes<time(settings.hours.close)));
}
function publicSettings(state,now){const settings=read(state);return {...settings,pickupStore:pickupStore(settings),hoursText:hoursText(settings.hours),canOrder:openNow(settings,now),timeZone:'Asia/Shanghai'};}
function save(state,input,now){
  const current=read(state);
  need(Number.isSafeInteger(input.revision)&&input.revision===current.revision,'店铺设置已更新，请重新打开设置后再保存');
  const text=(value,min,max,label)=>{need(typeof value==='string'&&value.trim().length>=min&&value.trim().length<=max,label+'长度不正确');return value.trim();};
  const bool=(value,label)=>{need(typeof value==='boolean',label+'须为开关值');return value;};
  const amount=(value,label)=>{need(Number.isSafeInteger(value)&&value>=0&&value<=10000000,label+'须为 0 到 100000 元的金额');return value;};
  need(input.store&&input.hours&&input.pickup&&input.delivery,'请完整填写店铺设置');
  const store={name:text(input.store.name,1,60,'门店名称'),detail:text(input.store.detail,5,200,'门店地址'),phone:text(input.store.phone,7,25,'联系电话')};
  need(/^(1\d{10}|0\d{2,3}-?\d{7,8}|400-?\d{3}-?\d{4})$/.test(store.phone),'请填写有效的手机号、座机或 400 电话');
  const h=input.hours;need(Array.isArray(h.days)&&h.days.length>0&&h.days.length<=7&&h.days.every(d=>Number.isInteger(d)&&d>=1&&d<=7)&&new Set(h.days).size===h.days.length,'请选择有效且不重复的营业日');
  need([h.open,h.close].every(v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v)),'营业时间格式应为 HH:mm');
  const hours={days:[...h.days].sort(),open:h.open,close:h.close,allDay:bool(h.allDay,'全天营业'),enforce:bool(h.enforce,'营业时间接单限制')};
  need(hours.allDay||hours.open<hours.close,'结束时间须晚于开始时间；跨夜营业请暂用全天营业');
  const pickup={enabled:bool(input.pickup.enabled,'到店自提'),instructions:text(input.pickup.instructions,0,300,'自提说明')};
  const d=input.delivery,delivery={enabled:bool(d.enabled,'商家外送'),fee:amount(d.fee,'外送费'),minimum:amount(d.minimum,'外送起送金额'),freeAbove:d.freeAbove===null?null:amount(d.freeAbove,'免外送费门槛'),area:text(d.area,1,200,'外送范围'),estimateMinutes:d.estimateMinutes,instructions:text(d.instructions,0,300,'外送说明')};
  need(Number.isInteger(delivery.estimateMinutes)&&delivery.estimateMinutes>=1&&delivery.estimateMinutes<=1440,'预计送达时间须为 1 到 1440 分钟');
  const acceptingOrders=bool(input.acceptingOrders,'接单状态');need(!acceptingOrders||pickup.enabled||delivery.enabled,'接单时请至少开启一种履约方式');
  state.shopSettings={revision:current.revision+1,updatedAt:now,store,acceptingOrders,hours,pickup,delivery};
  state.shippingFee=delivery.fee;
  return publicSettings(state,now);
}
function quote(state,input,now){
  const settings=read(state),type=input.fulfillment||'DELIVERY';
  need(['PICKUP','DELIVERY'].includes(type),'请选择自提或商家外送');
  need(settings.acceptingOrders,'门店已暂停接单，请稍后再试');
  need(openNow(settings,now),'当前不在接单时间内，请在营业时间下单');
  need(type==='PICKUP'?settings.pickup.enabled:settings.delivery.enabled,type==='PICKUP'?'门店暂未开放到店自提':'门店暂未开放商家外送');
  if(input.settingsRevision!==undefined)need(input.settingsRevision===settings.revision,'门店设置已变化，请刷新结算信息后重试');
  need(Array.isArray(input.lines)&&input.lines.length>0&&input.lines.length<=30,'INVALID_LINES');
  let subtotal=0;const seen=new Set();
  for(const line of input.lines){
    need(Number.isSafeInteger(line.qty)&&line.qty>0&&line.qty<=99,'INVALID_QUANTITY');
    const key=line.productId+'|'+line.skuId;need(!seen.has(key),'DUPLICATE_SKU');seen.add(key);
    const product=state.products.find(p=>p.id===line.productId&&p.active);need(product,'PRODUCT_UNAVAILABLE');
    const sku=product.skus.find(k=>k.id===line.skuId);need(sku,'SKU_NOT_FOUND');need(sku.stock>=line.qty,'OUT_OF_STOCK');subtotal+=sku.price*line.qty;
  }
  need(Number.isSafeInteger(subtotal)&&subtotal<=100000000,'AMOUNT_LIMIT');
  if(type==='DELIVERY')need(subtotal>=settings.delivery.minimum,'外送商品金额须满 '+(settings.delivery.minimum/100).toFixed(2)+' 元');
  const shippingFee=type==='PICKUP'||(settings.delivery.freeAbove!==null&&subtotal>=settings.delivery.freeAbove)?0:settings.delivery.fee;
  const total=subtotal+shippingFee;
  if(input.expectedTotal!==undefined)need(input.expectedTotal===total,'订单金额已变化，请刷新结算信息后重试');
  return {settingsRevision:settings.revision,fulfillment:type,subtotal,shippingFee,total,pickupStore:pickupStore(settings),instructions:type==='PICKUP'?settings.pickup.instructions:settings.delivery.instructions,delivery:type==='DELIVERY'?copy(settings.delivery):null};
}
module.exports={read,save,publicSettings,pickupStore,openNow,quote};
