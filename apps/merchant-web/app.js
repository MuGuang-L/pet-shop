const studio=Studio,role='merchant';let tab='orders',storefront={...studio.defaults},homeContent={...studio.homeDefaults},storeDraft=null,orderSearch='',orderStatus='ALL',orderPageNumber=1,fulfillmentFilter='ALL',currentOrder=null,editing=null,adminProducts=[];
let viewRevision=0,productQuery='',productCategory='ALL',productState='ALL',productSort='default',savingProduct=false;
let savingOrder=false,inventoryAvailable=false,fulfillmentAvailable=false;
let paymentMode='unknown';
let orderQueue='todo',modalDirty=false,modalKind='',pendingUploads=0,skuSequence=0,originalSkuIds=new Set(),discardAction=null;
const $=id=>document.getElementById(id),money=n=>(n/100).toFixed(2),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const states={PENDING:'待付款',PAID:'待履约',SHIPPED:'待收货',COMPLETED:'已完成',CANCELLED:'已取消',EXPIRED:'已超时',REFUND_REQUESTED:'售后申请中',REFUNDING:'退款处理中',REFUNDED:'已退款'};
const art=p=>p.image||'/assets/'+(['food','toy','care'].includes(p.id||p.productId)?(p.id||p.productId)+'-v2':'empty-v2')+'.jpg';
const homeFields=[['headline','首页大标题',24],['subtitle','首页副标题',40],['featuredTitle','精选栏目标题',18],['featuredIntro','精选栏目说明',60],['newTitle','上新栏目标题',18]];

// Only repeat reads. An interrupted write may already have committed.
const readActions=new Set(['stockHistory','catalog','storefront','homeContent','identity','merchantProducts','merchantOrders','merchantOrdersPage','order','tracking','shopSettings','quoteOrder']);
const requestMessages={STOCK_REQUEST_CONFLICT:'该提交编号已用于另一笔调整，请核对记录后再操作。',INVALID_STOCK_TYPE:'请选择入库、盘点或报损。',INVALID_STOCK_QUANTITY:'数量须为有效整数；盘点可填 0，入库和报损须大于 0。',STOCK_REASON_REQUIRED:'请填写调整原因，最多 200 字。',INSUFFICIENT_AVAILABLE_STOCK:'报损数量超过可售库存，请核对已被订单占用的商品。',STOCK_CAPACITY_EXCEEDED:'可售库存加订单预留数量不能超过 100000 件。',CREATE_REQUEST_CONFLICT:'上次新增可能已保存。请先关闭编辑并刷新商品列表核对，不要改动原请求重复新增。',AUTH_REQUIRED:'请先登录',FORBIDDEN:'此账号没有商家权限',INVALID_CREDENTIALS:'账号或密码不正确',LOGIN_RATE_LIMIT:'登录尝试过多，请一分钟后再试',LOGIN_BUSY:'当前登录人数较多，请稍后再试',PRODUCT_REVISION_CONFLICT:'商品或库存已变化，本次未保存。请保留需要的编辑内容，重新打开商品后核对库存再保存。',PRODUCT_NAME:'请填写商品名称（最多 80 字）',INVALID_STOCK:'库存须为 0 到 100000 的整数',SKU_NAME:'请填写每个规格的名称',INVALID_PRICE:'请检查售价，金额须大于 0 且最多两位小数',RESERVED_SKU_CANNOT_REMOVE:'该规格仍有未结束订单，请保留原规格',INVALID_STATE:'订单状态已变化，请刷新后重试'};
async function requestOnce(url,body){
  const controller=new AbortController();let timer;
  try{
    const result=await Promise.race([
      fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body,signal:controller.signal}).then(async r=>({status:r.status,out:await r.json()})),
      new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('REQUEST_TIMEOUT'));controller.abort();},15000);})
    ]);
    if(url==='/auth/login'&&[400,429,503].includes(result.status)&&['INVALID_CREDENTIALS','LOGIN_RATE_LIMIT','LOGIN_BUSY'].includes(result.out?.error))throw Object.assign(Error(requestMessages[result.out.error]),{business:true,code:result.out.error});
    if(result.status===401){loginScreen();throw Object.assign(Error('请先登录'),{business:true});}
    if([408,429,500,502,503,504].includes(result.status))throw Error('TEMPORARILY_UNAVAILABLE');
    const out=result.out;
    if(!out||typeof out.ok!=='boolean')throw Error('INVALID_RESPONSE');
    if(result.status!==200||!out.ok)throw Object.assign(Error(requestMessages[out.error]||out.error||'操作未完成'),{business:true,code:out.error});
    if(!(url==='/upload'?'path' in out:'data' in out))throw Error('INVALID_RESPONSE');
    return url==='/upload'?out.path:out.data;
  }catch(e){if(e.business)throw e;throw Object.assign(Error('网络或服务暂时不可用'),{retryable:true});}
  finally{clearTimeout(timer);}
}
async function request(url,input={}){
  const canRetry=url==='/auth/me'||url==='/api'&&readActions.has(input.action),body=JSON.stringify(input);
  for(let attempt=0;attempt<2;attempt++)try{return await requestOnce(url,body);}catch(e){
    if(e.retryable&&canRetry&&attempt===0){await new Promise(r=>setTimeout(r,300));continue;}
    if(e.retryable)e.message=url==='/auth/login'?'登录请求未得到确认，请检查网络后重试。':canRetry?'网络或服务暂时不可用，请稍后重新加载。':'未收到确认结果，请先核对是否已保存或订单状态是否已更新，勿连续重复提交。';
    throw e;
  }
}
async function api(action,input={}){return request('/api',{action,input});}
function loginScreen(){viewRevision++;modalDirty=false;modalKind='';discardAction=null;$('discard-dialog').close();$('workspace').hidden=true;$('login').hidden=false;$('modal').close();}
async function login(e){e.preventDefault();const button=$('login-button');button.disabled=true;try{const out=await request('/auth/login',{username:$('username').value,password:$('password').value});if(!out.identity.merchant){await request('/auth/logout');throw Error('请使用商家账号登录；买家账号用于小程序。');}$('password').value='';await boot();}catch(e){$('login-error').textContent=e.message;}finally{button.disabled=false;}}
async function logout(){if($('modal').open&&!closeModal())return;await request('/auth/logout');loginScreen();}
async function refreshPaymentMode(){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5000);
 paymentMode='unknown';
 try{const response=await fetch('/health',{credentials:'same-origin',cache:'no-store',signal:controller.signal});const health=await response.json();if(response.status===200&&health.ok===true){if(health.mode==='wechat'&&health.wechatPay===true)paymentMode='wechat';else if(health.mode==='simulation'&&health.wechatPay===false)paymentMode='simulation';}}catch{}finally{clearTimeout(timer);}
 const copy=paymentMode==='wechat'?['微信支付已配置','真实付款订单的退款会涉及资金；支付授权仍需实单验证。']:paymentMode==='simulation'?['模拟经营','当前未配置微信支付。仅模拟支付订单可完成模拟退款。']:['支付状态待核实','暂时无法核对支付配置，请勿将当前环境视为模拟环境。'];
 $('payment-mode-title').textContent=copy[0];$('payment-mode-note').textContent=copy[1];$('payment-login-note').textContent=copy.join(' · ');$('simulation-login-notes').innerHTML=simulationNotesHtml();
}
async function boot(){await refreshPaymentMode();try{const me=await request('/auth/me');if(!me.merchant)return loginScreen();const features=await api('identity');inventoryAvailable=features.capabilities?.includes('inventory-v1')===true;fulfillmentAvailable=features.capabilities?.includes('fulfillment-issues-v1')===true;$('login').hidden=true;$('workspace').hidden=false;$('operator').textContent=me.username;await show();}catch(e){loginScreen();}}

async function show(next=tab){
  tab=next;const revision=++viewRevision;
  $('error').style.display='none';$('notice').hidden=true;
  document.querySelectorAll('[data-section]').forEach(n=>{n.classList.toggle('active',n.dataset.section===tab);n.setAttribute('aria-current',n.dataset.section===tab?'page':'false');});
  const titles={settings:['经营设置','设置门店信息、营业时间、自提与外送。'],orders:['订单','处理备货、自提、外送及售后。'],products:['商品','管理商品信息、规格与可售库存。'],store:['店铺页面','管理小程序首页图片与内容。']};
  $('section-title').textContent=titles[tab][0];$('section-note').textContent=titles[tab][1];
  $('app').setAttribute('aria-busy','true');
  $('app').innerHTML='<div class="loading-state" role="status"><span class="loading-dot"></span>正在读取店铺数据…</div>';
  try{
    const [visuals,content,data,orders]=await Promise.all([
      tab==='store'?api('storefront'):Promise.resolve(storefront),
      tab==='store'?api('homeContent'):Promise.resolve(homeContent),
      tab==='orders'&&orderQueue==='all'?api('merchantOrdersPage',{q:orderSearch,status:orderStatus,page:orderPageNumber,fulfillment:fulfillmentFilter}):tab==='products'?api('merchantProducts'):tab==='settings'?api('shopSettings'):Promise.resolve(null),
      tab==='orders'?api('merchantOrders'):Promise.resolve([])
    ]);
    if(revision!==viewRevision)return;
    storefront=visuals;homeContent=content;
    if(tab==='orders')$('app').innerHTML=orderTasks(orders)+orderPageHtml(orderQueue==='all'?data:taskOrderPage(orders,orderQueue,{q:orderSearch,status:orderStatus,page:orderPageNumber,fulfillment:fulfillmentFilter}));
    if(tab==='products'){adminProducts=data;$('app').innerHTML=productsPage();renderProductResults();}
    if(tab==='store')$('app').innerHTML=storePage();
    if(tab==='settings')$('app').innerHTML=settingsPage(data);
  }catch(e){if(revision!==viewRevision)return;error(e);$('app').innerHTML='<div class="empty-state"><span class="service-icon">'+lineIcon('box')+'</span><h3>暂时没能读取数据</h3><p>请检查网络连接后重试，未提交的经营数据不会被修改。</p><button onclick="show()">重新加载</button></div>';}
  finally{if(revision===viewRevision)$('app').setAttribute('aria-busy','false');}
}

