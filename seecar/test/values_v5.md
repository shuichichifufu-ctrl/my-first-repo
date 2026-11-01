# seecar_v5.html 値の書き出し

対象: /home/user/my-first-repo/seecar/dist/seecar_v5.html（3702行）
行番号はすべてこのファイルの行番号。評価・合否は含まない。

---

## 1. 外部から読み込むURL・接続先

| 行 | 種類 | 値 |
|---|---|---|
| 10 | script src | `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js` |
| 11 | script src | `https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js` |
| 2735 | new Peer | `new Peer('seecar-hoshi-' + code, peerOptions())`（接続先はURL既定値。ファイル内に直接書かれたホスト名なし） |
| 2785 | new Peer | `new Peer(peerOptions())`（同上） |
| 2797 | p.connect | `p.connect('seecar-hoshi-' + code, { serialization: 'json', reliable: true })` |
| 2628-2640 | peerOptions() の上書き | URLクエリ `peerhost` / `peerport` / `peerpath` / `peersecure` で host・port・path・secure を指定可能（既定ではこれらは未設定） |

- fetch(...) の出現: 0件
- XMLHttpRequest / import() / WebSocket / sendBeacon の出現: 0件
- 行37: `data:image/svg+xml` の中の文字列 `xmlns='http://www.w3.org/2000/svg'`（読み込みではなく名前空間の文字列）

---

## 2. ボタン類のサイズ指定（CSS）

値は CSS に書かれた値（単位のまま）。cqmin は `#stage` 基準の単位。

### 2-1. #nav のボタン（.nbtn 系）
| 行 | セレクタ | 指定 |
|---|---|---|
| 102 | `.nbtn` | width: 64cqmin / height: 16cqmin |
| 103 | `.nbtn` | font-size: 6.4cqmin |
| 104 | `.nbtn i` | width: 8cqmin / height: 8cqmin |
| 106 | `.nbtn.primary` | （サイズ指定なし） |
| 107 | `.nbtn.secondary` | （サイズ指定なし） |
| 123 | `.mbtns .nbtn` | width: 44cqmin |
| 335 | `.mbtns .nbtn` | width: 50cqmin（後の行で上書き） |
| 246 | `body[data-state=title] #nav` | padding: 0 4cqmin |
| 248 | `.nbtn.hero` | display: grid（grid-template-columns: 11cqmin auto） |
| 249 | `.nbtn.hero` | width: 96cqmin / height: 20cqmin / font-size: 9.6cqmin |
| 250 | `.nbtn.hero i` | width: 11cqmin / height: 11cqmin |
| 252 | `.nbtn.hero small` | font-size: 3.4cqmin |
| 253 | `.nbtn.sub` | width: auto / height: 12.4cqmin / padding: 0 4.4cqmin / font-size: 4.7cqmin |
| 254 | `.nbtn.sub i` | width: 6.2cqmin / height: 6.2cqmin |
| 247 | `.nbtn small` | font-size: 3.2cqmin |
| 100 | `#nav` | bottom: 4cqmin / gap: 5cqmin |

### 2-2. #home
| 行 | セレクタ | 指定 |
|---|---|---|
| 113 | `#home` | width: 12cqmin / height: 12cqmin |
| 114 | `#home svg` | width: 7.4cqmin / height: 7.4cqmin |

### 2-3. #fire / #cam / #dpad の中のボタン
| 行 | セレクタ | 指定 |
|---|---|---|
| 198 | `#dpad` | grid-template-columns: repeat(3,15cqmin) / grid-template-rows: repeat(3,15cqmin) / gap: 1cqmin |
| 199 | `#dpad .ctl` | （サイズ指定なし。border-radius: 3.4cqmin） |
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
| 243 | `.backbtn` | height: 12cqmin（後の行の規則） |
| 120 | `.mcard` | padding: 6cqmin 6cqmin 7cqmin（ボタン自体の指定ではない） |
| 124 | `#m-no` | （サイズ指定なし。background のみ） |
| 125 | `#m-yes` | （サイズ指定なし。background のみ） |
| 335 | `.mbtns .nbtn`（#m-no / #m-yes に適用） | width: 50cqmin |
| 336 | `.mtitle` | font-size: 7.6cqmin（後の行） |

