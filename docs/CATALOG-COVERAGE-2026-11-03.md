# 细分类商品准备与本地验证

本地清单 `source-assets/cozy/catalog-products.json` 包含 13 件商品，覆盖咖啡、烘焙，以及猫咪/狗狗的主粮、零食、玩具、清洁、用品共 12 个细类。原有 12 件商品沿用本轮读取时的名称、价格和库存；黄油可颂按用户授权定为 12 元/只、库存 20 只，使用新生成的独立可颂插画。用户改变为仅本地操作前，该可颂已经由商家接口保存至云端，ID 为 p50；此后停止云端操作。

清单是本地测试与复核材料，库存只是读取时的快照，不会在部署时覆盖数据库。上传小程序更新本地图片与页面，不会创建或重置云端商品。清单排除测试用的 0.01 元样例猫粮；本轮未操作它的云端上架状态。

检查命令：

```powershell
node scripts/catalog-coverage.cjs source-assets/cozy/catalog-products.json
node --test tests/catalog-coverage.test.js tests/catalog-products.test.js tests/catalog-preparation.test.js
```

逐商品测试在内存副本中完成，不连接云端，不扣真实库存，不进行微信付款：13 件商品全部验证自提闭环，10 件宠物用品另验证配送、发货和收货闭环；咖啡、烘焙验证拒绝快递配送。配图存在性、各细类上架/库存/图片覆盖也纳入测试。

插画原稿：`source-assets/cozy/croissant.png`；运行图：`miniprogram/assets/catalog-bakery.jpg`。生成提示词和工具记录见 `COZY-ILLUSTRATION-THEME.md`。运行资源维持瘦身尺寸，原稿和商品清单均不在小程序运行目录内。