const queueNames={todo:'待处理',all:'全部订单',prepare:'自提待备货',pickup:'待自提',delivery:'待外送',aftersale:'售后待处理',issue:'履约问题'};
function orderTask(o){
  if(o.fulfillment?.issue?.status==='OPEN'&&['PAID','SHIPPED'].includes(o.status))return 'issue';
  if(o.status==='PAID')return o.fulfillment?.type==='PICKUP'?(o.fulfillment.readyAt?'pickup':'prepare'):'delivery';
  if(['REFUND_REQUESTED','REFUNDING'].includes(o.status)&&['REQUESTED','RETURN_TRANSIT','WAIT_REFUND','REFUND_FAILED'].includes(o.refund?.stage))return 'aftersale';
  return null;
}
function taskOrderPage(orders,queue,input={}){
  const q=String(input.q||'').trim().toLowerCase();
  const items=orders.filter(o=>(queue==='todo'?!!orderTask(o):orderTask(o)===queue)&&(!q||[o.id,...o.lines.map(l=>l.name)].some(v=>v.toLowerCase().includes(q)))&&(!input.fulfillment||input.fulfillment==='ALL'||(o.fulfillment?.type||'DELIVERY')===input.fulfillment)&&(!input.status||input.status==='ALL'||(input.status==='AFTERSALE'?o.status.startsWith('REFUND'):o.status===input.status)))
    .sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
  const pages=Math.max(1,Math.ceil(items.length/10)),page=Math.min(pages,Math.max(1,Number(input.page)||1));
  return {items:items.slice((page-1)*10,page*10),total:items.length,page,pages};
}
function orderTasks(orders){
  const counts={prepare:0,pickup:0,delivery:0,aftersale:0};if(fulfillmentAvailable||orders.some(o=>orderTask(o)==='issue'))counts.issue=0;
  for(const o of orders){const key=orderTask(o);if(key)counts[key]++;}
  return `<div class="task-heading"><h2>当前待办</h2><span>全店数量 · 点击查看订单</span></div><div class="order-tasks ${'issue' in counts?'has-issues':''}">${Object.entries(counts).map(([key,count])=>`<button aria-pressed="${orderQueue===key}" onclick="selectOrderQueue('${key}')"><span>${queueNames[key]}</span><strong>${count}</strong><small>${{prepare:'核对商品并标记备好',pickup:'买家到店后凭码核销',delivery:'送出后登记单号或备注',aftersale:'审核、验收或处理退款',issue:'缺货、外送失败或自提延期'}[key]}</small></button>`).join('')}</div>`;
}
function selectOrderQueue(queue){orderQueue=queue;orderSearch='';orderStatus='ALL';fulfillmentFilter='ALL';orderPageNumber=1;return show('orders');}
function notifySaved(message){$('notice').textContent=message;$('notice').hidden=false;}
function metric(label,value,note,icon){return `<article><div class="metric-top"><small>${label}</small><span class="service-icon">${lineIcon(icon)}</span></div><strong>${value}</strong><p>${note}</p></article>`;}
function productFacts(p){const skus=p.skus||[];return {stock:skus.reduce((n,s)=>n+Number(s.stock||0),0),low:skus.some(s=>Number(s.stock)<=5),min:skus.length?Math.min(...skus.map(s=>s.price)):0,max:skus.length?Math.max(...skus.map(s=>s.price)):0};}
function filteredProducts(items,q='',category='ALL',state='ALL',sort='default'){
  const needle=q.trim().toLocaleLowerCase();
  const result=items.filter(p=>{const f=productFacts(p);return (!needle||[p.name,p.id,p.category,...(p.skus||[]).map(s=>s.name)].join(' ').toLocaleLowerCase().includes(needle))&&(category==='ALL'||p.category===category)&&(state==='ALL'||state==='active'&&p.active||state==='draft'&&!p.active||state==='low'&&p.active&&f.low);});
  return sort==='stock'?result.sort((a,b)=>productFacts(a).stock-productFacts(b).stock):sort==='price'?result.sort((a,b)=>productFacts(a).min-productFacts(b).min):result;
}
function productsPage(){return `<div class="admin-metrics product-metrics">${metric('全部商品',adminProducts.length,'包含上架商品与草稿','box')}${metric('上架中',adminProducts.filter(p=>p.active).length,'小程序侧可浏览','shop')}${metric('库存需关注',adminProducts.filter(p=>p.active&&productFacts(p).low).length,'含任一规格库存 ≤ 5 的商品','clock')}</div>
<section class="work-panel"><div class="panel-heading"><div><h2>商品列表</h2></div><button class="primary" onclick="editor()">＋ 新增商品</button></div>
<div class="product-toolbar"><label class="search-field"><span>搜索商品</span><input id="product-query" type="search" maxlength="80" placeholder="商品名称、编号或规格" value="${esc(productQuery)}" oninput="productQuery=this.value;renderProductResults()"></label><label>分类<select id="product-category" onchange="productCategory=this.value;renderProductResults()">${['ALL','主粮','零食','玩具','清洁','用品'].map(c=>`<option value="${c}" ${productCategory===c?'selected':''}>${c==='ALL'?'全部分类':c}</option>`).join('')}</select></label><label>排序<select id="product-sort" onchange="productSort=this.value;renderProductResults()"><option value="default" ${productSort==='default'?'selected':''}>默认顺序</option><option value="stock" ${productSort==='stock'?'selected':''}>库存从少到多</option><option value="price" ${productSort==='price'?'selected':''}>价格从低到高</option></select></label></div>
<div class="filter-row"><div class="filter-chips" aria-label="商品状态">${[['ALL','全部'],['active','上架中'],['draft','草稿'],['low','库存需关注']].map(([v,t])=>`<button data-product-state="${v}" aria-pressed="${productState===v}" onclick="productState='${v}';renderProductResults()">${t}</button>`).join('')}</div><span id="product-count" class="muted" role="status"></span></div><div id="product-results"></div></section>
<p class="workspace-footnote">先保存草稿，再检查图片与规格。上架后的修改会同步到小程序侧。</p>`;}
function renderProductResults(){
  const items=filteredProducts(adminProducts,productQuery,productCategory,productState,productSort);
  document.querySelectorAll('[data-product-state]').forEach(n=>n.setAttribute('aria-pressed',String(n.dataset.productState===productState)));
  $('product-count').textContent=`${items.length} / ${adminProducts.length} 件商品`;
  $('product-results').innerHTML=items.length?`<div class="table-scroll"><table class="product-table"><thead><tr><th scope="col">商品 / 规格</th><th scope="col">售价</th><th scope="col">可售库存</th><th scope="col">状态</th><th scope="col" class="align-right">操作</th></tr></thead><tbody>${items.map(p=>{const f=productFacts(p);return `<tr><td><div class="product-identity"><img src="${esc(art(p))}" alt="" loading="lazy"><div><strong>${esc(p.name)}</strong><p>${esc(p.category)} · ${esc(studio.petOf(p))}</p><small>${p.skus.length} 个规格 · ${p.skus.map(s=>esc(s.name)).join(' / ')}</small></div></div></td><td class="price-cell">¥${money(f.min)}${f.max!==f.min?'<small>起</small>':''}</td><td><strong class="${f.low?'stock-warning':''}">${f.stock}</strong><small class="cell-note">${f.stock===0?'暂无可售库存':f.low?'部分规格 ≤ 5 件':'库存充足'}</small></td><td><span class="badge ${p.active?'success':'neutral'}">${p.active?'上架中':'草稿'}</span></td><td><div class="table-actions"><button data-id="${esc(p.id)}" onclick="editor(this.dataset.id)">编辑</button><button data-id="${esc(p.id)}" onclick="stockEditor(this.dataset.id)" ${inventoryAvailable?'':'disabled title="库存登记等待服务更新"'}>库存</button><button class="text-button" data-id="${esc(p.id)}" onclick="duplicateProduct(this.dataset.id)">复制</button></div></td></tr>`;}).join('')}</tbody></table></div>`:'<div class="empty-state"><span class="service-icon">'+lineIcon('box')+'</span><h3>没有符合条件的商品</h3><p>换一个关键词，或清除筛选查看全部商品。</p><button onclick="resetProducts()">清除筛选</button><button class="primary" onclick="editor()">新增商品</button></div>';
}
function resetProducts(){productQuery='';productCategory='ALL';productState='ALL';productSort='default';$('app').innerHTML=productsPage();renderProductResults();}
function storePage(){return `<div class="store-preview"><div class="store-preview-copy"><h2>首页预览</h2><p>展示当前保存的主图与标题。<br>修改后需点击保存才会生效。</p><span class="badge neutral">当前已保存的内容</span></div><div class="shop-preview-card"><img src="${esc(storefront.hero)}" alt="当前首页主视觉"><div><small>爪爪小铺</small><h3>${esc(homeContent.headline).replace(/\n/g,'<br>')}</h3><p>${esc(homeContent.subtitle)}</p></div></div></div>
<div class="store-options"><article class="work-panel store-option"><div class="option-top"><span class="service-icon">${lineIcon('shop')}</span><span class="muted">图片素材</span></div><h2>店铺图片</h2><p>首页主视觉、分类与个人中心图片。上传实拍，也可以从备选图库开始。</p><div class="store-thumbnails">${['cat','dog','care','toy'].map(k=>`<img src="${esc(storefront[k])}" alt="" loading="lazy">`).join('')}</div><button onclick="storeEditor()">管理店铺图片 <span aria-hidden="true">↗</span></button></article><article class="work-panel store-option"><div class="option-top"><span class="service-icon">${lineIcon('heart')}</span><span class="muted">页面文案</span></div><h2>首页内容</h2><p>编辑首页标题、精选栏目、场景说明和分类跳转。</p><div class="editorial-sample"><small>当前精选栏目</small><strong>${esc(homeContent.featuredTitle)}</strong><p>${esc(homeContent.featuredIntro)}</p></div><button onclick="homeEditor()">编辑首页内容 <span aria-hidden="true">↗</span></button></article></div><p class="workspace-footnote">修改在点击保存后生效，小程序侧下次读取时即可看到更新。</p>`;}

