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
- 高さは段数 0〜10 の整数（移動できる条件＝段数の差1以内、は変えない）。**見た目の1段の高さ `STEP_H = 0.2`**（*v3：0.5 から低くした*）。見た目の高さ `vis(h) = h<=1 ? 0 : (h-1)*STEP_H`。壁10段＝見た目 1.8（約2マス分）。戦車が段差を上り下りする高さ、弾の山なり、破片も同じ `vis()` を使う。
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
- `MapGen.presets` : `[{id, title, reading}]` 3件以上。四字熟語（例：日進月歩、三日坊主、四苦八苦 など「口」「日」のように閉じた部分がある字を含むもの）。*v3：「一石二鳥」は「鳥」が黒い塊につぶれるので「三日坊主」(id: mikka) に替えた。字ごとに太らせる量も変えられる（THIN）。*
- `MapGen.fromPreset(id)` → MapData（同期）。canvasに太い黒字の四字熟語を描き、余白にクレヨン風の落書きを入れてから解析。*v3：落書きの床の色は濃いめ（明るさ L>=0.86＝高さ0〜1）、約2割の落書きは「色の積み木」の色（高さ2〜6くらい）。字に囲まれた部分（宝の部屋）には積み木の色をかかない。宝は領域の中の低い所（高さ0〜1）に置く。スタートは、戦車が歩いて行ける（段差1以内）いちばん広い範囲の中に2つとも置く。*
- `MapGen.fromFile(file)` → Promise<MapData>。
- `MapGen.fromCanvas(canvas, title, reading)` → MapData（同期。上の2つの共通処理）。
- `MapGen.encode(map)` → JSONで送れる形（配列はbase64文字列）。`MapGen.decode(obj)` → MapData。
- 高さ：輝度 L（0..1、`0.299R+0.587G+0.114B`）から `h = round((1-L)*10)`。透明画素は白扱い。
- 宝：高さ10（真っ黒）だけを壁とみなし、壁でないマスを4近傍でつないだ領域のうち、地図の端に触れない領域を「囲まれた領域」とする。そのうち画像画素で4画素（＝16マス）未満は除外し、最小の領域を選ぶ。宝はその領域の重心に最も近い、領域内のマス。候補が無ければ、スタートから最も遠い到達可能マス。
- スタート：地図の端に触れる最大の非壁領域の中で、高さ0のマスを2つ（互いに離す）。**地図のふちから6マス以上内側**（置けなければ順に縮める）で、前に7マス以上進める向きがあり、宝へ向ける所。dir は宝の方向を向く（開けている向き優先）。 *(v2で追記)*

