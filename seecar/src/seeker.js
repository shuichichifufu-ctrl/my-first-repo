/* ============================================================
   seeker.js : 主人公シーカーの3Dモデル部品（見つけて！PixSee）
   山田さんの ref_pixsee/seeker3d.html の createSeeker を THREE r128（グローバル）に移植。
   公開は window.SeekerModel だけ。
     SeekerModel.create({palette:n | color}) -> {root, flipPivot, rig, hatPivot, pole, eyes, tracks,
                                     stripeTex, setColor(c), setPalette(n), update(dt, state), ...}
     SeekerModel.PALETTES（10色）/ SeekerModel.preview(n, sizePx)（色えらび用の2D絵）
   座標：root の原点 = 足元中央（履帯の下端が y=0）/ +Y=上 / +Z=正面（目のある側）
   大きさ：幅・奥行きとも 1 マス（1.0）以内。
   ============================================================ */
(function () {
  'use strict';
  var T = window.THREE;

  /* ===== K01. 寸法・色（車体カラー10パターン） ===== */

  /* ---- 寸法（山田さんの元の比率のまま作り、最後に SCALE で縮める） ---- */
  var SCALE = 0.75;          // 全体を縮める割合（元の幅1.2 → 約0.9、奥行き1.24 → 約0.93）
  var R = 0.62;              // ロールケーキ（円柱）の半径
  var LEN = 0.7;             // 円柱の長さ（X方向）
  var CY = 0.74;             // ボディ中心の高さ（元の座標）
  var TRK_W = 0.22;          // キャタピラの幅
  var TRK_X = LEN / 2 + TRK_W / 2 - 0.02;
  var TRK_S = 0.94;          // キャタピラ直線部の長さ
  var HAT_H = 0.95, HAT_R = 0.43;
  var HAT_Z = -0.15;         // 帽子の根元（ボディの上）の前後位置
  var BODY_BASE = CY - R;    // ボディの下端（つぶれるときの固定点）
  var SPEED_REF = 3.2;       // move=1 のときの進む速さ（元の単位/秒）＝ world の 2.4 マス/秒 ÷ SCALE
  var HAT_REST = -0.5;       // 帽子のふだんの傾き（後ろへ）

  var COL = { tan: 0xf0c46e, eye: 0x22e0a0, star: 0xd77fb8,
              frame: 0x3b434c, plate: 0x6d7a88, cleat: 0x6f7c89, wheel: 0xa7b3be, hub: 0x2b2f35 };

  // 車体カラー：body=ボディ、accent=円柱の端面（ふち）、track=キャタピラの枠。0番が現行の配色。
  // 色覚の違いでも見分けやすいよう、明るさ（相対輝度）をばらけさせてある：くろ≪ちゃいろ<あか<むらさき<みどり<オレンジ<ピンク≒そらいろ<きいろ≪しろ。
  // 端面の色もすべて変えてあるので、ボディが似た明るさでも見分けられる。
  var PALETTES = [
    { id: 0, name: 'オレンジ',   body: '#e08524', accent: '#f0c46e', track: '#3b434c' },
    { id: 1, name: 'そらいろ',   body: '#4fc3f0', accent: '#fff4c2', track: '#2f4a5c' },
    { id: 2, name: 'あか',       body: '#c4172e', accent: '#ffd9c2', track: '#3a2a30' },
    { id: 3, name: 'みどり',     body: '#2e9e4a', accent: '#f2f6b0', track: '#243d2c' },
    { id: 4, name: 'むらさき',   body: '#8c62d8', accent: '#ffe08a', track: '#312a4a' },
    { id: 5, name: 'きいろ',     body: '#f6d322', accent: '#ffffff', track: '#4a4528' },
    { id: 6, name: 'ピンク',     body: '#ffa6c9', accent: '#fff2d6', track: '#5a3a4a' },
    { id: 7, name: 'くろ',       body: '#2a2f3a', accent: '#9fe3ff', track: '#12161d' },
    { id: 8, name: 'ちゃいろ',   body: '#6b4226', accent: '#e9c98f', track: '#2f241c' },
    { id: 9, name: 'しろ',       body: '#f5f5f0', accent: '#ff9f43', track: '#59636e' }
  ];
  function paletteOf(n) { n = n | 0; return PALETTES[n >= 0 && n < PALETTES.length ? n : 0]; }

  /* ===== K02. トゥーン調の材質・輪郭線・形の部品 ===== */
  /* ---- トゥーン調（段々の陰影）と黒い輪郭線 ---- */
  var grad = new T.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, T.LuminanceFormat);
  grad.minFilter = grad.magFilter = T.NearestFilter;
  grad.needsUpdate = true;
  function toon(c, extra) {
    var o = { color: c, gradientMap: grad };
    if (extra) for (var k in extra) o[k] = extra[k];
    return new T.MeshToonMaterial(o);
  }
  var inkBasic = new T.MeshBasicMaterial({ color: 0x000000 });
  var inkCache = {};
  function inkMaterial(t) {
    var key = String(t);
    if (!inkCache[key]) {
      inkCache[key] = new T.ShaderMaterial({
        uniforms: { t: { value: t } },
        vertexShader: 'uniform float t; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * t, 1.0); }',
        fragmentShader: 'void main(){ gl_FragColor = vec4(0.0,0.0,0.0,1.0); }',
        side: T.BackSide
      });
    }
    return inkCache[key];
  }

  /* 同じ位置の頂点をひとつにまとめる（r128 には mergeVertices が無いので自前） */
  function weld(geo) {
    var pos = geo.attributes.position, idx = geo.index;
    var map = {}, out = [], remap = new Array(pos.count), i, key;
    for (i = 0; i < pos.count; i++) {
      var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      key = Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
      if (map[key] === undefined) { map[key] = out.length / 3; out.push(x, y, z); }
      remap[i] = map[key];
    }
    var tri = [];
    if (idx) { for (i = 0; i < idx.count; i++) tri.push(remap[idx.getX(i)]); }
    else tri = remap.slice();
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(out, 3));
    g.setIndex(tri);
    g.computeVertexNormals();
    return g;
  }
  /* 反転法線の輪郭線（元の方式） */
  function withInk(mesh, t) {
    var o = new T.Mesh(weld(mesh.geometry), inkMaterial(t === undefined ? 0.015 : t));
    o.userData.ink = true;
    mesh.add(o);
    return mesh;
  }

  /* 複数の形をひとつのジオメトリにまとめる */
  function mergeGeos(list) {
    var P = [], N = [];
    list.forEach(function (g) {
      var n = g.toNonIndexed();
      for (var i = 0; i < n.attributes.position.array.length; i++) {
        P.push(n.attributes.position.array[i]); N.push(n.attributes.normal.array[i]);
      }
    });
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(N, 3));
    return g;
  }

  function starShape(ro, ri) {
    var s = new T.Shape();
    for (var i = 0; i < 10; i++) {
      var r = i % 2 ? ri : ro, a = Math.PI / 2 + i * Math.PI / 5;
      var x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i) s.lineTo(x, y); else s.moveTo(x, y);
    }
    s.closePath();
    return s;
  }

  /* 帽子（ドリル）のしましま。offset を動かすとらせん状に回って見える */
  var stripeCanvas = null;
  function makeStripeTexture() {
    if (!stripeCanvas) {
      var c = stripeCanvas = document.createElement('canvas');
      c.width = c.height = 256;
      var g = c.getContext('2d');
      g.fillStyle = '#00d4ff'; g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#ffee00';
      for (var k = 0; k <= 8; k++) {
        g.beginPath();
        g.moveTo(k * 64, 0); g.lineTo(k * 64 + 18, 0);
        g.lineTo(k * 64 + 18 - 256, 256); g.lineTo(k * 64 - 256, 256);
        g.closePath(); g.fill();
      }
    }
    var t = new T.CanvasTexture(stripeCanvas);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }

  /* 円柱の端面（クリーム色の輪＋白い穴＋ピンクの星） */
  /* ===== K03. 端面・履帯・ドリル帽子 ===== */
  function makeEnd(sign) {
    var g = new T.Group();
    g.position.set(sign * LEN / 2, CY, 0);
    g.rotation.y = sign * Math.PI / 2;          // ローカル +Z が外向き
    var rim = new T.Mesh(new T.TorusGeometry(R * 0.985, 0.012, 8, 72), inkBasic);
    var line = new T.Mesh(new T.TorusGeometry(R * 0.84, 0.004, 6, 72), new T.MeshBasicMaterial({ color: 0x8a7a5a }));
    line.position.z = 0.002;
    var hole = new T.Mesh(new T.CircleGeometry(R * 0.6, 48), toon(0xffffff));
    hole.position.z = 0.004;
    var holeRim = new T.Mesh(new T.TorusGeometry(R * 0.6, 0.013, 8, 48), inkBasic);
    holeRim.position.z = 0.004;
    var sInk = new T.Mesh(new T.ExtrudeGeometry(starShape(0.245, 0.118), { depth: 0.01, bevelEnabled: false }), inkBasic);
    sInk.position.set(0, -0.02, 0.006);
    var sPink = new T.Mesh(new T.ExtrudeGeometry(starShape(0.215, 0.095),
      { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 }), toon(COL.star));
    sPink.position.set(0, -0.02, 0.014);
    g.add(rim, line, hole, holeRim, sInk, sPink);
    return g;
  }

  /* ---- 硬いキャタピラ：角のある金属の板が、すき間をあけて並んで回る ---- */
  var TREAD_N = 26, TREAD_RP = 0.16, PLATE_T = 0.04, CLEAT = 0.012;
  var TRK_CY = TREAD_RP + PLATE_T / 2 + CLEAT;      // 板のでっぱりの下端がちょうど y=0 になる高さ
  var TREAD_PM = 2 * TRK_S + 2 * Math.PI * TREAD_RP;
  var _d = new T.Object3D();
  function layoutTreads(inst, off) {
    var S = TRK_S, rp = TREAD_RP, cy = TRK_CY;
    for (var i = 0; i < TREAD_N; i++) {
      var s = (((i * TREAD_PM / TREAD_N + off) % TREAD_PM) + TREAD_PM) % TREAD_PM;
      var y, z, dy, dz;
      if (s < S) { y = cy + rp; z = -S / 2 + s; dy = 0; dz = 1; }
      else if (s < S + Math.PI * rp) {
        var th = (s - S) / rp; z = S / 2 + rp * Math.sin(th); y = cy + rp * Math.cos(th); dz = Math.cos(th); dy = -Math.sin(th);
      } else if (s < 2 * S + Math.PI * rp) {
        var u = s - S - Math.PI * rp; z = S / 2 - u; y = cy - rp; dy = 0; dz = -1;
      } else {
        var th2 = (s - 2 * S - Math.PI * rp) / rp; z = -S / 2 - rp * Math.sin(th2); y = cy - rp * Math.cos(th2); dz = -Math.cos(th2); dy = Math.sin(th2);
      }
      _d.position.set(0, y, z); _d.rotation.set(Math.atan2(-dy, dz), 0, 0); _d.updateMatrix();
      inst.setMatrixAt(i, _d.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
  }
  var plateGeo = null, trackBodyGeo = null;
  function getPlateGeo() {
    if (!plateGeo) {
      var w = TRK_W * 0.96;
      var base = new T.BoxGeometry(w, PLATE_T, 0.09);
      var cleat = new T.BoxGeometry(w, CLEAT, 0.03);          // 外側のでっぱり（すべり止め）
      cleat.translate(0, PLATE_T / 2 + CLEAT / 2, 0);
      plateGeo = mergeGeos([base, cleat]);
    }
    return plateGeo;
  }
  function makeTrack(sign, frameMat) {
    var group = new T.Group(); group.position.x = sign * TRK_X;
    var rb = 0.14, cy = TRK_CY, S = TRK_S;
    if (!trackBodyGeo) {
      var sh = new T.Shape();
      sh.moveTo(-S / 2, cy - rb); sh.lineTo(S / 2, cy - rb);
      sh.absarc(S / 2, cy, rb, -Math.PI / 2, Math.PI / 2, false);
      sh.lineTo(-S / 2, cy + rb);
      sh.absarc(-S / 2, cy, rb, Math.PI / 2, Math.PI * 1.5, false);
      trackBodyGeo = new T.ExtrudeGeometry(sh, { depth: TRK_W * 0.9, bevelEnabled: false, curveSegments: 16 });
      trackBodyGeo.rotateY(Math.PI / 2); trackBodyGeo.translate(-TRK_W * 0.45, 0, 0);
    }
    var bodyMesh = new T.Mesh(trackBodyGeo, frameMat);
    group.add(bodyMesh);

    var inst = new T.InstancedMesh(getPlateGeo(), toon(COL.plate), TREAD_N);
    inst.frustumCulled = false; layoutTreads(inst, 0);
    group.add(inst);

    var wheels = [];
    [-0.33, 0, 0.33].forEach(function (z) {
      var w = new T.Group(); w.position.set(sign * (TRK_W / 2 + 0.014), cy, z);
      var disc = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 0.03, 20).rotateZ(Math.PI / 2), toon(COL.wheel));
      var hub = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 0.045, 10).rotateZ(Math.PI / 2), toon(COL.hub));
      var ring = new T.Mesh(new T.TorusGeometry(0.1, 0.009, 6, 20).rotateY(Math.PI / 2), inkBasic);
      w.add(disc, hub, ring); group.add(w); wheels.push(w);
    });
    return { group: group, inst: inst, wheels: wheels, phase: 0 };
  }

  /* 帽子の傾き th に対して、帽子がボディにめり込まない最短の棒の長さ（元の単位） */
  function poleLength(th) {
    var need = 0;
    if (th < -0.35) need = (-0.35 - th) * 0.28;
    else if (th > -0.12) need = (th + 0.12) * 0.28;
    return Math.max(0.075, need + 0.035);
  }

  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var lerp = function (a, b, k) { return a + (b - a) * k; };

  /* ===== K04. シーカーを組み立てる create() ===== */
  function create(opts) {
    opts = opts || {};
    var pal = paletteOf(opts.palette);
    var color = opts.color !== undefined ? opts.color : pal.body;
    var root = new T.Group(); root.name = 'seeker';
    var flipPivot = new T.Group(); flipPivot.name = 'flipPivot';
    flipPivot.scale.setScalar(SCALE);
    flipPivot.position.y = CY * SCALE;
    root.add(flipPivot);
    var rig = new T.Group(); rig.position.y = -CY; flipPivot.add(rig);

    // 凹む部分（ボディ・端面・目）。ボディの下端を固定点にして縦につぶす
    var bodyGroup = new T.Group(); bodyGroup.position.y = BODY_BASE;
    var inner = new T.Group(); inner.position.y = -BODY_BASE; bodyGroup.add(inner);
    rig.add(bodyGroup);

    var bodyMat = toon(color), capMat = toon(pal.accent), frameMat = toon(pal.track);
    var body = new T.Mesh(new T.CylinderGeometry(R, R, LEN, 48).rotateZ(Math.PI / 2), [bodyMat, capMat, capMat]);
    body.position.y = CY; withInk(body, 0.016);
    inner.add(body, makeEnd(1), makeEnd(-1));

    // バイザーと緑の目（正面 +Z）
    var visor = new T.Mesh(new T.SphereGeometry(1, 24, 12), inkBasic);
    visor.scale.set(0.3, 0.17, 0.06); visor.position.set(0, CY, R - 0.005);
    var eyeMat = new T.MeshBasicMaterial({ color: COL.eye });
    var eyeGeo = new T.SphereGeometry(1, 16, 12);
    var eyeL = new T.Mesh(eyeGeo, eyeMat), eyeR = new T.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.1, CY, R + 0.03); eyeR.position.set(0.1, CY, R + 0.03);
    eyeL.scale.set(0.065, 0.105, 0.025); eyeR.scale.set(0.065, 0.105, 0.025);
    inner.add(visor, eyeL, eyeR);

    // ドリルになる帽子＋短い黒い棒（傘の柄）。根元 hatPivot はボディの上に乗る
    var stripeTex = makeStripeTexture();
    var hatPivot = new T.Group(); hatPivot.name = 'hat';
    var pole = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 1, 10), inkBasic);   // 高さ1 を伸縮して長さにする
    pole.name = 'pole';
    var cone = new T.Mesh(new T.ConeGeometry(HAT_R, HAT_H, 40, 1, false), toon(0xffffff, { map: stripeTex }));
    withInk(cone, 0.016);
    hatPivot.add(pole, cone);
    rig.add(hatPivot);

    // キャタピラ（左右）
    var tracks = [makeTrack(1, frameMat), makeTrack(-1, frameMat)];   // [0]=+X側, [1]=-X側
    tracks.forEach(function (t) { rig.add(t.group); });

    var st = { hatA: HAT_REST, hatV: 0, blinkT: 2, prevSquash: 0, stripe: 0 };
    var api = {
      root: root, flipPivot: flipPivot, rig: rig, hatPivot: hatPivot, pole: pole,
      eyes: [eyeL, eyeR], tracks: tracks, stripeTex: stripeTex, bodyGroup: bodyGroup,
      setColor: function (c) { bodyMat.color.set(c); },
      setPalette: function (n) {
        var p = paletteOf(n);
        bodyMat.color.set(p.body); capMat.color.set(p.accent); frameMat.color.set(p.track);
        api.palette = p.id;
      },
      update: function (dt, s) {
        s = s || {};
        dt = Math.min(dt || 0, 0.05);
        var move = s.move || 0, turn = s.turn || 0;
        var squash = clamp(s.squash || 0, 0, 1), flip = clamp(s.flip || 0, 0, 1);
        var fwdK0 = clamp(s.hatForward || 0, 0, 1);
        var spin = s.spin === undefined ? 0.15 : s.spin;
        var fwdK = Math.max(fwdK0, clamp(s.drillHold || 0, 0, 1));   // drillHold：ドリルを正面に向けたまま保つ

        // キャタピラ：左右の履帯と車輪を別々に回す（その場旋回もそれらしく）
        var fwd = move * SPEED_REF;
        tracks[0].phase += (fwd - turn * TRK_X) * dt;
        tracks[1].phase += (fwd + turn * TRK_X) * dt;
        tracks.forEach(function (t) {
          layoutTreads(t.inst, t.phase);
          t.wheels.forEach(function (w) { w.rotation.x = t.phase / 0.1; });
        });

        // 凹み：縦につぶれて横にふくらむ
        var sy = 1 - 0.32 * squash, sxz = 1 + 0.06 * squash;
        bodyGroup.scale.set(sxz, sy, sxz);

        // 逆さ
        flipPivot.rotation.x = flip * Math.PI;

        // 帽子：ばねでぷるぷる。ドリル中（逆さ・高速回転）はまっすぐ立つ
        var drilling = flip > 0.02 || spin >= 1;
        var target = drilling ? 0 : -(0.45 + 0.12 * Math.min(1, Math.abs(move)));
        st.hatV += (st.prevSquash - squash) * -6;      // 凹み・戻りでぴょこっと揺れる
        st.prevSquash = squash;
        st.hatV += (target - st.hatA) * 180 * dt; st.hatV *= Math.exp(-9 * dt); st.hatA += st.hatV * dt;
        st.hatA = clamp(st.hatA, -0.85, 0.3);

        // 根元の位置：ふだんはボディの上。hatForward で円周に沿って正面へ回り込む
        var a0 = Math.asin(HAT_Z / R);                 // 約 -14 度
        var alpha = lerp(a0, Math.PI / 2, fwdK);
        var rot = lerp(st.hatA, Math.PI / 2, fwdK);
        var yc = BODY_BASE + R * sy;                   // つぶれたあとのボディ中心
        var L = poleLength(st.hatA);
        L = lerp(L, 0.1, fwdK) + 0.14 * fwdK * (1 - fwdK);
        hatPivot.position.set(0, yc + R * sy * Math.cos(alpha), R * sxz * Math.sin(alpha));
        hatPivot.rotation.x = rot;
        hatPivot.rotation.z = clamp(-turn * 0.03, -0.15, 0.15) * (1 - fwdK);
        pole.scale.y = L + 0.04;                       // 少しだけボディの中まで入れる（すき間を作らない）
        pole.position.y = (L - 0.04) / 2;
        cone.position.y = L + HAT_H / 2;

        // しましまの回転
        st.stripe += spin * dt;
        stripeTex.offset.x = st.stripe;

        // まばたき（blink が指定されなければ自動）
        var closed;
        if (s.blink === undefined) {
          st.blinkT -= dt; if (st.blinkT < -0.12) st.blinkT = 1.5 + Math.random() * 3;
          closed = st.blinkT < 0;
        } else closed = !!s.blink;
        var ey = closed ? 0.015 : 0.105;
        eyeL.scale.y = ey; eyeR.scale.y = ey;
      }
    };
    api.palette = pal.id;
    api.tipDepth = (yPivotTop() + poleLength(0) + HAT_H - CY) * SCALE;
    api.update(0, {});
    return api;
  }
  function yPivotTop() { return CY + Math.sqrt(R * R - HAT_Z * HAT_Z); }

  /* ===== K05. 色えらび用のプレビュー絵（Canvas 2D・3Dは使わない） ===== */
  // ななめ前から見た かわいい絵。n=パターン番号、size=一辺の画素。PNGのdataURLを返す。
  var previewCache = {};
  function mix(hex, to, k) { // 色を to（'#rrggbb'）へ k だけ近づける
    var a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16), o = 0;
    for (var sh = 16; sh >= 0; sh -= 8) {
      var x = (a >> sh) & 255, y = (b >> sh) & 255;
      o = (o << 8) | Math.round(x + (y - x) * k);
    }
    return '#' + ('000000' + o.toString(16)).slice(-6);
  }
  function preview(n, sizePx) {
    var pal = paletteOf(n), S = Math.max(16, Math.round(sizePx || 160)), key = pal.id + ':' + S;
    if (previewCache[key]) return previewCache[key];
    var c = document.createElement('canvas'); c.width = c.height = S;
    var g = c.getContext('2d');
    var u = S / 100;                                   // 100x100 の座標で描く
    g.scale(u, u);
    var INK = '#1b1b22', LW = 2.2;
    g.lineJoin = 'round'; g.lineCap = 'round';
    function stroke(w) { g.lineWidth = w || LW; g.strokeStyle = INK; g.stroke(); }
    function pill(x0, y0, x1, y1, r) {
      g.beginPath(); g.moveTo(x0 + r, y0); g.lineTo(x1 - r, y0); g.arc(x1 - r, y0 + r, r, -Math.PI / 2, Math.PI / 2);
      g.lineTo(x0 + r, y1); g.arc(x0 + r, y0 + r, r, Math.PI / 2, Math.PI * 1.5); g.closePath();
    }
    // やわらかい影
    g.fillStyle = 'rgba(40,50,70,0.18)'; g.beginPath(); g.ellipse(50, 92, 38, 5.5, 0, 0, 7); g.fill();

    // キャタピラ（左はうしろ側・右は手前側）：手前にのびる板として、ななめに描く
    function track(cx, cy2, len, wid, front) {
      g.save(); g.translate(cx, cy2); g.rotate(0.62);
      pill(-len / 2, -wid / 2, len / 2, wid / 2, wid / 2); g.fillStyle = pal.track; g.fill(); stroke();
      g.fillStyle = front ? '#8794a2' : '#6f7b89';
      for (var k = 0; k < 6; k++) g.fillRect(-len / 2 + 4 + k * ((len - 8) / 5) - 0.9, -wid / 2 + 1.2, 1.8, wid - 2.4);
      g.fillStyle = '#c3ccd4';
      for (var q = -1; q <= 1; q++) { g.beginPath(); g.arc(q * len * 0.27, 0, wid * 0.22, 0, 7); g.fill(); }
      g.restore();
    }
    track(19, 82, 26, 12, false);

    // ボディ（横にねかせたロールケーキ）：正面から少し右へ回した見え方
    var bx0 = 24, bx1 = 66, cy = 60, r = 21, ex = 6.5;     // 円柱の左右・中心の高さ・半径・端面のはば
    var body = pal.body, hi = mix(body, '#ffffff', 0.32), lo = mix(body, '#000000', 0.22);
    // 左はしの丸み
    g.beginPath(); g.ellipse(bx0, cy, ex, r, 0, 0, 7); g.fillStyle = lo; g.fill();
    // 胴（段々のかげ：上＝明るい／中／下＝暗い）
    g.beginPath(); g.rect(bx0, cy - r, bx1 - bx0, r * 2);
    g.fillStyle = body; g.fill();
    g.save(); g.clip();
    g.fillStyle = hi; g.fillRect(bx0, cy - r, bx1 - bx0, r * 0.5);
    g.fillStyle = lo; g.fillRect(bx0, cy + r * 0.45, bx1 - bx0, r);
    g.restore();
    // 輪郭（胴の上下の線と左はしの弧）
    g.beginPath(); g.moveTo(bx0, cy - r); g.lineTo(bx1, cy - r); stroke();
    g.beginPath(); g.moveTo(bx0, cy + r); g.lineTo(bx1, cy + r); stroke();
    g.beginPath(); g.ellipse(bx0, cy, ex, r, 0, Math.PI / 2, Math.PI * 1.5); stroke();

    // 右の端面：ふち（accent）→ 白い穴 → ピンクの星
    g.beginPath(); g.ellipse(bx1, cy, ex, r, 0, 0, 7); g.fillStyle = pal.accent; g.fill(); stroke();
    g.beginPath(); g.ellipse(bx1, cy, ex * 0.62, r * 0.62, 0, 0, 7); g.fillStyle = '#ffffff'; g.fill(); stroke(1.2);
    g.save(); g.translate(bx1, cy + 0.6); g.scale(ex / r * 1.0, 1);
    g.beginPath();
    for (var i = 0; i < 10; i++) {
      var rr = i % 2 ? 4.2 : 10, a = -Math.PI / 2 + i * Math.PI / 5;
      if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath(); g.fillStyle = '#d77fb8'; g.fill(); g.restore();

    // バイザーと緑の目
    g.beginPath(); g.ellipse(42, cy - 1, 14, 7.5, 0, 0, 7); g.fillStyle = INK; g.fill();
    g.fillStyle = '#22e0a0';
    g.beginPath(); g.ellipse(37, cy - 1, 2.4, 3.9, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(47, cy - 1, 2.4, 3.9, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath(); g.arc(36.2, cy - 2.6, 0.9, 0, 7); g.fill(); g.beginPath(); g.arc(46.2, cy - 2.6, 0.9, 0, 7); g.fill();

    // 手前（右）のキャタピラ
    track(68, 82, 26, 12, true);

    // ドリルの帽子：黒い棒の上に、しましまの円すい（すこし うしろへ傾く）
    var hx = 40, hy = cy - r + 1;                         // 帽子の根元（ボディの上）
    g.fillStyle = INK; g.fillRect(hx - 1.6, hy - 4.5, 3.2, 5.5);
    g.save(); g.translate(hx, hy - 4);
    g.rotate(0.16);                                      // 少し傾ける
    var tw = 15, th = 29;                                // 円すいの底のはばの半分・高さ
    g.beginPath(); g.moveTo(-tw, 0); g.lineTo(0, -th); g.lineTo(tw, 0);
    g.ellipse(0, 0, tw, 3.8, 0, 0, Math.PI, false); g.closePath();
    g.save(); g.clip();
    g.fillStyle = '#00d4ff'; g.fillRect(-tw - 2, -th - 2, tw * 2 + 4, th + 12);
    g.fillStyle = '#ffee00';
    for (var k = -4; k < 5; k++) {
      g.beginPath(); g.moveTo(k * 9 - 3, 8); g.lineTo(k * 9 + 1.5, 8); g.lineTo(k * 9 + 15, -th - 2); g.lineTo(k * 9 + 10.5, -th - 2); g.closePath(); g.fill();
    }
    g.restore();
    g.beginPath(); g.moveTo(-tw, 0); g.lineTo(0, -th); g.lineTo(tw, 0); g.ellipse(0, 0, tw, 3.8, 0, 0, Math.PI, false); g.closePath(); stroke();
    g.restore();

    var url = c.toDataURL('image/png');
    previewCache[key] = url;
    return url;
  }

  /* ===== K06. 公開 ===== */
  window.SeekerModel = { create: create, SCALE: SCALE, PALETTES: PALETTES, preview: preview };
})();
