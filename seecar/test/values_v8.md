# seecar_v8.html 値の書き出し

対象: `/home/user/my-first-repo/seecar/dist/seecar_v8.html`（5068行）
行番号は上記ファイルの行番号（1始まり）。値は書かれている通りに写している。評価や合否は含まない。

---

## 1. 外部から読み込むURL・接続先

| 行 | 種類 | 値 |
|---|---|---|
| 10 | script src | `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js` |
| 11 | script src | `https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js` |
| 3789 | new Peer（接続先） | `new Peer('seecar-hoshi-' + code, peerOptions())`（部屋番号 `seecar-hoshi-` + 番号） |
| 3839 | new Peer（接続先） | `new Peer(peerOptions())` |
| 3682〜3695 | peerOptions（接続先の指定） | URLの `?peerhost=` `peerport` `peerpath` `peersecure` で指定可能。指定が無い場合は `{ debug: 0 }` のみで、接続先のURLはコード内に固定で書かれていない（PeerJSの既定値になる） |

- 行39: `data:image/svg+xml` の中に `http://www.w3.org/2000/svg`（SVGの名前空間の文字列。通信はしない）
- fetch・XMLHttpRequest・WebSocket・EventSource・import() は 0件
- `img.src` に入る値（1059, 4390, 4802）は読み込んだ画像のURL（ローカルのblob等）で、固定の外部URLは無し

---

## 2. ボタン類（キーワード一致のもの）

凡例: 「—」は指定なし。単位はCSSの値のまま。行番号は HTML行 / CSS行。

### 2-1. HTMLに書かれた button 要素

| 要素（id / class） | HTML行 | CSS行 | width | height | min-width / min-height | font-size |
|---|---|---|---|---|---|---|
| `#fwd`（すすむ）class=ctl | 426 | 271, 272 | 36cqmin | 36cqmin | — | span: 7.4cqmin（272）。i: 15cqmin × 17cqmin（272） |
| `#b-jump`（ジャンプ）class=ctl act | 427 | 273, 274 | 26cqmin | 26cqmin | — | span: 4cqmin（274）。i: 12.4cqmin × 12.4cqmin（274） |
| `#b-attack`（ドリルアタック）class=ctl act | 428 | 273, 274, 276 | 26cqmin | 26cqmin | — | span: 4cqmin（274）。i: 12.4cqmin × 12.4cqmin（274） |
| `#b-dj`（ドリルジャンプ）class=ctl act | 429 | 273, 274, 277 | 26cqmin | 26cqmin | — | span: 4cqmin（274）。i: 12.4cqmin × 12.4cqmin（274） |
| `#cam`（視点ボタン）| 430 | 280, 281, 283 | 15cqmin | 14cqmin | — | `#cam-label`: 3cqmin（283）。i: 8cqmin × 7.4cqmin（281） |
| `#home` | 455 | 95, 96, 97 | 12cqmin | 12cqmin | — | （文字なし）svg: 7.4cqmin × 7.4cqmin（97） |
| `#m-no`（いいえ）class=nbtn primary | 461 | 85, 86, 105 | 50cqmin（`.mbtns .nbtn`、105）、基本 64cqmin（85） | 16cqmin（85） | — | 6.4cqmin（86） |
| `#m-yes`（はい）class=nbtn secondary | 462 | 85, 86, 105 | 50cqmin（105）、基本 64cqmin（85） | 16cqmin（85） | — | 6.4cqmin（86） |
| `#c-host` class=bigcard | 383 | 157, 159 | 62cqmin（157） | 56cqmin（157） | — | 7.4cqmin（157） |
| `#c-join` class=bigcard | 387 | 157, 159 | 62cqmin（157） | 56cqmin（157） | — | 7.4cqmin（157） |
| `data-who="cpu"` class=bigcard | 354 | 157, 159 | 62cqmin（157） | 56cqmin（157） | — | 7.4cqmin（157） |
| `data-who="net"` class=bigcard | 355 | 157, 159 | 62cqmin（157） | 56cqmin（157） | — | 7.4cqmin（157） |
| `data-kind="race"` class=howcard | 348 | 147〜153 | flex:1、max-width 54cqmin | 70cqmin（147） | — | b: 4.9cqmin（152）。small: 3.3cqmin（153）。`.hpic` height 30cqmin（149） |
| `data-kind="count"` class=howcard | 349 | 147〜153 | flex:1、max-width 54cqmin | 70cqmin（147） | — | b: 4.9cqmin（152）。small: 3.3cqmin（153） |
| `data-kind="solo"` class=howcard | 350 | 147〜153 | flex:1、max-width 54cqmin | 70cqmin（147） | — | b: 4.9cqmin（152）。small: 3.3cqmin（153） |
| `data-level="easy"` class=lvcard | 359 | 214〜219 | flex:1、max-width 50cqmin（214） | 68cqmin（214） | 子要素 em: min-height 9.2cqmin（219） | b: 8cqmin（217）。small: 3.4cqmin（218）。em: 3.3cqmin（219）。`.lvpic` 26cqmin × 26cqmin（215） |
| `data-level="normal"` class=lvcard | 360 | 同上 | 同上 | 同上 | 同上 | 同上 |
| `data-level="hard"` class=lvcard | 361 | 同上 | 同上 | 同上 | 同上 | 同上 |