function error(e){$('error').textContent=e.message||String(e);$('error').style.display='block';if($('modal').open){let node=$('modal').querySelector('.modal-error');if(!node){node=document.createElement('p');node.className='modal-error';($('modal').querySelector('.editor-footer')||$('modal')).appendChild(node);}node.textContent=e.message;node.style.cssText='padding:16px;color:#944b32';}}
window.addEventListener('unhandledrejection',e=>{e.preventDefault();error(e.reason)});
window.addEventListener('error',e=>{if(e.error){e.preventDefault();error(e.error);}});
function modal(html,detail=false,kind='order'){modalKind=kind;modalDirty=false;$('modal').innerHTML='<button class="modal-close" aria-label="关闭弹层" onclick="closeModal()">×</button>'+(detail?html:'<div class="modal-content">'+html+'</div>');if(!$('modal').open)$('modal').showModal();$('modal').scrollTop=0;}
function askDiscard(action){const uncertain=modalKind==='inventory'&&stockDraft?.pending||modalKind==='order'&&fulfillmentAvailable&&currentOrder&&readIssuePending(currentOrder.id);$('discard-title').textContent=uncertain?'关闭待确认的操作？':'放弃未保存的修改？';$('discard-description').textContent=uncertain?'上次请求可能已经保存。关闭后仍保留原提交记录，请重新打开后核对，不要重复登记。':'这次编辑的内容尚未保存。继续编辑可以保留当前填写的内容。';$('discard-confirm').textContent=uncertain?'关闭，稍后核对':'放弃修改';$('discard-cancel').textContent=uncertain?'继续核对':'继续编辑';discardAction=action;$('discard-dialog').showModal();}
function resolveDiscard(allow){const action=discardAction;discardAction=null;$('discard-dialog').close();if(allow&&action)action();}
$('discard-dialog').addEventListener('cancel',e=>{e.preventDefault();resolveDiscard(false);});
function markDirty(){modalDirty=true;const note=$('draft-state');if(note)note.textContent='有未保存的修改';}
function closeModal(force=false){
  if(!force&&(savingProduct||savingOrder)){error(Error('正在保存，请稍候。'));return false;}
  if(!force&&(modalDirty||pendingUploads)){askDiscard(()=>closeModal(true));return false;}
  modalDirty=false;modalKind='';$('modal').close();return true;
}
window.addEventListener('input',e=>{if($('modal').open&&e.target.closest?.('#modal')&&e.target.type!=='file')markDirty();});
window.addEventListener('change',e=>{if($('modal').open&&e.target.closest?.('#modal')&&e.target.type!=='file')markDirty();});
window.addEventListener('beforeunload',e=>{if(modalDirty||savingProduct||savingOrder||pendingUploads){e.preventDefault();e.returnValue='';}});
$('modal').addEventListener('cancel',e=>{e.preventDefault();closeModal();});


function resetOrders(){return selectOrderQueue('all');}
function orderPageHtml(p){orderPageNumber=p.page;return `<section class="work-panel"><div class="panel-heading"><div><h2>${queueNames[orderQueue]}</h2></div><button onclick="show('orders')">↻ 刷新订单</button></div><div class="order-filter-tabs"><div class="order-scope"><button aria-pressed="${orderQueue!=='all'}" onclick="selectOrderQueue('todo')">待处理</button><button aria-pressed="${orderQueue==='all'}" onclick="selectOrderQueue('all')">全部订单</button><small>${orderQueue==='all'?'按下单时间从新到旧排列':'待办按下单时间从早到晚排列'}</small></div><div class="mode-tabs order-modes" aria-label="履约方式">${[['ALL','不限方式'],['PICKUP','到店自提'],['DELIVERY','商家外送']].map(([v,t])=>`<button class="${fulfillmentFilter===v?'selected':''}" aria-pressed="${fulfillmentFilter===v}" onclick="fulfillmentFilter='${v}';orderPageNumber=1;show('orders')">${v==='ALL'?'':lineIcon(v==='PICKUP'?'shop':'truck')}${t}</button>`).join('')}</div></div><form class="order-search" onsubmit="event.preventDefault();orderSearch=$('order-query').value.trim();orderStatus=$('order-status').value;orderPageNumber=1;show('orders')"><label>订单号或商品名称<input id="order-query" type="search" maxlength="80" value="${esc(orderSearch)}" placeholder="搜索订单号或商品名称"></label><label>订单状态<select id="order-status">${Object.entries({ALL:'全部状态',...states,AFTERSALE:'全部售后'}).map(([k,v])=>`<option value="${k}" ${orderStatus===k?'selected':''}>${v}</option>`).join('')}</select></label><button class="primary">查询订单</button><button type="button" class="text-button" onclick="resetOrders()">重置</button></form><div class="list-summary"><span>共 <b>${p.total}</b> 单</span><span>${orderQueue==='all'?'包含已结束订单':'仅显示需要商家处理的订单'}</span></div>${p.items.length?renderOrders(p.items):'<div class="empty-state"><span class="service-icon">'+lineIcon('box')+'</span><h3>暂时没有符合条件的订单</h3><p>试试其他状态或关键词，新的订单会显示在这里。</p><button onclick="resetOrders()">查看全部订单</button></div>'}<div class="pagination"><span>第 ${p.page} / ${p.pages} 页</span><div><button ${p.page<=1?'disabled':''} onclick="orderPageNumber--;show('orders')">上一页</button><button ${p.page>=p.pages?'disabled':''} onclick="orderPageNumber++;show('orders')">下一页</button></div></div></section>`;}
function orderFulfillmentNote(o){if(o.fulfillment?.issue?.status==='OPEN'&&['PAID','SHIPPED'].includes(o.status))return o.fulfillment.issue.note;
  if(o.status==='REFUNDED')return '退款完成，履约已结束';
  if(['CANCELLED','EXPIRED'].includes(o.status))return '订单已关闭，无需履约';
  if(o.fulfillment?.type==='PICKUP'){
    if(o.status==='COMPLETED')return '已完成到店自提';
    if(o.status==='PAID')return o.fulfillment.readyAt?'已备好，等待到店核销':'备货完成后通知到店自提';
    return '到店自提订单';
  }
  if(o.status==='COMPLETED')return '已完成配送';
  return o.shipping?'已登记外送信息':'由商家安排配送';
}
function renderOrders(os){return `<div class="orders-list">${os.map(o=>{const pickup=o.fulfillment?.type==='PICKUP';const label=o.status.startsWith('REFUND')&&o.refund?.stage?refundStageLabel(o):(studio.fulfillmentLabel(o)||states[o.status]);return `<article class="order-card"><div class="order-card-top"><span class="fulfillment-tag">${lineIcon(pickup?'shop':'truck')}${pickup?'到店自提':'商家外送'}</span><span class="order-id">${esc(o.id)}</span><time>${esc(new Date(o.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}))}</time><span class="badge ${o.status==='PAID'?'warm':o.status.startsWith('REFUND')?'neutral':'success'}">${esc(label||o.status)}</span></div><div class="order-card-body"><div class="product-identity"><img src="${esc(art(o.lines[0]))}" alt="" loading="lazy"><div><h3>${esc(o.lines[0].name)}${o.lines.length>1?` 等 ${o.lines.length} 种商品`:''}</h3><p>${esc(o.lines[0].spec)} · 共 ${o.lines.reduce((s,l)=>s+l.qty,0)} 件</p><small>${esc(orderFulfillmentNote(o))}</small></div></div><div class="order-amount"><small>订单合计</small><strong>¥${money(o.total)}</strong><small>${pickup?'自提免配送费':'含外送费 ¥'+money(o.shippingFee||0)}</small></div><button class="${o.status==='PAID'?'primary':''}" data-id="${esc(o.id)}" onclick="viewOrder(this.dataset.id)">${orderTask(o)==='issue'?'处理履约问题':o.status==='PAID'?(pickup?(o.fulfillment.readyAt?'提货核销':'处理备货'):'安排外送'):o.status==='REFUND_REQUESTED'?'处理售后':'查看详情'} <span aria-hidden="true">↗</span></button></div></article>`;}).join('')}</div>`;}

