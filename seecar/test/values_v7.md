# seecar_v7.html から書き出した値の一覧

- 対象ファイル: `/home/user/my-first-repo/seecar/dist/seecar_v7.html`（全 4766 行）
- 行番号はすべて実ファイルの行番号（1始まり）。CSS は 12〜311 行、HTML 本体は 313〜468 行、JavaScript は 469〜4764 行。
- 評価や合否は書いていない。値と位置だけを書いている。

## 1. 外部から読み込むURL・接続先

| 種類 | 行 | 値 |
|---|---|---|
| script src | 10 | https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js |
| script src | 11 | https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js |
| link href | - | 該当なし（0件） |
| fetch / XHR / WebSocket / import など | - | 該当なし（0件） |
| CSS の url()（外部参照） | 39 | 該当なし。39 行の 1 件は data: URI の中の SVG フィルタ参照 `url(%23n)` で、外部通信はしない |
| new Peer（PeerJS） | 3526 | `peer = new Peer('seecar-hoshi-' + code, peerOptions());` |
| new Peer（PeerJS） | 3576 | `try { p = new Peer(peerOptions()); } catch (e) { fail(s, 'error', 'no-peerjs', MSG.server); return; }` |

- PeerJS の接続先は、ファイル内に host の指定がない（PeerJS ライブラリの既定値を使う）。3419〜3430 行 `peerOptions()` で、URL パラメータ `peerhost` `peerport` `peerpath` `peersecure` を読んで上書きできる。
- 3896 行の `url(#stripe)` は SVG 内の部品参照で、外部の通信先ではない。39 行の `xmlns` も外部通信はしない。

## 2. ボタン類のサイズ（CSS の指定値・単位のまま）

対象：`button` 要素、または id / class に fwd・jump・drill・home・cam・nav・card・key・モーダル（modal）・設定（setting）を含むもの。
「設定」は画面上の表示が「せってい」なので、ボタン名としては 3924 行の `label: 'せってい'` が該当する。

