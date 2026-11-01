# 奇迹空间宠物咖啡店

微信小程序商城与商家管理后台。买家在小程序浏览商品、下单、选择到店自提或快递配送、查看订单及申请售后；商家通过 Web 后台维护商品、库存、门店信息和订单。

当前联调代码位于 `integration/full-stack`。云端使用微信云托管 Node.js 服务和 MySQL，小程序通过 `wx.cloud.callContainer` 访问服务并使用微信身份；本地开发可使用 MongoDB 和独立测试账号。支付支持云托管开放接口及 API v3 直连，实际启用方式由服务端配置决定。

商家首页支持按日期和订单号查找自提订单，核对商品后直接确认已提货、记住上次发货的快递公司、一键复制收件信息；买家成功下单后会在当前设备记住自提联系人，按账号和环境隔离。来单提醒显示在页面内，处理后数量立即更新。

商家后台“反馈问卷”可配置 1～8 道单选／多选题，设置必填、发布或暂停，查看分版本票数；买家在“个人中心 → 购物反馈”自愿填写，每个账号每版一次，不自动弹出。改题会生成新版，旧结果保留；统计不展示买家身份。

订单展示号按北京时间每日从 `A001` 递增，自提和快递共用序列；取消不回收序号。内部唯一 ID 保持不变，页面另列日期，快递单号单独显示。历史订单兼容展示，今天已有订单时接续当天最大号，不重编号或覆盖已有记录。

## 当前进度

上述便利功能为后续新增代码，仍需重新部署云托管服务及上传小程序才能对线上用户生效。

2026-11-01 较早版本已完成小程序代码上传，压缩后开发工具预览代码包为 761 KB。用户真机下单并取消后，开发工具从云端读回相同订单的“已取消”状态。该验证未发生付款，不代表真实支付、退款或全部上线项目通过。详细进度见 [状态](STATUS.md) 和 [上线前验收](docs/PRELAUNCH-ACCEPTANCE.md)。

## 目录

| 目录 | 用途 |
| --- | --- |
| `miniprogram/` | 当前微信小程序，普通入口 `pages/shop/index`，订单中心 `pages/orders/index` |
| `apps/merchant-web/` | 商家后台，服务路径 `/admin/` |
| `server/` | HTTP API、身份校验、数据库和支付接入 |
| `cloudfunctions/shop/` | Node 服务复用的业务规则；当前部署不需要发布云函数 |
| `source-assets/` | 图片原稿 |
| `scripts/`、`tests/` | 开发、构建和验证工具 |
| `docs/` | 配置、接口和验收记录，索引见 [文档导航](docs/README.md) |

`preview/`、`tests/fixtures/legacy/` 是历史预览与回归样本，不作为当前产品入口。

## 本地开发

使用 Node.js 22，在仓库根目录执行：

```sh
git clone --branch integration/full-stack https://github.com/MuGuang-L/pet-shop.git
cd pet-shop
npm ci
npm run setup
npm run service:start
```

Windows 如遇 PowerShell 脚本限制，使用 `npm.cmd`。`setup` 仅创建缺少的配置和测试账号，保留已有文件、数据库和账号。

商家后台为 `http://127.0.0.1:4173/admin/`，测试账号位于 `.local/auth/credentials.txt`。服务管理脚本首次运行会下载 MongoDB 并启动本地副本集，数据保存在 `.local/mongodb/data/`。使用 `npm run service:status` 检查，`npm run service:stop` 停止。补充配置见 [本地开发](docs/LOCAL-DEVELOPMENT.md)。

**小程序配置模板当前为云托管模式，setup 不会自动切成本机。** 本地联调请在不提交 Git 的 `miniprogram/config.local.js` 中设置：

```js
module.exports = {
  mode: 'api',
  apiBase: 'http://127.0.0.1:4173'
};
```

此模式使用本地 buyer 测试账号。手机不能通过 `127.0.0.1` 连接电脑；真机联调使用已配置的云托管，或可访问且符合微信域名要求的 HTTPS 服务。

## 小程序编译与上传

1. 执行 `npm ci --prefix miniprogram`，在微信开发者工具导入仓库根目录。
2. 核对本机 `project.config.json` 的 AppID，以及 `miniprogram/config.local.js` 的运行模式和环境。云端配置见 [云托管部署](CLOUDBASE.md)。
3. 在开发工具执行“工具 → 构建 npm”，再编译。依赖更新后重新构建，生成的 `miniprogram_npm` 不提交 Git。
4. 预览并核对页面、接口和包体，再上传。普通体验入口为 `pages/shop/index`；审核表单中不带参数的订单中心 path 为 `pages/orders/index`。按支付单号打开订单的配置另见 [支付文档](docs/WECHAT-PAY-DIRECT.md)。

图片原稿更新后执行 `node scripts/optimize-miniapp-assets.js`，生成压缩 JPEG：横幅最大宽度 960px，其余 640px，保持比例、不放大。开发工具配置保持 `setting.minified: true`，按 `project.example.json` 排除原始 `node_modules` 和包管理文件，保留构建后的 `miniprogram_npm`。已有本机配置不会被 setup 覆盖，需要自行同步打包选项。

## 更新与发布

| 修改内容 | 生效方式 |
| --- | --- |
| README、说明文档 | 提交并推送 Git 即可；不需要重新上传小程序或发布云托管 |
| 小程序页面、组件、配置、打包图片 | 重新编译、上传并更新相应小程序版本 |
| 服务端、共享业务规则、商家 Web、服务端依赖 | 重新构建并发布云托管服务 |
| 云托管环境变量 | 按云托管版本流程重新发布 |

Git 同步源码，不同步数据库、上传图片或正在运行的服务。云托管部署与数据持久化限制见 [部署说明](CLOUDBASE.md)；真实支付配置和验收见 [API v3 直连](docs/WECHAT-PAY-DIRECT.md)。

## 检查与协作

```sh
npm run check
npm test
```

默认测试会跳过需要真实数据库的集成项。启用 MongoDB 使用 `PET_MONGO_TEST=1`；启用 MySQL 使用 `PET_MYSQL_TEST=1` 并配置独立测试数据库连接。不要将测试指向经营数据库。

开发规范见 [CONTRIBUTING.md](CONTRIBUTING.md)，接口见 [买家 API](docs/BUYER-API.md)。账号、密钥、个人配置、数据库和调试材料不得提交。第三方组件与图片来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [DESIGN-SOURCES.md](DESIGN-SOURCES.md)。

快递配送需选择承运公司并录入运单号；默认使用微信官方物流查询插件；开通条件、启用步骤及查询限制见 [快递配送接入](docs/EXPRESS-DELIVERY.md)。