function returnAddressFields(o){const mock=o.payment?.provider==='MOCK';return '<p class="field-caption">'+(mock?'下面是模拟退货地址，请勿实际寄件。':'请填写可实际接收退货的联系人与地址。')+'批准时保存地址快照。</p><label>退货收件人<input id="return-name" maxlength="40" value="'+(mock?'模拟退货收件人':'')+'"></label><label>退货联系电话<input id="return-phone" maxlength="11" value="'+(mock?'13800000000':'')+'"></label><label>退货地址<input id="return-address" maxlength="200" value="'+(mock?'模拟省模拟市测试仓库 1 号（请勿实际寄件）':'')+'"></label>';}
function refundStageLabel(o){return o.payment?.provider==='WECHAT'?({WAIT_REFUND:'待微信退款',REFUND_FAILED:'微信退款待重试'}[o.refund?.stage]||studio.afterStages[o.refund?.stage]):studio.afterStages[o.refund?.stage];}
function renderAftersales(o){const r=o.refund;let html='';
if(role==='buyer'&&['PAID','SHIPPED','COMPLETED'].includes(o.status))html+=`<section class="panel"><h3>申请售后</h3><p class="field-caption">模拟版按整单退款 ¥${money(o.total)}（含原运费）；退货运费需双方协商。</p><label>售后类型<select id="after-type"><option value="REFUND_ONLY">仅退款（不退货）</option>${o.status!=='PAID'?'<option value="RETURN_REFUND" selected>退货退款</option>':''}</select></label><label>申请原因<textarea id="after-reason" maxlength="300" placeholder="请说明遇到的问题和希望如何处理"></textarea></label><button class="primary" onclick="submitAftersale()">提交售后申请</button></section>`;
if(!r)return html;
html+=`<section class="panel after-summary"><span class="muted">售后记录</span><h3>${refundStageLabel(o)||r.status}</h3><p>售后单 ${esc(r.caseId)} · ${r.type==='RETURN_REFUND'?'退货退款':'仅退款'}</p><p>申请金额 ¥${money(r.amount)} · 整单退款</p><p>申请原因：${esc(r.reason)}</p>${r.review?`<p>审核意见：${esc(r.review.note)}</p>`:''}${r.returnAddress?`<div class="return-address"><strong>本次退货地址</strong><p>${esc(r.returnAddress.name)} · ${esc(r.returnAddress.phone)}</p><p>${esc(r.returnAddress.detail)}</p></div>`:''}${r.returnShipping?`<p>退货物流：${esc(r.returnShipping.company)} / ${esc(r.returnShipping.number)}</p>`:''}${r.inspection?`<h4>退货验收记录</h4>${r.inspection.items.map(i=>`<p>${esc(i.name)} · ${esc(i.spec)}<br>实收 ${i.receivedQty} / 可售入库 ${i.restockQty} / 隔离 ${i.quarantineQty} / 未收到 ${i.missingQty}</p>`).join('')}<p>验收说明：${esc(r.inspection.note)}</p><small>入库已记账；重复提交不会再次增加库存。</small>`:''}${r.stockDisposition?`<h4>取消履约的商品处理</h4>${r.stockDisposition.map(i=>`<p>${esc(i.name)} · ${esc(i.spec)}：在店或取回 ${i.receivedQty}，可售 ${i.restockQty}，隔离 ${i.quarantineQty}，缺失 ${i.missingQty}</p>`).join('')}<small>${r.stockDispositionApplied?(r.stockDisposition.some(i=>i.restockQty>0)?'退款已完成，可售数量已入库':'退款已完成，无可售数量回补'):'数量已锁定，退款成功时记账；不会重复释放整单库存'}</small>`:''}${r.failureReason?`<p>上次退款失败：${esc(r.failureReason)}</p>`:''}</section>`;
if(role==='buyer'&&r.stage==='REQUESTED')html+='<button onclick="orderAction(\'refundWithdraw\')">撤回本次售后申请</button>';
if(role==='merchant'&&r.stage==='REQUESTED')html+=`<section class="panel"><h3>审核售后</h3><label>审核意见<textarea id="after-review-note" maxlength="300" placeholder="批准或拒绝都请说明原因"></textarea></label>${r.type==='RETURN_REFUND'?returnAddressFields(o):needsStockDisposition(o)?stockDispositionFields(o,'review-stock'):r.previous!=='PAID'?'<label class="switch-row">同意不退货直接退款，不回补库存<input id="waive-return" type="checkbox"></label>':''}<div class="actions"><button class="primary" onclick="reviewAftersale(true)">同意申请</button><button onclick="reviewAftersale(false)">拒绝并说明</button></div></section>`;
if(role==='buyer'&&r.stage==='WAIT_RETURN')html+='<section class="panel"><h3>填写退货物流</h3><label>退货快递公司<input id="return-company" maxlength="30" placeholder="模拟快递"></label><label>退货运单号<input id="return-number" maxlength="40" placeholder="例如 RETURN123456"></label><p class="field-caption">确认后运单将锁定，请核对后提交。</p><button class="primary" onclick="submitReturnShipping()">提交退货物流</button></section>';
if(role==='merchant'&&r.stage==='RETURN_TRANSIT')html+=`<section class="panel"><h3>验收退货并入库</h3><p class="field-caption">只填写实际收到和可再售的数量。隔离及未收到的部分不会加入库存。此次仍是整单退款 ¥${money(r.amount)}。</p>${o.lines.map((l,i)=>`<div class="receipt-line"><h4>${esc(l.name)} · ${esc(l.spec)}（购买 ${l.qty} 件）</h4><div class="two-fields"><label>实收数量<input id="received-${i}" type="number" min="0" max="${l.qty}" step="1" value="0"></label><label>可售入库数量<input id="restock-${i}" type="number" min="0" max="${l.qty}" step="1" value="0"></label></div></div>`).join('')}<label>验收说明<textarea id="inspection-note" maxlength="300" placeholder="商品状态、缺件或隔离原因"></textarea></label><label class="switch-row">我已核对实收、可售数量及整单退款金额<input id="inspection-confirm" type="checkbox"></label><button class="primary" onclick="inspectReturn()">确认验收并记账</button></section>`;
if(role==='merchant'&&['WAIT_REFUND','REFUND_FAILED'].includes(r.stage)){const real=o.payment?.provider==='WECHAT';html+=`<section class="panel"><h3>${real?'微信退款':'模拟退款'}</h3><p>本次退款 ¥${money(r.amount)}。${real?'将按原支付单提交微信退款，到账后订单变为已退款。':'不涉及真实资金。'}</p><button class="primary" onclick="orderAction('mockRefund')">${r.stage==='REFUND_FAILED'?(real?'重试微信退款':'重试模拟退款'):(real?'提交微信退款':'完成模拟退款')}</button>${real?'':`<details><summary>验证退款失败场景</summary><label>失败原因<input id="refund-failure" maxlength="300" placeholder="例如模拟网关暂时不可用"></label><button onclick="orderAction('refundFail',{reason:$('refund-failure').value})">模拟退款失败</button></details>`}</section>`;}
html+=`<section class="panel"><h3>本次处理记录</h3><div class="timeline">${(r.timeline||[]).map(e=>`<p><strong>${esc(e.actor)} · ${esc(e.label)}</strong><br><small>${esc(new Date(e.at).toLocaleString())}</small><br>${esc(e.detail)}</p>`).join('')||'<p>旧售后暂无明细记录</p>'}</div>${(o.refundHistory||[]).length?`<details><summary>历史售后 · ${o.refundHistory.length} 次</summary>${o.refundHistory.map(h=>`<p>${esc(h.caseId)} · ${esc(refundStageLabel({...o,refund:h})||h.status)}<br>${esc(h.reason)}<br>${esc(h.review?.note||'')}</p>`).join('')}</details>`:''}</section>`;return html;}
async function reviewAftersale(approve){const r=currentOrder.refund;const input={approve,note:$('after-review-note').value};if(approve&&r.type==='RETURN_REFUND')input.returnAddress={name:$('return-name').value,phone:$('return-phone').value,detail:$('return-address').value};if(approve&&needsStockDisposition(currentOrder)){input.items=readStockDisposition('review-stock');input.confirm=$('review-stock-confirm').checked;}else if(approve&&r.type==='REFUND_ONLY'&&r.previous!=='PAID')input.waiveReturn=$('waive-return').checked;await orderAction('refundReview',input);}
async function inspectReturn(){await orderAction('returnInspect',{note:$('inspection-note').value,confirm:$('inspection-confirm').checked,items:currentOrder.lines.map((l,i)=>({productId:l.productId,skuId:l.skuId,receivedQty:Number($('received-'+i).value),restockQty:Number($('restock-'+i).value)}))});}
async function viewOrder(id){const o=await api('order',{id});currentOrder=o;const issuePending=fulfillmentAvailable?readIssuePending(o.id):null;modal(`<span class="muted">订单详情</span><h2>${studio.fulfillmentLabel(o)||states[o.status]}</h2><p class="order-id">${esc(o.id)}</p><p class="field-caption">支付方式：${o.payment?.provider==='WECHAT'?'微信支付（真实资金）':o.payment?.provider==='MOCK'?'模拟支付（不涉及资金）':'尚无已付款记录'}</p>${o.lines.map(l=>`<div class="panel order-line"><img src="${esc(art(l))}" alt="商品样例示意图"><div><h3>${esc(l.name)}</h3><p class="muted">${esc(l.spec)} × ${l.qty}</p><b>¥${money(l.price*l.qty)}</b></div></div>`).join('')}${fulfillmentCard(o)}<div class="row"><span>订单合计</span><span class="price">¥${money(o.total)}</span></div><p class="field-caption">${o.fulfillment?.type==='PICKUP'?'自提免配送费':'商家外送费 ¥'+money(o.shippingFee)}${o.status==='PENDING'?' · 未付款订单 15 分钟自动关闭':''}</p><div class="actions">${false?'<button class="primary" onclick="orderAction(\'mockPay\')">模拟付款（不扣款）</button><button onclick="orderAction(\'cancel\')">取消订单</button>':''}${false?'<button onclick="orderAction(\'confirmReceipt\')">确认收货</button>':''}<button onclick="tracking()">查看履约记录</button></div><div id="tracking"></div>${renderFulfillmentIssue(o,issuePending)}${issuePending?'':merchantFulfillment(o)}${issuePending?'':renderAftersales(o)}`);}
async function orderAction(action,extra={}){
  if(savingOrder)return;const id=currentOrder.id,input={id,caseId:currentOrder.refund?.caseId,...extra};
  savingOrder=true;
  const controls=[...document.querySelectorAll('#modal button, #modal input, #modal textarea')].map(node=>({node,disabled:node.disabled}));
  controls.forEach(({node})=>node.disabled=true);
  try{await api(action,input);modalDirty=false;await show();await viewOrder(id);notifySaved('订单处理成功，状态已更新');}
  finally{savingOrder=false;controls.forEach(({node,disabled})=>node.disabled=disabled);}
}
async function tracking(){const t=await api('tracking',{id:currentOrder.id});$('tracking').innerHTML=`<div class="panel"><h3>${esc(t.company||'尚未发货')}</h3><p class="muted">${esc(t.number||'')}${t.note?' · '+esc(t.note):''}</p><p class="field-caption">${esc(t.notice)}</p><div class="timeline">${t.events.map(e=>`<p>${esc(e.text)}</p>`).join('')}</div></div>`;}
async function ship(){await orderAction('ship',{number:$('number').value,note:$('delivery-note').value});}
function editor(id,template){if(savingProduct)return;editing=id?JSON.parse(JSON.stringify(adminProducts.find(p=>p.id===id))):studio.create(template);if(!editing.id&&!editing.requestKey)editing.requestKey='product-'+Date.now()+'-'+Math.random().toString(36).slice(2);originalSkuIds=new Set(editing.skus.map(k=>k.id));renderEditor();}

