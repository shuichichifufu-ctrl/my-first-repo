/* world.js — 3Dの世界（地形・シーカー・操作・カメラ・掘る演出・宝石・CPU）
   「見つけて！PixSee」v10.0（第5期）。公開するのは window.World だけ。THREE は r128 のグローバルを使う。
   シーカーの3Dモデルは seeker.js の window.SeekerModel（無いときは箱で代用して止まらない）。
   宝石の種類は mapgen.js の MapGen.GEMS（無いときはこのファイルの GEM_TABLE）。 */
(function () {
  'use strict';

  /* ===== W01. 定数（見た目・動き・ドリル・宝石） ===== */
  // 見た目の高さ：1段 = STEP_H。高さ0と1は「床のタイルの色」（平ら）、2〜10が積み木。壁（10）は 9段 = 1.8 の高さ（約2マス分）。
  var STEP_H = 0.2;
  function vis(h) { return h <= 1 ? 0 : (h - 1) * STEP_H; }
  var FLOOR_SAT = 1.9; // 床の色の鮮やかさ（1で元の色）
  // ---- 見た目の色（メニュー画面の「ブロック世界のジオラマ」とそろえる。style.css のデザイントークンと同じ値）----
  var SKY_TOP = '#9fd8f5';          // 空の上（--sky-top）
  var HAZE = 0xf3f8f4;              // 遠くのかすみ（空の地平線近くの色。明るく澄んだ空気）
  var CREAM = [1.0, 0.98, 0.94];    // 床の白（地図の白）＝クリームホワイト #fffaf0
  var ISLAND_SIDE = 0xeebd8c;       // 地図の島の側面（メニューの浮かぶ島と同じ、やわらかい土の色）
  var DX = [0, 1, 0, -1];
  var DZ = [-1, 0, 1, 0];

  // ---- 動き（単位：マス・秒）----
  var SPEED = 2.88;       // 「すすむ」の基本の速さ（マス/秒）。第3期の 2.4 の 1.2 倍
  var AIR_SPEED = 2.88;   // 空中で前へ進む速さ（CPUがゆっくりでも、前方ジャンプは届くように）
  var KEY_TURN = 2.6;     // ひだり・みぎ（キーボード）で回る速さ（ラジアン/秒）
  var SWIPE_GAIN = Math.PI; // 画面の幅いっぱいスワイプすると半回転
  var RAD = 0.3;          // 当たりの大きさ（中心から四角の半分）。1マスの通路を通れる
  var GRAV = 22;          // ジャンプの重さ（見た目の高さ/秒²）
  var JUMP_UP = 5;        // ジャンプで乗れる段数
  var JUMP_EXTRA = 0.08;  // 頂点は 足元+5段 の見た目より少し上
  var CROUCH = 0.13;      // 跳ぶ前に凹む時間
  // ---- 加速（まっすぐ進み続けている間だけ）----
  var ACCEL_STEP = 0.1;   // 1秒ごとに基本の速さの 10% ずつ
  var ACCEL_MAX = 5;      // 最大 5段（+50%）
  var ACCEL_TURN = 0.06;  // これより大きく向きが変わったら「方向転換」（ごく小さな揺れは無視）
  // ---- ドリルアタック（押している間ずっと）----
  var DA_WIND = 0.2;      // ドリルを正面へ向けるまで
  var DA_SPEED = 1.4;     // 掘りながら進む速さ（マス/秒）。1マスずつ壊しながらだと 約1.1マス/秒
  // ---- スピードの設定（第5期 2b）：SPEED・AIR_SPEED・DA_SPEED に掛ける。CPU も同じ倍率。加速（最大+50%）はこの上に掛かる ----
  //   slow＝第4期までの速さ、normal＝×1.25（既定）、fast＝×1.5（加速して 約6.5マス/秒。moveActor は 0.12マスずつ当たりを見るので壁を抜けない）
  var SPEED_MUL = { slow: 1, normal: 1.25, fast: 1.5 };
  var DA_BREAK = 0.35;    // 1マス壊すのにかかる時間（秒）。CPU も同じ
  var DA_REACH = 0.55;    // ドリルの先が届く距離（体の中心から）
  var DA_BACK = 0.25;     // 離したあと、ドリルが頭上へ戻る時間
  // ---- ジャンプドリル（押している間ずっと）：下を1段壊す → 小さく跳ねる をくり返す ----
  var JD = { g: 22, rise: 0.55, flip: 0.3, pop: 3.5, bore: 0.12, fwd: 1.1, exitVy: 4.4, unflip: 0.42, sink: 0.08 };
  var NL = 11;            // 道さがしの段の数（0〜10）
  var PITCH_MAX = 1;      // 視点の上下（-1〜+1）
  var INTRO_HOLD = 2.0, INTRO_MOVE = 1.8; // 開始演出：真上から2秒見せて、斜め後ろへ寄せる
  var CAM_BLEND = 0.9;
  // 視点（第5期 4b）：0 め、1 おいかけ、2 みわたし（新しい）、3 そら（真上）。cycleCamera は 0→1→2→3→0
  var CAM_EYE = 0, CAM_CHASE = 1, CAM_WIDE = 2, CAM_TOP = 3, CAM_N = 4;
  var DEBRIS_MAX = 600, PUFF_MAX = 96;
  // ---- 宝石 ----
  var GEM_R = 0.34;            // 宝石の大きさ
  var GEM_RISE = 1.7;          // 壊したマスから浮き上がる高さ（シーカーの頭より上）
  var GEM_OVER_HEAD = 3.4;     // 壊した人が すぐ下にいるとき、宝石は その人の足元から少なくともこの高さまで浮く（頭の上 約1.8）
  var GEM_SHOW = 3.0;          // 浮き上がって回りながら光る時間（そのあと持ち主へ吸い込まれる）
  var GEM_FLY = 0.55;          // 持ち主へ飛ぶ時間
  // MapGen.GEMS が無いときの代わり（順番は CONTRACT の決まりどおり）
  var GEM_TABLE = [
    { id: 'diamond', name: 'ダイヤモンド', color: '#eaf6ff', glow: '#ffffff' },
    { id: 'ruby', name: 'ルビー', color: '#e0115f', glow: '#ff5c8a' },
    { id: 'sapphire', name: 'サファイア', color: '#1f4fd8', glow: '#5c8cff' },
    { id: 'emerald', name: 'エメラルド', color: '#13a05a', glow: '#4fe39a' },
    { id: 'amethyst', name: 'アメシスト', color: '#8e44c9', glow: '#c48cff' },
    { id: 'topaz', name: 'トパーズ', color: '#ffae1a', glow: '#ffd36b' },
    { id: 'aquamarine', name: 'アクアマリン', color: '#5fd3e8', glow: '#a8f0ff' },
    { id: 'garnet', name: 'ガーネット', color: '#8f1023', glow: '#e0405a' },
    { id: 'peridot', name: 'ペリドット', color: '#9acd32', glow: '#d4f56b' },
    { id: 'opal', name: 'オパール', color: '#f4efe6', glow: '#ffe8f4' }
  ];
  // SeekerModel.PALETTES が無いときの体の色（10パターン。0 番＝いつものオレンジ）
  var BODY_FALLBACK = ['#e08524', '#4fc3f0', '#c4172e', '#2e9e4a', '#8c62d8', '#f6d322', '#ffa6c9', '#2a2f3a', '#6b4226', '#f5f5f0'];

  /* ===== W02. CPU の強さ（SPEC4 §6-3。調整はここだけ） ===== */
  // CPU は宝の座標を直接読まない。人と同じソナー（と 'light' のときは光の柱の向き）から、誤差つきで推理する。
  // 目安（test/world4_vsbot.js：宝の場所が正確に分かる「上手な人の代わりのボット」との勝ち負け）：
  //   ボットの勝率 むずかしい ≈65%、ふつう ≈75〜80%、やさしい ≈90%（ひかり・ソナーとも）。
  //   ボットは子どもより強いので、むずかしい は少し弱めの側に合わせている。
  var CPU_LEVELS = {
    easy: {
      speed: 0.68,      // 速さ：人の基本の速さに対する比率
      accelMax: 0,      // 加速の上限（基本の速さに対する比率。0 = 加速しない。人は +50%）
      react: 1.2,       // 反応の遅れ（秒）：ソナーを読み直す間隔・動き出すまでの間
      sonarErr: { ang: 0.45, dist: 0.3 }, // ソナーの読み取り誤差：向き（ラジアンの標準偏差）、距離（距離に対する割合）＝大
      mistake: 0.25,    // 道を間違える確率（新しく道を決めるたび）＝ときどき
      turn: 2.6         // 回る速さ（ラジアン/秒）
    },
    normal: {
      speed: 0.82,
      accelMax: 0.15,
      react: 0.9,
      sonarErr: { ang: 0.22, dist: 0.15 }, // 中
      mistake: 0.12,    // 少なめ
      turn: 4.0
    },
    hard: {
      speed: 0.86,
      accelMax: 0.15,
      react: 0.55,
      sonarErr: { ang: 0.1, dist: 0.08 }, // 小
      mistake: 0.05,    // まれ
      turn: 6.0
    }
  };
  var CPU_SONAR_R = 10;   // ソナーで距離が分かる半径（人の左上のソナーと同じ）
  var CPU_SONAR_FAR = 200; // 円の外の宝の向きを知らせる範囲（人のソナーの ふちのくさび と同じ。ui.js SONAR_FAR）
  var CPU_LIGHT_ERR = 0.6;  // 'light' のとき、光の柱の向きの読み取り誤差（ソナーの向きの誤差に対する割合。小さいほど正確）

  /* ===== W03. 小さな道具 ===== */
  function sfx(name) { try { if (window.Sfx && window.Sfx.play) window.Sfx.play(name); } catch (e) { /* 音が無くても続ける */ } }
  var engineLast = '';
  function engine(state, stage) {
    try { if (window.Sfx && typeof window.Sfx.engine === 'function') window.Sfx.engine(state, stage | 0); } catch (e) { }
    engineLast = state + ':' + (stage | 0);
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function gauss() { var u = 1 - Math.random(), v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function angLerp(a, b, t) { var d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }
  function dirToHeading(d) { return -d * Math.PI / 2; }
  function gemDefs() { var g = window.MapGen && window.MapGen.GEMS; return (g && g.length >= 10) ? g : GEM_TABLE; }
  function gemDef(n) { var g = gemDefs(); return g[((n | 0) % g.length + g.length) % g.length] || GEM_TABLE[0]; }

  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  /* ===== W04. 共通テクスチャ（init で1回だけ作る） ===== */
  var T = null;
  function buildSharedTextures() {
    T = {};
    var c, g, i;
    // ぼかした丸（影・煙・光）
    c = makeCanvas(64, 64); g = c.getContext('2d');
    var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    T.soft = new THREE.CanvasTexture(c);
    // ぼかした四角（地図の島の下の影）
    c = makeCanvas(128, 128); g = c.getContext('2d');
    g.shadowColor = '#fff'; g.shadowBlur = 14; g.fillStyle = '#fff'; g.fillRect(20, 20, 88, 88);
    T.softRect = new THREE.CanvasTexture(c);

    // 煙のもくもく（少しでこぼこ）
    c = makeCanvas(64, 64); g = c.getContext('2d');
    for (i = 0; i < 7; i++) {
      var cx = 32 + rand(-10, 10), cy = 32 + rand(-10, 10), r = rand(12, 20);
      gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    }
    T.puff = new THREE.CanvasTexture(c);


    // 星（宝のきらきら）
    c = makeCanvas(64, 64); g = c.getContext('2d');
    g.translate(32, 32); g.beginPath();
    for (i = 0; i < 10; i++) { var rr2 = i % 2 ? 9 : 30, an = i / 10 * Math.PI * 2 - Math.PI / 2; g.lineTo(Math.cos(an) * rr2, Math.sin(an) * rr2); }
    g.closePath(); g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 8; g.fill();
    T.star = new THREE.CanvasTexture(c);

    // 目じるしの星（白い紙の上でも空でも見えるよう、こい だいだい色のふち＋金色＋白いまん中）
    c = makeCanvas(64, 64); g = c.getContext('2d');
    g.translate(32, 32);
    function starPath(ro, ri) { g.beginPath(); for (var j = 0; j < 10; j++) { var rj = j % 2 ? ri : ro, aj = j / 10 * Math.PI * 2 - Math.PI / 2; g.lineTo(Math.cos(aj) * rj, Math.sin(aj) * rj); } g.closePath(); }
    gr = g.createRadialGradient(0, 0, 0, 0, 0, 31);
    gr.addColorStop(0, 'rgba(255,240,150,0.55)'); gr.addColorStop(1, 'rgba(255,200,60,0)');
    g.fillStyle = gr; g.fillRect(-32, -32, 64, 64);
    starPath(27, 11.5); g.lineJoin = 'round'; g.lineWidth = 5; g.strokeStyle = '#c4570f'; g.stroke();
    g.fillStyle = '#ffc61a'; g.fill();
    starPath(13, 5.5); g.fillStyle = '#fff7cf'; g.fill();
    T.hint = new THREE.CanvasTexture(c);

    // 光の柱（下が明るく、上へ消える）
    c = makeCanvas(4, 128); g = c.getContext('2d');
    gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0.9)');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
    T.beam = new THREE.CanvasTexture(c);

    // 空：メニュー画面（style.css #bg .sky）と同じ色の並び。上は明るい水色、地平線の近くはクリーム色。右上にやわらかい日だまり
    c = makeCanvas(256, 256); g = c.getContext('2d');
    gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, SKY_TOP); gr.addColorStop(0.42, '#cfeefb'); gr.addColorStop(0.72, '#eef9fd'); gr.addColorStop(1, '#fffaf0');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    gr = g.createRadialGradient(200, 30, 0, 200, 30, 150);
    gr.addColorStop(0, 'rgba(255,236,190,0.7)'); gr.addColorStop(1, 'rgba(255,236,190,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    T.sky = new THREE.CanvasTexture(c);
  }

  /* ===== W05. ブロックのやわらかい陰影（シェーダー） ===== */
  // メニュー画面の「ブロック世界のジオラマ」と同じ見た目：平らな色＋面ごとの明るさの違い＋角のやわらかい面取りの光＋足元のかげ。
  // 模様のテクスチャは使わない（紙やクレヨンの質感はやめた）。描画命令の数は変わらない。
  var SIDE_X = 0.76, SIDE_Z = 0.86;  // 側面の明るさ（上面=1）。東西の面を少し暗く
  var BLOCK_VERT = [
    '{',
    '  vec4 cw = vec4(transformed, 1.0);',
    '#ifdef USE_INSTANCING',
    '  cw = instanceMatrix * cw;',
    '  vCell = vec3(instanceMatrix[3].x - 0.5, instanceMatrix[1].y, instanceMatrix[3].z - 0.5);',
    '#else',
    '  vCell = vec3(0.0, 1.0, 0.0);',
    '#endif',
    '  vWP = (modelMatrix * cw).xyz;',
    '  vNl = normal;',
    '  vEdge = aEdge;',
    '  vFade = aFade;',
    '}'
  ].join('\n');
  var BLOCK_FRAG = [
    '{',
    '  float isTop = step(0.5, vNl.y);',
    // 辺の印（1=北 2=東 4=南 8=西）＝となりが低い（出っぱった）辺
    '  float e = vEdge;',
    '  float bN = mod(e, 2.0); e = floor(e / 2.0);',
    '  float bE = mod(e, 2.0); e = floor(e / 2.0);',
    '  float bS = mod(e, 2.0); e = floor(e / 2.0);',
    '  float bW = mod(e, 2.0);',
    // となりと接している（見えないはずの）側面は、上面と同じ明るさにする（すき間の細い縦すじを出さない）
    '  float sideOpen = vNl.x > 0.5 ? bE : (vNl.x < -0.5 ? bW : (vNl.z < -0.5 ? bN : bS));',
    '  float hidden = (1.0 - isTop) * (1.0 - sideOpen);',
    '  if (hidden > 0.5) diffuseColor.rgb *= 1.29 / ((abs(vNl.x) > 0.5 ? ' + SIDE_X.toFixed(2) + ' : ' + SIDE_Z.toFixed(2) + ') * (0.88 + 0.5 * max(dot(vNl, vec3(-0.455, 0.827, -0.331)), 0.0)));',
    '  float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));',
    '  float dark = 1.0 - smoothstep(0.12, 0.42, lum);',      // 墨色の壁ほど 1
    '  float lx = vWP.x - vCell.x, lz = vWP.z - vCell.z;',
    // 継ぎ目は近くだけ（遠く・上からの視点では細かい線がざらついて見えるので消す）
    '  float near = 1.0 - smoothstep(10.0, 26.0, distance(vWP, cameraPosition));',
    '  if (isTop > 0.5) {',
    // 上面：墨色の積み木は上面を少し明るい青みの灰色に（暗い壁でも形が読めるように）
    '    diffuseColor.rgb += dark * vec3(0.12, 0.125, 0.15);',
    // 出っぱった辺のやわらかい面取りの光
    '    float rim = max(max(bN * (1.0 - smoothstep(0.0, 0.11, lz)), bS * (1.0 - smoothstep(0.0, 0.11, 1.0 - lz))),',
    '                    max(bW * (1.0 - smoothstep(0.0, 0.11, lx)), bE * (1.0 - smoothstep(0.0, 0.11, 1.0 - lx))));',
    '    diffuseColor.rgb += rim * mix(0.13, 0.17, dark) * vec3(1.0, 0.98, 0.94);',
    // となりとの境目（ブロックの継ぎ目）をごく淡く
    '    float sx = min(lx, 1.0 - lx), sz = min(lz, 1.0 - lz);',
    '    float seam = max((1.0 - bW) * (1.0 - smoothstep(0.0, 0.025, lx)) + (1.0 - bE) * (1.0 - smoothstep(0.0, 0.025, 1.0 - lx)),',
    '                     (1.0 - bN) * (1.0 - smoothstep(0.0, 0.025, lz)) + (1.0 - bS) * (1.0 - smoothstep(0.0, 0.025, 1.0 - lz)));',
    '    diffuseColor.rgb *= 1.0 - 0.07 * near * clamp(seam, 0.0, 1.0);',
    '  } else if (hidden < 0.5) {',
    // 側面：上のふちに細い面取りの光、足元へゆっくり暗く（地面とのかげ）、縦の継ぎ目をごく淡く
    '    float fromTop = vCell.y - vWP.y;',
    '    diffuseColor.rgb += dark * vec3(0.03, 0.032, 0.04);',
    '    diffuseColor.rgb += (1.0 - smoothstep(0.0, 0.06, fromTop)) * mix(0.07, 0.12, dark) * vec3(1.0, 0.98, 0.94);',
    '    diffuseColor.rgb *= mix(0.8, 1.0, smoothstep(0.0, 0.45, vWP.y));',
    '    float t = abs(vNl.x) > 0.5 ? lz : lx;',
    '    diffuseColor.rgb *= 1.0 - 0.06 * near * (1.0 - smoothstep(0.0, 0.02, min(t, 1.0 - t)));',
    '  }',
    '}'
  ].join('\n');
  // カメラとシーカーの間にある積み木を、なめらかに薄く透かす（aFade 0..1）。
  // 同じ積み木を3回描く：①ふつうの積み木（透かす積み木だけ抜く）②透かす積み木の奥行きだけ（色は塗らない）
  // ③透かす積み木の色を半透明で（②のおかげで、いちばん手前の面だけが1枚ぶん重なる。中の面が何枚も重ならない）
  var BLOCK_CUT = {
    solid: 'if (vFade > 0.01) discard;',
    ghost: 'if (vFade <= 0.01) discard;'
  };
  // ③：上の面の明るさ計算のあとで、不透明度を下げる（vFade 0.7 → 不透明度 0.3）
  var BLOCK_ALPHA = 'diffuseColor.a *= clamp(1.0 - vFade, 0.0, 1.0);';
  // MeshLambertMaterial に積み木の陰影を足す（kind: 'solid'＝ふつう、'ghost'＝透かす積み木だけ）
  function blockShade(mat, kind) {
    kind = kind || 'solid';
    mat.onBeforeCompile = function (sh) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aEdge;\nattribute float aFade;\nvarying float vFade;\nvarying vec3 vWP;\nvarying vec3 vNl;\nvarying float vEdge;\nvarying vec3 vCell;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + BLOCK_VERT)
        // 透かす積み木の描画では、透かさない積み木の頂点を画面の外へ（塗る画素を作らない）
        .replace('#include <project_vertex>', '#include <project_vertex>\n' + (kind === 'ghost' ? 'if (aFade <= 0.01) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);' : ''));
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFade;\nvarying vec3 vWP;\nvarying vec3 vNl;\nvarying float vEdge;\nvarying vec3 vCell;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + BLOCK_CUT[kind === 'ghost' ? 'ghost' : 'solid'])
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + BLOCK_FRAG + (kind === 'ghost' ? '\n' + BLOCK_ALPHA : ''));
    };
    mat.customProgramCacheKey = function () { return 'seecar-block-soft-' + kind; };
    return mat;
  }

  function wrapAng(d) { while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
  function easeOutBack(t) { var c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  function dir4(heading) { return ((Math.round(-heading / (Math.PI / 2)) % 4) + 4) % 4; }

  /* ===== W06. 文字の演出（3Dの中に出す文字。争いの言葉は使わない） ===== */
  var textTexCache = {};
  function textTexture(word) {
    if (textTexCache[word]) return textTexCache[word];
    var c = makeCanvas(512, 192), g = c.getContext('2d');
    g.font = '900 112px "Hiragino Maru Gothic ProN","Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo","IPAGothic","Noto Sans JP",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = 24; g.strokeStyle = '#3a2614'; g.strokeText(word, 256, 100);
    g.fillStyle = '#fff4c8'; g.fillText(word, 256, 100);
    var t = new THREE.CanvasTexture(c);
    textTexCache[word] = t;
    return t;
  }

  /* ===== W07. シーカー（モデル・影・目じるし） ===== */
  var G = null; // 共有の形と目じるしの絵
  function buildGeo() {
    G = {
      shadow: new THREE.PlaneGeometry(0.95, 0.95),
      glow: new THREE.PlaneGeometry(1.02, 1.02)
    };
    G.shadow.rotateX(-Math.PI / 2);
    G.glow.rotateX(-Math.PI / 2);
    // 目じるし：自分＝金色の下向き三角、ほかの人＝白い丸（体の色がかぶっても見分けられる）
    var c = makeCanvas(128, 128), g = c.getContext('2d');
    g.lineJoin = 'round';
    g.beginPath(); g.moveTo(16, 22); g.lineTo(112, 22); g.lineTo(64, 112); g.closePath();
    g.lineWidth = 14; g.strokeStyle = '#5a3a00'; g.stroke();
    g.fillStyle = '#ffc61a'; g.fill();
    g.beginPath(); g.moveTo(34, 32); g.lineTo(94, 32); g.lineTo(64, 86); g.closePath(); g.fillStyle = '#ffe58a'; g.fill();
    G.meTex = new THREE.CanvasTexture(c);
    c = makeCanvas(128, 128); g = c.getContext('2d');
    g.beginPath(); g.arc(64, 64, 44, 0, Math.PI * 2);
    g.lineWidth = 14; g.strokeStyle = '#2b2f3a'; g.stroke();
    g.fillStyle = '#ffffff'; g.fill();
    G.otherTex = new THREE.CanvasTexture(c);
  }
  // seeker.js が無い・失敗したときの代わり（箱とぼうし）。落ちないことが目的
  function boxModel(color) {
    var root = new THREE.Group(), flip = new THREE.Group(), rig = new THREE.Group();
    flip.position.y = 0.38; rig.position.y = -0.38; root.add(flip); flip.add(rig);
    var mat = new THREE.MeshLambertMaterial({ color: color || '#e08524' });
    var hatMat = new THREE.MeshLambertMaterial({ color: 0x00d4ff });
    var bg = new THREE.BoxGeometry(0.7, 0.6, 0.7), hg = new THREE.ConeGeometry(0.26, 0.5, 12);
    var body = new THREE.Mesh(bg, mat); body.position.y = 0.38; rig.add(body);
    var hatPivot = new THREE.Group(); hatPivot.position.y = 0.72; rig.add(hatPivot);
    var hat = new THREE.Mesh(hg, hatMat); hat.position.y = 0.27; hatPivot.add(hat);
    return {
      root: root, flipPivot: flip, rig: rig, hatPivot: hatPivot, _own: [mat, hatMat, bg, hg],
      setColor: function (c) { mat.color.set(c); },
      update: function (dt, s) {
        s = s || {};
        flip.rotation.x = (s.flip || 0) * Math.PI;
        rig.scale.y = 1 - 0.3 * (s.squash || 0);
        hatPivot.rotation.x = (s.hatForward || 0) * Math.PI / 2;
      }
    };
  }
  // players[i] = {palette} （第4期）または {color}（従来）
  function paletteOf(i) {
    var p = S.players[i];
    if (p && p.palette != null && isFinite(+p.palette)) return clamp(+p.palette | 0, 0, 9);
    return null;
  }
  function colorOf(i) {
    var p = S.players[i];
    if (p && p.color) return p.color;
    var pal = paletteOf(i);
    if (pal != null) {
      var P = window.SeekerModel && window.SeekerModel.PALETTES;
      if (P && P[pal] && P[pal].body) return P[pal].body;
      return BODY_FALLBACK[pal];
    }
    return i === 0 ? '#e08524' : '#2f8be0';
  }
  function createModel(color, palette) {
    var m = null, SM = window.SeekerModel;
    try {
      if (SM && typeof SM.create === 'function') {
        if (palette != null && SM.PALETTES) m = SM.create({ palette: palette });
        else m = SM.create({ color: color });
      }
    } catch (e) { console.warn('SeekerModel.create failed', e); m = null; }
    if (!m || !m.root) m = boxModel(color);
    if (typeof m.update !== 'function') m.update = function () { };
    return m;
  }
  // 逆さ（flip=1）のとき、ドリルの先が足元（root の y=0）よりどれだけ下に出るか
  // （SeekerModel.tipDepth は「回転の軸（flipPivot）から先まで」の長さなので、軸の高さを引く）
  function computeTip(m) {
    if (typeof m.tipDepth === 'number' && isFinite(m.tipDepth)) {
      var py = m.flipPivot && m.flipPivot.position ? m.flipPivot.position.y : 0;
      return clamp(m.tipDepth - py, 0.15, 1.6);
    }
    var fp = m.flipPivot; if (!fp) return 0.5;
    var keep = fp.rotation.x;
    try {
      fp.rotation.x = Math.PI; m.root.updateMatrixWorld(true);
      var b = new THREE.Box3().setFromObject(m.root);
      fp.rotation.x = keep; m.root.updateMatrixWorld(true);
      if (!isFinite(b.min.y)) return 0.5;
      return clamp(-b.min.y, 0.15, 1.4);
    } catch (e) { fp.rotation.x = keep; return 0.5; }
  }
  function makeActor(idx, color, st, palette) {
    var model = createModel(color, palette);
    var tip = computeTip(model);
    var root = new THREE.Group();
    model.root.rotation.y = Math.PI; // モデルの前は +Z、ゲームの前（heading=0）は北（-Z）
    root.add(model.root);
    var col = new THREE.Color(color || '#e08524');
    var isMe = idx === S.myIndex;
    var mats = {
      shadow: new THREE.MeshBasicMaterial({ map: T.soft, color: 0x000000, transparent: true, opacity: 0.36, depthWrite: false }),
      glow: new THREE.MeshBasicMaterial({ map: T.soft, color: col, transparent: true, opacity: 0.4, depthWrite: false }),
      marker: new THREE.SpriteMaterial({ map: isMe ? G.meTex : G.otherTex, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false })
    };
    var shadow = new THREE.Mesh(G.shadow, mats.shadow); shadow.renderOrder = 1; root.add(shadow);
    var glow = new THREE.Mesh(G.glow, mats.glow); glow.renderOrder = 2; root.add(glow);
    var marker = new THREE.Sprite(mats.marker); marker.renderOrder = 40; marker.visible = false; root.add(marker);
    var a = {
      idx: idx, model: model, root: root, mats: mats, shadow: shadow, glow: glow, marker: marker, tip: tip, color: color, palette: palette,
      wx: (st.x | 0) + 0.5, wz: (st.z | 0) + 0.5, y: 0, vy: 0, lv: 0, air: false,
      heading: dirToHeading(((st.dir | 0) % 4 + 4) % 4),
      act: null, squash: 0, sqRate: 10, flip: 0, hatF: 0, spin: 0.15, lunge: 0, moveV: 0, turnV: 0,
      blinkT: rand(1.5, 4), hop: 0, bumpCd: 0, speed: SPEED * S.speedMul, shakeV: 0,
      accT: 0, stage: 0, stageMax: ACCEL_MAX, accHeading: 0, dustAcc: 0
    };
    a.accHeading = a.heading;
    var f = footInfo(a.wx, a.wz); a.y = f.y; a.lv = f.lv;
    return a;
  }
  function disposeActor(a) {
    if (!a) return;
    if (a.root.parent) a.root.parent.remove(a.root);
    for (var k in a.mats) a.mats[k].dispose();
    if (a.model._own) a.model._own.forEach(function (o) { try { o.dispose(); } catch (e) { } });
  }
  function recolorActor(a, color, palette) {
    if (palette != null && palette !== a.palette && a.model.setPalette) {
      a.palette = palette;
      try { a.model.setPalette(palette); } catch (e) { }
      var P = window.SeekerModel && window.SeekerModel.PALETTES;
      color = color || (P && P[palette] && P[palette].body) || BODY_FALLBACK[palette];
    }
    if (!color || color === a.color) return;
    a.color = color;
    try { if (!a.model.setPalette || a.palette == null) { if (a.model.setColor) a.model.setColor(color); } } catch (e) { }
    a.mats.glow.color.set(color);
  }
  // 毎フレームの見た目（位置・向き・影・まばたき・モデルへ状態を渡す）
  function animateActor(a, dt) {
    a.root.position.set(a.wx, a.y, a.wz);
    a.root.rotation.y = a.heading;
    var gy = footInfo(a.wx, a.wz).y, above = Math.max(0, a.y - gy);
    a.shadow.position.y = gy - a.y + 0.012;
    var ss = clamp(1 - above * 0.35, 0.45, 1); a.shadow.scale.set(ss, 1, ss);
    a.mats.shadow.opacity = 0.36 * ss;
    a.glow.position.y = gy - a.y + 0.016;
    var hopY = 0;
    if (a.hop > 0) { a.hop = Math.max(0, a.hop - dt); hopY = Math.abs(Math.sin((1.2 - a.hop) * 8)) * 0.3 * Math.min(1, a.hop * 2); }
    var sh = a.shakeV;
    a.model.root.position.set(sh ? rand(-sh, sh) : 0, hopY, -a.lunge + (sh ? rand(-sh, sh) : 0));
    var hold = a.act && a.act.name === 'drillAttack' ? clamp(a.hatF, 0, 1) : 0;
    try {
      a.model.update(dt, { move: clamp(a.moveV, -1, 1), turn: a.turnV, spin: a.spin, squash: clamp(a.squash, 0, 1), flip: clamp(a.flip, 0, 1), hatForward: clamp(a.hatF, 0, 1), drillHold: hold });
    } catch (e) { if (!a._warned) { a._warned = true; console.warn('SeekerModel.update failed', e); } }
  }

  /* ===== W08. 状態とイベント ===== */
  var S = {
    inited: false, container: null, renderer: null, scene: null, camera: null, ro: null, onWinResize: null,
    raf: 0, running: false, paused: false, frozen: false, last: 0, time: 0,
    map: null, w: 0, h: 0, heights: null, colors: null, dug: null, gemAt: null,
    level: null, // 地図ごとに作った物
    myIndex: 0, players: [], net: false, isHost: true, mode: 'solo', search: 'light', speed: 'normal', speedMul: SPEED_MUL.normal, overTi: -1,
    me: null, cpu: null, remotes: {}, held: {}, tapQ: {},
    camMode: 1, camBlendT: 1, camFrom: null, chaseLift: 0, camY: 0, intro: null, topFlag: null,
    shake: 0, stateAcc: 0, over: false, treasures: [], scores: [0, 0],
    fx: null, mapVer: 0, pitch: 0, pitchV: 0, aim: null, swipeV: 0,
    sideK: 1, orbitK: 0, idleT: 0, faceHold: 0, atkK: 0, atkHold: 0, hints: null, moved: false, gemCam: null, gemCamK: 0,
    ono: { drill: 0, bump: 0, brk: 0 } // 擬音の間隔（自分だけ）
  };
  var handlers = { found: [], collect: [], terrain: [], state: [], action: [], cam: [], done: [], gemHit: [], onomato: [], overGem: [] };
  // 1コマの計算（update）の途中で出たイベントは、そのコマの計算が終わってから知らせる。
  // （第3期 r1：宝を拾った瞬間に UI が World.stop() を呼ぶと、同じコマの続きの計算が消えた演出（S.fx=null）を読んで
  //   'World loop error … reading parts' が出ていた。計算を終えてから知らせれば、途中で止められることがない）
  var evQ = null;
  function emit(ev) {
    var list = handlers[ev]; if (!list) return;
    var args = Array.prototype.slice.call(arguments, 1);
    if (evQ) { evQ.push([ev, args]); return; }
    list.slice().forEach(function (fn) { try { fn.apply(null, args); } catch (e) { console.warn('World handler error', e); } });
  }
  function flushEvents() {
    var q = evQ; evQ = null;
    if (!q) return;
    for (var k = 0; k < q.length; k++) { var e = q[k]; emit.apply(null, [e[0]].concat(e[1])); }
  }
  // 擬音（自分のシーカーだけ）。押し続ける動作は間隔をあける：drill 0.9秒、bump 0.8秒、break 0.5秒
  function onomato(a, kind) {
    if (a !== S.me) return;
    var t = S.time, o = S.ono;
    if (kind === 'drill') { if (t - o.drill < 0.9) return; o.drill = t; }
    else if (kind === 'bump') { if (t - o.bump < 0.8) return; o.bump = t; }
    else if (kind === 'break') { if (t - o.brk < 0.5) return; o.brk = t; }
    emit('onomato', kind);
  }

  /* ===== W09. 初期化 ===== */
  function init(containerEl) {
    if (!window.THREE) throw new Error('THREE is not loaded');
    if (S.inited) {
      if (containerEl && containerEl !== S.container) { S.container = containerEl; containerEl.appendChild(S.renderer.domElement); watchResize(); }
      resize();
      return;
    }
    S.container = containerEl || document.body;
    if (!T) buildSharedTextures();
    if (!G) buildGeo();
    var r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.domElement.style.display = 'block';
    r.domElement.style.width = '100%';
    r.domElement.style.height = '100%';
    r.domElement.style.touchAction = 'none';
    S.container.appendChild(r.domElement);
    S.renderer = r;

    var sc = new THREE.Scene();
    sc.background = T.sky;
    sc.fog = new THREE.Fog(HAZE, 40, 120); // 遠くだけ ほんのり かすむ（距離はカメラの高さに合わせて updateCamera で変える）
    S.scene = sc;
    S.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 400);
    S.camera.position.set(0, 10, 10);

    // 明かり：やわらかい環境光＋左上からの日ざし（色はほぼつけない：壁は墨色、床はクリーム色のまま見せる）
    sc.add(new THREE.HemisphereLight(0xffffff, 0xf2eee6, 0.88));
    var sun = new THREE.DirectionalLight(0xffffff, 0.5);
    sun.position.set(-0.55, 1, -0.4);
    sc.add(sun);
    // 宝の光
    S.gemLight = new THREE.PointLight(0xff5fc0, 0, 7, 2);
    sc.add(S.gemLight);

    S.camFrom = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
    buildFx();
    watchResize();
    resize();
    S.inited = true;
  }
  function watchResize() {
    if (S.ro) { S.ro.disconnect(); S.ro = null; }
    if (window.ResizeObserver) { S.ro = new ResizeObserver(function () { resize(); }); S.ro.observe(S.container); }
    if (!S.onWinResize) { S.onWinResize = function () { resize(); }; window.addEventListener('resize', S.onWinResize); }
  }
  function resize() {
    if (!S.renderer) return;
    var el = S.container;
    var w = Math.max(1, el.clientWidth || window.innerWidth), h = Math.max(1, el.clientHeight || window.innerHeight);
    S.renderer.setSize(w, h, false);
    // 入れもの（#worldbox）が 16:9 でないとき（4:3 の iPad で画面全体に広げた場合など）は、
    // 真ん中の 16:9（ステージ）の見え方は そのままに、上下（左右）へ 3D の絵を広げる（帯を出さない）。
    // カメラの構図（俯瞰の地図の置き場所・獲得のカメラ）は いつもステージ（16:9）を基準に考える。
    var asp = w / h, cam = S.camera;
    if (Math.abs(asp - STAGE_ASPECT) < 0.01) { cam.clearViewOffset(); cam.aspect = asp; }
    else if (asp < STAGE_ASPECT) { var hs = w / STAGE_ASPECT; cam.aspect = STAGE_ASPECT; cam.setViewOffset(w, hs, 0, (hs - h) / 2, w, h); }
    else { var ws = h * STAGE_ASPECT; cam.aspect = STAGE_ASPECT; cam.setViewOffset(ws, h, (ws - w) / 2, 0, w, h); }
    cam.updateProjectionMatrix();
  }
  var STAGE_ASPECT = 16 / 9;

  /* ===== W10. 演出の部品（かけら・土ぼこり・きらきら・文字） ===== */
  function buildFx() {
    var fx = {};
    var dg = new THREE.BoxGeometry(1, 1, 1);
    var dm = new THREE.MeshLambertMaterial();
    fx.debris = new THREE.InstancedMesh(dg, dm, DEBRIS_MAX);
    fx.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    fx.debris.frustumCulled = false;
    var zero = new THREE.Matrix4().makeScale(0, 0, 0), white = new THREE.Color(1, 1, 1);
    for (var i = 0; i < DEBRIS_MAX; i++) { fx.debris.setMatrixAt(i, zero); fx.debris.setColorAt(i, white); }
    fx.debris.count = 0;
    S.scene.add(fx.debris);
    fx.parts = [];
    fx.free = []; for (i = DEBRIS_MAX - 1; i >= 0; i--) fx.free.push(i);
    fx.puffs = [];
    for (i = 0; i < PUFF_MAX; i++) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.puff, color: 0xffffff, transparent: true, depthWrite: false, opacity: 0 }));
      sp.visible = false; S.scene.add(sp);
      fx.puffs.push({ sp: sp, life: 0, max: 1, v: new THREE.Vector3(), s0: 1, s1: 2, a0: 0.8 });
    }
    fx.puffNext = 0;
    fx.stars = [];
    for (i = 0; i < 32; i++) {
      var st = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.star, color: 0xffd23f, transparent: true, depthWrite: false }));
      st.visible = false; st.renderOrder = 18; S.scene.add(st);
      fx.stars.push({ sp: st, life: 0, max: 1, v: new THREE.Vector3(), s: 0.4 });
    }
    fx.starNext = 0;
    fx.texts = [];
    for (i = 0; i < 3; i++) {
      var tx = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture('ゴゴゴッ'), transparent: true, depthWrite: false, depthTest: false }));
      tx.visible = false; tx.renderOrder = 30; S.scene.add(tx);
      fx.texts.push({ sp: tx, life: 0, max: 1, base: new THREE.Vector3(), s: 1 });
    }
    fx.textNext = 0;
    S.fx = fx;
  }
  function resetFx() {
    var fx = S.fx; if (!fx) return;
    var zero = new THREE.Matrix4().makeScale(0, 0, 0);
    fx.parts.forEach(function (p) { fx.debris.setMatrixAt(p.i, zero); fx.free.push(p.i); });
    fx.parts.length = 0; fx.debris.count = 0; fx.debris.instanceMatrix.needsUpdate = true;
    fx.puffs.forEach(function (p) { p.life = 0; p.sp.visible = false; });
    fx.stars.forEach(function (p) { p.life = 0; p.sp.visible = false; });
    fx.texts.forEach(function (p) { p.life = 0; p.sp.visible = false; });
    S.shake = 0;
  }
  function spawnPuff(x, y, z, opt) {
    var fx = S.fx; opt = opt || {};
    var p = fx.puffs[fx.puffNext]; fx.puffNext = (fx.puffNext + 1) % fx.puffs.length;
    p.sp.position.set(x, y, z);
    p.sp.material.color.set(opt.color != null ? opt.color : 0xffffff);
    p.v.set(opt.vx || 0, opt.vy == null ? 0.4 : opt.vy, opt.vz || 0);
    p.life = p.max = opt.life || 0.8;
    p.s0 = opt.s0 || 0.3; p.s1 = opt.s1 || 0.9; p.a0 = opt.a == null ? 0.75 : opt.a;
    p.sp.scale.setScalar(p.s0); p.sp.material.opacity = p.a0; p.sp.visible = true;
  }
  var tmpV2 = new THREE.Vector2();
  var tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color(), tmpE2 = new THREE.Color();
  // 土のかけら（小さく、低く飛ぶ）
  function spawnDebris(x, y, z, color, n, power) {
    var fx = S.fx;
    for (var k = 0; k < n; k++) {
      if (!fx.free.length) break;
      var i = fx.free.pop();
      var ang = Math.random() * Math.PI * 2, sp = rand(0.8, 2.6) * power;
      var part = {
        i: i,
        p: new THREE.Vector3(x + rand(-0.35, 0.35), y + rand(0, 0.3), z + rand(-0.35, 0.35)),
        v: new THREE.Vector3(Math.cos(ang) * sp, rand(2.5, 5.5) * power, Math.sin(ang) * sp),
        r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        av: new THREE.Vector3(rand(-10, 10), rand(-10, 10), rand(-10, 10)),
        s: rand(0.07, 0.18), life: rand(1.0, 1.8), max: 0, rest: false
      };
      part.max = part.life;
      tmpC.copy(color);
      if (tmpC.r + tmpC.g + tmpC.b < 0.4) tmpC.lerp(tmpE2.set(0.3, 0.29, 0.3), 0.55); // 黒い壁のかけらも紙の上で見える濃い灰色に
      tmpC.offsetHSL(0, 0, rand(-0.07, 0.07));
      fx.debris.setColorAt(i, tmpC);
      fx.parts.push(part);
    }
    if (fx.debris.instanceColor) fx.debris.instanceColor.needsUpdate = true;
    fx.debris.count = DEBRIS_MAX;
  }
  function spawnStars(x, y, z, n, colors) {
    var fx = S.fx;
    for (var k = 0; k < n; k++) {
      var p = fx.stars[fx.starNext]; fx.starNext = (fx.starNext + 1) % fx.stars.length;
      var a = Math.random() * Math.PI * 2, sp = rand(1.2, 3);
      p.sp.position.set(x, y + 0.3, z); p.v.set(Math.cos(a) * sp, rand(2.5, 5.5), Math.sin(a) * sp);
      p.life = p.max = rand(0.7, 1.1); p.s = rand(0.25, 0.5);
      p.sp.material.color.set(colors ? colors[k % colors.length] : (Math.random() < 0.3 ? 0xffffff : 0xffd23f));
      p.sp.visible = true;
    }
  }
  function popText(word, x, y, z, scale) {
    var fx = S.fx; if (!fx) return;
    var p = fx.texts[fx.textNext]; fx.textNext = (fx.textNext + 1) % fx.texts.length;
    p.sp.material.map = textTexture(word); p.sp.material.needsUpdate = true;
    p.sp.material.rotation = rand(-0.12, 0.12);
    p.base.set(x, y, z); p.life = p.max = 0.9; p.s = scale || 1.3; p.sp.visible = true;
  }
  // 掘ったときの演出：土ぼこり・土のかけら・きらきら
  function digFx(x, z, topY, color, big) {
    var c = tmpE2.copy(color);
    spawnDebris(x, topY, z, c, big ? 22 : 12, big ? 0.9 : 0.7);
    var dust = new THREE.Color(c).lerp(new THREE.Color(0xf3e6cf), 0.45).getHex();
    for (var p = 0; p < (big ? 6 : 4); p++) {
      spawnPuff(x + rand(-0.4, 0.4), topY + rand(0.05, 0.3), z + rand(-0.4, 0.4), { color: dust, vx: rand(-1.2, 1.2), vy: rand(0.6, 1.6), vz: rand(-1.2, 1.2), s0: 0.4, s1: 1.5, life: 1.0, a: 0.8 });
    }
    spawnStars(x, topY, z, big ? 6 : 4);
  }

  function updateFx(dt) {
    var fx = S.fx, i;
    if (!fx) return;
    if (fx.parts.length) {
      for (i = fx.parts.length - 1; i >= 0; i--) {
        var p = fx.parts[i];
        p.life -= dt;
        if (p.life <= 0) { fx.debris.setMatrixAt(p.i, tmpM.makeScale(0, 0, 0)); fx.free.push(p.i); fx.parts.splice(i, 1); continue; }
        if (!p.rest) {
          p.v.y -= 20 * dt;
          p.p.addScaledVector(p.v, dt);
          p.r.addScaledVector(p.av, dt);
          var gy = groundTopAt(p.p.x, p.p.z) + p.s * 0.5;
          if (p.p.y < gy) {
            p.p.y = gy;
            if (p.v.y < -2) { p.v.y *= -0.35; p.v.x *= 0.6; p.v.z *= 0.6; p.av.multiplyScalar(0.5); }
            else { p.v.set(0, 0, 0); p.rest = true; }
          }
        }
        var sc = p.s * Math.min(1, p.life / 0.4);
        tmpQ.setFromEuler(tmpE.set(p.r.x, p.r.y, p.r.z));
        tmpM.compose(p.p, tmpQ, tmpS.set(sc, sc, sc));
        fx.debris.setMatrixAt(p.i, tmpM);
      }
      fx.debris.instanceMatrix.needsUpdate = true;
      if (!fx.parts.length) fx.debris.count = 0;
    }
    for (i = 0; i < fx.puffs.length; i++) {
      var q = fx.puffs[i]; if (q.life <= 0) continue;
      q.life -= dt;
      if (q.life <= 0) { q.sp.visible = false; continue; }
      var t = 1 - q.life / q.max;
      q.sp.position.addScaledVector(q.v, dt); q.v.multiplyScalar(Math.exp(-dt * 2.5));
      q.sp.scale.setScalar(q.s0 + (q.s1 - q.s0) * (1 - Math.pow(1 - t, 2)));
      q.sp.material.opacity = q.a0 * (1 - t);
    }
    for (i = 0; i < fx.stars.length; i++) {
      var sr = fx.stars[i]; if (sr.life <= 0) continue;
      sr.life -= dt;
      if (sr.life <= 0) { sr.sp.visible = false; continue; }
      sr.v.y -= 9 * dt; sr.sp.position.addScaledVector(sr.v, dt);
      var sk = sr.s * (0.6 + 0.4 * Math.abs(Math.sin(sr.life * 14)));
      sr.sp.scale.set(sk, sk, 1); sr.sp.material.opacity = Math.min(1, sr.life / sr.max * 2);
      sr.sp.material.rotation += dt * 5;
    }
    for (i = 0; i < fx.texts.length; i++) {
      var tx = fx.texts[i]; if (tx.life <= 0) continue;
      tx.life -= dt;
      if (tx.life <= 0) { tx.sp.visible = false; continue; }
      var u = 1 - tx.life / tx.max, pop = u < 0.15 ? easeOutBack(u / 0.15) : 1;
      var s = tx.s * pop;
      tx.sp.scale.set(s * 2.6, s, 1);
      tx.sp.position.set(tx.base.x + Math.sin(u * 60) * 0.03, tx.base.y + u * 0.5, tx.base.z);
      tx.sp.material.opacity = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
    }
  }

  /* ===== W11. 地図（マスの道具・片づけ） ===== */
  function idx(x, z) { return z * S.w + x; }
  function inMap(x, z) { return x >= 0 && z >= 0 && x < S.w && z < S.h; }
  function hAt(x, z) { return inMap(x, z) ? S.heights[idx(x, z)] : 0; }
  function groundTopAt(wx, wz) { var x = Math.floor(wx), z = Math.floor(wz); return inMap(x, z) ? vis(S.heights[idx(x, z)]) : 0; }
  function cellColor(i, out) { return out.setRGB(S.colors[i * 3] / 255, S.colors[i * 3 + 1] / 255, S.colors[i * 3 + 2] / 255); }
  // 足元：当たりの四角が乗っているマスのうち、いちばん高い段
  var footRes = { lv: 0, y: 0 };
  function footInfo(wx, wz) {
    var x0 = Math.floor(wx - RAD), x1 = Math.floor(wx + RAD - 1e-6), z0 = Math.floor(wz - RAD), z1 = Math.floor(wz + RAD - 1e-6), m = 0;
    for (var z = z0; z <= z1; z++) for (var x = x0; x <= x1; x++) { if (inMap(x, z)) { var h = S.heights[z * S.w + x]; if (h > m) m = h; } }
    footRes.lv = m; footRes.y = vis(m);
    return footRes;
  }

  function clearLevel() {
    resetFx();
    var L = S.level; if (!L) return;
    L.objects.forEach(function (o) { if (o.parent) o.parent.remove(o); });
    L.dispose.forEach(function (d) { try { d.dispose(); } catch (e) { } });
    if (S.me) disposeActor(S.me);
    if (S.cpu) disposeActor(S.cpu);
    for (var k in S.remotes) disposeActor(S.remotes[k]);
    S.level = null; S.me = null; S.cpu = null; S.remotes = {}; S.map = null; S.treasures = []; S.aim = null; S.hints = null;
    S.gemCam = null; S.gemCamK = 0;
    if (S.gemLight) S.gemLight.intensity = 0;
  }

  /* ===== W12. 読み込み ===== */
  function load(map, opts) {
    if (!S.inited) { if (S.container) init(S.container); else throw new Error('World.init を先に呼んでください'); }
    clearLevel();
    opts = opts || {};
    S.map = map; S.w = map.w; S.h = map.h;
    var N = S.w * S.h;
    S.heights = new Uint8Array(map.heights); // 自分用の写し（掘ると書きかえる）
    S.colors = new Uint8Array(map.colors);
    S.dug = new Uint8Array(N);
    S.gemAt = new Int16Array(N).fill(-1);
    var list = (map.treasures && map.treasures.length) ? map.treasures : (map.treasure ? [map.treasure] : []);
    list = list.filter(function (t) { return t && inMap(t.x | 0, t.z | 0); });
    // 宝石はブロック（高さ2以上）の中。古い形の地図で低いマスに宝があるときは、そのマスを高さ2のブロックにする
    // （どの端末でも同じ処理なので、通信しても地形はずれない）
    list.forEach(function (t) { var i = idx(t.x | 0, t.z | 0); if (S.heights[i] < 2) S.heights[i] = 2; });
    S.myIndex = opts.myIndex || 0;
    S.players = opts.players || [{ palette: 0 }, { palette: 1 }];
    S.net = !!opts.net;
    S.isHost = opts.isHost == null ? true : !!opts.isHost;
    S.search = opts.search === 'sonar' ? 'sonar' : 'light';
    S.speed = SPEED_MUL.hasOwnProperty(opts.speed) ? opts.speed : 'normal'; // 第5期：'slow'|'normal'|'fast'（無いときは normal）
    S.speedMul = SPEED_MUL[S.speed];
    S.overTi = -1; // 4d：いま真上に立っている（まだだれの物でもない）宝石の番号
    var cpuOpt = opts.cpu && !S.net ? opts.cpu : null;
    S.mode = (opts.mode === 'race' || opts.mode === 'count' || opts.mode === 'solo') ? opts.mode : (list.length > 1 ? 'count' : (cpuOpt || S.net ? 'race' : 'solo'));
    S.over = false; S.held = {}; S.tapQ = {}; S.stateAcc = 0; S.shake = 0; S.mapVer = 0; S.scores = [0, 0];
    S.pitch = 0; S.pitchV = 0; S.ono = { drill: -9, bump: -9, brk: -9 };
    S.frozen = true; // 読み込んだ直後は止まった状態。UI が World.go() を呼ぶまで動かない（カウントダウン）
    var L = S.level = { objects: [], dispose: [] };
    function add(o) { S.scene.add(o); L.objects.push(o); return o; }

    buildTerrain(L, add);
    buildFloor(L, add);
    buildTreasures(L, add, list);

    var st = (map.starts && map.starts[S.myIndex]) || { x: 1, z: 1, dir: 0 };
    S.me = makeActor(S.myIndex, colorOf(S.myIndex), st, paletteOf(S.myIndex));
    add(S.me.root);
    // 'light'（光の柱が見える）で宝1つのモードでは、出発のとき宝の方を向く（光の柱が正面に見える）。
    // 'sonar' では向けない（向きで場所が分かってしまうため）
    if (S.search === 'light' && S.mode !== 'count' && S.treasures.length) {
      var t0 = S.treasures[0], tdx = t0.x + 0.5 - S.me.wx, tdz = t0.z + 0.5 - S.me.wz;
      if (Math.hypot(tdx, tdz) > 1) { S.me.heading = Math.atan2(-tdx, -tdz); S.me.accHeading = S.me.heading; }
    }
    buildAim(L, add, S.me.color);
    if (cpuOpt) {
      var ci = S.myIndex === 1 ? 0 : 1;
      var cs = (map.starts && map.starts[ci]) || { x: Math.min(S.w - 1, st.x + 2), z: st.z, dir: st.dir || 0 };
      S.cpu = makeActor(ci, colorOf(ci), cs, paletteOf(ci));
      add(S.cpu.root);
      initCpu(S.cpu, cpuOpt.level);
    }
    if (S.net) {
      for (var p = 0; p < S.players.length; p++) {
        if (p === S.myIndex) continue;
        var s2 = (map.starts && map.starts[p]) || st;
        ensureRemote(p, { x: s2.x, z: s2.z, y: vis(hAt(s2.x, s2.z)), heading: dirToHeading(s2.dir || 0), color: colorOf(p), palette: paletteOf(p), anim: 'idle' }, true);
      }
    }
    S.camBlendT = 1; S.chaseLift = 0; S.camY = S.me.y;
    S.sideK = 1; S.orbitK = 0; S.idleT = 0; S.faceHold = 0; S.atkK = 0; S.atkHold = 0; S.moved = false; S.gemCam = null; S.gemCamK = 0;
    S.camera.far = overheadHeight() * 1.6 + 60; S.camera.updateProjectionMatrix();
    S.camMode = 1; S.intro = { t: 0 }; S.topFlag = null; // 開始演出：真上（そら）から → おいかけへ
    var pose = poseFor(CAM_TOP);
    S.camera.position.copy(pose.p); S.camera.quaternion.copy(pose.q);
    fitNear();
    engine('idle', 0);
    if (!S.running) render();
  }

  /* ===== W13. 積み木（色と形） ===== */
  // 積み木の色：地図の色を少し鮮やかに。明るさが低い（黒に近い）色だけ、墨色（#2b2f3a）にする。
  // 高さ10（壁）のマスは、色の平均（字のふちはカーキや灰色になる）ではなく、いつも墨色で塗る。
  // 高さは「その画素でいちばん濃い色」で決めているので、壁の縁のマスは平均色が明るく出てしまうため。
  var hsl = { h: 0, s: 0, l: 0 };
  var WALL_RGB = [0.169, 0.184, 0.227]; // 墨色 #2b2f3a。上の面はシェーダーで少し明るく、側面は少し暗く（真っ黒にはしない）
  // 第2期：高さ9以下でも、高い（8以上）か暗い色のマスは黒系に。くすんだ色（カーキ・灰色）は高さに応じて黒へ寄せ、
  // 「壁と同じくらい高いカーキ色の積み木」を残さない（高さは画素のいちばん濃い色で決まるので、平均色が明るく出ることがある）
  function blockColor(c, hh, i) {
    var lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    if (hh >= 8 || lum < 0.3) { c.setRGB(WALL_RGB[0], WALL_RGB[1], WALL_RGB[2]); return c; }
    var chroma = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b); // 色みの強さ（カーキ・灰色は小さい）
    c.getHSL(hsl);
    if (chroma < 0.28 && hh >= 4) {
      // くすんだ色：高さ4で半分、6以上はほぼ壁の黒
      var k = clamp((hh - 3) / 3, 0, 1) * 0.9 + 0.1;
      c.setRGB(c.r + (WALL_RGB[0] - c.r) * k, c.g + (WALL_RGB[1] - c.g) * k, c.b + (WALL_RGB[2] - c.b) * k);
      return c;
    }
    // くすんだ色（カーキ・灰色）は鮮やかにしない。はっきりした色の積み木だけ鮮やかに
    // ジオラマの積み木らしく、色はそのままに少しだけやわらかく（真っ黄色・真っ赤のぎらぎらをおさえる）
    var sat = hsl.s < 0.3 ? hsl.s * 0.6 : clamp(hsl.s * 1.35, 0, 0.86);
    c.setHSL(hsl.h, sat, clamp(hsl.l * 0.98, 0.3, 0.7));
    return c;
  }
  function buildTerrain(L, add) {
    var w = S.w, h = S.h, n = 0, i;
    for (i = 0; i < w * h; i++) if (S.heights[i] > 1) n++; // 高さ0・1は床の色（床に塗る）
    var geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    // 側面を少し暗く（上の面=明るい、側面=やや暗い、底=暗い）
    var pos = geo.attributes.position, nor = geo.attributes.normal, cols = new Float32Array(pos.count * 3);
    for (i = 0; i < pos.count; i++) {
      var ny = nor.getY(i), nx = nor.getX(i), v;
      if (ny > 0.5) v = 1; else if (ny < -0.5) v = 0.5; else v = nx !== 0 ? SIDE_X : SIDE_Z; // 側面はやわらかく暗く（立体の形と上面が読みとれるように）
      cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    // 出っぱったふち（となりが低い辺）の印：ふちにだけ柔らかいハイライトを入れる
    var edgeArr = new Float32Array(Math.max(1, n));
    var edgeAttr = new THREE.InstancedBufferAttribute(edgeArr, 1);
    edgeAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aEdge', edgeAttr);
    var fadeAttr = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n)), 1);
    fadeAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFade', fadeAttr);
    var mat = blockShade(new THREE.MeshLambertMaterial({ vertexColors: true }));
    var mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    var cellToInst = new Int32Array(w * h).fill(-1);
    var m = new THREE.Matrix4(), c = new THREE.Color(), k = 0;
    for (var z = 0; z < h; z++) for (var x = 0; x < w; x++) {
      i = z * w + x; var hh = S.heights[i];
      if (hh <= 1) continue;
      m.makeScale(1, vis(hh), 1); m.setPosition(x + 0.5, 0, z + 0.5);
      mesh.setMatrixAt(k, m);
      cellColor(i, c);
      // 積み木は側面も含めて地図の色で塗る。壁（高さ10）と黒に近い色だけ墨色にする
      blockColor(c, hh, i);
      mesh.setColorAt(k, c);
      edgeArr[k] = edgeMask(x, z);
      cellToInst[i] = k++;
    }
    if (n === 0) { mesh.setMatrixAt(0, m.makeScale(0, 0, 0)); mesh.setColorAt(0, c.set(1, 1, 1)); }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    add(mesh);
    // 透かす積み木（同じ形・同じ置き場所・同じ色を使う。透明なものの中で、宝石の光やきらきらのあとに描く）
    var gDepth = blockShade(new THREE.MeshLambertMaterial({ vertexColors: true, colorWrite: false, transparent: true }), 'ghost');
    var gColor = blockShade(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false }), 'ghost');
    L.ghosts = [gDepth, gColor].map(function (gm, j) {
      var gh = new THREE.InstancedMesh(geo, gm, Math.max(1, n));
      gh.instanceMatrix = mesh.instanceMatrix; gh.instanceColor = mesh.instanceColor;
      gh.frustumCulled = false; gh.renderOrder = 25 + j; gh.visible = false; // 透かす積み木があるときだけ描く
      return add(gh);
    });
    L.terrain = mesh; L.cellToInst = cellToInst; L.edgeAttr = edgeAttr; L.fadeAttr = fadeAttr; L.fading = {};
    L.dispose.push(geo, mat, gDepth, gColor);
  }
  // となりが低い（または地図の外）辺：1=北(z-1) 2=東(x+1) 4=南(z+1) 8=西(x-1)
  function edgeMask(x, z) {
    var hh = S.heights[idx(x, z)], m = 0;
    for (var d = 0; d < 4; d++) {
      var nx = x + DX[d], nz = z + DZ[d];
      if (!inMap(nx, nz) || S.heights[idx(nx, nz)] < hh) m |= 1 << d;
    }
    return m;
  }

  /* ===== W14. 床（クリーム色のタイル）と地図の島 ===== */
  // 床：地図の色から作った CanvasTexture（白＝クリームホワイト、マスの継ぎ目のごく淡い線、積み木のやわらかい影とすみの影）。
  // 地図全体は、メニュー画面の浮かぶ島と同じ「土の色の側面をもつ板」に乗せ、外側は空とかすみ（机や紙はやめた）。
  var FLOOR_LIT = 0xc6c6c6; // 床の明かり（環境光0.88＋日ざし約0.41＝1.29）を打ち消して、塗った色がそのまま見えるように
  function buildFloor(L, add) {
    var w = S.w, h = S.h;
    var px = clamp(Math.floor(1024 / Math.max(w, h)), 4, 16);
    var small = makeCanvas(w, h), big = makeCanvas(w * px, h * px);
    L.floorSmall = small; L.floorBig = big; L.floorPx = px;
    L.floorGrid = buildGridLayer(w, h, px);
    var tex = new THREE.CanvasTexture(big);
    tex.anisotropy = 4;
    L.floorTex = tex;
    paintFloor();
    var fg = new THREE.PlaneGeometry(w, h); fg.rotateX(-Math.PI / 2);
    var fm = new THREE.MeshLambertMaterial({ map: tex, color: FLOOR_LIT });
    var floor = new THREE.Mesh(fg, fm); floor.position.set(w / 2, 0, h / 2);
    add(floor);
    // 地図の島：床のすぐ下に、土の色の厚い板（上のふちに細いクリーム色の帯）。側面は日ざしで面ごとに明るさが変わる
    var TH = 1.4;
    var ig = new THREE.BoxGeometry(w + 0.06, TH, h + 0.06); ig.translate(0, -TH / 2 - 0.004, 0);
    var ipos = ig.attributes.position, icol = new Float32Array(ipos.count * 3), side = new THREE.Color(ISLAND_SIDE), lip = new THREE.Color(0xfff3dc);
    for (var i = 0; i < ipos.count; i++) {
      var yy = ipos.getY(i), k = yy > -0.05 ? 1 : 0, cc = k ? lip : side;
      var dk = yy < -TH + 0.01 ? 0.86 : 1; // 下のほうを少し暗く
      icol[i * 3] = cc.r * dk; icol[i * 3 + 1] = cc.g * dk; icol[i * 3 + 2] = cc.b * dk;
    }
    ig.setAttribute('color', new THREE.BufferAttribute(icol, 3));
    var im = new THREE.MeshLambertMaterial({ vertexColors: true });
    var island = new THREE.Mesh(ig, im); island.position.set(w / 2, 0, h / 2); add(island);
    // 島の下のやわらかい影（空に浮かんでいるように。メニューの島の下の影と同じ）
    var sg = new THREE.PlaneGeometry(1, 1); sg.rotateX(-Math.PI / 2);
    var sm = new THREE.MeshBasicMaterial({ map: T.softRect, color: 0x5d7f9a, transparent: true, opacity: 0.42, depthWrite: false });
    var ish = new THREE.Mesh(sg, sm); ish.scale.set((w + 2) * 1.46, 1, (h + 2) * 1.46); ish.position.set(w / 2 + 1.2, -TH - 3, h / 2 + 1.6); add(ish);
    L.dispose.push(tex, fg, fm, ig, im, sg, sm);
  }

  // マスの境目の、ごく淡いまっすぐな継ぎ目（タイルの目地）。地図ごとに1回だけ作る
  function buildGridLayer(w, h, px) {
    var c = makeCanvas(w * px, h * px), g = c.getContext('2d');
    g.fillStyle = 'rgba(150,128,96,0.075)';
    var lw = Math.max(1, Math.round(px * 0.07));
    for (var x = 1; x < w; x++) g.fillRect(x * px - lw / 2, 0, lw, h * px);
    for (var z = 1; z < h; z++) g.fillRect(0, z * px - lw / 2, w * px, lw);
    // タイルの左上にごく淡い明るい縁（ほんの少しだけ盛り上がって見える）
    g.fillStyle = 'rgba(255,255,255,0.18)';
    for (x = 0; x < w; x++) g.fillRect(x * px + lw, 0, lw, h * px);
    for (z = 0; z < h; z++) g.fillRect(0, z * px + lw, w * px, lw);
    return c;
  }

  // dirty（任意）：[x0,z0, x1,z1, ...] 壊れたマス。そのまわりだけ描き直す
  function paintFloor(dirty) {
    var L = S.level, w = S.w, h = S.h, px = L.floorPx;
    var sctx = L.floorSmall.getContext('2d');
    var img = sctx.createImageData(w, h), d = img.data;
    for (var z = 0; z < h; z++) for (var x = 0; x < w; x++) {
      var i = z * w + x, hh = S.heights[i], r, g, b;
      if (hh <= 1 && S.dug[i]) { r = 240; g = 226; b = 200; } // 壊したあと：少し濃いクリーム（砂の色）
      else if (hh > 1) { r = 150; g = 152; b = 164; } // 積み木の下：となりの床へ、足元のやわらかいかげとしてにじむ
      else {
        r = S.colors[i * 3]; g = S.colors[i * 3 + 1]; b = S.colors[i * 3 + 2];
        // 塗った色をはっきり見せる（白はクリームホワイト。色のついたところだけ少し濃く）
        var lum = 0.299 * r + 0.587 * g + 0.114 * b, sat = FLOOR_SAT;
        r = clamp(lum + (r - lum) * sat, 0, 255) * CREAM[0]; g = clamp(lum + (g - lum) * sat, 0, 255) * CREAM[1]; b = clamp(lum + (b - lum) * sat, 0, 255) * CREAM[2];
      }
      // 柔らかい影：左上（北西）の高い物が、右下へ影を落とす
      var sh = 1;
      for (var k = 1; k <= 4; k++) {
        var hx = vis(hAt(x - k, z - k)) - vis(hh);
        if (hx > k * 0.35) { sh = Math.min(sh, 0.8 + k * 0.035); break; }
      }
      // まわりが高いとほんのり暗く（すみっこの影）
      var ao = 0;
      if (hAt(x - 1, z) > hh) ao++; if (hAt(x + 1, z) > hh) ao++; if (hAt(x, z - 1) > hh) ao++; if (hAt(x, z + 1) > hh) ao++;
      sh *= 1 - ao * 0.04;
      // 影は少しだけ青みに（澄んだ空気の、空の色が映った影）
      d[i * 4] = r * sh; d[i * 4 + 1] = g * (sh + (1 - sh) * 0.12); d[i * 4 + 2] = b * (sh + (1 - sh) * 0.35); d[i * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    var big = L.floorBig, g2 = big.getContext('2d');
    // 描き直す範囲（マス）
    var x0 = 0, z0 = 0, x1 = w - 1, z1 = h - 1;
    if (dirty && dirty.length) {
      x0 = w; z0 = h; x1 = 0; z1 = 0;
      for (var q = 0; q < dirty.length; q += 2) { x0 = Math.min(x0, dirty[q]); x1 = Math.max(x1, dirty[q]); z0 = Math.min(z0, dirty[q + 1]); z1 = Math.max(z1, dirty[q + 1]); }
      x0 = Math.max(0, x0 - 2); z0 = Math.max(0, z0 - 2); x1 = Math.min(w - 1, x1 + 5); z1 = Math.min(h - 1, z1 + 5); // 影は右下へ4マスまで
    }
    g2.save();
    g2.beginPath(); g2.rect(x0 * px, z0 * px, (x1 - x0 + 1) * px, (z1 - z0 + 1) * px); g2.clip();
    g2.globalCompositeOperation = 'source-over';
    g2.globalAlpha = 1;
    g2.imageSmoothingEnabled = true;
    g2.drawImage(L.floorSmall, 0, 0, big.width, big.height);
    g2.drawImage(L.floorGrid, 0, 0);
    g2.restore();
    L.floorTex.needsUpdate = true;
  }

  /* ===== W15. 宝石（ブロックの中・光の柱・獲得の演出） ===== */
  // 宝石はブロック（高さ2以上のマス）の中に隠れていて見えない。'light' のときだけ光の柱と目じるしが出る（'sonar' はソナーだけ）。
  // 宝石のマスを壊したシーカーについて 'gemHit' を出す。所有者は UI が award() で決める（World は自分では決めない）。
  // award されると、宝石がマスから浮き上がり、回りながら宝石の色でやわらかく光り（点滅しない）、そのあと持ち主へ吸い込まれる。
  function gemGeometry(id) {
    var geo;
    if (id === 'emerald') { geo = new THREE.CylinderGeometry(0.3, 0.42, 0.62, 8); geo.rotateX(Math.PI / 2); geo.scale(1, 1.25, 0.75); } // エメラルドカット（八角の段）
    else if (id === 'opal') { geo = new THREE.SphereGeometry(0.5, 20, 12); geo.scale(1, 0.62, 0.82); }
    else {
      // ブリリアントカット（上が平ら、下がとがる）。面ごとに光るよう flatShading
      var pts = [new THREE.Vector2(0.001, -0.62), new THREE.Vector2(0.5, 0.0), new THREE.Vector2(0.5, 0.08), new THREE.Vector2(0.3, 0.3), new THREE.Vector2(0.001, 0.3)];
      geo = new THREE.LatheGeometry(pts, id === 'diamond' ? 10 : 8);
    }
    geo.scale(GEM_R * 2, GEM_R * 2, GEM_R * 2);
    return geo;
  }
  function gemMaterial(def) {
    var id = def.id;
    var o = { color: new THREE.Color(def.color), emissive: new THREE.Color(def.glow), emissiveIntensity: 0.35, roughness: 0.18, metalness: 0.15, flatShading: id !== 'opal' };
    if (id === 'diamond') { o.transparent = true; o.opacity = 0.88; o.emissiveIntensity = 0.45; o.metalness = 0.3; o.roughness = 0.05; }
    if (id === 'opal') { o.roughness = 0.35; o.metalness = 0; o.emissiveIntensity = 0.3; }
    return new THREE.MeshStandardMaterial(o);
  }
  function buildTreasures(L, add, list) {
    if (!list.length) return;
    var bh = 40;
    var beamGeo = new THREE.CylinderGeometry(0.42, 0.42, bh, 20, 1, true); beamGeo.translate(0, bh / 2, 0);
    var beam2Geo = new THREE.CylinderGeometry(0.16, 0.16, bh, 12, 1, true); beam2Geo.translate(0, bh / 2, 0);
    var beamMat = new THREE.MeshBasicMaterial({ map: T.beam, color: 0xffe9a0, opacity: 0.3, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    var beam2Mat = new THREE.MeshBasicMaterial({ map: T.beam, color: 0xfff6d8, opacity: 0.5, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    var geos = {};
    L.dispose.push(beamGeo, beam2Geo, beamMat, beam2Mat);
    list.forEach(function (t, ti) {
      var x = t.x | 0, z = t.z | 0;
      var gid = t.gem != null && isFinite(+t.gem) ? (+t.gem | 0) : ti % 10;
      var def = gemDef(gid);
      if (!geos[def.id]) { geos[def.id] = gemGeometry(def.id); L.dispose.push(geos[def.id]); }
      var g = new THREE.Group();
      g.position.set(x + 0.5, 0, z + 0.5);
      add(g);
      var mat = gemMaterial(def);
      var gem = new THREE.Mesh(geos[def.id], mat); gem.visible = false; g.add(gem);
      var haloMat = new THREE.SpriteMaterial({ map: T.soft, color: new THREE.Color(def.glow), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
      var halo = new THREE.Sprite(haloMat); halo.visible = false; halo.renderOrder = 19; g.add(halo);
      var beam = new THREE.Mesh(beamGeo, beamMat), beam2 = new THREE.Mesh(beam2Geo, beam2Mat);
      beam.renderOrder = 7; beam2.renderOrder = 7; g.add(beam); g.add(beam2);
      var sparkMat = new THREE.SpriteMaterial({ map: T.star, color: new THREE.Color(def.glow), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
      var sparks = [];
      for (var i = 0; i < 6; i++) { var s = new THREE.Sprite(sparkMat); s.visible = false; s.renderOrder = 20; g.add(s); sparks.push(s); }
      var far = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.hint, transparent: true, depthWrite: false, depthTest: false }));
      far.renderOrder = 9; far.visible = false; g.add(far);
      L.dispose.push(mat, haloMat, sparkMat, far.material);
      var i0 = idx(x, z);
      if (S.gemAt[i0] < 0) S.gemAt[i0] = S.treasures.length;
      S.treasures.push({ i: ti, x: x, z: z, gem: gid, def: def, group: g, mesh: gem, mat: mat, halo: halo, beam: beam, beam2: beam2, sparks: sparks, sparkMat: sparkMat, far: far,
        owner: -1, hitBy: {}, anim: null, phase: rand(0, 6) });
    });
    buildHints(L, add);
  }
  // 埋まっている宝の目じるし（'light' のときだけ）：ブロックの上で、光の粒がゆらめき、ときどき星がきらっと光って昇る。
  // 遠く（おいかけ視点で20マス以上先）からも見えるよう、画面の上で小さくなりすぎない（最小の大きさがある）。
  // 全部の宝で1つの点の集まり（THREE.Points）＝描画命令は1つだけ。
  var HINT_K = 4;              // 宝1つあたりの点：0=ゆらめく光の粒、1〜3=昇る星
  var HINT_RISE = 1.7, HINT_CYCLE = 2.4, HINT_TOP = 3.8; // 星が昇る時間・くり返し・昇る高さ
  var HINT_VERT = [
    'attribute float aSize;', 'attribute float aAlpha;', 'attribute float aMin;',
    'uniform float uScale;', 'uniform float uMinPx;',
    'varying float vAlpha;',
    'void main() {',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '  float px = aSize * uScale / max(0.1, -mv.z);',
    '  gl_PointSize = aAlpha > 0.0 ? max(px, uMinPx * aMin) : 0.0;',
    '  vAlpha = aAlpha;',
    '}'
  ].join('\n');
  var HINT_FRAG = [
    'uniform sampler2D uMap;', 'varying float vAlpha;',
    'void main() {',
    '  vec4 c = texture2D(uMap, vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y));',
    '  float a = c.a * vAlpha;',
    '  if (a < 0.03) discard;',
    '  gl_FragColor = vec4(c.rgb, a);',
    '}'
  ].join('\n');
  function buildHints(L, add) {
    var n = S.treasures.length; if (!n || S.search !== 'light') { S.hints = null; return; }
    var N = n * HINT_K, geo = new THREE.BufferGeometry();
    var pos = new THREE.BufferAttribute(new Float32Array(N * 3), 3), size = new THREE.BufferAttribute(new Float32Array(N), 1);
    var alpha = new THREE.BufferAttribute(new Float32Array(N), 1), mn = new THREE.BufferAttribute(new Float32Array(N), 1);
    [pos, size, alpha, mn].forEach(function (b) { b.setUsage(THREE.DynamicDrawUsage); });
    geo.setAttribute('position', pos); geo.setAttribute('aSize', size); geo.setAttribute('aAlpha', alpha); geo.setAttribute('aMin', mn);
    var mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: T.hint }, uScale: { value: 300 }, uMinPx: { value: 12 } },
      vertexShader: HINT_VERT, fragmentShader: HINT_FRAG, transparent: true, depthWrite: false
    });
    var pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 8;
    add(pts);
    L.dispose.push(geo, mat);
    S.hints = { pts: pts, pos: pos, size: size, alpha: alpha, mn: mn, mat: mat };
  }
  function updateHints() {
    var H = S.hints; if (!H) return;
    var cam = S.camera, vh = S.renderer ? S.renderer.getDrawingBufferSize(tmpV2).y : 600;
    H.mat.uniforms.uScale.value = vh / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
    H.mat.uniforms.uMinPx.value = Math.max(14, vh * 0.042); // 遠くても画面の高さの約4.2%より小さくしない
    var t0 = S.time, P = H.pos.array, Sz = H.size.array, A = H.alpha.array, M = H.mn.array;
    for (var k = 0; k < S.treasures.length; k++) {
      var tr = S.treasures[k], b = k * HINT_K, on = tr.owner < 0;
      var cx = tr.x + 0.5, cz = tr.z + 0.5, top = vis(S.heights[idx(tr.x, tr.z)]), ph = tr.phase;
      // 0：ゆらめく光の粒（ブロックの上、壁より少し高い所でふわふわ）
      P[b * 3] = cx + Math.sin(t0 * 1.3 + ph) * 0.08; P[b * 3 + 1] = top + 1.9 + Math.sin(t0 * 2.1 + ph) * 0.15; P[b * 3 + 2] = cz + Math.cos(t0 * 1.1 + ph) * 0.08;
      var tw = 0.5 + 0.5 * Math.sin(t0 * 4.2 + ph);
      Sz[b] = 0.6 + 0.15 * tw; A[b] = on ? 0.8 + 0.2 * tw : 0; M[b] = 0.8 + 0.2 * tw;
      // 1〜3：ときどき きらっと光って昇る星
      for (var j = 1; j < HINT_K; j++) {
        var q = b + j, u = ((t0 + ph) / HINT_CYCLE + (j - 1) / (HINT_K - 1)) % 1, tt = u * HINT_CYCLE / HINT_RISE;
        if (!on || tt >= 1) { A[q] = 0; continue; }
        var sw = Math.sin(tt * 9 + j * 2 + ph) * 0.18;
        P[q * 3] = cx + sw; P[q * 3 + 1] = top + 0.6 + HINT_TOP * (1 - Math.pow(1 - tt, 1.6)); P[q * 3 + 2] = cz + Math.cos(tt * 7 + j) * 0.18;
        var flash = tt < 0.18 ? 1 + 0.9 * Math.sin(tt / 0.18 * Math.PI) : 1; // 出た瞬間に きらっ
        Sz[q] = 0.75 * flash * (1 - 0.35 * tt);
        A[q] = tt < 0.06 ? tt / 0.06 : (tt > 0.72 ? (1 - tt) / 0.28 : 1);
        M[q] = 1.1 * flash * (1 - 0.35 * tt);
      }
    }
    H.pos.needsUpdate = true; H.size.needsUpdate = true; H.alpha.needsUpdate = true; H.mn.needsUpdate = true;
  }
  function actorOf(i) {
    if (S.me && S.me.idx === i) return S.me;
    if (S.cpu && S.cpu.idx === i) return S.cpu;
    return S.remotes[i] || null;
  }
  // 宝石の見た目：ダイヤモンドは虹色、オパールは乳白色の遊色（どちらもゆっくり色が移る。点滅しない）
  function tintGem(tr, t) {
    var id = tr.def.id;
    if (id === 'diamond') { tr.mat.emissive.setHSL((t * 0.12) % 1, 0.55, 0.62); tr.sparkMat.color.setHSL((t * 0.12 + 0.5) % 1, 0.7, 0.75); }
    else if (id === 'opal') { tr.mat.emissive.setHSL((t * 0.09) % 1, 0.45, 0.72); tr.sparkMat.color.setHSL((t * 0.09 + 0.33) % 1, 0.6, 0.8); }
  }
  function updateTreasures(dt) {
    var t0 = S.time, camH = S.camera.position.y, light = null, lightK = 0;
    for (var k = 0; k < S.treasures.length; k++) {
      var tr = S.treasures[k], t = t0 + tr.phase;
      if (tr.owner < 0) {
        // まだだれの物でもない：見えない。'light' のときだけ光の柱（ブロックの上から）と、そらからの目じるし
        var on = S.search === 'light', top = vis(S.heights[idx(tr.x, tr.z)]);
        tr.beam.visible = tr.beam2.visible = on;
        if (on) {
          tr.beam.position.y = tr.beam2.position.y = top + 0.02;
          var br = 0.85 + 0.15 * Math.sin(t * 1.6); // ゆっくり明るさが変わる（点滅しない）
          tr.beam.scale.set(br, 1, br);
        }
        tr.far.visible = on && camH > 7;
        if (tr.far.visible) { var fs = camH * 0.07 * (1 + 0.08 * Math.sin(t * 2)); tr.far.scale.set(fs, fs, 1); tr.far.position.y = top + 0.8; tr.far.material.opacity = clamp((camH - 7) / 6, 0, 1); }
        continue;
      }
      tr.beam.visible = tr.beam2.visible = false; tr.far.visible = false;
      var A = tr.anim; if (!A || A.done) { tr.mesh.visible = false; tr.halo.visible = false; tr.sparks.forEach(function (s) { s.visible = false; }); continue; }
      A.t += dt;
      var u = A.t, gy, sc, spin, haloK, lk;
      tintGem(tr, t);
      if (u < 0.8) { // 浮き上がる
        var e = 1 - Math.pow(1 - u / 0.8, 3);
        gy = A.y0 + A.rise * e; sc = 0.35 + 0.65 * e; spin = 7 - 5 * e; haloK = e; lk = e;
      } else if (u < GEM_SHOW) { // 回りながら光る（光がやわらかく広がる）
        var v = (u - 0.8) / (GEM_SHOW - 0.8);
        gy = A.y0 + A.rise + Math.sin((u - 0.8) * 2.2) * 0.08; sc = 1 + 0.08 * Math.sin((u - 0.8) * 2.6); spin = 2; haloK = 1 + v * 0.8; lk = 1;
      } else { // 持ち主へ吸い込まれる
        var f = clamp((u - GEM_SHOW) / GEM_FLY, 0, 1), fe = f * f, a = actorOf(tr.owner);
        var sx = 0, sz = 0, sy = A.y0 + A.rise;
        if (a) { sx = (a.wx - tr.group.position.x) * fe; sz = (a.wz - tr.group.position.z) * fe; sy += (a.y + 0.8 - sy) * fe; }
        tr.mesh.position.set(sx, sy + Math.sin(f * Math.PI) * 0.6, sz);
        sc = 1 - 0.85 * f; spin = 6; haloK = 1.8 * (1 - f); lk = 1 - f;
        if (f >= 1) {
          A.done = true; tr.mesh.visible = false; tr.halo.visible = false;
          tr.sparks.forEach(function (s) { s.visible = false; });
          if (a) {
            a.hop = 1.2;
            spawnStars(a.wx, a.y + 0.5, a.wz, 12, [new THREE.Color(tr.def.glow).getHex(), 0xffffff, 0xffd23f]);
            for (var pk = 0; pk < 6; pk++) { var pa = pk / 6 * Math.PI * 2; spawnPuff(a.wx + Math.cos(pa) * 0.5, a.y + 0.7, a.wz + Math.sin(pa) * 0.5, { color: 0xfff1a8, vx: Math.cos(pa) * 1.6, vy: 0.8, vz: Math.sin(pa) * 1.6, s0: 0.25, s1: 0.8, life: 0.7, a: 0.85 }); }
          }
          continue;
        }
      }
      if (u < GEM_SHOW) tr.mesh.position.set(0, gy, 0);
      tr.mesh.visible = true;
      tr.mesh.rotation.y += dt * spin;
      tr.mesh.rotation.z = Math.sin(u * 1.3) * 0.18;
      tr.mesh.scale.setScalar(sc);
      // やわらかい光の広がり（大きさがゆっくり変わるだけ。明るさを急に変えない）
      tr.halo.visible = true;
      tr.halo.position.copy(tr.mesh.position);
      var hs = 1.1 + 1.0 * haloK; tr.halo.scale.set(hs, hs, 1);
      tr.halo.material.opacity = 0.38 * clamp(lk, 0, 1);
      tr.sparkMat.opacity = 0.9 * clamp(lk, 0, 1);
      for (var i = 0; i < tr.sparks.length; i++) {
        var an = u * 1.4 + i / tr.sparks.length * Math.PI * 2, r = 0.55 + 0.25 * clamp(haloK, 0, 1.5);
        var sp = tr.sparks[i]; sp.visible = true;
        sp.position.set(tr.mesh.position.x + Math.cos(an) * r, tr.mesh.position.y + Math.sin(u * 2 + i) * 0.3, tr.mesh.position.z + Math.sin(an) * r);
        var ss = 0.18 + 0.1 * (0.5 + 0.5 * Math.sin(u * 3 + i * 1.7)); sp.scale.set(ss, ss, 1);
      }
      if (lk > lightK) { lightK = lk; light = tr; }
    }
    if (light) {
      S.gemLight.color.set(light.def.glow);
      S.gemLight.position.set(light.group.position.x + light.mesh.position.x, light.mesh.position.y + 0.3, light.group.position.z + light.mesh.position.z);
      S.gemLight.intensity = 1.4 * lightK;
    } else S.gemLight.intensity = 0;
  }
  function scoresView() { var o = S.myIndex === 0 ? 1 : 0; return [S.scores[S.myIndex] || 0, S.scores[o] || 0]; }
  // 地形が変わったマスに、まだだれの物でもない宝石があれば 'gemHit'（自分と CPU が壊したときだけ。通信相手の地形では出さない）
  function gemHitCheck(a, changed) {
    if (!a || (a !== S.me && a !== S.cpu)) return;
    for (var k = 0; k < changed.length; k++) {
      var c = changed[k], ti = S.gemAt[idx(c[0], c[1])];
      if (ti < 0) continue;
      var tr = S.treasures[ti];
      if (!tr || tr.owner >= 0 || tr.hitBy[a.idx]) continue;
      tr.hitBy[a.idx] = true;
      if (a.ai) { a.ai.hitTi = ti; a.ai.hitLog.push(Math.round(a.ai.time * 10) / 10); }
      if (handlers.gemHit.length) emit('gemHit', a.idx, ti);
      else award(a.idx, ti); // UI が gemHit を聞いていないとき（古い UI・確認用）だけ、壊した人の物にする
    }
  }
  // 所有者を決める（UI が呼ぶ）。同じ宝石への2回目以降は無視
  // ソナーの読み取り（人の左上のソナーと CPU が同じものを使う）：(wx,wz) から radius マス以内の、まだだれの物でもない宝
  //   返り値 { k: 宝の番号, t: 宝, dx, dz, dist }
  function sonarRead(wx, wz, radius) {
    var out = [];
    for (var k = 0; k < S.treasures.length; k++) {
      var t = S.treasures[k]; if (t.owner >= 0) continue; // 持ち主の決まった宝は出ない
      var dx = t.x + 0.5 - wx, dz = t.z + 0.5 - wz, d = Math.hypot(dx, dz);
      if (d <= radius) out.push({ k: k, t: t, dx: dx, dz: dz, dist: d });
    }
    return out;
  }
  function award(who, ti) {
    who = who | 0; ti = ti | 0;
    var tr = S.treasures[ti]; if (!tr || tr.owner >= 0 || !S.level) return false;
    tr.owner = who;
    tr.anim = { t: 0, y0: vis(S.heights[idx(tr.x, tr.z)]) + 0.15, rise: GEM_RISE, done: false };
    // 壊した人がすぐ下（ジャンプドリルで同じマスの穴の中など）にいるときは、頭の上にはっきり離れて見えるよう高く浮かせる
    var ha = actorOf(who);
    if (ha && Math.hypot(ha.wx - tr.x - 0.5, ha.wz - tr.z - 0.5) < 1.6) tr.anim.rise = Math.max(GEM_RISE, ha.y + GEM_OVER_HEAD - tr.anim.y0);
    S.scores[who] = (S.scores[who] || 0) + 1;
    var a = actorOf(who);
    if (a === S.me && (S.mode !== 'count' || !S.held.fwd)) S.faceHold = S.mode === 'count' ? 1.3 : 30; // 顔を見せる
    if (a === S.me) startGemCam(tr); // 浮き上がる宝石とシーカーの両方が見える位置へカメラを引く
    spawnStars(tr.x + 0.5, vis(S.heights[idx(tr.x, tr.z)]) + 0.2, tr.z + 0.5, 10, [new THREE.Color(tr.def.glow).getHex(), 0xffffff, 0xffd23f]);
    sfx('gemRise');
    emit('collect', who, ti, scoresView());
    if (S.mode !== 'count') {
      if (!S.over) { S.over = true; emit('found', who); }
    } else if (S.treasures.every(function (q) { return q.owner >= 0; })) {
      S.over = true; emit('done', scoresView());
    }
    return true;
  }

  /* ===== W16. 地形を変える（掘る・壊す） ===== */
  // list: [[x,z,h],...]。実際に変わったマスを [[x,z,h],...] で返す。高さは下げるだけを想定（上げても積み木は増えない）
  function setCells(list, withFx) {
    var L = S.level; if (!L || !list) return [];
    var done = [], m = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0), c = new THREE.Color(), dirty = [];
    for (var k = 0; k < list.length; k++) {
      var e = list[k]; if (!e) continue;
      var x = e[0] | 0, z = e[1] | 0, nh = clamp((e[2] == null ? 0 : e[2]) | 0, 0, 10);
      if (!inMap(x, z)) continue;
      var i = idx(x, z), old = S.heights[i];
      if (nh === old) continue;
      if (withFx && nh < old) {
        cellColor(i, c); blockColor(c, old, i);
        digFx(x + 0.5, vis(old), z + 0.5, c, old - nh >= 3);
      }
      S.heights[i] = nh;
      if (nh < old && nh <= 1) S.dug[i] = 1;
      var inst = L.cellToInst[i];
      if (inst >= 0) {
        if (nh > 1) { m.makeScale(1, vis(nh), 1); m.setPosition(x + 0.5, 0, z + 0.5); L.terrain.setMatrixAt(inst, m); L.edgeAttr.array[inst] = edgeMask(x, z); }
        else L.terrain.setMatrixAt(inst, zero);
      }
      for (var dd = 0; dd < 4; dd++) { // となりの積み木に、新しく出たふちのハイライトを足す
        var ex = x + DX[dd], ez = z + DZ[dd];
        if (!inMap(ex, ez)) continue;
        var ni = L.cellToInst[idx(ex, ez)];
        if (ni >= 0 && S.heights[idx(ex, ez)] > 1) L.edgeAttr.array[ni] = edgeMask(ex, ez);
      }
      dirty.push(x, z);
      done.push([x, z, nh]);
    }
    if (done.length) {
      L.terrain.instanceMatrix.needsUpdate = true; L.edgeAttr.needsUpdate = true;
      paintFloor(dirty); S.mapVer++;
    }
    return done;
  }

  /* ===== W17. ドリルアタックのねらいの印（正面のマスが足元より高いときだけ） ===== */
  function buildAim(L, add, colorStr) {
    var c = makeCanvas(128, 128), g = c.getContext('2d');
    g.lineCap = 'round'; g.lineJoin = 'round';
    function corners(lw, col) {
      g.strokeStyle = col; g.lineWidth = lw;
      [[14, 14, 1, 1], [114, 14, -1, 1], [14, 114, 1, -1], [114, 114, -1, -1]].forEach(function (q) {
        g.beginPath(); g.moveTo(q[0], q[1] + q[3] * 30); g.lineTo(q[0], q[1]); g.lineTo(q[0] + q[2] * 30, q[1]); g.stroke();
      });
    }
    corners(18, 'rgba(255,255,255,0.95)'); corners(9, '#ffffff');
    var tex = new THREE.CanvasTexture(c);
    var geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    var mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(colorStr || '#e08524'), transparent: true, depthWrite: false, opacity: 0.9 });
    var mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 3; mesh.visible = false;
    add(mesh);
    L.dispose.push(tex, geo, mat);
    S.aim = { mesh: mesh, mat: mat };
  }
  function frontCell(a) { var d = dir4(a.heading); return { x: Math.floor(a.wx) + DX[d], z: Math.floor(a.wz) + DZ[d], d: d }; }
  function updateAim() {
    var A = S.aim, me = S.me; if (!A || !me) return;
    var f = frontCell(me);
    var show = S.camMode !== CAM_TOP && !S.intro && !S.over && !me.air && inMap(f.x, f.z) && S.heights[idx(f.x, f.z)] > me.lv + 1;
    A.mesh.visible = show;
    if (!show) return;
    var pulse = 1 + Math.sin(S.time * 6) * 0.05;
    A.mesh.position.set(f.x + 0.5, vis(S.heights[idx(f.x, f.z)]) + 0.03, f.z + 0.5);
    A.mesh.scale.set(0.96 * pulse, 1, 0.96 * pulse);
  }

  /* ===== W18. シーカーの動き（自分もCPUも同じ規則） ===== */
  // 入れるか：地上では「足元+1段」まで、空中では足の高さより低い所だけ。地図のふちは壁
  function canOccupy(a, wx, wz) {
    if (wx - RAD < 0 || wz - RAD < 0 || wx + RAD > S.w || wz + RAD > S.h) return false;
    var x0 = Math.floor(wx - RAD), x1 = Math.floor(wx + RAD - 1e-6), z0 = Math.floor(wz - RAD), z1 = Math.floor(wz + RAD - 1e-6);
    for (var z = z0; z <= z1; z++) for (var x = x0; x <= x1; x++) {
      var h = S.heights[z * S.w + x];
      if (a.air) { if (vis(h) > a.y + 0.03) return false; }
      else if (h > a.lv + 1) return false;
    }
    return true;
  }
  // 前へ d マス進む（壁にはすべって当たる）。実際に前へ進んだ量を返す。ぶつかったら a._blocked = true
  // quiet：ドリルで掘りながら進むとき（ぶつかる音・擬音を出さない）
  function moveActor(a, d, quiet) {
    var fx = -Math.sin(a.heading), fz = -Math.cos(a.heading);
    var n = Math.max(1, Math.ceil(Math.abs(d) / 0.12)), sx = fx * d / n, sz = fz * d / n, ox = a.wx, oz = a.wz, blocked = false;
    for (var k = 0; k < n; k++) {
      if (canOccupy(a, a.wx + sx, a.wz)) a.wx += sx; else if (Math.abs(sx) > Math.abs(d / n) * 0.35) blocked = true;
      if (canOccupy(a, a.wx, a.wz + sz)) a.wz += sz; else if (Math.abs(sz) > Math.abs(d / n) * 0.35) blocked = true;
    }
    a._blocked = blocked;
    if (blocked && !quiet && a.bumpCd <= 0 && !a.air) {
      a.bumpCd = 0.8; a.shakeV = 0.02;
      if (a === S.me) { sfx('bump'); onomato(a, 'bump'); }
    }
    return (a.wx - ox) * fx + (a.wz - oz) * fz;
  }
  function stepVertical(a, dt) {
    var f = footInfo(a.wx, a.wz);
    if (a.air) {
      a.y += a.vy * dt - 0.5 * GRAV * dt * dt; a.vy -= GRAV * dt; // コマの長さによらず同じ高さまで上がる
      if (a.vy <= 0 && a.y <= f.y) { a.y = f.y; land(a, -a.vy); }
    } else if (f.y < a.y - 0.04) { a.air = true; a.vy = 0; }
    else a.y += (f.y - a.y) * Math.min(1, dt * 14);
    if (!a.air) a.lv = footInfo(a.wx, a.wz).lv;
  }
  function land(a, speed) {
    a.air = false; a.vy = 0;
    a.squash = Math.max(a.squash, clamp(speed * 0.1, 0.15, 0.8)); a.sqRate = 9;
    a.lv = footInfo(a.wx, a.wz).lv;
    if (a === S.me && speed > 2) sfx('land');
    if (speed > 3) {
      for (var k = 0; k < 4; k++) spawnPuff(a.wx + rand(-0.4, 0.4), a.y + 0.08, a.wz + rand(-0.4, 0.4), { color: 0xf3eee4, vx: rand(-1, 1), vy: 0.4, vz: rand(-1, 1), s0: 0.3, s1: 0.9, life: 0.6, a: 0.65 });
      if (a === S.me) S.shake = Math.max(S.shake, clamp(speed * 0.012, 0.03, 0.09));
    }
  }
  // 壊す（自分・CPU）：地形を変え、通信へ知らせ、宝石のマスなら gemHit
  function breakCells(a, list) {
    var ch = setCells(list, true);
    if (!ch.length) return ch;
    if (a === S.me) { emit('terrain', ch); sfx('break'); onomato(a, 'break'); }
    gemHitCheck(a, ch);
    return ch;
  }

  /* ===== W19. 加速（まっすぐ進み続けている間だけ） ===== */
  // 1秒ごとに +10%（最大 +50%。CPU は CPU_LEVELS の accelMax まで）。
  // 0段へ戻す：壁にぶつかった／向きが変わった／ジャンプ・ドリルアタック・ジャンプドリルを押した／「すすむ」を離した。
  // 戻さない：段差を降りる・1段を登る・カメラの切り替え。freeze・setPaused の間は時間が進まないのでタイマーも止まる。
  function accelReset(a) { a.accT = 0; a.stage = 0; a.accHeading = a.heading; }
  function accelGrow(a, dt) { a.accT += dt; a.stage = Math.min(a.stageMax, Math.floor(a.accT + 1e-6)); }
  // 段が上がるほど土ぼこりが少し増える（控えめ）
  function accelDust(a, dt) {
    if (a.air || a.stage <= 0) { a.dustAcc = 0; return; }
    a.dustAcc += dt * a.stage * 2.4;
    var fx = -Math.sin(a.heading), fz = -Math.cos(a.heading), rx = -fz, rz = fx;
    while (a.dustAcc >= 1) {
      a.dustAcc -= 1;
      var sd = Math.random() < 0.5 ? -0.3 : 0.3;
      spawnPuff(a.wx - fx * 0.38 + rx * sd, a.y + 0.1, a.wz - fz * 0.38 + rz * sd, { color: 0xd2bc96, vx: fx * a.speed * 0.5 + rand(-0.3, 0.3), vy: rand(0.4, 0.8), vz: fz * a.speed * 0.5 + rand(-0.3, 0.3), s0: 0.2, s1: 0.6 + 0.07 * a.stage, life: 0.6, a: 0.4 + 0.06 * a.stage });
    }
  }

  /* ===== W20. ジャンプ・ドリルアタック・ジャンプドリル ===== */
  function canAct(a) { return !a.act && !a.air && !S.over; }
  function startJump(a) {
    if (!canAct(a)) return false;
    accelReset(a);
    a.act = { name: 'jump', phase: 'crouch', t: 0, pt: 0 };
    if (a === S.me) emit('action', 'jump');
    return true;
  }
  function startDrillAttack(a) {
    if (!canAct(a)) return false;
    accelReset(a);
    a.act = { name: 'drillAttack', phase: 'hold', t: 0, pt: 0, bore: 0, cell: -1, dustT: 0 };
    if (a === S.me) { emit('action', 'drillAttack'); onomato(a, 'drill'); }
    if (a.ai) a.ai.attacks++;
    return true;
  }
  function startJumpDrill(a) {
    if (!canAct(a)) return false;
    accelReset(a);
    a.act = { name: 'jumpDrill', phase: 'up', t: 0, pt: 0, cycles: 0, dustT: 0 };
    a.air = true; a.vy = Math.sqrt(2 * JD.g * (a.tip + JD.rise));
    spawnPuff(a.wx, a.y + 0.05, a.wz, { color: 0xf3eee4, vy: 0.2, s0: 0.35, s1: 1.0, life: 0.5, a: 0.6 });
    if (a === S.me) { emit('action', 'jumpDrill'); sfx('jump'); onomato(a, 'drill'); }
    if (a.ai) a.ai.digs++;
    return true;
  }
  function setPhase(A, p) { A.phase = p; A.pt = 0; }
  function stepAct(a, dt, inp) {
    var A = a.act; A.t += dt; A.pt += dt;
    if (A.name === 'jump') {
      if (A.phase === 'crouch') {
        a.squash = Math.min(1, A.pt / CROUCH) * 0.9; a.sqRate = 0;
        stepVertical(a, dt);
        if (A.pt >= CROUCH) {
          var apex = vis(a.lv + JUMP_UP) + JUMP_EXTRA;
          a.vy = Math.sqrt(2 * GRAV * Math.max(0.25, apex - a.y)); a.air = true; a.sqRate = 30;
          setPhase(A, 'air');
          spawnPuff(a.wx, a.y + 0.05, a.wz, { color: 0xf3eee4, vy: 0.2, s0: 0.35, s1: 1.0, life: 0.5, a: 0.6 });
          if (a === S.me) { sfx('jump'); onomato(a, 'jump'); }
          if (a.ai) a.ai.jumps++;
        }
      } else {
        stepVertical(a, dt);
        if (!a.air) a.act = null;
      }
    } else if (A.name === 'drillAttack') stepDrillAttack(a, A, dt, !!inp.drillAttack);
    else if (A.name === 'jumpDrill') stepJumpDrill(a, A, dt, !!inp.jumpDrill, inp.fwd || 0);
  }
  // ドリルアタック：押している間、ドリルを正面に向けたまま、前のマスを足元の段まで壊しながら進む
  function stepDrillAttack(a, A, dt, held) {
    if (A.phase === 'hold' && !held) { setPhase(A, 'end'); if (a === S.me) emit('action', 'drillAttackEnd'); }
    if (A.phase === 'end') { // 離した：ドリルが頭上へ戻る
      a.hatF = Math.max(0, a.hatF - dt / DA_BACK);
      a.spin += (0.15 - a.spin) * Math.min(1, dt * 6);
      a.lunge *= Math.exp(-dt * 10); a.shakeV = 0;
      stepVertical(a, dt);
      if (a.hatF <= 0) { a.act = null; a.lunge = 0; }
      return;
    }
    a.hatF = Math.min(1, a.hatF + dt / DA_WIND);
    a.spin = 1 + 7 * a.hatF;
    var d = dir4(a.heading);
    a.heading = angLerp(a.heading, dirToHeading(d), Math.min(1, dt * 10)); // 掘る向きは4方向にそろえる
    if (a === S.me) onomato(a, 'drill');
    var fx = DX[d], fz = DZ[d], m = 1.5 * dt;
    // 通路の真ん中へ寄せる（1マスの穴を掘り進めるように）
    if (fx === 0) { var nx = a.wx + clamp(Math.floor(a.wx) + 0.5 - a.wx, -m, m); if (canOccupy(a, nx, a.wz)) a.wx = nx; }
    else { var nz = a.wz + clamp(Math.floor(a.wz) + 0.5 - a.wz, -m, m); if (canOccupy(a, a.wx, nz)) a.wz = nz; }
    if (a.hatF >= 0.8) {
      var px = Math.floor(a.wx + fx * DA_REACH), pz = Math.floor(a.wz + fz * DA_REACH);
      var h = inMap(px, pz) ? S.heights[idx(px, pz)] : -1;
      if (h > a.lv && !a.air) {
        // ドリルの先が当たっている：DA_BREAK 秒で、そのマスを足元の段まで壊す
        var ci = idx(px, pz);
        if (A.cell !== ci) { A.cell = ci; A.bore = 0; if (a === S.me) sfx('drillHit'); }
        A.bore += dt;
        a.shakeV = 0.02; a.lunge = 0.05 + 0.03 * Math.sin(A.t * 30);
        A.dustT -= dt;
        if (A.dustT <= 0) {
          A.dustT = 0.06;
          var dc = new THREE.Color(); cellColor(ci, dc); blockColor(dc, h, ci);
          spawnDebris(px + 0.5 - fx * 0.45, Math.min(vis(h), a.y + 0.5), pz + 0.5 - fz * 0.45, dc, 2, 0.45);
        }
        if (A.bore >= DA_BREAK) {
          breakCells(a, [[px, pz, a.lv]]);
          A.bore = 0; A.cell = -1;
          if (a === S.me) S.shake = Math.max(S.shake, 0.1);
        }
      } else { A.cell = -1; A.bore = 0; a.lunge *= Math.exp(-dt * 8); a.shakeV = 0; }
      moveActor(a, DA_SPEED * S.speedMul * dt, true);
    }
    stepVertical(a, dt);
  }
  // ジャンプドリル：押している間、逆さのまま「足元のマスを1段壊す → 小さく跳ねる」をくり返す
  function tipClear(a, wx, wz) {
    if (wx - RAD < 0 || wz - RAD < 0 || wx + RAD > S.w || wz + RAD > S.h) return false;
    var low = a.y - a.tip * a.flip, r = 0.12;
    // 掘っている穴の底より2段高いマスまでは進める（そのマスに当たって1段壊す＝ななめ下へ少しずつ掘り進む）。高い壁は登れない
    var lim = Math.max(low + 0.03, vis(hAt(Math.floor(a.wx), Math.floor(a.wz))) + STEP_H * 2 + 0.01);
    var x0 = Math.floor(wx - r), x1 = Math.floor(wx + r), z0 = Math.floor(wz - r), z1 = Math.floor(wz + r);
    for (var z = z0; z <= z1; z++) for (var x = x0; x <= x1; x++) if (vis(hAt(x, z)) > lim) return false;
    return true;
  }
  function jdMove(a, dt, fwd) {
    if (fwd > 0) { // 「すすむ」を押していれば、跳ねるたびに少し前へ
      var fx = -Math.sin(a.heading), fz = -Math.cos(a.heading), d = JD.fwd * dt;
      if (tipClear(a, a.wx + fx * d, a.wz)) a.wx += fx * d;
      if (tipClear(a, a.wx, a.wz + fz * d)) a.wz += fz * d;
    } else { // 掘っているマスの真ん中へ
      var m = 1.5 * dt;
      a.wx += clamp(Math.floor(a.wx) + 0.5 - a.wx, -m, m);
      a.wz += clamp(Math.floor(a.wz) + 0.5 - a.wz, -m, m);
    }
  }
  function stepJumpDrill(a, A, dt, held, fwd) {
    if (!held && A.phase !== 'exit') {
      var wasBore = A.phase === 'bore';
      setPhase(A, 'exit'); a.air = true;
      a.vy = wasBore ? JD.exitVy : Math.max(a.vy, JD.exitVy * 0.6);
      a.shakeV = 0;
      if (a === S.me) emit('action', 'jumpDrillEnd');
    }
    var cx = Math.floor(a.wx), cz = Math.floor(a.wz);
    if (A.phase === 'up' || A.phase === 'fall') {
      a.y += a.vy * dt - 0.5 * JD.g * dt * dt; a.vy -= JD.g * dt;
      if (A.phase === 'up') {
        a.flip = Math.min(1, A.t / JD.flip); a.spin = 2;
        if (a.flip >= 1 && a.vy <= 0) setPhase(A, 'fall');
      } else { a.flip = 1; a.spin = 3; }
      jdMove(a, dt, fwd);
      cx = Math.floor(a.wx); cz = Math.floor(a.wz);
      var surf = vis(hAt(cx, cz)) + a.tip * a.flip;
      if (a.vy < 0 && a.y <= surf) {
        // 当たった：足元のマスを1段壊す（高さ0の床は壊れない）
        a.y = surf; setPhase(A, 'bore'); A.tx = cx; A.tz = cz;
        var h = hAt(cx, cz);
        // 「すすむ」を押しているときは、前のマスより低くなったら掘らずに跳ねて前へ（浅いみぞを掘りながら進む）
        var hf = fwd > 0 ? hAt(Math.floor(a.wx - Math.sin(a.heading) * 0.6), Math.floor(a.wz - Math.cos(a.heading) * 0.6)) : -1;
        if (h > 0 && !(fwd > 0 && h < hf)) breakCells(a, [[cx, cz, h - 1]]);
        else { var col = new THREE.Color(); cellColor(idx(cx, cz), col); digFx(cx + 0.5, 0, cz + 0.5, col, false); }
        if (a === S.me) { sfx('drillHit'); onomato(a, 'drill'); S.shake = Math.max(S.shake, 0.12); }
        A.y0 = a.y;
      }
    } else if (A.phase === 'bore') {
      a.spin = 7; a.shakeV = 0.025; a.flip = 1;
      var base = vis(hAt(A.tx, A.tz)) + a.tip;
      var k = Math.min(1, A.pt / (JD.bore * 0.6));
      a.y = A.y0 + (base - JD.sink - A.y0) * k;
      A.dustT -= dt;
      if (A.dustT <= 0) {
        A.dustT = 0.05;
        var dc = new THREE.Color(); cellColor(idx(A.tx, A.tz), dc); blockColor(dc, Math.max(2, hAt(A.tx, A.tz)), idx(A.tx, A.tz));
        spawnDebris(A.tx + 0.5, vis(hAt(A.tx, A.tz)) + 0.05, A.tz + 0.5, dc, 2, 0.5);
        spawnPuff(A.tx + 0.5 + rand(-0.35, 0.35), vis(hAt(A.tx, A.tz)) + 0.1, A.tz + 0.5 + rand(-0.35, 0.35), { color: 0xeadcc4, vy: 0.7, s0: 0.25, s1: 0.8, life: 0.5, a: 0.6 });
      }
      if (A.pt >= JD.bore) { setPhase(A, 'fall'); a.vy = JD.pop; a.shakeV = 0; A.cycles++; }
    } else if (A.phase === 'exit') { // 離した：通常の姿勢へなめらかに戻って着地
      a.y += a.vy * dt - 0.5 * JD.g * dt * dt; a.vy -= JD.g * dt; a.spin = 1.5;
      a.flip = Math.max(0, a.flip - dt / JD.unflip);
      var gy = footInfo(a.wx, a.wz).y;
      if (a.flip > 0 && a.vy < 0 && a.y < gy + a.tip * a.flip) a.y = gy + a.tip * a.flip; // 逆さのまま地面にもぐらない
      if (a.flip <= 0 && a.vy < 0 && a.y <= gy) { a.y = gy; land(a, Math.max(3.2, -a.vy)); a.act = null; a.spin = 0.15; }
      else if (A.pt > 3) { a.flip = 0; a.act = null; a.air = true; } // 念のため
    }
  }
  // inp = {fwd:-1..1, turn: ラジアン/秒, jump: 押した(1回), drillAttack: 押している, jumpDrill: 押している}
  // 自分も CPU も、この同じ入り口を通って動く（同じ規則・同じ時間）
  function updateActor(a, dt, inp) {
    a.bumpCd -= dt;
    var ox = a.wx, oz = a.wz, lv0 = a.lv, ground0 = !a.air;
    if (!S.over && !a.act) {
      if (inp.drillAttack) startDrillAttack(a);
      else if (inp.jumpDrill) startJumpDrill(a);
      else if (inp.jump) startJump(a);
    }
    var A = a.act, free = !A || A.name === 'jump', moving = false;
    if (inp.turn && free) a.heading += inp.turn * dt;
    if (free && inp.fwd > 0 && !S.over) {
      if (Math.abs(wrapAng(a.heading - a.accHeading)) > ACCEL_TURN) accelReset(a); // 向きが変わった
      var mul = 1 + ACCEL_STEP * a.stage;
      var sp = (a.air ? Math.max(a.speed * mul, AIR_SPEED * S.speedMul) : a.speed * mul) * inp.fwd;
      if (A && A.phase === 'crouch') sp *= 0.3;
      var want = sp * dt, got = moveActor(a, want, false);
      if (a._blocked && got < want * 0.5) accelReset(a); // 壁にぶつかった
      else accelGrow(a, dt);
      moving = got > want * 0.3;
    } else {
      if (free && inp.fwd < 0 && !S.over) moveActor(a, a.speed * inp.fwd * dt, false); // うしろ（キーボード）
      accelReset(a); // 「すすむ」を離した・ドリル中
    }
    if (a.act) stepAct(a, dt, inp); else stepVertical(a, dt);
    if (ground0 && !a.air && a.lv === lv0 + 1 && a === S.me) sfx('step'); // 1段を登った：ガタン
    if (moving) accelDust(a, dt); else a.dustAcc = 0;
    if (!a.act || a.act.name === 'jump') {
      a.hatF += (0 - a.hatF) * Math.min(1, dt * 10);
      a.spin += (0.15 - a.spin) * Math.min(1, dt * 4);
      a.flip = Math.max(0, a.flip - dt * 3);
      a.shakeV *= Math.exp(-dt * 12);
    }
    if (a.sqRate > 0) a.squash *= Math.exp(-dt * a.sqRate);
    var fwdMoved = ((a.wx - ox) * -Math.sin(a.heading) + (a.wz - oz) * -Math.cos(a.heading)) / Math.max(1e-4, dt) / SPEED;
    a.moveV += (fwdMoved - a.moveV) * Math.min(1, dt * 12);
    var tv = wrapAng(a.heading - (a.prevH == null ? a.heading : a.prevH)) / Math.max(1e-4, dt);
    a.prevH = a.heading;
    a.turnV += (tv - a.turnV) * Math.min(1, dt * 12);
  }
  // 止まっている間（freeze）：見た目だけ落ち着かせる
  function settleActor(a, dt) {
    a.moveV *= Math.exp(-dt * 8); a.turnV *= Math.exp(-dt * 8); a.prevH = a.heading;
    if (a.sqRate > 0) a.squash *= Math.exp(-dt * a.sqRate);
  }

  /* ===== W21. 自分の操作 ===== */
  var ACTIONS = ['fwd', 'back', 'left', 'right', 'jump', 'drillAttack', 'jumpDrill'];
  function press(action, isDown) {
    if (action === 'fire') action = 'drillAttack'; // 前の名前（互換）
    if (action === 'drillJump') action = 'jumpDrill'; // 第3期の名前（互換）
    if (ACTIONS.indexOf(action) < 0) return;
    if (!isDown) { S.held[action] = false; return; } // 離したのは、止まっている間も受ける
    if (S.paused || S.frozen) return;
    S.idleT = 0;
    if (action === 'jump' || action === 'drillAttack' || action === 'jumpDrill') {
      if (S.me) accelReset(S.me); // ボタンを押したら加速は0段へ
      if (action === 'jump' && !S.held.jump) S.tapQ.jump = 0.15; // ジャンプは押した瞬間だけ。少しだけ先行入力を受ける
    }
    S.held[action] = true;
  }
  function updateMe(dt) {
    var me = S.me; if (!me) return;
    var inp = { fwd: 0, turn: 0, jump: false, drillAttack: false, jumpDrill: false };
    if (!S.over) {
      inp.fwd = (S.held.fwd ? 1 : 0) - (S.held.back ? 0.5 : 0);
      inp.turn = ((S.held.left ? 1 : 0) - (S.held.right ? 1 : 0)) * KEY_TURN;
      inp.drillAttack = !!S.held.drillAttack;
      inp.jumpDrill = !!S.held.jumpDrill;
      inp.jump = S.tapQ.jump > 0;
    } else S.tapQ = {};
    var before = me.act;
    updateActor(me, dt, inp);
    if (S.tapQ.jump > 0) { if (me.act && me.act !== before && me.act.name === 'jump') S.tapQ.jump = 0; else S.tapQ.jump -= dt; }
    overGemCheck(me);
    // 走る音（Sfx が変わったときだけ音を変える）
    var st = 'idle', A = me.act;
    if (S.over) st = 'idle';
    else if (A && ((A.name === 'drillAttack' && A.phase === 'hold') || (A.name === 'jumpDrill' && A.phase !== 'exit'))) st = 'drill';
    else if (me.air) st = 'air';
    else if (Math.abs(me.moveV) > 0.08) st = 'run';
    else if (Math.abs(me.turnV) > 0.3) st = 'turn';
    engine(st, me.stage);
  }

  // 第5期 4d：自分のシーカーが「まだだれの物でもない宝石のマス」の真上（x,z が同じ）に入った瞬間に 'overGem'(ti) と Sfx 'pinpin'。
  //   同じマスにいる間は出さない。宝石のないマスへ出ると忘れる（また入れば出す）。空中にいる間は判定しない（着地してから）。
  //   光の柱・ソナーの どちらのモードでも出す。体の中心のマスで決める。
  function overGemCheck(a) {
    if (!a || a.air || S.over) return;
    var cx = Math.floor(a.wx), cz = Math.floor(a.wz), ti = inMap(cx, cz) ? S.gemAt[idx(cx, cz)] : -1;
    if (ti >= 0 && (!S.treasures[ti] || S.treasures[ti].owner >= 0)) ti = -1;
    if (ti === S.overTi) return;
    S.overTi = ti;
    if (ti >= 0) { sfx('pinpin'); emit('overGem', ti); }
  }

  /* ===== W22. CPU（ソナーで推理して さがす） ===== */
  // ★ きまり：CPU は宝の座標を直接読まない。
  //   CPU が宝石について知ってよいのは cpuSense() が返す「誤差つきの読み取り」だけ：
  //     ・ソナー：半径10マスの中は距離と向き、外は いちばん近い1つの向きだけ（人の左上のソナーと同じ手がかり。sonarRead を共用）
  //     ・'light' のときは光の柱の向き（人にも見えている）
  //   cpuSense() のほかの CPU の関数は、S.treasures（宝石の座標）・S.gemAt（宝石のマス）を読まない。
  //   CPU は読み取りを重ねて「どのブロックに入っていそうか」を推理し（遠ければ向きへ進み、近づいたら距離で絞る）、
  //   いちばんありそうなブロックを壊してみる。外れたら、そのブロックは候補から外す。
  //   地形（高さ）は人にも見えているので、道さがしに使ってよい。移動・ジャンプ・ドリルは人と同じ updateActor を通る。
  function initCpu(c, level) {
    var lv = CPU_LEVELS[level] ? level : 'normal', cfg = CPU_LEVELS[lv];
    c.speed = SPEED * S.speedMul * cfg.speed;
    c.stageMax = Math.round(cfg.accelMax / ACCEL_STEP);
    c.ai = {
      level: lv, cfg: cfg, wait: cfg.react, senseT: 0, key: -1, ll: null, est: -1, conf: 0, lastRead: null,
      goal: null, plan: null, planKey: '', ver: -1, stepT: 0, stuck: 0, holdFwd: false, jumpTo: -1, hold: null, detour: null, atGoalT: 0,
      hitTi: -1, time: 0, steps: 0, jumps: 0, attacks: 0, digs: 0, replans: 0, reads: 0, misses: 0, mistakes: 0, hitLog: []
    };
  }
  // ---- 読み取り（CPU が宝石の情報に触れるのは、ここだけ） ----
  function cpuSense(c) {
    // 人の画面のソナーと同じ情報だけ：円の中の宝は全部（距離と向き）、円の外は いちばん近い1つの向きだけ（ふちのくさび）。
    // 'light' のときは、人にも見えている光の柱の向き（全部の宝）をはっきり読める。
    var cfg = c.ai.cfg, out = [], all = sonarRead(c.wx, c.wz, CPU_SONAR_FAR), far = null, k;
    for (k = 0; k < all.length; k++) if (all[k].dist > CPU_SONAR_R && (!far || all[k].dist < far.dist)) far = all[k];
    for (k = 0; k < all.length; k++) {
      var s = all[k], d = s.dist, ang = Math.atan2(s.dx, s.dz), inR = d <= CPU_SONAR_R;
      if (!inR && s !== far && S.search !== 'light') continue; // ソナーだけ：円の外の2つ目からは見えない
      var r = { key: s.k, ang: null, sa: cfg.sonarErr.ang * (inR ? 1 : 1.8), dist: null };
      if (inR) { // ソナーの円の中：距離と向き（どちらも誤差つき）
        r.dist = Math.max(0, d * (1 + gauss() * cfg.sonarErr.dist) + gauss() * 0.3);
        if (d > 0.7) r.ang = ang + gauss() * cfg.sonarErr.ang;
      } else r.ang = ang + gauss() * cfg.sonarErr.ang * 1.8; // 円の外：向きだけ（遠いほど ぼんやり）
      if (S.search === 'light' && d > 0.7) { r.ang = ang + gauss() * cfg.sonarErr.ang * CPU_LIGHT_ERR; r.sa = cfg.sonarErr.ang * CPU_LIGHT_ERR; } // 光の柱の向き（はっきり見える）
      out.push(r);
    }
    return out;
  }
  // ---- 推理：ブロックのマスごとに「ありそうな度合い」（対数）を足していく ----
  function cpuBelief(c, r) {
    var ai = c.ai, W = S.w, H = S.h, N = W * H, ll = ai.ll, i, x, z;
    if (!ll) {
      ll = ai.ll = new Float32Array(N);
      for (i = 0; i < N; i++) ll[i] = S.heights[i] >= 2 ? 0 : -Infinity; // 宝石はブロックの中（遊ぶ人も知っているきまり）
      ai.reads = 0;
    }
    var sd = r.dist != null ? Math.max(0.5, ai.cfg.sonarErr.dist * r.dist) + 0.35 : 0, sa = r.sa;
    var best = -Infinity, bi = -1, cx = c.wx, cz = c.wz;
    for (z = 0; z < H; z++) for (x = 0; x < W; x++) {
      i = z * W + x;
      if (ll[i] === -Infinity) continue;
      if (S.heights[i] < 2) { ll[i] = -Infinity; continue; }
      var dx = x + 0.5 - cx, dz = z + 0.5 - cz, d = Math.hypot(dx, dz), v = 0;
      if (r.dist != null) { var e = d - r.dist; v -= e * e / (2 * sd * sd); }
      else if (d <= CPU_SONAR_R - 0.5) v -= 8; // 円の外と読めた：円の中のブロックではない
      if (r.ang != null && d > 0.7) { var se = Math.sqrt(sa * sa + 0.25 / (d * d)), ea = wrapAng(Math.atan2(dx, dz) - r.ang); v -= ea * ea / (2 * se * se); }
      ll[i] += v;
      if (ll[i] > best || (ll[i] === best && bi >= 0 && d < Math.hypot(bi % W + 0.5 - cx, ((bi / W) | 0) + 0.5 - cz))) { best = ll[i]; bi = i; }
    }
    ai.reads++;
    // 確からしさ：いちばんありそうなマスと、そのとなりに入っている割合
    var sum = 0, near = 0, bx = bi % W, bz = (bi / W) | 0;
    if (bi >= 0) for (z = 0; z < H; z++) for (x = 0; x < W; x++) {
      i = z * W + x; if (ll[i] === -Infinity) continue;
      var p = Math.exp(ll[i] - best); sum += p;
      if (Math.abs(x - bx) <= 1 && Math.abs(z - bz) <= 1) near += p;
    }
    ai.est = bi; ai.conf = sum > 0 ? near / sum : 0;
  }
  function cheb(a, b) { var W = S.w; return Math.max(Math.abs(a % W - b % W), Math.abs(((a / W) | 0) - ((b / W) | 0))); }
  function cellAt(wx, wz) { return clamp(Math.floor(wz), 0, S.h - 1) * S.w + clamp(Math.floor(wx), 0, S.w - 1); }
  function cpuSenseAndDecide(c) {
    var ai = c.ai, cfg = ai.cfg, R = cpuSense(c);
    if (!R.length) { ai.goal = null; ai.plan = null; return; }
    // 追いかける宝：いまの読み取りがまだあればそれ。円の外なら、円の中の読み取りがあればそちら（いちばん近いもの）
    var cur = null, near = null;
    R.forEach(function (r) { if (r.key === ai.key) cur = r; if (r.dist != null && (!near || r.dist < near.dist)) near = r; });
    if (!cur || (cur.dist == null && near)) cur = near || R[(Math.random() * R.length) | 0];
    if (cur.key !== ai.key) { ai.key = cur.key; ai.ll = null; ai.goal = null; ai.plan = null; }
    cpuBelief(c, cur);
    ai.lastRead = cur;
    var g;
    if (ai.detour && ai.time < ai.detour.until) g = { kind: 'go', cell: ai.detour.cell };
    else {
      ai.detour = null;
      var digging = ai.goal && ai.goal.kind === 'dig';
      if (cur.dist == null && ai.conf < (digging ? 0.3 : 0.6) && cur.ang != null) { // 遠い：見えた向きへ進む（一度しぼれたら、少しゆれても掘りに行く）
        var wx = clamp(c.wx + Math.sin(cur.ang) * 7, 0.5, S.w - 0.5), wz = clamp(c.wz + Math.cos(cur.ang) * 7, 0.5, S.h - 0.5);
        g = { kind: 'go', cell: cellAt(wx, wz) };
      } else if (ai.est >= 0) g = { kind: 'dig', cell: ai.est };
      else { ai.goal = null; return; }
    }
    var old = ai.goal;
    if (!old || old.kind !== g.kind || old.cell !== g.cell) {
      // 新しく掘る所を決めたとき、ときどき道を間違える（少しはなれた所へ寄り道してしまう）
      if (g.kind === 'dig' && (!old || old.kind !== 'dig' || cheb(old.cell, g.cell) > 2) && !ai.detour && Math.random() < cfg.mistake) {
        var an = rand(0, Math.PI * 2), dd = rand(4, 7);
        ai.detour = { cell: cellAt(clamp(c.wx + Math.cos(an) * dd, 0.5, S.w - 0.5), clamp(c.wz + Math.sin(an) * dd, 0.5, S.h - 0.5)), until: ai.time + 6 };
        ai.mistakes++;
        g = { kind: 'go', cell: ai.detour.cell };
      }
      if (!old || old.kind !== g.kind || cheb(old.cell, g.cell) > 0) ai.atGoalT = 0;
      ai.goal = g;
    }
  }
  // ---- 道さがし（A*）：状態＝(マス, 立っている段)。手＝歩く(1)・ジャンプで乗る(2)・ドリルアタックで壊して入る(3) ----
  var heap = { k: [], v: [] }, planBuf = null;
  function hpush(st, d) {
    var hk = heap.k, hv = heap.v, i = hk.length; hk.push(d); hv.push(st);
    while (i > 0) { var p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; var t = hk[p]; hk[p] = hk[i]; hk[i] = t; t = hv[p]; hv[p] = hv[i]; hv[i] = t; i = p; }
  }
  function hpop() {
    var hk = heap.k, hv = heap.v, top = hv[0], last = hk.length - 1;
    hk[0] = hk[last]; hv[0] = hv[last]; hk.pop(); hv.pop();
    var i = 0, n = hk.length;
    for (;;) { var l = i * 2 + 1, r = l + 1, m = i; if (l < n && hk[l] < hk[m]) m = l; if (r < n && hk[r] < hk[m]) m = r; if (m === i) break; var t = hk[m]; hk[m] = hk[i]; hk[i] = t; t = hv[m]; hv[m] = hv[i]; hv[i] = t; i = m; }
    return top;
  }
  function planPath(a, goal) {
    var W = S.w, N = W * S.h, Hh = S.heights, M = N * NL, tg = goal.cell, tx = tg % W, tz = (tg / W) | 0, Ht = Hh[tg];
    var dig = goal.kind === 'dig';
    function isGoal(cell, L) {
      if (dig) {
        if (cell === tg) return true;
        var x = cell % W, z = (cell / W) | 0;
        return Math.abs(x - tx) + Math.abs(z - tz) === 1 && L < Ht;
      }
      return cheb(cell, tg) <= 1;
    }
    function hEst(cell) { var x = cell % W, z = (cell / W) | 0; return Math.max(0, Math.abs(x - tx) + Math.abs(z - tz) - 1); }
    if (!planBuf || planBuf.M !== M) planBuf = { M: M, dist: new Float64Array(M), prev: new Int32Array(M), act: new Uint8Array(M) };
    var dist = planBuf.dist, prev = planBuf.prev, act = planBuf.act;
    dist.fill(Infinity); prev.fill(-1);
    heap.k.length = 0; heap.v.length = 0;
    var c0 = cellAt(a.wx, a.wz), L0 = clamp(a.lv, 0, 10), s0 = c0 * NL + L0;
    dist[s0] = 0; hpush(s0, hEst(c0));
    function relax(from, to, d, code) { if (d < dist[to]) { dist[to] = d; prev[to] = from; act[to] = code; hpush(to, d + hEst((to / NL) | 0)); } }
    var goalS = -1, pops = 0;
    while (heap.k.length) {
      var s = hpop(), dk = dist[s];
      if (++pops > 400000) break;
      var cell = (s / NL) | 0, L = s - cell * NL;
      if (isGoal(cell, L)) { goalS = s; break; }
      var x = cell % W, z = (cell - x) / W;
      for (var dd = 0; dd < 4; dd++) {
        var nx = x + DX[dd], nz = z + DZ[dd];
        if (nx < 0 || nz < 0 || nx >= W || nz >= S.h) continue;
        var n = nz * W + nx, hn = Hh[n];
        if (hn <= L + 1) relax(s, n * NL + hn, dk + 1, 1);
        else if (hn <= L + JUMP_UP) relax(s, n * NL + hn, dk + 2.2, 2);
        if (hn > L + 1) relax(s, n * NL + L, dk + (hn >= 8 ? 4.5 : 3.2), 3); // 壊して入る（約0.9秒＝歩く約3マス分）
      }
    }
    if (goalS < 0) return null;
    var out = [];
    for (var q = goalS; q !== s0 && q >= 0; q = prev[q]) out.push({ cell: (q / NL) | 0, L: q % NL, a: act[q] });
    out.reverse();
    return out;
  }
  // 目標の点へ向きを変えながら進む（人と同じく「回す」と「すすむ」で）。残りの距離を返す
  function steer(c, x, z, dt, inp) {
    var dx = x - c.wx, dz = z - c.wz, d = Math.hypot(dx, dz);
    if (d < 0.02) return d;
    var want = Math.atan2(-dx, -dz), err = wrapAng(want - c.heading), mx = c.ai.cfg.turn;
    if (Math.abs(err) > 0.05 || d < 0.6) inp.turn = clamp(err / dt, -mx, mx); // 小さなずれでは回さない（まっすぐ進んで加速できるように）
    var e2 = Math.abs(wrapAng(want - (c.heading + inp.turn * dt)));
    if (e2 < 0.7) inp.fwd = Math.min(1, d / Math.max(1e-3, c.speed * (1 + ACCEL_STEP * c.stage) * dt)) * Math.max(0.35, Math.cos(e2));
    return d;
  }
  function turnTo(c, want, dt, inp) {
    var err = wrapAng(want - c.heading), mx = c.ai.cfg.turn;
    if (Math.abs(err) <= 0.03) return true;
    inp.turn = clamp(err / dt, -mx, mx);
    return false;
  }
  function centerOn(c, cell, dt, inp, tol) {
    var x = cell % S.w + 0.5, z = ((cell / S.w) | 0) + 0.5;
    if (Math.hypot(c.wx - x, c.wz - z) <= tol) return true;
    steer(c, x, z, dt, inp);
    return false;
  }
  function cpuHold(c, dt, inp) {
    var ai = c.ai, H = ai.hold; H.t += dt;
    if (H.kind === 'through') { // 前を壊しながら進む（ドリルアタックを押したまま）
      inp.drillAttack = true;
      if (cellAt(c.wx, c.wz) === H.cell) {
        if (ai.plan && ai.plan[0] && ai.plan[0].cell === H.cell) { ai.plan.shift(); ai.steps++; }
        var nx = ai.plan && ai.plan[0];
        if (nx && nx.a === 3 && nx.cell - H.cell === H.step) { H.cell = nx.cell; H.t = 0; }
        else { ai.hold = null; inp.drillAttack = false; }
      } else if (H.t > 4) { ai.hold = null; ai.plan = null; ai.stuck++; inp.drillAttack = false; }
      return;
    }
    // 掘ってみる：目当てのブロックが1段でも下がるまで押す
    if (H.jd) inp.jumpDrill = true; else inp.drillAttack = true;
    var lowered = S.heights[H.cell] < H.h0;
    if (lowered || ai.hitTi >= 0 || H.t > 3.5) {
      ai.hold = null; inp.drillAttack = false; inp.jumpDrill = false;
      ai.goal = null; ai.plan = null; ai.atGoalT = 0;
      if (ai.hitTi >= 0) { ai.hitTi = -1; ai.key = -1; ai.ll = null; ai.wait = ai.cfg.react; }
      else if (lowered) { if (ai.ll) ai.ll[H.cell] = -Infinity; ai.misses++; ai.wait = ai.cfg.react * 0.5; ai.senseT = 0; }
    }
  }
  function cpuThink(c, dt, inp) {
    var ai = c.ai, W = S.w, g = ai.goal;
    if (!g) return;
    var key = g.kind + ':' + g.cell;
    if (!ai.plan || ai.planKey !== key || ai.ver !== S.mapVer || ai.stepT > 5) {
      if (ai.stepT > 5) { ai.stuck++; ai.stepT = 0; if (ai.stuck >= 2) { ai.stuck = 0; inp.turn = rand(-1.2, 1.2) / Math.max(dt, 1e-3); inp.jump = true; ai.holdFwd = true; ai.jumpTo = -1; return; } }
      ai.plan = planPath(c, g); ai.planKey = key; ai.ver = S.mapVer; ai.replans++;
      if (!ai.plan) { if (g.kind === 'dig' && ai.ll) ai.ll[g.cell] = -Infinity; ai.goal = null; ai.wait = 0.3; return; }
    }
    ai.stepT += dt;
    var cc = cellAt(c.wx, c.wz), st = ai.plan[0];
    if (!st) { // 着いた
      if (g.kind === 'go') { ai.goal = null; ai.plan = null; ai.detour = null; ai.senseT = 0; return; }
      var t = g.cell;
      if (S.heights[t] < 2) { ai.goal = null; ai.plan = null; ai.senseT = 0; return; }
      // まだ自信がなければ、少し止まってソナーを読み直す
      if (ai.conf < 0.3 && ai.atGoalT < ai.cfg.react * 2.5) { ai.atGoalT += dt; return; }
      if (cc === t) { if (centerOn(c, t, dt, inp, 0.15)) { ai.hold = { kind: 'dig', jd: true, cell: t, h0: S.heights[t], t: 0 }; } return; }
      var tx = t % W, tz = (t / W) | 0, cx = cc % W, cz = (cc / W) | 0;
      if (Math.abs(tx - cx) + Math.abs(tz - cz) !== 1 || S.heights[t] <= c.lv) { ai.plan = null; return; }
      if (!centerOn(c, cc, dt, inp, 0.15)) return;
      if (!turnTo(c, Math.atan2(-(tx - cx), -(tz - cz)), dt, inp)) return;
      ai.hold = { kind: 'dig', jd: false, cell: t, h0: S.heights[t], t: 0 };
      return;
    }
    var sx = st.cell % W, sz = (st.cell / W) | 0, ccx = cc % W, ccz = (cc / W) | 0;
    if (st.a === 1) { // 歩く（降りるのは自由）
      if (Math.abs(ccx - sx) + Math.abs(ccz - sz) > 1 || S.heights[st.cell] > c.lv + 1) { ai.plan = null; return; }
      // 先の歩くマスがまっすぐ並んでいれば、遠くのマスをねらう（向きを変えずに進めて加速できる）
      var aim = st, k = 1, ddx = sx - ccx, ddz = sz - ccz;
      while (k < 5 && ai.plan[k] && ai.plan[k].a === 1 && ai.plan[k].cell - ai.plan[k - 1].cell === ddz * W + ddx) { aim = ai.plan[k]; k++; }
      steer(c, aim.cell % W + 0.5, ((aim.cell / W) | 0) + 0.5, dt, inp);
      if (Math.hypot(c.wx - sx - 0.5, c.wz - sz - 0.5) < 0.3 || (cc === st.cell && aim !== st)) { ai.plan.shift(); ai.stepT = 0; ai.stuck = 0; ai.steps++; }
      return;
    }
    // 跳んで乗る・壊して入る：まず自分のマスの真ん中で、そのマスの方を向く
    if (Math.abs(ccx - sx) + Math.abs(ccz - sz) !== 1) { ai.plan = null; return; }
    if (!centerOn(c, cc, dt, inp, 0.15)) return;
    if (!turnTo(c, Math.atan2(-(sx - ccx), -(sz - ccz)), dt, inp)) return;
    if (st.a === 2) { inp.jump = true; ai.holdFwd = true; ai.jumpTo = st.cell; st.a = 1; ai.stepT = 0; ai.steps++; return; }
    ai.hold = { kind: 'through', cell: st.cell, step: st.cell - cc, t: 0 };
    inp.drillAttack = true;
  }
  function updateCpu(dt) {
    var c = S.cpu; if (!c) return;
    var ai = c.ai, inp = { fwd: 0, turn: 0, jump: false, drillAttack: false, jumpDrill: false };
    if (!S.over) {
      ai.time += dt;
      ai.senseT -= dt;
      if (ai.senseT <= 0 && !c.air && !ai.hold) { ai.senseT = ai.cfg.react; cpuSenseAndDecide(c); }
      if (ai.hold) cpuHold(c, dt, inp);
      else if (c.act || c.air) {
        if (ai.holdFwd) {
          inp.fwd = 1;
          // 第5期：跳んで乗るマスの真ん中を過ぎたら「すすむ」を離す（はやい だと空中で進みすぎて、1マスの段から向こうへ落ちるため）
          if (ai.jumpTo >= 0) {
            var jx = ai.jumpTo % S.w + 0.5, jz = ((ai.jumpTo / S.w) | 0) + 0.5;
            if ((jx - c.wx) * -Math.sin(c.heading) + (jz - c.wz) * -Math.cos(c.heading) < 0.05) inp.fwd = 0;
          }
        }
      } else {
        ai.holdFwd = false; ai.jumpTo = -1;
        if (ai.wait > 0) ai.wait -= dt;
        else cpuThink(c, dt, inp);
      }
    }
    updateActor(c, dt, inp);
  }

  /* ===== W23. 相手（通信） ===== */
  function ensureRemote(i, s, snap) {
    var r = S.remotes[i];
    if (!r) {
      var pal = s && s.palette != null && isFinite(+s.palette) ? clamp(+s.palette | 0, 0, 9) : paletteOf(i);
      var col = (s && s.color) || colorOf(i);
      r = makeActor(i, col, { x: Math.floor(+s.x || 0), z: Math.floor(+s.z || 0), dir: 0 }, pal);
      S.scene.add(r.root);
      r.tgt = { x: r.wx, z: r.wz, y: r.y, heading: r.heading, flip: 0, squash: 0, hatF: 0, spin: 0.15, anim: 'idle' };
      S.remotes[i] = r; snap = true;
    }
    if (s) {
      if (s.color || s.palette != null) recolorActor(r, s.color, s.palette != null && isFinite(+s.palette) ? clamp(+s.palette | 0, 0, 9) : null);
      var g = r.tgt;
      g.x = (+s.x || 0) + 0.5; g.z = (+s.z || 0) + 0.5;
      g.y = isFinite(+s.y) && s.y != null ? +s.y : vis(hAt(Math.floor(g.x), Math.floor(g.z)));
      if (isFinite(+s.heading) && s.heading != null) g.heading = +s.heading; else if (s.dir != null) g.heading = dirToHeading(s.dir | 0);
      g.flip = clamp(+s.flip || 0, 0, 1); g.squash = clamp(+s.squash || 0, 0, 1); g.hatF = clamp(+s.hatForward || 0, 0, 1);
      g.spin = isFinite(+s.spin) && s.spin != null ? +s.spin : 0.15; g.anim = s.anim || 'idle';
      if (snap || Math.hypot(r.wx - g.x, r.wz - g.z) > 3) { r.wx = g.x; r.wz = g.z; r.y = g.y; r.heading = g.heading; }
    }
    return r;
  }
  function updateRemotes(dt) {
    var k = 1 - Math.exp(-dt * 12);
    for (var i in S.remotes) {
      var r = S.remotes[i], g = r.tgt, h0 = r.heading, ox = r.wx, oz = r.wz;
      r.wx += (g.x - r.wx) * k; r.wz += (g.z - r.wz) * k; r.y += (g.y - r.y) * k;
      r.heading = angLerp(r.heading, g.heading, 1 - Math.exp(-dt * 14));
      r.flip += (g.flip - r.flip) * k; r.squash += (g.squash - r.squash) * k; r.hatF += (g.hatF - r.hatF) * k; r.spin += (g.spin - r.spin) * k;
      var fm = ((r.wx - ox) * -Math.sin(r.heading) + (r.wz - oz) * -Math.cos(r.heading)) / Math.max(1e-4, dt) / SPEED;
      r.moveV += (fm - r.moveV) * Math.min(1, dt * 10);
      r.turnV = wrapAng(r.heading - h0) / Math.max(1e-4, dt);
      animateActor(r, dt);
    }
  }

  /* ===== W24. カメラ ===== */
  // 俯瞰で地図を置く範囲（画面の高さ=1 とした割合）。左右の操作ボタンのあいだに地図が入るようにする
  var TOP_X0 = 0.53, TOP_X1 = 1.42, TOP_FILL_H = 0.9;
  function overheadHeight() {
    var cam = S.camera, half = THREE.MathUtils.degToRad(cam.fov / 2), tn = Math.tan(half);
    var asp = Math.max(0.3, cam.aspect), fw = clamp((TOP_X1 - TOP_X0) / asp, 0.3, 1), fh = TOP_FILL_H;
    var hz = S.h / 2 + 1, hx = S.w / 2 + 1;
    var need = Math.max(hz / (tn * fh), hx / (tn * asp * fw));
    return Math.max(20, need) + 2;
  }
  function overheadShift(hh) {
    var cam = S.camera, tn = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), asp = Math.max(0.3, cam.aspect);
    if (asp < 1.2) return 0;
    var centerFrac = ((TOP_X0 + TOP_X1) / 2) / asp - 0.5;
    return centerFrac * 2 * hh * tn * asp;
  }
  // おいかけ視点：シーカーの後ろ上から heading の方向を見る（スワイプで回る）。シーカー（高さ1.7）の全身が画面の下寄りに入る
  // 第5期 4a：真うしろから（CHASE_SIDE=0）。第4期は「少し右うしろ（1.1）から、端の星も見せる」にしていたため、
  //   カメラの向きが進む向きから 6.5° ずれ、すすむで車体がななめに見えて右ななめ前へ進むように見えていた
  var CHASE_BACK = 3.9, CHASE_UP = 3.2, CHASE_AHEAD = 3.6, CHASE_SIDE = 0;
  // みわたし：シーカーのうしろの高めのななめ上から（シーカーを見る仰角 WIDE_ELEV、距離 WIDE_DIST マス）。少し先（WIDE_AHEAD）を見る＝シーカーは画面の下寄り、行く先が広く見える
  var WIDE_ELEV = 58 * Math.PI / 180, WIDE_DIST = 11, WIDE_AHEAD = 3.2;
  var ATK_SIDE = 1.5, ATK_UP = 1.3, ATK_BACK = 0.6, ATK_HOLD = 0.9;          // ドリルアタック中のずらし
  var ORBIT_YAW = 2.25, ORBIT_DIST = 3.0, ORBIT_UP = 1.75, IDLE_ORBIT = 2.6;  // 顔を見せる回りこみ（止まって2.6秒で）
  var FADE_ON = 0.7;                                                          // 間の壁を透かす量（0.7＝不透明度 0.3 の なめらかな半透明）
  var poseM = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0), NORTH = new THREE.Vector3(0, 0, -1);
  function poseFor(mode) {
    var p = new THREE.Vector3(), q = new THREE.Quaternion(), tg = new THREE.Vector3();
    var a = S.me || { wx: S.w / 2, wz: S.h / 2, heading: 0 };
    var px = a.wx, pz = a.wz, py = S.camY;
    var fx = -Math.sin(a.heading), fz = -Math.cos(a.heading);
    if (mode === 0) {
      p.set(px + fx * 0.3, py + 1.15, pz + fz * 0.3);
      tg.set(px + fx * 5, py + 0.5 + S.pitchV * 2.4, pz + fz * 5);
      poseM.lookAt(p, tg, UP);
    } else if (mode === 1) {
      var pv = S.pitchV, up = CHASE_UP + (pv > 0 ? -pv * 1.2 : -pv * 2.6), ah = CHASE_AHEAD + pv * (pv > 0 ? 3 : 2.6);
      var rx = -fz, rz = fx; // 右
      var back = CHASE_BACK, side = CHASE_SIDE * S.sideK, ak = ease(clamp(S.atkK, 0, 1)), ok = ease(clamp(S.orbitK, 0, 1));
      var sg = S.sideK < 0 ? -1 : 1; // 右どなりに高い壁があれば左側へ（ずらす・回りこむ側）
      // ドリルアタック：少し右・上へずれて、正面の壊れるマスが体のかげにならないように
      side += ak * ATK_SIDE * sg; up += ak * ATK_UP; back -= ak * ATK_BACK;
      // 止まっているとき・拾ったとき：前ななめへ回りこんで、顔（目）と端の星を見せる（向き＝操作は変えない）
      back += (ORBIT_DIST - back) * ok; up += (ORBIT_UP - up) * ok;
      var rr = Math.hypot(back, side), th = Math.atan2(side, back) + sg * ok * ORBIT_YAW;
      var u = -Math.cos(th) * rr, v = Math.sin(th) * rr; // u=前、v=右
      p.set(px + fx * u + rx * v, py + up + S.chaseLift * (1 - ok), pz + fz * u + rz * v);
      tg.set(px + fx * ah, py + 0.35 + pv * (pv > 0 ? 1.1 : 0.4) + S.chaseLift * 0.5, pz + fz * ah);
      if (ak > 0) { tg.x += rx * ak * 0.5; tg.z += rz * ak * 0.5; }
      if (ok > 0) tg.lerp(tmpV.set(px, py + 0.6, pz), ok);
      var gk = ease(clamp(S.gemCamK, 0, 1));
      if (gk > 0.001 && gemCamPose(a, gcP, gcT)) { p.lerp(gcP, gk); tg.lerp(gcT, gk); }
      poseM.lookAt(p, tg, UP);
    } else if (mode === CAM_WIDE) {
      // みわたし：heading のうしろ・高めのななめ上から見下ろす（地図のかなりの範囲とシーカーが見える）
      var wb = Math.cos(WIDE_ELEV) * WIDE_DIST, wu = Math.sin(WIDE_ELEV) * WIDE_DIST, wp = S.pitchV;
      p.set(px - fx * wb, py + wu, pz - fz * wb);
      tg.set(px + fx * (WIDE_AHEAD + wp * 2.5), py, pz + fz * (WIDE_AHEAD + wp * 2.5));
      poseM.lookAt(p, tg, UP);
    } else {
      var hh = overheadHeight(), sx = overheadShift(hh);
      p.set(S.w / 2 - sx, hh, S.h / 2 + 0.001);
      tg.set(S.w / 2 - sx, 0, S.h / 2);
      poseM.lookAt(p, tg, NORTH);
    }
    q.setFromRotationMatrix(poseM);
    return { p: p, q: q };
  }
  // 後ろの壁でシーカーが隠れないよう、必要なぶんだけカメラを持ち上げる
  function chaseLiftTarget() {
    var a = S.me; if (!a) return 0;
    var fx = -Math.sin(a.heading), fz = -Math.cos(a.heading), lift = 0;
    var headY = S.camY + 1.0;
    for (var s = 0.55; s < CHASE_BACK; s += 0.3) {
      var top = groundTopAt(a.wx - fx * s, a.wz - fz * s) + 0.12;
      if (top <= headY) continue;
      var needH = headY + (top - headY) * CHASE_BACK / s;
      var pv = S.pitchV, up = CHASE_UP + (pv > 0 ? -pv * 1.2 : -pv * 2.6);
      lift = Math.max(lift, needH - (S.camY + up));
    }
    return clamp(lift, 0, 2.6);
  }
  // 宝石の獲得（自分）：浮き上がる 3.5 秒の間のカメラ。獲得宣言のカード（ステージの y 33.5〜58.5%・x 18〜82%）に隠れないよう、
  //   ・宝石は画面の上のほう（上から約 22%。12〜30% の中）
  //   ・シーカーは カードの下（頭が上から 61% より下、足が画面の下からはみ出さない）
  // に入る位置を、award のときに1回だけ探して決める（16方向 × 距離 × 高さ。壁にさえぎられにくく、近いほど よい）。
  // 宝石がシーカーから遠い（8マスより先：通信の遅れなど）か、両方が入る位置がないときは、宝石だけを画面の上のほうに大きく映す。
  var GEMCAM_GEM_NDC = 0.56;            // 宝石の高さ（画面の中心=0、上の端=1）＝上から 22%
  var GEMCAM_HEAD_NDC = -0.22;          // シーカーの頭はこれより下（上から 61%＝カードの下の端 58.5% より下）
  var GEMCAM_FEET_NDC = -0.7;           // シーカーの足はこれより上（上から 85%。画面の下の端・操作ボタンの下へ沈まない）
  var GEMCAM_FAR = 8;                   // これより遠い宝石は、宝石だけを映す
  var gcP = new THREE.Vector3(), gcT = new THREE.Vector3(), gcV = new THREE.Vector3(), gcCam = null;
  function gemPeak(tr) { return tr.anim ? tr.anim.y0 + tr.anim.rise : vis(S.heights[idx(tr.x, tr.z)]) + 0.15 + GEM_RISE; }
  // 線分の上で、積み木の上の面より下を通る所を数える（さえぎられる量）
  function occCount(x0, y0, z0, x1, y1, z1) {
    var n = 0, len = Math.hypot(x1 - x0, y1 - y0, z1 - z0), steps = Math.max(4, Math.ceil(len / 0.3));
    for (var i = 1; i < steps; i++) {
      var t = i / steps; if (t > 0.94) break;
      if (groundTopAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t) > y0 + (y1 - y0) * t) n++;
    }
    return n;
  }
  function startGemCam(tr) {
    var a = S.me; if (!a) return;
    if (!gcCam) gcCam = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 400);
    gcCam.fov = S.camera.fov; gcCam.aspect = 16 / 9; gcCam.updateProjectionMatrix(); // ステージ（16:9）の画面で考える
    var gx = tr.group.position.x, gz = tr.group.position.z, gy = gemPeak(tr);
    var far = Math.hypot(gx - a.wx, gz - a.wz) > GEMCAM_FAR;
    var best = gemCamSolve(tr, a, gx, gy, gz, far, GEMCAM_FEET_NDC);
    if (!best && !far) best = gemCamSolve(tr, a, gx, gy, gz, false, -0.9); // 狭い所：足もとは画面の下のはしまで ゆるめる
    if (!best) best = gemCamSolve(tr, a, gx, gy, gz, true, 0); // 両方は入らない（とても狭い所など）：宝石だけを映す
    S.gemCamWhy = best ? (best.far ? 'gem-only' : 'both') : 'none';
    if (!best) { S.gemCam = null; return; } // それでも見つからない：いつものカメラのまま
    S.gemCam = { tr: tr, p: new THREE.Vector3(best.x, best.y, best.z), pitch: best.pitch, dx: best.dx, dz: best.dz };
  }
  function gemCamSolve(tr, a, gx, gy, gz, far, feetNdc) {
    var tn = Math.tan(THREE.MathUtils.degToRad(gcCam.fov / 2));
    var fx = -Math.sin(a.heading), fz = -Math.cos(a.heading);
    // 見る中心（水平）：宝石とシーカーの間。遠いときは宝石
    var mx = far ? gx : (gx + a.wx) / 2, mz = far ? gz : (gz + a.wz) / 2;
    var headY = a.y + 1.6, feetY = a.y + 0.05;
    var best = null;
    for (var k = 0; k < 16; k++) {
      var an = k / 16 * Math.PI * 2, dx = Math.cos(an), dz = Math.sin(an);
      for (var D = 3; D <= 24; D += 0.75) {
        var cx = mx + dx * D, cz = mz + dz * D, found = null;
        for (var hy = Math.min(a.y, gy) + 0.6; hy <= Math.max(gy, headY) + 14; hy += 0.6) {
          if (groundTopAt(cx, cz) > hy - 0.6) continue;           // カメラが積み木の中に入らない
          // 宝石を上から 22% に置く向き
          var fd = (gx - cx) * -dx + (gz - cz) * -dz;             // 宝石までの前向きの距離
          if (fd < 1.5) continue;
          var pitch = Math.atan2(gy - hy, fd) - Math.atan(GEMCAM_GEM_NDC * tn);
          if (pitch < -1.15 || pitch > 0.5) continue;              // 真下・空を見上げすぎない
          gcCam.position.set(cx, hy, cz);
          gcT.set(cx - dx * Math.cos(pitch), hy + Math.sin(pitch), cz - dz * Math.cos(pitch));
          gcCam.lookAt(gcT); gcCam.updateMatrixWorld();
          var pg = gcV.set(gx, gy, gz).project(gcCam);
          if (pg.z > 1 || Math.abs(pg.x) > 0.6 || pg.y < 0.42 || pg.y > 0.74) continue;
          if (!far) {
            var ph = gcV.set(a.wx, headY, a.wz).project(gcCam), py = ph.y, px = ph.x, pz = ph.z;
            var pf = gcV.set(a.wx, feetY, a.wz).project(gcCam);
            if (pz > 1 || py > GEMCAM_HEAD_NDC || pf.y < feetNdc || Math.abs(px) > 0.55) continue;
          }
          found = { x: cx, y: hy, z: cz, pitch: pitch, dx: dx, dz: dz, far: far };
          break; // この距離では いちばん低い（地面に近い）高さを使う
        }
        if (!found) continue;
        var occ = occCount(cx, found.y, cz, gx, gy, gz) * (far ? 3 : 1);
        if (!far) { // シーカーの頭・体の真ん中・左右のはし・足もとが、壁に隠れないか
          var lx = -dz * 0.4, lz = dx * 0.4;
          occ += occCount(cx, found.y, cz, a.wx, headY, a.wz) + occCount(cx, found.y, cz, a.wx, a.y + 0.7, a.wz) + occCount(cx, found.y, cz, a.wx, feetY + 0.2, a.wz)
            + occCount(cx, found.y, cz, a.wx + lx, a.y + 0.7, a.wz + lz) + occCount(cx, found.y, cz, a.wx - lx, a.y + 0.7, a.wz - lz);
        }
        var front = dx * fx + dz * fz;                            // シーカーの顔の側から見たい
        var outMap = inMap(Math.floor(cx), Math.floor(cz)) ? 0 : 1;
        var score = -occ * 4 - D * 0.35 + front * 1.0 - outMap * 1.5;
        if (!best || score > best.score) { found.score = score; best = found; }
        break; // この向きでは、いちばん近い距離を使う
      }
    }
    return best;
  }
  function gemCamOn() {
    var G = S.gemCam; if (!G || !G.tr.anim || G.tr.owner < 0) return false;
    return !G.tr.anim.done && G.tr.anim.t < GEM_SHOW + GEM_FLY * 0.6;
  }
  function gemCamPose(a, outP, outT) {
    var G = S.gemCam; if (!G) return false;
    outP.copy(G.p);
    var cp = Math.cos(G.pitch);
    outT.set(G.p.x - G.dx * cp * 5, G.p.y + Math.sin(G.pitch) * 5, G.p.z - G.dz * cp * 5);
    return true;
  }
  function setCamera(mode) {
    mode = ((mode | 0) % CAM_N + CAM_N) % CAM_N;
    if (!S.camera || !S.camFrom) { S.camMode = mode; return; }
    if (mode === S.camMode) return;
    S.intro = null;
    S.camFrom.p.copy(S.camera.position).sub(S.shakeOff || tmpV.set(0, 0, 0));
    S.camFrom.q.copy(S.camera.quaternion);
    S.camMode = mode; S.camBlendT = 0;
    sfx('tap');
  }
  // ドリルアタックのずらし（atkK）と、顔を見せる回りこみ（orbitK）
  function updateCamFactors(dt) {
    var me = S.me; if (!me) return;
    if (!S.paused) {
      if (me.act && me.act.name === 'drillAttack') S.atkHold = ATK_HOLD;
      else S.atkHold = Math.max(0, S.atkHold - dt);
      S.atkK += ((S.atkHold > 0 ? 1 : 0) - S.atkK) * (1 - Math.exp(-dt * (S.atkHold > 0 ? 7 : 2.5)));
      var h = S.held, still = S.camMode === 1 && !S.intro && !me.act && !me.air && !h.fwd && !h.back && !h.left && !h.right && Math.abs(me.moveV) < 0.05;
      // 右どなりに高い壁があり左が空いていれば、カメラを左うしろへ（壁の向こうから見ない）
      var fx = -Math.sin(me.heading), fz = -Math.cos(me.heading), rx = -fz, rz = fx, head = me.y + 0.9;
      var tall = function (sg) { var m = 0; for (var q = 0; q < 3; q++) { var bk = q * 0.9, x = me.wx + sg * rx * 0.85 - fx * bk, z = me.wz + sg * rz * 0.85 - fz * bk; m = Math.max(m, groundTopAt(x, z)); } return m > head; };
      var wantSide = tall(1) && !tall(-1) ? -1 : (tall(-1) && !tall(1) ? 1 : (S.sideK < 0 ? -1 : 1));
      S.sideK += (wantSide - S.sideK) * (1 - Math.exp(-dt * 4));
      if (Math.abs(me.moveV) > 0.3) S.moved = true; // 出発してすぐは回りこまない（行く先の目じるしを見せておく）
      S.idleT = still && S.moved ? S.idleT + dt : 0;
      if (S.faceHold > 0) S.faceHold = Math.max(0, S.faceHold - dt);
      var want = (S.faceHold > 0 || S.idleT > IDLE_ORBIT) ? 1 : 0;
      var rate = want ? (S.faceHold > 0 ? 2.6 : 1.1) : 10; // 第5期 4a：走り出したら すぐ（約0.3秒で）真うしろへ戻る
      S.orbitK += (want - S.orbitK) * (1 - Math.exp(-dt * rate));
      if (!want && S.orbitK < 0.002) S.orbitK = 0;
      var gw = S.camMode === 1 && gemCamOn() ? 1 : 0;
      S.gemCamK += (gw - S.gemCamK) * (1 - Math.exp(-dt * (gw ? 3.2 : 2.2)));
      if (!gw && S.gemCamK < 0.002) { S.gemCamK = 0; S.gemCam = null; }
    }
  }
  // カメラとシーカーの間で、シーカーを隠している積み木を薄く透かす
  var occWant = {};
  function updateOccluders(dt) {
    var L = S.level, me = S.me; if (!L || !L.fadeAttr) return;
    var k, want = occWant; for (k in want) delete want[k];
    if (me && (S.camMode === CAM_CHASE || S.camMode === CAM_WIDE) && !S.intro && me.root.visible) {
      var cp = S.camera.position, mcx = Math.floor(me.wx), mcz = Math.floor(me.wz);
      var sx = Math.cos(me.heading) * 0.35, sz = -Math.sin(me.heading) * 0.35; // シーカーの左右の幅
      var gcm = S.gemCam && S.gemCamK > 0.3 ? S.gemCam.tr : null; // 獲得の間は、浮き上がった宝石もさえぎらないように
      for (var r = 0; r < (gcm ? 6 : 5); r++) {
        var ty = me.y + (r === 0 ? 0.25 : r === 2 ? 1.05 : 0.65), ox = r === 3 ? sx : r === 4 ? -sx : 0, oz = r === 3 ? sz : r === 4 ? -sz : 0;
        var bx = me.wx + ox, bz = me.wz + oz;
        if (r === 5) { bx = gcm.group.position.x; bz = gcm.group.position.z; ty = gemPeak(gcm); }
        var dx = cp.x - bx, dy = cp.y - ty, dz = cp.z - bz, len = Math.hypot(dx, dy, dz);
        var n = Math.ceil(len / 0.15);
        for (var i = 1; i < n; i++) {
          var t = i / n, x = bx + dx * t, y = ty + dy * t, z = bz + dz * t;
          var cx = Math.floor(x), cz = Math.floor(z);
          if (!inMap(cx, cz) || (cx === mcx && cz === mcz)) continue;
          if (vis(S.heights[idx(cx, cz)]) > y) { var inst = L.cellToInst[idx(cx, cz)]; if (inst >= 0) want[inst] = 1; }
        }
      }
    }
    var arr = L.fadeAttr.array, fd = L.fading, changed = false, kk = 1 - Math.exp(-dt * 10);
    for (k in want) if (!(k in fd)) fd[k] = 0;
    for (k in fd) {
      var tgt = want[k] ? FADE_ON : 0, cur = fd[k], nv = cur + (tgt - cur) * kk;
      if (Math.abs(nv - tgt) < 0.02) nv = tgt;
      if (nv !== cur || arr[k] !== nv) { arr[k] = nv; changed = true; }
      if (nv === 0) delete fd[k]; else fd[k] = nv;
    }
    if (changed) L.fadeAttr.needsUpdate = true;
    var anyFade = false; for (k in fd) { anyFade = true; break; }
    if (L.ghosts) L.ghosts.forEach(function (gh) { gh.visible = anyFade; });
  }
  var shakeV = new THREE.Vector3();
  function fitNear() {
    var want = Math.max(0.05, (S.camera.position.y - 10) * 0.25);
    if (Math.abs(want - S.camera.near) > S.camera.near * 0.03 + 1e-4) { S.camera.near = want; S.camera.updateProjectionMatrix(); }
    // かすみ：おいかけ視点では遠くの積み木だけ空の色へ溶ける。上から見るときは地図全体がくっきり見えるよう遠ざける
    var fog = S.scene && S.scene.fog;
    if (fog) { fog.near = 26 + Math.max(0, S.camera.position.y) * 1.6; fog.far = fog.near + 70; }
  }
  function updateCamera(dt) {
    if (!S.camera) return;
    // 跳んだり潜ったりしても画面がゆれすぎないよう、高さはゆっくり追う（ジャンプドリル中は地面の高さ）
    if (S.me) {
      var me = S.me, wantY = me.act && me.act.name === 'jumpDrill' ? footInfo(me.wx, me.wz).y : me.y;
      S.camY += (wantY - S.camY) * (1 - Math.exp(-dt * 5));
    }
    S.chaseLift += (chaseLiftTarget() - S.chaseLift) * (1 - Math.exp(-dt * 5));
    S.pitchV += (S.pitch - S.pitchV) * (1 - Math.exp(-dt * 10));
    updateCamFactors(dt);
    var target = poseFor(S.camMode);
    var top = S.camMode === CAM_TOP || !!(S.intro && S.intro.t < INTRO_HOLD + 0.5);
    if (top !== S.topFlag) { S.topFlag = top; emit('cam', top, S.camMode); } // top＝そら（真上）か開始演出の真上
    if (S.intro) {
      if (!S.paused) S.intro.t += dt;
      if (S.intro.t >= INTRO_HOLD + INTRO_MOVE) S.intro = null;
    }
    if (S.intro) {
      var ov = poseFor(CAM_TOP), ie = ease(clamp((S.intro.t - INTRO_HOLD) / INTRO_MOVE, 0, 1));
      S.camera.position.lerpVectors(ov.p, target.p, ie);
      S.camera.position.y += Math.sin(ie * Math.PI) * 1.5;
      S.camera.quaternion.slerpQuaternions(ov.q, target.q, ie);
    } else if (S.camBlendT < 1) {
      S.camBlendT = Math.min(1, S.camBlendT + dt / CAM_BLEND);
      var e = ease(S.camBlendT);
      S.camera.position.lerpVectors(S.camFrom.p, target.p, e);
      S.camera.position.y += Math.sin(e * Math.PI) * 1.5;
      S.camera.quaternion.slerpQuaternions(S.camFrom.q, target.q, e);
    } else {
      S.camera.position.copy(target.p);
      S.camera.quaternion.copy(target.q);
    }
    if (S.shake > 0.001) {
      var a = S.shake;
      shakeV.set(rand(-a, a), rand(-a, a) * 0.7, rand(-a, a));
      if (S.camMode === CAM_TOP) shakeV.multiplyScalar(2.5); else if (S.camMode === CAM_WIDE) shakeV.multiplyScalar(1.6);
      S.camera.position.add(shakeV);
      S.shakeOff = shakeV;
      S.shake *= Math.exp(-dt * 6);
    } else { S.shake = 0; S.shakeOff = null; }
    fitNear();
    if (S.me) S.me.root.visible = !(S.camMode === CAM_EYE && S.camBlendT > 0.55);
    updateOccluders(dt);
    updateHints();
    var camH = S.camera.position.y;
    // 目じるし：自分＝金色の下向き三角、ほかの人＝白い丸。そら（俯瞰）では大きく、おいかけ・1人称では小さく
    var cp = S.camera.position;
    function mark(a) {
      if (!a) return;
      var sky = camH - a.y > 10, isMe = a === S.me, s, op;
      if (sky) { s = camH / 30 * 2.0; op = clamp((camH - a.y - 10) / 6, 0.6, 0.95); }
      else if (S.camMode === CAM_WIDE) { s = isMe ? 0.75 : 0.9; op = 0.9; } // みわたし：少し大きく
      else if (isMe) { s = 0.42; op = S.camMode === CAM_EYE ? 0 : 0.85 * (1 - clamp(Math.max(S.orbitK, S.gemCamK) * 1.5, 0, 1)); } // 顔を見せる回りこみ・宝石の獲得の間は消す
      else { s = clamp(Math.hypot(cp.x - a.wx, cp.z - a.wz) * 0.05, 0.45, 1.3); op = 0.9; }
      a.marker.visible = op > 0;
      if (!a.marker.visible) return;
      a.marker.scale.set(s, s, 1);
      a.marker.position.y = (sky ? 2.0 + s * 0.6 : 1.75 + s * 0.5) + Math.sin(S.time * 3) * 0.06 * s;
      a.mats.marker.opacity = op;
    }
    mark(S.me); mark(S.cpu);
    for (var k in S.remotes) mark(S.remotes[k]);
  }

  /* ===== W25. ループ（freeze・setPaused） ===== */
  function animName(a) {
    if (a.act) return a.act.name;
    if (a.air) return 'jump';
    return Math.abs(a.moveV) > 0.08 ? 'move' : (Math.abs(a.turnV) > 0.3 ? 'turn' : 'idle');
  }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function stateObj() {
    var a = S.me;
    return {
      x: Math.round((a.wx - 0.5) * 100) / 100, z: Math.round((a.wz - 0.5) * 100) / 100, y: r3(a.y), heading: r3(a.heading), dir: dir4(a.heading),
      anim: animName(a), flip: r3(a.flip), squash: r3(a.squash), hatForward: r3(a.hatF), spin: Math.round(a.spin * 100) / 100,
      color: a.color, palette: a.palette
    };
  }
  function update(dt) {
    if (!S.level) return;
    evQ = [];
    try { updateBody(dt); } finally { flushEvents(); }
  }
  function updateBody(dt) {
    S.time += dt;
    if (!S.frozen) {
      updateMe(dt);
      updateCpu(dt);
      updateRemotes(dt);
    } else {
      // 止まっている（カウントダウン・獲得宣言）：シーカー・CPU・相手の補間・入力・加速のタイマーは進めない。
      // 宝石の浮き上がり・破片・カメラ・描画は続ける
      if (S.me) settleActor(S.me, dt);
      if (S.cpu) settleActor(S.cpu, dt);
      for (var k in S.remotes) { settleActor(S.remotes[k], dt); animateActor(S.remotes[k], dt); }
      engine('idle', S.me ? S.me.stage : 0);
    }
    updateFx(dt);
    updateTreasures(dt);
    if (S.me) animateActor(S.me, dt);
    if (S.cpu) animateActor(S.cpu, dt);
    updateAim();
    S.stateAcc += dt;
    if (S.me && S.stateAcc >= 0.1) { S.stateAcc = 0; emit('state', stateObj()); }
  }
  function render() { if (S.renderer && S.scene) S.renderer.render(S.scene, S.camera); }
  function loop(now) {
    if (!S.running) return;
    S.raf = requestAnimationFrame(loop);
    var dt = S.last ? Math.min(0.05, Math.max(0, (now - S.last) / 1000)) : 0.016;
    S.last = now;
    try {
      if (!S.paused && !S.manual && S.level) update(dt);
      if (S.level) updateCamera(dt);
      render();
    } catch (e) {
      console.warn('World loop error', e);
    }
  }
  function start() {
    if (!S.inited) { if (S.container) init(S.container); else return; }
    if (S.running) return;
    S.running = true; S.last = 0;
    S.raf = requestAnimationFrame(loop);
  }
  function stop() {
    S.running = false;
    if (S.raf) cancelAnimationFrame(S.raf);
    S.raf = 0;
    engine('idle', 0);
    clearLevel();
    S.held = {}; S.tapQ = {}; S.paused = false; S.frozen = false;
    if (S.ro) { S.ro.disconnect(); S.ro = null; }
    if (S.onWinResize) { window.removeEventListener('resize', S.onWinResize); S.onWinResize = null; }
    if (S.renderer) {
      var fx = S.fx;
      if (fx) {
        fx.debris.geometry.dispose(); fx.debris.material.dispose();
        fx.puffs.forEach(function (p) { p.sp.material.dispose(); });
        fx.stars.forEach(function (p) { p.sp.material.dispose(); });
        fx.texts.forEach(function (p) { p.sp.material.dispose(); });
      }
      S.fx = null;
      var cv = S.renderer.domElement;
      S.renderer.dispose();
      try { S.renderer.forceContextLoss(); } catch (e) { }
      if (cv.parentNode) cv.parentNode.removeChild(cv);
    }
    S.renderer = null; S.scene = null; S.camera = null; S.inited = false;
  }
  // モーダル用：全部止める（演出も止める）
  function setPaused(b) {
    S.paused = !!b;
    if (S.paused) { S.held = {}; S.tapQ = {}; }
  }
  // 獲得宣言・カウントダウン用：シーカー・入力・加速のタイマーだけ止める（演出・カメラ・描画は続ける）。
  // 押したままのボタンは覚えておく（離したことは受ける）
  function freeze(b) {
    S.frozen = !!b;
    if (S.frozen) S.tapQ = {};
  }

  /* ===== W26. 公開（window.World） ===== */
  var World = {
    STEP_H: STEP_H,
    SPEED: SPEED,
    CPU_LEVELS: CPU_LEVELS,
    init: init,
    load: load,
    start: start,
    stop: stop,
    setPaused: setPaused,
    freeze: freeze,
    go: function () { freeze(false); },
    press: press,
    setCamera: setCamera,
    cycleCamera: function () { setCamera((S.camMode + 1) % CAM_N); return S.camMode; },
    // 視点の名前（UI のボタン用。番号 = World.camera）
    CAMERAS: ['め', 'おいかけ', 'みわたし', 'そら'],
    // スピードの倍率（opts.speed）
    SPEED_MUL: SPEED_MUL,
    on: function (ev, fn) {
      if (!handlers[ev] || typeof fn !== 'function') return;
      if (handlers[ev].indexOf(fn) < 0) handlers[ev].push(fn);
    },
    off: function (ev, fn) {
      if (!handlers[ev]) return;
      if (!fn) handlers[ev].length = 0; else { var i = handlers[ev].indexOf(fn); if (i >= 0) handlers[ev].splice(i, 1); }
    },
    // 加速の段（0〜5）
    speedStage: function () { return S.me ? S.me.stage : 0; },
    // 左右スワイプ：dx は画面の幅を1とした量（+で右）。向き（とカメラ）がなぞった分だけ回る
    swipeTurn: function (dx) {
      dx = +dx; if (!isFinite(dx) || S.paused || S.frozen || !S.me || S.over) return;
      S.me.heading -= clamp(dx, -2, 2) * SWIPE_GAIN;
      S.idleT = 0;
    },
    nudgePitch: function (dy) {
      dy = +dy; if (!isFinite(dy)) return;
      S.pitch = clamp(S.pitch + clamp(dy, -1, 1), -PITCH_MAX, PITCH_MAX);
      S.idleT = 0;
    },
    resetPitch: function () { S.pitch = 0; },
    // ソナー：自分から半径 radius マス以内の、まだだれの物でもない宝（dx,dz は世界座標の差、depth はそのマスの段数）
    sonar: function (radius) {
      radius = radius == null ? 10 : +radius;
      var me = S.me, out = { heading: me ? me.heading : 0, items: [] };
      if (!me || !S.level) return out;
      sonarRead(me.wx, me.wz, radius).forEach(function (r) {
        out.items.push({ dx: Math.round(r.dx * 100) / 100, dz: Math.round(r.dz * 100) / 100, dist: Math.round(r.dist * 100) / 100, depth: S.heights[idx(r.t.x, r.t.z)], i: r.t.i });
      });
      return out;
    },
    // 宝石の所有者を決める（UI が 'gemHit' を受けて呼ぶ。通信ではホストが決めて両方で呼ぶ）
    award: award,
    // 宝石の情報（UI の宣言文・結果の表示用。CPU は使わない）
    gemInfo: function (ti) {
      var t = S.treasures[ti | 0]; if (!t) return null;
      return { gem: t.gem, id: t.def.id, name: t.def.name, x: t.x, z: t.z, owner: t.owner };
    },
    scores: function () { return scoresView(); },
    // 宝の数と、のこり（UI の表示用）
    treasureInfo: function () { var n = S.treasures.length, left = S.treasures.filter(function (t) { return t.owner < 0; }).length; return { total: n, left: left, mode: S.mode }; },
    finish: function () { S.over = true; S.held = {}; S.tapQ = {}; engine('idle', 0); return scoresView(); },
    get isOver() { return S.over; },
    applyRemoteState: function (i, s) {
      if (!S.level || !s || i === S.myIndex) return;
      ensureRemote(i, s, false);
    },
    // 相手が変えた地形を再現（cells: [[x,z,h],...]）。イベントは出さない（gemHit も出さない）
    applyRemoteTerrain: function (cells) {
      if (!S.level || !Array.isArray(cells)) return;
      setCells(cells, true);
    },
    // 互換（第3期の名前）：award と同じ
    applyRemoteCollect: function (i, ti) { return award(i, ti); },
    dropRemote: function (i) {
      var r = S.remotes[i]; if (!r) return;
      disposeActor(r); delete S.remotes[i];
    },
    // 互換（第2期の名前）
    remoteFound: function (i) { var k = S.treasures.findIndex(function (t) { return t.owner < 0; }); if (k >= 0) award(i, k); },
    applyRemoteBoom: function (cells) { if (!Array.isArray(cells)) return; World.applyRemoteTerrain(cells.map(function (c) { return [c[0], c[1], 0]; })); },
    // ---- 確認用（ゲームの進行には使わない） ----
    // n コマ分を すぐに進める（描画は待たない）
    _step: function (n, dt) {
      if (!S.level || S.paused) return;
      for (var k = 0; k < (n | 0); k++) { if (!S.level) break; update(dt || 1 / 30); if (S.level) updateCamera(dt || 1 / 30); }
    },
    _plan: function (cell) { return S.cpu ? planPath(S.cpu, { kind: 'dig', cell: cell }) : null; },
    _cpu: function () {
      var c = S.cpu; if (!c) return null; var ai = c.ai, W = S.w;
      return { level: ai.level, time: ai.time, est: ai.est >= 0 ? [ai.est % W, (ai.est / W) | 0] : null, conf: ai.conf, reads: ai.reads, misses: ai.misses, mistakes: ai.mistakes,
        goal: ai.goal ? { kind: ai.goal.kind, x: ai.goal.cell % W, z: (ai.goal.cell / W) | 0 } : null, hold: ai.hold ? ai.hold.kind : null, hits: ai.hitLog.slice(),
        steps: ai.steps, jumps: ai.jumps, attacks: ai.attacks, digs: ai.digs, replans: ai.replans, stage: c.stage, speed: c.speed };
    },
    // 確認用：CPU がいま受け取るソナーの読み取り（key＝宝の番号、dist＝円の中だけ）
    _cpuSense: function () { return S.cpu ? cpuSense(S.cpu).map(function (r) { return { key: r.key, dist: r.dist != null, ang: r.ang != null }; }) : null; },
    _engine: function () { return engineLast; },
    _hintInfo: function () {
      var H = S.hints, me = S.me; if (!H || !me) return [];
      S.camera.updateMatrixWorld(true);
      return S.treasures.map(function (tr, k) {
        var b = k * HINT_K, A = H.alpha.array, P = H.pos.array, on = false, best = null;
        for (var j = 0; j < HINT_K; j++) {
          if (A[b + j] <= 0) continue; on = true;
          var v = new THREE.Vector3(P[(b + j) * 3], P[(b + j) * 3 + 1], P[(b + j) * 3 + 2]).project(S.camera);
          var inS = v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
          if (inS && (!best || P[(b + j) * 3 + 1] > best.y)) best = { x: v.x, y: P[(b + j) * 3 + 1], sy: v.y };
        }
        return { i: k, on: on, onScreen: !!best, ndc: best ? [Math.round(best.x * 100) / 100, Math.round(best.sy * 100) / 100] : null, dist: Math.round(Math.hypot(tr.x + 0.5 - me.wx, tr.z + 0.5 - me.wz) * 10) / 10, minPx: H.mat.uniforms.uMinPx.value };
      });
    },
    _fading: function () { return S.level && S.level.fading ? Object.keys(S.level.fading).length : 0; },
    // 確認用：いまのカメラで、宝石（ti）とシーカーの頭・足がステージ（16:9）のどこに映るか（左上=0%、右下=100%）
    _stagePos: function (ti) {
      if (!S.camera || !S.me) return null;
      var c = new THREE.PerspectiveCamera(S.camera.fov, STAGE_ASPECT, S.camera.near, S.camera.far);
      c.position.copy(S.camera.position); c.quaternion.copy(S.camera.quaternion); c.updateMatrixWorld();
      function sp(x, y, z) { var v = new THREE.Vector3(x, y, z).project(c); return [Math.round((v.x + 1) * 500) / 10, Math.round((1 - v.y) * 500) / 10]; }
      var tr = S.treasures[ti | 0], me = S.me, out = { head: sp(me.wx, me.y + 1.6, me.wz), feet: sp(me.wx, me.y + 0.05, me.wz), gemCam: S.gemCam ? S.gemCamWhy : false, gemCamK: Math.round(S.gemCamK * 100) / 100 };
      if (tr) out.gem = sp(tr.group.position.x + tr.mesh.position.x, tr.group.position.y + tr.mesh.position.y, tr.group.position.z + tr.mesh.position.z);
      return out;
    },
    _cam: function () { return { orbit: S.orbitK, atk: S.atkK, idle: S.idleT, face: S.faceHold, side: S.sideK }; },
    // 確認用（4a）：自分のシーカーの向き（ラジアン、atan2(x, z) の形で比べられるよう水平の単位ベクトル）
    //   heading＝ゲームの前、model＝3Dモデルの前（+Z を世界へ）、cam＝カメラの見る向き（水平）
    _orient: function () {
      var me = S.me; if (!me || !S.camera) return null;
      me.root.updateMatrixWorld(true);
      var mf = new THREE.Vector3(0, 0, 1).transformDirection(me.model.root.matrixWorld);
      var cf = new THREE.Vector3(0, 0, -1).applyQuaternion(S.camera.quaternion);
      function hz(v) { var l = Math.hypot(v.x, v.z) || 1; return [v.x / l, v.z / l]; }
      return { x: me.wx, z: me.wz, heading: [-Math.sin(me.heading), -Math.cos(me.heading)], model: hz(mf), cam: hz(cf), camPos: [S.camera.position.x, S.camera.position.y, S.camera.position.z], orbit: S.orbitK, vis: me.root.visible };
    },
    // 自分のシーカーのいちばん低い点（ドリルの先）の高さと、いまいるマスの上面
    _meLow: function () {
      var me = S.me; if (!me) return null;
      me.root.updateMatrixWorld(true);
      var b = new THREE.Box3().setFromObject(me.model.root);
      var A = me.act, tx = A && A.tx != null ? A.tx : Math.floor(me.wx), tz = A && A.tz != null ? A.tz : Math.floor(me.wz);
      return { low: b.min.y, top: vis(hAt(tx, tz)), y: me.y, tip: me.tip };
    },
    _manual: function (b) { S.manual = !!b; }, // 描画ループでは進めない（_step だけで進める）
    _setPose: function (x, z, heading) {
      var me = S.me; if (!me) return;
      me.wx = x; me.wz = z; if (heading != null) me.heading = heading; me.act = null; me.air = false; me.vy = 0; me.flip = 0; me.hatF = 0;
      var f = footInfo(me.wx, me.wz); me.y = f.y; me.lv = f.lv; S.camY = me.y; accelReset(me);
    },
    _setCpuPose: function (x, z, heading) {
      var c = S.cpu; if (!c) return;
      c.wx = x; c.wz = z; if (heading != null) c.heading = heading; c.act = null; c.air = false; c.vy = 0;
      var f = footInfo(c.wx, c.wz); c.y = f.y; c.lv = f.lv;
    },
    _debug: function (qx, qz) {
      var me = S.me, c = S.cpu;
      function A(a) { return a ? { x: a.wx, z: a.wz, cx: Math.floor(a.wx), cz: Math.floor(a.wz), y: a.y, lv: a.lv, heading: a.heading, dir: dir4(a.heading), air: a.air, act: a.act ? a.act.name + ':' + (a.act.phase || '') : null, flip: a.flip, squash: a.squash, hatF: a.hatF, tip: a.tip, stage: a.stage, cycles: a.act && a.act.cycles } : null; }
      return {
        cam: S.camMode, blend: S.camBlendT, intro: S.intro ? S.intro.t : -1, paused: S.paused, frozen: S.frozen, running: S.running, time: S.time,
        me: A(me), mode: S.mode, search: S.search, over: S.over, scores: scoresView(), mapVer: S.mapVer, pitch: S.pitch,
        cpu: c ? A(c) : null,
        treasures: S.treasures.map(function (t) { return { x: t.x, z: t.z, gem: t.gem, h: S.heights[idx(t.x, t.z)], owner: t.owner, anim: t.anim ? Math.round(t.anim.t * 100) / 100 : -1, shown: t.mesh.visible, beam: t.beam.visible }; }),
        remotes: Object.keys(S.remotes).map(function (k) { var r = S.remotes[k]; return { i: +k, x: r.wx, z: r.wz, y: r.y, heading: r.heading, flip: r.flip }; }),
        h: qx != null && S.level ? hAt(qx, qz) : null,
        debris: S.fx ? S.fx.parts.length : 0,
        hasSeekerModel: !!(me && !me.model._own),
        markers: [me, c].concat(Object.keys(S.remotes).map(function (k) { return S.remotes[k]; })).filter(Boolean).map(function (a) { return { idx: a.idx, vis: a.marker.visible, me: a === me }; }),
        calls: S.renderer ? S.renderer.info.render.calls : 0,
        tris: S.renderer ? S.renderer.info.render.triangles : 0
      };
    }
  };
  Object.defineProperty(World, 'isPaused', { get: function () { return S.paused; }, enumerable: true });
  Object.defineProperty(World, 'isFrozen', { get: function () { return S.frozen; }, enumerable: true });
  Object.defineProperty(World, 'camera', { get: function () { return S.camMode; }, enumerable: true });
  window.World = World;
})();