| 行 | セレクタ | 指定（幅・高さ・最小・最大・font-size） |
|---|---|---|
| 85 | `.nbtn` | width:64cqmin; height:16cqmin; font-size:6.4cqmin |
| 87 | `.nbtn i` | width:8cqmin; height:8cqmin |
| 88 | `.nbtn i svg` | width:100%; height:100% |
| 95 | `#home` | width:12cqmin; height:12cqmin |
| 97 | `#home svg` | width:7.4cqmin; height:7.4cqmin |
| 105 | `.mbtns .nbtn` | width:50cqmin |
| 118 | `.nbtn.hero` | width:96cqmin; height:20cqmin; font-size:10cqmin |
| 120 | `.nbtn.hero i` | width:11cqmin; height:11cqmin |
| 122 | `.nbtn.sub` | width:auto; height:12.4cqmin; font-size:4.7cqmin |
| 123 | `.nbtn.sub i` | width:6.2cqmin; height:6.2cqmin |
| 132 | `.backbtn` | height:12cqmin; min-width:25cqmin; font-size:4.8cqmin |
| 134 | `.backbtn i` | width:0; height:0 |
| 147 | `.howcard` | max-width:54cqmin; height:70cqmin |
| 149 | `.howcard .hpic` | width:100%; height:30cqmin |
| 151 | `.howcard .hpic svg` | width:100%; height:100% |
| 152 | `.howcard b` | font-size:4.9cqmin |
| 153 | `.howcard small` | font-size:3.3cqmin |
| 157 | `.bigcard` | width:62cqmin; height:56cqmin; font-size:7.4cqmin |
| 158 | `.bigcard svg` | width:24cqmin; height:24cqmin |
| 159 | `.sub-who .bigcard` | width:74cqmin; font-size:5.8cqmin |
| 177 | `.card .kan` | font-size:8.4cqmin |
| 178 | `.card .yomi` | font-size:2.2cqmin |
| 180 | `.card input[type=file]` | width:100%; height:100%; font-size:0 |
| 193 | `.card .ic` | width:9cqmin; height:9cqmin |
| 193 | `.card .ic svg,.card .ic img` | width:100%; height:100% |
| 195 | `.card.yoji .kan` | font-size:5.2cqmin |
| 196 | `.card.illust .kan` | font-size:4.8cqmin |
| 197 | `.maps.dense .card.yoji .kan` | font-size:4.3cqmin |
| 197 | `.maps.dense .card.illust .kan` | font-size:3.8cqmin |
| 197 | `.maps.dense .card .ic` | width:8cqmin; height:8cqmin |
| 198 | `.card.file` | height:11.6cqmin |
| 199 | `.card.file .ic` | width:6.4cqmin; height:6.4cqmin |
| 200 | `.card.file .kan` | width:auto; font-size:4.6cqmin |
| 201 | `.card.file .bw` | font-size:3cqmin |
| 205 | `.key` | font-size:8cqmin |
| 206 | `.key.del` | font-size:4.8cqmin |
| 214 | `.lvcard` | max-width:50cqmin; height:68cqmin |
| 215 | `.lvcard .lvpic` | width:26cqmin; height:26cqmin |
| 216 | `.lvcard .lvpic svg` | width:100%; height:100% |
| 217 | `.lvcard b` | font-size:8cqmin |
| 218 | `.lvcard small` | font-size:3.4cqmin |
| 219 | `.lvcard em` | font-size:3.3cqmin; min-height:9.2cqmin |
| 224 | `.setcard` | min-height:0 |
| 226 | `.setcard.wide .sc-hint` | font-size:3.6cqmin |
| 227 | `.setcard.wide .seg` | width:48cqmin |
| 231 | `.seg button` | height:11.6cqmin; font-size:4.8cqmin |
| 233 | `.seg button.on::before` | width:2.2cqmin; height:3.8cqmin |
| 269 | `.ctl i svg` | width:100%; height:100% |
| 271 | `#fwd` | width:36cqmin; height:36cqmin |
| 272 | `#fwd i` | width:15cqmin; height:17cqmin |
| 272 | `#fwd span` | font-size:7.4cqmin |
| 273 | `.ctl.act` | width:26cqmin; height:26cqmin |
| 274 | `.ctl.act i` | width:12.4cqmin; height:12.4cqmin |
| 274 | `.ctl.act span` | font-size:4cqmin |
| 280 | `#cam` | width:15cqmin; height:14cqmin |
| 281 | `#cam i` | width:8cqmin; height:7.4cqmin |
| 282 | `#cam i svg` | width:100%; height:100% |
| 283 | `#cam span#cam-label` | font-size:3cqmin |

補足（CSS に直接の幅・高さの指定がないもの）:

| 行 | 要素 | 内容 |
|---|---|---|
| 457,458 | `#m-no` `#m-yes` | 幅・高さの指定なし。`.nbtn`（高さ16cqmin・font-size 6.4cqmin）と `.mbtns .nbtn`（幅50cqmin）を継承 |
| 3946 | `.nbtn`（JavaScript で生成） | 3937 行 `renderNav()` で作る（生成は 3946 行）。サイズは CSS 85 行・118 行・122 行で指定 |
| 4250 | `.key`（JavaScript で生成） | 4244〜4253 行 `buildKeypad()` で作る。サイズは CSS 204〜206 行で指定 |
| 4083 | `.card`（JavaScript で生成） | 4083 行で作る。`.card` 自体に幅・高さの指定はなく、`.grp .row` の grid（192 行）で決まる |
| 422,423,424,425,426,451 | `#fwd` `#b-jump` `#b-attack` `#b-dj` `#cam` `#home`（HTML 要素） | 422〜426 行・451 行に記述。`#b-jump` `#b-attack` `#b-dj` は `.ctl.act`（273 行）の幅・高さを使う |

## 3. CSS の font-size の指定値すべて

