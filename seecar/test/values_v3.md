# seecar_v3.html の値の書き出し

対象: /home/user/my-first-repo/seecar/dist/seecar_v3.html（2987行）
行番号は同ファイルの行番号。値だけを書き、評価はしていない。

---

## 1. 外部から読み込むURL

| 行 | 種類 | 値 |
|---|---|---|
| 10 | script src | https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js |
| 11 | script src | https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js |

- link href: 0件
- fetch: 0件
- WebSocket / XMLHttpRequest / sendBeacon / window.open: 0件
- new Peer の接続先（ファイル内に固定のURLはなし）
  - 2288行 `new Peer('seecar-hoshi-' + code, peerOptions())`（へや作成）
  - 2338行 `new Peer(peerOptions())`（へやに はいる）
  - peerOptions()（2181〜2192行）は URLの ?クエリ で接続先を変えられる。指定がなければ host は設定されない（PeerJS ライブラリ側の既定の接続先になる）。
    - 2185行 `peerhost` → o.host
    - 2187行 `peerport` → o.port（数値に変換）
    - 2188行 `peerpath` → o.path
    - 2189行 `peersecure`（"0" で false、"1" で true、それ以外は location.protocol が https: かどうか）→ o.secure
    - 2184行 `debug: 0`
- 動的に設定される img src（固定のURLではない）
  - 771行 `URL.createObjectURL(file)`（選んだ画像。blob: URL）
  - 786行 `img.src = url`
  - 2605行 `img.src = sel.map.picture`
  - 2851行 `els.endPic.src = m.picture`
- 37行の `url("data:image/svg+xml;...")` は CSS 内の data: URI（外部ではない）。SVG の xmlns 文字列 `http://www.w3.org/2000/svg` は名前空間の文字列で、読み込みは発生しない。

件数: script src 2件 / link href 0件 / fetch 0件 / new Peer 2箇所（+ URLパラメータ 4種）/ 動的 img src 4箇所

---

## 2. ボタン類のサイズ（CSS）

単位は指定のまま。「未指定」は、そのCSSに該当の指定がないこと。

### 2-1. HTML にある button 要素（12件）

| 要素 | 行 | width | height | min-width | font-size | 備考 |
|---|---|---|---|---|---|---|
| #back（.backbtn） | 136〜137 | 未指定 | 12cqmin | 25cqmin | 4.8cqmin | padding 0 3cqmin |
| #c-host（.bigcard） | 143〜144 | 62cqmin | 50cqmin | 未指定 | 7.4cqmin | svg 24cqmin × 24cqmin |
| #c-join（.bigcard） | 143〜144 | 62cqmin | 50cqmin | 未指定 | 7.4cqmin | svg 24cqmin × 24cqmin |
| #dpad の 4 ボタン（.ctl） | 199〜202 | 未指定（親グリッド: 列 15cqmin / 行 15cqmin） | 未指定（同上） | 未指定 | span 3.2cqmin | svg 6.6cqmin |
| #fire（.ctl） | 206〜208 | 31cqmin | 31cqmin | 未指定 | span 5.6cqmin | svg 16cqmin |
| #cam | 210〜216 | 30cqmin | 20cqmin | 未指定 | #cam-label 4.4cqmin | i 12.4cqmin / i.next 8cqmin |
| #home | 111〜113 | 12cqmin | 12cqmin | 未指定 | 未指定 | svg 7.4cqmin |
| #m-no（.nbtn.primary） | 101〜102, 122 | 44cqmin（.mbtns .nbtn が 64cqmin を上書き） | 16cqmin | 未指定 | 6.4cqmin | i 8cqmin |
| #m-yes（.nbtn.secondary） | 101〜102, 122 | 44cqmin（同上） | 16cqmin | 未指定 | 6.4cqmin | i 8cqmin |

- #dpad の 4 ボタン: 2-1 の表では「#dpad の 4 ボタン」を 1 行にまとめている（data-act = fwd / left / right / back）。
- 件数: HTML の button 要素 12件（#back, #c-host, #c-join, #dpad の 4件, #fire, #cam, #home, #m-no, #m-yes）

