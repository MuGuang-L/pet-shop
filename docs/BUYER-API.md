# 小程序侧 API v1（模拟联调）

联调地址：`https://petshop-dev19732.nat100.top`。2026-10-24 已验证 HTTPS 健康检查、登录、商品读取、匿名请求返回 401、越权请求返回 403。不同网络和微信真机环境需单独验证。

所有接口与静态图片使用同一个 `apiBase`，不带末尾 `/api`。日期为毫秒时间戳，金额为整数分，ID 视为不透明字符串。

## 登录

`POST /auth/login`，JSON：

```json
{"username":"friend","password":"单独提供的测试密码"}
```

成功：`{"ok":true,"data":{"token":"...","identity":{"id":"friend-buyer","merchant":false,"username":"friend"},"expiresIn":28800}}`。

之后每个请求带 `Authorization: Bearer <token>`，包括退出 `POST /auth/logout`、身份检查 `POST /auth/me`。密码和令牌不得放 URL、日志、代码仓库。账号密码单独发送。

## 业务请求

`POST /api`，`Content-Type: application/json`：

```json
{"action":"catalog","input":{}}
```

成功 `{"ok":true,"data":...}`；失败 `{"ok":false,"error":"..."}`。401 重新登录；403 权限不足；429 登录尝试过多；400 参数或业务状态错误。服务端忽略客户端的 role、merchant 和 userId。

| action | input | 返回内容 |
| --- | --- | --- |
| catalog | {} | 上架商品数组，id/name/category/description/image/images/skus；SKU 为 id/name/price/stock |
| storefront | {} | hero/cat/dog/empty/avatar 等图片槽位 |
| homeContent | {} | headline/subtitle/featuredTitle/featuredIntro/newTitle/scenes |
| identity | {} | 当前用户身份 |
| shopSettings | {} | 门店信息、营业时间、自提与外送开关和费用、版本号 |
| quoteOrder | {fulfillment,lines} | 服务端报价、settingsRevision、pickupStore；不创建订单、不占库存 |
| addresses | {} | 当前买家地址数组 |
| saveAddress | {id?,name,phone,detail} | 新地址或修改结果；11 位手机号，详细地址 5～200 字 |
| deleteAddress | {id} | true |
| createOrder | 见下方 | 完整订单 |
| ordersPage | {page:1,pageSize:10,q:"",status:"ALL",fulfillment:"ALL"} | {items,page,pageSize,total,pages,paidCount} |
| order | {id} | 本人订单详情 |
| cancel | {id} | 取消未付款订单并释放库存 |
| mockPay | {id} | 模拟付款，不产生真实资金 |
| confirmReceipt | {id} | 外送已送出订单确认收货 |
| tracking | {id} | 商家登记的单号、备注和事件；不是真实轨迹 |
| refundRequest | {id,type,reason} | 创建整单售后，type=REFUND_ONLY 或 RETURN_REFUND |
| refundWithdraw | {id,caseId} | 撤回待审核售后 |
| returnShip | {id,caseId,company,number} | 提交退货运单 |

### 下单

外送：

```json
{"action":"createOrder","input":{"key":"每次下单唯一且重试不变的8到80位键","fulfillment":"DELIVERY","addressId":"a1","lines":[{"productId":"toy","skuId":"toy-1","qty":1}]}}
```

自提不用 addressId，改传：`"fulfillment":"PICKUP","contact":{"name":"模拟提货人","phone":"13800000000"}`。

服务端计算价格与配送费，勿传可信金额。自提免配送费；外送默认演示费 800 分，实际规则读取 `shopSettings`，提交前使用 `quoteOrder` 核对。`createOrder` 可附加报价中的 `settingsRevision` 与 `expectedTotal`，发生变化时拒绝创建并提示刷新。`key` 仅限字母、数字、横线、下划线，示例中文说明不能直接当 key。

经营设置字段、快照与兼容说明见 [门店经营设置](SHOP-SETTINGS.md)。新增接口不会要求旧请求增加必填字段；实际费用和开放方式由服务端决定。小程序侧应接入动态读取后再调整门店经营规则，避免继续显示写死的地址和费用。

### 订单和状态

订单主要字段：`id,userId,lines,address,subtotal,shippingFee,total,status,fulfillment,shipping,refund,refundHistory,createdAt,updatedAt,expiresAt`。

- `PENDING` 待付款，15 分钟后过期；`PAID` 备货中。
- 自提 `fulfillment={type:"PICKUP",store:{name,detail,hours,phone},code,readyAt?,redeemedAt?}`。PAID 且有 readyAt 表示可到店自提；商家核销后 COMPLETED。买家不能核销。
- 外送 `fulfillment.type="DELIVERY"`；历史订单缺省视为外送。商家送出后 SHIPPED，`shipping={company:"商家自行配送",number,note,at}`。不要求买家或商家选择快递公司。
- `COMPLETED` 完成；`CANCELLED` 取消；`EXPIRED` 超时。
- 售后 `REFUND_REQUESTED/REFUNDING/REFUNDED`；详细阶段看 `refund.stage`，取值 REQUESTED、REJECTED、WITHDRAWN、WAIT_RETURN、RETURN_TRANSIT、WAIT_REFUND、REFUND_FAILED、SUCCEEDED。
- 每次重新申请都有新 `refund.caseId`。撤回和退货物流必须传当前 caseId，拒绝旧页面覆盖新售后。
- 仅未发货（含待自提）申请仅退款；已发货可申请退货退款或仅退款。当前整单退款含原配送费。
- ordersPage 的 fulfillment：ALL/PICKUP/DELIVERY；status 可用上述状态及 ALL/AFTERSALE；pageSize 最大 50，q 最大 80 字。

图片 `/assets/...` 或 `/uploads/...` 是相对 API 域名路径，现有 services/api.js 自动转换。商家上传只开放给商家网页，买家账号不能上传商品图片。

商家维护的接口包括 merchantProducts/merchantOrdersPage/saveProduct/saveStorefront/saveHomeContent/ship/pickupReady/pickupRedeem/refundReview/returnInspect/refundFail/mockRefund；买家调用会返回 403。
