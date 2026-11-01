# seecar_v6.html 値の書き出し

対象: /home/user/my-first-repo/seecar/dist/seecar_v6.html（3979行）
行番号はすべてこのファイルの行番号。評価・合否は含まない。
CSS は 12〜345 行、HTML 本体は 347〜496 行、JavaScript は 497〜3977 行。

---

## 1. 外部から読み込むURL・接続先

| 行 | 種類 | 値 |
|---|---|---|
| 10 | script src | `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js` |
| 11 | script src | `https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js` |
| 3012 | new Peer | `new Peer('seecar-hoshi-' + code, peerOptions())`（接続先はURL既定値。ファイル内に直接書かれたホスト名なし） |
| 3062 | new Peer | `new Peer(peerOptions())`（同上。参加側） |
| 3074 | p.connect | `p.connect('seecar-hoshi-' + code, { serialization: 'json', reliable: true })` |
| 2905-2917 | peerOptions() の上書き | URLクエリ `peerhost` / `peerport` / `peerpath` / `peersecure` で host・port・path・secure を指定可能（2909-2913 行。既定ではこれらは未設定） |
| 942 | img.src（動的） | `img.src = url;`（読み込んだ画像ファイルの一時URL） |
| 3485 | img.src（動的） | `img.src = sel.map.picture;` |
| 3737 | img.src（動的） | `img.src = src;` |
| 3446 | img の src（動的） | `src="' + th + '"`（変数 th の値） |

- 行37: `data:image/svg+xml` の中の文字列 `http://www.w3.org/2000/svg`（読み込みではなく名前空間の文字列）
- 行37 の `url(%23n)`: SVG フィルタ参照（外部URLではない）
- `<link>` タグ: 0件
- fetch(...) の出現: 0件
- XMLHttpRequest / import() / WebSocket / sendBeacon の出現: 0件
- `<script src>` は 10, 11 行の 2件のみ。3977 行の `<script>` は本文中のインラインスクリプト
- ファイル内の `http` / `https` で書かれた文字列: 10, 11, 37 行のみ

---

## 2. ボタン類のサイズ指定（CSS）

値は CSS に書かれた値（単位のまま）。cqmin は `#stage` 基準の単位。

### 2-1. #nav のボタン（.nbtn 系。JS で生成。class は `nbtn` + 種類 primary / secondary / hero / sub）
| 行 | セレクタ | 指定 |
|---|---|---|
| 100 | `#nav` | bottom: 4cqmin / gap: 5cqmin |
| 102 | `.nbtn` | width: 64cqmin / height: 16cqmin |
| 103 | `.nbtn` | font-size: 6.4cqmin |
| 104 | `.nbtn i` | width: 8cqmin / height: 8cqmin |
| 106 | `.nbtn.primary` | （サイズ指定なし） |
| 107 | `.nbtn.secondary` | （サイズ指定なし） |
| 123 | `.mbtns .nbtn` | width: 44cqmin（後の 335 行で上書き） |
| 335 | `.mbtns .nbtn` | width: 50cqmin |
| 246 | `body[data-state=title] #nav` | padding: 0 4cqmin / gap: 2.6cqmin 3cqmin / bottom: 3.6cqmin |
| 247 | `.nbtn small` | font-size: 3.2cqmin |
| 248 | `.nbtn.hero` | display: grid / grid-template-columns: 11cqmin auto |
| 249 | `.nbtn.hero` | width: 96cqmin / height: 20cqmin / font-size: 9.6cqmin |
| 250 | `.nbtn.hero i` | width: 11cqmin / height: 11cqmin |
| 252 | `.nbtn.hero small` | font-size: 3.4cqmin |
| 253 | `.nbtn.sub` | width: auto / height: 12.4cqmin / padding: 0 4.4cqmin / font-size: 4.7cqmin |
| 254 | `.nbtn.sub i` | width: 6.2cqmin / height: 6.2cqmin |
| 255 | `.nbtn.secondary` | （サイズ指定なし。background のみ） |

