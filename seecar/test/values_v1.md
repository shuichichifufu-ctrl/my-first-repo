# seecar_v1.html 項目別の値の書き出し

対象: /home/user/my-first-repo/seecar/dist/seecar_v1.html（全2793行）
評価・合否は含めない。値と行番号のみ。

---

## 1. 外部から読み込むURL・接続先

件数: 外部URL 2件 / Peer接続関連の行 3件（接続先の既定値はファイル内に記述なし）

| 行 | 種類 | 値 |
|---|---|---|
| 10 | script src | `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js` |
| 11 | script src | `https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js` |
| 2109 | new Peer | `new Peer('seecar-hoshi-' + code, peerOptions())`（ホスト側。接続先は省略されているため PeerJS ライブラリの既定サーバー） |
| 2159 | new Peer | `new Peer(peerOptions())`（参加側。IDは省略） |
| 2171 | connect | `p.connect('seecar-hoshi-' + code, { serialization: 'json', reliable: true })`（接続先はピンID） |

`peerOptions()`（2002-2014行）は URL のクエリで接続先を上書きできる:
- 2006行: `peerhost`
- 2008行: `peerport`
- 2009行: `peerpath`
- 2010行: `peersecure`（`0` / `1` / 未指定時は `location.protocol === 'https:'`）

fetch / XMLHttpRequest / link href: 0件

参考（外部への通信ではないもの）:
- 37行: `url("data:image/svg+xml;...xmlns='http://www.w3.org/2000/svg'...")`（data URI。中のURLは名前空間の文字列）
- 690行: `new Image()` に 701-702行で `URL.createObjectURL(file)`（ローカルのBlob URL）

---

## 2. ボタン類のサイズと font-size（CSSで指定された値）

単位はすべて書かれたまま（cqmin など）。「-」は指定なし。

| 要素 | 出現行 | CSS規則の行 | width | height | min-width | font-size | 備考 |
|---|---|---|---|---|---|---|---|
| button（全般） | 19 | 19 | - | - | - | - | padding:0; margin:0; border:0 |
| #back `.backbtn` | 254 | 136-137 | - | 12cqmin | 25cqmin | 4.8cqmin | padding:0 3cqmin |
| #c-host `.bigcard` | 258 | 143 | 62cqmin | 50cqmin | - | 7.4cqmin | 背景はCSS 145行 |
| #c-join `.bigcard` | 262 | 143 | 62cqmin | 50cqmin | - | 7.4cqmin | 背景はCSS 145行 |
| #dpad の button（fwd/left/right/back） `.ctl` | 294-297 | 192-198 | - （グリッドのセル 15cqmin: 193行） | - （グリッドのセル 15cqmin: 193行） | - | span: 3.2cqmin（196行） | svg: 6.6cqmin（195行） |
| #fire `.ctl` | 299 | 200-203 | 31cqmin | 31cqmin | - | span: 5.6cqmin（202行） | svg: 16cqmin（201行） |
| #cam | 303 | 204-207 | 17cqmin | 19cqmin | - | span: 4.2cqmin（207行） | i: 10.6cqmin（205行、width/height とも） |
| #home | 328 | 111-113 | 12cqmin | 12cqmin | - | - | svg: 7.4cqmin（113行） |
| #m-no `.nbtn.primary` | 334 | 101-102, 122-123 | 44cqmin（122行 `.mbtns .nbtn`。基本は64cqmin: 101行） | 16cqmin | - | 6.4cqmin（102行） | i: 8cqmin（103行） |
| #m-yes `.nbtn.secondary` | 335 | 101-102, 122, 124 | 44cqmin（122行） | 16cqmin | - | 6.4cqmin（102行） | animation:none（124行） |
| #nav の button `.nbtn`（JSで生成: 2338-2345行） | - | 101-103 | 64cqmin | 16cqmin | - | 6.4cqmin | i: 8cqmin |
| `.card`（JSで生成: 2387行、ファイル選択は2394行） | - | 158-165 | - （.pickgrid の grid。grid-auto-rows:1fr: 157行） | - | - | .kan: 8.4cqmin（159行）／ .yomi: 3.5cqmin（160行） | 下記参照 |
| `.card` 中の `.pickgrid.c3` | - | 161 | - | - | - | .kan: 6cqmin／ .yomi: 2.8cqmin | 3列表示のとき |
| `.card.file` | - | 164-165 | - | - | - | .kan: 5.4cqmin（165行） | svg: 11cqmin（164行） |
| `.card input[type=file]` | 166 | 166 | 100% | 100% | - | 0 | opacity:0 |
| `.key`（JSで生成: 2544-2548行） | - | 176-178 | - （グリッド列 repeat(3,18cqmin): 176行） | - （grid-auto-rows 13.4cqmin: 176行） | - | 8cqmin（177行） | `.key.del`: 4.8cqmin（178行） |

