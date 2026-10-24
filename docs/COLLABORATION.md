# 联调配置

## 连接关系

小程序侧和服务侧的商家 Web 调用同一个 HTTP API，由服务侧读写 MongoDB。库存、金额、订单状态和权限在服务侧校验。

| 项目 | 配置 |
| --- | --- |
| 小程序侧 API 根地址 | `https://petshop-dev19732.nat100.top` |
| 服务侧商家 Web | `https://petshop-dev19732.nat100.top/admin/` |
| 本地 HTTP 服务 | `127.0.0.1:4173` |
| 本地 MongoDB | `127.0.0.1:27018`，不通过隧道开放 |
| 小程序配置文件 | `miniprogram/config.js` |

API 根地址不包含 `/api`。图片和上传文件使用同一域名。

## 账号与会话

运行 `npm run setup:accounts` 创建测试账号，已有账号不会覆盖。凭据保存在 `.local/auth/`，通过独立渠道分配，不进入仓库。

小程序侧使用 Bearer token。服务侧商家 Web 使用 HttpOnly、SameSite=Strict Cookie；配置 `PUBLIC_ORIGIN` 后附加 Secure 标记，因此需通过 HTTPS 登录。会话有效期为 8 小时，后端重启后重新登录。

测试账号的订单和地址相互隔离，商家账号可以管理测试订单。前端传入的角色字段不能提升权限。

## 服务启动

依赖安装、账号初始化和数据库启动见 README。启用公网 HTTPS 前设置后端允许的来源：

```powershell
$env:PUBLIC_ORIGIN='https://petshop-dev19732.nat100.top'
npm.cmd start
```

NATAPP 的目标为本地 HTTP 4173，公网 HTTPS 开启，本地 HTTPS 关闭。令牌及客户端放在 `.local/natapp/`，不进入仓库。运行主机、数据库、后端和隧道需持续在线。

停止隧道后远程访问中断，本地数据不受影响。续费、隧道启动及服务重启由服务侧维护者负责。

## 联调检查

2026-10-24 已验证：HTTPS 健康检查、小程序侧账号登录、商品读取、匿名请求返回 401、越权请求返回 403、服务侧商家 Web 的 Secure Cookie 登录。

上述结果不代表所有网络和微信环境均已通过。小程序侧仍需验证开发工具导入、接口请求、图片加载及真机域名配置。真实微信登录、支付、退款和通知尚未接入。

## 源码与数据

协作流程见 `CONTRIBUTING.md`，接口见 `docs/BUYER-API.md`。Git 只同步源码；MongoDB、账号、上传文件、备份及原始调试材料保存在服务侧运行环境中。

需要源码压缩包时可执行 `npm run export:buyer`。输出目录为 `.local/handoff/`，只包含小程序侧源码与接口文档，不包含服务侧代码或凭据。
