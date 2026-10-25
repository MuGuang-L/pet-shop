const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Studio = require('../cloudfunctions/shop/studio');
const domain = require('../cloudfunctions/shop/domain');
const source = fs.readFileSync(require.resolve('../apps/merchant-web/app.js'), 'utf8').replace(/boot\(\);\s*$/, '');

function fixture(intercept) {
  let state = domain.seed();
  const nodes = {}, calls = [], listeners = {};
  const node = id => nodes[id] ||= {
    innerHTML: '', textContent: '', value: '', checked: false, style: {}, attrs: {}, open: false,
    setAttribute(k, v) { this.attrs[k] = v; }, showModal() { this.open = true; },
    close() { this.open = false; }, addEventListener(type, callback) { listeners[id+':'+type]=callback; }, querySelector() { return null; }, appendChild() {}
  };
  const context = vm.createContext({
    Studio, console, document: { getElementById: node, querySelectorAll: () => [], createElement: () => ({ style: {} }) },
    window: { addEventListener(type, callback) {listeners[type]=callback;} },
    fetch: async (url, req) => {
      assert.equal(url, '/api');
      assert.equal(req.credentials, 'same-origin');
      const body = JSON.parse(req.body);
      assert.equal(body.role, undefined);
      calls.push(body);
      await intercept?.(body);
      try {
        const result = domain.execute(state, { id: 'owner', merchant: true }, body.action, body.input, { mock: true });
        state = result.state;
        return { status: 200, json: async () => ({ ok: true, data: result.result }) };
      } catch (e) {
        return { status: 400, json: async () => ({ ok: false, error: e.message }) };
      }
    }
  });
  vm.runInContext(source, context);
  vm.runInContext(fs.readFileSync(require.resolve('../apps/merchant-web/settings.js'),'utf8'),context);
  return { run: code => vm.runInContext(code, context), node, calls, state: () => state,
    event: (name,e={}) => listeners[name]?.(e),
    buyer: (action,input) => {const result=domain.execute(state,{id:'buyer-test',merchant:false},action,input,{mock:true});state=result.state;return result.result;}
  };
}

test('商家商品筛选按规格识别低库存、组合搜索，并保持原始商品顺序', () => {
  const f = fixture();
  f.run(`adminProducts=[
    {id:'a',name:'食碗',category:'用品',active:true,skus:[{name:'小号',stock:30,price:1900},{name:'大号',stock:2,price:3900}]},
    {id:'b',name:'猫粮',category:'主粮',active:false,skus:[{name:'1kg',stock:0,price:5900}]},
    {id:'c',name:'绳结玩具',category:'玩具',active:true,skus:[{name:'标准',stock:8,price:900}]}
  ]`);
  assert.equal(f.run("filteredProducts(adminProducts,'','ALL','low').map(p=>p.id).join()"), 'a');
  assert.equal(f.run("filteredProducts(adminProducts,' 大号 ','用品','active').map(p=>p.id).join()"), 'a');
  assert.equal(f.run("filteredProducts(adminProducts,'猫粮','主粮','draft').length"), 1);
  assert.equal(f.run("filteredProducts(adminProducts,'','ALL','ALL','stock').map(p=>p.id).join()"), 'b,c,a');
  assert.equal(f.run("filteredProducts(adminProducts,'','ALL','ALL','price').map(p=>p.id).join()"), 'c,a,b');
  assert.equal(f.run("adminProducts.map(p=>p.id).join()"), 'a,b,c');
  assert.equal(f.run('productFacts(adminProducts[0]).min'), 1900);
  assert.equal(f.run('productFacts(adminProducts[0]).max'), 3900);
});

test('商品列表转义可编辑内容，搜索和空结果不写数据库', async () => {
  const f = fixture();
  await f.run("show('products')");
  const before = JSON.stringify(f.state());
  f.run("adminProducts[0].name='<img onerror=attack>';renderProductResults()");
  assert.match(f.node('product-results').innerHTML, /&lt;img onerror=attack&gt;/);
  assert.doesNotMatch(f.node('product-results').innerHTML, /<img onerror=attack>/);
  f.run("productQuery='不存在的商品';renderProductResults()");
  assert.match(f.node('product-results').innerHTML, /清除筛选/);
  f.run('resetProducts()');
  assert.equal(f.node('product-count').textContent, '3 / 3 件商品');
  assert.equal(JSON.stringify(f.state()), before);
  assert.ok(f.calls.every(c => ['storefront', 'homeContent', 'merchantProducts'].includes(c.action)));
});

