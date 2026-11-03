/* ============================================================
   seeker.js : 主人公シーカーの3Dモデル部品（見つけて！PixSee）
   山田さんの ref_pixsee/seeker3d.html の createSeeker を THREE r128（グローバル）に移植。
   公開は window.SeekerModel だけ。
     SeekerModel.create({color}) -> {root, flipPivot, rig, hatPivot, pole, eyes, tracks,
                                     stripeTex, setColor(c), update(dt, state), ...}
   座標：root の原点 = 足元中央（履帯の下端が y=0）/ +Y=上 / +Z=正面（目のある側）
   大きさ：幅・奥行きとも 1 マス（1.0）以内。
   ============================================================ */
(function () {
  'use strict';
  var T = window.THREE;

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
  function makeTrack(sign) {
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
    var bodyMesh = new T.Mesh(trackBodyGeo, toon(COL.frame));
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

  function create(opts) {
    opts = opts || {};
    var color = opts.color !== undefined ? opts.color : 0xe08524;
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

    var bodyMat = toon(color);
    var body = new T.Mesh(new T.CylinderGeometry(R, R, LEN, 48).rotateZ(Math.PI / 2), [bodyMat, toon(COL.tan), toon(COL.tan)]);
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
    var tracks = [makeTrack(1), makeTrack(-1)];   // [0]=+X側, [1]=-X側
    tracks.forEach(function (t) { rig.add(t.group); });

    var st = { hatA: HAT_REST, hatV: 0, blinkT: 2, prevSquash: 0, stripe: 0 };
    var api = {
      root: root, flipPivot: flipPivot, rig: rig, hatPivot: hatPivot, pole: pole,
      eyes: [eyeL, eyeR], tracks: tracks, stripeTex: stripeTex, bodyGroup: bodyGroup,
      setColor: function (c) { bodyMat.color.set(c); },
      update: function (dt, s) {
        s = s || {};
        dt = Math.min(dt || 0, 0.05);
        var move = s.move || 0, turn = s.turn || 0;
        var squash = clamp(s.squash || 0, 0, 1), flip = clamp(s.flip || 0, 0, 1);
        var fwdK = clamp(s.hatForward || 0, 0, 1);
        var spin = s.spin === undefined ? 0.15 : s.spin;

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
    api.tipDepth = (yPivotTop() + poleLength(0) + HAT_H - CY) * SCALE;
    api.update(0, {});
    return api;
  }
  function yPivotTop() { return CY + Math.sqrt(R * R - HAT_Z * HAT_Z); }

  window.SeekerModel = { create: create, SCALE: SCALE };
})();
