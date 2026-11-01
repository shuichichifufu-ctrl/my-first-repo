# ほシーカー 部品の取り決め（全担当共通）

仕様は SPEC.md、採点表は RUBRIC.md。最終成果物は1ファイルHTML。部品は src/ に分けて書き、`python3 build.py vN` で dist/seecar_vN.html に結合する。

## ファイルと担当
| ファイル | 中身 | 公開する名前 |
|---|---|---|
| src/index.html | 骨組み。`<!--STYLE-->` と `<!--SCRIPTS-->` の印を置く。CDN読み込みは head に | ― |
| src/style.css | 全CSS | ― |
| src/sfx.js | WebAudioの合成効果音 | `window.Sfx` |
| src/mapgen.js | 画像→地図データ、宝の位置、既定地図 | `window.MapGen` |
| src/world.js | Three.jsの3D世界、戦車、操作、カメラ、大砲、破片 | `window.World` |
| src/net.js | PeerJS通信 | `window.Net` |
| src/ui.js | 6ステート、ボタン、モーダル、操作ボタン、全体の配線 | `window.App` |

結合順：sfx.js → mapgen.js → world.js → net.js → ui.js（各ファイルはIIFEで包み、グローバル汚染は上の名前だけ）。

CDN（この2つだけ。変えない）:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>
```
グローバル `THREE`（r128）と `Peer` を使う。ES modules は使わない。

## 座標と単位
- 地形は1×1のマスの格子。幅 `w`、奥行き `h`。添字は `i = z*w + x`。
- マス (x,z) の中心のワールド座標は `(x+0.5, y, z+0.5)`。
- 高さは段数 0〜10 の整数。1段のワールド高さ `STEP_H = 0.5`（壁10段＝5.0）。
- 向き `dir`：0=北(-z)、1=東(+x)、2=南(+z)、3=西(-x)。`DX=[0,1,0,-1]`、`DZ=[-1,0,1,0]`。
- 画像は長い辺が最大64画素になるよう縮小し、画像1画素＝2×2マス（仕様の「2×2のブロック」）。地形は最大128×128マス。

## MapData（地図データ）
```js
{
  w, h,                       // マス数
  heights: Uint8Array(w*h),   // 0..10
  colors: Uint8Array(w*h*3),  // 各マスの色(RGB)。元画像の色
  treasure: {x, z},           // 宝のマス
  starts: [{x,z,dir},{x,z,dir}], // 0=ホスト(ひとり用も0)、1=ゲスト。高さ0のマスで、宝の領域の外
  title: '日進月歩',           // 表示名
  reading: 'にっしんげっぽ',     // ひらがな読み（読み込み画像なら 'よみこんだ え'）
  picture: 'data:image/jpeg;base64,...' // みつけた！画面で見せる元画像（長辺512px以下）
}
```

## window.MapGen
- `MapGen.presets` : `[{id, title, reading}]` 3件以上。四字熟語（例：日進月歩、一石二鳥、四苦八苦 など「口」「日」のように閉じた部分がある字を含むもの）。
- `MapGen.fromPreset(id)` → MapData（同期）。canvasに太い黒字の四字熟語を描き、余白にクレヨン風の淡い色の落書き（明るい色＝低い段）を入れてから解析。
- `MapGen.fromFile(file)` → Promise<MapData>。
- `MapGen.fromCanvas(canvas, title, reading)` → MapData（同期。上の2つの共通処理）。
- `MapGen.encode(map)` → JSONで送れる形（配列はbase64文字列）。`MapGen.decode(obj)` → MapData。
- 高さ：輝度 L（0..1、`0.299R+0.587G+0.114B`）から `h = round((1-L)*10)`。透明画素は白扱い。
- 宝：高さ9以上を壁とみなし、壁でないマスを4近傍でつないだ領域のうち、地図の端に触れない領域を「囲まれた領域」とする。そのうち画像画素で4画素（＝16マス）未満は除外し、最小の領域を選ぶ。宝はその領域の重心に最も近い、領域内のマス。候補が無ければ、スタートから最も遠い到達可能マス。
- スタート：地図の端に触れる最大の非壁領域の中で、高さ0のマスを2つ（互いに離す）。

## window.World
```js
World.init(containerEl)          // レンダラー作成。containerEl にcanvasを入れ、サイズ追従
World.load(map, {myIndex, players:[{color:'#e53935'},{color:'#1e88e5'}], net:false})
World.start(); World.stop();     // ゲームループ開始/破棄
World.setPaused(bool); World.isPaused  // true の間は更新を止める（描画は続けてよい）
World.press(action, isDown)      // action: 'fwd'|'back'|'left'|'right'|'fire'
World.setCamera(mode)            // 0=1人称、1=斜め後ろ、2=俯瞰。滑らかに補間
World.cycleCamera() → 新しいmode
World.on(event, fn)              // 'found'(idx) / 'boom'(cells) / 'state'(stateObj, 約10回/秒)
World.applyRemoteState(idx, stateObj)
World.applyRemoteBoom(cells)     // cells: [[x,z],...] 高さを0にし、破片演出も出す
World.remoteFound(idx)
```
- stateObj：`{x, z, dir, color, anim}`（x,z はマス単位の小数、anim は 'idle'|'move'|'turn'|'fire'）。相手側は補間して表示。
- 移動はマス単位：まえ/うしろを押すと1マス分を約0.22秒で滑らかに移動。押し続けると連続。行き先との高さの差が1段以内なら進め、段差は滑らかに上下。ひだり/みぎは90度回転（約0.2秒）。ジャンプ無し。
- 大砲：0.8秒の間隔制限。黒い玉が放物線でdir方向2マス先の中心へ約0.6秒で飛ぶ。着弾で2マス先と3マス先（範囲内のみ）の高さを0にし、そのマスの色の破片を飛ばし、画面を少し揺らし、`boom` を発火。弾は戦車に当たらない。
- 宝：光る宝石（回転・上下）と、上空から見える光の柱。自分の戦車が宝のマスに入ったら `found`。
- 俯瞰カメラ：仕様は高さ20だが、地図全体が入らない場合は全体が入る高さまで上げる（全体と宝を把握するという仕様の目的を優先）。
- 描画量：地形の箱は InstancedMesh 1つ（色はインスタンスカラー）。高さ0の床も色付きで見せる。
- 効果音は `window.Sfx && Sfx.play(name)`（name: 'move','turn','fire','boom','found','tap','bump'）。

## window.Net
```js
Net.makeCode() → '4桁の数字'
Net.host(code) → Promise   // 部屋を作り待つ。ゲストが来たら 'open' 発火
Net.join(code) → Promise   // 部屋に入る。接続できたら resolve
Net.send(obj); Net.on('open'|'data'|'close'|'error', fn); Net.close();
Net.isHost; Net.connected
```
- PeerのIDは `'seecar-hoshi-' + code`。
- URLの `?peerhost=&peerport=&peerpath=&peersecure=0` があればその中継サーバーを使う（検査用）。無ければPeerJSの公開サーバー。
- 'error' には子ども向けの文（例：「つながらなかったよ。ばんごうを たしかめてね」）を渡す。
- メッセージ：`{t:'hello',color}`、`{t:'map',map:encoded}`、`{t:'st',s:stateObj}`、`{t:'boom',cells}`、`{t:'found',idx}`、`{t:'bye'}`。地図は接続後に1回だけホストが送る。

## window.App（ui.js）
- 状態：'boot','title','setting','play','ending','quit'。`App.go(name)`。
- 画面の作り：`#stage`（16:9、中央、`container-type:size`、内側の寸法は cqmin/cqw/cqh）。最上位に `#nav`（進行ボタン共通コンテナ）と `#home`（右上の白い円、safe-area考慮）と `#modal`。縦持ち警告 `#portrait`。
- すべてのボタンは共通関数 `tap(el, fn)` で登録し、pointerdown で `e.stopPropagation(); e.preventDefault();`。押し続ける操作ボタンは pointerdown/pointerup/pointercancel/pointerleave で `World.press`。**例外**：ファイル選択の `<input type=file>` はボタンの上に透明に重ね、既定動作を止めない（止めると選択画面が開かないため）。
- 表記：和語はひらがな、外来語はカタカナ。漢字は四字熟語の表示だけ（読みのひらがなを添える）。
- キーボード（PCでの確認用）：矢印/WASD、スペース=大砲、C=カメラ。
