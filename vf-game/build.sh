#!/bin/sh
# three.js とゲーム本体を1つのHTMLファイルに埋め込む。使い方: ./build.sh 出力ファイル名
cd "$(dirname "$0")"
OUT="${1:-dist.html}"
python3 - "$OUT" <<'PY'
import sys
out = sys.argv[1]
t = open('src/template.html', encoding='utf-8').read()
three = open('lib/three.min.js', encoding='utf-8').read().replace('</script>', '<\\/script>')
game = open('src/game.js', encoding='utf-8').read().replace('</script>', '<\\/script>')
t = t.replace('/*THREE*/', 'THREE_PLACEHOLDER', 1).replace('/*GAME*/', 'GAME_PLACEHOLDER', 1)
t = t.replace('THREE_PLACEHOLDER', three, 1).replace('GAME_PLACEHOLDER', game, 1)
open(out, 'w', encoding='utf-8').write(t)
print('wrote', out, len(t), 'bytes')
PY
