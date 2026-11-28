"""Writes the app-icon pages from the brand SVGs, for rasterising with a headless browser.

    python exports/brand/make-icons.py DIR

See README.md in this folder for the Chromium command. Sizes: icon 1024 (paper ring on midnight,
ring 560 wide), favicon 48 (ring 32), Android foreground 512 (transparent, ring 236) and
monochrome 432 (transparent, ring 199), splash 1024 (midnight ring on paper, ring 500)."""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
INK, PAPER = '#0B1630', '#FFFFFF'

def ring_path(name):
    svg = open(os.path.join(HERE, name), encoding='utf-8').read()
    w, h = (float(x) for x in re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg).groups())
    return re.search(r'<path d="([^"]+)"', svg).group(1), w, h

ICONS = {
    'icon.png': (1024, INK, 'wally-mark-midnight.svg', 560),
    'favicon.png': (48, INK, 'wally-mark-midnight.svg', 32),
    'android-icon-foreground.png': (512, None, 'wally-mark-midnight.svg', 236),
    'android-icon-monochrome.png': (432, None, 'wally-mark-midnight.svg', 199),
    'splash-icon.png': (1024, PAPER, 'wally-mark-paper.svg', 500),
}

if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'icon-pages')
    os.makedirs(target, exist_ok=True)
    for name, (size, bg, source, gw) in ICONS.items():
        d, w, h = ring_path(source)
        fill = re.search(r'fill="(#[0-9A-Fa-f]{6})"', open(os.path.join(HERE, source), encoding='utf-8').read()).group(1)
        gh = gw * h / w
        body = (f'<svg viewBox="0 0 {w} {h}" width="{gw:.2f}" height="{gh:.2f}" style="position:absolute;left:{(size - gw) / 2:.2f}px;top:{(size - gh) / 2:.2f}px">'
                f'<path d="{d}" fill="{fill}" fill-rule="evenodd"/></svg>')
        page = f'<!doctype html><meta charset="utf-8"><style>html,body{{margin:0;width:{size}px;height:{size}px;overflow:hidden;background:{bg or "transparent"}}}</style>{body}'
        open(os.path.join(target, name.replace('.png', '.html')), 'w', encoding='utf-8').write(page)
    print('icon pages in', target)
