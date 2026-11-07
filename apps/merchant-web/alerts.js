(function(root,factory){const exported=factory();if(typeof module==='object'&&module.exports)module.exports=exported;else root.MerchantAlerts=exported.browser(root);})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 function create({read,render,notify,storage,expired=()=>{},schedule=setTimeout,cancel=clearTimeout,hidden=()=>false}){
  let generation=0,timer=null,account='',seen=new Set(),inflight=false,initial=true,last=[],handled=new Set();
  const key=()=> 'pet-merchant-alerts-v1:'+account;
  function stored(){try{const value=JSON.parse(storage.getItem(key())||'[]');return Array.isArray(value)?value.filter(x=>typeof x==='string').slice(-5000):[];}catch{return [];}}
  function stop(){generation++;if(timer!==null)cancel(timer);timer=null;account='';inflight=false;last=[];render({active:false,orders:[]});}
  async function poll(){
   if(!account||inflight)return;const current=generation;inflight=true;if(timer!==null)cancel(timer);timer=null;
   try{
    let page=1,pages=1;const collected=new Map();
    do{const out=await read({status:'PAID',page,pageSize:50});if(current!==generation)return;
     if(!Array.isArray(out.items)||!Number.isInteger(out.pages)||out.pages<1||out.pages>100)throw Error('INVALID_ALERT_RESPONSE');
     pages=out.pages;for(const o of out.items)if(!handled.has(o.id)&&o.status==='PAID'&&!(['DINE_IN','PICKUP'].includes(o.fulfillment?.type)&&o.fulfillment.readyAt))collected.set(o.id,o);
     page++;
    }while(page<=pages);
    const orders=[...collected.values()].filter(o=>!handled.has(o.id));for(const id of stored())seen.add(id);
    const fresh=orders.filter(o=>!seen.has(o.id));for(const o of orders)seen.add(o.id);
    seen=new Set([...seen].slice(-5000));try{storage.setItem(key(),JSON.stringify([...seen]));}catch{}
    last=orders;render({active:true,orders,error:false});
    if(fresh.length)notify(fresh,{initial});initial=false;
   }catch(e){if(current===generation){if(e.status===401){stop();expired();}else render({active:true,orders:last,error:true});}}
   finally{if(current===generation){inflight=false;if(account)timer=schedule(poll,hidden()?60000:20000);}}
  }
  function start(id){stop();handled.clear();account=String(id);seen=new Set(stored());initial=true;render({active:true,orders:[]});void poll();}
  return {start,stop,poll,handled(id){handled.add(id);last=last.filter(o=>o.id!==id);if(account)render({active:true,orders:last,error:false});}};
 }
 function browser(win){
  const doc=win.document,$=id=>doc.getElementById(id);let service=null,actions=null,audio=null,sound=false,latest=[],orders=[],baseTitle=doc.title,active=false,hideTimer=null;
  const label=o=>o.fulfillment?.type==='DINE_IN'?'堂食':o.fulfillment?.type==='PICKUP'?'到店自提':'快递配送';
  function render(state){active=state.active;orders=state.orders;$('order-alert-bar').hidden=!active;if(!active){$('order-alert-toast').hidden=true;doc.title=baseTitle;latest=[];return;}
   $('order-alert-count').textContent='待备货 '+orders.length+' 单';
   $('order-alert-status').textContent=state.error?'提醒连接中断，正在重试；请手动核对订单':'来单提醒已开启';
   $('order-alert-status').className=state.error?'alert-offline':'';
   doc.title=orders.length?'（'+orders.length+'单待处理）'+baseTitle:baseTitle;
   const ids=new Set(orders.map(o=>o.id));latest=latest.filter(o=>ids.has(o.id));if(!latest.length)dismiss();else updateNotice();
  }
  async function chime(){if(!sound||!audio)return;try{await audio.resume();if(audio.state!=='running')throw Error('AUDIO_BLOCKED');const start=audio.currentTime;
   for(const [offset,freq] of [[0,784],[0.2,1047]]){const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.connect(gain);gain.connect(audio.destination);oscillator.frequency.value=freq;gain.gain.setValueAtTime(0,start+offset);gain.gain.linearRampToValueAtTime(0.12,start+offset+0.02);gain.gain.exponentialRampToValueAtTime(0.001,start+offset+0.18);oscillator.start(start+offset);oscillator.stop(start+offset+0.2);}
  }catch{sound=false;$('order-alert-sound').textContent='点击开启提示音';}}
  function updateNotice(){const fresh=latest;
   $('order-alert-title').textContent='有 '+fresh.length+' 笔付款订单待备货';
   const pickup=fresh.filter(o=>o.fulfillment?.type==='PICKUP').length,dine=fresh.filter(o=>o.fulfillment?.type==='DINE_IN').length;
   $('order-alert-detail').textContent=(dine?'堂食 '+dine+' 单 · ':'')+'自提 '+pickup+' 单 · 快递 '+(fresh.length-pickup-dine)+' 单'+(fresh.some(o=>o.payment?.provider==='MOCK')?'（包含未扣款测试单）':'');
   $('order-alert-open').textContent=fresh.length===1?'查看'+label(fresh[0])+'订单':'查看待处理订单';
  }
  function dismiss(){if(hideTimer!==null)win.clearTimeout(hideTimer);hideTimer=null;$('order-alert-toast').hidden=true;}
  function notify(fresh){latest=[...new Map([...latest,...fresh].map(o=>[o.id,o])).values()];updateNotice();dismiss();$('order-alert-toast').hidden=false;hideTimer=win.setTimeout(()=>{if(!$('order-alert-toast').contains(doc.activeElement))dismiss();},8000);void chime();actions.arrived?.();}
  function start(me,callbacks){if(service)service.stop();actions=callbacks;
   service=create({read:async input=>{const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);try{const r=await win.fetch('/api',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'merchantOrdersPage',input}),signal:controller.signal});if(r.status===401)throw Object.assign(Error('AUTH_REQUIRED'),{status:401});const out=await r.json();if(!r.ok||!out.ok)throw Error('ALERT_UNAVAILABLE');return out.data;}finally{clearTimeout(timeout);}},expired:callbacks.expired,render,notify,storage:{getItem:k=>win.localStorage.getItem(k),setItem:(k,v)=>win.localStorage.setItem(k,v)},hidden:()=>doc.hidden});service.start(me.id||me.username);
  }
  function stop(){dismiss();service?.stop();sound=false;$('order-alert-sound').textContent='开启提示音';}
  async function open(){if(!active)return;const target=latest.length===1?latest[0].id:null;try{const opened=await actions.open(target);if(opened!==false)$('order-alert-toast').hidden=true;}catch{ $('order-alert-detail').textContent='订单暂时无法打开，请稍后重试';}}
  async function enableSound(){if(sound){sound=false;$('order-alert-sound').textContent='开启提示音';return;}
   try{const Audio=win.AudioContext||win.webkitAudioContext;if(!Audio)throw Error('UNSUPPORTED');audio ||= new Audio();await audio.resume();if(audio.state!=='running')throw Error('BLOCKED');sound=true;$('order-alert-sound').textContent='提示音已开 · 关闭';await chime();}catch{$('order-alert-sound').textContent='声音未启用，请再次点击';}}
  doc.addEventListener('visibilitychange',()=>{if(!doc.hidden&&active)void service?.poll();});win.addEventListener('online',()=>{if(active)void service?.poll();});
  return {start,stop,open,enableSound,dismiss,handled:id=>service?.handled(id),list:async()=>{if(active)await actions.open(null);}};
 }
 return {create,browser};
});