### 2-2. JavaScript で作る button 要素（3種類）

| 要素 | 作成行 | width | height | min-width | font-size | 備考 |
|---|---|---|---|---|---|---|
| #nav の .nbtn | 2522〜2523 | 64cqmin（.nbtn） | 16cqmin | 未指定 | 6.4cqmin | i 8cqmin × 8cqmin |
| .card（地図えらびのカード） | 2569〜2570 | 未指定（.pickgrid の列 repeat(var(--cols,2),1fr)、行 1fr） | 未指定（同上） | 未指定 | .kan 8.4cqmin / .yomi 3.5cqmin（.pickgrid.c3 のとき .kan 6cqmin / .yomi 2.8cqmin）/ .card.file .kan 4.2cqmin | .card.file svg 11cqmin |
| .key（数字キー） | 2726〜2729 | 未指定（.keypad の列 18cqmin） | 13.4cqmin（.keypad の行の高さ） | 未指定 | 8cqmin / .key.del 4.8cqmin | gap 1.4cqmin |

- 件数: JavaScript で作る button の種類 3種類（.nbtn, .card, .key）

### 2-3. min-width / min-height / max-width / max-height の指定

- 136行 `.backbtn` min-width: 25cqmin
- 157行 `.pickgrid` min-width: 0
- 169行 `.preview` min-width: 0
- min-height: 0件
- 170行 `.preview img` max-width: 100% / max-height: 38cqmin
- 184行 `.msgtext` max-width: 150cqmin
- 195行 `#notice.big` max-width: 84cqmin
- 233行 `.endpic img` max-width: 100% / max-height: 100%

件数: min-width 3件 / min-height 0件

### 2-4. 「#home.down」「#cam.down」など押下時の指定（108行）

`.nbtn.down,.ctl.down,.card.down,.bigcard.down,.key.down,.backbtn.down,#home.down,#cam.down{animation:none;transform:translateY(.7cqmin) scale(.95);filter:brightness(.92)}`

---

## 3. CSS の font-size の指定値（すべて）

39件（37行。161行と191行はそれぞれ2件）

| 行 | セレクタ | 値 |
|---|---|---|
| 71 | .logo-top | calc(var(--k)*6.6cqmin) |
| 75 | .logo-name | calc(var(--k)*17cqmin) |
| 79 | .logo-en | calc(var(--k)*5.6cqmin) |
| 86 | .star b | calc(var(--k)*14cqmin) |
| 92 | .touchme | 7.4cqmin |
| 96 | .bye | 12cqmin |
| 102 | .nbtn | 6.4cqmin |
| 120 | .mtitle | 9cqmin |
| 129 | .ptext | 7.6vmin |
| 134 | .head | 6.4cqmin |
| 137 | .backbtn | 4.8cqmin |
| 143 | .bigcard | 7.4cqmin |
| 149 | .digits b | 21cqmin |
| 151 | .digits.grid2 b | 17cqmin |
| 152 | .waiting | 6.4cqmin |
| 159 | .card .kan | 8.4cqmin |
| 160 | .card .yomi | 3.5cqmin |
| 161 | .pickgrid.c3 .kan | 6cqmin |
| 161 | .pickgrid.c3 .yomi | 2.8cqmin |
| 167 | .card.file .kan | 4.2cqmin |
| 168 | .card input[type=file] | 0 |
| 171 | .preview .pt | 7cqmin |
| 172 | .preview .py | 3.6cqmin |
| 173 | .preview .hint | 6cqmin |
| 179 | .key | 8cqmin |
| 180 | .key.del | 4.8cqmin |
| 184 | .msgtext | 6.6cqmin |
| 191 | #maptag b | 4.4cqmin |
| 191 | #maptag small | 2.4cqmin |
| 193 | #notice | 3.6cqmin |
| 195 | #notice.big | 6.4cqmin |
| 202 | #dpad .ctl span | 3.2cqmin |
| 208 | #fire span | 5.6cqmin |
| 216 | #cam span#cam-label | 4.4cqmin |
| 217 | #boom | 20cqmin |
| 226 | .found | 17cqmin |
| 228 | .who | 5.4cqmin |
| 230 | .endtitle | 11cqmin |
| 231 | .endyomi | 4.6cqmin |

