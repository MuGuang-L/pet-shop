"""Build an offline UI-title subset of the OFL-licensed ZCOOL KuaiLe font."""
from pathlib import Path
from fontTools import subset
import base64

root = Path(__file__).resolve().parent.parent
characters = set('KIGI Space CLUB 0123456789咖啡烘焙猫咪狗狗奇迹空间会员储值我的订单购物车')
for directory in ['miniprogram/pages', 'cloudfunctions/shop']:
    for path in (root / directory).rglob('*'):
        if path.suffix in ['.wxml', '.js']:
            characters.update(path.read_text(encoding='utf-8'))
options = subset.Options()
options.flavor = 'woff2'
font = subset.load_font(str(root / 'source-assets/cozy/fonts/ZCOOLKuaiLe-Regular.ttf'), options)
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=''.join(sorted(characters)))
subsetter.subset(font)
out = root / 'source-assets/cozy/fonts/kigi-title.woff2'
subset.save_font(font, str(out), options)
encoded = base64.b64encode(out.read_bytes()).decode('ascii')
styles = root / 'miniprogram/styles'
styles.mkdir(exist_ok=True)
(styles / 'cozy-font.wxss').write_text(
    "/* ZCOOL KuaiLe, SIL OFL 1.1; title glyph subset. Regenerate: python scripts/cozy-font.py */\n"
    "@font-face{font-family:KigiTitle;src:url('data:font/woff2;base64," + encoded + "') format('woff2');font-weight:400;font-style:normal;font-display:swap}\n",
    encoding='utf-8')
print('Embedded title font:', len(encoded), 'base64 bytes')