min-width / min-height の指定は `.backbtn`（136行、25cqmin）のみ。

---

## 3. CSS の font-size 指定値（全一覧）

件数: 36行、38宣言（161行と189行はそれぞれ2宣言）

| 行 | セレクタ | font-size |
|---|---|---|
| 71 | `.logo-top` | calc(var(--k)*6.6cqmin) |
| 75 | `.logo-name` | calc(var(--k)*17cqmin) |
| 79 | `.logo-en` | calc(var(--k)*5.6cqmin) |
| 86 | `.star b` | calc(var(--k)*14cqmin) |
| 92 | `.touchme` | 7.4cqmin |
| 96 | `.bye` | 12cqmin |
| 102 | `.nbtn` | 6.4cqmin |
| 120 | `.mtitle` | 9cqmin |
| 129 | `.ptext` | 7.6vmin |
| 134 | `.head` | 6.4cqmin |
| 137 | `.backbtn` | 4.8cqmin |
| 143 | `.bigcard` | 7.4cqmin |
| 149 | `.digits b` | 21cqmin |
| 151 | `.digits.grid2 b` | 17cqmin |
| 152 | `.waiting` | 6.4cqmin |
| 159 | `.card .kan` | 8.4cqmin |
| 160 | `.card .yomi` | 3.5cqmin |
| 161 | `.pickgrid.c3 .kan` | 6cqmin |
| 161 | `.pickgrid.c3 .yomi` | 2.8cqmin |
| 165 | `.card.file .kan` | 5.4cqmin |
| 166 | `.card input[type=file]` | 0 |
| 169 | `.preview .pt` | 7cqmin |
| 170 | `.preview .py` | 3.6cqmin |
| 171 | `.preview .hint` | 6cqmin |
| 177 | `.key` | 8cqmin |
| 178 | `.key.del` | 4.8cqmin |
| 182 | `.msgtext` | 6.6cqmin |
| 189 | `#maptag b` | 6.4cqmin |
| 189 | `#maptag small` | 3cqmin |
| 190 | `#notice` | 5.4cqmin |
| 196 | `#dpad .ctl span` | 3.2cqmin |
| 202 | `#fire span` | 5.6cqmin |
| 207 | `#cam span` | 4.2cqmin |
| 208 | `#boom` | 20cqmin |
| 216 | `.found` | 17cqmin |
| 218 | `.who` | 5.4cqmin |
| 220 | `.endtitle` | 11cqmin |
| 221 | `.endyomi` | 4.6cqmin |

JavaScriptで設定する font-size（`style.fontSize`）: 0件

---

## 4. stopPropagation / preventDefault と addEventListener

### 4-1. stopPropagation / preventDefault の箇所

件数: stopEv 経由（stopPropagation + preventDefault）12箇所 / stopPropagation のみ 1箇所 / preventDefault のみ 11箇所