### 2-5. 設定画面のボタン
| 行 | セレクタ | 指定 |
|---|---|---|
| 144 | `.bigcard`（#c-host / #c-join） | width: 62cqmin / height: 50cqmin / font-size: 7.4cqmin |
| 145 | `.bigcard svg` | width: 24cqmin / height: 24cqmin |
| 268 | `.lvcard`（難しさ） | flex: 1 / max-width: 50cqmin / height: 68cqmin |
| 270 | `.lvcard .lvpic` | width: 26cqmin / height: 26cqmin |
| 272 | `.lvcard b` | font-size: 8cqmin |
| 273 | `.lvcard small` | font-size: 3.4cqmin |
| 274 | `.lvcard em` | font-size: 3.8cqmin |
| 284 | `.seg button`（設定・消去ボタン） | flex: 1 / height: 11.6cqmin / font-size: 4.8cqmin |
| 150 | `.digits b`（4けたの数字の箱） | width: 23cqmin / height: 30cqmin / font-size: 21cqmin |
| 152 | `.digits.grid2 b` | height: 23cqmin / font-size: 17cqmin |

### 2-6. 地図えらびの .card / .key
| 行 | セレクタ | 指定 |
|---|---|---|
| 158 | `.card` | （幅・高さ指定なし。border-radius: 4cqmin） |
| 297 | `.card` | padding: 0 .4cqmin |
| 298 | `.card .ic` | width: 9cqmin / height: 9cqmin |
| 302 | `.maps.dense .card .ic` | width: 8cqmin / height: 8cqmin |
| 304 | `.card.file` | flex: none / height: 10.4cqmin / padding: 0 2cqmin |
| 305 | `.card.file .ic` | width: 6.4cqmin / height: 6.4cqmin |
| 166 | `.card.file .kan` | width: 100% / font-size: 4.2cqmin（後の行で上書き） |
| 306 | `.card.file .kan` | width: auto / font-size: 4.6cqmin |
| 163 | `.card.file svg` | width: 11cqmin / height: 11cqmin |
| 167 | `.card input[type=file]` | width: 100% / height: 100% / font-size: 0 |
| 177 | `.keypad` | grid-template-columns: repeat(3,18cqmin) / grid-auto-rows: 13.4cqmin / gap: 1.4cqmin |
| 178 | `.key` | （幅指定なし。font-size: 8cqmin） |
| 179 | `.key.del` | font-size: 4.8cqmin |

### 2-7. 最小サイズ（min-width / min-height）の出現
- 137 `.backbtn` min-width: 25cqmin
- 280 `.setcard` min-height: 0
- 288 `.sc-hint` min-height: 3.6cqmin（ボタンではない）
- 292 `.maps` min-width: 0 / 293 `.grp` min-height: 0 / 296 `.grp .row` min-height: 0（ボタンではない）

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

- font-size を HTML の style 属性や JS の style 指定で書いている箇所は、この一覧に含めていない。

---

## 4. stopPropagation / preventDefault と addEventListener

### 4-1. stopPropagation / preventDefault が書かれている行
- stopPropagation（明示）: 2959（stopEv の定義）, 3184（ファイル選択欄の pointerdown / pointerup）
- preventDefault（明示）: 2959, 3585, 3587, 3592, 3593, 3594, 3598, 3599, 3603, 3608（キーボード処理）, 3626（contextmenu）, 3627（gesture系・dblclick）, 3673（touchstart / touchmove）
- stopEv() 経由（stopPropagation と preventDefault の両方）の呼び出し行: 2962, 2964, 2967, 2970, 2971, 2985, 2986, 2990, 2991, 3521, 3528, 3544, 3651, 3652, 3653, 3671, 3672