| 行 | セレクタ | font-size |
|---|---|---|
| 75 | `.touchme` | 7.4cqmin |
| 79 | `.bye` | 12cqmin |
| 85 | `.nbtn` | 6.4cqmin |
| 103 | `.mtitle` | 7.6cqmin |
| 112 | `.ptext` | 7.6vmin |
| 118 | `.nbtn.hero` | 10cqmin |
| 122 | `.nbtn.sub` | 4.7cqmin |
| 124 | `.recchip` | 3.2cqmin |
| 125 | `.recchip b,.endrec b` | 3.4cqmin |
| 130 | `.head` | 6.2cqmin |
| 132 | `.backbtn` | 4.8cqmin |
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
| 284 | `#tip` | 3.4cqmin |
| 290 | `.found` | 11.6cqmin |
| 293 | `.found.long` | 8.6cqmin |
| 296 | `.who` | 4.4cqmin |
| 298 | `.endrec` | 3.4cqmin |
| 300 | `.endrec b` | 3.3cqmin |
| 302 | `.endtitle` | 9cqmin |
| 303 | `.endyomi` | 3.8cqmin |

- 件数はセレクタ単位（同じ行に複数セレクタがある場合も 1 件ずつ数えた）。

## 4. stopPropagation / preventDefault と addEventListener

### 4-1. `stopPropagation` / `preventDefault` を直接書いている行

| 行 | 場面 | 書かれている内容 |
|---|---|---|
| 3847 | stopEv 関数の定義（tap / hold / モーダル / スワイプ面で使う） | stopPropagation() と preventDefault() |
| 4100 | ファイル選択欄 input（えを よみこむ）の pointerdown / pointerup | stopPropagation() のみ |
| 4634 | onKeyDown：boot 画面中の任意のキー | preventDefault() |
| 4636 | onKeyDown：モーダル表示中の Escape | preventDefault() |
| 4641 | onKeyDown：プレイ中の操作キー（KEYS に登録のキー） | preventDefault() |
| 4642 | onKeyDown：プレイ中の c キー（視点切替） | preventDefault() |
| 4643 | onKeyDown：プレイ中の Escape | preventDefault() |
| 4647 | onKeyDown：数字キーの入力（わかば入力画面） | preventDefault() |
| 4648 | onKeyDown：Backspace（わかば入力画面） | preventDefault() |
| 4652 | onKeyDown：Enter キー（先頭の nav ボタン） | preventDefault() |
| 4657 | onKeyUp：操作キーを離したとき | preventDefault() |
| 4676 | document：contextmenu | preventDefault() |
| 4677 | document：gesturestart / gesturechange / gestureend / dblclick | preventDefault() |
| 4729 | スワイプ面（#swipe）：touchstart / touchmove（passive: false） | preventDefault() |

### 4-2. `stopEv(e)` を呼んでいる行（中で stopPropagation と preventDefault を両方実行。`addEventListener(..., stopEv)` の形は 4-3 に入れている）

| 行 | 行の内容（抜粋） |
|---|---|
| 3850 | `el.addEventListener('pointerdown', function (e) { stopEv(e); armed = true; el.classList.add('down'); unlock(); });` |
| 3852 | `stopEv(e); var was = armed; armed = false; el.classList.remove('down');` |
| 3855 | `function off(e) { stopEv(e); armed = false; el.classList.remove('down'); }` |
| 3876 | `stopEv(e); unlock();` |
| 3882 | `function up(e) { stopEv(e); if (pid === null \|\| e.pointerId === pid) { pid = null; press(act, false); } }` |
| 4564 | `stopEv(e); unlock();` |
| 4571 | `stopEv(e);` |
| 4594 | `stopEv(e); sw = null;` |

### 4-3. addEventListener で登録しているイベント名と対象