- 「ドリルアタック」「ドリルジャンプ」は `#b-attack` `#b-dj` の行（上表）。
- `.bigcard` の別指定: `.sub-who .bigcard` は width 74cqmin、font-size 5.8cqmin（159）。

### 2-2. JavaScriptで作られる button 要素

| 要素（class） | 作る行 | CSS行 | width | height | min | font-size |
|---|---|---|---|---|---|---|
| `.nbtn`（進行ボタン。#nav の中） | 4210〜4211 | 85〜90 | 64cqmin（85） | 16cqmin（85） | — | 6.4cqmin（86） |
| `.nbtn.hero` | 同上 | 118, 119 | 96cqmin | 20cqmin | — | 10cqmin |
| `.nbtn.sub` | 同上 | 122 | auto | 12.4cqmin | — | 4.7cqmin |
| `.nbtn i`（アイコン） | 同上 | 87 | 8cqmin | 8cqmin | — | — |
| `.card`（地図カード） | 4348〜4349 | 176, 193, 198〜201 | 指定なし | 指定なし（`.card.file` のみ 11.6cqmin、198） | — | `.kan`: 8.4cqmin（177）。`.card.yoji .kan`: 5.2cqmin（195）。`.card.illust .kan`: 4.8cqmin（196）。`.maps.dense` の yoji `.kan`: 4.3cqmin、illust `.kan`: 3.8cqmin（197）。`.card.file .kan`: 4.6cqmin（200）。`.card.file .bw`: 3cqmin（201）。`.yomi`: 2.2cqmin（178） |
| `.card .ic`（カードのアイコン） | — | 193 | 9cqmin | 9cqmin | — | — |
| `.maps.dense .card .ic` | — | 197 | 8cqmin | 8cqmin | — | — |
| `.card.file .ic` | — | 199 | 6.4cqmin | 6.4cqmin | — | — |
| `.key`（数字キー。#keypad の中） | 4513〜4516 | 204, 205, 206 | 指定なし（`.keypad` の列幅 18cqmin、行の高さ 13.4cqmin、204） | 同左 | — | 8cqmin（205）。`.key.del`: 4.8cqmin（206） |

### 2-3. 設定画面の中のボタン（キーワード「設定」は id・class に文字として無いため、設定画面 `#setting`（343行）の中にあるものを参考として記載）

| 要素 | HTML行 | CSS行 | width | height | min | font-size |
|---|---|---|---|---|---|---|
| `.seg button`（data-set。4個） | 367, 372 | 231 | flex:1 | 11.6cqmin（231） | — | 4.8cqmin（231） |
| `#reset-rec`（class=danger）| 378 | 231, 234 | flex:1（231） | 11.6cqmin（231） | — | 4.8cqmin（231） |

