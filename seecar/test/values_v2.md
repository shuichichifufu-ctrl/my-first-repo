# values_v2.md: seecar_v2.html の値の書き出し

対象: `/home/user/my-first-repo/seecar/dist/seecar_v2.html`（全 2897 行）。
行番号はすべて対象ファイルの行番号。値は記載どおり（単位のまま）。評価や合否は含めない。

## 1. 外部から読み込む URL・接続先

### 1-1. script 要素の外部 URL（2 件）

| 行 | 種別 | URL |
|---|---|---|
| 10 | script src | `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js` |
| 11 | script src | `https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js` |

### 1-2. `new Peer` の接続先（2 件）

| 行 | 記述 |
|---|---|
| 2203 | `peer = new Peer('seecar-hoshi-' + code, peerOptions());` |
| 2253 | `try { p = new Peer(peerOptions()); } catch (e) { fail(s, 'error', 'no-peerjs', MSG.server); return; }` |

接続先ホストはファイル内に直接記載されていない。`peerOptions()`（2096〜2108行）で URL のクエリ `peerhost` `peerport` `peerpath` `peersecure` を指定したときだけ `host` `port` `path` `secure` を上書きする。既定値は PeerJS ライブラリ側の値に依存する。

### 1-3. URL クエリで指定できる接続先パラメータ（5 行）

- 2100行: `if (q.get('peerhost')) {`
- 2101行: `o.host = q.get('peerhost');`
- 2102行: `if (q.get('peerport')) o.port = parseInt(q.get('peerport'), 10);`
- 2103行: `if (q.get('peerpath')) o.path = q.get('peerpath');`
- 2104行: `o.secure = q.get('peersecure') === '0' ? false : (q.get('peersecure') === '1' ? true : location.protocol === 'https:');`

### 1-4. fetch / XMLHttpRequest / WebSocket / EventSource など（0 件）

該当なし。

### 1-5. 除外した URL 文字列（読み込みではないもの）

- 37行: `data:` URI（背景の SVG ノイズ）内の `http://www.w3.org/2000/svg` 名前空間文字列。外部読み込みではない。
- 内部で作る画像 URL: 746・758行（`URL.createObjectURL` で作る Object URL）、2519行・2760行（`img.src = ...picture`）。外部 URL ではない。

## 2. ボタン類のサイズ指定（CSS で宣言された値のみ）

CSS の宣言だけを記載する。継承・計算後の値は含まない。`#nav` の `.nbtn` と `#m-yes`/`#m-no` は同じ `.nbtn` 規則で大きさが決まる（`#m-yes`/`#m-no` 自身の規則に幅・高さはない）。

### 2-1 #home（宣言 4 件）

| 行 | セレクタ | プロパティ | 値 |
|---|---|---|---|
| 111 | `#home` | width | `12cqmin` |
| 111 | `#home` | height | `12cqmin` |
| 113 | `#home svg` | width | `7.4cqmin` |
| 113 | `#home svg` | height | `7.4cqmin` |

### 2-2 #fire（宣言 5 件）

| 行 | セレクタ | プロパティ | 値 |
|---|---|---|---|
| 203 | `#fire` | width | `31cqmin` |
| 203 | `#fire` | height | `31cqmin` |
| 204 | `#fire svg` | width | `16cqmin` |
| 204 | `#fire svg` | height | `16cqmin` |
| 205 | `#fire span` | font-size | `5.6cqmin` |

### 2-3 #cam（宣言 11 件）

| 行 | セレクタ | プロパティ | 値 |
|---|---|---|---|
| 207 | `#cam` | width | `30cqmin` |
| 207 | `#cam` | height | `20cqmin` |
| 209 | `#cam i` | width | `10.6cqmin` |
| 209 | `#cam i` | height | `10.6cqmin` |
| 210 | `#cam i svg` | width | `100%` |
| 210 | `#cam i svg` | height | `100%` |
| 211 | `#cam i.next` | width | `8cqmin` |
| 211 | `#cam i.next` | height | `8cqmin` |
| 212 | `#cam .arr` | width | `0` |
| 212 | `#cam .arr` | height | `0` |
| 213 | `#cam span#cam-label` | font-size | `4.2cqmin` |