### 4-2. addEventListener と対象（行番号つき）
| 行 | 対象 | イベント | 処理 |
|---|---|---|---|
| 931 | Image（ファイル読込） | onload | — |
| 941 | Image（ファイル読込） | onerror | — |
| 1464 | window | resize | resize() |
| 2691 | conn（PeerJS） | data | — |
| 2712 | conn（PeerJS） | close | — |
| 2713 | conn（PeerJS） | error | — |
| 2741 | peer（PeerJS） | error | — |
| 2747 | peer（PeerJS） | disconnected | — |
| 2760 | peer（PeerJS） | open | — |
| 2761 | peer（PeerJS） | disconnected | — |
| 2764 | peer（PeerJS） | connection | — |
| 2767 | conn（PeerJS） | open | — |
| 2775 | conn（PeerJS） | open | — |
| 2787 | p（PeerJS） | error | — |
| 2792 | p（PeerJS） | disconnected | — |
| 2795 | p（PeerJS） | open | — |
| 2832 | window | pagehide | teardown(true) |
| 2962 | tap() の el（ボタン） | pointerdown | stopEv / 押下 |
| 2963 | tap() の el | pointerup | stopEv / sfx / fn |
| 2968 | tap() の el | pointercancel | off |
| 2969 | tap() の el | pointerleave | off |
| 2970 | tap() の el | click | stopEv |
| 2971 | tap() の el | contextmenu | stopEv |
| 2985 | hold() の el（.ctl[data-act]） | pointerdown | stopEv / press(true) |
| 2987 | hold() の el | pointerup | up |
| 2988 | hold() の el | pointercancel | up |
| 2989 | hold() の el | pointerleave | up |
| 2990 | hold() の el | click | stopEv |
| 2991 | hold() の el | contextmenu | stopEv |
| 3184 | 写真選択の input[type=file] | pointerdown | stopPropagation / unlock |
| 3184 | 写真選択の input[type=file] | pointerup | stopPropagation / unlock |
| 3185 | 写真選択の input[type=file] | change | 読込 |
| 3626 | document | contextmenu | preventDefault |
| 3627 | document | gesturestart | preventDefault |
| 3627 | document | gesturechange | preventDefault |
| 3627 | document | gestureend | preventDefault |
| 3627 | document | dblclick | preventDefault |
| 3628 | document | keydown | onKeyDown |
| 3629 | document | keyup | onKeyUp |
| 3630 | window | blur | releaseAll |
| 3634 | matchMedia('(orientation: portrait)') | change | applyPortraitPause |
| 3651 | els.modal | pointerdown | stopEv |
| 3652 | els.modal | pointerup | stopEv |
| 3653 | els.modal | click | stopEv |
| 3666 | els.swipe | pointerdown | swipeDown |
| 3667 | els.swipe | pointermove | swipeMove |
| 3668 | els.swipe | pointerup | swipeUp |
| 3669 | els.swipe | pointercancel | swipeUp |
| 3670 | els.swipe | lostpointercapture | sw = null |
| 3671 | els.swipe | click | stopEv |
| 3672 | els.swipe | contextmenu | stopEv |
| 3673 | els.swipe | touchstart | preventDefault（passive: false） |
| 3673 | els.swipe | touchmove | preventDefault（passive: false） |
| 3697 | document | DOMContentLoaded | init（readyState が loading のとき） |

- tap() を使うボタン: #boot（3647）, #home（3648）, #m-no（3649）, #m-yes（3650）, #back（3654）, #c-host（3655）, #c-join（3656）, #cam（3657）, #reset-rec（3658）, .seg button[data-set]（3661）, .lvcard（3664）, #nav の各 .nbtn（3040）, .card（3172）, .key（3336）
- hold() を使うボタン: .ctl[data-act]（3675）= #dpad の 4 ボタンと #fire
- pointer系・touch系・gesture系・wheel・keydown・contextmenu のうち wheel の登録: 0件

---

## 5. `* {` の規則・@media・100dvh・inset・aspect-ratio・container-type・safe-area-inset

- 行14 `* {` の中身:
  `user-select:none;-webkit-user-select:none;touch-action:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;box-sizing:border-box`
- @media: 1件 — 行132 `@media screen and (orientation: portrait)`（#portrait を display:flex にする）
- 100dvh: 行16（body: height:100vh; height:100dvh）, 行18（#app: height:100vh; height:100dvh）, 行24（#stage: width:min(100vw,177.7778dvh); height:min(100dvh,56.25vw)）
  - 100vh / vh の値を持つ行: 16, 18, 23（#stage: width:min(100vw,177.7778vh); height:min(100vh,56.25vw)）
- inset: 行16, 18, 28, 36, 53, 58, 61, 82, 118, 128, 167, 233, 314（すべて `inset:0`）
- aspect-ratio: 0件
- container-type: 行25 `container-type:size`（1件）
- safe-area-inset: 行112（env(safe-area-inset-top), env(safe-area-inset-right)）, 行189, 192, 198, 205, 209（各 env(safe-area-inset-left) または -right）

---

## 6. 画面に表示される漢字を含む日本語文字列（行番号つき）

| 行 | 表示される文字列 | 表示箇所 |
|---|---|---|
| 9 | `見つめて見つけてほシーカー（SEE-CAR）` | `<title>`（ブラウザのタブ名） |
| 980 | `自由自在`（読み: じゆうじざい） | 地図えらびのカード・地図名 |
| 981 | `四方八方`（読み: しほうはっぽう） | 同上 |
| 982 | `品行方正`（読み: ひんこうほうせい） | 同上 |
| 983 | `三日坊主`（読み: みっかぼうず） | 同上 |
| 984 | `一日千秋`（読み: いちじつせんしゅう） | 同上 |
| 2996 | `見つめて見つけて`（.logo-top） | ロゴ（タイトル・起動画面） |

