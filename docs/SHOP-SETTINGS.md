# 门店经营设置

商家 Web 的「经营设置」维护门店名称、地址、电话、每周营业日、营业时段、自提和商家外送规则。保存时进行权限和版本校验，并写入 MongoDB 与审计记录；无须迁移或清空既有数据。

## 生效范围

- 首次读取沿用演示默认值：每天 10:00—20:00、自提与外送均开启、外送费 800 分、不设起送门槛。默认允许营业时间外下单，保持既有模拟联调行为。
- 暂停接单或关闭履约方式，只阻止新订单。既有订单仍可付款、备货、自提核销、外送及售后。
- 新订单保存地址、营业时间说明、履约说明、设置版本及外送费用快照。之后修改设置不会回写旧订单。
- 营业时间按 Asia/Shanghai 计算，开始时刻可下单、结束时刻停止接单。支持每周营业日、单个同日时段或全天营业；暂不支持跨夜时段、节假日例外和预约时段。
- 外送起送金额和免外送费门槛均按商品小计计算。自提免费。外送范围是人工核对的文字说明，预计分钟数仅为说明，未接入地图测距、运力或实时轨迹。
- 配送单号和备注继续在订单履约页面填写，至少填写一项；不要求选择快递公司。

## 接口

沿用 `POST /api` 与 Bearer / Cookie 鉴权。新增接口，不删除或重命名旧接口字段。

`shopSettings`：买家和商家均可读，返回：

```json
{
  "revision": 0,
  "updatedAt": null,
  "store": {"name": "演示门店", "detail": "示例市测试路 1 号", "phone": "13800000000"},
  "acceptingOrders": true,
  "hours": {"days": [1,2,3,4,5,6,7], "open": "10:00", "close": "20:00", "allDay": false, "enforce": false},
  "pickup": {"enabled": true, "instructions": "备货完成后凭码提货"},
  "delivery": {"enabled": true, "fee": 800, "minimum": 0, "freeAbove": null, "area": "请联系门店确认外送范围", "estimateMinutes": 60, "instructions": "由商家安排配送"},
  "pickupStore": {"name": "演示门店", "detail": "示例市测试路 1 号", "phone": "13800000000", "hours": "每日 10:00—20:00"},
  "hoursText": "每日 10:00—20:00",
  "canOrder": true,
  "timeZone": "Asia/Shanghai"
}
```

`saveShopSettings`：仅商家可用。提交当前 `revision` 及完整 `store/acceptingOrders/hours/pickup/delivery`，返回保存后的设置，版本加一。派生字段无需提交。并发编辑版本过期时拒绝覆盖，请重新打开设置并核对后保存。字段校验失败不产生部分写入。

`quoteOrder`：买家和商家均可用。传 `fulfillment` 和 `lines`，返回 `settingsRevision/subtotal/shippingFee/total/pickupStore/instructions/delivery`。校验营业、履约方式、库存和起送条件，不创建订单或占用库存。

`createOrder`：保留旧参数。可增加 `settingsRevision` 和 `expectedTotal`；若确认后门店规则或金额变化，拒绝新订单并提示刷新。相同幂等键的成功订单重试优先返回原订单，即使之后暂停接单也不会重复扣库存。

## 小程序侧对接

1. 登录后或进入购物车读取 `shopSettings`，展示 `pickupStore`、启用的履约方式、费用及说明；不要继续写死门店地址或 8 元费用。
2. 提交前调用 `quoteOrder`，让买家确认服务端金额及地址。
3. 调用 `createOrder` 时带上报价的 `settingsRevision` 和 `expectedTotal`。网络响应丢失时复用原输入和幂等键，避免重复订单。
4. 门店规则变更被拒绝时刷新设置，让买家重新确认；不要悄悄更换金额重试。

服务侧分支包含现有小程序控制器与结算模板的最小适配；不改导航及视觉布局。小程序侧若已重写结算页面，按上述新增契约接入即可，无须整页替换。旧请求格式仍可调用，默认配置下原流程不变；修改实际经营规则后，未读取设置的旧页面可能显示过期预估信息，应先合入读取适配再调整规则。

## 验证和运行

`npm run build` 同步本地模拟共享模块，`npm run check` 检查语法和同步状态；启用 MongoDB 的全量测试覆盖设置持久化、并发版本冲突、历史快照、报价、闭店及小程序下单。测试使用独立测试数据库，不修改共享联调数据。

服务端代码更新需重启 Node 服务。MongoDB 和隧道可保持运行。当前登录会话保存在进程内，重启后需使用原账号重新登录；数据库中的商品、订单和设置保留。
