# 本地环境配置

通常按 README 的 `npm ci`、`npm run setup`、`npm run service:start` 即可。以下是数据库下载失败、已安装 MongoDB 或需要排查时的补充步骤。所有命令在仓库根目录执行。

## 初始化与文件

`npm run setup` 只创建缺少的配置和账号，不启动网络服务，也不导入共享数据。它复制小程序连接模板、开发工具项目模板和本地服务配置模板；已有文件原样保留。缺少配置时可再次执行。账号文件已存在但密码文件丢失时，不会生成一套不匹配的新密码；请保管本机凭据，勿删除业务目录来处理登录问题。

`.local/` 保存本机的账号、图片、数据库、备份和运行状态；`miniprogram/config.local.js`、`project.config.json` 保存个人连接地址和 AppID，均不进入 Git。不要把整个项目目录打包当源码分享。只分发 Git 中的文件，或使用 `npm run export:buyer` 导出小程序侧；导出包使用本地默认地址，不复制个人连接配置。

首次连接空数据库时自动建集合、索引和模拟商品。重启、重新 setup 和更新代码均不重置已有数据。数据库名称必须以 `pet_shop_` 开头。交易写入使用事务，单机 standalone MongoDB 不满足要求，需要副本集；单节点副本集足以用于本地模拟。

## MongoDB 下载失败

默认脚本固定使用 MongoDB 8.0.16，并缓存下载结果。先检查网络和 MongoDB 官方下载站点的可达性；恢复后重试即可。不要删除已有 data 目录。也可以从 [MongoDB Community 下载页](https://www.mongodb.com/try/download/community) 安装 8.0 系列，并采用下面的手动方式。

## 手动启动已安装的 MongoDB

需要 `mongod` 和 `mongosh` 已在 PATH 中；只安装 Compass 不包含完整服务端。下面为 PowerShell 示例，使用新的本地数据目录，避免接管其他数据库进程。

```powershell
New-Item -ItemType Directory -Force .local/mongodb-manual/data | Out-Null
mongod --replSet petshop --bind_ip 127.0.0.1 --port 27018 --dbpath .local/mongodb-manual/data
```

保持该终端运行。在另一个终端，首次初始化此副本集：

```powershell
mongosh 'mongodb://127.0.0.1:27018/?directConnection=true' --eval 'rs.initiate({_id:"petshop",members:[{_id:0,host:"localhost:27018"}]})'
```

仅首次执行 `rs.initiate`，已有副本集不需要重新配置。参考 [MongoDB 开发副本集文档](https://www.mongodb.com/docs/manual/tutorial/deploy-replica-set-for-testing/)。确认 `db.hello().isWritablePrimary` 为 true 后，选择一种启动方式：

- 简单启动：执行 `npm start`，只启动 Node；数据库由上面的终端保持运行。
- 监测 Node 恢复：将 `.local/runtime/config.json` 的 `manageMongo` 改为 false，保留 `publicOrigin` 为空、`natapp.enabled` 为 false，再执行 `npm run service:start`。此时数据库被视为外部进程，不会被脚本停止或重启。

不要同时使用手动 MongoDB 和默认自动管理，两者默认占同一个端口。`npm run db:start` 也可单独使用仓库自带的 MongoDB 启动助手，再在另一终端运行 `npm start`。

## 可选环境变量

默认值已能本机运行。需要改用自己的副本集或隔离目录时，在启动前设置：

| 变量 | 用途 |
| --- | --- |
| `MONGODB_URI` | 自己的副本集连接串；使用自定义连接串时，服务管理配置需将 manageMongo 设为 false |
| `MONGODB_DATABASE` | 数据库名，默认 pet_shop_demo，必须以 pet_shop_ 开头 |
| `SHOP_DATA_DIR` | 本机账号、图片、备份、服务管理配置目录，默认 .local；初始化和启动时保持一致 |
| `PUBLIC_ORIGIN` | 直接 npm start 时允许的 HTTPS 公网根地址；纯本地运行应留空 |

服务管理方式读取 `.local/runtime/config.json` 的 publicOrigin 并传给 Node，优先于外部 PUBLIC_ORIGIN；不使用隧道时保持空字符串。本地 HTTP 模式不要设置 HTTPS 来源，否则本地商家登录来源和 Cookie 行为将不匹配。

已有环境变量不会因 clone 或 setup 自动清除。若数据库、目录或来源不符合预期，先检查启动终端中的这些变量。HTTP 默认监听回环 4173，数据库助手默认监听回环 27018；同一台电脑上已有项目占用时，请先确认运行目录，不要直接关闭不明进程。

## 联调检查

1. 本地 /health 返回 ok，商家登录后看到模拟商品。
2. 小程序连接同一本机 API，用本机 buyer 账号登录，浏览商品并模拟下单。
3. 商家查看订单，完成自提核销或外送；小程序看到对应状态。
4. 重新启动服务、重新登录后，商品和订单仍然存在。

本地模拟不需要 NATAPP、真实小程序支付账号或真实商户号。真实微信登录、支付、退款及真机验收是后续独立步骤，不由本地启动成功替代。

## 本次验证范围

2026-10-27 从待提交源码生成不含本机配置、数据及依赖的干净副本，重新执行 npm ci 和 setup，生成独立账号与本地配置。使用独立 MongoDB 副本集和临时 HTTP 端口验证：空库初始化、商家页面读取、买家与商家登录、模拟付款、自提核销、重复下单去重，以及服务重启后订单和库存保留。导出小程序包时注入私有地址作为检查标记，确认输出恢复本地默认地址，未复制私有配置。

完整测试 247 项通过，0 失败、0 跳过；共享服务的商品、订单、库存、账号和审计记录未变化。为保留正在使用的共享服务，这次干净副本未占用默认 4173/27018 端口；该验证覆盖 HTTP/API 和持久化，不替代另一台电脑上的微信开发者工具或真机操作验收。