## window.World
```js
World.init(containerEl)          // レンダラー作成。containerEl にcanvasを入れ、サイズ追従
World.load(map, {myIndex, players:[{color:'#e53935'},{color:'#1e88e5'}], net:false})
World.start(); World.stop();     // ゲームループ開始/破棄
World.setPaused(bool); World.isPaused  // true の間は更新を止める（描画は続けてよい）
World.press(action, isDown)      // action: 'fwd'|'back'|'left'|'right'|'fire'
World.setCamera(mode)            // 0=1人称、1=斜め後ろ、2=俯瞰。滑らかに補間
World.cycleCamera() → 新しいmode
World.on(event, fn)              // 'found'(idx) / 'boom'(cells, remote) 着弾時 / 'state'(stateObj, 約10回/秒) / 'fire'({cells,from:{x,z,dir}}) 自分が撃った瞬間 / 'cam'(isTop) 俯瞰・開始演出の真上のあいだ true  *(v2：fire, cam を追加)*
World.applyRemoteState(idx, stateObj)
World.dropRemote(idx)             // 相手の戦車を消す *(v3)*
World.applyRemoteBoom(cells, from) // cells: [[x,z],...]。from（任意）={x,z,dir}（撃った戦車）があれば弾を山なりに飛ばしてから高さを0にし破片演出も出す。無ければすぐ壊す *(v2：from を追加)*
World.remoteFound(idx)
```
- stateObj：`{x, z, dir, color, anim}`（x,z はマス単位の小数、anim は 'idle'|'move'|'turn'|'fire'）。相手側は補間して表示。
- 移動はマス単位：まえ/うしろを押すと1マス分を約0.22秒で滑らかに移動。押し続けると連続。行き先との高さの差が1段以内なら進め、段差は滑らかに上下。ひだり/みぎは90度回転（約0.2秒）。ジャンプ無し。
- 大砲：0.8秒の間隔制限。黒い玉が放物線でdir方向2マス先の中心へ約0.6秒で飛ぶ。着弾で2マス先と3マス先（範囲内のみ）の高さを0にし、そのマスの色の破片を飛ばし、画面を少し揺らし、`boom` を発火。弾は戦車に当たらない。
- 宝：光る宝石（回転・上下）と、上空から見える光の柱。自分の戦車が宝のマスに入ったら `found`。
- 開始演出 *(v2)*：`World.load` のあと、まず真上（俯瞰）から地図全体と宝を約2秒見せ、そのあと約1.8秒で斜め後ろ（mode 1）へ滑らかに寄せる。操作はその間も受け付ける。`setCamera` で別の視点にしたら演出は終わる。
- 見た目の高さ *(v3)*：高さ0と1は床に塗った色（平ら。塗り色は少し鮮やかにして見せ、白は紙の白のまま）、2〜10が積み木（1段 STEP_H=0.2、壁10＝1.8）。積み木は上面も側面も地図の色で塗る（少し鮮やかに）。**黒に近い色（明るさ0.16未満）だけ**ほぼ真っ黒。破片もそのマスの色（黒い壁の破片は濃い灰色）。
- おいかけ視点（mode 1）*(v3)*：戦車の後ろ 3.4・上 4.4 から、前 2.2 の地面を見下ろす（約40度）。戦車（1.12倍）の全身が画面の下寄り中央に入り、前方の迷路が十数マス先まで見える。後ろに壁があるとき、戦車の頭を見る線がさえぎられないぶんだけカメラを持ち上げる（最大 +2.6）。
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
- メッセージ：`{t:'hello',color}`、`{t:'map',map:encoded}`、`{t:'st',s:stateObj}`、`{t:'boom',cells,from:{x,z,dir}}`（撃った瞬間に1回だけ送る。*v2：from を追加、送るのは着弾時でなく発射時*）、`{t:'found',idx}`、`{t:'bye'}`。地図は接続後に1回だけホストが送る。

## window.App（ui.js）
- 状態：'boot','title','setting','play','ending','quit'。`App.go(name)`。
- 画面の作り：`#stage`（16:9、中央、`container-type:size`、内側の寸法は cqmin/cqw/cqh）。最上位に `#nav`（進行ボタン共通コンテナ）と `#home`（右上の白い円、safe-area考慮）と `#modal`。縦持ち警告 `#portrait`。
- すべてのボタンは共通関数 `tap(el, fn)` で登録し、pointerdown で `e.stopPropagation(); e.preventDefault();`。押し続ける操作ボタンは pointerdown/pointerup/pointercancel/pointerleave で `World.press`。**例外**：ファイル選択の `<input type=file>` はボタンの上に透明に重ね、既定動作を止めない（止めると選択画面が開かないため）。
- カメラボタン *(v3)*：視点の名前は め／おいかけ／そら（移動の「うしろ」とかぶらない）。ボタンには「押したら次になる視点」だけを、絵と文字の両方で出す（絵＝次の視点の絵、文字＝「めへ」「おいかけへ」「そらへ」）。ゲスト（青）は戦車の絵も青。
- 相手が抜けたとき *(v3)*：`World.dropRemote(idx)` で相手の戦車を地図から消し、知らせ「あいてが いなくなったよ　ひとりで つづけよう」を大きく（約4.5秒）出してから、小さくしてプレイが終わるまで出し続ける。
- ホームボタンは起動画面（boot）でも出す *(v3)*。
- 表記：和語はひらがな、外来語はカタカナ。漢字は四字熟語の表示だけ（読みのひらがなを添える）。
- キーボード（PCでの確認用）：矢印/WASD、スペース=大砲、C=カメラ。