### 2-4. ボタンではないが、キーワードに一致する要素（参考）

| 要素 | 行 | CSS の値 |
|---|---|---|
| `#nav`（div） | 454, 83 | position absolute、left 0、right 0、bottom 4cqmin。width・height 指定なし |
| `#modal`（div） | 457, 100 | inset 0（全面）、z-index 200 |
| `.mcard` | 458, 102 | padding 6cqmin 6cqmin 7cqmin、border-radius 5cqmin |
| `.setcard`（div） | 365, 370, 375, 224 | min-height 0 |
| `#setting`（section） | 343 | position absolute、inset 0 |

### 2-5. 最小サイズ（min-width / min-height）の指定

- キーワード一致のボタン本体には min-width・min-height の指定なし。
- 子要素のみ: `.lvcard em` min-height 9.2cqmin（219）。
- 参考（キーワード外）: `.backbtn`（もどる）min-width 25cqmin（132）、height 12cqmin（132）。

---

## 3. CSS の font-size 指定（すべて、セレクタと値）

CSS内の font-size 指定は 58行。197行は2か所あるため、指定の合計は 59。

| 行 | セレクタ | font-size |
|---|---|---|
| 75 | `.touchme` | 7.4cqmin |
| 79 | `.bye` | 12cqmin |
| 86 | `.nbtn` | 6.4cqmin |
| 103 | `.mtitle` | 7.6cqmin |
| 112 | `.ptext` | 7.6vmin |
| 119 | `.nbtn.hero` | 10cqmin |
| 122 | `.nbtn.sub` | 4.7cqmin |
| 124 | `.recchip` | 3.2cqmin |
| 125 | `.recchip b, .endrec b` | 3.4cqmin |
| 130 | `.head` | 6.2cqmin |
| 133 | `.backbtn` | 4.8cqmin |
| 152 | `.howcard b` | 4.9cqmin |
| 153 | `.howcard small` | 3.3cqmin |
| 157 | `.bigcard` | 7.4cqmin |
| 159 | `.sub-who .bigcard` | 5.8cqmin |
| 167 | `.digits b` | 21cqmin |
| 169 | `.digits.grid2 b` | 17cqmin |
| 170 | `.waiting` | 6.4cqmin |
| 177 | `.card .kan` | 8.4cqmin |
| 178 | `.card .yomi` | 2.2cqmin |
| 180 | `.card input[type=file]` | 0 |
| 183 | `.preview .pt` | 5.8cqmin |
| 184 | `.preview .py` | 3.2cqmin |
| 185 | `.preview .hint` | 4.6cqmin |
| 190 | `.gl` | 3.8cqmin |
| 195 | `.card.yoji .kan` | 5.2cqmin |
| 196 | `.card.illust .kan` | 4.8cqmin |
| 197 | `.maps.dense .card.yoji .kan` | 4.3cqmin |
| 197 | `.maps.dense .card.illust .kan` | 3.8cqmin |
| 200 | `.card.file .kan` | 4.6cqmin |
| 201 | `.card.file .bw` | 3cqmin |
| 205 | `.key` | 8cqmin |
| 206 | `.key.del` | 4.8cqmin |
| 209 | `.msgtext` | 6.6cqmin |
| 217 | `.lvcard b` | 8cqmin |
| 218 | `.lvcard small` | 3.4cqmin |
| 219 | `.lvcard em` | 3.3cqmin |
| 226 | `.setcard.wide .sc-hint` | 3.6cqmin |
| 228 | `.sc-head` | 5.2cqmin |
| 231 | `.seg button` | 4.8cqmin |
| 235 | `.sc-hint` | 3.3cqmin |
| 248 | `#timer b` | 8.4cqmin |
| 251 | `.sb` | 4.2cqmin |
| 253 | `.sb b` | 5.4cqmin |
| 256 | `#maptag b` | 3.8cqmin |
| 256 | `#maptag small` | 2.4cqmin |
| 258 | `#notice` | 3.6cqmin |
| 260 | `#notice.big` | 6.4cqmin |
| 262 | `#pop` | 11cqmin |
| 272 | `#fwd span` | 7.4cqmin |
| 274 | `.ctl.act span` | 4cqmin |
| 283 | `#cam span#cam-label` | 3cqmin |
| 284 | `#tip` | 3.6cqmin |
| 294 | `.found` | 11.6cqmin |
| 297 | `.found.long` | 8.6cqmin |
| 300 | `.who` | 4.4cqmin |
| 302 | `.endrec` | 3.4cqmin |
| 304 | `.endrec b` | 3.3cqmin |
| 306 | `.endtitle` | 9cqmin |
| 307 | `.endyomi` | 3.8cqmin |

