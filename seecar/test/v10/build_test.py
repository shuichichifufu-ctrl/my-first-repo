# v10 UI 確認用の結合：src の部品を そのまま（build.py と同じ順）で test/v10/seecar_v10t.html に書き出す（dist は さわらない）
import pathlib
here = pathlib.Path(__file__).parent; src = here.parent.parent/'src'
html = (src/'index.html').read_text(encoding='utf-8'); css = (src/'style.css').read_text(encoding='utf-8')
order = ['sfx.js', 'mapgen.js', 'seeker.js', 'world.js', 'net.js', 'ui.js']
js = '\n'.join('// ===== %s =====\n' % n + (src/n).read_text(encoding='utf-8') for n in order)
out = html.replace('<!--STYLE-->', '<style>\n' + css + '\n</style>').replace('<!--SCRIPTS-->', '<script>\n' + js + '\n</script>')
o = here/'seecar_v10t.html'; o.write_text(out, encoding='utf-8', newline='\n'); print(o, len(out.encode()))