- JavaScript 内の font-size 指定（style への直接代入）: 0件（ファイル全体の "font-size" 出現は37行、すべてCSS）

---

## 4. stopPropagation / preventDefault と addEventListener

### 4-1. stopPropagation

- 2449行 `function stopEv(e) { e.stopPropagation(); e.preventDefault(); }`
- 2581行 `['pointerdown', 'pointerup'].forEach(... e.stopPropagation(); unlock(); ...)`（ファイル選択欄 input[type=file]）

件数: 2行

### 4-2. preventDefault

- 2449行（stopEv 内）
- 2892行 onKeyDown（state=boot のとき）
- 2894行 onKeyDown（Escape、設定中のモーダル）
- 2899行 onKeyDown（操作キー）
- 2900行 onKeyDown（c キー）
- 2901行 onKeyDown（Escape、モーダルを開く）
- 2905行 onKeyDown（数字キー）
- 2906行 onKeyDown（Backspace）
- 2910行 onKeyDown（Enter）
- 2915行 onKeyUp（操作キー）
- 2932行 document の contextmenu
- 2933行 document の gesturestart / gesturechange / gestureend / dblclick

件数: 12行（2449行を含む）

### 4-3. addEventListener（登録されているイベント名と対象）

| 行 | イベント名 | 対象 |
|---|---|---|
| 1282 | resize | window（S.onWinResize） |
| 2385 | pagehide | window（try 内） |
| 2452 | pointerdown | tap() に渡した要素（下記の一覧） |
| 2453 | pointerup | tap() に渡した要素 |
| 2458 | pointercancel | tap() に渡した要素 |
| 2459 | pointerleave | tap() に渡した要素 |
| 2460 | click | tap() に渡した要素（stopEv） |
| 2461 | contextmenu | tap() に渡した要素（stopEv） |
| 2475 | pointerdown | hold() に渡した要素（.ctl[data-act]） |
| 2477 | pointerup | hold() に渡した要素 |
| 2478 | pointercancel | hold() に渡した要素 |
| 2479 | pointerleave | hold() に渡した要素 |
| 2480 | click | hold() に渡した要素（stopEv） |
| 2481 | contextmenu | hold() に渡した要素（stopEv） |
| 2581 | pointerdown | input[type=file]（ファイル選択欄） |
| 2581 | pointerup | input[type=file] |
| 2582 | change | input[type=file] |
| 2932 | contextmenu | document |
| 2933 | gesturestart | document |
| 2933 | gesturechange | document |
| 2933 | gestureend | document |
| 2933 | dblclick | document |
| 2934 | keydown | document（onKeyDown） |
| 2935 | keyup | document（onKeyUp） |
| 2936 | blur | window（releaseAll） |
| 2940 | change | matchMedia('(orientation: portrait)') の結果（addListener の代替も 2940 行にあり） |
| 2953 | pointerdown | #modal（stopEv） |
| 2954 | pointerup | #modal（stopEv） |
| 2955 | click | #modal（stopEv） |
| 2982 | DOMContentLoaded | document（readyState が loading のときだけ） |

tap() の対象（2949〜2959行）: #boot（leaveBoot）, #home（openModal）, #m-no（closeModal）, #m-yes（quitYes）, #back（backFromSetting）, #c-host（startHost）, #c-join（startJoin）, #cam（cycleCam）。さらに JavaScript で作る要素: #nav の .nbtn（2526行）、.card（2573行）、.key（2731行）。

hold() の対象（2961行）: `.ctl[data-act]` すべて（#dpad の 4 ボタンと #fire）。

件数: addEventListener の登録名 30件（行数では 26行。2581, 2933 は1行で複数登録）

---

## 5. CSS の確認項目

### 5-1. `*` の規則（14行）

`*{user-select:none;-webkit-user-select:none;touch-action:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;box-sizing:border-box}`