- min-width / min-height: `.nbtn` 系には指定なし

### 2-2. #home
| 行 | セレクタ | 指定 |
|---|---|---|
| 112-113 | `#home` | width: 12cqmin / height: 12cqmin |
| 114 | `#home svg` | width: 7.4cqmin / height: 7.4cqmin |

### 2-3. #dpad（4方向ボタン .ctl）・#fire・#cam
| 行 | セレクタ | 指定 |
|---|---|---|
| 198 | `#dpad` | grid-template-columns: repeat(3,15cqmin) / grid-template-rows: repeat(3,15cqmin) / gap: 1cqmin |
| 199 | `#dpad .ctl` | （幅・高さ指定なし。border-radius: 3.4cqmin） |
| 200 | `#dpad .ctl svg` | width: 6.6cqmin / height: 6.6cqmin |
| 201 | `#dpad .ctl span` | font-size: 3.2cqmin |
| 324 | `body.noarrows #dpad` | grid-template-columns: 24cqmin / grid-template-rows: 24cqmin |
| 327 | `body.noarrows #dpad .ctl svg` | width: 10cqmin / height: 10cqmin |
| 327 | `body.noarrows #dpad .ctl span` | font-size: 4.6cqmin |
| 205 | `#fire` | width: 31cqmin / height: 31cqmin |
| 206 | `#fire svg` | width: 16cqmin / height: 16cqmin |
| 207 | `#fire span` | font-size: 5.6cqmin |
| 209 | `#cam` | width: 30cqmin / height: 20cqmin |
| 211 | `#cam i` | width: 12.4cqmin / height: 12.4cqmin / flex: none |
| 213 | `#cam i.next` | width: 8cqmin / height: 8cqmin |
| 215 | `#cam span#cam-label` | font-size: 4.4cqmin |

### 2-4. 戻る・モーダル
| 行 | セレクタ | 指定 |
|---|---|---|
| 137 | `.backbtn` | height: 12cqmin / min-width: 25cqmin / padding: 0 3cqmin / font-size: 4.8cqmin |
| 139 | `.backbtn i` | width: 0 / height: 0（三角形は border で作成） |
| 243 | `.backbtn` | height: 12cqmin（同じ値の後の規則） |
| 120 | `.mcard` | padding: 6cqmin 6cqmin 7cqmin（ボタン自体の指定ではない） |
| 124 | `#m-no` | （サイズ指定なし。background のみ） |
| 125 | `#m-yes` | （サイズ指定なし。background のみ） |
| 335 | `.mbtns .nbtn`（#m-no / #m-yes に適用） | width: 50cqmin |
| 121 | `.mtitle` | font-size: 9cqmin |
| 336 | `.mtitle` | font-size: 7.6cqmin（後の行で上書き） |

### 2-5. 設定画面のボタン
| 行 | セレクタ | 指定 |
|---|---|---|
| 144 | `.bigcard`（#c-host / #c-join） | width: 62cqmin / height: 50cqmin / font-size: 7.4cqmin |
| 145 | `.bigcard svg` | width: 24cqmin / height: 24cqmin |
| 146 | `#c-host` / `#c-join` | （background のみ） |
| 268 | `.lvcard`（難しさ） | flex: 1 / max-width: 50cqmin / height: 68cqmin |
| 270 | `.lvcard .lvpic` | width: 26cqmin / height: 26cqmin |
| 272 | `.lvcard b` | font-size: 8cqmin |
| 273 | `.lvcard small` | font-size: 3.4cqmin |
| 274 | `.lvcard em` | font-size: 3.8cqmin |
| 284 | `.seg button`（設定・消去ボタン） | flex: 1 / height: 11.6cqmin / font-size: 4.8cqmin |
| 282 | `.sc-ico`（設定カードのアイコン。ボタンではない） | width: 8.4cqmin / height: 8.4cqmin |
| 150 | `.digits b`（4けたの数字の箱） | width: 23cqmin / height: 30cqmin / font-size: 21cqmin |
| 152 | `.digits.grid2 b` | height: 23cqmin / font-size: 17cqmin |
| 151 | `.digits.grid2` | grid-template-columns: repeat(2,23cqmin) |