function renderEditor(){modal(`<div class="editor-heading"><h2>${editing.id?'编辑商品':'新增商品'}</h2><p class="muted">${editing.id?esc(editing.name):'选择模板后填写商品信息，默认保存为草稿。'}</p></div>${editing.id?'':'<section class="template-section"><h3>从模板开始</h3><p class="field-caption">选择分类，自动带入说明提纲、图片和规格；也可以继续自由填写。</p><div class="template-grid">'+studio.templates.map(t=>`<button type="button" class="${editing.category===t.category?'chosen':''}" onclick="changeTemplate('${t.id}')"><strong>${t.name}</strong><small>${t.hint}</small></button>`).join('')+'</div></section>'}
<form onsubmit="saveProduct(event)" class="product-editor"><fieldset id="product-fields"><nav class="editor-jump" aria-label="编辑分区"><a href="#edit-info">商品信息</a><a href="#edit-images">图片</a><a href="#edit-skus">规格与库存</a></nav>
<section class="editor-section" id="edit-info"><div class="editor-section-title"><span>01</span><div><h3>商品信息</h3><p>商品名称、分类和详情说明。</p></div></div>
<label>商品名称<input id="pname" maxlength="80" value="${esc(editing.name)}" placeholder="例如：陶瓷防滑食碗" required></label>
<div class="two-fields"><label>商品分类<select id="category">${['主粮','零食','玩具','清洁','用品'].map(c=>`<option ${c===editing.category?'selected':''}>${c}</option>`).join('')}</select></label><label>适用宠物<select id="pet-scope">${studio.pets.map(v=>`<option ${studio.petOf(editing)===v?'selected':''}>${v}</option>`).join('')}</select></label></div>
<label class="switch-row">加入店主精选<input id="featured" type="checkbox" ${studio.featuredOf(editing)?'checked':''}></label><label>店主推荐语 <span class="optional">选填</span><input id="pick-note" maxlength="80" value="${esc(editing.pickNote)}" placeholder="说说这件好物适合怎样的日常"></label><label>商品说明<textarea id="description" rows="7" maxlength="2000" placeholder="材质、适用宠物、使用与保养方式…">${esc(editing.description)}</textarea></label></section>
<section class="editor-section" id="edit-images"><div class="editor-section-title"><span>02</span><div><h3>图片与封面</h3><p>支持实拍上传与备选图库，最多 6 张。</p></div></div>${imageControl('product',editing.image||art(editing))}<div id="product-gallery">${productGallery()}</div></section>
<section class="editor-section" id="edit-skus"><div class="editor-section-title"><span>03</span><div><h3>规格、价格与库存</h3><p>新规格可填写初始库存；已有规格从商品列表的「库存」入口调整。</p></div></div><div class="sku-table-head" aria-hidden="true"><span>规格名称</span><span>售价 / 元</span><span>可售库存</span><span></span></div><div id="sku-fields">${editing.skus.map((k,i)=>skuFields(k,i)).join('')}</div><div class="sku-batch"><label>统一售价<input id="batch-price" type="number" min="0.01" max="100000" step="0.01" placeholder="选填"></label><button type="button" onclick="applySkuPrice()">应用到全部规格</button></div><button type="button" class="add-spec" onclick="addEditorSku()">＋ 添加规格</button><div class="publish-option"><div><label for="active">上架销售</label><p>关闭时保存为草稿；开启后小程序侧可见。</p></div><input id="active" type="checkbox" ${editing.active?'checked':''}></div></section></fieldset><div class="editor-footer"><small id="draft-state" role="status">尚未修改</small><button type="button" onclick="closeModal()">取消</button><button id="save-product" class="primary">保存商品</button></div></form>`,false,'product');}

function captureEditor(){Object.assign(editing,{name:$('pname').value,petScope:$('pet-scope').value,featured:$('featured').checked,pickNote:$('pick-note').value,category:$('category').value,description:$('description').value,active:$('active').checked,skus:editing.skus.map((k,i)=>({...k,name:$('sku-name-'+i).value,priceYuan:$('sku-price-'+i).value,stock:$('sku-stock-'+i).value}))});}
function changeTemplate(id){if(savingProduct)return;if(modalDirty){askDiscard(()=>{editor(null,id);markDirty();});return;}editor(null,id);markDirty();}
function duplicateProduct(id){editing=JSON.parse(JSON.stringify(adminProducts.find(p=>p.id===id)));delete editing.id;editing.name+='（副本）';editing.active=false;editing.skus=editing.skus.map((k,i)=>({...k,id:'sku-'+Date.now()+'-'+i,stock:0}));originalSkuIds=new Set();renderEditor();markDirty();}

function skuFields(k,i){return `<div class="sku-editor"><label><span class="sku-label">规格 ${i+1}</span><input id="sku-name-${i}" aria-label="规格 ${i+1} 名称" value="${esc(k.name)}" maxlength="80" required placeholder="如：薄荷绿 / M"></label><label><span class="sku-label">售价（元）</span><input id="sku-price-${i}" aria-label="规格 ${i+1} 售价" type="number" min="0.01" max="100000" step="0.01" value="${esc(k.priceYuan??money(k.price))}" required></label><label><span class="sku-label">可售库存</span><input id="sku-stock-${i}" aria-label="规格 ${i+1} 库存" type="number" min="0" max="100000" step="1" value="${esc(k.stock)}" ${inventoryAvailable&&originalSkuIds.has(k.id)&&editing.id?'readonly title="已有规格请从商品列表的库存入口调整"':''} required></label><button type="button" class="text-button" ${originalSkuIds.has(k.id)&&editing.id?'disabled title="已有规格保留编号，库存请从库存入口调整"':''} onclick="removeEditorSku(${i})" aria-label="移除规格 ${i+1}">移除</button></div>`;}
function redrawSkus(){$('sku-fields').innerHTML=editing.skus.map(skuFields).join('');}
function addEditorSku(){
  if(savingProduct)return;if(editing.skus.length>=20)throw Error('最多添加 20 个规格');
  captureEditor();editing.skus.push({id:'sku-'+Date.now()+'-'+(++skuSequence),name:'',price:1000,stock:0});redrawSkus();markDirty();
}
function removeEditorSku(i){
  if(savingProduct)return;if(editing.skus.length===1)throw Error('至少保留一个规格');
  if(editing.id&&originalSkuIds.has(editing.skus[i]?.id))throw Error('已有规格需保留，停售可将库存设为 0');
  captureEditor();editing.skus.splice(i,1);redrawSkus();markDirty();
}
function applySkuPrice(){
  const price=studio.cents($('batch-price').value);captureEditor();
  editing.skus.forEach(k=>{k.priceYuan=money(price);});redrawSkus();markDirty();
}
function productPayload(){
  captureEditor();const names=new Set();
  const skus=editing.skus.map(k=>{
    const name=k.name.trim();if(!name)throw Error('请填写每个规格的名称');
    if(names.has(name))throw Error('规格名称不能重复');names.add(name);
    const stock=Number(k.stock);if(String(k.stock).trim()===''||!Number.isSafeInteger(stock)||stock<0||stock>100000)throw Error('库存须为 0 到 100000 的整数');
    return {id:k.id,name,price:studio.cents(k.priceYuan),stock};
  });
  return {...editing,name:editing.name.trim(),skus};
}
async function saveProduct(e){
  e.preventDefault();if(savingProduct)return;
  if(pendingUploads)throw Error('图片正在上传，请完成后再保存');
  if(!editing.id&&!editing.requestKey)editing.requestKey='product-'+Date.now()+'-'+Math.random().toString(36).slice(2);const payload=productPayload(),button=$('save-product');savingProduct=true;
  $('product-fields').disabled=true;button.disabled=true;button.textContent='正在保存…';
  try{const saved=await api('saveProduct',payload);closeModal(true);await show('products');notifySaved(`已保存「${saved.name}」 · ${saved.skus.length} 个规格 · ${saved.active?'上架中':'草稿'}`);}
  finally{savingProduct=false;$('product-fields').disabled=false;button.disabled=false;button.textContent='保存商品';}
}