test('已完成及退款自提订单不再提示待核销', () => {
  const f = fixture();
  assert.equal(f.run("orderFulfillmentNote({status:'COMPLETED',fulfillment:{type:'PICKUP',readyAt:1}})"), '已完成到店自提');
  assert.equal(f.run("orderFulfillmentNote({status:'REFUNDED',fulfillment:{type:'PICKUP',readyAt:1}})"), '到店自提订单');
  assert.equal(f.run("orderFulfillmentNote({status:'PAID',fulfillment:{type:'PICKUP',readyAt:1}})"), '已备好，等待到店核销');
});

test('快速切换页面时，较晚返回的旧订单请求不会覆盖商品页面', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture(body => body.action === 'merchantOrders' ? gate : undefined);
  const orders = f.run("show('orders')");
  await f.run("show('products')");
  const products = f.node('app').innerHTML;
  release();
  await orders;
  assert.equal(f.node('section-title').textContent, '商品');
  assert.equal(f.node('app').innerHTML, products);
  assert.equal(f.node('app').attrs['aria-busy'], 'false');
});

test('退出页面使在途请求失效，不重新显示经营数据', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture(body => body.action === 'merchantOrders' ? gate : undefined);
  const pending = f.run("show('orders')");
  f.run('loginScreen()');
  release();
  await pending;
  assert.equal(f.node('workspace').hidden, true);
  assert.doesNotMatch(f.node('app').innerHTML, /订单列表/);
});

test('加载失败显示重试入口，重试成功后清除错误与忙碌状态', async () => {
  let fail = true;
  const f = fixture(body => { if (fail && body.action === 'merchantProducts') throw Error('网络暂时不可用'); });
  await f.run("show('products')");
  assert.match(f.node('app').innerHTML, /重新加载/);
  assert.equal(f.node('app').attrs['aria-busy'], 'false');
  fail = false;
  await f.run("show('products')");
  assert.match(f.node('app').innerHTML, /商品列表/);
  assert.equal(f.node('error').style.display, 'none');
});

test('订单筛选保留服务侧契约，重置回到全部订单第一页', async () => {
  const f = fixture();
  await f.run("orderQueue='all';orderSearch='绳结';orderStatus='PAID';fulfillmentFilter='PICKUP';orderPageNumber=3;show('orders')");
  assert.deepEqual(f.calls.find(c => c.action === 'merchantOrdersPage').input, {
    q: '绳结', status: 'PAID', page: 3, fulfillment: 'PICKUP'
  });
  await f.run('resetOrders()');
  assert.deepEqual(f.calls.filter(c => c.action === 'merchantOrdersPage').at(-1).input, {
    q: '', status: 'ALL', page: 1, fulfillment: 'ALL'
  });
});

test('商品模板和复制只编辑本地草稿，取消不保存，不回填原库存', async () => {
  const f = fixture();
  await f.run("show('products')");
  const before = JSON.stringify(f.state());
  f.run("duplicateProduct('toy')");
  assert.equal(f.run('editing.active'), false);
  assert.equal(f.run('editing.skus[0].stock'), 0);
  assert.equal(f.run('editing.id'), undefined);
  assert.match(f.node('modal').innerHTML, /图片与封面/);
  f.run('closeModal()');
  f.run("editor(null,'snack')");
  assert.equal(f.run('editing.category'), '零食');
  assert.match(f.run('editing.description'), /喂食建议/);
  f.run('closeModal()');
  assert.equal(JSON.stringify(f.state()), before);
  assert.equal(f.calls.filter(c => c.action === 'saveProduct').length, 0);
});

test('商品保存抑制重复提交，仍使用原有金额与规格契约', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture(body => body.action === 'saveProduct' ? gate : undefined);
  await f.run("show('products')");
  f.run("editor('toy')");
  for (const [id, value] of Object.entries({
    pname: '演示玩具', category: '玩具', 'pet-scope': '通用', 'pick-note': '日常陪伴',
    description: '演示说明', 'sku-name-0': '薄荷绿 / M', 'sku-price-0': '21.50', 'sku-stock-0': '8'
  })) f.node(id).value = value;
  f.node('active').checked = true;
  const first = f.run('saveProduct({preventDefault(){}})');
  await f.run('saveProduct({preventDefault(){}})');
  assert.equal(f.node('save-product').disabled, true);
  release();
  await first;
  const saves = f.calls.filter(c => c.action === 'saveProduct');
  assert.equal(saves.length, 1);
  assert.equal(saves[0].input.skus[0].price, 2150);
  assert.equal(saves[0].input.skus[0].stock, 8);
  assert.equal(f.node('save-product').disabled, false);
});