| 行 | 対象要素 | イベント名 | 登録内容 |
|---|---|---|---|
| 2019 | window | resize | 画面サイズ変更時の再計算（初回のみ登録） |
| 3623 | window | pagehide | teardown（通信の後片付け） |
| 3850 | tap() の対象（ボタン類） | pointerdown | 押下の処理（stopEv・down 表示・unlock） |
| 3851 | tap() の対象 | pointerup | 離したときに fn を実行 |
| 3856 | tap() の対象 | pointercancel | 押下の取り消し（off） |
| 3857 | tap() の対象 | pointerleave | 押下の取り消し（off） |
| 3858 | tap() の対象 | click | stopEv |
| 3859 | tap() の対象 | contextmenu | stopEv |
| 3875 | hold() の対象（.ctl[data-act]：すすむ・ジャンプ・ドリル） | pointerdown | 押している間の操作を開始（press(act,true)） |
| 3883 | hold() の対象 | pointerup | press(act,false) |
| 3884 | hold() の対象 | pointercancel | press(act,false) |
| 3885 | hold() の対象 | lostpointercapture | press(act,false) |
| 3886 | hold() の対象 | click | stopEv |
| 3887 | hold() の対象 | contextmenu | stopEv |
| 4100 | ファイル選択 input | pointerdown / pointerup | stopPropagation と unlock |
| 4101 | ファイル選択 input | change | 選んだ画像の読み込み |
| 4676 | document | contextmenu | preventDefault |
| 4677 | document | gesturestart / gesturechange / gestureend / dblclick | preventDefault |
| 4678 | document | keydown | onKeyDown |
| 4679 | document | keyup | onKeyUp |
| 4680 | window | blur | releaseAll（押下の全解除） |
| 4684 | MediaQueryList（(orientation: portrait)） | change（無ければ addListener） | applyPortraitPause |
| 4703 | #modal（els.modal） | pointerdown | stopEv |
| 4704 | #modal | pointerup | stopEv |
| 4705 | #modal | click | stopEv |
| 4722 | #swipe（els.swipe） | pointerdown | swipeDown |
| 4723 | #swipe | pointermove | swipeMove |
| 4724 | #swipe | pointerup | swipeUp |
| 4725 | #swipe | pointercancel | swipeUp |
| 4726 | #swipe | lostpointercapture | ドラッグ情報を消す |
| 4727 | #swipe | click | stopEv |
| 4728 | #swipe | contextmenu | stopEv |
| 4729 | #swipe | touchstart / touchmove（passive: false） | preventDefault |
| 4761 | document | DOMContentLoaded（読み込み前のみ） | init |

- tap() に渡しているボタン類：`#boot` 4699、`#home` 4700、`#m-no` 4701、`#m-yes` 4702、`#back` 4706、`#c-host` 4707、`#c-join` 4708、`#cam` 4709、`#reset-rec` 4710、`.seg button[data-set]` 4713、`.lvcard` 4716、`.howcard` 4718、`[data-who]` 4720、`.nbtn`（renderNav 3949）、`.card`（4088）、`.key`（4252）。
- hold() に渡しているボタン：`.ctl[data-act]` 4731（#fwd・#b-jump・#b-attack・#b-dj）。
- PeerJS の `peer.on` / `conn.on` は addEventListener ではないため、上の表には入れていない。該当行：3482, 3503, 3504, 3532, 3538, 3551, 3552, 3555, 3558, 3566, 3578, 3583, 3586。

## 5. CSS の共通規則・@media・単位・配置の指定

| 項目 | 行 | 値 |
|---|---|---|
| `* {` の規則の中身 | 16 | `*{user-select:none;-webkit-user-select:none;touch-action:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;box-sizing:border-box}` |
| @media の条件 | 114 | `screen and (orientation: portrait)`（114 行 `@media screen and (orientation: portrait){#portrait{display:flex}}`） |
| JavaScript の matchMedia | 4415,4682 | `(orientation: portrait)`（縦持ちの判定） |
| 100dvh の出現行 | 18,20,26 | 18 行（body の height）、20 行（#app の height）、26 行（#stage の height と width） |
| inset（プロパティ）の出現行 | 18,20,30,38,55,60,63,100,110,180,240,307 | 各行に `inset:0` 付きの position 指定 |
| aspect-ratio の出現行 | - | 該当なし（0件） |
| container-type の出現行 | 27 | `container-type:size`（#stage） |
| safe-area-inset の出現行 | 95,242,271,275,276,277,280 | `env(safe-area-inset-top / right / bottom / left)` を使用（#home・#sonar・#fwd・#b-jump・#b-attack・#b-dj・#cam） |