function imageControl(target,src){return `<section class="panel image-control ${target==='product'?'product-image-control':''}"><h3>${target==='product'?'商品图片':'选择图片'}</h3><img id="image-${target}" class="chosen-image" src="${esc(src||'/assets/empty-v2.jpg')}" alt="当前选择的图片"><label class="upload-label">上传自己的图片（JPG / PNG，≤2MB）<input type="file" accept="image/jpeg,image/png" onchange="uploadStudioImage(this,'${target}')"></label><details><summary>从备选图库选择 · ${studio.images(target).length} 张</summary><p class="field-caption">AI 示意图，销售时请确保图片与实物一致。</p><div class="asset-grid">${studio.images(target).map(a=>`<button type="button" onclick="chooseStudioImage('${target}','${a.src}')"><img src="${a.src}" alt="${a.name}"><span>${a.name}</span><small>${a.kind} · AI 示意</small></button>`).join('')}</div></details><p id="image-status-${target}" role="status"></p></section>`;}
function chooseStudioImage(target,src){if(target==='product'){try{Object.assign(editing,studio.withImage(editing,src));$('product-gallery').innerHTML=productGallery();}catch(e){error(e);return;}}else storeDraft[target]=src;markDirty();$('image-'+target).src=src;$('image-status-'+target).textContent='已选择，保存后生效';}
async function uploadStudioImage(input,target){
 const f=input.files[0];if(!f)return;
 const status=$('image-status-'+target),draft=target==='product'?editing:storeDraft;
 if(!draft||!$('modal').open){input.value='';return;}
 if(!f.size||f.size>2*1024*1024||!['image/png','image/jpeg'].includes(f.type)){status.textContent='请选择非空且不超过 2MB 的 JPG 或 PNG 图片';input.value='';return;}
 if(target==='product'&&studio.productImages(draft).length>=6){status.textContent='最多 6 张图片，请先移除一张再上传';input.value='';return;}
 status.textContent='正在上传图片…';input.disabled=true;pendingUploads++;
 try{
  const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=()=>reject(Error('图片读取失败，请重新选择'));r.onabort=()=>reject(Error('图片读取已取消，请重新选择'));r.readAsDataURL(f);});
  if(draft!==(target==='product'?editing:storeDraft)||!$('modal').open)return;
  const uploadedPath=await request('/upload',{base64});
  if(draft!==(target==='product'?editing:storeDraft)||!$('modal').open)return;
  chooseStudioImage(target,uploadedPath);
 }catch(e){status.textContent=e.retryable?'图片上传未完成，原图和填写内容已保留。请重新选择这张图片重试。':e.message;}
 finally{pendingUploads--;input.disabled=false;input.value='';}
}