- JavaScriptの中の font-size（SVG文字列）: 4163行 `font-size="40"`、4164行 `font-size="150"`（SVG属性で、CSSではない）。

---

## 4. stopPropagation・preventDefault・addEventListener

### 4-1. stopPropagation を書いている行
- 4112行: `function stopEv(e) { e.stopPropagation(); e.preventDefault(); }`
- 4366行: ファイル選択欄の `pointerdown` `pointerup` で `e.stopPropagation(); unlock();`

（件数: 2行）

### 4-2. preventDefault を書いている行
4112, 4935, 4937, 4942, 4943, 4944, 4945, 4949, 4950, 4954, 4959, 4978, 4979, 5031

（件数: 14行）

- 4935〜4959 はキーボード処理（`onKeyDown`）の中。
- 4978・4979 は文書全体（`doc`）への登録の中。

### 4-3. addEventListener の一覧（行・イベント名・対象要素）

| 行 | イベント名 | 対象要素 |
|---|---|---|
| 2091 | resize | window |
| 3886 | pagehide | window |
| 4115 | pointerdown | `tap()` の el（ボタン全般） |
| 4116 | pointerup | `tap()` の el |
| 4121 | pointercancel | `tap()` の el |
| 4122 | pointerleave | `tap()` の el |
| 4123 | click | `tap()` の el |
| 4124 | contextmenu | `tap()` の el |
| 4140 | pointerdown | `hold()` の el（操作ボタン） |
| 4148 | pointerup | `hold()` の el |
| 4149 | pointercancel | `hold()` の el |
| 4150 | lostpointercapture | `hold()` の el |
| 4151 | click | `hold()` の el |
| 4152 | contextmenu | `hold()` の el |
| 4366 | pointerdown, pointerup | ファイル選択の input |
| 4367 | change | ファイル選択の input |
| 4978 | contextmenu | document |
| 4979 | gesturestart, gesturechange, gestureend, dblclick | document |
| 4980 | keydown | document |
| 4981 | keyup | document |
| 4982 | blur | window |
| 4986 | change（matchMedia `(orientation: portrait)`） | MediaQueryList |
| 5005 | pointerdown | `els.modal` |
| 5006 | pointerup | `els.modal` |
| 5007 | click | `els.modal` |
| 5024 | pointerdown | `els.swipe` |
| 5025 | pointermove | `els.swipe` |
| 5026 | pointerup | `els.swipe` |
| 5027 | pointercancel | `els.swipe` |
| 5028 | lostpointercapture | `els.swipe` |
| 5029 | click | `els.swipe` |
| 5030 | contextmenu | `els.swipe` |
| 5031 | touchstart, touchmove（passive: false） | `els.swipe` |
| 5063 | DOMContentLoaded | document |

- `tap()` の呼び出し先（5001〜5022、4214、4354、4518）: #boot, #home, #m-no, #m-yes, #back, #c-host, #c-join, els.cam, #reset-rec, `.seg button[data-set]`, `.lvcard`, `.howcard`, `.bigcard[data-who]`, `.nbtn`（進行ボタン）, `.card`（地図カード）, `.key`（数字キー）
- `hold()` の呼び出し先（5033）: `#fwd`, `#b-jump`, `#b-attack`, `#b-dj`