### 2-6. 地図えらびの .card / .key
| 行 | セレクタ | 指定 |
|---|---|---|
| 158 | `.card` | （幅・高さ指定なし。border-radius: 4cqmin） |
| 297 | `.card` | padding: 0 .4cqmin |
| 298 | `.card .ic` | width: 9cqmin / height: 9cqmin |
| 302 | `.maps.dense .card .ic` | width: 8cqmin / height: 8cqmin |
| 304 | `.card.file` | flex: none / height: 10.4cqmin / padding: 0 2cqmin |
| 305 | `.card.file .ic` | width: 6.4cqmin / height: 6.4cqmin |
| 163 | `.card.file svg` | width: 11cqmin / height: 11cqmin |
| 166 | `.card.file .kan` | width: 100% / font-size: 4.2cqmin（後の 306 行で上書き） |
| 306 | `.card.file .kan` | width: auto / font-size: 4.6cqmin |
| 167 | `.card input[type=file]` | width: 100% / height: 100% / font-size: 0 |
| 177 | `.keypad` | grid-template-columns: repeat(3,18cqmin) / grid-auto-rows: 13.4cqmin / gap: 1.4cqmin |
| 178 | `.key` | （幅・高さ指定なし。font-size: 8cqmin） |
| 179 | `.key.del` | font-size: 4.8cqmin |

### 2-7. 最小サイズ（min-width / min-height）の出現
- 137 `.backbtn` min-width: 25cqmin
- 168 `.preview` min-width: 0（ボタンではない）
- 280 `.setcard` min-height: 0（ボタンではない）
- 288 `.sc-hint` min-height: 3.6cqmin（ボタンではない）
- 292 `.maps` min-width: 0 / 293 `.grp` min-height: 0 / 296 `.grp .row` min-height: 0（ボタンではない）
- ボタン本体（.nbtn / .ctl / .card / .key / .lvcard / .bigcard / .seg button）への min-width / min-height: 0件

---

## 3. CSS の font-size 指定値すべて（70件）

