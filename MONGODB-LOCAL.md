# MongoDB 本地模拟经营环境

无需小程序账号、微信商户号或云账号。界面与业务接口使用真实 MongoDB 持久化；支付、退款、物流及身份仍明确模拟，不产生资金流。

## 启动

安装 Node.js 20.19+（本机验证版本 22.19）。在项目目录执行 `npm.cmd ci --ignore-scripts`，然后开两个终端：

1. `npm.cmd run db:start`
2. 等出现 MongoDB ready 后执行 `npm.cmd start`

网页 http://127.0.0.1:4173 。数据库只监听本机 27018，单节点副本集名 petshop，默认数据库 pet_shop_demo。第一次启动下载 MongoDB 8.0.16 官方 Windows 程序；下载与二进制校验由 mongodb-memory-server-core 处理。该包在这里仅作开发进程工具，**数据目录固定，不是临时内存数据库**。未注册系统服务，未开放外网端口。

数据目录 `.local/mongodb/data`，上传图片 `.local/uploads`。重启不重新灌入样例；连接失败直接报错，不切回内存假成功。开发包带模拟商家角色，不能直接公开部署。

可用 `MONGODB_URI` 和 `MONGODB_DATABASE` 指向自备副本集；数据库名限制以 pet_shop_ 开头。连接信息不要提交到代码。

## 数据结构与事务

- products：每商品一文档，内嵌规格和可售库存。
- orders：每订单一文档，保存商品价格、规格、收货快照及状态；按用户/时间与状态/过期时间建索引。
- address_books：每模拟用户一文档，最多二十个地址。
- idempotency_keys、payment_events：分别保存下单幂等键与支付事件，确定性 _id 防止重复。
- shop_meta：店铺配置、序号、schemaVersion、revision；不再塞全部商品和订单。
- audit_log：记录动作、操作者、订单 ID、时间与版本，不把收货地址或电话写入操作日志。

修改通过 MongoDB snapshot 事务，订单、库存和幂等记录一起提交。低 QPS 单店通过 revision 文档协调写入，事务冲突由驱动重试。库存和订单仍沿用已有同一份领域规则。定时过期任务每十秒处理一次，结果落库。

这是第一阶段持久化适配：目前领域规则仍一次加载店铺业务快照，保留 100 商品 / 500 订单的演示容量限制，尚未完成按请求局部读取与分页；不能当成无限规模生产后端。没有引入 Redis、消息队列或微服务。

## 小程序本地联调

`miniprogram/config.js` 可选：

- mock：原微信本地存储模拟，保留已有数据，不依赖数据库服务。
- local：HTTP 请求本机 4173，和网页共用 MongoDB 与上传图片。
- cloud：旧 CloudBase 适配保留，尚未迁移为正式 MongoDB 云端接口。

local 仅接受 loopback 地址，在开发工具本地配置中关闭合法域名校验才能联调 HTTP。此设置仅用于本机模拟；手机的 127.0.0.1 是手机自己，因此当前 local 模式不是手机真机联网方案。后续真机需单独配置可达的测试服务和身份保护。

原 mock 存储没有被删除，也没有自动导入 MongoDB。切回 mock 可看到此前本地数据；新的 MongoDB 初次初始化使用独立样例。

## 备份和恢复

- `npm.cmd run db:backup`：在 `.local/backups/<时间>/` 保存一致性的业务 JSON 快照与 SHA-256，并复制上传图片目录。
- `npm.cmd run db:restore -- <business.json绝对路径> pet_shop_restore_<新名称>`：只恢复到新库，拒绝覆盖已经修改过的库。默认运行库不变，需要自行用 MONGODB_DATABASE 选择恢复库。
- 当前快照是业务备份，不含 audit_log；图片副本保存在备份 uploads/ 子目录，恢复命令不会覆盖现有图片。异机恢复需要同时恢复该目录。后续上线应采用数据库级备份并覆盖审计和全部文件。

## 检查

- `npm.cmd test`：普通回归；真实 MongoDB 的四个用例默认跳过，不能把跳过算通过。
- `npm.cmd run test:mongo`：必须有真实本地副本集，验证重连、并发最后一件、重复下单、回滚、过期释放、模拟退款与恢复、HTTP 服务重启。
- `npm.cmd run check`：语法、JSON 和共享代码同步检查。

正式账号、真实支付验签/回调、线上身份授权、真实物流和生产部署仍未接入。开发版操作不需要真实微信资金。

## 本轮实际验收（2026-10-24）

- 当前已选择 local 模式；开发工具本机合法域名校验关闭，正式项目配置仍保留校验。
- 完整测试 64/64 通过、零跳过，报告 evidence/mongo-all-tests.tap；语法/JSON 检查 45 文件通过。
- MongoDB 8.0.16 实际停止并重启，数据与备份深度比较一致；报告 evidence/mongodb-restart.json。
- 备份命令真实执行，并恢复到独立库 pet_shop_restore_acceptance_20261024；没有替换当前 pet_shop_demo。
- 微信开发工具已渲染数据库中的首页文案、图片；实际点击个人中心、商家入口、模拟商家开关，成功读取商品列表。截图 evidence/mongodb-wechat-merchant.png。未在本轮逐项重测全部原生购买控件，不等同真机支付验收。
- 原网页内存里的三个商品与店铺/首页设置迁移至 MongoDB，迁移前有本地快照；当时没有订单或地址。旧小程序 mock 数据原样保留，未混入新数据库。
- 当前 npm audit 检查结果为 0 vulnerabilities，不代表所有代码已经完成安全审计。


2026-10-24：新增 stock_movements 退货验收流水集合，和订单、商品库存同事务保存。业务快照备份包含 stockMovements 字段。售后步骤与范围见 AFTERSALES.md。