（addEventListener の行数: 34行）

---

## 5. `*` の規則、@media、100dvh・inset・aspect-ratio・container-type・safe-area-inset

### 5-1. `* {` の規則（16行）
```
*{user-select:none;-webkit-user-select:none;touch-action:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;box-sizing:border-box}
```

### 5-2. @media の条件
- 114行: `@media screen and (orientation: portrait)`（件数 1）

### 5-3. 100dvh の出現行
- 18行（body）、20行（#app）、26行（#stage）
（件数 3）

### 5-4. inset（CSSの inset プロパティ）の出現行
- 18, 20, 30, 38, 55, 60, 63, 100, 110, 180, 240, 311
（件数 12）
- 参考（CSSではない変数名）: 2566, 2569 行の `inset`（JavaScriptの変数）

### 5-5. aspect-ratio の出現行
- 0件（ファイル内に無し）

### 5-6. container-type の出現行
- 27行（`#stage`: `container-type:size`）
（件数 1）

### 5-7. safe-area-inset の出現行
- 95, 242, 271, 275, 276, 277, 280
（件数 7行。同じ行に複数回あるものを含む）
- 参考: 5行目の `viewport-fit=cover`（viewportのmeta）

---

## 6. 画面に表示される漢字を含む日本語の文字列

| 行 | 表示される文字列 | 表示される場所 |
|---|---|---|
| 9 | `見つけて！PixSee` | `<title>`（ブラウザのタブ名） |
| 4163 | `見つけて！` | ロゴ（SVG の text。タイトル画面） |
| 1101 | `自由自在` | 四字熟語の地図カード（`.kan` に入る。4352行で `p.title` を表示） |
| 1102 | `四方八方` | 同上 |
| 1103 | `品行方正` | 同上 |
| 1104 | `三日坊主` | 同上 |
| 1105 | `一日千秋` | 同上 |

表示されないもの（参考）:
- 4159行: `aria-label="見つけて！PixSee"`（読み上げ用のみ）
- 1116行: `THIN = { '鳥': 0, '麗': 0, '龍': 0, '自': 0, '由': 0, '在': 0 }`（四字熟語の画像を描く際の字ごとの太さ設定。文字としては表示されない）
- 2312行: `throw new Error('World.init を先に呼んでください')`（例外メッセージ）

（注）1101〜1105行の四字熟語は、画像としても 1125行 `def.title.split('')` で字ごとに描かれる。

- 表示文字列のうち漢字を含むものは、上記 7行（9, 1101〜1105, 4163）。

---

## 7. 指定語の出現（画面に出る文字列の中）

検索語: たたか, バトル, たいけつ, 対決, 対戦, 勝負, 大砲, うつ, 戦車, ドゴォ, かち, まけ, 勝, 負

- 出現件数: 0件（ファイル全体で一致なし。Python と grep の両方で確認）

---

## 8. localStorage

### 8-1. キー名
| キー名 | 定義行 |
|---|---|
| `pixsee.settings` | 3926（`KEY_SET`） |
| `pixsee.record` | 3926（`KEY_REC`） |

（件数 2）

### 8-2. 読み書きの行
| 行 | 内容 |
|---|---|
| 3927 | `lsGet(k)`: `window.localStorage.getItem(k)` |
| 3928 | `lsSet(k, v)`: `window.localStorage.setItem(k, v)` |
| 3929 | `readJSON(k)`: `lsGet` で読んで JSON.parse |
| 3932 | `loadSettings()` 内で `readJSON(KEY_SET)` |
| 3948 | `loadRecord()` 内で `readJSON(KEY_REC)` |
| 3960 | `saveSettings()`: `lsSet(KEY_SET, JSON.stringify(settings))` |
| 3961 | `saveRecord()`: `lsSet(KEY_REC, JSON.stringify(record))` |