| 行 | 関数・箇所 | 処理 | 付いている要素・イベント |
|---|---|---|---|
| 2266 | `function stopEv(e)` | stopPropagation() + preventDefault() | 定義本体 |
| 2269 | tap: pointerdown | stopEv | tap() で登録された全要素（#boot, #home, #m-no, #m-yes, #back, #c-host, #c-join, #cam, #nav の nbtn, .card, .key） |
| 2271 | tap: pointerup | stopEv | 同上 |
| 2274 | tap: off（pointercancel / pointerleave） | stopEv | 同上 |
| 2277 | tap: click | stopEv | 同上 |
| 2278 | tap: contextmenu | stopEv | 同上 |
| 2292 | hold: pointerdown | stopEv | `.ctl[data-act]`（#dpad の4ボタン、#fire） |
| 2293 | hold: up（pointerup / pointercancel / pointerleave） | stopEv | 同上 |
| 2297 | hold: click | stopEv | 同上 |
| 2298 | hold: contextmenu | stopEv | 同上 |
| 2761 | #modal: pointerdown | stopEv | #modal |
| 2762 | #modal: pointerup | stopEv | #modal |
| 2763 | #modal: click | stopEv | #modal |
| 2398 | ファイル入力: pointerdown / pointerup | stopPropagation() のみ（preventDefault なし） | `.card input[type=file]` |
| 2700 | onKeyDown: boot 状態 | preventDefault() | document（keydown） |
| 2702 | onKeyDown: モーダル中の Escape | preventDefault() | document（keydown） |
| 2707 | onKeyDown: 操作キー | preventDefault() | document（keydown） |
| 2708 | onKeyDown: c キー | preventDefault() | document（keydown） |
| 2709 | onKeyDown: Escape | preventDefault() | document（keydown） |
| 2713 | onKeyDown: 数字キー（keypad中） | preventDefault() | document（keydown） |
| 2714 | onKeyDown: Backspace | preventDefault() | document（keydown） |
| 2718 | onKeyDown: Enter | preventDefault() | document（keydown） |
| 2723 | onKeyUp | preventDefault() | document（keyup） |
| 2740 | contextmenu | preventDefault() | document |
| 2741 | gesturestart / gesturechange / gestureend / dblclick | preventDefault() | document |

### 4-2. addEventListener の一覧

件数: 登録行 約30行。イベント名は次の17種。`touchstart` の登録は 0件。

| イベント名 | 行 | 登録先 |
|---|---|---|
| pointerdown | 2269, 2292, 2398, 2761 | tap要素 / hold要素（.ctl, #fire） / ファイル入力 / #modal |
| pointerup | 2270, 2294, 2398, 2762 | 同上 |
| pointercancel | 2275, 2295 | tap要素 / hold要素 |
| pointerleave | 2276, 2296 | tap要素 / hold要素 |
| click | 2277, 2297, 2763 | tap要素 / hold要素 / #modal |
| contextmenu | 2278, 2298, 2740 | tap要素 / hold要素 / document |
| keydown | 2742 | document（onKeyDown: 2698行） |
| keyup | 2743 | document（onKeyUp: 2721行） |
| change | 2399 | ファイル入力（inp） |
| change | 2748 | MediaQueryList `(orientation: portrait)`（addEventListener がある場合） |
| gesturestart / gesturechange / gestureend / dblclick | 2741 | document |
| resize | 1160 | window（World の画面サイズ調整） |
| pagehide | 2206 | window（Net の後始末） |
| blur | 2744 | window（releaseAll） |
| DOMContentLoaded | 2788 | document（readyState が loading のとき） |
| touchstart | 0件 | - |

tap() の呼び出し（2757-2767行、2343行、2391行、2548行）:
- 2757 `#boot`（leaveBoot）
- 2758 `#home`（openModal）
- 2759 `#m-no`（closeModal）
- 2760 `#m-yes`（quitYes）
- 2764 `#back`（backFromSetting）
- 2765 `#c-host`（startHost）
- 2766 `#c-join`（startJoin）
- 2767 `#cam`（cycleCam）
- 2343 `#nav` の各ボタン（JSで生成）
- 2391 `.card`（地図の選択カード）
- 2548 `.key`（数字キー、けす）

hold() の呼び出し: 2769行（`.ctl[data-act]` の5要素: fwd, left, right, back, fire）

---

## 5. CSS の全体規則・@media・単位など

| 項目 | 件数 | 行 | 内容 |
|---|---|---|---|
| `* {` の規則 | 1 | 14 | `*{user-select:none;-webkit-user-select:none;touch-action:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;box-sizing:border-box}` |
| `@media` | 1 | 131 | `@media screen and (orientation: portrait){#portrait{display:flex}}` |
| `100dvh` | 3行 | 16, 18, 24 | 16: `body{...height:100vh;height:100dvh;...}`／18: `#app{...height:100dvh...}`／24: `height:min(100dvh,56.25vw)` |
| `inset` | 12行 | 16, 18, 28, 36, 53, 58, 61, 82, 117, 127, 166, 224 | すべて `inset:0` |
| `aspect-ratio` | 0件 | - | - |
| `container-type` | 1行 | 25 | `container-type:size;`（#stage） |
| `safe-area-inset` | 5箇所・4行 | 111（top, right の2か所）, 193（left）, 200（right）, 204（right） | `env(safe-area-inset-*)` |

