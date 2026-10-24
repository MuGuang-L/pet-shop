# 参考来源与许可证核查

检查日期：2026-10-23。

参考仓库：https://github.com/EastWorld/wechat-app-mall ，检查的是可公开访问的 master 内容，未克隆、未固定提交号，因此该记录不是后续版本的法律判断。

实际检查：

- https://raw.githubusercontent.com/EastWorld/wechat-app-mall/master/LICENSE ：文本为 Apache License 2.0。
- https://raw.githubusercontent.com/EastWorld/wechat-app-mall/master/README.md ：徽标文字写 MIT，并说明配套 api工厂后台。
- https://raw.githubusercontent.com/EastWorld/wechat-app-mall/master/package.json ：license 为 ISC，依赖含 apifm-wxapi，test 是失败占位命令。

这些声明不一致，不能据此认定所有代码/图片/依赖的许可范围。本项目没有复制该仓库源代码、页面、组件、图片、图标、商标、依赖包或支付组件，仅参考公开的通用商城流程。本项目所有业务与 UI 源码重新编写，因此没有被复用上游文件的适用声明需要嵌入。没有 api工厂接口、SDK 或管理后台依赖。

用户参考录屏只用于白底暖黄、圆角、底部四栏、分类列表及购买流程的视觉方向，不复制品牌、图片、会员/积分/充值业务。爪爪小铺名称和全部商品均明确标记为虚构样例。

当前本地开发/测试零第三方运行依赖，图形用 Unicode 符号和原创 CSS。待部署云函数声明官方 wx-server-sdk；未安装或打包其代码，后续安装时需要保留实际版本 LICENSE 和锁文件。若后续复制任何外部代码或素材，须重新核对其明确许可并保留相应版权、许可证和修改声明。

## 2026-10-24 固定提交复核

已浅克隆并审阅 EastWorld/wechat-app-mall 提交 5521ebf8bfa792903379e4d81b473a19da5b30c8；具体文件依赖与适配结论见 UPSTREAM-COMPATIBILITY.md。仍未复制上游代码或素材。本项目新增 mongodb 6.21.0 官方驱动，以及 mongodb-memory-server-core 10.4.3 开发环境工具，实际版本记录于 package-lock.json；不再适用早期“零第三方运行依赖”的描述。
