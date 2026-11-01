# 界面组件与参考

小程序使用 `tdesign-miniprogram` 1.9.5：订单中心采用 tabs、empty、button、loading；个人中心采用 cell、cell-group、icon。主题适配商家橙色标识，业务接口、身份验证和支付接入沿用本项目。

安装：`npm ci --prefix miniprogram`。在微信开发者工具中执行「工具 → 构建 npm」，再编译。

参考项目：

- [Tencent/tdesign-miniprogram-starter-retail](https://github.com/Tencent/tdesign-miniprogram-starter-retail)，参考版本 `7b94edbf9892d3a2856b0f1387c3bf3b1d47c768`，MIT。许可证见 TDesign-retail-LICENSE。采用订单筛选、卡片层级、空状态及独立订单页面的组织方式。
- [EastWorld/wechat-app-mall](https://github.com/EastWorld/wechat-app-mall)，参考版本 `5521ebf8bfa792903379e4d81b473a19da5b30c8`，Apache-2.0。本轮仅研究交互，没有复制其业务代码。参考地址选择与编辑分离、售后记录与申请分离。该项目的 API 工厂接口、Vant 组件及营销功能未引入。

普通体验入口应设置为 `pages/shop/index`。订单中心入口为 `pages/orders/index`；审核订单入口和体验二维码入口分别配置。已经编码为订单中心路径的二维码仍会进入订单中心，页面为这种情况提供返回个人中心与首页入口。