function productGallery(){return '<p class="field-caption">第一张为封面。可拖动图片排序，也可使用前移、后移按钮。</p><div class="photo-gallery">'+studio.productImages(editing).map((src,i,images)=>`<div class="photo-item" draggable="true" ondragstart="startPhotoDrag(event,${i})" ondragover="event.preventDefault()" ondrop="dropPhoto(event,${i})"><div class="photo-number">${i===0?'封面':'图片 '+(i+1)}</div><img src="${esc(src)}" alt="商品图片 ${i+1}" draggable="false"><div class="photo-actions"><button type="button" ${i===0?'disabled':''} onclick="movePhoto(${i},${i-1})" aria-label="图片 ${i+1} 前移">←</button><button type="button" ${i===images.length-1?'disabled':''} onclick="movePhoto(${i},${i+1})" aria-label="图片 ${i+1} 后移">→</button><button type="button" onclick="removePhoto(${i})" aria-label="移除图片 ${i+1}">移除</button></div></div>`).join('')+'</div>';}
function refreshPhotos(){$('product-gallery').innerHTML=productGallery();$('image-product').src=editing.image||'/assets/empty-v2.jpg';markDirty();}
function movePhoto(from,to){
  if(savingProduct)return;const images=studio.productImages(editing);
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=images.length||to>=images.length||from===to)return;
  const [src]=images.splice(from,1);images.splice(to,0,src);Object.assign(editing,{images,image:images[0]});refreshPhotos();
}
function startPhotoDrag(e,i){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-pet-photo',String(i));}
function dropPhoto(e,i){e.preventDefault();const raw=e.dataTransfer.getData('application/x-pet-photo');if(/^\d+$/.test(raw))movePhoto(Number(raw),i);}
function coverPhoto(i){movePhoto(i,0);}
function removePhoto(i){if(savingProduct)return;Object.assign(editing,studio.withoutImage(editing,i));refreshPhotos();}

function storeEditor(){storeDraft={...storefront};modal('<h2>店铺图片设置</h2><p class="muted">保留当前配色与布局，保存后买家可见。</p>'+studio.slots.map(slot=>`<h3>${slot.name}</h3><p class="field-caption">${slot.hint}</p>${imageControl(slot.key,storeDraft[slot.key])}`).join('')+'<button class="primary full" onclick="saveStorefront()">保存店铺图片</button>',false,'store');}
async function saveStorefront(){if(pendingUploads)throw Error('图片正在上传，请完成后再保存');await api('saveStorefront',storeDraft);closeModal(true);await show();notifySaved('店铺图片已保存');}
function homeEditor(){modal('<h2>首页内容设置</h2><p class="muted">文案和场景可随时调整；商品编辑中可设置精选与推荐语。</p><form onsubmit="saveHome(event)">'+homeFields.map(([k,t,n])=>`<label>${t}<textarea id="home-${k}" maxlength="${n}" required>${esc(homeContent[k])}</textarea></label>`).join('')+homeContent.scenes.map((x,i)=>`<section class="panel"><h3>生活场景 ${i+1}</h3><label>标题<input id="scene-title-${i}" maxlength="18" required value="${esc(x.title)}"></label><label>说明<input id="scene-text-${i}" maxlength="40" value="${esc(x.text)}"></label><label>跳转分类<select id="scene-cat-${i}">${['主粮','零食','玩具','清洁','用品'].map(c=>`<option ${c===x.category?'selected':''}>${c}</option>`).join('')}</select></label><label>场景配图<select id="scene-image-${i}">${studio.assets.map(a=>`<option value="${a.id}" ${a.id===x.image?'selected':''}>${a.name}</option>`).join('')}</select></label></section>`).join('')+'<button class="primary full">保存首页内容</button></form>',false,'home');}
async function saveHome(e){e.preventDefault();const h={};for(const [k] of homeFields)h[k]=$('home-'+k).value;h.scenes=homeContent.scenes.map((x,i)=>({...x,title:$('scene-title-'+i).value,text:$('scene-text-'+i).value,category:$('scene-cat-'+i).value,image:$('scene-image-'+i).value}));await api('saveHomeContent',h);closeModal(true);await show();notifySaved('首页内容已保存');}
function lineIcon(name){const paths={box:'<path d="m3 7 9-4 9 4-9 4-9-4v10l9 4 9-4V7M12 11v10M7 5l10 4"/>',pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',shop:'<path d="M4 10v11h16V10M3 3h18l1 7H2l1-7ZM9 21v-7h6v7"/>',truck:'<path d="M2 5h12v12H2ZM14 10h5l3 4v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',heart:'<path d="M12 21 3 12C-2 4 8 0 12 7c4-7 14-3 9 5Z"/>'};return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.box}</svg>`;}
function fulfillmentProgress(o){const f=o.fulfillment||{},history=[o.status,o.refund?.previous,...(o.refundHistory||[]).map(r=>r.previous)];const completed=f.redeemedAt!=null||history.includes('COMPLETED'),handed=completed||f.readyAt!=null||!!o.shipping||history.includes('SHIPPED');return {prepared:handed||history.includes('PAID'),handed,completed};}
function fulfillmentCard(o){const f=o.fulfillment||{type:'DELIVERY'},pickup=f.type==='PICKUP',progress=fulfillmentProgress(o);return `<section class="fulfillment-card"><div class="fulfillment-top"><span class="service-icon">${lineIcon(pickup?'shop':'truck')}</span><div><h3>${pickup?'到店自提':'商家外送'}</h3></div><span class="tag">${studio.fulfillmentLabel(o)||states[o.status]}</span></div><div class="fulfillment-body"><h4>${esc(pickup?f.store.name:o.address.detail)}</h4>${pickup?`<p>${esc(f.store.detail)}<br>${esc(f.store.hours)}</p>`:''}<p>${esc(o.address.name)} · ${esc(o.address.phone)}</p>${pickup&&o.status==='PAID'&&role==='buyer'?`<div class="pickup-pass"><small>${f.readyAt?'已备好，可以来取啦':'正在备货，请稍候到店'}</small><strong>${f.code}</strong><span>到店后向商家出示提货码</span></div>`:''}${!pickup&&o.shipping?`<div class="delivery-slip"><small>商家配送单号</small><strong>${esc(o.shipping.number||'未填写单号')}</strong>${o.shipping.note?`<p>${esc(o.shipping.note)}</p>`:''}</div>`:''}<div class="journey"><span class="done">下单</span><i></i><span class="${progress.prepared?'done':''}">备货</span><i></i><span class="${progress.handed?'done':''}">${pickup?'待自提':'已送出'}</span><i></i><span class="${progress.completed?'done':''}">完成</span></div></div></section>`;}
function merchantFulfillment(o){if(role!=='merchant'||o.status!=='PAID'||o.fulfillment?.issue?.status==='OPEN')return '';if(o.fulfillment?.type==='PICKUP')return `<section class="panel"><h3>${o.fulfillment.readyAt?'到店核销':'准备自提商品'}</h3>${o.fulfillment.readyAt?`<label>买家出示的提货码<input id="redeem-code" inputmode="numeric" maxlength="6" placeholder="输入 6 位提货码"></label><button class="primary full" onclick="orderAction('pickupRedeem',{code:$('redeem-code').value})">核销并完成自提</button>`:`<p class="muted">核对商品后标记备好，买家订单将显示可到店领取。</p><button class="primary full" onclick="orderAction('pickupReady')">商品已备好，可到店自提</button>`}</section>`;return `<section class="panel"><h3>安排商家外送</h3><p class="muted">自行安排送货，登记单号或备注即可。</p><label>配送单号<input id="number" maxlength="40" placeholder="如 SD20261024（选填）"></label><label>配送备注<textarea id="delivery-note" maxlength="200" placeholder="如店员配送，约下午送达（与单号至少填一项）"></textarea></label><button class="primary full" onclick="ship()">确认已送出</button></section>`;}

const stockTypes={RECEIVE:'进货入库',COUNT:'可售库存盘点',LOSS:'报损出库',INITIAL:'初始入库',PRODUCT_EDIT:'商品编辑调整',RETURN_INSPECTION:'退货验收',FULFILLMENT_RETURN:'履约退款入库'};
let stockDraft=null,stockHistoryRevision=0;
function stockPendingKey(){return 'pet-stock-pending-'+$('operator').textContent;}
function stockPending(){const raw=sessionStorage.getItem(stockPendingKey());return raw?JSON.parse(raw):null;}
async function stockEditor(id){
  if(!inventoryAvailable)throw Error('库存登记等待服务更新，现有商品编辑仍可使用。');
  if($('modal').open&&!closeModal())return;
  const pending=stockPending();
  if(pending)id=pending.productId;
  const products=await api('merchantProducts'),product=products.find(p=>p.id===id);
  if(!product)throw Error('商品不存在，请刷新商品列表。');
  stockDraft={product,pending};
  modal(`<div class="inventory-heading"><span class="eyebrow">库存管理</span><h2>${esc(product.name)}</h2><p class="muted">进货、盘点与报损分别登记，保存后同步小程序可售库存。</p></div>
  <form class="inventory-form" onsubmit="saveStock(event)"><fieldset id="stock-fields" ${pending?'disabled':''}>
  <label>规格<select id="stock-sku" onchange="stockPreview()">${product.skus.map(s=>`<option value="${esc(s.id)}" ${pending?.skuId===s.id?'selected':''}>${esc(s.name)} · 可售 ${s.stock} 件</option>`).join('')}</select></label>
  <div class="two-fields"><label>操作类型<select id="stock-type" onchange="stockPreview()">${['RECEIVE','COUNT','LOSS'].map(t=>`<option value="${t}" ${pending?.type===t?'selected':''}>${stockTypes[t]}</option>`).join('')}</select></label><label><span id="stock-quantity-label">入库数量</span><input id="stock-quantity" type="number" min="1" max="100000" step="1" required value="${esc(pending?.quantity??'')}" oninput="stockPreview()"></label></div>
  <p class="inventory-help">盘点只填未被订单占用的可售数量。已下单待付款、待发货或待自提的商品要单独留出，不能再次算入可售库存。</p>
  <label>原因 / 单据备注<textarea id="stock-reason" maxlength="200" required placeholder="如：采购到货 12 件，进货单 JH1026；或包装破损 1 件">${esc(pending?.reason||'')}</textarea></label>
  <p id="stock-preview" class="inventory-preview" role="status"></p></fieldset>
  <div class="editor-footer"><small id="stock-feedback" role="status">${pending?'有待确认的提交。点击核对原提交，不会重复增减。':'保存后不可删除流水；更正需另作一笔调整。'}</small><button type="button" onclick="closeModal()">关闭</button><button id="stock-submit" class="primary">${pending?'核对原提交':'确认保存'}</button></div></form>
  <section class="inventory-history"><h3>库存记录</h3><p class="muted">记录人工调整与退货入库。下单占用及取消释放可在对应订单核对。</p><div id="stock-history" aria-live="polite">正在读取记录…</div></section>`,false,'inventory');
  if(pending)modalDirty=true;else stockPreview();
  await stockHistory();
}
function stockPreview(){
  if(!stockDraft||stockDraft.pending)return;
  const sku=stockDraft.product.skus.find(s=>s.id===$('stock-sku').value),type=$('stock-type').value,raw=$('stock-quantity').value,quantity=Number(raw);
  $('stock-quantity').min=type==='COUNT'?'0':'1';
  $('stock-quantity-label').textContent=type==='COUNT'?'盘点后可售数量':type==='LOSS'?'报损数量':'入库数量';
  const after=sku&&(type==='COUNT'?quantity:sku.stock+(type==='LOSS'?-quantity:quantity));
  $('stock-preview').textContent=raw!==''&&sku&&Number.isSafeInteger(quantity)?`可售 ${sku.stock} 件 → ${after} 件`:'填写数量后查看变更';
}
async function saveStock(event){
  event.preventDefault();if(savingProduct)return;
  const draft=stockDraft;
  if(!draft.pending){
    const quantity=Number($('stock-quantity').value),type=$('stock-type').value,reason=$('stock-reason').value.trim();
    if($('stock-quantity').value===''||!Number.isSafeInteger(quantity)||quantity<(type==='COUNT'?0:1)||quantity>100000)throw Error('请填写有效的整数数量。');
    if(!reason)throw Error('请填写调整原因或单据备注。');
    draft.pending={productId:draft.product.id,skuId:$('stock-sku').value,revision:draft.product.revision,type,quantity,reason,requestKey:'stock-'+crypto.randomUUID()};
    // Persist before sending. A page reload must not turn an uncertain write into a new adjustment.
    try{sessionStorage.setItem(stockPendingKey(),JSON.stringify(draft.pending));}catch{draft.pending=null;throw Error('浏览器无法保存提交记录，请允许本站会话存储后再操作。');}
  }
  savingProduct=true;modalDirty=true;$('stock-fields').disabled=true;$('stock-submit').disabled=true;
  try{
    const result=await api('adjustStock',draft.pending);sessionStorage.removeItem(stockPendingKey());draft.pending=null;
    closeModal(true);await show('products');notifySaved(`${stockTypes[result.type]}已登记：${result.spec}，${result.before} → ${result.after} 件`);
  }catch(e){
    if(e.business&&e.code&&e.code!=='STOCK_REQUEST_CONFLICT'){sessionStorage.removeItem(stockPendingKey());draft.pending=null;}
    $('stock-feedback').textContent=draft.pending?'结果待确认，保留了原提交。再次点击可安全核对；不要另开窗口重复登记。':'本次未保存。库存有变化时请关闭窗口，重新核对数量后再登记。';
    error(e);
  }finally{
    savingProduct=false;
    if($('modal').open&&stockDraft===draft){$('stock-fields').disabled=!!draft.pending;$('stock-submit').disabled=false;$('stock-submit').textContent=draft.pending?'核对原提交':'确认保存';}
  }
}
async function stockHistory(page=1){
  const product=stockDraft.product,revision=++stockHistoryRevision;
  try{
    const data=await api('stockHistory',{productId:product.id,page,pageSize:5});
    if(revision!==stockHistoryRevision||stockDraft.product!==product||modalKind!=='inventory')return;
    $('stock-history').innerHTML=data.items.length?`<div class="table-scroll"><table><thead><tr><th>时间 / 操作</th><th>规格</th><th>变动</th><th>原因 / 操作人</th></tr></thead><tbody>${data.items.map(r=>`<tr><td>${esc(new Date(r.at).toLocaleString('zh-CN'))}<small class="cell-note">${stockTypes[r.type]||esc(r.type)}${r.orderId?' · '+esc(r.orderId):''}</small></td><td>${esc(r.spec)}</td><td><strong>${r.delta>0?'+':''}${r.delta}</strong><small class="cell-note">${r.before===undefined?'可售入库':r.before+' → '+r.after}</small></td><td>${esc(r.reason)}<small class="cell-note">${esc(r.actor)}</small></td></tr>`).join('')}</tbody></table></div><div class="inventory-pages"><span>第 ${data.page} / ${data.pages} 页 · ${data.total} 条</span><button type="button" ${data.page<=1?'disabled':''} onclick="stockHistory(${data.page-1})">上一页</button><button type="button" ${data.page>=data.pages?'disabled':''} onclick="stockHistory(${data.page+1})">下一页</button></div>`:'<p class="muted">暂无人工调整或退货入库记录。</p>';
  }catch(e){if(revision===stockHistoryRevision&&modalKind==='inventory')$('stock-history').innerHTML=`<p>${esc(e.message)}</p><button onclick="stockHistory(${page})">重新读取记录</button>`;}
}

function needsStockDisposition(o){return fulfillmentAvailable&&o.refund?.type==='REFUND_ONLY'&&(o.refund.previous==='PAID'||o.fulfillment?.issue?.status==='OPEN');}
function stockDispositionFields(o,prefix){return `<p class="field-caption">只计入实际在店或已取回的商品。缺货、丢失、未取回的部分不得回补；可售数量在退款成功时入库。</p>${o.lines.map((l,i)=>`<div class="receipt-line"><h4>${esc(l.name)} · ${esc(l.spec)}（订单 ${l.qty} 件）</h4><div class="two-fields"><label>在店或取回数量<input id="${prefix}-received-${i}" type="number" min="0" max="${l.qty}" step="1" value="0"></label><label>可售数量<input id="${prefix}-restock-${i}" type="number" min="0" max="${l.qty}" step="1" value="0"></label></div></div>`).join('')}<label class="switch-row">已核对实际数量和整单退款 ¥${money(o.total)}（含配送费）<input id="${prefix}-confirm" type="checkbox"></label>`;}
function readStockDisposition(prefix){return currentOrder.lines.map((l,i)=>{const received=$(`${prefix}-received-${i}`).value,restock=$(`${prefix}-restock-${i}`).value;if(received===''||restock==='')throw Error('请填写全部商品的实际数量');return {productId:l.productId,skuId:l.skuId,receivedQty:Number(received),restockQty:Number(restock)};});}
function issueStorageKey(id){return 'pet-fulfillment-pending-'+$('operator').textContent+'-'+id;}
function readIssuePending(id){try{const raw=sessionStorage.getItem(issueStorageKey(id));if(!raw)return null;const pending=JSON.parse(raw);if(!['recordFulfillmentIssue','resolveFulfillmentIssue','merchantRefund'].includes(pending.action)||pending.input?.id!==id)throw Error('invalid');return pending;}catch{return {unavailable:true};}}
function renderFulfillmentIssue(o,pending){
 const issue=o.fulfillment?.issue;let html='';
 if(issue){const open=issue.status==='OPEN';html+=`<section class="fulfillment-issue ${open?'is-open':''}"><span class="eyebrow">履约处理 · ${open?'处理中':'已处理'}</span><h3>${esc((studio.issueLabels[issue.type]||'履约问题').replace('待处理',''))}</h3><p>${esc(issue.note)}</p>${issue.nextAt&&open?`<p><strong>约定处理时间</strong><br>${esc(new Date(issue.nextAt).toLocaleString('zh-CN'))}${issue.nextAt<Date.now()?'<br>约定时间已过，请联系买家重新确认':''}</p>`:''}<details><summary>查看处理记录</summary>${[...(o.fulfillment.issueHistory||[]),issue].map(i=>(i.timeline||[]).map(t=>`<p><strong>${esc(t.label)}</strong> · ${esc(t.actor)}<br><small>${esc(new Date(t.at).toLocaleString('zh-CN'))}</small><br>${esc(t.detail)}${t.nextAt?'<br>约定时间：'+esc(new Date(t.nextAt).toLocaleString('zh-CN')):''}</p>`).join('')).join('')}</details></section>`;}
 if(!fulfillmentAvailable)return html;
 if(pending)return html+`<section class="panel"><h3>上次处理待确认</h3><p>${pending.unavailable?'浏览器无法读取提交记录，本页暂时只读。请恢复本站会话存储后重新打开订单。':'保留了上次提交的原内容。核对后再继续处理，不会重复发起退款或重新入库。'}</p>${pending.unavailable?'':'<button id="issue-retry" class="primary" onclick="submitFulfillment()">核对上次处理</button>'}</section>`;
 if(!['PAID','SHIPPED'].includes(o.status))return html;
 const open=issue?.status==='OPEN',pickup=o.fulfillment?.type==='PICKUP',types=['CONTACT_UNREACHABLE'];if(o.status==='PAID')types.unshift('OUT_OF_STOCK');if(!pickup&&o.status==='SHIPPED')types.unshift('DELIVERY_FAILED');if(pickup&&o.fulfillment.readyAt)types.unshift('PICKUP_DELAY');
 html+=`<section class="panel issue-editor"><h3>${open?'处理履约问题':'遇到履约问题？'}</h3><p class="field-caption">请先与买家确认，再登记处理说明和时间。买家可以在订单中查看。</p><fieldset id="issue-fields">${open?`<label>处理方式<select id="issue-resolution"><option value="RESCHEDULE">协商改期，继续跟进</option>${o.status==='PAID'?'<option value="RESUME">问题已解决，继续履约</option>':'<option value="REDELIVER">已重新送出</option>'}</select></label><label>约定处理时间（改期时必填）<input id="issue-next-at" type="datetime-local"></label>${!pickup&&o.status==='SHIPPED'?'<label>重新送出单号（选填）<input id="issue-number" maxlength="40" placeholder="实际再次送出时填写"></label>':''}`:`<label>问题类型<select id="issue-type">${types.map(t=>`<option value="${t}">${studio.issueLabels[t]}</option>`).join('')}</select></label>`}<label>处理说明（买家可见）<textarea id="issue-note" maxlength="300" placeholder="说明遇到的问题、沟通结果或已采取的处理"></textarea></label><button class="primary" onclick="submitFulfillment('${open?'resolveFulfillmentIssue':'recordFulfillmentIssue'}')">${open?'保存处理结果':'登记问题'}</button>${open?`<details class="issue-refund"><summary>无法继续履约，发起整单退款</summary><p>退款金额 ¥${money(o.total)}。只结束本单，不自动下架商品；有缺货或报损时也请核对商品剩余可售库存。</p><label>退款原因（买家可见）<textarea id="issue-refund-note" maxlength="300"></textarea></label>${stockDispositionFields(o,'issue-stock')}<button onclick="submitFulfillment('merchantRefund')">确认数量并发起退款</button></details>`:''}</fieldset><button id="issue-retry" class="primary" hidden onclick="submitFulfillment()">核对上次处理</button></section>`;return html;
}
async function submitFulfillment(action){
 if(savingOrder)return;const id=currentOrder.id;let pending=readIssuePending(id);if(pending?.unavailable)throw Error('浏览器无法读取提交记录，请恢复本站会话存储后再操作。');
 if(!pending){
  const input={id,issueId:currentOrder.fulfillment?.issue?.id,issueRevision:currentOrder.fulfillment?.issue?.revision,requestKey:'fulfill-'+crypto.randomUUID(),note:$(action==='merchantRefund'?'issue-refund-note':'issue-note').value.trim()};if(!input.note)throw Error('请填写买家可见的处理说明');
  if(action==='recordFulfillmentIssue')input.type=$('issue-type').value;
  else if(action==='resolveFulfillmentIssue'){input.resolution=$('issue-resolution').value;if(input.resolution==='RESCHEDULE')input.nextAt=new Date($('issue-next-at').value).getTime();if(input.resolution==='REDELIVER')input.number=$('issue-number').value.trim();}
  else if(action==='merchantRefund'){input.items=readStockDisposition('issue-stock');input.confirm=$('issue-stock-confirm').checked;}
  else throw Error('请选择处理方式');
  pending={action,input};try{sessionStorage.setItem(issueStorageKey(id),JSON.stringify(pending));}catch{throw Error('无法保存提交记录，本次尚未提交。请允许本站会话存储后重试。');}
 }
 let committed=false;savingOrder=true;modalDirty=true;const fields=$('issue-fields'),retry=$('issue-retry');if(fields)fields.disabled=true;if(retry)retry.disabled=true;
 try{await api(pending.action,pending.input);committed=true;sessionStorage.removeItem(issueStorageKey(id));modalDirty=false;await show();await viewOrder(id);notifySaved('处理结果已保存，买家刷新订单即可查看');}
 catch(e){if(committed){modalDirty=false;if(retry)retry.hidden=true;error(Error('处理结果已保存，但刷新失败。请关闭详情后重新打开订单核对，无需再次提交。'));return;}if(e.business&&e.code&&e.code!=='处理请求已提交，请勿改动原请求重试'){sessionStorage.removeItem(issueStorageKey(id));if(fields)fields.disabled=false;else await viewOrder(id);}else if(retry)retry.hidden=false;error(e);}
 finally{savingOrder=false;if(retry)retry.disabled=false;}
}
function simulationNotesHtml(){const notes=paymentMode==='simulation'?studio.simulationNotes:['支付方式以每笔订单的支付记录为准。微信付款订单提交退款会涉及真实资金。','微信支付已配置不代表商户绑定、授权及收退款验收已经完成。','店铺资料和商品图片需要核对后使用，样例内容不代表真实经营信息。'];return notes.map(note=>'<p>'+esc(note)+'</p>').join('');}
function showSimulationNotes(){if($('modal').open&&!closeModal())return;modal('<h2>使用与数据说明</h2><div class="simulation-notes">'+simulationNotesHtml()+'</div>',false,'notice');}
$('simulation-login-notes').innerHTML=simulationNotesHtml();
boot();
