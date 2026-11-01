# 微信支付 API v3 直连接入

后端可以继续运行在微信云托管。`WECHAT_PAY_MODE=direct` 时，新交易由后端直接访问微信支付普通商户 API v3，不经过云托管 `/_/pay` 接口。小程序侧仍使用现有身份和支付接口，服务端返回 RSA 收银台参数。

默认模式仍是 `cloud`。合并或部署代码不会自动切换支付方式；没有真实扣款验收前，不应宣称支付已上线。

## 服务侧配置

通过云端环境变量或挂载密钥文件配置，禁止把真实值放入源码、镜像、README 或小程序侧。

| 配置 | 内容 |
| --- | --- |
| `WECHAT_PAY_MODE` | `direct`，省略时为 `cloud` |
| `WECHAT_APPID` | 正式小程序 AppID，不能使用公众号 AppID |
| `WECHAT_MCH_ID` | 已与小程序绑定且开通支付产品的商户号 |
| `WECHAT_MCH_SERIAL` | 商户 API 证书序列号 |
| `WECHAT_MCH_PRIVATE_KEY` | 商户 API 私钥 PEM；或用 `WECHAT_MCH_PRIVATE_KEY_PATH` 指向挂载文件 |
| `WECHAT_API_V3_KEY` | 商户后台设置的 32 字节 APIv3 密钥 |
| `WECHAT_PAY_PUBLIC_KEY_ID` | 微信支付公钥 ID，`PUB_KEY_ID_` 开头 |
| `WECHAT_PAY_PUBLIC_KEY` | 对应的微信支付公钥 PEM；或用 `WECHAT_PAY_PUBLIC_KEY_PATH` |
| `PUBLIC_ORIGIN` | 稳定的 HTTPS 业务域名，不含路径或结尾斜杠 |

私钥是商户 API 证书私钥，不是小程序代码上传密钥。PEM 环境变量应保存完整多行文本。此实现使用指定的微信支付公钥验证应答和通知，不自动下载或信任未知公钥。密钥轮换需同步部署。

配置缺失时支付关闭，不自动退回模拟支付。`wechatPay: true` 只代表本地配置校验通过，不代表商户权限或实际收款成功。

## 通知地址

- 支付：`PUBLIC_ORIGIN` 加 `/wechat/pay/v3/notify`
- 退款：`PUBLIC_ORIGIN` 加 `/wechat/refund/v3/notify`

必须允许微信支付服务器直接发送 POST，不要求登录、验证码、确认访问页面或浏览器 Cookie。生产环境使用稳定域名；测试默认域名是否支持该 POST 通路必须单独验证。业务请求仍保持原有鉴权。

先验签和校验公钥 ID、时间戳，再用 APIv3 密钥解密。随后查单核对应用、商户、交易、金额及币种，沿用既有的幂等结算和库存机制。退款受理或 PROCESSING 不等于退款成功。验证或落库失败返回失败应答，依靠微信通知重试和持久化补查恢复。

## 通道切换

新交易持久化 `transport`。已有交易继续使用创建时的通道；旧记录未写该字段时按 `cloud` 处理。不为同一订单另建交易号，不把旧云托管交易直接改成直连交易。

测试直连必须创建新的业务订单。切换后，旧云托管交易仍可能受原授权问题影响，需要单独核查，不能删除支付记录来解除阻塞。回退默认模式到 `cloud` 后，已有直连交易仍需要保留 API v3 配置才能补查和退款。

## 验证及发布

1. 本地核验证书有效期、商户号、序列号及私钥配对，确认公钥 ID 与公钥对应。
2. 配置上述服务侧变量后，可运行 `node scripts/verify-wechat-v3.js`。它只查询随机生成的不存在订单，不创建订单、不扣款、不退款。预期返回经验签的 `404 / ORDER_NOT_EXIST`，仅证明请求认证与响应验签成功，不能证明小程序支付权限、AppID 绑定或通知解密成功。
3. 发布最新联调分支的代码，并确认所有接流量版本支持直连及通道字段。旧版本不能与直连新版本长期混跑。
4. 验证通知地址可从公网直达，确认真实业务域名、配置和备份，才开启 `WECHAT_PAY_MODE=direct`。
5. 真机验收新订单的收银台、实际到账、通知落库、重复通知、退款到账。真实付款由授权人员完成。

2026-10-31 发布前本地只读验证：商户证书与私钥匹配，序列号匹配且证书有效；微信支付查单返回 `404 / ORDER_NOT_EXIST`，指定公钥响应验签通过。当时尚未向云端注入密钥或切换支付模式。

### 2026-11-01 部署后核验

