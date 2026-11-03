/* world.js — 3Dの世界（地形・シーカー・操作・カメラ・掘る演出・宝・CPU）
   「見つけて！PixSee」第3期。公開するのは window.World だけ。THREE は r128 のグローバルを使う。
   シーカーの3Dモデルは seeker.js の window.SeekerModel（無いときは箱で代用して止まらない）。 */
(function () {
  'use strict';

  // 見た目の高さ：1段 = STEP_H。高さ0と1は「紙に塗った色」（平ら）、2〜10が積み木。壁（10）は 9段 = 1.8 の高さ（約2マス分）。
  var STEP_H = 0.2;
  function vis(h) { return h <= 1 ? 0 : (h - 1) * STEP_H; }
  var FLOOR_SAT = 1.9; // 床の色の鮮やかさ（1で元の色）
  var DX = [0, 1, 0, -1];
  var DZ = [-1, 0, 1, 0];

  // ---- 動き（単位：マス・秒）----
  var SPEED = 2.4;        // 「すすむ」の速さ（マス/秒）
  var AIR_SPEED = 2.4;    // 空中で前へ進む速さ（CPUがゆっくりでも、前方ジャンプは届くように）
  var KEY_TURN = 2.6;     // ひだり・みぎ（キーボード）で回る速さ（ラジアン/秒）
  var SWIPE_GAIN = Math.PI; // 画面の幅いっぱいスワイプすると半回転
  var RAD = 0.3;          // 当たりの大きさ（中心から四角の半分）。1マスの通路を通れる
  var GRAV = 22;          // ジャンプの重さ（見た目の高さ/秒²）
  var JUMP_UP = 5;        // ジャンプで乗れる段数
  var JUMP_EXTRA = 0.08;  // 頂点は 足元+5段 の見た目より少し上
  var CROUCH = 0.13;      // 跳ぶ前に凹む時間
  var DA = { wind: 0.2, hit: 0.3, end: 0.62 };  // ドリルアタック：構える→当たる→もどる
  var BORE_IN = 0.3;      // ドリルジャンプで掘るとき、ドリルの先がマスの上面より下へ入る深さ
  var DJ = { g: 14, rise: 0.95, flip: 0.42, hang: 0.22, bore: 0.55, popVy: 4.4, unflip: 0.45 }; // ドリルジャンプ
  // CPU：速さ（マス/秒）・回る速さ・動作のあとの間（秒）・まよう割合
  var CPU_LV = {
    easy: { speed: 0.9, turn: 2.4, pause: 0.6, doubt: 0.12 },
    normal: { speed: 1.6, turn: 4.2, pause: 0.25, doubt: 0.03 },
    hard: { speed: 2.4, turn: 7.5, pause: 0.06, doubt: 0 }
  };
  var CPU_WAIT0 = 0.4;   // 開始演出のあと、CPUが動き出すまでの間
  var NL = 11;           // 道さがしの段の数（0〜10）
  var PITCH_MAX = 1;     // 視点の上下（-1〜+1）
  var INTRO_HOLD = 2.0, INTRO_MOVE = 1.8; // 開始演出：真上から2秒見せて、斜め後ろへ寄せる
  var CAM_BLEND = 0.9;
  var DEBRIS_MAX = 600, PUFF_MAX = 64;
  var GEM_R = 0.42, GEM_Y = 0.95; // 宝石の大きさと高さ
  var GEM_FLY = 0.85;             // 拾った宝石がシーカーへ飛ぶ時間（UI は拾ってから約1.6秒で結果へ）
  var SOIL = [0.851, 0.725, 0.549]; // 土の山の色 #d9b98c（淡いクレヨンの茶色）
  var SOIL_BLOCK = [0.76, 0.56, 0.36]; // 積み木として塗る色（紙の白とクレヨンの質感が重なると #d9b98c くらいに見える）
  var SOIL_DUG = [196, 162, 116];   // 掘ったあとの地面の色

  // ---------- 小さな道具 ----------
  function sfx(name) { try { if (window.Sfx && window.Sfx.play) window.Sfx.play(name); } catch (e) { /* 音が無くても続ける */ } }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function angLerp(a, b, t) { var d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }
  function dirToHeading(d) { return -d * Math.PI / 2; }

  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // ---------- 共通テクスチャ（init で1回だけ作る） ----------
  var T = null;
  function buildSharedTextures() {
    T = {};
    // クレヨンで塗った紙のざらざら（白地に薄い灰色のすじ）
    var c = makeCanvas(128, 128), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
    for (var i = 0; i < 520; i++) {
      var x = Math.random() * 128, y = Math.random() * 128, l = rand(6, 22), a = rand(-0.9, -0.5);
      var v = Math.floor(rand(205, 245));
      g.strokeStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + rand(0.25, 0.6).toFixed(2) + ')';
      g.lineWidth = rand(0.6, 2.2);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    for (i = 0; i < 1600; i++) {
      var v2 = Math.floor(rand(190, 255));
      g.fillStyle = 'rgba(' + v2 + ',' + v2 + ',' + v2 + ',0.35)';
      g.fillRect(Math.random() * 128, Math.random() * 128, 1, 1);
    }
    T.crayonCanvas = c;
    T.crayon = new THREE.CanvasTexture(c);
    T.crayon.wrapS = T.crayon.wrapT = THREE.RepeatWrapping;
    T.crayon.anisotropy = 4;
    T.detail = buildDetailTexture();

    // ぼかした丸（影・煙・光）
    c = makeCanvas(64, 64); g = c.getContext('2d');
    var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    T.soft = new THREE.CanvasTexture(c);

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

    // 空（上は水色、下は白っぽい）
    c = makeCanvas(4, 256); g = c.getContext('2d');
    gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#5fb8f0'); gr.addColorStop(0.6, '#bfe6fb'); gr.addColorStop(1, '#f4fbff');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    T.sky = new THREE.CanvasTexture(c);

    // 机（地図の外側）
    c = makeCanvas(128, 128); g = c.getContext('2d');
    g.fillStyle = '#e9d2a8'; g.fillRect(0, 0, 128, 128);
    for (i = 0; i < 60; i++) {
      g.strokeStyle = 'rgba(160,110,60,' + rand(0.08, 0.2).toFixed(2) + ')'; g.lineWidth = rand(1, 3);
      var yy = Math.random() * 128; g.beginPath(); g.moveTo(0, yy); g.bezierCurveTo(40, yy + rand(-4, 4), 90, yy + rand(-4, 4), 128, yy); g.stroke();
    }
    T.desk = new THREE.CanvasTexture(c);
    T.desk.wrapS = T.desk.wrapT = THREE.RepeatWrapping;
  }

  // ---------- 紙とクレヨンの質感（第2期 r2） ----------
  // 起動時に1回だけ作る 256×256 のくり返し模様。色ではなく「明るさの手がかり」を3つのチャンネルに入れる：
  //   R = 紙のざらつきと繊維（細かい）、G = クレヨンの塗りの筋（高い所＝ろうがのっている、低い所＝紙の目が見える）、
  //   B = 大きなむら（ゆっくり変わる）。床と積み木のシェーダーで、地図の色に掛けあわせて使う（地図の色そのものは変えない）。
  function buildDetailTexture() {
    var N = 256;
    function tiled(g, x, y, r, fn) { // 端をまたぐ形は反対側にも描く（つなぎ目が見えないように）
      for (var ox = -N; ox <= N; ox += N) for (var oy = -N; oy <= N; oy += N) {
        if (x + ox + r < 0 || x + ox - r > N || y + oy + r < 0 || y + oy - r > N) continue;
        g.save(); g.translate(ox, oy); fn(); g.restore();
      }
    }
    function layer(bg, draw) { var c = makeCanvas(N, N), g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, N, N); draw(g); return g.getImageData(0, 0, N, N).data; }
    // R：紙の繊維
    var R = layer('rgb(150,150,150)', function (g) {
      g.lineCap = 'round';
      for (var i = 0; i < 900; i++) {
        var x = Math.random() * N, y = Math.random() * N, l = rand(3, 14), a = Math.random() * Math.PI * 2, bend = rand(-4, 4);
        var light = Math.random() < 0.55;
        g.strokeStyle = light ? 'rgba(255,255,255,' + rand(0.2, 0.45).toFixed(2) + ')' : 'rgba(40,40,40,' + rand(0.12, 0.3).toFixed(2) + ')';
        g.lineWidth = rand(0.5, 1.3);
        tiled(g, x, y, l + 4, function () {
          g.beginPath(); g.moveTo(x, y);
          g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 - Math.sin(a) * bend, y + Math.sin(a) * l * 0.5 + Math.cos(a) * bend, x + Math.cos(a) * l, y + Math.sin(a) * l);
          g.stroke();
        });
      }
    });
    // G：クレヨンでなぞった筋（ななめの平行線のまとまり。ところどころ かすれる）
    var G = layer('rgb(150,150,150)', function (g) {
      for (var k = 0; k < 80; k++) {
        var cx = Math.random() * N, cy = Math.random() * N, ang = -0.62 + rand(-0.3, 0.3), len = rand(30, 90), n = Math.floor(rand(4, 10)), gap = rand(2.5, 4.5);
        var ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux;
        for (var s = 0; s < n; s++) {
          var off = (s - n / 2) * gap, sx = cx + vx * off - ux * len / 2, sy = cy + vy * off - uy * len / 2, l2 = len * rand(0.7, 1.05);
          var bright = Math.random() < 0.8;
          for (var t = 0; t < l2; t += 1.8) {
            if (Math.random() < 0.22) continue; // かすれ
            var px = sx + ux * t + rand(-0.6, 0.6), py = sy + uy * t + rand(-0.6, 0.6), sz = rand(2, 3.6);
            g.fillStyle = bright ? 'rgba(255,255,255,' + rand(0.25, 0.55).toFixed(2) + ')' : 'rgba(60,60,60,' + rand(0.2, 0.4).toFixed(2) + ')';
            tiled(g, px, py, 3, function () { g.fillRect(px, py, sz, sz * 0.7); });
          }
        }
      }
      // 紙の目（ろうがのらない小さな穴）
      for (var i = 0; i < 1700; i++) { g.fillStyle = 'rgba(0,0,0,' + rand(0.15, 0.45).toFixed(2) + ')'; g.fillRect(Math.random() * N, Math.random() * N, rand(0.8, 1.8), rand(0.8, 1.4)); }
    });
    // B：大きなむら
    var B = layer('rgb(128,128,128)', function (g) {
      for (var i = 0; i < 46; i++) {
        var x = Math.random() * N, y = Math.random() * N, r = rand(18, 70);
        var gr = g.createRadialGradient(x, y, 0, x, y, r), col = Math.random() < 0.5 ? '255,255,255' : '0,0,0';
        gr.addColorStop(0, 'rgba(' + col + ',' + rand(0.15, 0.3).toFixed(2) + ')'); gr.addColorStop(1, 'rgba(' + col + ',0)');
        g.fillStyle = gr;
        tiled(g, x, y, r, function () { g.fillRect(x - r, y - r, r * 2, r * 2); });
      }
    });
    var c = makeCanvas(N, N), cg = c.getContext('2d'), img = cg.createImageData(N, N), d = img.data;
    for (var p = 0; p < N * N * 4; p += 4) {
      d[p] = clamp(R[p] + rand(-26, 26), 0, 255);
      d[p + 1] = G[p];
      d[p + 2] = B[p];
      d[p + 3] = 255;
    }
    cg.putImageData(img, 0, 0);
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  }

  // 床：地図の色 × 紙のざらつき × 白いクレヨンの筋 × 温かい白（画用紙の色）。明かりで白がとばないよう少しおさえる
  var FLOOR_FRAG = [
    '{',
    '  vec2 fu = vUv * uRep;',
    '  vec3 dt = texture2D(uDetail, fu).rgb;',
    '  float mott = texture2D(uDetail, fu * 0.093 + vec2(0.31, 0.67)).b;',
    '  float paper = 0.94 + 0.06 * dt.r;',
    '  float wax = 1.0 - 0.07 * smoothstep(0.5, 0.95, dt.g);',
    '  diffuseColor.rgb *= paper * wax * (0.96 + 0.06 * mott) * vec3(0.8, 0.778, 0.74);',
    '}'
  ].join('\n');
  // 積み木：クレヨンで塗りつぶした面（筋とすき間から紙が少し見える）、上面と側面の明暗、出っぱったふちの柔らかいハイライト、足元のかげ
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
    '  vec2 tc = isTop > 0.5 ? vWP.xz : (abs(vNl.x) > 0.5 ? vWP.zy : vWP.xy);',
    '  vec3 dt = texture2D(uDetail, tc * 0.34, 0.7).rgb;',
    // 辺の印（1=北 2=東 4=南 8=西）
    '  float e = vEdge;',
    '  float bN = mod(e, 2.0); e = floor(e / 2.0);',
    '  float bE = mod(e, 2.0); e = floor(e / 2.0);',
    '  float bS = mod(e, 2.0); e = floor(e / 2.0);',
    '  float bW = mod(e, 2.0);',
    // となりと接している（見えないはずの）側面は、上面と同じ明るさにする。
    // となりの積み木との境目のすき間から内側の側面が見えて、壁の上に細い縦すじが出ていたため
    '  float sideOpen = vNl.x > 0.5 ? bE : (vNl.x < -0.5 ? bW : (vNl.z < -0.5 ? bN : bS));',
    '  float hidden = (1.0 - isTop) * (1.0 - sideOpen);',
    // （明かりは頂点ごとに計算されるので、上面との日ざしの差も おおよそ埋める：環境光0.88＋日ざし0.5）
    '  if (hidden > 0.5) diffuseColor.rgb *= 1.29 / ((abs(vNl.x) > 0.5 ? 0.62 : 0.72) * (0.88 + 0.5 * max(dot(vNl, vec3(-0.455, 0.827, -0.331)), 0.0)));',
    '  float mott = texture2D(uDetail, tc * 0.11 + vec2(0.5, 0.2)).b;',
    '  float shade = (isTop > 0.5 || hidden > 0.5) ? 1.0 : (abs(vNl.x) > 0.5 ? 0.62 : 0.72);',
    '  vec3 paperC = vec3(0.86, 0.84, 0.8) * shade;',
    '  float cov = mix(0.74, 1.0, smoothstep(0.22, 0.8, dt.g)) * mix(0.94, 1.0, mott);',
    '  diffuseColor.rgb = mix(paperC, diffuseColor.rgb, cov);',
    '  diffuseColor.rgb *= 0.93 + 0.1 * dt.r;',
    '  float rim = 0.0;',
    '  if (isTop > 0.5) {',
    '    float lx = vWP.x - vCell.x, lz = vWP.z - vCell.z;',
    '    rim = max(max(bN * (1.0 - smoothstep(0.0, 0.15, lz)), bS * (1.0 - smoothstep(0.0, 0.15, 1.0 - lz))),',
    '              max(bW * (1.0 - smoothstep(0.0, 0.15, lx)), bE * (1.0 - smoothstep(0.0, 0.15, 1.0 - lx))));',
    '  } else if (hidden < 0.5) {',
    '    rim = (1.0 - smoothstep(0.0, 0.09, vCell.y - vWP.y)) * 0.55;',
    '    diffuseColor.rgb *= mix(0.7, 1.0, smoothstep(0.0, 0.4, vWP.y));',
    '  }',
    '  rim *= 0.5 + 0.5 * smoothstep(0.2, 0.8, dt.g);',
    '  diffuseColor.rgb += rim * 0.2 * vec3(1.0, 0.97, 0.9);',
    '}'
  ].join('\n');
  // カメラとシーカーの間にある積み木を、網目に抜いて薄く透かす（aFade 0..1。並べ替え不要で描画命令も増えない）
  var BLOCK_DITHER = [
    'if (vFade > 0.01) {',
    '  float bx = mod(floor(gl_FragCoord.x), 2.0), by = mod(floor(gl_FragCoord.y), 2.0);',
    '  if (vFade > (2.0 * bx + 3.0 * by - 4.0 * bx * by) / 4.0 + 0.125) discard;',
    '}'
  ].join('\n');
  // MeshLambertMaterial にクレヨンの質感を足す（描画命令の数は変わらない）
  function crayonize(mat, mode, rep) {
    var uDetail = { value: T.detail }, uRep = { value: rep || new THREE.Vector2(1, 1) };
    mat.userData.uRep = uRep;
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uDetail = uDetail; sh.uniforms.uRep = uRep;
      if (mode === 'floor') {
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nuniform vec2 uRep;')
          .replace('#include <map_fragment>', '#include <map_fragment>\n' + FLOOR_FRAG);
      } else {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aEdge;\nattribute float aFade;\nvarying float vFade;\nvarying vec3 vWP;\nvarying vec3 vNl;\nvarying float vEdge;\nvarying vec3 vCell;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + BLOCK_VERT);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nvarying float vFade;\nvarying vec3 vWP;\nvarying vec3 vNl;\nvarying float vEdge;\nvarying vec3 vCell;')
          .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + BLOCK_DITHER)
          .replace('#include <color_fragment>', '#include <color_fragment>\n' + BLOCK_FRAG);
      }
    };
    mat.customProgramCacheKey = function () { return 'seecar-crayon-' + mode; };
    return mat;
  }

  function wrapAng(d) { while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
  function easeOutBack(t) { var c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  function dir4(heading) { return ((Math.round(-heading / (Math.PI / 2)) % 4) + 4) % 4; }

  // ---------- 文字の演出（ゴゴゴッ など。争いの言葉は使わない） ----------
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

  // ---------- シーカー ----------
  var G = null; // 共有の形
  function buildGeo() {
    G = {
      shadow: new THREE.PlaneGeometry(0.95, 0.95),
      glow: new THREE.PlaneGeometry(1.02, 1.02),
      marker: new THREE.ConeGeometry(0.5, 0.9, 16)
    };
    G.shadow.rotateX(-Math.PI / 2);
    G.glow.rotateX(-Math.PI / 2);
    G.marker.rotateX(Math.PI); // 下向きの矢印
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
  function createModel(color) {
    var m = null;
    try { if (window.SeekerModel && typeof window.SeekerModel.create === 'function') m = window.SeekerModel.create({ color: color }); }
    catch (e) { console.warn('SeekerModel.create failed', e); m = null; }
    if (!m || !m.root) m = boxModel(color);
    if (typeof m.update !== 'function') m.update = function () { };
    return m;
  }
  // 逆さ（flip=1）のとき、ドリルの先が足元（root の y=0）よりどれだけ下に出るか
  // （SeekerModel.tipDepth は「回転の軸（flipPivot）から先まで」の長さなので、軸の高さを引く。
  //   第3期 r1 までは引いていなかったため、掘っている間ドリルの先がマスの上に約0.55浮いていた）
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
  function makeActor(idx, color, st) {
    var model = createModel(color);
    var tip = computeTip(model);
    var root = new THREE.Group();
    model.root.rotation.y = Math.PI; // モデルの前は +Z、ゲームの前（heading=0）は北（-Z）
    root.add(model.root);
    var col = new THREE.Color(color || '#e08524');
    var mats = {
      shadow: new THREE.MeshBasicMaterial({ map: T.soft, color: 0x000000, transparent: true, opacity: 0.36, depthWrite: false }),
      glow: new THREE.MeshBasicMaterial({ map: T.soft, color: col, transparent: true, opacity: 0.4, depthWrite: false }),
      marker: new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, depthTest: false })
    };
    var shadow = new THREE.Mesh(G.shadow, mats.shadow); shadow.renderOrder = 1; root.add(shadow);
    var glow = new THREE.Mesh(G.glow, mats.glow); glow.renderOrder = 2; root.add(glow);
    var marker = new THREE.Mesh(G.marker, mats.marker); marker.renderOrder = 10; marker.visible = false; root.add(marker);
    var a = {
      idx: idx, model: model, root: root, mats: mats, shadow: shadow, glow: glow, marker: marker, tip: tip, color: color,
      wx: (st.x | 0) + 0.5, wz: (st.z | 0) + 0.5, y: 0, vy: 0, lv: 0, air: false,
      heading: dirToHeading(((st.dir | 0) % 4 + 4) % 4),
      act: null, squash: 0, sqRate: 10, flip: 0, hatF: 0, spin: 0.15, lunge: 0, moveV: 0, turnV: 0,
      blinkT: rand(1.5, 4), hop: 0, bumpCd: 0, speed: SPEED, shakeV: 0
    };
    var f = footInfo(a.wx, a.wz); a.y = f.y; a.lv = f.lv;
    return a;
  }
  function disposeActor(a) {
    if (!a) return;
    if (a.root.parent) a.root.parent.remove(a.root);
    for (var k in a.mats) a.mats[k].dispose();
    if (a.model._own) a.model._own.forEach(function (o) { try { o.dispose(); } catch (e) { } });
  }
  function recolorActor(a, color) {
    if (!color || color === a.color) return;
    a.color = color;
    try { if (a.model.setColor) a.model.setColor(color); } catch (e) { }
    a.mats.glow.color.set(color); a.mats.marker.color.set(color);
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
    try {
      a.model.update(dt, { move: clamp(a.moveV, -1, 1), turn: a.turnV, spin: a.spin, squash: clamp(a.squash, 0, 1), flip: clamp(a.flip, 0, 1), hatForward: clamp(a.hatF, 0, 1) });
    } catch (e) { if (!a._warned) { a._warned = true; console.warn('SeekerModel.update failed', e); } }
  }

  // ---------- 状態 ----------
  var S = {
    inited: false, container: null, renderer: null, scene: null, camera: null, ro: null, onWinResize: null,
    raf: 0, running: false, paused: false, last: 0, time: 0,
    map: null, w: 0, h: 0, heights: null, colors: null, dug: null, buried: null,
    level: null, // 地図ごとに作った物
    myIndex: 0, players: [], net: false, mode: 'solo',
    me: null, cpu: null, remotes: {}, held: {}, tapQ: {},
    camMode: 1, camBlendT: 1, camFrom: null, chaseLift: 0, camY: 0, intro: null, topFlag: null,
    shake: 0, stateAcc: 0, over: false, treasures: [], scores: [0, 0],
    fx: null, mapVer: 0, pitch: 0, pitchV: 0, aim: null, swipeV: 0,
    sideK: 1, orbitK: 0, idleT: 0, faceHold: 0, atkK: 0, atkHold: 0, hints: null, moved: false
  };
  var handlers = { found: [], collect: [], terrain: [], state: [], action: [], cam: [], done: [] };
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

  // ---------- 初期化 ----------
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
    S.scene = sc;
    S.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 400);
    S.camera.position.set(0, 10, 10);

    // 明かり：やわらかい環境光＋左上からの日ざし（色をつけない：壁は黒く、紙は白く見せる）
    sc.add(new THREE.HemisphereLight(0xffffff, 0xf0f0f2, 0.88));
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
    S.camera.aspect = w / h;
    S.camera.updateProjectionMatrix();
  }

  // ---------- 演出の部品（土のかけら・土ぼこり・きらきら・文字） ----------
  function buildFx() {
    var fx = {};
    var dg = new THREE.BoxGeometry(1, 1, 1);
    var dm = new THREE.MeshLambertMaterial({ map: T.crayon });
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

  // ---------- 地図 ----------
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
    if (S.gemLight) S.gemLight.intensity = 0;
  }

  // 土の山（mapgen が buried を付けていないときの代わり）：宝を中心に3×3を高さ3に
  function makeMound(tx, tz) {
    for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
      var x = tx + dx, z = tz + dz; if (!inMap(x, z)) continue;
      var i = idx(x, z);
      if (S.heights[i] < 3) {
        S.heights[i] = 3; S.buried[i] = 1;
        S.colors[i * 3] = Math.round(SOIL[0] * 255); S.colors[i * 3 + 1] = Math.round(SOIL[1] * 255); S.colors[i * 3 + 2] = Math.round(SOIL[2] * 255);
      } else if (dx === 0 && dz === 0) S.buried[i] = 1;
    }
  }

  function load(map, opts) {
    if (!S.inited) { if (S.container) init(S.container); else throw new Error('World.init を先に呼んでください'); }
    clearLevel();
    opts = opts || {};
    S.map = map; S.w = map.w; S.h = map.h;
    var N = S.w * S.h;
    S.heights = new Uint8Array(map.heights); // 自分用の写し（掘ると書きかえる）
    S.colors = new Uint8Array(map.colors);
    S.dug = new Uint8Array(N);
    var list = (map.treasures && map.treasures.length) ? map.treasures : (map.treasure ? [map.treasure] : []);
    list = list.filter(function (t) { return t && inMap(t.x | 0, t.z | 0); });
    if (map.buried && map.buried.length === N) S.buried = new Uint8Array(map.buried);
    else { S.buried = new Uint8Array(N); list.forEach(function (t) { makeMound(t.x | 0, t.z | 0); }); }
    S.myIndex = opts.myIndex || 0;
    S.players = opts.players || [{ color: '#e08524' }, { color: '#2f8be0' }];
    S.net = !!opts.net;
    var cpuOpt = opts.cpu && !S.net ? opts.cpu : null;
    S.mode = (opts.mode === 'race' || opts.mode === 'count' || opts.mode === 'solo') ? opts.mode : (list.length > 1 ? 'count' : (cpuOpt || S.net ? 'race' : 'solo'));
    S.over = false; S.held = {}; S.tapQ = {}; S.stateAcc = 0; S.shake = 0; S.mapVer = 0; S.scores = [0, 0];
    S.pitch = 0; S.pitchV = 0;
    var L = S.level = { objects: [], dispose: [] };
    function add(o) { S.scene.add(o); L.objects.push(o); return o; }

    buildTerrain(L, add);
    buildFloor(L, add);
    buildTreasures(L, add, list);

    var st = (map.starts && map.starts[S.myIndex]) || { x: 1, z: 1, dir: 0 };
    S.me = makeActor(S.myIndex, colorOf(S.myIndex), st);
    add(S.me.root);
    // 宝1つのモードでは、出発のとき宝の方を向く（目じるしの星が正面に見える）
    if (S.mode !== 'count' && S.treasures.length) {
      var t0 = S.treasures[0], tdx = t0.x + 0.5 - S.me.wx, tdz = t0.z + 0.5 - S.me.wz;
      if (Math.hypot(tdx, tdz) > 1) S.me.heading = Math.atan2(-tdx, -tdz);
    }
    buildAim(L, add, S.me.color);
    if (cpuOpt) {
      var ci = S.myIndex === 1 ? 0 : 1;
      var cs = (map.starts && map.starts[ci]) || { x: Math.min(S.w - 1, st.x + 2), z: st.z, dir: st.dir || 0 };
      S.cpu = makeActor(ci, colorOf(ci), cs);
      add(S.cpu.root);
      var lv = CPU_LV[cpuOpt.level] ? cpuOpt.level : 'normal';
      var cfg = CPU_LV[lv];
      S.cpu.speed = cfg.speed;
      S.cpu.ai = { level: lv, cfg: cfg, pause: CPU_WAIT0, plan: null, ver: -1, started: false, steps: 0, time: 0, stepT: 0, stuck: 0, holdFwd: false, style: lv === 'easy' ? 'jump' : 'front', jumps: 0, attacks: 0, digs: 0, replans: 0 };
    }
    if (S.net) {
      for (var p = 0; p < S.players.length; p++) {
        if (p === S.myIndex) continue;
        var s2 = (map.starts && map.starts[p]) || st;
        ensureRemote(p, { x: s2.x, z: s2.z, y: vis(hAt(s2.x, s2.z)), heading: dirToHeading(s2.dir || 0), color: colorOf(p), anim: 'idle' }, true);
      }
    }
    S.camBlendT = 1; S.chaseLift = 0; S.camY = S.me.y;
    S.sideK = 1; S.orbitK = 0; S.idleT = 0; S.faceHold = 0; S.atkK = 0; S.atkHold = 0; S.moved = false;
    S.camera.far = overheadHeight() * 1.6 + 60; S.camera.updateProjectionMatrix();
    S.camMode = 1; S.intro = { t: 0 }; S.topFlag = null; // 開始演出：真上から → おいかけへ
    var pose = poseFor(2);
    S.camera.position.copy(pose.p); S.camera.quaternion.copy(pose.q);
    fitNear();
    if (!S.running) render();
  }
  function colorOf(i) { var dflt = i === 0 ? '#e08524' : '#2f8be0'; return (S.players[i] && S.players[i].color) || dflt; }

  // 積み木の色：地図の色を少し鮮やかに。明るさが低い（黒に近い）色だけ、ほぼ真っ黒にする。
  // 高さ10（壁）のマスは、色の平均（字のふちはカーキや灰色になる）ではなく、いつも黒で塗る。
  // 高さは「その画素でいちばん濃い色」で決めているので、壁の縁のマスは平均色が明るく出てしまうため。
  var hsl = { h: 0, s: 0, l: 0 };
  var WALL_RGB = [0.18, 0.18, 0.2]; // 上の面＝こい灰色、側面（下の陰影で約0.6倍）＝ほぼ黒
  // 第2期：高さ9以下でも、高い（8以上）か暗い色のマスは黒系に。くすんだ色（カーキ・灰色）は高さに応じて黒へ寄せ、
  // 「壁と同じくらい高いカーキ色の積み木」を残さない（高さは画素のいちばん濃い色で決まるので、平均色が明るく出ることがある）
  function blockColor(c, hh, i) {
    // 土の山：淡いクレヨンの茶色（鮮やかにしない）
    if (i != null && S.buried && S.buried[i] && hh < 8) { var v = ((i * 37) % 7 - 3) * 0.008; c.setRGB(SOIL_BLOCK[0] + v, SOIL_BLOCK[1] + v, SOIL_BLOCK[2] + v); return c; }
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
    var sat = hsl.s < 0.3 ? hsl.s * 0.6 : clamp(hsl.s * 1.6, 0, 1);
    c.setHSL(hsl.h, sat, clamp(hsl.l * 0.92, 0.22, 0.68));
    return c;
  }
  function buildTerrain(L, add) {
    var w = S.w, h = S.h, n = 0, i;
    for (i = 0; i < w * h; i++) if (S.heights[i] > 1) n++; // 高さ0・1は紙の色（床に塗る）
    var geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    // 側面を少し暗く（上の面=明るい、側面=やや暗い、底=暗い）
    var pos = geo.attributes.position, nor = geo.attributes.normal, cols = new Float32Array(pos.count * 3);
    for (i = 0; i < pos.count; i++) {
      var ny = nor.getY(i), nx = nor.getX(i), v;
      if (ny > 0.5) v = 1; else if (ny < -0.5) v = 0.5; else v = nx !== 0 ? 0.62 : 0.72; // 側面をはっきり暗く（立体の形と壁の上面が読みとれるように）
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
    var mat = crayonize(new THREE.MeshLambertMaterial({ vertexColors: true }), 'block');
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
      // 積み木は側面も含めて地図の色で塗る。壁（高さ10）と黒に近い色だけ黒にする
      blockColor(c, hh, i);
      mesh.setColorAt(k, c);
      edgeArr[k] = edgeMask(x, z);
      cellToInst[i] = k++;
    }
    if (n === 0) { mesh.setMatrixAt(0, m.makeScale(0, 0, 0)); mesh.setColorAt(0, c.set(1, 1, 1)); }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    add(mesh);
    L.terrain = mesh; L.cellToInst = cellToInst; L.edgeAttr = edgeAttr; L.fadeAttr = fadeAttr; L.fading = {};
    L.dispose.push(geo, mat);
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

  // 床：地図の色から作ったCanvasTexture（影・マスの手描き線・壁ぎわのクレヨンのにじみ）。
  // 紙のざらつきとクレヨンの筋は、細かいのでシェーダー（crayonize 'floor'）で重ねる。
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
    var fm = crayonize(new THREE.MeshLambertMaterial({ map: tex }), 'floor', new THREE.Vector2(w / 2, h / 2)); // 2マスで模様1つ
    var floor = new THREE.Mesh(fg, fm); floor.position.set(w / 2, 0, h / 2);
    add(floor);
    // 紙のふちの影：紙の外側だけの「わく」の形にする。
    // （前は紙の下に全面の板を置いていたため、上から遠く見ると奥行きの精度が足りず、紙の上に斜めの灰色の三角形として出ていた）
    var es = new THREE.Shape();
    es.moveTo(-0.35, -0.35); es.lineTo(w + 0.85, -0.35); es.lineTo(w + 0.85, h + 0.85); es.lineTo(-0.35, h + 0.85); es.lineTo(-0.35, -0.35);
    var hole = new THREE.Path();
    hole.moveTo(0, 0); hole.lineTo(0, h); hole.lineTo(w, h); hole.lineTo(w, 0); hole.lineTo(0, 0);
    es.holes.push(hole);
    var eg = new THREE.ShapeGeometry(es); eg.rotateX(Math.PI / 2);
    var em = new THREE.MeshBasicMaterial({ color: 0x8a7458, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    var edge = new THREE.Mesh(eg, em); edge.position.y = -0.01; add(edge);
    var size = Math.max(w, h) * 6 + 200;
    var dg = new THREE.PlaneGeometry(size, size); dg.rotateX(-Math.PI / 2);
    var dtex = T.desk.clone(); dtex.needsUpdate = true; dtex.repeat.set(size / 12, size / 12);
    var dm = new THREE.MeshLambertMaterial({ map: dtex });
    var desk = new THREE.Mesh(dg, dm); desk.position.set(w / 2, -0.4, h / 2); add(desk); // 紙から十分はなす（重なってちらつかないように）
    L.dispose.push(tex, fg, fm, eg, em, dg, dm, dtex);
  }

  // マスの境目の、ごく淡い手描きの鉛筆線（少しゆれる）。地図ごとに1回だけ作る
  function buildGridLayer(w, h, px) {
    var c = makeCanvas(w * px, h * px), g = c.getContext('2d');
    g.lineCap = 'round'; g.lineJoin = 'round';
    function line(horiz, i) {
      var len = horiz ? w : h, base = i * px + rand(-0.4, 0.4), drift = 0;
      g.strokeStyle = 'rgba(112,98,82,' + rand(0.045, 0.085).toFixed(3) + ')';
      g.lineWidth = rand(0.7, 1.1);
      g.beginPath();
      for (var t = 0; t <= len; t += 1.5) {
        drift = clamp(drift + rand(-0.25, 0.25), -0.7, 0.7);
        var a = t * px, b = base + drift;
        if (t === 0) { if (horiz) g.moveTo(a, b); else g.moveTo(b, a); } else if (horiz) g.lineTo(a, b); else g.lineTo(b, a);
      }
      g.stroke();
    }
    for (var x = 1; x < w; x++) line(false, x);
    for (var z = 1; z < h; z++) line(true, z);
    return c;
  }

  // dirty（任意）：[x0,z0, x1,z1, ...] 壊れたマス。そのまわりだけ描き直す
  function paintFloor(dirty) {
    var L = S.level, w = S.w, h = S.h, px = L.floorPx;
    var sctx = L.floorSmall.getContext('2d');
    var img = sctx.createImageData(w, h), d = img.data;
    for (var z = 0; z < h; z++) for (var x = 0; x < w; x++) {
      var i = z * w + x, hh = S.heights[i], r, g, b;
      if (hh <= 1 && S.dug[i] === 2) { r = SOIL_DUG[0]; g = SOIL_DUG[1]; b = SOIL_DUG[2]; } // 土の山を掘ったあと：掘った土の色
      else if (hh <= 1 && S.dug[i]) { r = 232; g = 225; b = 212; } // 壊したあと：消しゴムでこすったような跡
      else if (hh > 1) { r = 40; g = 40; b = 42; } // 積み木の下：にじんで足元の影になる
      else {
        r = S.colors[i * 3]; g = S.colors[i * 3 + 1]; b = S.colors[i * 3 + 2];
        // 塗った色をはっきり見せる（白は紙の白のまま。色のついたところだけ少し濃く）
        var lum = 0.299 * r + 0.587 * g + 0.114 * b, sat = FLOOR_SAT;
        r = clamp(lum + (r - lum) * sat, 0, 255); g = clamp(lum + (g - lum) * sat, 0, 255); b = clamp(lum + (b - lum) * sat, 0, 255);
      }
      // 柔らかい影：左上（北西）の高い物が、右下へ影を落とす
      var sh = 1;
      for (var k = 1; k <= 4; k++) {
        var hx = vis(hAt(x - k, z - k)) - vis(hh);
        if (hx > k * 0.35) { sh = Math.min(sh, 0.72 + k * 0.045); break; }
      }
      // まわりが高いとほんのり暗く（すみっこの影）
      var ao = 0;
      if (hAt(x - 1, z) > hh) ao++; if (hAt(x + 1, z) > hh) ao++; if (hAt(x, z - 1) > hh) ao++; if (hAt(x, z + 1) > hh) ao++;
      sh *= 1 - ao * 0.05;
      d[i * 4] = r * sh; d[i * 4 + 1] = g * sh; d[i * 4 + 2] = b * sh; d[i * 4 + 3] = 255;
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
    // 壁ぎわのクレヨンのにじみ：床のマスのうち、となりが積み木の辺に、少しゆれた濃い線
    g2.lineCap = 'round';
    g2.strokeStyle = 'rgba(38,36,34,0.2)';
    g2.lineWidth = Math.max(1, px * 0.2);
    g2.beginPath();
    for (z = z0; z <= z1; z++) for (x = x0; x <= x1; x++) {
      var hh2 = S.heights[z * w + x];
      if (hh2 > 1) continue;
      for (var dd = 0; dd < 4; dd++) {
        var nx = x + DX[dd], nz = z + DZ[dd];
        if (!inMap(nx, nz) || S.heights[nz * w + nx] <= 1) continue;
        // 辺の両はし（ピクセル）。少し床側へ寄せ、ゆらす
        var ax, az, bx, bz, inset = px * 0.12;
        if (dd === 0) { ax = x; az = z; bx = x + 1; bz = z; } else if (dd === 2) { ax = x; az = z + 1; bx = x + 1; bz = z + 1; }
        else if (dd === 1) { ax = x + 1; az = z; bx = x + 1; bz = z + 1; } else { ax = x; az = z; bx = x; bz = z + 1; }
        var ix = -DX[dd] * inset, iz = -DZ[dd] * inset;
        g2.moveTo(ax * px + ix + rand(-0.5, 0.5), az * px + iz + rand(-0.5, 0.5));
        g2.lineTo(bx * px + ix + rand(-0.5, 0.5), bz * px + iz + rand(-0.5, 0.5));
      }
    }
    g2.stroke();
    g2.restore();
    L.floorTex.needsUpdate = true;
  }

  // ---------- 宝 ----------
  // 土の下にある間は見えない（ソナーにだけ出る）。宝のマスの高さが0になると、宝石が地面から出てきて光る。
  function buildTreasures(L, add, list) {
    if (!list.length) return;
    var gemGeo = new THREE.OctahedronGeometry(GEM_R, 0);
    var gemMat = new THREE.MeshStandardMaterial({ color: 0xff4fb0, emissive: 0xb01070, emissiveIntensity: 0.95, roughness: 0.12, metalness: 0.25, flatShading: true });
    var bh = 60;
    var beamGeo = new THREE.CylinderGeometry(0.9, 0.9, bh, 20, 1, true); beamGeo.translate(0, bh / 2, 0);
    var beam2Geo = new THREE.CylinderGeometry(0.35, 0.35, bh, 12, 1, true); beam2Geo.translate(0, bh / 2, 0);
    var starMat = new THREE.SpriteMaterial({ map: T.star, color: 0xfff6a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    L.dispose.push(gemGeo, gemMat, beamGeo, beam2Geo, starMat);
    list.forEach(function (t, ti) {
      var g = new THREE.Group();
      var x = t.x | 0, z = t.z | 0;
      g.position.set(x + 0.5, 0, z + 0.5);
      var gem = new THREE.Mesh(gemGeo, gemMat); gem.scale.set(1, 1.35, 1); g.add(gem);
      var glowMat = new THREE.SpriteMaterial({ map: T.soft, color: 0xff6cc4, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 });
      var glow = new THREE.Sprite(glowMat); g.add(glow);
      var beamMat = new THREE.MeshBasicMaterial({ map: T.beam, color: 0xff3fa8, opacity: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      var beam = new THREE.Mesh(beamGeo, beamMat); g.add(beam);
      var beam2Mat = new THREE.MeshBasicMaterial({ map: T.beam, color: 0xff8fd0, opacity: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      var beam2 = new THREE.Mesh(beam2Geo, beam2Mat); g.add(beam2);
      var sparks = [];
      for (var i = 0; i < 5; i++) { var s = new THREE.Sprite(starMat); s.scale.setScalar(0.35); g.add(s); sparks.push(s); }
      var far = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.star, color: 0xff3fa8, transparent: true, depthWrite: false, depthTest: false }));
      far.renderOrder = 9; far.visible = false; g.add(far);
      var beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.star, color: 0xff3fa8, transparent: true, depthWrite: false, depthTest: false }));
      beacon.renderOrder = 9; g.add(beacon);
      g.visible = false;
      add(g);
      L.dispose.push(glowMat, beamMat, beam2Mat, far.material, beacon.material);
      S.treasures.push({ i: ti, x: x, z: z, group: g, gem: gem, glow: glow, beam: beam, beam2: beam2, sparks: sparks, far: far, beacon: beacon,
        revealed: false, revealT: 0, taken: false, by: -1, flyT: 0, flyTo: null, phase: rand(0, 6) });
    });
    S.treasures.forEach(function (t) { if (S.heights[idx(t.x, t.z)] === 0) { t.revealed = true; t.revealT = 1; } });
    buildHints(L, add);
  }
  // 埋まっている宝の目じるし：土の山の上で、光の粒がゆらめき、ときどき星がきらっと光って昇る。
  // 遠く（おいかけ視点で20マス以上先）からも見えるよう、画面の上で小さくなりすぎない（最小の大きさがある）。
  // 宝そのものは見せない。全部の宝で1つの点の集まり（THREE.Points）＝描画命令は1つだけ。
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
    var n = S.treasures.length; if (!n) { S.hints = null; return; }
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
      var tr = S.treasures[k], b = k * HINT_K, on = !tr.revealed && !tr.taken;
      var cx = tr.x + 0.5, cz = tr.z + 0.5, top = vis(S.heights[idx(tr.x, tr.z)]), ph = tr.phase;
      // 0：ゆらめく光の粒（山の上、壁より少し高い所でふわふわ）
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
  function checkReveal(withFx) {
    S.treasures.forEach(function (t) {
      if (t.revealed || S.heights[idx(t.x, t.z)] !== 0) return;
      t.revealed = true; t.revealT = 0;
      if (withFx) {
        spawnStars(t.x + 0.5, 0.2, t.z + 0.5, 10, [0xffd23f, 0xff6cc4, 0xffffff]);
        popText('キラーン', t.x + 0.5, 1.9, t.z + 0.5, 1.1);
        sfx('tap');
      }
    });
  }
  function updateTreasures(dt) {
    var t0 = S.time, camH = S.camera.position.y, lightT = null;
    for (var k = 0; k < S.treasures.length; k++) {
      var tr = S.treasures[k];
      if (!tr.revealed || (tr.taken && tr.flyT >= 1)) { tr.group.visible = false; continue; }
      tr.group.visible = true;
      tr.revealT += dt;
      var t = t0 + tr.phase;
      var k1 = clamp(tr.revealT / 0.7, 0, 1), rise = easeOutBack(k1);
      var gy = -0.35 + (GEM_Y + 0.35) * rise + (k1 >= 1 ? Math.sin(t * 2.4) * 0.1 : 0);
      var sc = 0.3 + 0.7 * k1;
      tr.gem.rotation.y += dt * (1.6 + (1 - k1) * 8);
      var vis1 = 1;
      if (tr.taken) {
        // 拾った人のところへ飛んで小さくなる
        var f0 = tr.flyT;
        tr.flyT = Math.min(1, tr.flyT + dt / GEM_FLY);
        if (f0 < 1 && tr.flyT >= 1 && a) { // 届いた：シーカーのまわりに きらきら
          spawnStars(a.wx, a.y + 0.5, a.wz, 14, [0xffd23f, 0xff6cc4, 0xffffff, 0x7fe0ff]);
          for (var pk = 0; pk < 6; pk++) { var pa = pk / 6 * Math.PI * 2; spawnPuff(a.wx + Math.cos(pa) * 0.5, a.y + 0.7, a.wz + Math.sin(pa) * 0.5, { color: 0xfff1a8, vx: Math.cos(pa) * 1.6, vy: 0.8, vz: Math.sin(pa) * 1.6, s0: 0.25, s1: 0.8, life: 0.7, a: 0.85 }); }
          if (a === S.me) popText('やったー', a.wx, a.y + 2.3, a.wz, 1.0);
        }
        var u = tr.flyT, a = tr.flyTo;
        var ax = a ? a.wx - tr.group.position.x : 0, az = a ? a.wz - tr.group.position.z : 0, ay = a ? a.y + 0.9 : 1;
        tr.gem.position.set(ax * u, gy + (ay - gy) * u + Math.sin(u * Math.PI) * 1.2, az * u);
        sc *= 1 - u * 0.85; vis1 = 1 - u;
      } else tr.gem.position.set(0, gy, 0);
      tr.gem.scale.set(sc, sc * 1.35, sc);
      var pulse = (2.6 + Math.sin(t * 4) * 0.35) * sc;
      tr.glow.position.copy(tr.gem.position); tr.glow.scale.set(pulse, pulse, 1); tr.glow.material.opacity = 0.8 * vis1;
      tr.beam.material.opacity = 0.6 * k1 * vis1; tr.beam2.material.opacity = 0.85 * k1 * vis1;
      for (var i = 0; i < tr.sparks.length; i++) {
        var an = t * 1.3 + i / tr.sparks.length * Math.PI * 2, r = 0.8;
        tr.sparks[i].visible = !tr.taken;
        tr.sparks[i].position.set(Math.cos(an) * r, GEM_Y * rise + Math.sin(t * 3 + i) * 0.45, Math.sin(an) * r);
        var ss = (0.25 + 0.2 * Math.abs(Math.sin(t * 5 + i * 1.7))) * k1;
        tr.sparks[i].scale.set(ss, ss, 1);
      }
      // 遠くからの目じるし（拾われていない宝だけ）
      var gp = tr.group.position, dcam = Math.hypot(S.camera.position.x - gp.x, S.camera.position.z - gp.z);
      var bv = !tr.taken && camH <= 7 && dcam > 5;
      tr.beacon.visible = bv;
      if (bv) {
        var bs = clamp(dcam * 0.05, 0.7, 2.6) * (1 + 0.12 * Math.sin(t * 5)) * k1;
        tr.beacon.scale.set(bs, bs, 1); tr.beacon.material.rotation = Math.sin(t * 2) * 0.3; tr.beacon.material.opacity = clamp((dcam - 5) / 3, 0, 1);
        tr.beacon.position.y = 3.4 + clamp(dcam * 0.04, 0, 2);
      }
      tr.far.visible = !tr.taken && camH > 7;
      if (tr.far.visible) { var fs = camH * 0.09 * (1 + 0.12 * Math.sin(t * 5)); tr.far.material.rotation = Math.sin(t * 2) * 0.3; tr.far.scale.set(fs, fs, 1); tr.far.position.y = 0.8; tr.far.material.opacity = clamp((camH - 7) / 6, 0, 1); }
      if (!tr.taken) lightT = tr;
    }
    if (lightT) { S.gemLight.position.set(lightT.x + 0.5, 1.6, lightT.z + 0.5); S.gemLight.intensity = 1.6 + Math.sin(t0 * 4) * 0.4; }
    else S.gemLight.intensity = 0;
  }
  // 拾う：宝のマスが高さ0で、宝石が出てきたあと、シーカーがそのマスに入ったら
  function checkCollect(a) {
    if (S.over || !a) return;
    var cx = Math.floor(a.wx), cz = Math.floor(a.wz);
    for (var k = 0; k < S.treasures.length; k++) {
      var t = S.treasures[k];
      if (t.taken || !t.revealed || t.revealT < 0.35) continue;
      if (t.x === cx && t.z === cz && a.y < 0.8) { collect(a.idx, k, false, a); return; }
    }
  }
  function scoresView() { var o = S.myIndex === 0 ? 1 : 0; return [S.scores[S.myIndex] || 0, S.scores[o] || 0]; }
  function collect(who, ti, remote, actor) {
    var t = S.treasures[ti]; if (!t || t.taken) return false;
    t.taken = true; t.by = who; t.flyT = 0; t.flyTo = actor || null;
    if (!t.revealed) { t.revealed = true; t.revealT = 1; }
    S.scores[who] = (S.scores[who] || 0) + 1;
    if (actor) { actor.hop = 1.2; spawnStars(actor.wx, actor.y + 0.6, actor.wz, 10, [0xffd23f, 0xff6cc4, 0xffffff]); }
    if (actor && actor === S.me && (S.mode !== 'count' || !S.held.fwd)) S.faceHold = S.mode === 'count' ? 1.3 : 30; // 顔を見せる
    sfx('found');
    if (!remote) emit('collect', who, ti, scoresView());
    if (S.cpu && S.cpu.ai) S.cpu.ai.plan = null;
    if (S.mode !== 'count') {
      if (!S.over) { S.over = true; if (!remote) emit('found', who); }
    } else if (S.treasures.every(function (q) { return q.taken; })) {
      S.over = true; emit('done', scoresView());
    }
    if (S.cpu && S.cpu.ai && S.cpu.idx === who) S.cpu.ai.style = S.cpu.ai.style === 'front' ? 'jump' : 'front';
    return true;
  }

  // ---------- 地形を変える（掘る・壊す） ----------
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
      if (nh < old && nh <= 1) S.dug[i] = S.buried[i] ? 2 : 1;
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
      checkReveal(withFx);
    }
    return done;
  }

  // ---------- ドリルアタックのねらいの印（正面のマスが足元より高いときだけ） ----------
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
    var show = S.camMode !== 2 && !S.intro && !S.over && !me.air && inMap(f.x, f.z) && S.heights[idx(f.x, f.z)] > me.lv + 1;
    A.mesh.visible = show;
    if (!show) return;
    var pulse = 1 + Math.sin(S.time * 6) * 0.05;
    A.mesh.position.set(f.x + 0.5, vis(S.heights[idx(f.x, f.z)]) + 0.03, f.z + 0.5);
    A.mesh.scale.set(0.96 * pulse, 1, 0.96 * pulse);
  }

  // ---------- シーカーの動き（自分もCPUも同じ） ----------
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
  // 前へ d マス進む（壁にはすべって当たる）。実際に前へ進んだ量を返す
  function moveActor(a, d) {
    var fx = -Math.sin(a.heading), fz = -Math.cos(a.heading);
    var n = Math.max(1, Math.ceil(Math.abs(d) / 0.12)), sx = fx * d / n, sz = fz * d / n, ox = a.wx, oz = a.wz, blocked = false;
    for (var k = 0; k < n; k++) {
      if (canOccupy(a, a.wx + sx, a.wz)) a.wx += sx; else if (Math.abs(sx) > Math.abs(d / n) * 0.35) blocked = true;
      if (canOccupy(a, a.wx, a.wz + sz)) a.wz += sz; else if (Math.abs(sz) > Math.abs(d / n) * 0.35) blocked = true;
    }
    if (blocked && a.bumpCd <= 0 && !a.air) { a.bumpCd = 0.6; if (a === S.me) sfx('bump'); a.shakeV = 0.02; }
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
    if (speed > 3) {
      for (var k = 0; k < 4; k++) spawnPuff(a.wx + rand(-0.4, 0.4), a.y + 0.08, a.wz + rand(-0.4, 0.4), { color: 0xf3eee4, vx: rand(-1, 1), vy: 0.4, vz: rand(-1, 1), s0: 0.3, s1: 0.9, life: 0.6, a: 0.65 });
      if (a === S.me) S.shake = Math.max(S.shake, clamp(speed * 0.012, 0.03, 0.09));
    }
  }
  function canAct(a) { return !a.act && !a.air && !S.over; }
  function startJump(a) {
    if (!canAct(a)) return false;
    a.act = { name: 'jump', phase: 'crouch', t: 0, pt: 0 };
    if (a === S.me) emit('action', 'jump');
    return true;
  }
  function startDrillAttack(a) {
    if (!canAct(a)) return false;
    a.act = { name: 'drillAttack', t: 0, pt: 0, hit: false };
    if (a === S.me) { emit('action', 'drillAttack'); sfx('turn'); }
    if (a.ai) a.ai.attacks++;
    return true;
  }
  function startDrillJump(a, fwdHeld) {
    if (!canAct(a)) return false;
    var tx = Math.floor(a.wx), tz = Math.floor(a.wz);
    if (fwdHeld) { var f = frontCell(a); if (inMap(f.x, f.z) && S.heights[idx(f.x, f.z)] <= a.lv + JUMP_UP) { tx = f.x; tz = f.z; } }
    var top = Math.max(a.y, vis(hAt(tx, tz)));
    a.act = { name: 'drillJump', phase: 'flip', t: 0, pt: 0, tx: tx, tz: tz, sx: a.wx, sz: a.wz, dustT: 0 };
    a.air = true; a.vy = Math.sqrt(2 * DJ.g * Math.max(0.3, top + DJ.rise - a.y));
    if (a === S.me) { emit('action', 'drillJump'); sfx('jump'); }
    if (a.ai) a.ai.digs++;
    return true;
  }
  function setPhase(A, p) { A.phase = p; A.pt = 0; }
  function stepAct(a, dt) {
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
          if (a === S.me) sfx('jump');
          if (a.ai) a.ai.jumps++;
        }
      } else {
        stepVertical(a, dt);
        if (!a.air) a.act = null;
      }
    } else if (A.name === 'drillAttack') {
      var t = A.t;
      a.hatF = t < DA.wind ? ease(t / DA.wind) : (t > DA.end - 0.18 ? clamp((DA.end - t) / 0.18, 0, 1) : 1);
      a.spin = 1 + 6 * a.hatF;
      a.lunge = t < DA.hit ? 0.14 * t / DA.hit : 0.14 * clamp(1 - (t - DA.hit) / 0.25, 0, 1);
      a.shakeV = t > DA.hit && t < DA.hit + 0.2 ? 0.02 : 0;
      if (!A.hit && t >= DA.hit) { A.hit = true; doDrillAttack(a); }
      stepVertical(a, dt);
      if (t >= DA.end) { a.act = null; a.hatF = 0; a.lunge = 0; a.shakeV = 0; }
    } else if (A.name === 'drillJump') {
      stepDrillJump(a, A, dt);
    }
  }
  function doDrillAttack(a) {
    var f = frontCell(a);
    var fx = -Math.sin(a.heading), fz = -Math.cos(a.heading);
    if (inMap(f.x, f.z) && S.heights[idx(f.x, f.z)] > a.lv) {
      var top = vis(S.heights[idx(f.x, f.z)]);
      var ch = setCells([[f.x, f.z, a.lv]], true);
      if (ch.length && a === S.me) emit('terrain', ch);
      popText('ゴゴゴッ', f.x + 0.5, Math.max(top, a.y) + 1.6, f.z + 0.5, 1.15);
      sfx('dig');
      if (a === S.me) S.shake = Math.max(S.shake, 0.12);
    } else {
      // 空振り：前に小さな風
      spawnPuff(a.wx + fx * 0.7, a.y + 0.5, a.wz + fz * 0.7, { color: 0xffffff, vx: fx * 1.2, vy: 0.2, vz: fz * 1.2, s0: 0.25, s1: 0.8, life: 0.45, a: 0.6 });
    }
  }
  function stepDrillJump(a, A, dt) {
    var cx = A.tx + 0.5, cz = A.tz + 0.5;
    if (A.phase === 'flip' || A.phase === 'hang') {
      var k = ease(clamp(A.t / (DJ.flip + DJ.hang), 0, 1));
      a.wx = A.sx + (cx - A.sx) * k; a.wz = A.sz + (cz - A.sz) * k;
    }
    if (A.phase === 'flip') {
      a.y += a.vy * dt - 0.5 * DJ.g * dt * dt; a.vy -= DJ.g * dt;
      a.flip = Math.min(1, A.pt / DJ.flip); a.spin = 1;
      if (A.pt >= DJ.flip) { setPhase(A, 'hang'); a.vy = 0; }
    } else if (A.phase === 'hang') {
      a.spin = 2 + A.pt * 10; a.shakeV = 0.012;
      if (A.pt >= DJ.hang) { setPhase(A, 'dive'); a.vy = -3; a.shakeV = 0; }
    } else if (A.phase === 'dive') {
      a.vy = Math.max(a.vy - 45 * dt, -16); a.y += a.vy * dt; a.spin = 4;
      var tgt = vis(hAt(A.tx, A.tz)) + a.tip;
      if (a.y <= tgt) {
        a.y = tgt; setPhase(A, 'bore');
        var h = hAt(A.tx, A.tz), nh = Math.max(0, h - 1), col = new THREE.Color();
        if (nh < h) {
          var ch = setCells([[A.tx, A.tz, nh]], true);
          if (ch.length && a === S.me) emit('terrain', ch);
        } else { cellColor(idx(A.tx, A.tz), col); digFx(cx, vis(h), cz, col, false); }
        popText('ゴゴゴッ', cx, vis(h) + a.tip + 0.9, cz, 1.25);
        sfx('dig');
        if (a === S.me) S.shake = Math.max(S.shake, 0.16);
      }
    } else if (A.phase === 'bore') {
      a.spin = 6; a.shakeV = 0.025;
      // ドリルの先を、掘っているマスの（下がったあとの）上面より BORE_IN だけ下まで入れる
      var base = vis(hAt(A.tx, A.tz)) + a.tip;
      a.y = base - BORE_IN * (1 - Math.pow(1 - Math.min(1, A.pt / 0.3), 2));
      A.dustT -= dt;
      if (A.dustT <= 0) {
        A.dustT = 0.07;
        var dc = new THREE.Color(); cellColor(idx(A.tx, A.tz), dc);
        if (S.buried[idx(A.tx, A.tz)]) dc.setRGB(SOIL[0], SOIL[1], SOIL[2]);
        spawnDebris(cx, vis(hAt(A.tx, A.tz)) + 0.05, cz, dc, 2, 0.5);
        spawnPuff(cx + rand(-0.35, 0.35), vis(hAt(A.tx, A.tz)) + 0.1, cz + rand(-0.35, 0.35), { color: 0xeadcc4, vy: 0.7, s0: 0.3, s1: 0.9, life: 0.6, a: 0.7 });
      }
      if (A.pt >= DJ.bore) { setPhase(A, 'pop'); a.vy = DJ.popVy; a.shakeV = 0; digFx(cx, vis(hAt(A.tx, A.tz)), cz, new THREE.Color(0xd9b98c), false); }
    } else if (A.phase === 'pop') {
      a.y += a.vy * dt - 0.5 * DJ.g * dt * dt; a.vy -= DJ.g * dt; a.spin = 1.5;
      a.flip = Math.max(0, a.flip - dt / DJ.unflip);
      var gy = footInfo(a.wx, a.wz).y;
      if (a.flip > 0 && a.vy < 0 && a.y < gy + a.tip * a.flip) a.y = gy + a.tip * a.flip; // 逆さのまま地面にもぐらない（潜った所から上がるときは そのまま）
      if (a.flip <= 0 && a.vy < 0 && a.y <= gy) { a.y = gy; land(a, Math.max(3.2, -a.vy)); a.act = null; a.spin = 0.15; }
      else if (A.pt > 3) { a.flip = 0; a.act = null; a.air = true; } // 念のため
    }
  }
  // inp = {fwd:-1..1, turn: ラジアン/秒}
  function updateActor(a, dt, inp) {
    a.bumpCd -= dt;
    var h0 = a.heading, ox = a.wx, oz = a.wz;
    var free = !a.act || a.act.name === 'jump';
    if (inp.turn && free) a.heading += inp.turn * dt;
    if (free && inp.fwd && !S.over) {
      var sp = (a.air ? Math.max(a.speed, AIR_SPEED) : a.speed) * inp.fwd;
      if (a.act && a.act.phase === 'crouch') sp *= 0.3;
      moveActor(a, sp * dt);
    }
    if (a.act) stepAct(a, dt); else stepVertical(a, dt);
    if (!a.act || a.act.name === 'jump') {
      a.hatF += (0 - a.hatF) * Math.min(1, dt * 10);
      a.spin += (0.15 - a.spin) * Math.min(1, dt * 4);
      a.flip = Math.max(0, a.flip - dt * 3);
      a.shakeV *= Math.exp(-dt * 12);
    }
    if (a.sqRate > 0) a.squash *= Math.exp(-dt * a.sqRate);
    var fwdMoved = ((a.wx - ox) * -Math.sin(a.heading) + (a.wz - oz) * -Math.cos(a.heading)) / Math.max(1e-4, dt) / SPEED;
    a.moveV += (fwdMoved - a.moveV) * Math.min(1, dt * 12);
    var tv = wrapAng(a.heading - h0) / Math.max(1e-4, dt);
    a.turnV += (tv - a.turnV) * Math.min(1, dt * 12);
  }

  // ---------- 自分の操作 ----------
  var ACTIONS = ['fwd', 'back', 'left', 'right', 'jump', 'drillAttack', 'drillJump', 'fire'];
  function press(action, isDown) {
    if (action === 'fire') action = 'drillAttack'; // 前の名前（互換）
    if (ACTIONS.indexOf(action) < 0) return;
    if (!isDown) { S.held[action] = false; return; }
    if (S.paused) return;
    S.idleT = 0;
    if (action === 'jump' || action === 'drillAttack' || action === 'drillJump') {
      if (!S.held[action]) S.tapQ[action] = 0.15; // 押した瞬間だけ（押しっぱなしで連続しない）。少しだけ先行入力を受ける
    }
    S.held[action] = true;
  }
  function updateMe(dt) {
    var me = S.me; if (!me) return;
    var inp = { fwd: 0, turn: 0 };
    if (!S.over) {
      inp.fwd = (S.held.fwd ? 1 : 0) - (S.held.back ? 0.5 : 0);
      inp.turn = ((S.held.left ? 1 : 0) - (S.held.right ? 1 : 0)) * KEY_TURN;
      for (var k in S.tapQ) {
        if (S.tapQ[k] <= 0) continue;
        var okk = false;
        if (k === 'jump') okk = startJump(me);
        else if (k === 'drillAttack') okk = startDrillAttack(me);
        else if (k === 'drillJump') okk = startDrillJump(me, !!S.held.fwd);
        S.tapQ[k] = okk ? 0 : S.tapQ[k] - dt;
      }
    } else S.tapQ = {};
    updateActor(me, dt, inp);
    checkCollect(me);
  }

  // ---------- CPU ----------
  // 道さがし：状態＝(マス, 立っている段)。手＝歩く(1)・ジャンプ(2.2)・ドリルアタックで正面を足元まで下げて入る(土5 か 7、壁18 など)・
  // 宝のマスでドリルジャンプして1段下げる(1.5)。宝のマスに段0で立てたら終わり（宝が出てきて拾える）。
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
  function planCpu(a) {
    var W = S.w, N = W * S.h, Hh = S.heights, goal = new Uint8Array(N), any = false;
    S.treasures.forEach(function (t) { if (!t.taken) { goal[t.z * W + t.x] = 1; any = true; } });
    if (!any) return null;
    var M = N * NL;
    if (!planBuf || planBuf.M !== M) planBuf = { M: M, dist: new Float64Array(M), prev: new Int32Array(M), act: new Uint8Array(M) };
    var dist = planBuf.dist, prev = planBuf.prev, act = planBuf.act;
    dist.fill(Infinity); prev.fill(-1);
    heap.k.length = 0; heap.v.length = 0;
    var c0 = Math.floor(a.wz) * W + Math.floor(a.wx), L0 = clamp(Hh[c0], 0, 10), s0 = c0 * NL + L0;
    var soilCost = a.ai && a.ai.style === 'jump' ? 7 : 3;
    dist[s0] = 0; hpush(s0, 0);
    function relax(from, to, d, code) { if (d < dist[to]) { dist[to] = d; prev[to] = from; act[to] = code; hpush(to, d); } }
    var goalS = -1;
    while (heap.k.length) {
      var dk = heap.k[0], s = hpop();
      if (dk > dist[s]) continue;
      var cell = (s / NL) | 0, L = s - cell * NL;
      if (goal[cell] && L === 0) { goalS = s; break; }
      if (goal[cell] && L > 0) relax(s, cell * NL + L - 1, dk + 1.5, 4);
      var x = cell % W, z = (cell - x) / W;
      for (var dd = 0; dd < 4; dd++) {
        var nx = x + DX[dd], nz = z + DZ[dd];
        if (nx < 0 || nz < 0 || nx >= W || nz >= S.h) continue;
        var n = nz * W + nx, hn = Hh[n];
        if (hn <= L + 1) relax(s, n * NL + hn, dk + 1, 1);
        else if (hn <= L + JUMP_UP) relax(s, n * NL + hn, dk + 2.2, 2);
        if (hn > L + 1) relax(s, n * NL + L, dk + 1 + (S.buried[n] ? soilCost : (hn >= 8 ? 18 : 6)), 3);
      }
    }
    if (goalS < 0) return null;
    var out = [];
    for (var q = goalS; q !== s0 && q >= 0; q = prev[q]) out.push({ cell: (q / NL) | 0, L: q % NL, a: act[q] });
    out.reverse();
    return out;
  }
  // 目標へ向きを変えながら進む。残りの距離を返す
  function steer(c, x, z, dt, inp) {
    var dx = x - c.wx, dz = z - c.wz, d = Math.hypot(dx, dz);
    if (d < 0.02) return d;
    var want = Math.atan2(-dx, -dz), mx = c.ai.cfg.turn * dt;
    var err = wrapAng(want - c.heading);
    c.heading += clamp(err, -mx, mx);
    err = wrapAng(want - c.heading);
    if (Math.abs(err) < 0.7) inp.fwd = Math.min(1, d / Math.max(1e-3, c.speed * dt)) * Math.max(0.35, Math.cos(err));
    return d;
  }
  function faceTo(c, want, dt) {
    var err = wrapAng(want - c.heading), mx = c.ai.cfg.turn * dt;
    if (Math.abs(err) <= Math.max(mx, 0.03)) { c.heading = want; return true; }
    c.heading += clamp(err, -mx, mx);
    return false;
  }
  function cpuThink(c, dt, inp) {
    var ai = c.ai, W = S.w;
    if (!ai.plan || ai.ver !== S.mapVer) {
      ai.plan = planCpu(c); ai.ver = S.mapVer; ai.stepT = 0; ai.replans++;
      if (!ai.plan) { ai.pause = 0.5; return; }
    }
    var st = ai.plan[0];
    if (!st) { ai.plan = null; ai.pause = 0.2; return; }
    ai.stepT += dt;
    var ccx = Math.floor(c.wx), ccz = Math.floor(c.wz);
    var tx = st.cell % W, tz = (st.cell - tx) / W;
    if (ai.stepT > 4.5) {
      // 同じ手で止まっている：さがし直し。続くなら前を掘るか跳んで抜ける
      ai.plan = null; ai.stuck++; ai.stepT = 0;
      if (ai.stuck >= 2) {
        ai.stuck = 0;
        var f = frontCell(c);
        if (inMap(f.x, f.z) && S.heights[idx(f.x, f.z)] > c.lv + 1) startDrillAttack(c);
        else { c.heading += rand(-1.2, 1.2); if (startJump(c)) ai.holdFwd = true; }
      }
      return;
    }
    if (st.a === 1) { // 歩く
      if (Math.abs(ccx - tx) + Math.abs(ccz - tz) > 1 || S.heights[st.cell] > c.lv + 1) { ai.plan = null; return; }
      if (steer(c, tx + 0.5, tz + 0.5, dt, inp) < 0.22) {
        ai.plan.shift(); ai.stepT = 0; ai.stuck = 0; ai.steps++;
        if (ai.cfg.doubt && Math.random() < ai.cfg.doubt) ai.pause = ai.cfg.pause * 1.5; // まよって立ち止まる
      }
      return;
    }
    if (st.a === 2 || st.a === 3) { // 跳んで乗る・正面を壊す：まず自分のマスの真ん中で、そのマスの方を向く
      if (Math.abs(ccx - tx) + Math.abs(ccz - tz) !== 1) { ai.plan = null; return; }
      if (Math.hypot(c.wx - ccx - 0.5, c.wz - ccz - 0.5) > 0.12) { steer(c, ccx + 0.5, ccz + 0.5, dt, inp); return; }
      if (!faceTo(c, Math.atan2(-(tx - ccx), -(tz - ccz)), dt)) return;
      if (st.a === 2) { if (startJump(c)) { ai.holdFwd = true; st.a = 1; ai.stepT = 0; ai.steps++; } }
      else if (startDrillAttack(c)) { ai.plan.shift(); ai.stepT = 0; ai.steps++; ai.pause = ai.cfg.pause; }
      return;
    }
    if (st.a === 4) { // 宝のマスでドリルジャンプ
      if (ccx !== tx || ccz !== tz) { ai.plan = null; return; }
      if (Math.hypot(c.wx - tx - 0.5, c.wz - tz - 0.5) > 0.12) { steer(c, tx + 0.5, tz + 0.5, dt, inp); return; }
      if (startDrillJump(c, false)) { ai.plan.shift(); ai.stepT = 0; ai.steps++; ai.pause = ai.cfg.pause; }
      return;
    }
    ai.plan = null;
  }
  function updateCpu(dt) {
    var c = S.cpu; if (!c) return;
    var ai = c.ai, inp = { fwd: 0, turn: 0 };
    if (!S.over && !ai.started && !S.intro) ai.started = true;
    if (!S.over && ai.started) {
      ai.time += dt;
      if (c.act || c.air) { if (ai.holdFwd) inp.fwd = 1; }
      else {
        ai.holdFwd = false;
        if (ai.pause > 0) ai.pause -= dt;
        else cpuThink(c, dt, inp);
      }
    }
    updateActor(c, dt, inp);
    checkCollect(c);
  }

  // ---------- 相手（通信） ----------
  function ensureRemote(i, s, snap) {
    var r = S.remotes[i];
    if (!r) {
      var col = (s && s.color) || colorOf(i);
      r = makeActor(i, col, { x: Math.floor(+s.x || 0), z: Math.floor(+s.z || 0), dir: 0 });
      S.scene.add(r.root);
      r.tgt = { x: r.wx, z: r.wz, y: r.y, heading: r.heading, flip: 0, squash: 0, hatF: 0, spin: 0.15, anim: 'idle' };
      S.remotes[i] = r; snap = true;
    }
    if (s) {
      if (s.color) recolorActor(r, s.color);
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

  // ---------- カメラ ----------
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
  var CHASE_BACK = 3.9, CHASE_UP = 3.2, CHASE_AHEAD = 3.6, CHASE_SIDE = 1.1; // 少し右うしろから：ロールケーキの端（星）も見える
  var ATK_SIDE = 1.5, ATK_UP = 1.3, ATK_BACK = 0.6, ATK_HOLD = 0.9;          // ドリルアタック中のずらし
  var ORBIT_YAW = 2.25, ORBIT_DIST = 3.0, ORBIT_UP = 1.75, IDLE_ORBIT = 2.6;  // 顔を見せる回りこみ（止まって2.6秒で）
  var FADE_ON = 0.7;                                                          // 間の壁を透かす量（0.7＝4つに3つ抜く）
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
      // ドリルアタック：少し右・上へずれて、正面の壊れるマスが体のかげにならないように
      side += ak * ATK_SIDE * (S.sideK < 0 ? -1 : 1); up += ak * ATK_UP; back -= ak * ATK_BACK;
      // 止まっているとき・拾ったとき：前ななめへ回りこんで、顔（目）と端の星を見せる（向き＝操作は変えない）
      back += (ORBIT_DIST - back) * ok; up += (ORBIT_UP - up) * ok;
      var rr = Math.hypot(back, side), th = Math.atan2(side, back) + ok * ORBIT_YAW;
      if (side < 0) th = Math.atan2(side, back) - ok * ORBIT_YAW; // 左うしろにいるときは左へ回りこむ
      var u = -Math.cos(th) * rr, v = Math.sin(th) * rr; // u=前、v=右
      p.set(px + fx * u + rx * v, py + up + S.chaseLift * (1 - ok), pz + fz * u + rz * v);
      tg.set(px + fx * ah + rx * 0.25, py + 0.35 + pv * (pv > 0 ? 1.1 : 0.4) + S.chaseLift * 0.5, pz + fz * ah + rz * 0.25);
      if (ak > 0) { tg.x += rx * ak * 0.5; tg.z += rz * ak * 0.5; }
      if (ok > 0) tg.lerp(tmpV.set(px, py + 0.6, pz), ok);
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
  function setCamera(mode) {
    mode = ((mode | 0) % 3 + 3) % 3;
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
      var rate = want ? (S.faceHold > 0 ? 2.6 : 1.1) : 6;
      S.orbitK += (want - S.orbitK) * (1 - Math.exp(-dt * rate));
      if (!want && S.orbitK < 0.002) S.orbitK = 0;
    }
  }
  // カメラとシーカーの間で、シーカーを隠している積み木を薄く透かす
  var occWant = {};
  function updateOccluders(dt) {
    var L = S.level, me = S.me; if (!L || !L.fadeAttr) return;
    var k, want = occWant; for (k in want) delete want[k];
    if (me && S.camMode === 1 && !S.intro && me.root.visible) {
      var cp = S.camera.position, mcx = Math.floor(me.wx), mcz = Math.floor(me.wz);
      var sx = Math.cos(me.heading) * 0.35, sz = -Math.sin(me.heading) * 0.35; // シーカーの左右の幅
      for (var r = 0; r < 5; r++) {
        var ty = me.y + (r === 0 ? 0.25 : r === 2 ? 1.05 : 0.65), ox = r === 3 ? sx : r === 4 ? -sx : 0, oz = r === 3 ? sz : r === 4 ? -sz : 0;
        var bx = me.wx + ox, bz = me.wz + oz;
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
  }
  var shakeV = new THREE.Vector3();
  function fitNear() {
    var want = Math.max(0.05, (S.camera.position.y - 10) * 0.25);
    if (Math.abs(want - S.camera.near) > S.camera.near * 0.03 + 1e-4) { S.camera.near = want; S.camera.updateProjectionMatrix(); }
  }
  function updateCamera(dt) {
    if (!S.camera) return;
    // 跳んだり潜ったりしても画面がゆれすぎないよう、高さはゆっくり追う（ドリルジャンプ中は地面の高さ）
    if (S.me) {
      var me = S.me, wantY = me.act && me.act.name === 'drillJump' ? footInfo(me.wx, me.wz).y : me.y;
      S.camY += (wantY - S.camY) * (1 - Math.exp(-dt * 5));
    }
    S.chaseLift += (chaseLiftTarget() - S.chaseLift) * (1 - Math.exp(-dt * 5));
    S.pitchV += (S.pitch - S.pitchV) * (1 - Math.exp(-dt * 10));
    updateCamFactors(dt);
    var target = poseFor(S.camMode);
    var top = S.camMode === 2 || !!(S.intro && S.intro.t < INTRO_HOLD + 0.5);
    if (top !== S.topFlag) { S.topFlag = top; emit('cam', top); }
    if (S.intro) {
      if (!S.paused) S.intro.t += dt;
      if (S.intro.t >= INTRO_HOLD + INTRO_MOVE) S.intro = null;
    }
    if (S.intro) {
      var ov = poseFor(2), ie = ease(clamp((S.intro.t - INTRO_HOLD) / INTRO_MOVE, 0, 1));
      S.camera.position.lerpVectors(ov.p, target.p, ie);
      S.camera.position.y += Math.sin(ie * Math.PI) * 1.5;
      THREE.Quaternion.slerp(ov.q, target.q, S.camera.quaternion, ie);
    } else if (S.camBlendT < 1) {
      S.camBlendT = Math.min(1, S.camBlendT + dt / CAM_BLEND);
      var e = ease(S.camBlendT);
      S.camera.position.lerpVectors(S.camFrom.p, target.p, e);
      S.camera.position.y += Math.sin(e * Math.PI) * 1.5;
      THREE.Quaternion.slerp(S.camFrom.q, target.q, S.camera.quaternion, e);
    } else {
      S.camera.position.copy(target.p);
      S.camera.quaternion.copy(target.q);
    }
    if (S.shake > 0.001) {
      var a = S.shake;
      shakeV.set(rand(-a, a), rand(-a, a) * 0.7, rand(-a, a));
      if (S.camMode === 2) shakeV.multiplyScalar(2.5);
      S.camera.position.add(shakeV);
      S.shakeOff = shakeV;
      S.shake *= Math.exp(-dt * 6);
    } else { S.shake = 0; S.shakeOff = null; }
    fitNear();
    if (S.me) S.me.root.visible = !(S.camMode === 0 && S.camBlendT > 0.55);
    updateOccluders(dt);
    updateHints();
    var camH = S.camera.position.y;
    function mark(a) {
      if (!a) return;
      var show = camH - a.y > 10;
      a.marker.visible = show;
      if (show) { var s = camH / 30; a.marker.scale.setScalar(s); a.marker.position.y = 2.0 + s * 0.8 + Math.sin(S.time * 4) * 0.15 * s; a.mats.marker.opacity = clamp((camH - a.y - 10) / 6, 0, 0.95); }
    }
    mark(S.me); mark(S.cpu);
    for (var k in S.remotes) mark(S.remotes[k]);
  }

  // ---------- ループ ----------
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
      color: a.color
    };
  }
  function update(dt) {
    if (!S.level) return;
    evQ = [];
    try { updateBody(dt); } finally { flushEvents(); }
  }
  function updateBody(dt) {
    S.time += dt;
    updateMe(dt);
    updateCpu(dt);
    updateRemotes(dt);
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
    clearLevel();
    S.held = {}; S.tapQ = {}; S.paused = false;
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
  function setPaused(b) {
    S.paused = !!b;
    if (S.paused) { S.held = {}; S.tapQ = {}; }
  }

  // ---------- 公開 ----------
  var World = {
    STEP_H: STEP_H,
    init: init,
    load: load,
    start: start,
    stop: stop,
    setPaused: setPaused,
    press: press,
    setCamera: setCamera,
    cycleCamera: function () { setCamera((S.camMode + 1) % 3); return S.camMode; },
    on: function (ev, fn) {
      if (!handlers[ev] || typeof fn !== 'function') return;
      if (handlers[ev].indexOf(fn) < 0) handlers[ev].push(fn);
    },
    off: function (ev, fn) {
      if (!handlers[ev]) return;
      if (!fn) handlers[ev].length = 0; else { var i = handlers[ev].indexOf(fn); if (i >= 0) handlers[ev].splice(i, 1); }
    },
    // 左右スワイプ：dx は画面の幅を1とした量（+で右）。向き（とカメラ）がなぞった分だけ回る
    swipeTurn: function (dx) {
      dx = +dx; if (!isFinite(dx) || S.paused || !S.me || S.over) return;
      S.me.heading -= clamp(dx, -2, 2) * SWIPE_GAIN;
      S.idleT = 0;
    },
    nudgePitch: function (dy) {
      dy = +dy; if (!isFinite(dy)) return;
      S.pitch = clamp(S.pitch + clamp(dy, -1, 1), -PITCH_MAX, PITCH_MAX);
      S.idleT = 0;
    },
    resetPitch: function () { S.pitch = 0; },
    // ソナー：自分から半径 radius マス以内の、拾われていない宝（dx,dz は世界座標の差、depth は宝の上に残る段数）
    sonar: function (radius) {
      radius = radius == null ? 10 : +radius;
      var me = S.me, out = { heading: me ? me.heading : 0, items: [] };
      if (!me || !S.level) return out;
      S.treasures.forEach(function (t) {
        if (t.taken) return;
        var dx = t.x + 0.5 - me.wx, dz = t.z + 0.5 - me.wz, d = Math.hypot(dx, dz);
        if (d <= radius) out.items.push({ dx: Math.round(dx * 100) / 100, dz: Math.round(dz * 100) / 100, dist: Math.round(d * 100) / 100, depth: S.heights[idx(t.x, t.z)], i: t.i });
      });
      return out;
    },
    scores: function () { return scoresView(); },
    // 宝の数と、のこり（UI の表示用）
    treasureInfo: function () { var n = S.treasures.length, left = S.treasures.filter(function (t) { return !t.taken; }).length; return { total: n, left: left, mode: S.mode }; },
    finish: function () { S.over = true; S.held = {}; S.tapQ = {}; return scoresView(); },
    get isOver() { return S.over; },
    applyRemoteState: function (i, s) {
      if (!S.level || !s || i === S.myIndex) return;
      ensureRemote(i, s, false);
    },
    // 相手が変えた地形を再現（cells: [[x,z,h],...]）。イベントは出さない
    applyRemoteTerrain: function (cells) {
      if (!S.level || !Array.isArray(cells)) return;
      var ch = setCells(cells, true);
      if (ch.length) sfx('dig');
    },
    // 相手が宝を拾った（イベントは出さない。数は World.scores() で）
    applyRemoteCollect: function (i, ti) {
      if (!S.level) return;
      ti = ti | 0;
      if (!S.treasures[ti] || S.treasures[ti].taken) return;
      collect(i | 0, ti, true, S.remotes[i] || null);
    },
    dropRemote: function (i) {
      var r = S.remotes[i]; if (!r) return;
      disposeActor(r); delete S.remotes[i];
    },
    // 互換（第2期の名前）
    remoteFound: function (i) { var k = S.treasures.findIndex(function (t) { return !t.taken; }); if (k >= 0) World.applyRemoteCollect(i, k); },
    applyRemoteBoom: function (cells) { if (!Array.isArray(cells)) return; World.applyRemoteTerrain(cells.map(function (c) { return [c[0], c[1], 0]; })); },
    // 確認用（ゲームの進行には使わない）：n コマ分を すぐに進める（描画は待たない）
    _step: function (n, dt) {
      if (!S.level || S.paused) return;
      for (var k = 0; k < (n | 0); k++) { if (!S.level) break; update(dt || 1 / 30); if (S.level) updateCamera(dt || 1 / 30); }
    },
    _plan: function () { return S.cpu ? planCpu(S.cpu) : null; },
    // 確認用：埋まっている宝の目じるし（どの宝に出ているか、画面のどこに映るか、自分からの距離、間にある壁で隠れているか）
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
        return { i: k, on: on, onScreen: !!best, ndc: best ? [Math.round(best.x * 100) / 100, Math.round(best.sy * 100) / 100] : null, dist: Math.round(Math.hypot(tr.x + 0.5 - me.wx, tr.z + 0.5 - me.wz) * 10) / 10, revealed: tr.revealed, minPx: H.mat.uniforms.uMinPx.value };
      });
    },
    _fading: function () { return S.level && S.level.fading ? Object.keys(S.level.fading).length : 0; },
    _cam: function () { return { orbit: S.orbitK, atk: S.atkK, idle: S.idleT, face: S.faceHold, side: S.sideK }; },
    // 確認用：自分のシーカーのいちばん低い点（ドリルの先）の高さと、いまいるマスの上面
    _meLow: function () {
      var me = S.me; if (!me) return null;
      me.root.updateMatrixWorld(true);
      var b = new THREE.Box3().setFromObject(me.model.root);
      var A = me.act, tx = A && A.tx != null ? A.tx : Math.floor(me.wx), tz = A && A.tz != null ? A.tz : Math.floor(me.wz);
      return { low: b.min.y, top: vis(hAt(tx, tz)), y: me.y, tip: me.tip };
    },
    _manual: function (b) { S.manual = !!b; }, // 確認用：描画ループでは進めない（_step だけで進める）
    _setPose: function (x, z, heading) {
      var me = S.me; if (!me) return;
      me.wx = x; me.wz = z; if (heading != null) me.heading = heading; me.act = null; me.air = false; me.vy = 0;
      var f = footInfo(me.wx, me.wz); me.y = f.y; me.lv = f.lv; S.camY = me.y;
    },
    _debug: function (qx, qz) {
      var me = S.me, c = S.cpu;
      function A(a) { return a ? { x: a.wx, z: a.wz, cx: Math.floor(a.wx), cz: Math.floor(a.wz), y: a.y, lv: a.lv, heading: a.heading, dir: dir4(a.heading), air: a.air, act: a.act ? a.act.name + ':' + (a.act.phase || '') : null, flip: a.flip, squash: a.squash, hatF: a.hatF, tip: a.tip } : null; }
      var o = {
        cam: S.camMode, blend: S.camBlendT, intro: S.intro ? S.intro.t : -1, paused: S.paused, running: S.running, time: S.time,
        me: A(me), mode: S.mode, over: S.over, scores: scoresView(), mapVer: S.mapVer, pitch: S.pitch,
        cpu: c ? Object.assign(A(c), { level: c.ai.level, steps: c.ai.steps, time: c.ai.time, plan: c.ai.plan ? c.ai.plan.length : -1, jumps: c.ai.jumps, attacks: c.ai.attacks, digs: c.ai.digs, replans: c.ai.replans }) : null,
        treasures: S.treasures.map(function (t) { return { x: t.x, z: t.z, h: S.heights[idx(t.x, t.z)], revealed: t.revealed, taken: t.taken, by: t.by }; }),
        remotes: Object.keys(S.remotes).map(function (k) { var r = S.remotes[k]; return { i: +k, x: r.wx, z: r.wz, y: r.y, heading: r.heading, flip: r.flip }; }),
        h: qx != null && S.level ? hAt(qx, qz) : null,
        debris: S.fx ? S.fx.parts.length : 0,
        hasSeekerModel: !!(me && !me.model._own),
        calls: S.renderer ? S.renderer.info.render.calls : 0,
        tris: S.renderer ? S.renderer.info.render.triangles : 0
      };
      return o;
    }
  };
  Object.defineProperty(World, 'isPaused', { get: function () { return S.paused; }, enumerable: true });
  Object.defineProperty(World, 'camera', { get: function () { return S.camMode; }, enumerable: true });
  window.World = World;
})();