（ファイル内では `*{` の形で書かれている。スペースは入っていない）

### 5-2. @media の条件

- 131行 `@media screen and (orientation: portrait){#portrait{display:flex}}`
- 条件: `screen and (orientation: portrait)`
- 件数: 1件

### 5-3. 100dvh の出現行

- 16行（body の height: 100dvh）
- 18行（#app の height: 100dvh）
- 24行（#stage の width: min(100dvh ...) と height: min(100dvh, 56.25vw)）
- 件数: 3行（100dvh の直前の 100vh は 16, 18, 23 行にもある）

### 5-4. inset の出現行

16, 18, 28, 36, 53, 58, 61, 82, 117, 127, 168, 234 行（12行）

### 5-5. aspect-ratio

- 出現行: なし（0件）

### 5-6. container-type

- 25行 `container-type:size`
- 件数: 1行

### 5-7. safe-area-inset の出現行

- 111行（env(safe-area-inset-top), env(safe-area-inset-right)）
- 190行（env(safe-area-inset-left)）
- 193行（env(safe-area-inset-left)）
- 199行（env(safe-area-inset-left)）
- 206行（env(safe-area-inset-right)）
- 210行（env(safe-area-inset-right)）
- 件数: 6行

---

## 6. 画面に表示される、漢字を含む日本語の文字列（行番号つき）

| 行 | 文字列 | 表示される場所 |
|---|---|---|
| 9 | 見つめて見つけてほシーカー（SEE-CAR） | ブラウザのタブ（title） |
| 823 | 自由自在（じゆうじざい） | 地図えらびのカード（2572行）、地図の描画（892・933行）、プレイ中の地図名（2785行）、みつけた画面（2848行） |
| 824 | 四方八方（しほうはっぽう） | 同上 |
| 825 | 品行方正（ひんこうほうせい） | 同上 |
| 826 | 三日坊主（みっかぼうず） | 同上 |
| 827 | 一日千秋（いちじつせんしゅう） | 同上 |
| 2486 | 見つめて見つけて（ロゴの上の文字） | ロゴ（logoHTML 内の .logo-top） |

- 表示には出ない漢字（参考）: 480行（コメント）, 106行・192行（CSS コメント）, 830行（THIN の辞書キー 鳥・麗・龍。描画の設定用）, 1474行（World.init を先に呼んでください。Error の文で、画面には出ない）
- 件数: 表示される行 7行（9, 823〜827, 2486）

---

## 7. THREE / Peer が読み込めなかった場合の分岐

### 7-1. THREE（three.js）

- 1237行 `if (!window.THREE) throw new Error('THREE is not loaded');`（World.init の中）
- 2963行 `call('World', 'init', $('worldbox'));`（起動時に呼ぶ）
- 2405行 `call()` の catch 内 `console.warn(obj + '.' + name + ' failed', e)`
- 画面に表示する文: なし（分岐はあるが、画面に出る文の行はない。コンソールに警告が出るだけ）

### 7-2. Peer（PeerJS）

- 2288〜2290行（へや作成）: `try { peer = new Peer(...) } catch (e) { setTimeout(function () { fail(s, 'error', 'no-peerjs', MSG.server); }, 0); return null; }`
- 2338行（へやに はいる）: `try { p = new Peer(peerOptions()); } catch (e) { fail(s, 'error', 'no-peerjs', MSG.server); return; }`
- 表示する文: MSG.server（2159行）
  - 2159行 `server: 'つうしんの じゅんびが できなかったよ。すこし まってから もういちど やってみてね'`
  - 表示先: failNet()（2655〜2658行。2658行で #msgtext に表示）。呼び出し元は 2688行（へや作成の失敗）と 2718行（へやに はいるの失敗）
  - 2681行と 2710行: call('Net', 'host' / 'join') が Promise を返さないときの表示 `つうしんが つかえないよ`

件数: THREE の分岐 1箇所（1237行。画面表示なし）/ Peer の分岐 2箇所（2288〜2290行, 2338行）+ 画面表示の文 1行（2159行）
