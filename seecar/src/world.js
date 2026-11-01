/* world.js — 3Dの世界（地形・戦車・操作・カメラ・大砲・破片・宝）
   公開するのは window.World だけ。THREE は r128 のグローバルを使う。 */
(function () {
  'use strict';

  // 見た目の高さ：1段 = STEP_H。高さ0と1は「紙に塗った色」（平ら）、2〜10が積み木。壁（10）は 9段 = 1.8 の高さ（約2マス分）。
  // 戦車が段差を上り下りする高さも、同じ vis() を使うので同じ尺度。
  var STEP_H = 0.2;
  function vis(h) { return h <= 1 ? 0 : (h - 1) * STEP_H; }
  var FLOOR_SAT = 1.9; // 床の色の鮮やかさ（1で元の色）
  var TANK_SCALE = 1.18; // 戦車の見た目の大きさ（第2期 r2：1.12→1.18。いちばん長い所 0.84×1.18≈0.99 で1マスにおさまる）
  var DX = [0, 1, 0, -1];
  var DZ = [-1, 0, 1, 0];
  var MOVE_DUR = 0.22, TURN_DUR = 0.2, BUMP_DUR = 0.28;
  var FIRE_CD = 0.8, BALL_DUR = 0.6;
  var CAM_BLEND = 0.9;
  // 第2期：止まっても砲塔はふりむかない（撃つ向きがいつも分かるように）。顔はCPUの戦車やねらいの印などで別に見せる
  var CPU_GAP = { easy: 1.2, normal: 0.6, hard: 0.28 }; // CPUの1手の間隔（秒）。第2期 r2：差がはっきり出るように広げた
  var CPU_DOUBT = { easy: 0.14, normal: 0.04, hard: 0 };  // まよう（立ち止まる・きょろきょろする）割合
  var CPU_WAIT0 = 0.4;   // 開始演出のあと、CPUが動き出すまでの間
  // 道さがし：壁を壊して進む手間。進む1手は1。第2期 r2：2→30。30マスまでの遠回りなら壊さずに通る。
  // 宝は囲まれているので最低限は壊すが、絵（字の線）をむだにくりぬかないように、いちばん薄い所を選ぶ
  var BREAK_COST = 30;
  var PITCH_MAX = 1;     // 視点の上下（-1〜+1）
  var INTRO_HOLD = 2.0, INTRO_MOVE = 1.8; // 開始演出：真上から2秒見せて、斜め後ろへ寄せる
  var DEBRIS_MAX = 900, PUFF_MAX = 48;
  var GEM_R = 0.55, GEM_Y = 1.15; // 宝石の大きさと高さ（遠くからでも目立つように大きく）

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

    // ドカンのギザギザ（黄色とオレンジのマンガ風の爆発）
    c = makeCanvas(256, 256); g = c.getContext('2d');
    function spiky(n, r0, r1, fill, stroke) {
      g.beginPath();
      for (var k = 0; k < n * 2; k++) {
        var ang = k / (n * 2) * Math.PI * 2 + rand(-0.06, 0.06);
        var rr = (k % 2 ? r0 : r1) * rand(0.85, 1.1);
        var px = 128 + Math.cos(ang) * rr, py = 128 + Math.sin(ang) * rr;
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath(); g.fillStyle = fill; g.fill();
      if (stroke) { g.lineWidth = 7; g.strokeStyle = stroke; g.stroke(); }
    }
    spiky(13, 70, 122, '#ff7a00', '#2b1a10');
    spiky(11, 48, 92, '#ffd21f', null);
    spiky(9, 26, 56, '#fffbe0', null);
    T.burst = new THREE.CanvasTexture(c);

    // 星（宝のきらきら）
    c = makeCanvas(64, 64); g = c.getContext('2d');
    g.translate(32, 32); g.beginPath();
    for (i = 0; i < 10; i++) { var rr2 = i % 2 ? 9 : 30, an = i / 10 * Math.PI * 2 - Math.PI / 2; g.lineTo(Math.cos(an) * rr2, Math.sin(an) * rr2); }
    g.closePath(); g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 8; g.fill();
    T.star = new THREE.CanvasTexture(c);

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
          .replace('#include <common>', '#include <common>\nattribute float aEdge;\nvarying vec3 vWP;\nvarying vec3 vNl;\nvarying float vEdge;\nvarying vec3 vCell;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + BLOCK_VERT);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nvarying vec3 vWP;\nvarying vec3 vNl;\nvarying float vEdge;\nvarying vec3 vCell;')
          .replace('#include <color_fragment>', '#include <color_fragment>\n' + BLOCK_FRAG);
      }
    };
    mat.customProgramCacheKey = function () { return 'seecar-crayon-' + mode; };
    return mat;
  }

  // ---------- 角の丸い箱 ----------
  function roundedBox(w, h, d, r) {
    var s = new THREE.Shape();
    var iw = w - 2 * r, ih = h - 2 * r, cr = Math.min(iw, ih) * 0.35;
    var x0 = -iw / 2, y0 = -ih / 2;
    s.moveTo(x0 + cr, y0);
    s.lineTo(x0 + iw - cr, y0); s.quadraticCurveTo(x0 + iw, y0, x0 + iw, y0 + cr);
    s.lineTo(x0 + iw, y0 + ih - cr); s.quadraticCurveTo(x0 + iw, y0 + ih, x0 + iw - cr, y0 + ih);
    s.lineTo(x0 + cr, y0 + ih); s.quadraticCurveTo(x0, y0 + ih, x0, y0 + ih - cr);
    s.lineTo(x0, y0 + cr); s.quadraticCurveTo(x0, y0, x0 + cr, y0);
    var geo = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 3, curveSegments: 4 });
    geo.center();
    return geo;
  }

  // ---------- 戦車 ----------
  var tankGeo = null;
  function starGeometry(r0, r1, depth) {
    var s = new THREE.Shape();
    for (var i = 0; i < 10; i++) { var r = i % 2 ? r1 : r0, a = i / 10 * Math.PI * 2 + Math.PI / 2; if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    var g = new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 });
    g.center(); return g;
  }
  function buildTankGeometry() {
    tankGeo = {
      body: roundedBox(0.5, 0.26, 0.74, 0.07),
      track: roundedBox(0.17, 0.2, 0.84, 0.07),
      wheel: new THREE.CylinderGeometry(0.075, 0.075, 0.03, 14),
      hub: new THREE.CylinderGeometry(0.035, 0.035, 0.035, 10),
      turret: new THREE.SphereGeometry(0.235, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
      ring: new THREE.CylinderGeometry(0.235, 0.245, 0.05, 22),
      barrel: new THREE.CylinderGeometry(0.048, 0.055, 0.38, 14),
      muzzle: new THREE.CylinderGeometry(0.068, 0.068, 0.07, 14),
      eye: new THREE.SphereGeometry(0.082, 14, 10),
      pupil: new THREE.SphereGeometry(0.042, 10, 8),
      shine: new THREE.SphereGeometry(0.013, 6, 5),
      cheek: new THREE.CircleGeometry(0.035, 12),
      hatch: new THREE.CylinderGeometry(0.07, 0.07, 0.03, 14),
      antenna: new THREE.CylinderGeometry(0.009, 0.009, 0.34, 5),
      flag: (function () { var sh = new THREE.Shape(); sh.moveTo(0, 0); sh.quadraticCurveTo(0.1, -0.01, 0.2, -0.045); sh.quadraticCurveTo(0.1, -0.075, 0, -0.11); sh.lineTo(0, 0); return new THREE.ShapeGeometry(sh); })(),
      glow: new THREE.PlaneGeometry(1.08, 1.08),
      knob: new THREE.SphereGeometry(0.03, 8, 6),
      shadow: new THREE.PlaneGeometry(1.05, 1.15),
      marker: new THREE.ConeGeometry(0.5, 0.9, 16),
      lamp: new THREE.SphereGeometry(0.035, 8, 6),
      star: starGeometry(0.075, 0.032, 0.02),
      fender: roundedBox(0.2, 0.05, 0.84, 0.022)
    };
    tankGeo.shadow.rotateX(-Math.PI / 2);
    tankGeo.glow.rotateX(-Math.PI / 2);
    tankGeo.marker.rotateX(Math.PI); // 下向きの矢印
  }

  function makeTank(colorStr) {
    var col = new THREE.Color(colorStr || '#e53935');
    var dark = col.clone().multiplyScalar(0.62);
    var light = col.clone().lerp(new THREE.Color('#ffffff'), 0.35);
    var mats = {
      main: new THREE.MeshStandardMaterial({ color: col, roughness: 0.32, metalness: 0.05, emissive: col.clone().multiplyScalar(0.16) }), // 白い紙の上でも黒い壁の前でも色がはっきり出るよう、少し自分で光らせる
      dark: new THREE.MeshStandardMaterial({ color: dark, roughness: 0.5 }),
      light: new THREE.MeshStandardMaterial({ color: light, roughness: 0.4 }),
      track: new THREE.MeshStandardMaterial({ color: 0x2e2f36, roughness: 0.8 }),
      wheel: new THREE.MeshStandardMaterial({ color: 0xcfd3da, roughness: 0.4, metalness: 0.2 }),
      white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }),
      black: new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.3 }),
      cheek: new THREE.MeshBasicMaterial({ color: 0xff8fa8, transparent: true, opacity: 0.85 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.3, emissive: 0x332200 }),
      shadow: new THREE.MeshBasicMaterial({ map: T.soft, color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false }),
      marker: new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, depthTest: false }),
      outline: new THREE.MeshBasicMaterial({ color: 0x1d1b22, side: THREE.BackSide }), // クレヨンでふちどりしたような黒い線
      flag: new THREE.MeshLambertMaterial({ color: col, side: THREE.DoubleSide, emissive: col.clone().multiplyScalar(0.25) }),
      glow: new THREE.MeshBasicMaterial({ map: T.soft, color: col, transparent: true, opacity: 0.42, depthWrite: false })
    };
    var G = tankGeo;
    var root = new THREE.Group();      // 位置・向き
    var bump = new THREE.Group();      // ぶつかる・反動の前後ゆれ
    var hull = new THREE.Group();      // 車体のゆれ
    root.add(bump); bump.add(hull);

    function M(geo, mat, x, y, z) { var m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); return m; }

    // キャタピラと車輪
    var wheels = [];
    [-1, 1].forEach(function (side) {
      var tr = M(G.track, mats.track, side * 0.31, 0.11, 0); hull.add(tr);
      var tro = M(G.track, mats.outline, side * 0.31, 0.11, 0); tro.scale.set(1.14, 1.1, 1.04); hull.add(tro);
      for (var k = 0; k < 3; k++) {
        var wz = -0.25 + k * 0.25;
        var wh = M(G.wheel, mats.wheel, side * 0.405, 0.11, wz); wh.rotation.z = Math.PI / 2; hull.add(wh); wheels.push(wh);
        var hb = M(G.hub, mats.dark, side * 0.41, 0.11, wz); hb.rotation.z = Math.PI / 2; hull.add(hb);
      }
    });
    // 泥よけ（キャタピラの上の丸い板）
    hull.add(M(G.fender, mats.light, -0.31, 0.225, 0)); hull.add(M(G.fender, mats.light, 0.31, 0.225, 0));
    // 車体
    var body = M(G.body, mats.main, 0, 0.28, 0); body.rotation.y = 0; hull.add(body);
    var bodyO = M(G.body, mats.outline, 0, 0.28, 0); bodyO.scale.set(1.07, 1.1, 1.05); hull.add(bodyO);
    // 後ろの黄色い星（おいかけ視点で見える。顔ではないので向きを取りちがえない）
    var backStar = M(G.star, mats.yellow, 0, 0.3, 0.375); hull.add(backStar);
    // 前のライト
    hull.add(M(G.lamp, mats.yellow, -0.2, 0.36, -0.36));
    hull.add(M(G.lamp, mats.yellow, 0.2, 0.36, -0.36));
    // 砲塔
    var turret = new THREE.Group(); turret.position.set(0, 0.41, 0.06); hull.add(turret);
    turret.add(M(G.ring, mats.dark, 0, 0.0, 0));
    var dome = M(G.turret, mats.main, 0, 0.02, 0); dome.scale.set(1, 0.95, 1.05); turret.add(dome);
    var domeO = M(G.turret, mats.outline, 0, 0.02, 0); domeO.scale.set(1.07, 1.02, 1.12); turret.add(domeO);
    turret.add(M(G.hatch, mats.light, 0, 0.24, 0.03));
    var ant = M(G.antenna, mats.track, 0.13, 0.32, 0.13); turret.add(ant);
    turret.add(M(G.knob, mats.yellow, 0.13, 0.5, 0.13));
    // 旗（チームの色）：遠くからでも、どちらの戦車か分かる
    var flag = M(G.flag, mats.flag, 0.13, 0.47, 0.13); flag.rotation.y = -Math.PI / 2; turret.add(flag); // 後ろへなびく
    // 顔（目とほっぺ）は砲塔＝頭の前に付ける（砲塔は ふりむかない）
    var eyes = new THREE.Group(); eyes.position.set(0, 0.175, -0.19); eyes.rotation.x = -0.35; turret.add(eyes);
    [-1, 1].forEach(function (side) {
      var e = M(G.eye, mats.white, side * 0.095, 0, 0); e.scale.set(0.9, 1.05, 0.55); eyes.add(e);
      var p = M(G.pupil, mats.black, side * 0.09, -0.005, -0.042); p.scale.set(1, 1.2, 0.6); eyes.add(p);
      var s = M(G.shine, mats.white, side * 0.078, 0.024, -0.063); s.scale.setScalar(1.3); eyes.add(s);
      var ck = M(G.cheek, mats.cheek, side * 0.175, -0.08, 0.03); ck.rotation.y = Math.PI - side * 0.6; eyes.add(ck);
    });
    // 砲身（少し上向き）
    var gun = new THREE.Group(); gun.position.set(0, 0.07, -0.1); gun.rotation.x = 0.12; turret.add(gun);
    var barrelPivot = new THREE.Group(); gun.add(barrelPivot);
    var barrel = M(G.barrel, mats.light, 0, 0, -0.19); barrel.rotation.x = Math.PI / 2; barrelPivot.add(barrel);
    var muzzle = M(G.muzzle, mats.dark, 0, 0, -0.38); muzzle.rotation.x = Math.PI / 2; barrelPivot.add(muzzle);
    // 足元の柔らかい影
    var shadow = new THREE.Mesh(G.shadow, mats.shadow); shadow.position.y = 0.012; shadow.renderOrder = 1; root.add(shadow);
    // 足元のチーム色の光（1マスの中）。白い紙の上で自分の戦車がすぐ見つかるように
    var glow = new THREE.Mesh(G.glow, mats.glow); glow.position.y = 0.016; glow.renderOrder = 2; root.add(glow);
    // 俯瞰のときの目じるし
    var marker = new THREE.Mesh(G.marker, mats.marker); marker.renderOrder = 10; marker.visible = false; root.add(marker);

    return {
      root: root, bump: bump, hull: hull, turret: turret, barrel: barrelPivot, wheels: wheels, eyes: eyes, marker: marker, mats: mats, flag: flag,
      colorStr: colorStr,
      x: 0, z: 0, y: 0, heading: 0, // 表示の位置（マス単位）
      wobble: 0, recoil: 0, blink: rand(1, 4), wheelRot: 0, moving: false, tilt: 0, hop: 0
    };
  }
  function disposeTank(tk) {
    if (!tk) return;
    if (tk.root.parent) tk.root.parent.remove(tk.root);
    for (var k in tk.mats) tk.mats[k].dispose();
  }
  function recolorTank(tk, colorStr) {
    var col = new THREE.Color(colorStr);
    tk.mats.main.color.copy(col);
    tk.mats.dark.color.copy(col).multiplyScalar(0.62);
    tk.mats.light.color.copy(col).lerp(new THREE.Color('#ffffff'), 0.35);
    tk.mats.marker.color.copy(col);
    tk.mats.main.emissive.copy(col).multiplyScalar(0.16);
    tk.mats.flag.color.copy(col); tk.mats.flag.emissive.copy(col).multiplyScalar(0.25);
    tk.mats.glow.color.copy(col);
    tk.colorStr = colorStr;
  }
  // 毎フレームの小さな動き（ゆれ・反動・まばたき・車輪）
  function animateTank(tk, dt, time) {
    var r = tk.root;
    r.position.set(tk.x + 0.5, tk.y, tk.z + 0.5);
    r.rotation.y = tk.heading;
    r.scale.setScalar(TANK_SCALE);
    var bob = tk.moving ? Math.sin(time * 34) * 0.018 : Math.sin(time * 2.2) * 0.006;
    tk.hull.position.y = bob;
    tk.hull.rotation.x = (tk.moving ? Math.sin(time * 17) * 0.035 : 0) + tk.recoil * 0.22 + tk.tilt;
    // 宝を見つけたときなどの小さなジャンプ
    if (tk.hop > 0) { tk.hop = Math.max(0, tk.hop - dt); tk.hull.position.y += Math.abs(Math.sin((1.6 - tk.hop) * 7)) * 0.25 * Math.min(1, tk.hop); }
    tk.wobble *= Math.exp(-dt * 6);
    tk.hull.rotation.z = Math.sin(time * 25) * tk.wobble * 0.15;
    if (tk.moving) tk.wheelRot += dt * 14;
    for (var i = 0; i < tk.wheels.length; i++) tk.wheels[i].rotation.x = tk.wheelRot;
    tk.barrel.position.z = tk.recoil * 0.12;
    tk.recoil = Math.max(0, tk.recoil - dt * 3.2);
    tk.blink -= dt;
    var ey = 1;
    if (tk.blink < 0.12) ey = 0.15;
    if (tk.blink < 0) tk.blink = rand(2, 5);
    tk.eyes.scale.y = ey;
    tk.turret.rotation.y = 0; // 砲塔はいつも車体と同じ前を向く（撃つ向き）
    tk.flag.rotation.y = -Math.PI / 2 + Math.sin(time * (tk.moving ? 11 : 4)) * (tk.moving ? 0.45 : 0.22); // 旗がはためく
  }

  // ---------- 状態 ----------
  var S = {
    inited: false, container: null, renderer: null, scene: null, camera: null, ro: null, onWinResize: null,
    raf: 0, running: false, paused: false, last: 0, time: 0,
    map: null, w: 0, h: 0, heights: null, colors: null, destroyed: null,
    level: null, // 地図ごとに作った物
    myIndex: 0, players: [], net: false,
    me: null, remotes: {}, held: {}, tapQ: {},
    camMode: 1, camBlendT: 1, camFrom: null, chaseLift: 0, intro: null, topFlag: null,
    shake: 0, stateAcc: 0, found: false, treasure: null,
    projectiles: [], fx: null,
    cpu: null, mapVer: 0, pitch: 0, pitchV: 0, aim: null
  };
  var handlers = { found: [], boom: [], state: [], fire: [], cam: [] };
  function emit(ev, a, b) {
    var list = handlers[ev]; if (!list) return;
    list.slice().forEach(function (fn) { try { fn(a, b); } catch (e) { console.warn('World handler error', e); } });
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
    if (!tankGeo) buildTankGeometry();
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

    // 明かり：やわらかい環境光＋左上からの日ざし
    sc.add(new THREE.HemisphereLight(0xffffff, 0xf0f0f2, 0.88)); // 色をつけない（壁は黒く、紙は白く見せる）
    var sun = new THREE.DirectionalLight(0xffffff, 0.5);
    sun.position.set(-0.55, 1, -0.4);
    sc.add(sun);
    // 爆発の光（いつも置いておき、明るさだけ変える）
    S.boomLight = new THREE.PointLight(0xffb040, 0, 9, 2);
    sc.add(S.boomLight);
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

  // ---------- 演出の部品（破片・煙・閃光・弾） ----------
  function buildFx() {
    var fx = {};
    // 破片：InstancedMesh 1つ
    var dg = new THREE.BoxGeometry(1, 1, 1);
    var dm = new THREE.MeshLambertMaterial({ map: T.crayon });
    fx.debris = new THREE.InstancedMesh(dg, dm, DEBRIS_MAX);
    fx.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    fx.debris.frustumCulled = false;
    var zero = new THREE.Matrix4().makeScale(0, 0, 0), white = new THREE.Color(1, 1, 1);
    for (var i = 0; i < DEBRIS_MAX; i++) { fx.debris.setMatrixAt(i, zero); fx.debris.setColorAt(i, white); }
    fx.debris.count = 0;
    S.scene.add(fx.debris);
    fx.parts = []; // {i, p, v, r, av, s, life, max}
    fx.free = []; for (i = DEBRIS_MAX - 1; i >= 0; i--) fx.free.push(i);
    // 煙・ほこり
    fx.puffs = [];
    for (i = 0; i < PUFF_MAX; i++) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.puff, color: 0xffffff, transparent: true, depthWrite: false, opacity: 0 }));
      sp.visible = false; S.scene.add(sp);
      fx.puffs.push({ sp: sp, life: 0, max: 1, v: new THREE.Vector3(), s0: 1, s1: 2, a0: 0.8 });
    }
    fx.puffNext = 0;
    // ドカン！の閃光（ギザギザ）
    fx.bursts = [];
    for (i = 0; i < 4; i++) {
      var bs = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.burst, transparent: true, depthWrite: false, depthTest: false }));
      bs.visible = false; bs.renderOrder = 20; S.scene.add(bs);
      var fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.soft, color: 0xfff1b0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      fl.visible = false; fl.renderOrder = 19; S.scene.add(fl);
      var rg = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 40), new THREE.MeshBasicMaterial({ color: 0xfaf6ee, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      rg.rotation.x = -Math.PI / 2; rg.visible = false; S.scene.add(rg);
      fx.bursts.push({ sp: bs, fl: fl, ring: rg, life: 0, max: 0.9, pos: new THREE.Vector3() });
    }
    fx.burstNext = 0;
    // 爆発で飛びちる黄色い星（完成予想図の「ドゴォーン！」のきらきら）
    fx.stars = [];
    for (i = 0; i < 24; i++) {
      var st = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.star, color: 0xffd23f, transparent: true, depthWrite: false }));
      st.visible = false; st.renderOrder = 18; S.scene.add(st);
      fx.stars.push({ sp: st, life: 0, max: 1, v: new THREE.Vector3(), s: 0.4 });
    }
    fx.starNext = 0;
    // 弾
    fx.ballGeo = new THREE.SphereGeometry(0.12, 16, 12);
    fx.ballMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1f, roughness: 0.25, metalness: 0.4 });
    fx.balls = [];
    for (i = 0; i < 6; i++) { var b = new THREE.Mesh(fx.ballGeo, fx.ballMat); b.visible = false; S.scene.add(b); fx.balls.push(b); }
    S.fx = fx;
  }
  function resetFx() {
    var fx = S.fx; if (!fx) return;
    var zero = new THREE.Matrix4().makeScale(0, 0, 0);
    fx.parts.forEach(function (p) { fx.debris.setMatrixAt(p.i, zero); fx.free.push(p.i); });
    fx.parts.length = 0; fx.debris.count = 0; fx.debris.instanceMatrix.needsUpdate = true;
    fx.puffs.forEach(function (p) { p.life = 0; p.sp.visible = false; });
    fx.bursts.forEach(function (b) { b.life = 0; b.sp.visible = b.fl.visible = b.ring.visible = false; });
    fx.balls.forEach(function (b) { b.visible = false; });
    fx.stars.forEach(function (p) { p.life = 0; p.sp.visible = false; });
    S.projectiles.length = 0;
    S.shake = 0;
    if (S.boomLight) S.boomLight.intensity = 0;
  }

  function spawnPuff(x, y, z, opt) {
    var fx = S.fx; opt = opt || {};
    var p = fx.puffs[fx.puffNext]; fx.puffNext = (fx.puffNext + 1) % fx.puffs.length;
    p.sp.position.set(x, y, z);
    p.sp.material.color.set(opt.color || 0xffffff);
    p.v.set(opt.vx || 0, opt.vy || 0.4, opt.vz || 0);
    p.life = p.max = opt.life || 0.8;
    p.s0 = opt.s0 || 0.3; p.s1 = opt.s1 || 0.9; p.a0 = opt.a == null ? 0.75 : opt.a;
    p.sp.scale.setScalar(p.s0); p.sp.material.opacity = p.a0; p.sp.visible = true;
  }

  var tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color(), tmpE2 = new THREE.Color();
  function spawnDebris(x, y, z, color, n, power) {
    var fx = S.fx;
    for (var k = 0; k < n; k++) {
      if (!fx.free.length) break;
      var i = fx.free.pop();
      var ang = Math.random() * Math.PI * 2, sp = rand(1.2, 4.2) * power;
      var part = {
        i: i,
        p: new THREE.Vector3(x + rand(-0.4, 0.4), y + rand(0, 0.5), z + rand(-0.4, 0.4)),
        v: new THREE.Vector3(Math.cos(ang) * sp, rand(3.5, 8.5) * power, Math.sin(ang) * sp),
        r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        av: new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12)),
        s: rand(0.1, 0.3), life: rand(1.6, 2.6), max: 0, rest: false
      };
      part.max = part.life;
      tmpC.copy(color);
      if (tmpC.r + tmpC.g + tmpC.b < 0.4) tmpC.lerp(tmpE2.set(0.3, 0.29, 0.3), 0.55); // 黒い壁の破片も、紙の上で見える濃い灰色に
      tmpC.offsetHSL(0, 0, rand(-0.07, 0.07));
      if (Math.random() < 0.12) tmpC.set(0xffd23f); // 少しだけ黄色い火花
      fx.debris.setColorAt(i, tmpC);
      fx.parts.push(part);
    }
    if (fx.debris.instanceColor) fx.debris.instanceColor.needsUpdate = true;
    fx.debris.count = DEBRIS_MAX;
  }

  function spawnStars(x, y, z, n) {
    var fx = S.fx;
    for (var k = 0; k < n; k++) {
      var p = fx.stars[fx.starNext]; fx.starNext = (fx.starNext + 1) % fx.stars.length;
      var a = Math.random() * Math.PI * 2, sp = rand(1.5, 3.5);
      p.sp.position.set(x, y + 0.3, z); p.v.set(Math.cos(a) * sp, rand(3, 6), Math.sin(a) * sp);
      p.life = p.max = rand(0.7, 1.1); p.s = rand(0.3, 0.55);
      p.sp.material.color.set(Math.random() < 0.3 ? 0xffffff : 0xffd23f);
      p.sp.visible = true;
    }
  }
  function spawnBurst(x, y, z, big) {
    var fx = S.fx;
    var b = fx.bursts[fx.burstNext]; fx.burstNext = (fx.burstNext + 1) % fx.bursts.length;
    b.pos.set(x, y, z); b.ground = groundTopAt(x, z); b.life = b.max = 0.9; b.big = big ? 1 : 0.55;
    b.sp.material.rotation = rand(-0.4, 0.4);
    b.sp.visible = b.fl.visible = b.ring.visible = true;
  }

  function updateFx(dt) {
    var fx = S.fx, i;
    // 破片
    if (fx.parts.length) {
      for (i = fx.parts.length - 1; i >= 0; i--) {
        var p = fx.parts[i];
        p.life -= dt;
        if (p.life <= 0) { fx.debris.setMatrixAt(p.i, tmpM.makeScale(0, 0, 0)); fx.free.push(p.i); fx.parts.splice(i, 1); continue; }
        if (!p.rest) {
          p.v.y -= 22 * dt;
          p.p.addScaledVector(p.v, dt);
          p.r.addScaledVector(p.av, dt);
          var gy = groundTopAt(p.p.x, p.p.z) + p.s * 0.5;
          if (p.p.y < gy) {
            p.p.y = gy;
            if (p.v.y < -2) { p.v.y *= -0.38; p.v.x *= 0.6; p.v.z *= 0.6; p.av.multiplyScalar(0.5); }
            else { p.v.set(0, 0, 0); p.rest = true; }
          }
        }
        var sc = p.s * Math.min(1, p.life / 0.45);
        tmpQ.setFromEuler(tmpE.set(p.r.x, p.r.y, p.r.z));
        tmpM.compose(p.p, tmpQ, tmpS.set(sc, sc, sc));
        fx.debris.setMatrixAt(p.i, tmpM);
      }
      fx.debris.instanceMatrix.needsUpdate = true;
      if (!fx.parts.length) fx.debris.count = 0;
    }
    // 煙
    for (i = 0; i < fx.puffs.length; i++) {
      var q = fx.puffs[i]; if (q.life <= 0) continue;
      q.life -= dt;
      if (q.life <= 0) { q.sp.visible = false; continue; }
      var t = 1 - q.life / q.max;
      q.sp.position.addScaledVector(q.v, dt); q.v.multiplyScalar(Math.exp(-dt * 2.5));
      q.sp.scale.setScalar(q.s0 + (q.s1 - q.s0) * (1 - Math.pow(1 - t, 2)));
      q.sp.material.opacity = q.a0 * (1 - t);
    }
    // 閃光
    for (i = 0; i < fx.bursts.length; i++) {
      var b = fx.bursts[i]; if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) { b.sp.visible = b.fl.visible = b.ring.visible = false; continue; }
      var u = 1 - b.life / b.max;
      var k1 = clamp(u / 0.12, 0, 1);
      var s1 = (0.8 + 1.7 * (1 - Math.pow(1 - k1, 3))) * b.big;
      b.sp.position.set(b.pos.x, b.pos.y + 0.9 * b.big, b.pos.z);
      b.sp.scale.set(s1, s1, 1);
      b.sp.material.opacity = u < 0.3 ? 1 : Math.max(0, 1 - (u - 0.3) / 0.25);
      b.sp.material.rotation += dt * 0.6;
      b.fl.position.copy(b.sp.position);
      var fs = 5.5 * b.big * (0.4 + u);
      b.fl.scale.set(fs, fs, 1);
      b.fl.material.opacity = Math.max(0, 1 - u * 2.4);
      b.ring.position.set(b.pos.x, b.ground + 0.06, b.pos.z);
      var rs = (0.6 + u * 3.4) * b.big * 1.2;
      b.ring.scale.set(rs, rs, rs);
      b.ring.material.opacity = 0.85 * (1 - u);
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
    if (S.boomLight.intensity > 0) S.boomLight.intensity = Math.max(0, S.boomLight.intensity - dt * 9);
  }

  // ---------- 地図 ----------
  function idx(x, z) { return z * S.w + x; }
  function inMap(x, z) { return x >= 0 && z >= 0 && x < S.w && z < S.h; }
  function hAt(x, z) { return inMap(x, z) ? S.heights[idx(x, z)] : 0; }
  function groundTopAt(wx, wz) { var x = Math.floor(wx), z = Math.floor(wz); return inMap(x, z) ? vis(S.heights[idx(x, z)]) : 0; }
  function cellColor(i, out) { return out.setRGB(S.colors[i * 3] / 255, S.colors[i * 3 + 1] / 255, S.colors[i * 3 + 2] / 255); }

  function clearLevel() {
    resetFx();
    var L = S.level; if (!L) return;
    L.objects.forEach(function (o) { if (o.parent) o.parent.remove(o); });
    L.dispose.forEach(function (d) { try { d.dispose(); } catch (e) { } });
    if (S.me) disposeTank(S.me.tank);
    if (S.cpu) disposeTank(S.cpu.tank);
    for (var k in S.remotes) disposeTank(S.remotes[k].tank);
    S.level = null; S.me = null; S.cpu = null; S.remotes = {}; S.map = null; S.treasure = null; S.aim = null;
    if (S.gemLight) S.gemLight.intensity = 0;
  }

  function load(map, opts) {
    if (!S.inited) { if (S.container) init(S.container); else throw new Error('World.init を先に呼んでください'); }
    clearLevel();
    opts = opts || {};
    S.map = map; S.w = map.w; S.h = map.h;
    S.heights = new Uint8Array(map.heights); // 自分用の写し（破壊で書きかえる）
    S.colors = map.colors;
    S.destroyed = new Uint8Array(S.w * S.h);
    S.myIndex = opts.myIndex || 0;
    S.players = opts.players || [{ color: '#e53935' }, { color: '#1e88e5' }];
    S.net = !!opts.net;
    S.found = false; S.held = {}; S.tapQ = {}; S.stateAcc = 0; S.shake = 0; S.mapVer = 0;
    S.pitch = 0; S.pitchV = 0;
    var L = S.level = { objects: [], dispose: [] };
    function add(o) { S.scene.add(o); L.objects.push(o); return o; }

    buildTerrain(L, add);
    buildFloor(L, add);
    buildTreasure(L, add);

    // 自分の戦車
    var st = (map.starts && map.starts[S.myIndex]) || { x: 1, z: 1, dir: 0 };
    var tk = makeTank(S.players[S.myIndex] ? S.players[S.myIndex].color : '#e53935');
    add(tk.root);
    S.me = makeActor(tk, st, S.myIndex);
    buildAim(L, add, tk.colorStr);
    // CPUの戦車（プレイヤー1・青）。通信とは一緒に使わない
    var cpuOpt = opts.cpu && !S.net ? opts.cpu : null;
    if (cpuOpt) {
      var ci = S.myIndex === 1 ? 0 : 1;
      var cs = (map.starts && map.starts[ci]) || { x: Math.min(S.w - 1, st.x + 2), z: st.z, dir: st.dir || 0 };
      var ctk = makeTank(S.players[ci] ? S.players[ci].color : '#1e88e5');
      add(ctk.root);
      S.cpu = makeActor(ctk, cs, ci);
      var lv = CPU_GAP[cpuOpt.level] ? cpuOpt.level : 'normal';
      S.cpu.ai = { level: lv, gap: CPU_GAP[lv], wait: CPU_WAIT0, plan: null, ver: -1, bumps: 0, started: false, steps: 0, time: 0 };
    }
    // 相手の戦車（通信のときは最初からスタート位置に置く）
    if (S.net) {
      for (var p = 0; p < S.players.length; p++) {
        if (p === S.myIndex) continue;
        var s2 = (map.starts && map.starts[p]) || st;
        ensureRemote(p, { x: s2.x, z: s2.z, dir: s2.dir || 0, color: S.players[p] && S.players[p].color, anim: 'idle' }, true);
      }
    }
    // カメラ（いまのモードへすぐ合わせる）
    S.camBlendT = 1; S.chaseLift = 0;
    var far = overheadHeight() * 1.6 + 60;
    S.camera.far = far; S.camera.updateProjectionMatrix();
    // 開始演出：まず真上から地図全体と宝を見せる（updateCamera が、のち斜め後ろへ寄せる）
    S.camMode = 1; S.intro = { t: 0 }; S.topFlag = null; // 開始演出のあと斜め後ろ（1）へ
    var pose = poseFor(2);
    S.camera.position.copy(pose.p); S.camera.quaternion.copy(pose.q);
    fitNear();
    if (!S.running) render();
  }

  // 積み木の色：地図の色を少し鮮やかに。明るさが低い（黒に近い）色だけ、ほぼ真っ黒にする。
  // 高さ10（壁）のマスは、色の平均（字のふちはカーキや灰色になる）ではなく、いつも黒で塗る。
  // 高さは「その画素でいちばん濃い色」で決めているので、壁の縁のマスは平均色が明るく出てしまうため。
  var hsl = { h: 0, s: 0, l: 0 };
  var WALL_RGB = [0.18, 0.18, 0.2]; // 上の面＝こい灰色、側面（下の陰影で約0.6倍）＝ほぼ黒
  // 第2期：高さ9以下でも、高い（8以上）か暗い色のマスは黒系に。くすんだ色（カーキ・灰色）は高さに応じて黒へ寄せ、
  // 「壁と同じくらい高いカーキ色の積み木」を残さない（高さは画素のいちばん濃い色で決まるので、平均色が明るく出ることがある）
  function blockColor(c, hh) {
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
      blockColor(c, hh);
      mesh.setColorAt(k, c);
      edgeArr[k] = edgeMask(x, z);
      cellToInst[i] = k++;
    }
    if (n === 0) { mesh.setMatrixAt(0, m.makeScale(0, 0, 0)); mesh.setColorAt(0, c.set(1, 1, 1)); }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    add(mesh);
    L.terrain = mesh; L.cellToInst = cellToInst; L.edgeAttr = edgeAttr;
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
      if (S.destroyed[i]) { r = 232; g = 225; b = 212; } // 壊したあと：消しゴムでこすったような跡
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

  function buildTreasure(L, add) {
    var t = S.map.treasure; if (!t) return;
    var g = new THREE.Group();
    g.position.set(t.x + 0.5, vis(hAt(t.x, t.z)), t.z + 0.5);
    var gemGeo = new THREE.OctahedronGeometry(GEM_R, 0);
    var gemMat = new THREE.MeshStandardMaterial({ color: 0xff4fb0, emissive: 0xb01070, emissiveIntensity: 0.95, roughness: 0.12, metalness: 0.25, flatShading: true });
    var gem = new THREE.Mesh(gemGeo, gemMat); gem.scale.set(1, 1.35, 1); gem.position.y = GEM_Y;
    g.add(gem);
    var glowMat = new THREE.SpriteMaterial({ map: T.soft, color: 0xff6cc4, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 });
    var glow = new THREE.Sprite(glowMat); glow.scale.set(4, 4, 1); glow.position.y = GEM_Y; g.add(glow);
    // 光の柱
    var bh = 90;
    // v4：太く・濃くして、出発した所（20マス以上はなれた所）からでも空にピンクの柱が見えるように
    var beamGeo = new THREE.CylinderGeometry(1.5, 1.5, bh, 24, 1, true); beamGeo.translate(0, bh / 2, 0);
    var beamMat = new THREE.MeshBasicMaterial({ map: T.beam, color: 0xff3fa8, opacity: 0.72, transparent: true, depthWrite: false, side: THREE.DoubleSide }); // 空が明るいので、足し算でなく ふつうの重ね（ピンクのまま見える）
    var beam = new THREE.Mesh(beamGeo, beamMat); g.add(beam);
    var beam2Geo = new THREE.CylinderGeometry(0.55, 0.55, bh, 14, 1, true); beam2Geo.translate(0, bh / 2, 0);
    var beam2Mat = new THREE.MeshBasicMaterial({ map: T.beam, color: 0xff8fd0, opacity: 0.9, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    var beam2 = new THREE.Mesh(beam2Geo, beam2Mat); g.add(beam2);
    // きらきら
    var sparks = [];
    var starMat = new THREE.SpriteMaterial({ map: T.star, color: 0xfff6a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    for (var i = 0; i < 6; i++) { var s = new THREE.Sprite(starMat); s.scale.setScalar(0.4); g.add(s); sparks.push(s); }
    // 俯瞰のための大きな目じるし（光の輪）
    var far = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.star, color: 0xff3fa8, transparent: true, depthWrite: false, depthTest: false }));
    far.renderOrder = 9; far.visible = false; g.add(far);
    // 目じるしの星：壁のむこうでも見える（おいかけ・1人称のとき、柱の上のほうで光る）
    var beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.star, color: 0xff3fa8, transparent: true, depthWrite: false, depthTest: false }));
    beacon.renderOrder = 9; beacon.position.y = 4.2; g.add(beacon);
    var beaconGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.soft, color: 0xffffff, transparent: true, depthWrite: false, depthTest: false, opacity: 0.9 }));
    beaconGlow.renderOrder = 8; beaconGlow.position.y = 4.2; g.add(beaconGlow);
    add(g);
    S.treasure = { group: g, gem: gem, glow: glow, sparks: sparks, far: far, beacon: beacon, beaconGlow: beaconGlow, beam: beam, x: t.x, z: t.z, celebrate: 0 };
    S.gemLight.position.set(t.x + 0.5, g.position.y + 1.4, t.z + 0.5);
    S.gemLight.intensity = 2.2;
    L.dispose.push(gemGeo, gemMat, glowMat, beamGeo, beamMat, beam2Geo, beam2Mat, starMat, far.material, beacon.material, beaconGlow.material);
  }

  function updateTreasure(dt) {
    var tr = S.treasure; if (!tr) return;
    var t = S.time;
    tr.gem.rotation.y += dt * 1.6;
    var c = tr.celebrate; if (c > 0) tr.celebrate = Math.max(0, c - dt);
    tr.gem.position.y = GEM_Y + Math.sin(t * 2.4) * 0.14 + (c > 0 ? Math.sin((1.5 - c) * 6) * 0.5 + 0.4 : 0);
    var pulse = 3.6 + Math.sin(t * 4) * 0.45 + (c > 0 ? 2.5 : 0);
    tr.glow.position.y = tr.gem.position.y;
    tr.glow.scale.set(pulse, pulse, 1);
    S.gemLight.intensity = 1.6 + Math.sin(t * 4) * 0.4;
    for (var i = 0; i < tr.sparks.length; i++) {
      var a = t * 1.3 + i / tr.sparks.length * Math.PI * 2;
      var r = 1.0 + (c > 0 ? 0.8 : 0);
      tr.sparks[i].position.set(Math.cos(a) * r, GEM_Y + Math.sin(t * 3 + i) * 0.6, Math.sin(a) * r);
      var ss = 0.3 + 0.22 * Math.abs(Math.sin(t * 5 + i * 1.7));
      tr.sparks[i].scale.set(ss, ss, 1);
    }
    // 遠くからでも見える光（カメラが高いほど大きく）
    var camH = S.camera.position.y;
    // 目じるしの星：遠いほど大きく（画面の上でいつも同じくらいの大きさ）。近くに来たら消える
    var gp = tr.group.position, dcam = Math.hypot(S.camera.position.x - gp.x, S.camera.position.z - gp.z);
    var bv = camH <= 7 && dcam > 5;
    tr.beacon.visible = tr.beaconGlow.visible = bv;
    if (bv) {
      var bs = clamp(dcam * 0.055, 0.8, 3.2) * (1 + 0.12 * Math.sin(t * 5)), bo = clamp((dcam - 5) / 3, 0, 1);
      tr.beacon.scale.set(bs, bs, 1); tr.beacon.material.rotation = Math.sin(t * 2) * 0.3; tr.beacon.material.opacity = bo;
      tr.beaconGlow.scale.set(bs * 1.5, bs * 1.5, 1); tr.beaconGlow.material.opacity = 0.8 * bo;
      tr.beacon.position.y = tr.beaconGlow.position.y = 3.6 + clamp(dcam * 0.04, 0, 2) + Math.sin(t * 2.4) * 0.15;
    }
    tr.far.visible = camH > 7;
    if (tr.far.visible) { var fs = camH * 0.11 * (1 + 0.12 * Math.sin(t * 5)); tr.far.material.rotation = Math.sin(t * 2) * 0.3; tr.far.scale.set(fs, fs, 1); tr.far.position.y = 0.8; tr.far.material.opacity = clamp((camH - 7) / 6, 0, 1); }
  }

  // ---------- 破壊 ----------
  function destroyCells(cells, withFx) {
    var L = S.level; if (!L) return [];
    var done = [], zero = new THREE.Matrix4().makeScale(0, 0, 0), c = new THREE.Color(), changed = false;
    var cx = 0, cz = 0, cy = 0, cnt = 0, dirty = [];
    for (var k = 0; k < cells.length; k++) {
      var x = cells[k][0] | 0, z = cells[k][1] | 0;
      if (!inMap(x, z)) continue;
      var i = idx(x, z), hh = S.heights[i];
      if (hh > 0) done.push([x, z]); // 実際に壊したマスだけ
      cx += x + 0.5; cz += z + 0.5; cy = Math.max(cy, vis(hh)); cnt++;
      if (withFx) {
        cellColor(i, c);
        if (hh > 0) {
          blockColor(c, hh); // 積み木と同じ色の破片
          spawnDebris(x + 0.5, vis(hh) * 0.5, z + 0.5, c, Math.min(110, 34 + hh * 8), 1);
          spawnStars(x + 0.5, Math.max(0.4, vis(hh)), z + 0.5, 8);
          for (var p = 0; p < 3; p++) spawnPuff(x + 0.5 + rand(-0.4, 0.4), vis(hh) * rand(0.2, 0.9) + 0.1, z + 0.5 + rand(-0.4, 0.4), { color: 0xdedad2, vx: rand(-1, 1), vy: rand(0.8, 2), vz: rand(-1, 1), s0: 0.6, s1: 2.4, life: 1.4, a: 0.85 });
        } else {
          spawnDebris(x + 0.5, 0.05, z + 0.5, c.lerp(new THREE.Color(0x9a9080), 0.2), 8, 0.6);
          spawnPuff(x + 0.5, 0.3, z + 0.5, { color: 0xe8e2d6, vy: 1, s0: 0.5, s1: 1.8, life: 1 });
        }
      }
      if (hh > 0) {
        S.heights[i] = 0; S.destroyed[i] = 1; changed = true;
        var inst = L.cellToInst[i];
        if (inst >= 0) L.terrain.setMatrixAt(inst, zero); // そのマスの行列だけ更新
        for (var dd = 0; dd < 4; dd++) { // となりの積み木に、新しく出たふちのハイライトを足す
          var ex = x + DX[dd], ez = z + DZ[dd];
          if (!inMap(ex, ez)) continue;
          var ni = L.cellToInst[idx(ex, ez)];
          if (ni >= 0 && S.heights[idx(ex, ez)] > 1) { L.edgeAttr.array[ni] = edgeMask(ex, ez); L.edgeAttr.needsUpdate = true; }
        }
        dirty.push(x, z);
      }
    }
    if (changed) { L.terrain.instanceMatrix.needsUpdate = true; paintFloor(dirty); S.mapVer++; }
    if (withFx && cnt) {
      cx /= cnt; cz /= cnt;
      spawnBurst(cx, Math.max(0.3, cy * 0.5), cz, true);
      S.boomLight.position.set(cx, cy + 1.5, cz); S.boomLight.intensity = 4;
      // 画面ゆれ（近いほど強い）
      var me = S.me ? S.me.tank : null;
      var dist = me ? Math.hypot(me.x + 0.5 - cx, me.z + 0.5 - cz) : 4;
      S.shake = Math.max(S.shake, clamp(0.55 - dist * 0.03, 0.18, 0.55));
      sfx('boom');
    }
    return done;
  }

  // ---------- 戦車の動き（自分もCPUも同じ） ----------
  // actor: {idx, tank, cx, cz, dir, move, turn, bump, bumpCd, fireCd, fireAnim, shots}
  function makeActor(tk, st, i) {
    var a = { idx: i, tank: tk, cx: st.x, cz: st.z, dir: ((st.dir | 0) % 4 + 4) % 4, move: null, turn: null, bump: null, bumpCd: 0, fireCd: 0, fireAnim: 0, shots: 0 };
    tk.x = st.x; tk.z = st.z; tk.y = vis(hAt(st.x, st.z)); tk.heading = dirToHeading(a.dir);
    return a;
  }
  function actorFree(a) { return !a.move && !a.turn && !a.bump; }

  function press(action, isDown) {
    if (['fwd', 'back', 'left', 'right', 'fire'].indexOf(action) < 0) return;
    if (!isDown) { S.held[action] = false; return; }
    if (S.paused) return;
    // ひだり・みぎ：押しつづけても回りつづけない（1回押すと90度だけ）。押したままの重ね押しは数えない
    if ((action === 'left' || action === 'right') && S.held[action]) return;
    S.held[action] = true;
    S.tapQ[action] = true;
  }
  function want(a) { return S.held[a] || S.tapQ[a]; }

  // 進行中の動き（移動・回転・ぶつかり）を進める
  function stepActor(a, dt) {
    var tk = a.tank;
    a.fireCd = Math.max(0, a.fireCd - dt);
    a.fireAnim = Math.max(0, a.fireAnim - dt);
    a.bumpCd = Math.max(0, a.bumpCd - dt);
    tk.tilt *= Math.exp(-dt * 10);
    if (a.move) {
      var mv = a.move; mv.t += dt;
      var u = clamp(mv.t / mv.dur, 0, 1);
      tk.x = mv.fx + (mv.tx - mv.fx) * u;
      tk.z = mv.fz + (mv.tz - mv.fz) * u;
      var drop = mv.fy - mv.ty;
      if (drop > 0.25) {
        // 高い所から降りる：ふちまで進み、前へ少し傾きながら（重力のように）すとんと落ちる
        var fu = clamp((u - 0.38) / 0.62, 0, 1);
        tk.y = mv.fy - drop * fu * fu;
        tk.tilt = -0.32 * Math.sin(fu * Math.PI);
      } else {
        // 小さな段差：前半は平らに進み、ふちで滑らかに上り下り
        var su = clamp((u - 0.25) / 0.5, 0, 1);
        tk.y = mv.fy + (mv.ty - mv.fy) * ease(su);
      }
      if (u >= 1) {
        a.move = null; a.cx = mv.tx; a.cz = mv.tz; tk.x = mv.tx; tk.z = mv.tz; tk.y = mv.ty;
        if (drop > 0.25) {
          tk.wobble = Math.min(1, 0.4 + drop * 0.35); tk.tilt = 0.12;
          for (var k = 0; k < 4; k++) spawnPuff(tk.x + 0.5 + rand(-0.4, 0.4), tk.y + 0.08, tk.z + 0.5 + rand(-0.4, 0.4), { color: 0xf3eee4, vx: rand(-1, 1), vy: 0.4, vz: rand(-1, 1), s0: 0.3, s1: 0.9, life: 0.6, a: 0.65 });
          if (a === S.me) S.shake = Math.max(S.shake, clamp(drop * 0.08, 0.04, 0.14));
        }
        checkFound(a);
      }
    } else if (a.turn) {
      var tn = a.turn; tn.t += dt;
      var v = clamp(tn.t / TURN_DUR, 0, 1);
      tk.heading = tn.from + (tn.to - tn.from) * ease(v);
      if (v >= 1) { a.turn = null; tk.heading = tn.to; }
    } else if (a.bump) {
      var bp = a.bump; bp.t += dt;
      var w = clamp(bp.t / BUMP_DUR, 0, 1);
      var off = Math.sin(w * Math.PI) * 0.16 * (w < 0.5 ? 1 : 0.6);
      tk.bump.position.set(0, 0, -off * bp.sign);
      if (w >= 1) { a.bump = null; tk.bump.position.set(0, 0, 0); a.bumpCd = 0.18; }
    }
    if (actorFree(a)) {
      var groundY = vis(hAt(a.cx, a.cz));
      tk.y += (groundY - tk.y) * Math.min(1, dt * 12); // 足元が壊れたら下りる
    }
    tk.moving = !!a.move;
  }

  function updateMe(dt) {
    var me = S.me; if (!me) return;
    stepActor(me, dt);
    if (S.found) { S.tapQ = {}; return; } // どちらかが見つけたら止める
    // 大砲（いつでも撃てる。間隔0.8秒）
    if (want('fire')) {
      S.tapQ.fire = false;
      if (me.fireCd <= 0) fire(me);
    }
    if (actorFree(me)) {
      if (want('fwd')) { S.tapQ.fwd = false; tryMove(me, 1); }
      else if (want('back')) { S.tapQ.back = false; tryMove(me, -1); }
      else if (S.tapQ.left) { S.tapQ.left = false; startTurn(me, -1); }   // 回転は押した回数だけ（押しっぱなしでは続けない）
      else if (S.tapQ.right) { S.tapQ.right = false; startTurn(me, 1); }
    }
  }

  // 進めるか：登りは1段まで、降りは何段でも
  function canStep(fromH, toH) { return toH - fromH <= 1; }
  function tryMove(a, sign) {
    var tk = a.tank;
    var tx = a.cx + DX[a.dir] * sign, tz = a.cz + DZ[a.dir] * sign;
    var cur = hAt(a.cx, a.cz);
    if (!inMap(tx, tz) || !canStep(cur, hAt(tx, tz))) {
      if (a.bumpCd > 0) return false;
      a.bump = { t: 0, sign: sign };
      tk.wobble = 1;
      if (a === S.me) sfx('bump');
      return false;
    }
    var ty = vis(hAt(tx, tz)), drop = tk.y - ty;
    a.move = { fx: a.cx, fz: a.cz, tx: tx, tz: tz, fy: tk.y, ty: ty, t: 0, dur: MOVE_DUR + (drop > 0.25 ? Math.min(0.12, drop * 0.07) : 0) };
    // 走るときのほこり
    spawnPuff(tk.x + 0.5 - DX[a.dir] * 0.4 * sign, tk.y + 0.1, tk.z + 0.5 - DZ[a.dir] * 0.4 * sign, { color: 0xf3eee4, vy: 0.3, s0: 0.25, s1: 0.75, life: 0.6, a: 0.6 });
    if (a === S.me) sfx('move');
    return true;
  }
  function startTurn(a, s) {
    var tk = a.tank;
    a.dir = (a.dir + s + 4) % 4;
    a.turn = { from: tk.heading, to: tk.heading - s * Math.PI / 2, t: 0 };
    if (a === S.me) sfx('turn');
  }
  function checkFound(a) {
    if (S.found || !S.treasure) return;
    if (a.cx === S.treasure.x && a.cz === S.treasure.z) {
      S.found = true;
      S.treasure.celebrate = 1.5;
      a.tank.hop = 1.6;
      sfx('found');
      emit('found', a.idx);
    }
  }

  // 大砲のねらい：向いている方向の1マス先→2マス先の順に見て、最初の高さ1以上のマス。どちらも0なら2マス先（何も壊さない）
  function aimFrom(cx, cz, d) {
    for (var k = 1; k <= 2; k++) {
      var x = cx + DX[d] * k, z = cz + DZ[d] * k;
      if (inMap(x, z) && S.heights[idx(x, z)] >= 1) return { x: x, z: z, hit: true };
    }
    return { x: cx + DX[d] * 2, z: cz + DZ[d] * 2, hit: false };
  }
  function fire(a) {
    var tk = a.tank;
    a.fireCd = FIRE_CD; a.fireAnim = 0.35;
    tk.recoil = 1;
    var bx = Math.round(tk.x), bz = Math.round(tk.z), d = a.dir;
    var aim = aimFrom(bx, bz, d);
    var cells = aim.hit ? [[aim.x, aim.z]] : [];
    shootBall(tk.x, tk.z, tk.y, d, [aim.x, aim.z], cells, a !== S.me, a);
    if (a === S.me) {
      sfx('fire');
      // 発射のしらせ（通信のときは、これを相手へ1回だけ送る）。CPUの発射は知らせない
      emit('fire', { cells: cells, from: { x: Math.round(tk.x * 100) / 100, z: Math.round(tk.z * 100) / 100, dir: d } });
    } else sfx('fire');
  }
  // 弾を飛ばす。px,pz は撃つ戦車の位置（マス単位の小数）、target は着弾のマス、cells は壊すマス（0か1個）。
  function shootBall(px, pz, py, d, target, cells, remote, owner) {
    var fwdx = DX[d], fwdz = DZ[d];
    var tx = target[0], tz = target[1];
    var from = new THREE.Vector3(px + 0.5 + fwdx * 0.5, py + 0.55, pz + 0.5 + fwdz * 0.5);
    var to = new THREE.Vector3(tx + 0.5, groundTopAt(tx + 0.5, tz + 0.5), tz + 0.5);
    var apex = Math.max(from.y, to.y) + 1.3;
    var ball = S.fx.balls.find(function (b) { return !b.visible; }) || S.fx.balls[0];
    ball.visible = true; ball.position.copy(from);
    if (owner) owner.shots++;
    S.projectiles.push({ ball: ball, from: from, to: to, arc: apex - (from.y + to.y) / 2, t: 0, cells: cells || [], trail: 0, remote: !!remote, owner: owner || null });
    // 発射のけむり
    spawnPuff(from.x, from.y, from.z, { color: 0xffffff, vx: fwdx * 1.5, vy: 0.6, vz: fwdz * 1.5, s0: 0.3, s1: 1.1, life: 0.6, a: 0.9 });
    spawnPuff(from.x, from.y, from.z, { color: 0xffe08a, vx: fwdx * 0.5, vy: 0.2, vz: fwdz * 0.5, s0: 0.35, s1: 0.6, life: 0.18, a: 1 });
    if (remote && !owner) sfx('fire');
  }

  function updateProjectiles(dt) {
    for (var i = S.projectiles.length - 1; i >= 0; i--) {
      var pr = S.projectiles[i];
      pr.t += dt;
      var u = clamp(pr.t / BALL_DUR, 0, 1);
      pr.ball.position.lerpVectors(pr.from, pr.to, u);
      pr.ball.position.y += 4 * pr.arc * u * (1 - u);
      pr.trail -= dt;
      if (pr.trail <= 0) { pr.trail = 0.05; spawnPuff(pr.ball.position.x, pr.ball.position.y, pr.ball.position.z, { color: 0xe6e6e6, vy: 0.1, s0: 0.12, s1: 0.4, life: 0.5, a: 0.55 }); }
      if (u >= 1) {
        pr.ball.visible = false;
        S.projectiles.splice(i, 1);
        if (pr.owner) pr.owner.shots = Math.max(0, pr.owner.shots - 1);
        var done = destroyCells(pr.cells, true);
        if (!done.length) {
          // 何も壊さなかった：床に落ちて小さな土ぼこり
          spawnPuff(pr.to.x, pr.to.y + 0.15, pr.to.z, { color: 0xe8e2d6, vy: 0.8, s0: 0.4, s1: 1.4, life: 0.8, a: 0.8 });
          spawnPuff(pr.to.x, pr.to.y + 0.1, pr.to.z, { color: 0xd8d2c6, vx: 0.6, vy: 0.3, s0: 0.3, s1: 1.0, life: 0.6, a: 0.6 });
          sfx('bump');
        }
        emit('boom', done, pr.remote);
      }
    }
  }

  // ---------- ねらいの印（自分の戦車の弾が落ちるマス） ----------
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
    var mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(colorStr || '#e53935'), transparent: true, depthWrite: false, opacity: 0.95 });
    var mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 3; mesh.visible = false;
    add(mesh);
    L.dispose.push(tex, geo, mat);
    S.aim = { mesh: mesh, mat: mat, base: new THREE.Color(colorStr || '#e53935') };
  }
  function updateAim() {
    var A = S.aim, me = S.me; if (!A || !me) return;
    var show = S.camMode !== 2 && !S.intro && !S.found && !me.move;
    A.mesh.visible = show;
    if (!show) return;
    var aim = aimFrom(me.cx, me.cz, me.dir);
    var top = inMap(aim.x, aim.z) ? vis(S.heights[idx(aim.x, aim.z)]) : 0;
    var pulse = 1 + Math.sin(S.time * 6) * 0.05;
    A.mesh.position.set(aim.x + 0.5, top + 0.03, aim.z + 0.5);
    A.mesh.scale.set(0.96 * pulse, 1, 0.96 * pulse);
    // 壊せるブロックをねらっているときは自分の色、何もないときは白くうすく
    if (aim.hit) { A.mat.color.copy(A.base); A.mat.opacity = 0.95; } else { A.mat.color.set(0xffffff); A.mat.opacity = 0.55; }
  }

  // ---------- CPU ----------
  // 道さがし：状態＝(マス, 向き, いまのマスを壊して入ったか)。手＝左回り・右回り・前へ（1）、壊して前へ（1+BREAK_COST）。
  // 登りは1段・降りは自由。前のマスが登れない高さなら、大砲で壊して（高さ0にして）入る。いちばん手数の少ない道を選ぶ。
  var heap = null;
  function planPath(a) {
    var w = S.w, h = S.h, N = w * h * 8, H = S.heights, T0 = S.treasure;
    if (!T0) return null;
    var dist = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), act = new Uint8Array(N);
    heap = { k: [], v: [] };
    function push(st, d) {
      var hk = heap.k, hv = heap.v, i = hk.length; hk.push(d); hv.push(st);
      while (i > 0) { var p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; var t = hk[p]; hk[p] = hk[i]; hk[i] = t; t = hv[p]; hv[p] = hv[i]; hv[i] = t; i = p; }
    }
    function pop() {
      var hk = heap.k, hv = heap.v, top = hv[0], last = hk.length - 1;
      hk[0] = hk[last]; hv[0] = hv[last]; hk.pop(); hv.pop();
      var i = 0, n = hk.length;
      for (;;) { var l = i * 2 + 1, r = l + 1, m = i; if (l < n && hk[l] < hk[m]) m = l; if (r < n && hk[r] < hk[m]) m = r; if (m === i) break; var t = hk[m]; hk[m] = hk[i]; hk[i] = t; t = hv[m]; hv[m] = hv[i]; hv[i] = t; i = m; }
      return top;
    }
    var s0 = ((a.cz * w + a.cx) * 4 + a.dir) * 2;
    dist[s0] = 0; push(s0, 0);
    var goal = -1;
    function relax(from, to, d, code) { if (d < dist[to]) { dist[to] = d; prev[to] = from; act[to] = code; push(to, d); } }
    while (heap.k.length) {
      var dk = heap.k[0], st = pop();
      if (dk > dist[st]) continue;
      var b = st & 1, dir = (st >> 1) & 3, cell = st >> 3, x = cell % w, z = (cell - x) / w;
      if (x === T0.x && z === T0.z) { goal = st; break; }
      relax(st, (((cell * 4) + ((dir + 3) & 3)) << 1) | b, dk + 1, 1); // 左回り
      relax(st, (((cell * 4) + ((dir + 1) & 3)) << 1) | b, dk + 1, 2); // 右回り
      var nx = x + DX[dir], nz = z + DZ[dir];
      if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
      var nc = nz * w + nx, hc = b ? 0 : H[cell];
      if (canStep(hc, H[nc])) relax(st, ((nc * 4 + dir) << 1), dk + 1, 3);  // 前へ
      else relax(st, ((nc * 4 + dir) << 1) | 1, dk + 1 + BREAK_COST, 4);    // 壊して前へ
    }
    if (goal < 0) return null;
    var out = [];
    for (var s = goal; s !== s0 && s >= 0; s = prev[s]) {
      var c = act[s];
      if (c === 1) out.push('L'); else if (c === 2) out.push('R'); else if (c === 3) out.push('F'); else { out.push('F'); out.push('S'); }
    }
    out.reverse();
    return out;
  }
  function updateCpu(dt) {
    var c = S.cpu; if (!c) return;
    // どちらかが見つけたら、CPUはその場でぴたっと止まる（動きかけの1マスも進めない）
    if (S.found && (c.move || c.turn)) { c.move = null; c.turn = null; }
    stepActor(c, dt);
    var ai = c.ai;
    ai.time += dt;
    if (S.found) return;
    if (!ai.started) { if (S.intro) return; ai.started = true; }
    ai.wait -= dt;
    if (ai.wait > 0 || !actorFree(c) || c.shots > 0) return; // 自分の弾が落ちるまでは待つ
    if (!ai.plan || !ai.plan.length || ai.ver !== S.mapVer) { ai.plan = planPath(c); ai.ver = S.mapVer; }
    if (!ai.plan || !ai.plan.length) { ai.wait = ai.gap; return; }
    var step = ai.plan[0];
    // まよい（おもに やさしい）：前へ進む前に、ときどき立ち止まったり、きょろきょろ（左右を見て戻る）したりする
    if (step === 'F' && !ai.doubted && Math.random() < CPU_DOUBT[ai.level]) {
      ai.doubted = true;
      if (Math.random() < 0.5) { ai.wait = ai.gap; return; }
      var look = Math.random() < 0.5 ? ['L', 'R'] : ['R', 'L'];
      ai.plan.unshift(look[0], look[1]);
      step = ai.plan[0];
    } else if (step === 'F') ai.doubted = false;
    if (step === 'S') {
      if (c.fireCd > 0) return; // 撃てるようになったらすぐ
      ai.plan.shift(); fire(c);
    } else if (step === 'L' || step === 'R') {
      ai.plan.shift(); startTurn(c, step === 'L' ? -1 : 1);
    } else {
      ai.plan.shift();
      if (tryMove(c, 1)) ai.bumps = 0;
      else {
        // 進めなかった（地図が変わった等）：道をさがし直す。何度も続くなら前を撃つ
        ai.plan = null; ai.bumps++;
        if (ai.bumps >= 2 && c.fireCd <= 0) { fire(c); ai.bumps = 0; }
      }
    }
    ai.steps++;
    ai.wait = ai.gap;
  }

  // ---------- 相手の戦車 ----------
  function ensureRemote(i, st, snap) {
    var r = S.remotes[i];
    if (!r) {
      var col = (st && st.color) || (S.players[i] && S.players[i].color) || '#1e88e5';
      var tk = makeTank(col);
      S.scene.add(tk.root);
      if (S.level) S.level.objects.push(tk.root);
      r = S.remotes[i] = { tank: tk, tx: 0, tz: 0, tdir: 0, anim: 'idle' };
      snap = true;
    }
    if (st) {
      if (st.color && st.color !== r.tank.colorStr) recolorTank(r.tank, st.color);
      r.tx = +st.x || 0; r.tz = +st.z || 0; r.tdir = ((st.dir | 0) % 4 + 4) % 4;
      if (st.anim === 'fire' && r.anim !== 'fire') { r.tank.recoil = 1; }
      r.anim = st.anim || 'idle';
      if (snap || Math.hypot(r.tank.x - r.tx, r.tank.z - r.tz) > 3) {
        r.tank.x = r.tx; r.tank.z = r.tz; r.tank.heading = dirToHeading(r.tdir);
        r.tank.y = vis(hAt(Math.round(r.tx), Math.round(r.tz)));
      }
    }
    return r;
  }
  function updateRemotes(dt) {
    var k = 1 - Math.exp(-dt * 12);
    for (var i in S.remotes) {
      var r = S.remotes[i], tk = r.tank;
      var ox = tk.x, oz = tk.z;
      tk.x += (r.tx - tk.x) * k; tk.z += (r.tz - tk.z) * k;
      tk.heading = angLerp(tk.heading, dirToHeading(r.tdir), 1 - Math.exp(-dt * 14));
      var gy = vis(hAt(Math.round(tk.x), Math.round(tk.z)));
      tk.y += (gy - tk.y) * Math.min(1, dt * 10);
      tk.moving = r.anim === 'move' || Math.hypot(tk.x - ox, tk.z - oz) > dt * 0.5;
    }
  }

  // ---------- カメラ ----------
  // 俯瞰で地図を置く範囲（画面の高さ=1 とした割合）。左の十字ボタン（右はし 約0.50）と右のうつ・カメラボタン（左はし 約1.44）の
  // あいだ（16:9 の画面で 0.52〜1.42）に地図が入るようにする
  var TOP_X0 = 0.53, TOP_X1 = 1.42, TOP_FILL_H = 0.9;
  function overheadHeight() {
    var cam = S.camera, half = THREE.MathUtils.degToRad(cam.fov / 2), tn = Math.tan(half);
    var asp = Math.max(0.3, cam.aspect), fw = clamp((TOP_X1 - TOP_X0) / asp, 0.3, 1), fh = TOP_FILL_H;
    var hz = S.h / 2 + 1, hx = S.w / 2 + 1;
    var need = Math.max(hz / (tn * fh), hx / (tn * asp * fw));
    return Math.max(20, need) + 2; // 壁の上（1.8）からも全体が入るように
  }
  // 地図の中心を、ボタンのあいだの真ん中へずらす量（ワールド座標の x）
  function overheadShift(hh) {
    var cam = S.camera, tn = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), asp = Math.max(0.3, cam.aspect);
    if (asp < 1.2) return 0;
    var centerFrac = ((TOP_X0 + TOP_X1) / 2) / asp - 0.5; // 画面の幅=1 としたときの右へのずれ
    return centerFrac * 2 * hh * tn * asp;
  }
  // おいかけ視点：戦車の後ろ・上・見る先（前）。v4：見下ろす角度を浅く（約20度）して、遠くの黒い壁の迷路と
  // 宝の光の柱・空まで画面に入れる（v3は約40度で足元の白い床ばかりが映っていた）
  var CHASE_BACK = 3.5, CHASE_UP = 3.1, CHASE_AHEAD = 5.0;
  var poseM = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0), NORTH = new THREE.Vector3(0, 0, -1);
  function poseFor(mode) {
    var p = new THREE.Vector3(), q = new THREE.Quaternion(), tg = new THREE.Vector3();
    var tk = S.me ? S.me.tank : { x: S.w / 2, z: S.h / 2, y: 0, heading: 0 };
    var px = tk.x + 0.5, pz = tk.z + 0.5, py = tk.y;
    var fx = -Math.sin(tk.heading), fz = -Math.cos(tk.heading);
    if (mode === 0) {
      p.set(px + fx * 0.12, py + 0.66, pz + fz * 0.12);
      tg.set(px + fx * 5, py + 0.2 + S.pitchV * 2.4, pz + fz * 5); // 視点の上下（nudgePitch）
      poseM.lookAt(p, tg, UP);
    } else if (mode === 1) {
      // 後ろ上から見下ろす（約45度）：戦車の全身が画面の下寄りに入り、前の数マス先まで迷路が見える
      // 視点の上下（nudgePitch）：+ で低く遠くを見る（空と奥の迷路）、- で高く足元を見下ろす
      var pv = S.pitchV, up = CHASE_UP + (pv > 0 ? -pv * 1.2 : -pv * 2.6), ah = CHASE_AHEAD + pv * (pv > 0 ? 3 : 2.6);
      p.set(px - fx * CHASE_BACK, py + up + S.chaseLift, pz - fz * CHASE_BACK);
      tg.set(px + fx * ah, py - 0.1 + pv * (pv > 0 ? 1.1 : 0.4) + S.chaseLift * 0.5, pz + fz * ah);
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
  // 斜め後ろのカメラから戦車（頭の高さ）を見る線が、後ろの壁にさえぎられないよう、必要なぶんだけカメラを持ち上げる
  function chaseLiftTarget() {
    var tk = S.me ? S.me.tank : null; if (!tk) return 0;
    var fx = -Math.sin(tk.heading), fz = -Math.cos(tk.heading), lift = 0;
    var headY = tk.y + 0.55;
    for (var s = 0.55; s < CHASE_BACK; s += 0.3) {
      var top = groundTopAt(tk.x + 0.5 - fx * s, tk.z + 0.5 - fz * s) + 0.12;
      if (top <= headY) continue;
      // カメラの高さ H のとき、後ろ s の位置での線の高さ = headY + (H - headY) * s / CHASE_BACK
      var needH = headY + (top - headY) * CHASE_BACK / s;
      var pv = S.pitchV, up = CHASE_UP + (pv > 0 ? -pv * 1.2 : -pv * 2.6);
      lift = Math.max(lift, needH - (tk.y + up));
    }
    return clamp(lift, 0, 2.6);
  }
  function setCamera(mode) {
    mode = ((mode | 0) % 3 + 3) % 3;
    if (!S.camera || !S.camFrom) { S.camMode = mode; return; }
    if (mode === S.camMode) return;
    S.intro = null; // 自分で視点を変えたら、開始演出は終わり
    S.camFrom.p.copy(S.camera.position).sub(S.shakeOff || tmpV.set(0, 0, 0));
    S.camFrom.q.copy(S.camera.quaternion);
    S.camMode = mode; S.camBlendT = 0;
    try { sfx('tap'); } catch (e) { }
  }
  var shakeV = new THREE.Vector3();
  // 奥行きの精度：カメラが高い（そら視点）ほど、手前の切りとり面を遠くする。
  // near=0.05 のまま高さ100以上から見ると、紙（高さ0）と紙のふちの影（-0.02）の奥行きの差が精度より小さくなり、
  // 三角形の片方だけ影が勝って「斜めの灰色の三角形」になっていた。地面の物はカメラから (高さ-2) 以上はなれているので安全。
  function fitNear() {
    var want = Math.max(0.05, (S.camera.position.y - 10) * 0.25);
    if (Math.abs(want - S.camera.near) > S.camera.near * 0.03 + 1e-4) { S.camera.near = want; S.camera.updateProjectionMatrix(); }
  }
  function updateCamera(dt) {
    if (!S.camera) return;
    S.chaseLift += (chaseLiftTarget() - S.chaseLift) * (1 - Math.exp(-dt * 5));
    S.pitchV += (S.pitch - S.pitchV) * (1 - Math.exp(-dt * 10));
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
      // 1人称⇔俯瞰で真上を通るときは少し高く弧を描く
      S.camera.position.y += Math.sin(e * Math.PI) * 1.5;
      THREE.Quaternion.slerp(S.camFrom.q, target.q, S.camera.quaternion, e);
    } else {
      S.camera.position.copy(target.p);
      S.camera.quaternion.copy(target.q);
    }
    // ゆれ
    if (S.shake > 0.001) {
      var a = S.shake;
      shakeV.set(rand(-a, a), rand(-a, a) * 0.7, rand(-a, a));
      if (S.camMode === 2) shakeV.multiplyScalar(2.5);
      S.camera.position.add(shakeV);
      S.shakeOff = shakeV;
      S.shake *= Math.exp(-dt * 6);
    } else { S.shake = 0; S.shakeOff = null; }
    fitNear();
    // 1人称のときは自分の戦車を隠す（カメラが中に入るため）
    if (S.me) S.me.tank.root.visible = !(S.camMode === 0 && S.camBlendT > 0.55);
    // 俯瞰のときの目じるし
    var camH = S.camera.position.y;
    function mark(tk) {
      var show = camH - tk.y > 10;
      tk.marker.visible = show;
      if (show) { var s = camH / 30; tk.marker.scale.setScalar(s); tk.marker.position.y = 1.2 + s * 0.8 + Math.sin(S.time * 4) * 0.15 * s; tk.marker.material.opacity = clamp((camH - tk.y - 10) / 6, 0, 0.95); }
    }
    if (S.me) mark(S.me.tank);
    if (S.cpu) mark(S.cpu.tank);
    for (var k in S.remotes) mark(S.remotes[k].tank);
  }

  // ---------- ループ ----------
  function stateObj() {
    var me = S.me, tk = me.tank;
    var anim = me.fireAnim > 0 ? 'fire' : me.move ? 'move' : me.turn ? 'turn' : 'idle';
    return { x: Math.round(tk.x * 100) / 100, z: Math.round(tk.z * 100) / 100, dir: me.dir, color: tk.colorStr, anim: anim };
  }
  function update(dt) {
    S.time += dt;
    updateMe(dt);
    updateCpu(dt);
    updateProjectiles(dt);
    updateRemotes(dt);
    updateFx(dt);
    updateTreasure(dt);
    if (S.me) animateTank(S.me.tank, dt, S.time);
    if (S.cpu) animateTank(S.cpu.tank, dt, S.time + 0.7);
    updateAim();
    for (var k in S.remotes) animateTank(S.remotes[k].tank, dt, S.time + 1.3);
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
      if (!S.paused && S.level) update(dt);
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
        fx.debris.geometry.dispose(); fx.debris.material.dispose(); fx.ballGeo.dispose(); fx.ballMat.dispose();
        fx.puffs.forEach(function (p) { p.sp.material.dispose(); });
        fx.stars.forEach(function (p) { p.sp.material.dispose(); });
        fx.bursts.forEach(function (b) { b.sp.material.dispose(); b.fl.material.dispose(); b.ring.geometry.dispose(); b.ring.material.dispose(); });
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
      if (handlers[ev].indexOf(fn) < 0) handlers[ev].push(fn); // 同じ関数の二重登録はしない
    },
    off: function (ev, fn) {
      if (!handlers[ev]) return;
      if (!fn) handlers[ev].length = 0; else { var i = handlers[ev].indexOf(fn); if (i >= 0) handlers[ev].splice(i, 1); }
    },
    applyRemoteState: function (i, st) {
      if (!S.level || !st || i === S.myIndex) return;
      ensureRemote(i, st, false);
    },
    // cells: 壊れるマス。from（任意）: 撃った戦車の {x,z,dir}。あれば弾を山なりに飛ばしてから壊す。
    // 第2期：cells は壊すマス（0か1個）。空でも from があれば弾を2マス先へ飛ばす（何も壊さない）
    applyRemoteBoom: function (cells, from) {
      if (!S.level) return;
      cells = (cells || []).map(function (c) { return [c[0] | 0, c[1] | 0]; });
      if (from && isFinite(from.x) && isFinite(from.z)) {
        var d = ((from.dir | 0) % 4 + 4) % 4, fx0 = Math.round(+from.x), fz0 = Math.round(+from.z);
        var target = cells.length ? cells[0] : [fx0 + DX[d] * 2, fz0 + DZ[d] * 2];
        shootBall(+from.x, +from.z, vis(hAt(fx0, fz0)), d, target, cells, true, null);
        return;
      }
      if (!cells.length) return;
      var done = destroyCells(cells, true);
      emit('boom', done, true); // 弾なしで壊すとき（遠隔）。通信には送らない
    },
    // 相手が抜けたとき：相手の戦車を地図から消す
    dropRemote: function (i) {
      var r = S.remotes[i]; if (!r) return;
      disposeTank(r.tank); delete S.remotes[i];
    },
    remoteFound: function (i) {
      if (S.treasure) S.treasure.celebrate = 1.5;
      S.found = true; // 相手が見つけたら、こちらも止める
      sfx('found');
    },
    // スワイプで左右に90度（dir: -1=左, +1=右）。press('left'|'right') を1回押したのと同じ
    swipeTurn: function (dir) {
      if (S.paused || !S.me || S.found) return;
      S.tapQ[dir < 0 ? 'left' : 'right'] = true;
    },
    // 視点の上下を少しずらす（dy: -1〜+1 の相対量。+ で上＝遠くを見る、- で下＝足元を見る。合計は -1〜+1）
    nudgePitch: function (dy) {
      dy = +dy; if (!isFinite(dy)) return;
      S.pitch = clamp(S.pitch + clamp(dy, -1, 1), -PITCH_MAX, PITCH_MAX);
    },
    resetPitch: function () { S.pitch = 0; },
    // 確認用（ゲームの進行には使わない）
    _debug: function (qx, qz) {
      var me = S.me;
      return {
        cam: S.camMode, blend: S.camBlendT, intro: S.intro ? S.intro.t : -1, paused: S.paused, running: S.running, time: S.time,
        me: me ? { cx: me.cx, cz: me.cz, dir: me.dir, x: me.tank.x, z: me.tank.z, y: me.tank.y } : null,
        debris: S.fx ? S.fx.parts.length : 0, projectiles: S.projectiles.length, found: S.found, mapVer: S.mapVer, pitch: S.pitch,
        cpu: S.cpu ? { cx: S.cpu.cx, cz: S.cpu.cz, dir: S.cpu.dir, level: S.cpu.ai.level, steps: S.cpu.ai.steps, time: S.cpu.ai.time, plan: S.cpu.ai.plan ? S.cpu.ai.plan.length : -1 } : null,
        aim: S.aim && S.aim.mesh.visible ? { x: Math.floor(S.aim.mesh.position.x), z: Math.floor(S.aim.mesh.position.z) } : null,
        remotes: Object.keys(S.remotes).map(function (k) { var r = S.remotes[k]; return { i: +k, x: r.tank.x, z: r.tank.z }; }),
        h: qx != null && S.level ? hAt(qx, qz) : null,
        calls: S.renderer ? S.renderer.info.render.calls : 0,
        tris: S.renderer ? S.renderer.info.render.triangles : 0
      };
    }
  };
  Object.defineProperty(World, 'isPaused', { get: function () { return S.paused; }, enumerable: true });
  Object.defineProperty(World, 'camera', { get: function () { return S.camMode; }, enumerable: true });
  window.World = World;
})();
