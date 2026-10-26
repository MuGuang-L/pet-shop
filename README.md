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

## 小程序侧开发

用微信开发者工具导入仓库根目录，选择有权限使用的 AppID 或工具支持的测试模式。`miniprogram/config.js` 中的 `apiBase` 为服务侧 API 根地址，不加 `/api` 后缀。

连接现有联调服务时，无需安装 MongoDB 或运行服务侧代码。测试账号单独分配，密码在登录页输入，不写入源码。

- 联调 API：`https://petshop-dev19732.nat100.top`
- 商家 Web：`https://petshop-dev19732.nat100.top/admin/`

联调服务依赖运行主机和 NATAPP 持续在线。微信真机及正式环境的域名配置需单独验证。

## 服务侧开发

使用 Node.js 22，在仓库根目录执行：

```sh
npm ci
npm run setup:accounts
```

测试账号生成在 `.local/auth/`，已有账号不会覆盖。分别在两个终端启动数据库和服务：

```sh
npm run db:start
```

```sh
npm start
```

MongoDB 首次启动会下载官方二进制，数据保存到 `.local/mongodb/data/`。本地商家入口为 `http://127.0.0.1:4173/admin/`。独立运行时需将小程序侧 `apiBase` 改为对应接口地址。

使用 HTTPS 隧道时，将环境变量 `PUBLIC_ORIGIN` 设为实际 HTTPS 根地址，再启动后端。此时商家 Web 使用 HTTPS 登录，Cookie 带有 Secure 标记。隧道只映射 HTTP 4173，不映射数据库端口。

Windows 如遇 npm.ps1 执行限制，可使用 `npm.cmd`。

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
- [备份与恢复](docs/BACKUP-RECOVERY.md)
- [上线前验收清单](docs/PRELAUNCH-ACCEPTANCE.md)
- [上游兼容性](UPSTREAM-COMPATIBILITY.md)
- [第三方说明](THIRD_PARTY_NOTICES.md)

私有仓库内的协作者可读取全部源码，目录分工不构成访问隔离。数据库、账号、上传图片、隧道令牌、备份、个人配置及原始调试截图和日志由 `.gitignore` 排除。

历史验收文档记录当时版本，当前入口和启动方式以本 README 为准。原始验收材料仅保存在本机，不随仓库发布。