## 6. 画面に表示される日本語の文字列（漢字を含むもの）

| 行 | 文字列 | 区分・表示の場所 |
|---|---|---|
| 9 | 見つけて！PixSee | `<title>`（ブラウザのタブ名） |
| 1071 | 自由自在 | 四字熟語の地図カードの名前（表示） |
| 1072 | 四方八方 | 同上（表示） |
| 1073 | 品行方正 | 同上（表示） |
| 1074 | 三日坊主 | 同上（表示） |
| 1075 | 一日千秋 | 同上（表示） |
| 3898 | 見つけて！ | タイトル画面のロゴ（SVG の text。表示） |
| 3894 | 見つけて！PixSee | ロゴ SVG の aria-label（画面には出ず、読み上げ用） |
| 2238 | World.init を先に呼んでください | throw する例外の文言（通常は画面に出ない） |
| 1085 | 鳥 麗 龍 自 由 在 | 字の太さ調整の表 THIN のキー（描画用。文字そのものは表示されない） |

- 漢字を含む行は全体で 375 行あるが、その大半はコメント・変数名・コード中の注釈で、画面には出ない。上の表は、文字列として画面に出る可能性がある行だけを挙げている。
- HTML 本体（313〜468 行）の表示文字には漢字を含むものはない。

## 7. 指定の語を含む文字列（ファイル全体を検索）

検索範囲：HTML・CSS・JavaScript の全行（コメントを含む）。

| 語 | 件数 | 行 |
|---|---|---|
| たたか | 0 | - |
| バトル | 0 | - |
| たいけつ | 0 | - |
| 対決 | 0 | - |
| 対戦 | 0 | - |
| 勝負 | 0 | - |
| 大砲 | 0 | - |
| うつ | 0 | - |
| 戦車 | 0 | - |
| ドゴォ | 0 | - |
| かち | 0 | - |
| まけ | 0 | - |
| 勝 | 0 | - |
| 負 | 0 | - |

- 合計 0 件。

## 8. localStorage

| 項目 | 行 | 内容 |
|---|---|---|
| キー名 | 3661 | `pixsee.settings`（設定）、`pixsee.record`（くらべっこの記録）。`KEY_SET` と `KEY_REC` で定義 |
| 読み込み（getItem） | 3662 | `lsGet(k)`：`window.localStorage.getItem(k)` |
| 読み込み（JSON 解析） | 3664 | `readJSON(k)`：`lsGet(k)` の結果を JSON.parse |
| 読み込み（設定） | 3667 | `loadSettings()`：`readJSON(KEY_SET)` |
| 読み込み（記録） | 3683 | `loadRecord()`：`readJSON(KEY_REC)` |
| 書き込み（setItem） | 3663 | `lsSet(k, v)`：`window.localStorage.setItem(k, v)` |
| 書き込み（設定） | 3695 | `saveSettings()`：`lsSet(KEY_SET, JSON.stringify(settings))` |
| 書き込み（記録） | 3696 | `saveRecord()`：`lsSet(KEY_REC, JSON.stringify(record))` |
| 呼び出し（保存） | 4025, 4044, 4050, 4512, 4518, 4522 | 4025 むずかしさの選択、4044 設定の変更（setOpt）、4050 記録の消去（resetRecord）、4512 くらべっこ（race）の結果、4518 おおい（count）の結果、4522 ひとりあそびの結果 |
| 呼び出し（読み込み） | 4687 | `settings = loadSettings(); record = loadRecord();`（初期化時） |
| try/catch | 3662, 3663, 3664 | 3 関数とも try/catch あり。読めない・書けない場合は既定値で動く（3660 行のコメントどおり） |

## 9. 難しさ・移動・ジャンプ・ソナー・制限時間の数値

### 9-1. CPU の難しさごとの数値

