# 爪爪小铺

宠物商城模拟开发项目，分为小程序侧和服务侧。

小程序侧负责商品浏览、购物车、地址、订单和售后。服务侧包含商家 Web、HTTP API 和 MongoDB，负责商品维护、店铺装修、库存、履约及售后处理。

## 项目结构

| 部分 | 目录 | 内容 |
| --- | --- | --- |
| 小程序侧 | `miniprogram/` | 微信小程序页面、样式和接口适配 |
| 服务侧 | `apps/merchant-web/` | 商家 Web |
| 服务侧 | `server/` | HTTP API、登录权限和 MongoDB 持久化 |
| 服务侧 | `cloudfunctions/shop/` | 共享业务规则；当前由 Node.js 调用，不部署云函数 |
| 公共 | `scripts/`、`tests/`、`docs/` | 开发脚本、测试和文档 |

`preview/` 和 `tests/fixtures/legacy/` 保留历史实现及回归样本，不作为当前入口。

## 在自己的电脑上运行

仓库默认连接本机，不需要 NATAPP，也不需要其他运行环境的账号、数据库或上传文件。使用 [Node.js 22](https://nodejs.org/en/download) 和 Git，在准备存放项目的目录执行：

```sh
git clone --branch integration/full-stack https://github.com/MuGuang-L/pet-shop.git
cd pet-shop
npm ci
npm run setup
npm run service:start
```

私有仓库需要先接受协作邀请，并使用自己的 GitHub 身份克隆。Windows 若提示 npm.ps1 无法执行，将 `npm` 换为 `npm.cmd`。

`setup` 为本机生成连接配置、开发工具项目配置、服务管理配置和随机测试账号。重复执行会保留已有文件，不重置账号或数据。默认配置如下：

| 内容 | 本机默认值 |
| --- | --- |
| 商家 Web | `http://127.0.0.1:4173/admin/` |
| 小程序 API | `http://127.0.0.1:4173` |
| MongoDB | `mongodb://127.0.0.1:27018/?replicaSet=petshop` |
| 数据库名称 | `pet_shop_demo` |
| 小程序连接配置 | `miniprogram/config.local.js`，不提交 Git |
| 开发工具配置 | `project.config.json`，不提交 Git；模板使用测试 AppID |
| 测试账号 | `.local/auth/credentials.txt`；merchant 登录商家 Web，buyer 登录小程序 |

`service:start` 在当前终端启动数据库和 Node 服务，持续监测并恢复子进程。首次运行会下载官方 MongoDB 8.0.16 二进制，启动单节点副本集；不需要单独安装 MongoDB，也不是内存数据库。下载需要网络，数据保存在 `.local/mongodb/data/`，退出或重启后保留。默认不启动任何隧道。请等服务就绪再登录，在另一个终端检查：

```sh
npm run service:status
```

database 和 backend 均为 healthy 后，打开商家 Web；`http://127.0.0.1:4173/health` 也应返回 `ok: true` 和 `database: mongodb`。首次连接空库时，服务自动创建集合、索引和模拟商品；以后启动不会覆盖已有商品、订单或库存。每台电脑的数据各自独立，`git pull` 不同步数据库。

停止使用 `npm run service:stop`，再次启动仍用 `npm run service:start`。不要同时再运行 `npm start` 或 `npm run db:start`；端口已占用时脚本会拒绝启动，不会关闭其他进程。现有环境执行 setup 会保留原配置（包括已设置的隧道），不会自动改成本地模式。

手动安装 MongoDB、下载失败处理、环境变量和独立启动方式见 [本地环境配置](docs/LOCAL-DEVELOPMENT.md)。

## 小程序侧开发

完成 `npm ci` 和 `npm run setup` 后，用微信开发者工具导入仓库根目录，选择有权限使用的 AppID 或工具支持的测试模式。AppID 保存在本机 `project.config.json`，不用改公共模板。

在同一台电脑的模拟器中，`miniprogram/config.local.js` 默认地址即可使用。开发工具进行本地 HTTP 联调时，需在本地设置中关闭合法域名校验；这只适用于开发调试，不代表真机或上线域名已配置好。使用本机生成的 buyer 账号登录。首次打开尚未初始化的 checkout 会缺少 config.local 模块，运行 setup 后重新编译即可。

只开发小程序侧、连接共享服务时，不需要启动本地 MongoDB。把本机配置里的 `apiBase` 改为服务侧提供的 HTTPS 根地址（不加 `/api`），使用该服务分配的测试账号。仓库不预设任何人的隧道地址。

真机的 `127.0.0.1` 指手机自身，不能访问电脑上的服务。真机或跨电脑联调需要另行配置可访问的 HTTPS 服务地址及微信域名规则；隧道是可选接入方式，只映射 HTTP 服务，不开放 MongoDB。

## 登录说明

当前保留买家和商家两种身份：买家订单、地址按账号隔离，商家才能维护商品、发货、退款和调整库存。测试账号由各自本机生成，密码不写进仓库，也不会复制现有联调环境的密码。

后续接入真实微信身份后，小程序侧可以免手输账号密码；订单归属校验仍然需要。商家 Web 继续需要登录，私人使用不代表公开网址具有访问限制。当前模拟版本不提供匿名商家入口。

## 功能范围

当前范围以 [必要功能与开发边界](docs/SCOPE.md) 为准：只做购买、经营和异常处理必需的能力。不做吉祥物和品牌故事，暂不做优惠券、促销、会员价等营销玩法。低 QPS 仍需保证网络失败、重复请求与数据库恢复时的数据正确性，见 [网络可靠性](docs/NETWORK-RELIABILITY.md)。

- 商品分类、详情、规格、购物车、地址和订单。
- 到店自提：备货、提货码核销；商家外送：登记单号或配送说明、确认收货。
- 商品图片上传、备选图库、商品模板、上下架和店铺内容编辑。
- 整单售后、审核、撤回、退货登记、实收及可售数量验收、退货入库、模拟退款重试。
- 服务侧权限校验、用户订单隔离、库存事务、幂等操作及超时取消。

尚未接入真实微信登录、支付、退款和通知。部分退款、换货、生产部署及上线验收未完成。当前只用于模拟开发和联调。

## 检查与测试

```sh
npm run check
npm test
```

普通测试默认跳过 MongoDB 集成测试。启动数据库后执行 `npm run test:mongo` 可单独验证持久化；完整测试使用环境变量 `PET_MONGO_TEST=1`。PowerShell 示例：

```powershell
$env:PET_MONGO_TEST='1'
npm.cmd test
```

## 协作与文档

- [开发协作](CONTRIBUTING.md)
- [联调配置](docs/COLLABORATION.md)
- [三方联调分支与验收](docs/FULL-STACK-INTEGRATION.md)
- [小程序侧 API](docs/BUYER-API.md)
- [库存入库与盘点](docs/INVENTORY.md)
- [缺货、外送失败与自提延期](docs/FULFILLMENT-ISSUES.md)
- [备份与恢复](docs/BACKUP-RECOVERY.md)
- [数据库事务与历史数据增长](docs/DATABASE-SCALE.md)
- [服务启动与恢复](docs/RUNTIME-RECOVERY.md)
- [上线前验收清单](docs/PRELAUNCH-ACCEPTANCE.md)
- [上游兼容性](UPSTREAM-COMPATIBILITY.md)
- [第三方说明](THIRD_PARTY_NOTICES.md)

私有仓库内的协作者可读取全部源码，目录分工不构成访问隔离。数据库、账号、上传图片、隧道令牌、备份、个人配置及原始调试截图和日志由 `.gitignore` 排除。

历史验收文档记录当时版本，当前入口和启动方式以本 README 为准。原始验收材料仅保存在本机，不随仓库发布。