補足（CSS以外）: 縦向きの判定は JavaScript の `matchMedia('(orientation: portrait)')` でも行う（2691行、2746行）。

---

## 6. 画面に表示される漢字を含む日本語の文字列

件数: 7行（7文字列）。コメント内の漢字は除く。

| 行 | 文字列 | 表示される場所 |
|---|---|---|
| 9 | `見つめて見つけてほシーカー（SEE-CAR）` | `<title>`（ブラウザのタブ名） |
| 2303 | `見つめて見つけて` | ロゴ `.logo-top`（ボート・タイトル・終わりの各画面。`data-logo` のある 242, 249, 321行に挿入） |
| 739 | `自由自在` | 地図の選択カード・地図名表示（maptag、プレビュー、エンディング） |
| 740 | `四方八方` | 同上 |
| 741 | `品行方正` | 同上 |
| 742 | `一石二鳥` | 同上 |
| 743 | `一日千秋` | 同上 |

---

## 7. Three.js / Peer が読み込めなかったときの分岐

### 7-1. Three.js（THREE）

- 分岐の有無: あり（`typeof` ではなく真偽判定）
- 1115行: `if (!window.THREE) throw new Error('THREE is not loaded');`
- 呼び出し元: 2771行 `call('World', 'init', $('worldbox'))`。`call()`（2221-2228行）が例外を握り、2225行で `console.warn` を出すだけ。
- 表示する日本語の文: なし（画面には何も出ない。コンソールのみ）
- 後続: 1350行 `load()` で `'World.init を先に呼んでください'` を投げる（画面文なし）。1880行 `start()` は何もせず戻る。
- 参考: `typeof THREE === 'undefined'` の判定は 0件

### 7-2. Peer（PeerJS）

- 分岐の有無: あり（`typeof Peer` の判定はなし。`new Peer` を try/catch で囲む）
- ホスト（へやを つくる）: 2109-2112行の try/catch。catch は 2111行 `setTimeout(function () { fail(s, 'error', 'no-peerjs', MSG.server); }, 0);`
- 参加（へやに はいる）: 2159行の try/catch。catch は同じ 'no-peerjs' と MSG.server を即時に fail。
- 表示する文: 1980行 `MSG.server` = `つうしんの じゅんびが できなかったよ。すこし まってから もういちど やってみてね`
- 画面に出るまで:
  - ホスト: 2502-2506行の reject → failNet（2472-2477行）→ 2475-2476行で msgtext に表示。ホストの再試行（2504行）は 'unavailable-id' のときだけなので、この文では再試行しない。
  - 参加: 2533-2535行の reject → failNet → 2475-2476行で表示。
- 文字が出る条件: errText（2463-2466行）が、文にひらがなを含むかどうかで判定するため、この文がそのまま表示される。

### 7-3. window.Net 自体が無いとき（参考）

- 2498行 / 2527行: `failNet('つうしんが つかえないよ')`（`call('Net', 'host' / 'join')` が Promise を返さないとき）

---

## 件数の一覧

| 項目 | 件数 |
|---|---|
| 1. 外部URL（script src） | 2件（10, 11行） |
| 1. Peer 接続関連の行 | 3件（2109, 2159, 2171行） |
| 2. ボタン類の指定行 | button 要素 12件（静的HTML） + JSで生成されるボタン（#nav、.card、.key） |
| 3. font-size | 36行 / 38宣言 |
| 4. stopEv（stopPropagation + preventDefault） | 12箇所 |
| 4. stopPropagation のみ | 1箇所（2398行） |
| 4. preventDefault のみ | 11箇所 |
| 4. addEventListener のイベント名 | 17種（touchstart は 0件） |
| 5. `* {` | 1件 |
| 5. `@media` | 1件 |
| 5. `100dvh` | 3行 |
| 5. `inset` | 12行 |
| 5. `aspect-ratio` | 0件 |
| 5. `container-type` | 1行 |
| 5. `safe-area-inset` | 5箇所（4行） |
| 6. 漢字を含む画面文字列 | 7行 |
| 7. THREE の分岐 | 1箇所（1115行）、表示文 0件 |
| 7. Peer の分岐 | 2箇所（2111行、2159行）、表示文は 1980行 |
