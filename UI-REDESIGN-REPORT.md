> 当前版本说明（2026-10-24）：视觉 v2 与七张原创 AI 素材已接入，最终复核 51/51 测试、36 文件检查通过。最新交付状态与证据见 [开发版验收表](DEMO-ACCEPTANCE.md)。下文保留阶段历史；旧素材等待项已由用户后续自行生图授权替代。

# UI 改版交付记录（2026-10-23）

项目绝对路径：`PROJECT_ROOT`。

## 本轮已落盘

- 真正小程序：`miniprogram/pages/shop/index.wxml`、`index.js`、`miniprogram/app.wxss`、`app.json`。
- 辅助预览：`preview/index.html`、`ui.css`、`ui.js`、`server.js`。
- 共用图片：`miniprogram/assets/` 下 7 张原创样例插画和 4 张原创导航图标。预览从此目录读取；小程序打包本地图片，不依赖外站图片。
- 首页从文字和 emoji 卡片改为猫狗导购横幅、四个圆角分类入口、两列商品图卡。奶油黄/白/近黑贯穿页面；底部统一四栏导航。
- 分类为左侧分类、右侧图文行；预览另有名称搜索及价格排序。详情使用大图、规格、数量、黑色加购和黄色购买操作，切换规格更新价格。
- 购物车、空状态、个人中心、地址、订单及商家工作台使用统一卡片、字号与间距。网页商家规格由 JSON 文本改成逐项填写名称、整数分价格和库存；真正小程序保留拍照/相册入口。
- 原业务核心、CloudBase 授权、订单状态与真实支付失败关闭逻辑未改动。原页面文件的备份位于 `.local/ui-before/`，未删除既有文件。

## 启动与验收

在项目目录执行（无需安装依赖）：

```powershell
node preview/server.js
node --test tests/*.test.js
node scripts/check.js
```

辅助预览：`http://127.0.0.1:4173/`。仅监听回环地址；当前服务已启动。刷新网页会清空浏览器内购物车和模拟商家身份，服务端模拟订单/地址保留至服务重启；没有真实付款。

真正小程序导入项目根目录，代码位于 `miniprogram/`，默认 `config.js` 为 mock。微信工具当前不能认定可自动编译，见下方限制。

## 本轮验证

自动测试 **47/47 通过**，包括原有 44 项，新增 3 项预览实际控制器测试：规格价格与结算发货链路、数量与库存错误显示、内容转义与买家商家接口隔离。`evidence/ui-regression.tap` 为本轮结果；JS/JSON 检查通过，共用 domain 副本仍同步。

原 44 项覆盖域逻辑（28）、适配器（3）、真实小程序页面处理器与模板绑定（4）、支付回调内部契约（4）、交付后复核（5）。原测试中“内嵌脚本解析”随预览拆分为独立 `ui.js` 更新读取位置，未删除或跳过测试。

在浏览器 390×844 窄屏实际点击：分类 → 猫粮详情 → 2kg 两件 → 购物车 ¥144 → 虚构地址 → 提交订单 ¥152（含快递 ¥8）→ 模拟付款 → 待发货 → 模拟商家 → 录入 DEMO123456 → 待收货 → 模拟轨迹。另检查商品编辑模板并保存，空购物车、个人中心均查看。

截图全部为**辅助网页**，不是微信模拟器：

- 改版前：`evidence/ui-before-home.jpg`
- 改版后：`ui-after-home.jpg`、`ui-after-category.jpg`、`ui-after-detail.jpg`、`ui-after-cart.jpg`、`ui-after-empty.jpg`、`ui-after-account.jpg`、`ui-after-order.jpg`、`ui-after-merchant.jpg`、`ui-after-editor.jpg`、`ui-after-tracking.jpg`（均在 evidence/）。

## 明确限制与阻碍

1. **指定 Library 素材尚未整合（失败，不是权限拒绝）**：素材包 `libfile_379c3f327ca88191807ee1b7a7e0cb0c` 能解析，官方传输助手在 Windows Python 的扩展属性步骤报 `AttributeError: module 'os' has no attribute 'setxattr'`，未生成最终 ZIP。没有用裸下载绕过技能要求。横幅 `libfile_0d6aef0360b08191bb470e62dbd25189`、分类 `libfile_abf505c75e1081919d011599b7fb3cdc`、空购物车 `libfile_bc4c4dcd5d488191a870386baf1183e9` 保留为后续替换目标；当前使用本项目原创简洁插画，并非已取得这些素材。后续需兼容 Windows 的官方落盘路径或用户提供可读本地文件。
2. **真实微信环境验收未完成（待解决）**：只读确认 `LOCAL_PATH` 存在，大小 202930736 字节，Authenticode 状态 Valid；`resources\app.asar.unpacked\js\common\cli\index.js` 存在。已读 cli.bat 会从大于 50MB 的 EXE 筛选 Electron；现存主程序满足大小条件。ACL 列出 Users/Authenticated Users 允许项，未见显式拒绝。以上不足以确定此前 `Access is denied`、`Cannot find Electron executable` 的根因。本轮没有重跑 CLI、启动工具、登录、改端口/防火墙或绕过限制。仍需在可用授权工具会话下导入、编译、模拟器及真机验收。
3. 本轮未实测微信图片上传、原生 picker、键盘避让、滚动与固定栏、安全区和不同基础库。WXML 结构/绑定测试不等同微信编译。
4. CloudBase 仍是可调用 SDK 的待配置实现，只通过 mock SDK 测试，未部署、未连接云数据库。真实支付/退款和真实物流供应商仍未接入，生产支付保持失败关闭。

浏览器曾因旧标签停在连接错误页无法继续；确认服务回环监听及 HTTP 响应后，同一浏览器新建标签成功，随后完成上述验收，没有改变网络或安全设置。

本轮未调用本机 codex CLI、pi 或额外模型 API，未读取登录凭据/API key；平台本身的额度归属不能从这些执行事实推断。