### 2-4 #dpad 内のボタン (.ctl)（宣言 3 件）

| 行 | セレクタ | プロパティ | 値 |
|---|---|---|---|
| 198 | `#dpad .ctl svg` | width | `6.6cqmin` |
| 198 | `#dpad .ctl svg` | height | `6.6cqmin` |
| 199 | `#dpad .ctl span` | font-size | `3.2cqmin` |

### 2-5 #nav のボタン (.nbtn)（宣言 8 件）

| 行 | セレクタ | プロパティ | 値 |
|---|---|---|---|
| 101 | `.nbtn` | width | `64cqmin` |
| 101 | `.nbtn` | height | `16cqmin` |
| 101 | `.nbtn` | font-size | `6.4cqmin` |
| 103 | `.nbtn i` | width | `8cqmin` |
| 103 | `.nbtn i` | height | `8cqmin` |
| 104 | `.nbtn i svg` | width | `100%` |
| 104 | `.nbtn i svg` | height | `100%` |
| 122 | `.mbtns .nbtn` | width | `44cqmin` |

### 2-6 .card（宣言 9 件）

| 行 | セレクタ | プロパティ | 値 |
|---|---|---|---|
| 159 | `.card .kan` | font-size | `8.4cqmin` |
| 160 | `.card .yomi` | font-size | `3.5cqmin` |
| 164 | `.card.file svg` | width | `11cqmin` |
| 164 | `.card.file svg` | height | `11cqmin` |
| 167 | `.card.file .kan` | font-size | `4.2cqmin` |
| 167 | `.card.file .kan` | width | `100%` |
| 168 | `.card input[type=file]` | width | `100%` |
| 168 | `.card input[type=file]` | height | `100%` |
| 168 | `.card input[type=file]` | font-size | `0` |

### 2-7 .key（宣言 2 件）

| 行 | セレクタ | プロパティ | 値 |
|---|---|---|---|
| 179 | `.key` | font-size | `8cqmin` |
| 180 | `.key.del` | font-size | `4.8cqmin` |

### 2-8 #m-yes（宣言 0 件）

宣言なし（幅・高さ・最小サイズ・font-size とも CSS の指定なし）。

### 2-9 #m-no（宣言 0 件）

宣言なし（幅・高さ・最小サイズ・font-size とも CSS の指定なし）。

### 2-10 参考: その他の button (#back .backbtn, #c-host/#c-join .bigcard)（宣言 11 件）

| 行 | セレクタ | プロパティ | 値 |
|---|---|---|---|
| 122 | `.mbtns .nbtn` | width | `44cqmin` |
| 136 | `.backbtn` | height | `12cqmin` |
| 136 | `.backbtn` | min-width | `25cqmin` |
| 136 | `.backbtn` | font-size | `4.8cqmin` |
| 138 | `.backbtn i` | width | `0` |
| 138 | `.backbtn i` | height | `0` |
| 143 | `.bigcard` | width | `62cqmin` |
| 143 | `.bigcard` | height | `50cqmin` |
| 143 | `.bigcard` | font-size | `7.4cqmin` |
| 144 | `.bigcard svg` | width | `24cqmin` |
| 144 | `.bigcard svg` | height | `24cqmin` |

### 2-x HTML / JS で作られる button 要素の所在

- HTML 直書き（<button>）: 261行, 265行, 269行, 301行, 302行, 303行, 304行, 306行, 310行, 335行, 341行, 342行
- JS で作る（createElement('button')）: 2436行, 2483行, 2640行（2436行: #nav の .nbtn、2483行: .card、2640行: .key）

## 3. font-size の指定値（すべて CSS、セレクタと値）

JS の `fontSize` / `style.font*` 代入: なし

