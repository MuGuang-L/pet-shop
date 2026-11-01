# 图片与界面素材

当前界面使用门店标识、项目自制图标及 AI 生成的宠物与商品示意图。AI 图不是商品实拍，不应据此承诺实际包装、成分或品质；正式经营的商品资料应由商家核实。

图片原稿保存在 `source-assets/`，小程序发布图片位于 `miniprogram/assets/`。执行 `node scripts/optimize-miniapp-assets.js` 从 PNG 原稿生成压缩 JPEG：横幅最大宽度 960px，其余 640px，保持比例且不放大。脚本保留原稿，不覆盖门店标识。

历史插画脚本和 legacy 样本仅供回归，不能作为当前页面设计说明。小程序 TDesign 组件与商家界面参考见 [组件与参考](docs/third-party/README.md)，依赖与许可证见 [第三方说明](THIRD_PARTY_NOTICES.md)。
