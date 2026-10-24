const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Studio = require('../cloudfunctions/shop/studio');
const domain = require('../cloudfunctions/shop/domain');
const source = fs.readFileSync(require.resolve('../apps/merchant-web/app.js'), 'utf8').replace(/boot\(\);\s*$/, '');

function fixture(intercept) {
  let state = domain.seed();
  const nodes = {}, calls = [];
  const node = id => nodes[id] ||= {
    innerHTML: '', textContent: '', value: '', checked: false, style: {}, attrs: {}, open: false,
    setAttribute(k, v) { this.attrs[k] = v; }, showModal() { this.open = true; },
    close() { this.open = false; }, querySelector() { return null; }, appendChild() {}
  };
  const context = vm.createContext({
    Studio, console, document: { getElementById: node, querySelectorAll: () => [], createElement: () => ({ style: {} }) },
    window: { addEventListener() {} }, confirm: () => true,
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
  return { run: code => vm.runInContext(code, context), node, calls, state: () => state };
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
  const f = fixture(body => body.action === 'merchantOrdersPage' ? gate : undefined);
  const orders = f.run("show('orders')");
  await f.run("show('products')");
  const products = f.node('app').innerHTML;
  release();
  await orders;
  assert.equal(f.node('section-title').textContent, '商品管理');
  assert.equal(f.node('app').innerHTML, products);
  assert.equal(f.node('app').attrs['aria-busy'], 'false');
});

test('退出页面使在途请求失效，不重新显示经营数据', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture(body => body.action === 'merchantOrdersPage' ? gate : undefined);
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
  assert.match(f.node('app').innerHTML, /小店的好物/);
  assert.equal(f.node('error').style.display, 'none');
});

test('订单筛选保留服务侧契约，重置回到全部订单第一页', async () => {
  const f = fixture();
  await f.run("orderSearch='绳结';orderStatus='PAID';fulfillmentFilter='PICKUP';orderPageNumber=3;show('orders')");
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