| 行 | セレクタ | font-size |
|---|---|---|
| 71 | .logo-top | calc(var(--k)*6.6cqmin) |
| 75 | .logo-name | calc(var(--k)*17cqmin) |
| 79 | .logo-en | calc(var(--k)*5.6cqmin) |
| 86 | .star b | calc(var(--k)*14cqmin) |
| 92 | .touchme | 7.4cqmin |
| 96 | .bye | 12cqmin |
| 103 | .nbtn | 6.4cqmin |
| 121 | .mtitle | 9cqmin |
| 130 | .ptext | 7.6vmin |
| 135 | .head | 6.4cqmin |
| 138 | .backbtn | 4.8cqmin |
| 144 | .bigcard | 7.4cqmin |
| 150 | .digits b | 21cqmin |
| 152 | .digits.grid2 b | 17cqmin |
| 153 | .waiting | 6.4cqmin |
| 159 | .card .kan | 8.4cqmin |
| 160 | .card .yomi | 3.5cqmin |
| 166 | .card.file .kan | 4.2cqmin |
| 167 | .card input[type=file] | 0 |
| 170 | .preview .pt | 7cqmin |
| 171 | .preview .py | 3.6cqmin |
| 172 | .preview .hint | 6cqmin |
| 178 | .key | 8cqmin |
| 179 | .key.del | 4.8cqmin |
| 183 | .msgtext | 6.6cqmin |
| 190 | #maptag b | 4.4cqmin |
| 190 | #maptag small | 2.4cqmin |
| 192 | #notice | 3.6cqmin |
| 194 | #notice.big | 6.4cqmin |
| 201 | #dpad .ctl span | 3.2cqmin |
| 207 | #fire span | 5.6cqmin |
| 215 | #cam span#cam-label | 4.4cqmin |
| 216 | #boom | 20cqmin |
| 225 | .found | 17cqmin |
| 227 | .who | 5.4cqmin |
| 229 | .endtitle | 11cqmin |
| 230 | .endyomi | 4.6cqmin |
| 242 | .head | 6.2cqmin |
| 247 | .nbtn small | 3.2cqmin |
| 249 | .nbtn.hero | 9.6cqmin |
| 252 | .nbtn.hero small | 3.4cqmin |
| 253 | .nbtn.sub | 4.7cqmin |
| 256 | .recchip | 3.4cqmin |
| 257 | .recchip b, .endrec b | 3.6cqmin |
| 272 | .lvcard b | 8cqmin |
| 273 | .lvcard small | 3.4cqmin |
| 274 | .lvcard em | 3.8cqmin |
| 281 | .sc-head | 5.2cqmin |
| 284 | .seg button | 4.8cqmin |
| 288 | .sc-hint | 3.3cqmin |
| 294 | .gl | 3.8cqmin |
| 300 | .card.yoji .kan | 5.2cqmin |
| 301 | .card.illust .kan | 4.8cqmin |
| 302 | .maps.dense .card.yoji .kan | 4.3cqmin |
| 302 | .maps.dense .card.illust .kan | 3.8cqmin |
| 303 | .card .yomi | 2.2cqmin |
| 306 | .card.file .kan | 4.6cqmin |
| 307 | .card.file .bw | 3cqmin |
| 311 | .preview .pt | 5.8cqmin |
| 311 | .preview .py | 3.2cqmin |
| 311 | .preview .hint | 4.6cqmin |
| 315 | #tip | 3.4cqmin |
| 327 | body.noarrows #dpad .ctl span | 4.6cqmin |
| 330 | .endrec | 4.6cqmin |
| 331 | .endrec b | 4.4cqmin |
| 336 | .mtitle | 7.6cqmin |
| 339 | .found | 16cqmin |
| 340 | .who | 4.4cqmin |
| 341 | .endtitle | 9.6cqmin |
| 342 | .endyomi | 3.8cqmin |

- font-size を HTML の style 属性や JS の style 指定で書いている箇所は、この一覧に含めていない（JS 内の style 代入は 1611-1612, 3281, 3436, 3733-3734 行で、font-size の代入はなし）。
- 同じセレクタが複数行にまたがる場合は、後の行が優先される（例: `.head` は 135 と 242、`.card.file .kan` は 166 と 306）。

---

## 4. stopPropagation / preventDefault と addEventListener

### 4-1. stopPropagation / preventDefault が書かれている行
- stopPropagation（明示）: 3236（stopEv の定義）, 3461（写真選択の input[type=file] の pointerdown / pointerup）
- preventDefault（明示）: 3236（stopEv の定義）, 3862, 3864, 3869, 3870, 3871, 3875, 3876, 3880, 3885（キーボード処理）, 3903（contextmenu）, 3904（gesturestart / gesturechange / gestureend / dblclick）, 3950（touchstart / touchmove）
- stopEv() の呼び出し行（stopPropagation と preventDefault の両方）: 3239, 3241, 3244, 3247, 3248, 3262, 3263, 3267, 3268, 3798, 3805, 3821, 3928, 3929, 3930, 3948, 3949
- 件数: stopPropagation を書いた行 2行、preventDefault を書いた行 13行、stopEv 呼び出し行 17行（定義の 3236 を除く）