- 用户已完成云端发布。实测 `/live`、`/health` 返回 200，MySQL 连通，商家登录和商品、订单读取正常。
- 两个 API v3 通知地址已从 404 变为拒绝无签名请求的 `500 / FAIL`。这证明路由可达并拒绝无效通知，不等于真实通知验签、解密和结算已验收。
- 本地商户签名只读查单再次返回经验签的 `404 / ORDER_NOT_EXIST`。
- 使用正式小程序身份调用微信查询接口，`is_trade_managed` 返回 `true`，`is_trade_management_confirmation_completed` 返回 `completed: true`；发货信息管理开通和交易结算确认已完成。
- `get_order_detail_path` 返回成功，但 `path` 为空，尚未配置购物订单详情跳转路径。
- 本次真机体验版截图仍显示 `requestPayment:fail jsapi has no permission`，详情为 `jsapi has been banned`。此前账号通知要求接入购物订单，并说明已配置“订单管理—订单信息录入”可忽略通知。应继续核对该账号的接入配置和平台限制，不能仅凭类目申请弹窗认定唯一原因，也不能把以上两项已开通能力与购物订单详情配置混为一谈。
- 小程序侧移除了商品详情操作区的 `position: fixed` 覆盖和对应额外底部留白，保留原有布局规则；此前真机验收反馈购买按钮不可见，修正后已能继续下单并到达支付调用。

仍待完成：有效的订单详情跳转及商户交易号映射、微信要求的订单/发货同步、真实支付与退款闭环验收。APIv3 密钥尚未通过真实加密通知验证。本次接口排查未发起扣款或退款；不能将当前状态标记为支付上线验收通过。

权限报错排查依据：[微信支付小程序常见问题](https://pay.wechatpay.cn/doc/v3/merchant/4012791910)。能力和路径接口依据：[小程序发货信息管理服务](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/order-shipping/order-shipping.html)、[小程序购物订单](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/order_center/order_center.html)。

官方依据：[小程序下单](https://pay.wechatpay.cn/doc/v3/merchant/4012791897)、[商户订单号查单](https://pay.wechatpay.cn/doc/v3/merchant/4012791900)、[签名验签](https://pay.wechatpay.cn/doc/v3/merchant/4012365342)、[退款通知](https://pay.wechatpay.cn/doc/v3/merchant/4012791906)。


### 订单信息录入适配

订单管理的详情路径使用下列完整值（保留占位符，不替换成某个订单号）：

```text
pages/shop/index?out_trade_no=${商品订单号}
```

微信替换的值是支付接口的 `out_trade_no`，不是商城内部的订单 ID。服务侧新增只读 `orderByTradeNo` 动作，通过已持久化的支付交易记录定位订单；同时验证登录买家和订单归属。查询不会发起支付、查单或退款，不向小程序返回预支付参数、签名或完整交易记录。支付停用后，历史订单仍可以查看，无需改数据库表。

小程序侧处理冷启动和热启动入口，必要时先登录再打开订单详情；网络失败保留跳转信息供重试。订单链接无效或不属于当前账号时给出提示，不自动下单或拉起收银台。普通订单列表和原下单流程保持兼容。

发布顺序：

1. 发布包含 `orderByTradeNo` 的服务侧代码，保留现有数据库和支付环境变量。
2. 上传本次小程序侧代码，更新体验版；通过微信订单入口检查本人订单能正确打开。
3. 在微信公众平台选择正式小程序，进入「支付与交易 → 订单管理 → 订单信息录入」。如显示接入协议，由账号负责人确认后接入，再配置上述详情路径。也可使用官方 `update_order_detail_path` 接口配置；该接口要求事先签署订单中心授权协议，错误 `10060034` 表示需核对协议。
4. 按账号通知完成必要的代码提审或平台审核，再用真机尝试调起收银台，停在付款确认前。只有真机验证后才能判定权限已恢复；不能仅以路径保存成功宣称解封。

以上为订单入口修复阶段的发布步骤。用户后续已发布云托管并上传小程序，但本轮未通过平台订单入口复核交易号映射，支付权限解除仍待验证。发货信息同步和真实资金闭环仍需另外验收。

依据：[微信小程序购物订单官方文档](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/order_center/order_center.html) 明确约定详情路径占位符和交易号含义；[微信支付官方常见问题](https://pay.wechatpay.cn/doc/v3/merchant/4012791910) 要求针对 `banned/no permission` 核对交易规范、发货管理及站内通知。[思迅同类故障记录](https://service.sixun.com.cn/KB/KBShareDetail.aspx?Faq_no=J202531200001) 出现相同订单管理接入通知，处理包含订单信息录入和版本审核；其中第三方收单账户、解绑商户等步骤属于该厂商方案，不适用于本项目，不能照搬。