function fillEditor(f,overrides={}){
  const product=JSON.parse(f.run('JSON.stringify(editing)'));
  for(const [key,value] of Object.entries({pname:product.name,category:product.category,'pet-scope':product.petScope||'通用','pick-note':product.pickNote||'',description:product.description||'',...overrides}))f.node(key).value=value;
  f.node('active').checked=product.active;
  f.node('featured').checked=!!product.featured;
  product.skus.forEach((k,i)=>{f.node('sku-name-'+i).value=k.name;f.node('sku-price-'+i).value=k.priceYuan??(k.price/100).toFixed(2);f.node('sku-stock-'+i).value=String(k.stock);});
}
test('待办按履约阶段互斥分类，已结束和待买家退货不计入待办',()=>{
  const f=fixture();
  f.run(`sampleOrders=[
    {id:'a',status:'PAID',createdAt:1,fulfillment:{type:'PICKUP'},lines:[{name:'玩具'}]},
    {id:'b',status:'PAID',createdAt:2,fulfillment:{type:'PICKUP',readyAt:1},lines:[{name:'猫粮'}]},
    {id:'c',status:'PAID',createdAt:3,fulfillment:{type:'DELIVERY'},lines:[{name:'玩具'}]},
    {id:'d',status:'REFUND_REQUESTED',createdAt:4,refund:{stage:'REQUESTED'},lines:[{name:'梳子'}]},
    {id:'e',status:'REFUND_REQUESTED',createdAt:5,refund:{stage:'WAIT_RETURN'},lines:[{name:'梳子'}]},
    {id:'f',status:'COMPLETED',createdAt:6,fulfillment:{type:'PICKUP',readyAt:1},lines:[{name:'猫粮'}]},
    {id:'g',status:'REFUNDED',createdAt:7,refund:{stage:'SUCCEEDED'},lines:[{name:'玩具'}]}
  ]`);
  assert.equal(f.run("sampleOrders.map(orderTask).join(',')"),'prepare,pickup,delivery,aftersale,,,');
  assert.equal(f.run("taskOrderPage(sampleOrders,'todo').total"),4);
  assert.equal(f.run("taskOrderPage(sampleOrders,'todo',{q:'玩具',fulfillment:'DELIVERY'}).items[0].id"),'c');
  assert.equal(f.run("taskOrderPage(sampleOrders,'pickup',{page:999}).page"),1);
  assert.equal(f.run("taskOrderPage(sampleOrders,'todo').items.map(o=>o.id).join()"),'a,b,c,d');
  f.run("sampleOrders=Array.from({length:25},(_,i)=>({...sampleOrders[0],id:'o'+i,createdAt:i}))");
  assert.equal(f.run("taskOrderPage(sampleOrders,'todo',{page:2}).items.length"),10);
  assert.equal(f.run("taskOrderPage(sampleOrders,'todo',{page:3}).items.length"),5);
});
test('输入、Esc 与离开页面提醒；选择继续编辑时保留草稿',async()=>{
  const f=fixture();await f.run("show('products');");f.run("editor('toy')");
  fillEditor(f);f.node('pname').value='未保存名称';
  f.event('input',{target:{closest:()=>true}});
  assert.equal(f.run('closeModal()'),false);assert.equal(f.node('modal').open,true);
  assert.equal(f.node('discard-dialog').open,true);f.run('resolveDiscard(false)');
  assert.equal(f.node('discard-dialog').open,false);assert.equal(f.node('pname').value,'未保存名称');
  let prevented=false;f.event('modal:cancel',{preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(f.node('modal').open,true);
  const unload={preventDefault(){this.prevented=true;}};f.event('beforeunload',unload);
  assert.equal(unload.prevented,true);
  assert.equal(f.node('discard-dialog').open,true);f.run('resolveDiscard(true)');
  assert.equal(f.node('modal').open,false);
  assert.equal(f.calls.filter(c=>c.action==='saveProduct').length,0);
  f.run("editor('toy');markDirty();closeModal();loginScreen()");
  assert.equal(f.node('discard-dialog').open,false);
  assert.equal(f.run('discardAction'),null);
});
test('新增与移除规格保留输入，现有规格编号不允许移除',async()=>{
  const f=fixture();await f.run("show('products')");f.run("editor('food')");fillEditor(f);
  const original=f.run('editing.skus[0].id');f.node('sku-price-0').value='40.50';
  f.run('addEditorSku()');assert.equal(f.run('editing.skus.length'),3);
  assert.equal(f.run('editing.skus[0].priceYuan'),'40.50');
  assert.equal(f.run('editing.skus[0].id'),original);
  fillEditor(f);f.run('removeEditorSku(2)');assert.equal(f.run('editing.skus.length'),2);
  assert.throws(()=>f.run('removeEditorSku(0)'),/已有规格需保留/);
  f.node('batch-price').value='18.90';f.run('applySkuPrice()');
  assert.equal(f.run("editing.skus.map(k=>k.priceYuan).join()"),'18.90,18.90');
  const validation={error:Error('请填写统一售价'),preventDefault(){this.prevented=true;}};
  f.event('error',validation);
  assert.equal(validation.prevented,true);assert.equal(f.node('error').textContent,'请填写统一售价');
  fillEditor(f);f.node('sku-name-1').value=f.node('sku-name-0').value;
  assert.throws(()=>f.run('productPayload()'),/规格名称不能重复/);
});
test('图片排序同时更新封面，拖拽和按钮使用相同顺序，不立即写库',async()=>{
  const f=fixture();await f.run("show('products')");f.run("editor('toy');chooseStudioImage('product','/assets/bowl-v3.jpg');chooseStudioImage('product','/assets/care-v2.jpg')");
  f.run('movePhoto(2,0)');assert.equal(f.run('editing.image'),'/assets/toy-v2.jpg');
  f.run("dropPhoto({preventDefault(){},dataTransfer:{getData:()=> '2'}},1)");
  assert.equal(f.run("editing.images.join()"),'/assets/toy-v2.jpg,/assets/bowl-v3.jpg,/assets/care-v2.jpg');
  f.run("dropPhoto({preventDefault(){},dataTransfer:{getData:()=> ''}},0);movePhoto(-1,0)");
  assert.equal(f.run('editing.images.length'),3);
  f.run('removePhoto(0)');assert.equal(f.run('editing.image'),'/assets/bowl-v3.jpg');
  assert.equal(f.run('modalDirty'),true);
  assert.equal(f.calls.filter(c=>c.action==='saveProduct').length,0);
});
test('保存失败保留表单与修改提醒，图片上传中阻止保存',async()=>{
  let fail=true;
  const f=fixture(body=>{if(body.action==='saveProduct'&&fail)throw Error('网络暂时不可用');});
  await f.run("show('products')");f.run("editor('toy')");fillEditor(f,{pname:'保留的名称'});f.run('markDirty()');
  await assert.rejects(f.run('saveProduct({preventDefault(){}})'),/网络暂时不可用/);
  assert.equal(f.node('modal').open,true);assert.equal(f.node('pname').value,'保留的名称');
  assert.equal(f.node('product-fields').disabled,false);assert.equal(f.run('modalDirty'),true);
  f.run('pendingUploads=1');
  await assert.rejects(f.run('saveProduct({preventDefault(){}})'),/图片正在上传/);
  f.run('pendingUploads=0');fail=false;
  await f.run('saveProduct({preventDefault(){}})');
  assert.equal(f.run('modalDirty'),false);assert.match(f.node('notice').textContent,/已保存「保留的名称」/);
});
test('商家保存多规格商品后买家可选规格下单，商家外送后买家确认收货',async()=>{
  const f=fixture();await f.run("show('products')");f.run("editor(null,'living')");fillEditor(f,{pname:'流程验收食碗'});
  f.run('addEditorSku()');fillEditor(f,{pname:'流程验收食碗'});
  f.node('sku-name-0').value='小号';f.node('sku-price-0').value='19.90';f.node('sku-stock-0').value='5';
  f.node('sku-name-1').value='大号';f.node('sku-price-1').value='29.90';f.node('sku-stock-1').value='8';f.node('active').checked=true;
  await f.run('saveProduct({preventDefault(){}})');
  const product=f.buyer('catalog',{}).find(p=>p.name==='流程验收食碗');
  assert.equal(product.skus[1].price,2990);
  const address=f.buyer('saveAddress',{name:'测试收件人',phone:'13800000000',detail:'模拟市测试街道 1 号'});
  const order=f.buyer('createOrder',{key:'merchant-flow',fulfillment:'DELIVERY',addressId:address.id,lines:[{productId:product.id,skuId:product.skus[1].id,qty:2}]});
  f.buyer('mockPay',{id:order.id});await f.run("viewOrder('"+order.id+"')");
  f.node('number').value='SIM-DELIVERY-01';f.node('delivery-note').value='模拟店员配送';
  await f.run('ship()');
  assert.equal(f.buyer('order',{id:order.id}).status,'SHIPPED');
  f.buyer('confirmReceipt',{id:order.id});
  assert.equal(f.buyer('order',{id:order.id}).status,'COMPLETED');
  assert.equal(f.buyer('catalog',{}).find(p=>p.id===product.id).skus[1].stock,6);
});
function fillSettings(f){
  const s=f.run('shopConfig');
  for(const [id,value] of Object.entries({name:s.store.name,detail:s.store.detail,phone:s.store.phone,open:s.hours.open,close:s.hours.close,'pickup-note':s.pickup.instructions,fee:(s.delivery.fee/100).toFixed(2),minimum:'0.00',free:'',estimate:String(s.delivery.estimateMinutes),area:s.delivery.area,'delivery-note':s.delivery.instructions}))f.node('setting-'+id).value=value;
  for(const [id,value] of Object.entries({accept:s.acceptingOrders,allday:s.hours.allDay,enforce:s.hours.enforce,pickup:s.pickup.enabled,delivery:s.delivery.enabled}))f.node('setting-'+id).checked=value;
  for(let i=1;i<=7;i++)f.node('setting-day-'+i).checked=s.hours.days.includes(i);
}

test('订单详情仅在待付款状态提示自动关闭，付款后不再显示',async()=>{
 const f=fixture();const order=f.buyer('createOrder',{key:'payment-caption',fulfillment:'PICKUP',contact:{name:'模拟',phone:'13800000000'},lines:[{productId:'toy',skuId:'toy-1',qty:1}]});
 await f.run("viewOrder('"+order.id+"')");assert.match(f.node('modal').innerHTML,/未付款订单 15 分钟自动关闭/);
 f.buyer('mockPay',{id:order.id});await f.run("viewOrder('"+order.id+"')");assert.doesNotMatch(f.node('modal').innerHTML,/未付款订单 15 分钟自动关闭/);
});

test('全天营业停用时段输入，切回定时营业保留原时段',async()=>{
 const f=fixture();await f.run("show('settings')");f.run('editShopSettings()');fillSettings(f);
 f.node('setting-open').value='09:30';f.node('setting-close').value='21:00';f.node('setting-allday').checked=true;f.run('syncSettingsHours()');
 assert.equal(f.node('setting-open').disabled,true);assert.equal(f.node('setting-close').disabled,true);
 f.node('setting-allday').checked=false;f.run('syncSettingsHours()');assert.equal(f.node('setting-open').disabled,false);
 assert.equal(f.run('settingsPayload()').hours.open,'09:30');assert.equal(f.run('settingsPayload()').hours.close,'21:00');
});

test('商家旧编辑页遭遇下单后保存，提示冲突并保留草稿，库存不回升',async()=>{
 const f=fixture();await f.run("show('products')");f.run("editor('food')");fillEditor(f,{pname:'保留的编辑名称'});
 f.buyer('createOrder',{key:'editing-inventory',fulfillment:'PICKUP',contact:{name:'模拟',phone:'13800000000'},lines:[{productId:'food',skuId:'food-1',qty:1}]});
 await assert.rejects(f.run('saveProduct({preventDefault(){}})'),/商品或库存已变化/);
 assert.equal(f.node('pname').value,'保留的编辑名称');assert.equal(f.node('modal').open,true);
 assert.equal(f.node('save-product').disabled,false);assert.equal(f.state().products[0].skus[0].stock,19);
 assert.equal(f.calls.filter(c=>c.action==='saveProduct').at(-1).input.revision,0);
});
test('经营设置表单校验、失败保留草稿，成功后买家可读相同费用与地址',async()=>{
  let fail=true;const f=fixture(body=>{if(body.action==='saveShopSettings'&&fail)throw Error('网络暂时不可用');});
  await f.run("show('settings')");assert.match(f.node('app').innerHTML,/门店经营设置/);f.run('editShopSettings()');fillSettings(f);
  f.node('setting-name').value='测试门店';f.node('setting-fee').value='6.50';f.run('markDirty()');
  await assert.rejects(f.run('saveShopSettings({preventDefault(){}})'),/网络暂时不可用/);
  assert.equal(f.node('modal').open,true);assert.equal(f.node('setting-name').value,'测试门店');assert.equal(f.node('settings-fields').disabled,false);
  f.node('setting-fee').value='-1';assert.throws(()=>f.run('settingsPayload()'),/金额须为/);
  f.node('setting-fee').value='6.50';fail=false;await f.run('saveShopSettings({preventDefault(){}})');
  assert.equal(f.node('modal').open,false);assert.match(f.node('notice').textContent,/经营设置已保存/);assert.equal(f.buyer('shopSettings',{}).delivery.fee,650);assert.equal(f.buyer('shopSettings',{}).store.name,'测试门店');
});