| 行 | 内容 |
|---|---|
| 1572 | `var CPU_LV = {`（CPU：速さ（マス/秒）・回る速さ・動作のあとの間（秒）・まよう割合） |
| 1573 | `easy: { speed: 0.9, turn: 2.4, pause: 0.6, doubt: 0.12 }` |
| 1574 | `normal: { speed: 1.6, turn: 4.2, pause: 0.25, doubt: 0.03 }` |
| 1575 | `hard: { speed: 2.4, turn: 7.5, pause: 0.06, doubt: 0 }` |
| 1577 | `CPU_WAIT0 = 0.4`（開始演出のあと、CPU が動き出すまでの秒数。全難易度共通） |
| 2273〜2276 | 難しさの読み込み（`CPU_LV[cpuOpt.level]`）、`cfg.speed` の設定、`style: lv === 'easy' ? 'jump' : 'front'`（やさしいだけ跳ぶ作戦） |
| 2963, 2971 | `c.ai.cfg.turn * dt`（回る速さの使用） |
| 3002 | `ai.pause = ai.cfg.pause * 1.5`（まよって止まるときは 1.5 倍） |
| 3011, 3017 | `ai.pause = ai.cfg.pause`（動作のあとの間） |
| 3636〜3637 | `LEVELS = ['easy', 'normal', 'hard']`、`LEVEL_NAME`（やさしい・ふつう・むずかしい） |

### 9-2. 移動の速さ・ジャンプの高さ

| 行 | 内容 |
|---|---|
| 1560 | `SPEED = 2.4`（「すすむ」の速さ・マス/秒） |
| 1561 | `AIR_SPEED = 2.4`（空中で前へ進む速さ） |
| 1562 | `KEY_TURN = 2.6`（キーボードで回る速さ・ラジアン/秒） |
| 1565 | `GRAV = 22`（ジャンプの重さ） |
| 1566 | `JUMP_UP = 5`（ジャンプで乗れる段数） |
| 1567 | `JUMP_EXTRA = 0.08`（頂点の上乗せ） |
| 1568 | `CROUCH = 0.13`（跳ぶ前に凹む時間・秒） |
| 1570 | `DJ = { g: 14, rise: 0.95, flip: 0.42, hang: 0.22, bore: 0.55, popVy: 4.4, unflip: 0.45 }`（ドリルジャンプ） |
| 1226 | `SPEED_REF = 3.2`（シーカーモデル側の速さ換算） |
| 1921 | `speed: SPEED`（シーカーの初期速さ） |
| 2751 | ドリルジャンプの上昇速度 `Math.sqrt(2 * DJ.g * ...)` |
| 2764〜2765 | ジャンプの頂点 `vis(a.lv + JUMP_UP) + JUMP_EXTRA` と、初速 `Math.sqrt(2 * GRAV * ...)`（ジャンプの高さの計算） |
| 2859 | `sp = (a.air ? Math.max(a.speed, AIR_SPEED) : a.speed) * inp.fwd`（進む速さの計算） |

### 9-3. ソナーの半径

| 行 | 内容 |
|---|---|
| 3307 | `radius = radius == null ? 10 : +radius`（既定の半径 10 マス） |
| 3642 | `SONAR_R = 10`（ソナーの半径・ブロック） |
| 4443 | `World` の sonar に `SONAR_R` を渡す |
| 4468 | 半径をこえる点を `SONAR_R` の円に収める |

### 9-4. 制限時間（10 分）

| 行 | 内容 |
|---|---|
| 345 | HTML の説明文「10ぷんで」 |
| 415 | HTML のタイマー表示の初期値 `10:00` |
| 3641 | `COUNT_SEC = 600`（どっちが おおい？ の時間。10 分＝600 秒） |
| 3842 | `var timeLeft = COUNT_SEC` |
| 4313 | 開始時に `timeLeft = COUNT_SEC` に戻す |
| 4419 | 残り 30 秒以下でタイマーを `low` 表示（赤） |
| 4426〜4428 | 残り時間を減らし、0 になったら `endCount(false)` |
| 4753 | `_setTime`：残り時間を変える（確認用） |