### 4-2. addEventListener と対象（行番号つき・全34件）
| 行 | 対象 | イベント | 処理 |
|---|---|---|---|
| 931 | img（ファイル読込） | onload（プロパティ代入） | — |
| 941 | img（ファイル読込） | onerror（プロパティ代入） | URL.revokeObjectURL, fail |
| 3731 | img（写真の読込） | onload（プロパティ代入） | — |
| 1644 | window | resize | S.onWinResize（resize()） |
| 3109 | window | pagehide | teardown(true) |
| 3239 | tap() の el（ボタン） | pointerdown | stopEv / 押下 |
| 3240 | tap() の el | pointerup | stopEv / sfx / fn |
| 3245 | tap() の el | pointercancel | off |
| 3246 | tap() の el | pointerleave | off |
| 3247 | tap() の el | click | stopEv |
| 3248 | tap() の el | contextmenu | stopEv |
| 3262 | hold() の el（.ctl[data-act]） | pointerdown | stopEv / press(true) |
| 3264 | hold() の el | pointerup | up |
| 3265 | hold() の el | pointercancel | up |
| 3266 | hold() の el | pointerleave | up |
| 3267 | hold() の el | click | stopEv |
| 3268 | hold() の el | contextmenu | stopEv |
| 3461 | 写真選択の input[type=file] | pointerdown / pointerup（forEach） | stopPropagation / unlock |
| 3462 | 写真選択の input[type=file] | change | 読込 |
| 3903 | document | contextmenu | preventDefault |
| 3904 | document | gesturestart / gesturechange / gestureend / dblclick（forEach） | preventDefault |
| 3905 | document | keydown | onKeyDown |
| 3906 | document | keyup | onKeyUp |
| 3907 | window | blur | releaseAll |
| 3911 | matchMedia('(orientation: portrait)') | change（addListener 代替あり） | applyPortraitPause |
| 3928 | els.modal | pointerdown | stopEv |
| 3929 | els.modal | pointerup | stopEv |
| 3930 | els.modal | click | stopEv |
| 3943 | els.swipe | pointerdown | swipeDown |
| 3944 | els.swipe | pointermove | swipeMove |
| 3945 | els.swipe | pointerup | swipeUp |
| 3946 | els.swipe | pointercancel | swipeUp |
| 3947 | els.swipe | lostpointercapture | sw = null（pointerId 一致時） |
| 3948 | els.swipe | click | stopEv |
| 3949 | els.swipe | contextmenu | stopEv |
| 3950 | els.swipe | touchstart / touchmove（forEach・passive: false） | preventDefault |
| 3974 | document | DOMContentLoaded | init（readyState が loading のとき） |

- PeerJS の on() 登録（addEventListener ではない）: 13件
  - 2968 conn（data）, 2989 conn（close）, 2990 conn（error）
  - 3018 peer（error）, 3024 peer（disconnected）
  - 3037 peer（open）, 3038 peer（disconnected）, 3041 peer（connection）, 3044 conn（open）, 3052 conn（open）
  - 3064 p（error）, 3069 p（disconnected）, 3072 p（open）

### 4-3. tap() / hold() を使う要素
- tap() を使う要素: #boot（3924）, #home（3925）, #m-no（3926）, #m-yes（3927）, #back（3931）, #c-host（3932）, #c-join（3933）, #cam（3934）, #reset-rec（3935）, .seg button[data-set]（3938）, .lvcard（3941）, #nav の各 .nbtn（3317）, .card（3449）, .key（3613）
- hold() を使う要素: .ctl[data-act]（3951-3952）= #dpad の 4 ボタンと #fire
- wheel の登録: 0件

---

## 5. `* {` の規則・@media・100dvh・inset・aspect-ratio・container-type・safe-area-inset

- 行14 `* {` の中身:
  `user-select:none;-webkit-user-select:none;touch-action:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;box-sizing:border-box`
