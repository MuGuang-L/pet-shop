# 界面组件与参考

小程序使用 `tdesign-miniprogram` 1.9.5：订单中心采用 tabs、empty、button、loading；个人中心采用 cell、cell-group、icon。主题适配商家橙色标识，业务接口、身份验证和支付接入沿用本项目。

安装：`npm ci --prefix miniprogram`。在微信开发者工具中执行「工具 → 构建 npm」，再编译。

参考项目：

- [Tencent/tdesign-miniprogram-starter-retail](https://github.com/Tencent/tdesign-miniprogram-starter-retail)，参考版本 `7b94edbf9892d3a2856b0f1387c3bf3b1d47c768`，MIT。许可证见 TDesign-retail-LICENSE。采用订单筛选、卡片层级、空状态及独立订单页面的组织方式。
- [EastWorld/wechat-app-mall](https://github.com/EastWorld/wechat-app-mall)，参考版本 `5521ebf8bfa792903379e4d81b473a19da5b30c8`，Apache-2.0。本轮仅研究交互，没有复制其业务代码。参考地址选择与编辑分离、售后记录与申请分离。该项目的 API 工厂接口、Vant 组件及营销功能未引入。

普通体验入口应设置为 `pages/shop/index`。订单中心入口为 `pages/orders/index`；审核订单入口和体验二维码入口分别配置。已经编码为订单中心路径的二维码仍会进入订单中心，页面为这种情况提供返回个人中心与首页入口。

## 商家 Web

商家 Web 保留原生 JavaScript 和现有 API。本轮按 TDesign Starter 的中性工作区、表单分区与列表层级调整样式；参考 [mall-admin-web](https://github.com/macrozheng/mall-admin-web) 的订单筛选和表格布局（参考提交 `81fc17e5a19f452bd854b106a9d59fa1ed5c7eac`，Apache-2.0）。未复制其业务代码或引入 Vue、Element Plus、支付 SDK。

订单改为商品、履约方式、金额、状态、操作五列；无异常订单的履约问题表单默认收起。经营设置四个分区提供直接编辑入口。颜色、字号、间距、弹窗关闭与保存操作统一。

验收：在独立 MySQL 库与未配置真实支付的本地服务中，通过浏览器完成登录、新增商品草稿、外送登记、自提备货及核销、外送设置保存；验证订单状态和保存反馈。生产数据与支付配置未修改。此记录不代表已部署到云端。
