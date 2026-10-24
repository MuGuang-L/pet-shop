# EastWorld/wechat-app-mall 兼容性审查

审查日期：2026-10-24。已实际浅克隆并阅读源码，固定提交 `5521ebf8bfa792903379e4d81b473a19da5b30c8`。审查副本放在 `.local/upstream-wechat-app-mall`，不打包进小程序，不执行上游安装或启动脚本。

## 结论

现有界面和素材继续保留。技术上同为微信原生小程序，可以按模块移植，但不是换数据库地址即可兼容。上游主代码是 api工厂服务的客户端，仓库内没有可直接启动的 MongoDB 商城后端。当前项目未复制其代码、页面或素材，不宣称是上游 fork。

| 模块与实际源码 | 结论 | 适配工作 |
| --- | --- | --- |
| 首页/分类/搜索及商品多图布局 | 可借鉴，也可逐页改接接口 | 保留我们现有品牌风格；重做数据绑定和导航 |
| `components/date-time-selecter` | 相对独立、可选复用 | JS 依赖 dayjs，WXML 使用 van-popup/van-sidebar 等；需要 Vant 注册、样式适配，处理 maxDays 为零和当天无时段等边界。我们目前无预约需求，暂不引入 |
| `utils/tools.wxs` | 简单显示工具可替换 | 上游 tofix2 直接对数值调用 toFixed；我们金额使用整数分，不能直接照搬显示语义 |
| `utils/image.js` | 不建议直接复制 | 依赖异步 getSystemInfo 后立即返回对象；当前图片布局使用 aspectFill / aspectFit 更直接 |
| `pages/goods-details`、`components/goods-pop` | 可以适配，不能直接插入 | goodsDetailV2 / goodsPriceV2 / shippingCarInfoAddItem 等绑定 WXAPI、登录 token 和上游 SKU 结构；还包含砍价/拼团等分支 |
| `pages/to-pay-order` | 需要重接整个结算接口 | shippingCarInfo、defaultAddress、orderCreate、orderPay 等来自 api工厂；优惠、余额、自提等需明确保留哪些业务 |
| `pages/order-list` | 可以参考交互，状态需显式映射 | 上游数字状态 0/1/2/3 与当前 PENDING/PAID/SHIPPED/COMPLETED 不同，退款不能仅按数字对照 |
| `utils/auth.js`、`app.js` | 无法代替本项目身份服务 | wx.login 换 api工厂 token；subDomain/merchantId 配置绑定服务端租户。当前纯模拟走本地预设身份 |
| `utils/pay.js`、`components/payment` | 不能替代支付后端 | 调用 api工厂预支付再 wx.requestPayment，不含我们 MongoDB 服务端的验签、回调、对账实现 |
| 会员、积分、优惠券、直播、分销 | 暂不整包引入 | 多数依赖外部服务规则和配置。按实际经营需求逐项做，避免出现无后端支持的按钮 |
| `@vant/weapp` / `mp-html` 等独立库 | 后续有需求可单独接入 | 核查对应包版本和许可证；不必为了使用组件库迁移整个商城 |

## 主要接口差异

- 上游通常 `{code: 0, data: ...}`，当前 `{ok: true, data: ...}`。
- 上游商品详情使用 `basicInfo / pics / properties`，当前 `id / skus[] / image / description`。
- 上游通过 WXAPI token 标识用户；当前本地模拟身份将来需替换为自己的服务端会话。
- 当前金额是整数分，不直接将上游展示金额作为服务端结算价格。
- api工厂提供的后台和服务端能力不会因为拷贝小程序源码自动获得。

## 选择的实施路线

保持当前前端及领域规则，新增 MongoDB 持久化适配与本地 HTTP 模式。优先补全多图、规格、发货/售后、运营检索等有实际价值的能力。需要移植上游模块时，针对该模块写字段转换与交互测试，不实现一个冒充完整 apifm-wxapi 的空壳。

## 许可与来源记录

固定提交的 LICENSE 是 Apache-2.0，README 徽标写 MIT，package.json 写 ISC，声明存在不一致。当前没有将上游代码纳入交付包；未来复用具体文件时需核实适用声明、保留版权/许可证及修改说明。第三方组件各自核查，不把仓库许可推定到全部素材。

源码链接：
- https://github.com/EastWorld/wechat-app-mall/tree/5521ebf8bfa792903379e4d81b473a19da5b30c8
- https://github.com/EastWorld/wechat-app-mall/blob/5521ebf8bfa792903379e4d81b473a19da5b30c8/pages/goods-details/index.js
- https://github.com/EastWorld/wechat-app-mall/blob/5521ebf8bfa792903379e4d81b473a19da5b30c8/utils/pay.js
