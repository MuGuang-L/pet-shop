> 最新增量（2026-10-24）：商家自传图片、11 张备选图库、7 个店铺图片位置、5 类商品模板与元售价已实现。55 项测试通过，40 文件检查通过。使用方法与实际验证范围见 [商家图片与模板升级](MERCHANT-STUDIO.md)。下方保留前轮记录。

# 视觉 v2 素材来源（2026-10-24）

当前使用七张 imagegen 原创 AI 示意图：hero-v2（猫狗首页）、food-v2（猫粮）、toy-v2（绳结）、care-v2（梳子）、cat-v2、dog-v2（分类与头像）、empty-v2（空购物车）。原始 PNG 位于 source-assets/，仅编码压缩的 JPEG 位于 miniprogram/assets/。图像不是实拍或真实商品包装，不承诺真实商品属性。

用户后续明确要求自行生图，允许以新图改善界面。旧 Library 原素材未下载成功，本轮没有冒称使用它们。旧 PNG 插画保留为历史资源及图片选择验收材料，主界面已改用 v2；导航图标沿用项目原有线性图标。

本轮搜索过宠物商城 UI 参考，包括 https://js.design/special/resource-tag/interface-design-of-pet-app.html 与 https://www.design006.com/detail-30762668704 。这些是检索参考线索；不声称逐页完整视觉审阅。奶油白/森林绿/鼠尾草绿的具体配色、摄影场景与页面组合为本项目制作，没有复制第三方品牌图。

以下是此前阶段的历史设计记录：

# 设计依据与素材来源

主参考为用户提供的商城录屏（父线程已抽帧），采用暖黄/白/黑、猫狗导购、四栏导航、左分类右商品、详情黑加购黄购买的结构，不复制品牌、宣传或会员积分业务。

已阅读设计参考，仅借鉴方法，不运行安装脚本、不复制品牌素材：

- Impeccable：https://impeccable.style/docs/impeccable/ 、https://impeccable.style/designing/ 。采用先明确风格/层级，再逐屏检查和打磨的流程。
- UI UX Pro Max 公开技能：https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/main/.claude/skills/ui-ux-pro-max/SKILL.md 。参考移动端信息层级、一致图标、对比度及表单标签建议。
- 移动宠物电商案例浏览：https://dribbble.com/search/pet-ecommerce-app 。仅作布局与图片占比研究，未复制作品。

本轮实际使用 `miniprogram/assets/*.png` 为本项目绘制的原创示意插画和线性图标，无第三方品牌、照片或图标包。可随项目使用及修改。`scripts/create-ui-art.py` 保留插画的可重建源代码；需要已安装 Pillow 才能重建，日常运行无需 Python/Pillow。

图像仅表示样例商品，不代表真实包装、品质或商品宣传。Library 提供的原创素材因官方落盘助手 Windows 兼容性问题未使用，详见 UI-REDESIGN-REPORT.md。原仓库许可证检查与未复用代码的说明继续见 THIRD_PARTY_NOTICES.md。
