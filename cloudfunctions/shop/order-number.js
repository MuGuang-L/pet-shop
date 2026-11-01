'use strict';
function day(at){return new Date(at+8*3600000).toISOString().slice(0,10).replaceAll('-','');}
function display(o){return o.orderNo||(/^o\d+$/.test(o.id)?'A'+o.id.slice(1).padStart(3,'0'):o.id);}
function present(value){if(Array.isArray(value))return value.map(present);if(value&&typeof value==='object'){if(value.userId&&Array.isArray(value.lines)&&Number.isFinite(value.createdAt))return {...value,orderNo:display(value),orderDate:day(value.createdAt)};return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,present(v)]));}return value;}
function allocate(s,now,legacyBase=0){const date=day(now);s.orderCounters||={};const base=s.orderCounters[date]??Math.max(legacyBase,...s.orders.filter(o=>day(o.createdAt)===date).map(o=>Number(display(o).replace(/^A/,''))||0),0);const n=base+1;s.orderCounters[date]=n;return 'A'+String(n).padStart(3,'0');}
function bounds(date){if(!/^\d{8}$/.test(date))return null;const start=Date.UTC(+date.slice(0,4),+date.slice(4,6)-1,+date.slice(6,8))-8*3600000;if(day(start)!==date)return null;return {start,end:start+86400000};}
function legacyQuery(number){return /^a\d{3,}$/i.test(number)?{id:'o'+Number(number.slice(1))}:null;}
module.exports={day,display,present,allocate,bounds,legacyQuery};
