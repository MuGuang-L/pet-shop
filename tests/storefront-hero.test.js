const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const studio=require('../cloudfunctions/shop/studio'),domain=require('../cloudfunctions/shop/domain');
test('旧服务返回内置照片时，小程序仍显示本地新版插画，不依赖后端同步升级',async()=>{
 const previous='/assets/hero.png',expected='/assets/kigi-cafe-hero.jpg';
 for(const hero of [previous,'/assets/hero.jpg','/assets/hero-v2.jpg','/assets/hero-calm-v3.jpg','https://old.example.test/assets/hero-v2.jpg?version=1','https://old.example.test/assets/kigi-cafe-hero.jpg'])assert.equal(studio.resolveStorefront({hero}).hero,expected);
 const state=domain.seed();state.storefront={hero:previous};assert.equal(domain.execute(state,{id:'buyer'},'storefront').result.hero,expected);
 let page;const api={mode:'cloud',call:async action=>action==='identity'?{id:'buyer'}:action==='storefront'?{hero:previous}:domain.execute(state,{id:'buyer'},action).result};
 const wx={getStorageSync(){},setStorageSync(){},showToast(){}};
 vm.runInNewContext(fs.readFileSync('miniprogram/pages/shop/index.js','utf8'),{Page:p=>page=p,require:n=>n.includes('studio')?studio:n.includes('order-display')?require('../miniprogram/services/order-display'):api,wx});
 page.setData=function(values){Object.assign(this.data,values);};await page.refresh();
 assert.equal(page.data.loadError,'');assert.equal(page.data.storefront.hero,expected);assert.ok(fs.existsSync('miniprogram'+expected));
});
test('商家自行上传的横幅保留，其他图片槽位不变',()=>{
 for(const hero of ['/uploads/abc-123.jpg','cloud://my-environment/custom.jpg','https://images.example.test/custom-banner.jpg'])assert.equal(studio.resolveStorefront({hero,cat:'/uploads/cat.jpg'}).hero,hero);
 assert.equal(studio.resolveStorefront({hero:'/assets/hero.png',cat:'/uploads/cat.jpg'}).cat,'/uploads/cat.jpg');
});
