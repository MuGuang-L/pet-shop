# KIGI 温馨手绘主题

以店主提供的猫咪咖啡师、烘焙小狗图片为风格参考。奶油纸底、可可棕色线条、焦糖与蜂蜜色块、蜡笔颗粒贯穿首页、逛店、购物车、个人中心、储值与订单页面。此次用户已明确允许整体样式调整。

## 素材

`source-assets/cozy/` 保留生成原图和清单；`miniprogram/assets/` 是压缩后的运行资源。猫咪、狗狗、空购物车、咖啡、烘焙、猫狗用品、梳子、宠物窝及四个导航图标均为栅格插画。原有官方标志保留；商家上传的实际商品照片不改写。

旧内置图片路径继续有效，替换为同类型插画，避免旧商品记录和订单快照引用失效。烘焙模板使用单独的面包插画，补齐此前缺失的猫狗入口资源。原图不进入小程序运行包。共 22 张新生成插画和 1 张参考主图，运行图片合计约 0.95 MB。

生成方式：内置 imagegen，每个素材单独生成，以用户主图为风格参考。共同约束：暖奶油纸张、深棕不规则彩铅轮廓、蜡笔质感、焦糖色、可爱绘本气质、移动端清晰、无文字和水印；每张的物件用途见 `manifest.json` 的 id。

压缩再生成：`node scripts/cozy-assets.cjs`。脚本只读取本地原图，不发起图像生成请求。

2026-11-03 上传包瘦身后，运行图片约 0.56 MiB；此前的 0.95 MB 为最初验收体积。细分类补齐时新增 `source-assets/cozy/croissant.png`，用作 `catalog-bakery.jpg`；原面包组合原稿保留。生成使用内置 imagegen，参考原烘焙图风格。提示词：方形商品插画，一只金黄黄油可颂放在带小爪印的奶油色陶瓷盘上，焦糖格纹餐巾与两颗小星星；暖奶油纸底、彩铅蜡笔颗粒、深可可不规则轮廓、绘本风，主体居中占七成，无文字、价格、品牌和水印。

分类检查：`node scripts/catalog-coverage.cjs <merchantProducts.json>`，检查咖啡、烘焙以及猫狗各五类的上架商品、库存和配图；发现缺口时返回非零退出码。历史商品快照只能用于准备，不能据此声称当前云端齐全。

## iPhone 视觉修正

咖啡烘焙、会员、自提及快递入口的斜箭头改用 WXSS 线条绘制，不再依赖可能显示为蓝色表情的箭头字符。猫狗入口 PNG 使用透明底切图，避免图片的奶油纸底与卡片底色形成方块。原图保留，`manifest.json` 的 `cutoutOriginal` 指向透明原稿；压缩脚本在生成 PNG 时保留 alpha，旧 JPG 仍从有背景原稿生成。

透明图编辑使用内置 imagegen。提示词：仅移除原插画的整块奶油纸背景，输出真实透明 PNG；保留原猫咪/狗狗的造型、表情、衣服、配色、彩铅蜡笔纹理及小星星；毛色和帽子内部保持不透明，星星和胡须之间也应透明，不绘制棋盘格或新的矩形底色。

## 字体与样式

标题使用 ZCOOL KuaiLe（站酷快乐体）的 UI 字符子集，以 WOFF2 内嵌在 WXSS 中，无需远程字体服务。价格、商品名称、正文、订单号码保持常规清晰字体；新增且未收录的标题字符会回退到系统字体。

字体原版与 SIL OFL 1.1 许可位于 `source-assets/cozy/fonts/`，源自 Google Fonts 的 `ofl/zcoolkuaile`。重建：`python scripts/cozy-font.py`（需要 fontTools 与 Brotli）。

主题样式源稿在 `source-assets/cozy/theme.wxss`，已应用到 `miniprogram/app.wxss` 末尾；页面局部主题规则位于各自 WXSS 末尾。修改主题时同步源稿与应用样式。

## 验证与发布

- Node 语法和 JSON 检查、共享模块同步检查通过。
- 全套回归：379 通过、41 跳过、0 失败；跳过项未作为已验证功能报告。
- 使用本机微信 WXML / WXSS 编译器验证页面和字体样式；开发者工具实际检查首页、咖啡分类、购物车、个人中心与订单列表，返回导航正常。
- 此次不修改支付、余额、订单状态或数据库逻辑。
- 本地预览更新不等于手机体验版更新，重新上传和发布需另行执行。

### 全图片背景审查（2026-11-03）

逐张查看 assets 目录原有 39 张图片及新增透明 Logo，并在开发工具首页、个人中心查看实际叠放效果。商品图及横幅保留完整插画背景；猫狗入口、四个导航图标、空状态图和 Logo 使用真正透明 PNG，保留旧 JPEG 路径兼容历史配置。透明源图保存在 source-assets/cozy/*-transparent.png，运行图由 scripts/cozy-assets.cjs 压缩生成。

修复配送卡片第二项旧 nth-child 灰底覆盖；导航选中背景改为 #fff3dc。空状态和 Logo 的旧配置解析到新资源，自定义远程图片保持原值。所有箭头不再使用容易变成 emoji 的 ↗ 字符。

生成工具：内置 image_gen，transparent_background=true。导航及空状态提示词：Remove only the cream paper background from this existing illustration to genuine transparent alpha. Preserve exact illustration, composition, size, colors, crayon texture and opaque cream fills INSIDE the subject. Make spaces around and between the subject and detached details transparent including handle holes. No background square, no halo, no checkerboard. This is a mini program UI overlay icon.

Logo 提示词：Remove only the pure white background from this official logo, output genuine transparent alpha. Preserve EXACT logo lettering KIGIwish and Chinese 奇迹味时, all shapes, orange color, spacing and positions and square canvas. Do not redraw or reinterpret any glyph. White negative spaces between letters and outside logo must be transparent. No shadow, no new border, no checkerboard.

验证：159 文件语法/JSON 检查、studio 8 项测试、WXML/WXSS 官方编译器通过。8 张主要叠放资源均含有效 alpha，assets 总量 535620 bytes。开发工具首页与个人中心确认无猫狗/导航/Logo 方块、配送卡片为浅色；手机体验版需用户重新上传后复核，未宣称已完成真实 iPhone 回归。