- 読み込みの呼び出し: 4989行 `settings = loadSettings(); record = loadRecord();`
- 保存の呼び出し: `saveSettings()` は 4291行・4310行、`saveRecord()` は 4316行（記録の消去）・4813行・4819行・4823行

### 8-3. try/catch
- あり。3927行（lsGet）、3928行（lsSet）、3929行（readJSON）の3関数すべてに `try { … } catch` がある。

---

## 9. 数値が書かれている行

### 9-1. CPUの難しさごとの数値（1606〜1611行）
| 行 | 項目 | やさしい（easy） | ふつう（normal） | むずかしい（hard） |
|---|---|---|---|---|
| 1607〜1609 | CPU_LV | speed 0.9、turn 2.4、pause 0.6、doubt 0.12 | speed 1.6、turn 4.2、pause 0.25、doubt 0.03 | speed 2.4、turn 7.5、pause 0.06、doubt 0 |
| 1611 | CPU_WAIT0 | 0.4（開始演出のあと動き出すまでの秒数。全難易度共通） | | |
| 2355 | CPU の初期 style | easy は `'jump'`、それ以外は `'front'` | | |
| 3164 | まよう時の停止 | `ai.cfg.pause * 1.5`（doubt の判定時） | | |
- 1606行: CPU の速さ（マス/秒）・回る速さ・動作のあとの間（秒）・まよう割合

### 9-2. ジャンプ・移動の速さ（1259〜1603行）
| 行 | 名前 | 値 |
|---|---|---|
| 1259 | SPEED_REF | 3.2（移動=1のときの速さ） |
| 1593 | SPEED（すすむ） | 2.4 マス/秒 |
| 1594 | AIR_SPEED | 2.4（空中で前へ進む速さ） |
| 1595 | KEY_TURN | 2.6（ラジアン/秒） |
| 1596 | SWIPE_GAIN | Math.PI（画面幅いっぱいで半回転） |
| 1598 | GRAV | 22（ジャンプの重さ） |
| 1599 | JUMP_UP | 5（乗れる段数） |
| 1600 | JUMP_EXTRA | 0.08 |
| 1601 | CROUCH | 0.13（跳ぶ前の凹み時間） |
| 2924 | ジャンプの頂点 | `vis(a.lv + JUMP_UP) + JUMP_EXTRA` |
| 3047 | 先行入力 | 0.15 |
| 1982 | 速さの初期値 | `speed: SPEED` |

### 9-3. ソナーの半径（3543〜3551行、3904〜3906行、242・417行）
| 行 | 名前 | 値 |
|---|---|---|
| 3544〜3545 | `sonar(radius)` の既定値 | `radius == null ? 10` |
| 3905 | SONAR_R（ソナーの半径、ブロック数） | 10 |
| 3906 | SONAR_FAR（円の外の宝の方向を調べる半径） | 200 |
| 242 | `#sonar` の大きさ | width 30cqmin、height 30cqmin |
| 417 | `#sonar-cv` | width 288、height 288 |

### 9-4. 制限時間（10分）
| 行 | 内容 |
|---|---|
| 3904 | `COUNT_SEC = 600`（どっちが おおい？ の じかん。10分） |
| 4107 | `timeLeft = COUNT_SEC` の初期化 |
| 4580 | 開始時 `timeLeft = COUNT_SEC` |
| 4695 | 残り30秒以下で表示を `low` にする（`sec <= 30`） |
| 4702〜4704 | 毎フレーム減らし、0 以下で `endCount(false)` |
| 349 | 画面の文字「10ぷんで」 |

### 9-5. 結果までの待ち時間
| 行 | 内容 |
|---|---|
| 3907 | `END_DELAY = 1600`（宝を拾ってから結果へ行くまでの ミリ秒） |
| 4666〜4670 | `endTimer = setTimeout(…, END_DELAY)` |
| 1618 | GEM_FLY = 0.85（拾った宝石がシーカーへ飛ぶ時間。コメントに「約1.6秒」） |
| 288〜289 | `body.endwait` 中は操作ボタンを薄くして押せなくする |

---

以上。
