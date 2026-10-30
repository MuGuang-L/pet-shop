# CloudBase 待配置适配与上线缺口

本文只是后续配置说明，不代表已授权或已执行部署。当前默认 mock，不需要任何云账号。

## 已写好的适配

小程序云模式调用 `shop` 云函数。云函数通过 `cloud.getWXContext().OPENID` 获取身份，不使用 event 中的 OPENID、role、merchant 或 mock。商家表 `merchants` 使用微信 OPENID 作为文档 `_id`，`enabled: true` 才有商家权限。前端隐藏按钮不构成授权，所有商家动作在领域层再次检查。

商品、订单、地址、请求键和支付事件暂存于 `shop_state/singleton` 的 `value` 字段，通过服务器 `runTransaction` 原子读改写。事务内只用 `doc()`，不使用 `where()`；按 SDK 可能包装的 `result` 取出返回值。官方参考：https://docs.cloudbase.net/en/database/transaction 。没有在真实云环境验证 SDK 行为。

`shop` 的单文档上限设为约 750KB，最多 100 个商品、500 个订单；超过返回 DEV_CAPACITY_LIMIT。这个方案旨在第一阶段验收，不适合生产流量。上线前拆分 products/orders/idempotency/payment_events/addresses，库存与订单仍须在同一事务修改，唯一键和索引需要按真实数据库方案实现。不能通过删掉幂等记录来随意“腾空间”。

## 后续才需要的账号和配置

1. 用户合法持有的微信小程序 AppID、对应开发者权限和合规经营信息。
2. 明确授权后开通的 CloudBase 环境 ID；当前不创建、不购买环境。
3. 在该独立环境创建 `merchants` 和 `shop_state` 集合。数据种子 `cloudbase/seed.json` 只含虚构样例；导入方式需按当前控制台格式调整。
4. 用管理端可信操作设置 `{_id: "实际商家 OPENID", enabled: true}`。不可向买家开放注册商家 API。
5. 两个集合客户端读写均拒绝，规则参考 `database.rules.json`；云函数使用服务端权限。存储仅公开读商品图片、拒绝客户端写，上传必须经过 `uploadImage` 商家鉴权云函数。不要存用户身份证或地址图片等隐私文件。
6. 云函数 `shop`、`uploadImage` 声明 `wx-server-sdk ~3.0.1`。以后批准部署时，使用 npm 官方注册表安装并保留实际锁文件和依赖许可证，再核验当前官方 SDK 文档；此次未下载依赖。
7. 小程序改为 `mode:'cloud'` 并填环境 ID，填写真实测试 AppID。云配置缺失时失败，不自动降级 mock。

## 上线前必须补齐

- 真实支付：商户申请和 AppID 绑定、API v3 密钥及证书/公钥管理、JSAPI 预支付、`wx.requestPayment`、回调签名验证/解密/金额币种商户及应用匹配、支付查单和对账。秘密只存受控云配置，不提交仓库。
- `paymentNotify` 当前无论参数如何都 503。不能直接把客户端 `paid:true` 接到内部 `settleVerifiedPayment`。该内部函数只用于未来通过微信验证后的服务器事务结算和当前测试。
- 真实退款请求、退款通知幂等、退款失败重试和人工对账。`REFUNDING` 不是退款成功。
- 超时：当前业务调用时惰性清理。部署后增加受控定时扫描；先检查/关闭微信支付单，再按事务状态释放库存，并处理关闭与付款竞争。内部晚到账状态已有设计，网关尚未接入。
- 物流：选择普通快递公司与付费/免费查询渠道并单独授权，验证 webhook 或查询接口。现在只有明确标记的模拟轨迹，运费固定样例。
- 图片：实际微信 `chooseMedia`、本地 `saveFile`、云上传和资源访问测试；图像重新解码、内容审核、配额/限流、孤儿图片清理尚缺。当前只检查大小和文件头。
- 可运营性：事务冲突重试、存储迁移、分页/索引、订单和库存审计日志、限流、日志脱敏、备份恢复、售后人工处理、隐私政策和平台审核资料。
- 真机和微信开发者工具界面测试，尤其是 WXML 支持、布局、图片权限、网络中断后恢复。网页预览不能替代。

没有部署脚本、自动创建环境动作或商户凭证。需要新的用户授权才能执行开通、部署、发布和实际支付接入。

## CloudBase Containers 启动调试

当前容器入口是仓库根目录的 `Dockerfile`，启动命令为
`node server/index.js`。云托管会传入 `PORT`，服务会监听
`0.0.0.0:$PORT`；请在 Containers 扩展的运行配置中使用该 Dockerfile
并把容器端口设为 `80`（云托管传入其他 `PORT` 时以该变量为准）。

部署环境不包含 `.local/`，因此不能依赖本机执行 `npm run setup` 后生成
的账号。云托管版本使用同环境的 MySQL，不要开启数据库外网地址。至少配置以下运行时环境变量：

| 变量 | 要求 |
| --- | --- |
| `PORT` | `80`。未设置时进程只监听本机 `4173`，容器探针会显示 connection refused |
| `MERCHANT_USERNAME` | 小写商家用户名，匹配 `^[a-z0-9][a-z0-9_-]{0,79}$` |
| `MERCHANT_PASSWORD` | 8–200 个字符；在 CloudBase 的环境变量/密钥配置中保存，不提交代码 |
| `MYSQL_HOST` | 云托管 MySQL 的内网地址。设置后服务使用 MySQL，不再连接 MongoDB |
| `MYSQL_PORT` | 默认 `3306` |
| `MYSQL_USER` | 控制台创建实例时设置的账号 |
| `MYSQL_PASSWORD` | 控制台创建实例时设置的密码，不提交代码 |
| `MYSQL_DATABASE` | 默认 `pet_shop`；只允许字母、数字和下划线 |

支付使用开放接口服务，不把商户证书放进容器。环境变量 `WECHAT_MCH_ID` 为已在云托管控制台绑定的商户号；未配置不会阻止服务启动。开启「开放接口服务」后需要重新发布版本。支付回调由云托管打到容器，不使用公网 `notify_url`。
若未提供商家账号，启动日志会显示
`Shop startup failed: MERCHANT_ACCOUNT_REQUIRED`，这正是 CloudBase 显示
`Back-off restarting failed container` 的一个直接原因。配置完成后在扩展
的调试日志中应先看到 `Shop HTTP service listening`；随后 MySQL 连通时会
看到 `Database connection ready.`。数据库暂停恢复时日志可能出现
`CynosDB serverless instance is resuming`，服务会重试，不需要重启。
`/health` 返回 200 且 `database` 为 `mysql` 才表示数据库也已就绪。
云托管 MySQL 没有内置备份，需要备份时在腾讯云控制台配置。