| 行 | セレクタ | font-size |
|---|---|---|
| 71 | `.logo-top` | `calc(var(--k)*6.6cqmin)` |
| 75 | `.logo-name` | `calc(var(--k)*17cqmin)` |
| 79 | `.logo-en` | `calc(var(--k)*5.6cqmin)` |
| 86 | `.star b` | `calc(var(--k)*14cqmin)` |
| 92 | `.touchme` | `7.4cqmin` |
| 96 | `.bye` | `12cqmin` |
| 101 | `.nbtn` | `6.4cqmin` |
| 120 | `.mtitle` | `9cqmin` |
| 129 | `.ptext` | `7.6vmin` |
| 134 | `.head` | `6.4cqmin` |
| 136 | `.backbtn` | `4.8cqmin` |
| 143 | `.bigcard` | `7.4cqmin` |
| 149 | `.digits b` | `21cqmin` |
| 151 | `.digits.grid2 b` | `17cqmin` |
| 152 | `.waiting` | `6.4cqmin` |
| 159 | `.card .kan` | `8.4cqmin` |
| 160 | `.card .yomi` | `3.5cqmin` |
| 161 | `.pickgrid.c3 .kan` | `6cqmin` |
| 161 | `.pickgrid.c3 .yomi` | `2.8cqmin` |
| 167 | `.card.file .kan` | `4.2cqmin` |
| 168 | `.card input[type=file]` | `0` |
| 171 | `.preview .pt` | `7cqmin` |
| 172 | `.preview .py` | `3.6cqmin` |
| 173 | `.preview .hint` | `6cqmin` |
| 179 | `.key` | `8cqmin` |
| 180 | `.key.del` | `4.8cqmin` |
| 184 | `.msgtext` | `6.6cqmin` |
| 191 | `#maptag b` | `4.4cqmin` |
| 191 | `#maptag small` | `2.4cqmin` |
| 193 | `#notice` | `3.6cqmin` |
| 199 | `#dpad .ctl span` | `3.2cqmin` |
| 205 | `#fire span` | `5.6cqmin` |
| 213 | `#cam span#cam-label` | `4.2cqmin` |
| 214 | `#boom` | `20cqmin` |
| 223 | `.found` | `17cqmin` |
| 225 | `.who` | `5.4cqmin` |
| 227 | `.endtitle` | `11cqmin` |
| 228 | `.endyomi` | `4.6cqmin` |

## 4. stopPropagation / preventDefault と addEventListener

### 4-1. `stopPropagation` / `preventDefault` が書かれている行（13 行）

| 行 | 記述 |
|---|---|
| 2363 | `function stopEv(e) { e.stopPropagation(); e.preventDefault(); }` |
| 2495 | `['pointerdown', 'pointerup'].forEach(function (n) { inp.addEventListener(n, function (e) { e.stopPropagation(); unlock(); }); });` |
| 2801 | `if (state === 'boot') { e.preventDefault(); if (!e.repeat) leaveBoot(); return; }` |
| 2803 | `if (e.key === 'Escape') { e.preventDefault(); closeModal(); }` |
| 2808 | `if (act) { e.preventDefault(); if (!e.repeat) press(act, true); return; }` |
| 2809 | `if (e.key === 'c' \|\| e.key === 'C') { e.preventDefault(); if (!e.repeat) cycleCam(); return; }` |
| 2810 | `if (e.key === 'Escape') { e.preventDefault(); openModal(); }` |
| 2814 | `if (/^[0-9]$/.test(e.key)) { e.preventDefault(); keyIn(e.key); return; }` |
| 2815 | `if (e.key === 'Backspace') { e.preventDefault(); keyIn('del'); return; }` |
| 2819 | `if (b) { e.preventDefault(); sfx('tap'); var it = navItems()[0]; if (it) it.fn(); }` |
| 2824 | `if (act && state === 'play') { e.preventDefault(); press(act, false); }` |
| 2841 | `doc.addEventListener('contextmenu', function (e) { e.preventDefault(); });` |
| 2842 | `['gesturestart', 'gesturechange', 'gestureend', 'dblclick'].forEach(function (n) { doc.addEventListener(n, function (e) { e.preventDefault(); }); });` |

