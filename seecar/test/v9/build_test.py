# v9 UI 確認用の結合：src の index.html / style.css / ui.js と net.js に、他担当の部品は HEAD の写し（head_*.js）＋ shim.js
# 使い方: python build_test.py [real]   real を付けると src の部品をそのまま使う（shim は足りない関数だけ埋める）
import sys, pathlib
here = pathlib.Path(__file__).parent; src = here.parent.parent/'src'
real = len(sys.argv) > 1 and sys.argv[1] == 'real'
html = (src/'index.html').read_text(encoding='utf-8'); css = (src/'style.css').read_text(encoding='utf-8')
parts = []
for n in ['sfx', 'mapgen', 'seeker', 'world']:
    parts.append((n, (src/(n+'.js')) if real else (here/('head_'+n+'.js'))))
parts += [('net', src/'net.js'), ('shim', here/'shim.js'), ('ui', src/'ui.js')]
js = '\n'.join('// ===== %s =====\n' % n + p.read_text(encoding='utf-8') for n, p in parts)
out = html.replace('<!--STYLE-->', '<style>\n' + css + '\n</style>').replace('<!--SCRIPTS-->', '<script>\n' + js + '\n</script>')
o = here/('seecar_v9t%s.html' % ('_real' if real else '')); o.write_text(out, encoding='utf-8', newline='\n'); print(o, len(out.encode()))