- 補足: 行994 `THIN = { '鳥': 0, '麗': 0, '龍': 0 }` の漢字は画面の文字列ではなく、字ごとの線の太さの設定値（表示される題目には含まれない）。
- 補足: 行1686 のエラー文 `World.init を先に呼んでください` は画面に表示されない（例外メッセージ）。
- HTML 本文（行355〜500）内の表示文字列に漢字は含まれない（すべてひらがな・カタカナ）。

---

## 7. localStorage

- キー名: `seecar.settings`（行2863 KEY_SET）, `seecar.record`（行2863 KEY_REC）

| 行 | 処理 | try/catch |
|---|---|---|
| 2864 | lsGet(k): `window.localStorage.getItem(k)` | あり（catch で null を返す） |
| 2865 | lsSet(k, v): `window.localStorage.setItem(k, v)` | あり（catch は空） |
| 2866 | readJSON(k): lsGet を呼び JSON.parse | あり（catch で null を返す） |
| 2872 | loadSettings(): `readJSON(KEY_SET)`（seecar.settings を読む） | 読み取りは 2866 の try/catch 経由 |
| 2882 | loadRecord(): `readJSON(KEY_REC)`（seecar.record を読む） | 読み取りは 2866 の try/catch 経由 |
| 2893 | saveSettings(): `lsSet(KEY_SET, JSON.stringify(settings))`（seecar.settings を書く） | 書き込みは 2865 の try/catch 経由 |
| 2894 | saveRecord(): `lsSet(KEY_REC, JSON.stringify(record))`（seecar.record を書く） | 書き込みは 2865 の try/catch 経由 |

- localStorage を直接呼ぶ行は 2864〜2865 の 2 行のみ（他はこの関数を経由）。
- sessionStorage / IndexedDB の使用: 0件

---

## 8. CPU の難しさごとの数値（行動の間隔など）

| 行 | 内容 |
|---|---|
| 1125 | `var CPU_GAP = { easy: 1.1, normal: 0.6, hard: 0.35 };`（CPUの1手の間隔・秒） |
| 1126 | `var CPU_WAIT0 = 0.4;`（開始演出のあと CPU が動き出すまでの間・秒。難しさによらず共通） |
| 1719 | `var lv = CPU_GAP[cpuOpt.level] ? cpuOpt.level : 'normal';`（未知の難しさは normal にする） |
| 1720 | `S.cpu.ai = { level: lv, gap: CPU_GAP[lv], wait: CPU_WAIT0, ... }` |
| 2257 | `ai.wait -= dt;` |
| 2258 | `if (ai.wait > 0 || !actorFree(c) || c.shots > 0) return;` |
| 2260 | `if (!ai.plan || !ai.plan.length) { ai.wait = ai.gap; return; }` |
| 2277 | `ai.wait = ai.gap;`（1手ごとに gap を待つ） |

- 関連（数値なし）: 行376 `やさしい`「ゆっくり うごくよ」, 行377 `ふつう`「ふつうの はやさだよ」, 行378 `むずかしい`「とっても はやいよ」（HTML の難しさカードの説明文）
- 参考（難しさによらない数値）: 行1127 `BREAK_COST = 2`（道さがしで壁を壊す手間）, 行2263 `if (c.fireCd > 0) return;`

---

## 件数の要約
- 1. 外部URL・接続先: script 2件、Peer 接続呼び出し 3件（2735, 2785, 2797）、URL上書き用パラメータ 4種
- 2. ボタン類のサイズ指定: 節2-1〜2-7 に計上（上記の表）
- 3. font-size: 70件
- 4. stopPropagation 明示 2行 / preventDefault 明示 13行 / stopEv 経由 17行、addEventListener 34行（ほか PeerJS の on() 登録 13行、img の onload / onerror 3行）
- 5. `* {` 1件、@media 1件、100dvh 3行、inset 13行、aspect-ratio 0件、container-type 1件、safe-area-inset 6行
- 6. 表示される漢字を含む文字列: 7件（ほか HTML 本文 0件）
- 7. localStorage キー 2種、読み書き行 7行（try/catch あり）
- 8. CPU 難しさの数値行: 8行（1125, 1126, 1719, 1720, 2257, 2258, 2260, 2277）
