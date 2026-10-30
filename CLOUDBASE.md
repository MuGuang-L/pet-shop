# 微信云托管部署

当前线上形态是：小程序通过 `wx.cloud.callContainer` 调用容器里的 `server/index.js`。没有公众号网页，也不部署 `cloudfunctions/` 里的云函数。本机不设置 MySQL 变量时，仍使用本地 MongoDB，见 README。

## 发布前在控制台完成

1. 服务使用仓库根目录的 `Dockerfile`。镜像里 `PORT` 默认为 `80`，容器端口也填 `80`。
2. 先打开「开放接口服务」，再发布版本。这个开关写在版本上，旧版本不会自动带上。
3. 在云托管「设置 → 其他设置 → 微信支付」绑定商户号，直到状态为已授权。
4. 在同一环境创建 MySQL，只使用内网地址，不要开外网。
5. 小程序 `miniprogram/config.local.js` 填写该环境 ID，服务名保持 `pet-shop`。这个文件不进 Git。

环境变量写在服务设置里，随新版本生效。改变量后要重新发布。

| 变量 | 要求 |
| --- | --- |
| `PORT` | 镜像默认 `80`。控制台若改了容器端口，这里必须填同一个值 |
| `MERCHANT_USERNAME` | 小写商家用户名，匹配 `^[a-z0-9][a-z0-9_-]{0,79}$` |
| `MERCHANT_PASSWORD` | 8–200 个字符。只放服务设置，不提交代码 |
| `MYSQL_ADDRESS` 或 `MYSQL_HOST` | 内网地址。可以写成 `10.x.x.x:3306`。模板自动开通数据库时，平台注入的名字是 `MYSQL_ADDRESS` |
| `MYSQL_USERNAME` 或 `MYSQL_USER` | 数据库账号。模板注入的名字是 `MYSQL_USERNAME` |
| `MYSQL_PASSWORD` | 数据库密码。MySQL 登录需要原始密码，服务设置里按明文保存 |
| `MYSQL_DATABASE` | 库名，默认 `pet_shop`，只允许字母、数字和下划线 |
| `WECHAT_MCH_ID` | 已绑定的商户号。不填时服务能启动，支付接口返回未配置 |

手动开通的 MySQL 不会自动出现 `MYSQL_ADDRESS`。按上表自己填写。模板部署自动开通时，平台会写入 `MYSQL_ADDRESS`、`MYSQL_USERNAME`、`MYSQL_PASSWORD`，服务认这两组名字。

库不存在且账号有建库权限时，启动会创建 `MYSQL_DATABASE`。没有建库权限时，日志出现 `MysqlConfigError`，需要先在控制台建好同名库再发布。账号或密码错误同样只记录一次，不会反复重试。

## 启动后看什么

商家账号缺失时，进程退出，日志是 `Shop startup failed: MERCHANT_ACCOUNT_REQUIRED`。云托管界面上就是 `Back-off restarting failed container`。

配置正确时，日志先出现 `Shop HTTP service listening`，连上数据库后出现 `Database connection ready.`。支付商户号已填时再出现 `WeChat Pay ready.`。

`/health` 返回 200 且 `database` 为 `mysql`，表示可以接流量。数据库空闲暂停后恢复时，日志里会出现 `CynosDB serverless instance is resuming`，进程保持监听并重试，不用为此重启。这段时间 `/health` 是 503，存活探针看容器端口即可。

## 支付

支付走开放接口，容器内请求 `http://api.weixin.qq.com/_/pay/unifiedOrder`。不放商户证书，也不需要公网回调域名。结果由云托管打到容器的 `/wechat/pay/notify`，退款打到 `/wechat/refund/notify`。服务会再查一次单，确认商户号、openid 和金额后才改订单。

小程序侧必须用真机完成收银台。开发者工具不能完成真实付款。买家身份来自云托管附带的 `x-wx-openid`，并且要求调用来源是小程序或开发者工具。

商家后台退款没有小程序请求头。云托管会提供 `CBR_ENV_ID`，服务用它作为退款环境。服务名默认 `pet-shop`，不一致时设置 `WECHAT_CLOUD_SERVICE`。

## 数据与备份

订单、库存和店铺设置保存在 MySQL 表 `shop_state` 的一行 JSON 里，支付单在 `wechat_trades`，审计在 `audit_log`。一次改库存和订单使用 InnoDB 事务。这是单店低并发的做法，历史订单变多以后这一行会变大。

上传的图片写在容器磁盘，重新发布或扩缩容后会消失。正式图片不要只放在容器里。

云托管 MySQL 控制台没有内置备份。需要备份时到腾讯云数据库控制台配置。本地 MongoDB 的 `npm run db:backup` 不作用于这块云数据库。

## 还没做完

部分退款、换货、真机支付验收、图片云存储，以及支付测试期间把最小实例数保持为 1。缩到 0 之后，支付回调可能撞上冷启动。
