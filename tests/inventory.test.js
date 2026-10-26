'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {seed,execute}=require('../cloudfunctions/shop/domain'),{authorize}=require('../server/auth');
const owner={id:'merchant',merchant:true},buyer={id:'buyer'};
const input={productId:'food',skuId:'food-1',revision:0,type:'RECEIVE',quantity:5,reason:'采购到货 JH1026',requestKey:'inventory-001'};
function fixture(){let state=seed();return {get state(){return state;},call(action,input={},actor=owner){const out=execute(state,actor,action,input,{mock:true,now:1000});state=out.state;return out.result;}};}
test('库存：进货、可售盘点、报损留痕；零差异盘点仍有记录',()=>{
 const f=fixture();let row=f.call('adjustStock',input);assert.deepEqual([row.before,row.delta,row.after],[20,5,25]);
 row=f.call('adjustStock',{...input,type:'COUNT',quantity:22,revision:1,requestKey:'inventory-002'});assert.deepEqual([row.before,row.delta,row.after],[25,-3,22]);
 row=f.call('adjustStock',{...input,type:'LOSS',quantity:2,revision:2,requestKey:'inventory-003'});assert.deepEqual([row.before,row.delta,row.after],[22,-2,20]);
 row=f.call('adjustStock',{...input,type:'COUNT',quantity:20,revision:3,requestKey:'inventory-004'});assert.equal(row.delta,0);
 assert.equal(f.state.stockMovements.length,4);assert.equal(f.state.products[0].revision,4);
 assert.ok(f.state.stockMovements.every(r=>r.actor==='merchant'&&r.reason===input.reason));
});
test('库存：权限、错误数量、超量报损与容量校验均不改变数据',()=>{
 const f=fixture(),before=structuredClone(f.state);
 for(const action of ['adjustStock','stockHistory']){assert.throws(()=>authorize(buyer,action),/FORBIDDEN/);assert.throws(()=>f.call(action,input,buyer),/FORBIDDEN/);assert.doesNotThrow(()=>authorize(owner,action));}
 for(const change of [{quantity:0},{quantity:-1},{quantity:0.5},{quantity:'3'},{quantity:100001},{reason:' '},{reason:'x'.repeat(201)},{type:'BAD'},{requestKey:'bad'},{type:'LOSS',quantity:21},{quantity:99981}])assert.throws(()=>f.call('adjustStock',{...input,...change}));
 assert.deepEqual(f.state,before);
});
test('库存：下单后旧版本盘点被拒绝，预留取消释放仍受容量保护',()=>{
 const f=fixture(),o=f.call('createOrder',{key:'inventory-order',fulfillment:'PICKUP',contact:{name:'验收',phone:'13800000000'},lines:[{productId:'food',skuId:'food-1',qty:1}]},buyer);
 assert.throws(()=>f.call('adjustStock',{...input,type:'COUNT',quantity:20}),/PRODUCT_REVISION_CONFLICT/);
 assert.throws(()=>f.call('adjustStock',{...input,revision:1,type:'COUNT',quantity:100000}),/STOCK_CAPACITY_EXCEEDED/);
 f.call('adjustStock',{...input,revision:1,type:'COUNT',quantity:99999});f.call('cancel',{id:o.id},buyer);
 assert.equal(f.state.products[0].skus[0].stock,100000);
});
test('库存：提交结果丢失后原键重试只记一笔，修改参数不能重用键',()=>{
 const f=fixture(),a=f.call('adjustStock',input);assert.deepEqual(f.call('adjustStock',input),a);
 assert.throws(()=>f.call('adjustStock',{...input,quantity:8}),/STOCK_REQUEST_CONFLICT/);
 assert.throws(()=>f.call('adjustStock',input,buyer),/FORBIDDEN/);
 assert.equal(f.state.stockMovements.length,1);assert.equal(f.state.products[0].skus[0].stock,25);
});
test('库存：旧商品接口也留痕，改文案不伪造流水，分页兼容旧退货记录',()=>{
 const f=fixture();let p=f.call('merchantProducts')[0];p.skus[0].stock=23;f.call('saveProduct',p);
 assert.equal(f.state.stockMovements[0].type,'PRODUCT_EDIT');assert.equal(f.state.stockMovements[0].delta,3);
 p=f.call('merchantProducts')[0];f.call('saveProduct',{...p,name:'更新名称'});assert.equal(f.state.stockMovements.length,1);
 f.state.stockMovements.push({id:'old-return',type:'RETURN_INSPECTION',productId:'food',restockQty:2,at:2000});
 const page=f.call('stockHistory',{productId:'food',pageSize:1});assert.equal(page.total,2);assert.equal(page.items[0].delta,2);assert.equal(page.items[0].reason,'退货验收入库');assert.equal(f.call('stockHistory',{pageSize:1,page:999}).page,2);
 assert.equal(f.call('stockHistory',{type:'RECEIVE'}).total,0);assert.equal(f.call('stockHistory',{productId:'toy'}).total,0);
 for(const invalid of [{page:0},{pageSize:51},{type:'BAD'}])assert.throws(()=>f.call('stockHistory',invalid));
});

