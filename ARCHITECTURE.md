# 架构与数据边界

## 当前运行结构

小程序 `miniprogram/` 通过 `services/api.js` 调用 Node.js HTTP 服务。云托管模式使用 `wx.cloud.callContainer` 和网关注入的微信身份；本地 API 模式使用账号会话。商家 Web 位于 `apps/merchant-web/`，通过商家账号登录同一服务。

服务入口为 `server/index.js`。存在 MySQL 配置时使用 `server/mysql-store.js`，否则使用 `server/mongo-store.js`。共享领域规则位于 `cloudfunctions/shop/`，目录名不代表当前需要部署云函数。`preview/` 和 legacy 测试样本仅用于历史回归。

## 身份、金额与库存

权限在服务端验证，买家只能访问自己的订单与地址。客户端传入的角色、价格和总金额不能授予权限或决定结算结果。金额使用人民币整数分，订单保存商品、价格及履约信息快照。

下单预留库存，取消和超时释放一次；重复请求通过用户范围的幂等键核对。未确定下单结果时，小程序保留恢复信息，使用原请求核查，避免重复创建订单。退货只有验收为可售的数量重新入库，退款结果和退货入库分别处理。

## 数据库差异

- 本地 MongoDB 使用副本集事务和分集合存储，局部读取及分页实现见 [数据库说明](docs/DATABASE-SCALE.md)。
- 云托管 MySQL 使用 InnoDB 事务；店铺业务状态保存在 `shop_state` 的 JSON 行，支付记录在 `wechat_trades`，审计在 `audit_log`。MongoDB 的局部读取性能结论不适用于此实现。
- 数据、账号和上传图片不会随 Git 同步。本地备份脚本仅面向 MongoDB，云 MySQL 与云端图片需另外配置持久化和恢复方案。

## 支付

支持云托管开放接口和 API v3 直连，由服务配置决定，新旧交易按持久化的通道处理。支付预约、通知核验、主动查单、重复通知和退款补查在服务端实现。配置齐备或接口测试通过不等于实际资金闭环通过。

详情见 [云托管部署](CLOUDBASE.md)、[直连支付](docs/WECHAT-PAY-DIRECT.md) 和 [网络可靠性](docs/NETWORK-RELIABILITY.md)。当前验收结论以 [状态](STATUS.md) 为准。