- @media: 1件 — 行132 `@media screen and (orientation: portrait)`（#portrait を display:flex にする）
- 100dvh: 行16（body: height:100vh; height:100dvh）, 行18（#app: height:100vh; height:100dvh）, 行24（#stage: width:min(100vw,177.7778dvh); height:min(100dvh,56.25vw)）— 3行
- 100vh / vh の値を持つ行: 16, 18, 23（#stage: width:min(100vw,177.7778vh); height:min(100vh,56.25vw)）
- inset（CSS の inset プロパティ）: 行16, 18, 28, 36, 53, 58, 61, 82, 118, 128, 167, 233, 314 — 13行（すべて `inset:0`）
- aspect-ratio: 0件
- container-type: 行25 `container-type:size`（1件）
- safe-area-inset: 行112（env(safe-area-inset-top), env(safe-area-inset-right)）, 189（-left）, 192（-left）, 198（-left）, 205（-right）, 209（-right）— 6行

---

## 6. 画面に表示される日本語の文字列で漢字を含むもの（行番号つき）

| 行 | 文字列 | 表示箇所 |
|---|---|---|
| 980 | `自由自在`（読み: じゆうじざい） | 地図えらびのカード・地図名（PRESETS） |
| 981 | `四方八方`（読み: しほうはっぽう） | 同上 |
| 982 | `品行方正`（読み: ひんこうほうせい） | 同上 |
| 983 | `三日坊主`（読み: みっかぼうず） | 同上 |
| 984 | `一日千秋`（読み: いちじつせんしゅう） | 同上 |
| 3273 | `見つめて見つけて`（.logo-top） | ロゴ（タイトル・起動画面）（logoHTML） |

- 行9 `<title>見つめて見つけてほシーカー（SEE-CAR）</title>`: ブラウザのタブ名に表示される（画面本体ではない）
- 行994 `THIN = { '鳥': 0, '麗': 0, '龍': 0, '自': 0, '由': 0, '在': 0 }`: 字ごとの線の太さの設定値（表示される文字列ではない）
- 行1866 `World.init を先に呼んでください`: 例外メッセージ（画面に表示されない）
- 行479 `aria-label="ホーム"`: 漢字なし（参考）
- HTML 本文（347〜496 行）内の表示文字列に漢字は含まれない（すべてひらがな・カタカナ）
- CSS の漢字: 13行のコメントのみ（表示されない）

---

## 7. localStorage

- キー名: `seecar.settings`（行3140 KEY_SET）, `seecar.record`（行3140 KEY_REC）

| 行 | 処理 | try/catch |
|---|---|---|
| 3141 | lsGet(k): `window.localStorage.getItem(k)` | あり（catch で null を返す） |
| 3142 | lsSet(k, v): `window.localStorage.setItem(k, v)` | あり（catch は空） |
| 3143 | readJSON(k): lsGet を呼び JSON.parse | あり（catch で null を返す） |
| 3148-3149 | loadSettings(): `readJSON(KEY_SET)`（seecar.settings を読む） | 読み取りは 3143 の try/catch 経由 |
| 3158-3159 | loadRecord(): `readJSON(KEY_REC)`（seecar.record を読む） | 読み取りは 3143 の try/catch 経由 |
| 3170 | saveSettings(): `lsSet(KEY_SET, JSON.stringify(settings))`（seecar.settings を書く） | 書き込みは 3142 の try/catch 経由 |
| 3171 | saveRecord(): `lsSet(KEY_REC, JSON.stringify(record))`（seecar.record を書く） | 書き込みは 3142 の try/catch 経由 |

- 呼び出し側: saveSettings は 3374, 3396 行、saveRecord は 3406, 3409 行、読み込みは 3914 行（`settings = loadSettings(); record = loadRecord();`）
- localStorage を直接呼ぶ行は 3141〜3142 の 2行のみ（他はこの関数を経由）
- sessionStorage / IndexedDB の使用: 0件

---

## 8. CPU の難しさごとの数値（行動の間隔、迷う割合、壁を壊す手間など）