function client(storage,send){
 const nodes={};const node=id=>nodes[id]||=( {textContent:id==='operator'?'merchant':'',value:'',innerHTML:'',style:{},open:false,close(){this.open=false;},showModal(){this.open=true;},querySelector(){return null;},appendChild(){},addEventListener(){}} );
 const ctx=vm.createContext({Studio:require('../cloudfunctions/shop/studio'),sessionStorage:storage,crypto:{randomUUID:()=> 'fixed-unique-001'},document:{getElementById:node,querySelectorAll:()=>[],createElement:()=>({style:{}})},window:{addEventListener(){}}});
 vm.runInContext(fs.readFileSync('apps/merchant-web/app.js','utf8').replace(/boot\(\);\s*$/,''),ctx);
 ctx.send=send;vm.runInContext("inventoryAvailable=true;api=send;show=async()=>{};notifySaved=()=>{};",ctx);
 return {node,run:s=>vm.runInContext(s,ctx)};
}
test('商家库存：服务已提交但响应丢失，重开页面恢复原请求且只入库一次',async()=>{
 const f=fixture(),saved=new Map(),storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};let lost=true,writes=0;
 const send=async(action,arg)=>{const result=f.call(action,arg);if(action==='adjustStock'){writes++;if(lost){lost=false;throw Object.assign(Error('网络中断'),{retryable:true});}}return result;};
 let ui=client(storage,send);await ui.run("stockEditor('food')");
 for(const [key,value] of Object.entries({'stock-sku':'food-1','stock-type':'RECEIVE','stock-quantity':'5','stock-reason':'到货验收'}))ui.node(key).value=value;
 await ui.run('saveStock({preventDefault(){}})');assert.equal(f.state.products[0].skus[0].stock,25);assert.equal(saved.size,1);assert.equal(ui.node('stock-fields').disabled,true);
 ui=client(storage,send);await ui.run("stockEditor('food')");assert.equal(ui.run('stockDraft.pending.quantity'),5);
 await ui.run('saveStock({preventDefault(){}})');assert.equal(writes,2);assert.equal(f.state.products[0].skus[0].stock,25);assert.equal(f.state.stockMovements.length,1);assert.equal(saved.size,0);
});
test('商家库存：无法持久保存请求时不发送写入',async()=>{
 const f=fixture(),storage={getItem:()=>null,setItem(){throw Error('blocked');}};let writes=0;
 const ui=client(storage,async(a,p)=>{if(a==='adjustStock')writes++;return f.call(a,p);});await ui.run("stockEditor('food')");
 for(const [key,value] of Object.entries({'stock-sku':'food-1','stock-type':'RECEIVE','stock-quantity':'5','stock-reason':'到货验收'}))ui.node(key).value=value;
 await assert.rejects(ui.run('saveStock({preventDefault(){}})'),/会话存储/);assert.equal(writes,0);assert.equal(f.state.stockMovements.length,0);
});
