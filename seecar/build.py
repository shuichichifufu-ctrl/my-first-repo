# 部品を1ファイルのHTMLに結合する: python3 build.py v1  → dist/seecar_v1.html
import sys, pathlib
root = pathlib.Path(__file__).parent
ver = sys.argv[1] if len(sys.argv) > 1 else 'dev'
html = (root/'src/index.html').read_text(encoding='utf-8')
css = (root/'src/style.css').read_text(encoding='utf-8')
order = ['sfx.js', 'mapgen.js', 'seeker.js', 'world.js', 'net.js', 'ui.js']
js = '\n'.join(f'// ===== {n} =====\n' + (root/'src'/n).read_text(encoding='utf-8') for n in order)
assert '<!--STYLE-->' in html and '<!--SCRIPTS-->' in html
out = html.replace('<!--STYLE-->', '<style>\n' + css + '\n</style>').replace('<!--SCRIPTS-->', '<script>\n' + js + '\n</script>')
p = root/'dist'/f'seecar_{ver}.html'; p.write_text(out, encoding='utf-8'); print(p, len(out.encode()), 'bytes')