`stopEv`（2363行）は両方を呼ぶ関数。`stopEv` を参照する行（定義行を除く。呼び出しと addEventListener 登録を含む）: 2366, 2368, 2371, 2374, 2375, 2389, 2390, 2394, 2395, 2862, 2863, 2864

### 4-2. addEventListener の登録一覧（26 行）

| 行 | イベント | 対象要素 | 備考 |
|---|---|---|---|
| 1221 | resize | window | S.onWinResize を登録（watchResize 内） |
| 2300 | pagehide | window | teardown(true) |
| 2366 | pointerdown | tap() の対象要素 | stopEv / 押下扱い |
| 2367 | pointerup | tap() の対象要素 |  |
| 2372 | pointercancel | tap() の対象要素 | off |
| 2373 | pointerleave | tap() の対象要素 | off |
| 2374 | click | tap() の対象要素 | stopEv |
| 2375 | contextmenu | tap() の対象要素 | stopEv |
| 2389 | pointerdown | hold() の対象要素 | stopEv / press(act, true) |
| 2391 | pointerup | hold() の対象要素 | up → stopEv / press(act, false) |
| 2392 | pointercancel | hold() の対象要素 | up |
| 2393 | pointerleave | hold() の対象要素 | up |
| 2394 | click | hold() の対象要素 | stopEv |
| 2395 | contextmenu | hold() の対象要素 | stopEv |
| 2495 | pointerdown / pointerup | ファイル選択 input[type=file]（.card.file 内） | stopPropagation + unlock |
| 2496 | change | ファイル選択 input[type=file] |  |
| 2841 | contextmenu | document | preventDefault |
| 2842 | gesturestart / gesturechange / gestureend / dblclick | document | preventDefault |
| 2843 | keydown | document | onKeyDown |
| 2844 | keyup | document | onKeyUp |
| 2845 | blur | window | releaseAll |
| 2849 | change | matchMedia("(orientation: portrait)") の MediaQueryList | applyPortraitPause |
| 2862 | pointerdown | #modal (els.modal) | stopEv |
| 2863 | pointerup | #modal (els.modal) | stopEv |
| 2864 | click | #modal (els.modal) | stopEv |
| 2891 | DOMContentLoaded | document（readyState が loading のとき） | init |

`tap()` / `hold()` の呼び出し箇所（対象要素の特定用）: 2364行, 2388行, 2440行, 2487行, 2645行, 2858行, 2859行, 2860行, 2861行, 2865行, 2866行, 2867行, 2868行, 2870行

- `tap(el, fn)` の対象: #boot（2858行）、#home（2859行）、#m-no（2860行）、#m-yes（2861行）、#back（2865行）、#c-host（2866行）、#c-join（2867行）、#cam（2868行）、#nav の .nbtn（2440行）、.card（2487行）、.key（2645行）。
- `hold(el, act)` の対象: `.ctl[data-act]`（2869〜2870行）= #dpad の 4 ボタンと #fire。

## 5. 全要素セレクタ・@media・単位・プロパティの出現

### 5-1. `* {` 規則（14行）

14行: `*{user-select:none;-webkit-user-select:none;touch-action:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;box-sizing:border-box}`

`#play>*{pointer-events:auto}`（189行）は `*` を含むが `* {` 規則ではない。

### 5-2. @media 条件（1 件）

- 131行: `@media screen and (orientation: portrait){#portrait{display:flex}}`
- 参考: JS の `matchMedia` 呼び出しは 2792, 2846, 2847 行（2847行: `window.matchMedia('(orientation: portrait)')`）。

### 5-3. 出現行

- 100dvh（3 行）: 16, 18, 24
- inset（18 行）: 16, 18, 28, 36, 53, 58, 61, 82, 111, 117, 127, 168, 190, 193, 196, 203, 207, 231
- aspect-ratio（0 行）: なし
- container-type（1 行）: 25
- safe-area-inset（6 行）: 111, 190, 193, 196, 203, 207

## 6. 画面に表示される、漢字を含む日本語の文字列