| 行 | 内容 |
|---|---|
| 1128 | `var CPU_GAP = { easy: 1.2, normal: 0.6, hard: 0.28 };`（CPUの1手の間隔・秒） |
| 1129 | `var CPU_DOUBT = { easy: 0.14, normal: 0.04, hard: 0 };`（まよう＝立ち止まる・きょろきょろする割合） |
| 1130 | `var CPU_WAIT0 = 0.4;`（開始演出のあと CPU が動き出すまでの間・秒。難しさによらず共通） |
| 1133 | `var BREAK_COST = 30;`（道さがしで壁を壊す手間。進む1手は1） |
| 1899 | `var lv = CPU_GAP[cpuOpt.level] ? cpuOpt.level : 'normal';`（未知の難しさは normal にする） |
| 1900 | `S.cpu.ai = { level: lv, gap: CPU_GAP[lv], wait: CPU_WAIT0, ... }` |
| 2498 | `relax(st, ..., dk + 1 + BREAK_COST, 4);`（壊して前へ進む手の費用に BREAK_COST を使用） |
| 2518 | `ai.wait -= dt;` |
| 2519 | `if (ai.wait > 0 || !actorFree(c) || c.shots > 0) return;` |
| 2521 | `if (!ai.plan || !ai.plan.length) { ai.wait = ai.gap; return; }` |
| 2524 | `if (step === 'F' && !ai.doubted && Math.random() < CPU_DOUBT[ai.level])`（まよいの判定に CPU_DOUBT を使用） |
| 2526 | `if (Math.random() < 0.5) { ai.wait = ai.gap; return; }`（まよいのとき半分の確率で立ち止まる） |
| 2532 | `if (c.fireCd > 0) return;` |
| 2542 | `if (ai.bumps >= 2 && c.fireCd <= 0) { fire(c); ai.bumps = 0; }`（進めない回数が2以上で撃つ） |
| 2546 | `ai.wait = ai.gap;`（1手ごとに gap を待つ） |

- 関連（数値なし）: 行376 `やさしい`「ゆっくり うごくよ」, 行377 `ふつう`「ふつうの はやさだよ」, 行378 `むずかしい`「とっても はやいよ」（HTML の難しさカードの説明文）
- 行3122 `LEVEL_NAME`（やさしい / ふつう / むずかしい / つうしん）: 数値なし

---

## 件数の要約
- 1. 外部URL・接続先: script 2件（10, 11）、Peer 接続呼び出し 3件（3012, 3062, 3074）、URL上書き用パラメータ 4種（2909-2913）、動的な img の src 4件（942, 3485, 3737, 3446）
- 2. ボタン類のサイズ指定: 節2-1〜2-7 に計上（.nbtn / #home / #dpad / #fire / #cam / .backbtn / モーダル / .bigcard / .lvcard / .seg button / .card / .key）
- 3. font-size: 70件（節3）
- 4. stopPropagation 明示 2行（3236, 3461）、preventDefault 明示 13行（3236, 3862〜3885 の 9行, 3903, 3904, 3950）、stopEv 呼び出し 17行。addEventListener 34行（ほか PeerJS の on() 登録 13行、img の onload / onerror 3行）
- 5. `* {` 1件（14行）、@media 1件（132行）、100dvh 3行、inset 13行、aspect-ratio 0件、container-type 1件（25行）、safe-area-inset 6行
- 6. 表示される漢字を含む文字列: 6件（980〜984, 3273）。ほか タイトル 1件（9行）、THIN のキー 1件（994行）、例外メッセージ 1件（1866行）
- 7. localStorage キー 2種。直接の読み書き行 2行（3141, 3142）。関数経由の読み書き行 5行（3143, 3170, 3171 の定義行 ＋ 3149, 3159 の読み込み行）。すべて try/catch あり
- 8. CPU の難しさごとの数値行: 1128, 1129, 1130, 1133, 1899, 1900, 2498, 2518, 2519, 2521, 2524, 2526, 2532, 2542, 2546 の 15行
