# 开发协作

## 分工

- 小程序侧：`miniprogram/` 中的页面、样式、交互和接口适配。
- 服务侧：`apps/merchant-web/`、`server/`、`cloudfunctions/shop/`，包含商家 Web、接口和数据处理。
- 接口字段以 `docs/BUYER-API.md` 为准。字段或状态变更需在合并前确认两侧兼容性。

仓库采用目录分工，协作者可读取全部已提交源码。数据库、上传文件和凭据不进入 Git。

## 访问权限

仓库所有者在 GitHub 的 Settings → Collaborators → Add people 中添加 GitHub 用户名。受邀者接受邀请后可访问私有仓库并提交代码。

```sh
git clone https://github.com/MuGuang-L/pet-shop.git
cd pet-shop
```

小程序侧使用微信开发者工具导入仓库根目录，配置有权限的 AppID 或测试模式。个人开发配置不提交。联调账号通过独立渠道分配。

服务侧的完整启动步骤见 README；仅开发小程序侧时，可直接连接现有联调 API。

## 分支与提交

当前分支分工：

- `dev/miniprogram`：小程序侧开发。
- `dev/service`：服务侧开发，包含商家 Web、接口与数据库代码。
- `integration/full-stack`：合并两侧变更、处理兼容问题及三方验收。
- `main`：验收后再合入，当前不直接推送。

本地查看联调版本：

```sh
git fetch origin
git switch --track origin/integration/full-stack
git pull --ff-only
```

已经有该本地分支时使用 `git switch integration/full-stack`。切换前先保存当前分支的工作；不要使用强制覆盖或重置解决未提交改动。

两侧日常仍在各自开发分支提交。需要联调时，向 `integration/full-stack` 发起 Pull Request，说明接口和字段影响。修复在联调分支完成后，应选择性同步回对应开发分支，避免下次合并重复修复。联调通过后再向 `main` 提交验收版本。

联调分支包含两侧完整代码；Git 不包含正在运行的数据库和账号，切换分支不会迁移或重建数据库。详细步骤及验收记录见 [三方联调](docs/FULL-STACK-INTEGRATION.md)。界面截图只保留应用内容，不包含桌面、机器路径或账号信息。不要强制推送共享分支。

## 检查

Node.js 22，安装依赖后运行：

```sh
npm ci
npm run check
npm test
```

Windows 可使用 `npm.cmd`。MongoDB 集成测试需先启动数据库，再执行 `npm run test:mongo`。

## 提交范围

提交源码、默认演示素材、测试、文档和依赖锁文件。不提交 `.local/`、环境变量文件、个人开发配置、隧道令牌、数据库备份、真实用户数据或原始调试材料。

Git 同步源码，不同步运行进程和数据库。小程序侧合并后重新编译；服务侧合并后由维护者验证并重启相关服务。