HTML 本文（237〜352行）に漢字を含む文字列: なし

JS の文字列リテラル（コメントを除く）のうち、画面に出る漢字を含む文字列:

| 行 | 文字列 | 表示の経路 |
|---|---|---|
| 795 | `自由自在` | 熟語カード: `.kan` に textContent で入る（2486行）。選択後は #pt-title（2698行）と #end-title（2757行）に入る。キャンバスにも描く（859行付近） |
| 796 | `四方八方` | 熟語カード: `.kan` に textContent で入る（2486行）。選択後は #pt-title（2698行）と #end-title（2757行）に入る。キャンバスにも描く（859行付近） |
| 797 | `品行方正` | 熟語カード: `.kan` に textContent で入る（2486行）。選択後は #pt-title（2698行）と #end-title（2757行）に入る。キャンバスにも描く（859行付近） |
| 798 | `一石二鳥` | 熟語カード: `.kan` に textContent で入る（2486行）。選択後は #pt-title（2698行）と #end-title（2757行）に入る。キャンバスにも描く（859行付近） |
| 799 | `一日千秋` | 熟語カード: `.kan` に textContent で入る（2486行）。選択後は #pt-title（2698行）と #end-title（2757行）に入る。キャンバスにも描く（859行付近） |
| 2400 | `見つめて見つけて` | ロゴ（logoHTML、innerHTML で入る） |

表示されない漢字を含む文字列（参考）:

- 9行: `<title>` の `見つめて見つけてほシーカー（SEE-CAR）`（ブラウザのタブ名。画面本体には出ない）
- 1411行: `World.init を先に呼んでください`（例外メッセージ。画面には出ず、call() で console.warn に入る）

注: 上の一覧は文字列リテラル単位で機械的に抽出したもの。表示の有無はコード上の経路（textContent / innerHTML への代入）で判断し、実行時の動作は確認していない。

## 7. THREE / Peer が読み込めなかったときの分岐

### 7-1. THREE（three.js）

- 分岐: あり。1176行 `if (!window.THREE) throw new Error('THREE is not loaded');` で例外を投げる。
- 呼び出し元: 2872行 `call('World', 'init', $('worldbox'))` は `call()`（2319行）で try/catch され、`console.warn` に出る。
- 画面に表示する文: なし（THREE 欠落時に表示する文の行はない）。

### 7-2. Peer（PeerJS）

- 分岐: あり。
  - host 側: 2204〜2206行 `try { peer = new Peer(...) } catch (e) { setTimeout(... fail(s, 'error', 'no-peerjs', MSG.server)) }`、2222〜2227行 `if (!peer) return;`。
  - join 側: 2253行 `try { p = new Peer(peerOptions()); } catch (e) { fail(s, 'error', 'no-peerjs', MSG.server); return; }`。
- 表示する文: `MSG.server` = 「つうしんの じゅんびが できなかったよ。すこし まってから もういちど やってみてね」（2074行）。
  - 経路: `fail()`（2137行）→ Promise の reject → `errText()` → `failNet()`（2569〜2573行）で `#msgtext` に表示。
  - 表示行: 2074行（文の定義）、2572行（`#msgtext` へ代入）。
- 参考: `call('Net', 'host'|'join')` が Promise を返さないときは 2595行・2624行の `failNet('つうしんが つかえないよ')` で表示（Net の関数が無いときの分岐）。

## 件数まとめ

| 項目 | 件数 |
|---|---|
| 1. 外部読み込み URL（script src） | 2 |
| 1. Peer 接続箇所（new Peer） | 2 |
| 2. ボタン類の CSS 宣言（幅・高さ・最小サイズ・font-size） | 53 |
| 3. font-size 宣言 | 38 |
| 4. stopPropagation / preventDefault 行 | 13 |
| 4. addEventListener 登録 | 26 |
| 5. 出現行（100dvh・inset・aspect-ratio・container-type・safe-area-inset・@media・`* {`） | 30 |
| 6. 表示される漢字を含む文字列（行） | 6 |
| 7. THREE / Peer の分岐 | 2 |

