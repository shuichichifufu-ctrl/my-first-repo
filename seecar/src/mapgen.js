/* mapgen.js : 画像 -> 地図データ（MapData）、宝の位置、既定地図。公開する名前は window.MapGen だけ。 */
(function () {
  'use strict';

  var MAX_LONG = 64;        // 縮小後の長い辺（画素）
  var BLOCK = 2;            // 画像1画素 = 2x2マス
  var PIC_LONG = 512;       // みつけた！画面用の元画像の長い辺
  var WALL_H = 10;          // 高さ10（真っ黒）だけが壁。濃い青や赤の塗りは壁にしない
  var MIN_PIXELS = 4;       // 4画素（=16マス）未満の領域は除外
  var DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];
  var KID_ERROR = 'この え は つかえないよ';

  // ---------- 小さな道具 ----------
  function newCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, w); c.height = Math.max(1, h);
    return c;
  }
  function whiteCanvas(w, h) {
    var c = newCanvas(w, h), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = true;
    try { g.imageSmoothingQuality = 'high'; } catch (e) { /* 古いブラウザ */ }
    return c;
  }
  // src（canvas か img）を、長い辺が maxLong 以下になるまで縮小。半分ずつ縮めて画質を保ち、大きな写真でも速い。
  // 透明部分は白になる。小さい画像は拡大しない。
  function shrink(src, sw, sh, maxLong) {
    var k = Math.min(1, maxLong / Math.max(sw, sh));
    var tw = Math.max(1, Math.round(sw * k)), th = Math.max(1, Math.round(sh * k));
    var cur = src, cw = sw, ch = sh;
    while (cw > tw * 2 || ch > th * 2) {
      var nw = Math.max(tw, Math.ceil(cw / 2)), nh = Math.max(th, Math.ceil(ch / 2));
      var c = whiteCanvas(nw, nh);
      c.getContext('2d').drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
      cur = c; cw = nw; ch = nh;
    }
    var out = whiteCanvas(tw, th);
    out.getContext('2d').drawImage(cur, 0, 0, cw, ch, 0, 0, tw, th);
    return out;
  }

  // ---------- 解析 ----------
  // 画素(pw x ph)のRGBA -> MapData（絵の部分）。picture/title/reading は呼び出し側で入れる。
  function analyze(rgba, pw, ph, darkL, binary) {
    var w = pw * BLOCK, h = ph * BLOCK, n = w * h;
    var heights = new Uint8Array(n), colors = new Uint8Array(n * 3);
    var px, pz, i, j, dx, dz;
    for (pz = 0; pz < ph; pz++) {
      for (px = 0; px < pw; px++) {
        var p = (pz * pw + px) * 4;
        var a = rgba[p + 3] / 255;
        // 透明は白扱い
        var r = Math.round(rgba[p] * a + 255 * (1 - a));
        var g = Math.round(rgba[p + 1] * a + 255 * (1 - a));
        var b = Math.round(rgba[p + 2] * a + 255 * (1 - a));
        var L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        // 高さは「その画素が受け持つ範囲で一番濃い色」で決める（縮小で細い線が薄れて壁が途切れるのを防ぐ）
        if (darkL) L = Math.min(L, darkL[pz * pw + px]);
        var hh = Math.round((1 - L) * 10);
        if (hh < 0) hh = 0; if (hh > 10) hh = 10;
        // 白黒モード：明るさ0.5未満は高さ10・黒、それ以外は高さ0・白（色も白黒にそろえる）
        if (binary) { if (L < 0.5) { hh = WALL_H; r = g = b = 0; } else { hh = 0; r = g = b = 255; } }
        for (dz = 0; dz < BLOCK; dz++) {
          for (dx = 0; dx < BLOCK; dx++) {
            i = (pz * BLOCK + dz) * w + (px * BLOCK + dx);
            heights[i] = hh;
            colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
          }
        }
      }
    }

    return analyzeCells(heights, colors, w, h);
  }
  function analyzeCells(heights, colors, w, h) {
    var n = w * h, label = new Int32Array(n).fill(-1), queue = new Int32Array(n), regions = [], i, j, x, z;
    for (i = 0; i < n; i++) {
      if (heights[i] >= WALL_H || label[i] !== -1) continue;
      var id = regions.length, qh = 0, qt = 0, reg = { id: id, size: 0, edge: false, sx: 0, sz: 0 };
      label[i] = id; queue[qt++] = i;
      while (qh < qt) {
        j = queue[qh++]; x = j % w; z = (j - x) / w;
        reg.size++; reg.sx += x; reg.sz += z;
        if (x === 0 || z === 0 || x === w - 1 || z === h - 1) reg.edge = true;
        if (x > 0 && label[j - 1] === -1 && heights[j - 1] < WALL_H) { label[j - 1] = id; queue[qt++] = j - 1; }
        if (x < w - 1 && label[j + 1] === -1 && heights[j + 1] < WALL_H) { label[j + 1] = id; queue[qt++] = j + 1; }
        if (z > 0 && label[j - w] === -1 && heights[j - w] < WALL_H) { label[j - w] = id; queue[qt++] = j - w; }
        if (z < h - 1 && label[j + w] === -1 && heights[j + w] < WALL_H) { label[j + w] = id; queue[qt++] = j + w; }
      }
      regions.push(reg);
    }
    // 外の領域（スタートを置く所）: 端に触れる最大の非壁領域。無ければ最大の領域。
    var main = null;
    for (i = 0; i < regions.length; i++) if (regions[i].edge && (!main || regions[i].size > main.size)) main = regions[i];
    if (!main) for (i = 0; i < regions.length; i++) if (!main || regions[i].size > main.size) main = regions[i];
    if (!main) { // 全面が壁：中央に小さな空き地を掘ってやり直す
      var cx = Math.floor(w / 2), cz = Math.floor(h / 2), ex, ez;
      for (ez = -1; ez <= 1; ez++) for (ex = -1; ex <= 1; ex++) {
        x = Math.min(w - 1, Math.max(0, cx + ex)); z = Math.min(h - 1, Math.max(0, cz + ez));
        heights[z * w + x] = 0;
      }
      return analyzeCells(heights, colors, w, h);
    }
    return finish(heights, colors, w, h, label, regions, main);
  }

  function finish(heights, colors, w, h, label, regions, main) {
    var n = w * h, i, x, z, k;

    // --- スタート2つ：外の領域の、高さ0（無ければ最も低い）のマスから、互いに離して選ぶ ---
    var minH = 255;
    for (i = 0; i < n; i++) if (label[i] === main.id && heights[i] < minH) minH = heights[i];
    var cand = [], soft = [];
    for (i = 0; i < n; i++) {
      if (label[i] !== main.id || heights[i] !== minH) continue;
      cand.push(i);
      x = i % w; z = (i - x) / w;
      var ok = x > 0 && z > 0 && x < w - 1 && z < h - 1;
      for (k = 0; ok && k < 4; k++) {
        var nj = (z + DZ[k]) * w + (x + DX[k]);
        if (Math.abs(heights[nj] - minH) > 1) ok = false;
      }
      if (ok) soft.push(i);
    }
    if (soft.length) cand = soft; // 周りが平らな所を優先（1x1の戦車が動きやすい）
    function d2(a, b) { var ax = a % w, az = (a - ax) / w, bx = b % w, bz = (b - bx) / w; return (ax - bx) * (ax - bx) + (az - bz) * (az - bz); }
    function farthest(from, list) { var best = list[0], bd = -1; for (var q = 0; q < list.length; q++) { var d = d2(from, list[q]); if (d > bd) { bd = d; best = list[q]; } } return best; }
    var s0 = farthest(cand[0], cand);      // 端の一つ（仮。宝が決まったあと、ふちから離して選び直す）
    var s1 = farthest(s0, cand);           // そこから最も遠い所
    if (s1 === s0 && cand.length > 1) s1 = cand[cand.length - 1] !== s0 ? cand[cand.length - 1] : cand[0];
    // ホストは宝に近い側ではなく、地図の左上寄りの端（見た目が安定するように）
    if (d2(s0, 0) > d2(s1, 0)) { var t = s0; s0 = s1; s1 = t; }

    // --- 宝：端に触れない領域のうち 4画素(16マス)以上で最小の領域の、重心に最も近いマス ---
    var minCells = MIN_PIXELS * BLOCK * BLOCK, best = null;
    for (k = 0; k < regions.length; k++) {
      var r = regions[k];
      if (r.edge || r.id === main.id || r.size < minCells) continue;
      if (!best || r.size < best.size) best = r;
    }
    var treasure = null;
    if (best) {
      var gx = best.sx / best.size, gz = best.sz / best.size, bd = Infinity, rmin = 255;
      // 領域の中でも、戦車が立てる低い所（高さ0〜1、無ければ領域でいちばん低い所）に置く
      for (i = 0; i < n; i++) if (label[i] === best.id && heights[i] < rmin) rmin = heights[i];
      var tmaxH = Math.max(1, rmin);
      for (i = 0; i < n; i++) {
        if (label[i] !== best.id || heights[i] > tmaxH) continue;
        x = i % w; z = (i - x) / w;
        var d = (x - gx) * (x - gx) + (z - gz) * (z - gz);
        if (d < bd) { bd = d; treasure = { x: x, z: z }; }
      }
    } else {
      // 候補が無い：スタートから最も遠い、行ける（高さの差1以内）マス
      var dist = new Int32Array(n).fill(-1), q = new Int32Array(n), qh = 0, qt = 0, last = s0;
      dist[s0] = 0; q[qt++] = s0;
      while (qh < qt) {
        var c = q[qh++]; last = c; x = c % w; z = (c - x) / w;
        for (k = 0; k < 4; k++) {
          var nx = x + DX[k], nz = z + DZ[k];
          if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
          var nj2 = nz * w + nx;
          if (dist[nj2] !== -1 || Math.abs(heights[nj2] - heights[c]) > 1) continue;
          dist[nj2] = dist[c] + 1; q[qt++] = nj2;
        }
      }
      if (last === s0 || last === s1) { // 狭すぎるとき：スタートでない別のマス
        for (i = 0; i < n; i++) if (i !== s0 && i !== s1 && heights[i] < WALL_H) { last = i; break; }
      }
      treasure = { x: last % w, z: (last - (last % w)) / w };
    }

    // --- スタートの選び直し：地図のふちから離し（前方に迷路が広がる所）、宝から遠い側を host にする ---
    var tI = treasure.z * w + treasure.x, EDGE_MIN = 6;
    function edgeDist(c) { var cx = c % w, cz = (c - cx) / w; return Math.min(cx, cz, w - 1 - cx, h - 1 - cz); }
    var picked = null;
    for (var margin = EDGE_MIN; margin >= 0 && !picked; margin--) {
      var pool = [];
      for (i = 0; i < n; i++) {
        if (label[i] !== main.id || heights[i] !== minH || i === tI || edgeDist(i) < margin) continue;
        pool.push(i);
      }
      var flat = pool.filter(function (c) {
        var cx = c % w, cz = (c - cx) / w;
        for (var zz = -1; zz <= 1; zz++) for (var xx = -1; xx <= 1; xx++) {
          var nx = cx + xx, nz = cz + zz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= h || Math.abs(heights[nz * w + nx] - minH) > 1) return false;
        }
        return true;
      });
      if (flat.length) picked = flat; else if (pool.length && margin === 0) picked = pool;
    }
    // 戦車が実際に歩いて行ける（高さの差1以内でつながる）いちばん広い範囲に、2つのスタートを置く（色の積み木でふさがれた所を避ける）
    if (picked) {
      var wl = new Int32Array(n).fill(-1), wsz = [], wq = new Int32Array(n);
      for (i = 0; i < n; i++) {
        if (label[i] !== main.id || wl[i] !== -1) continue;
        var wid = wsz.length, a0 = 0, a1 = 0; wl[i] = wid; wq[a1++] = i;
        while (a0 < a1) {
          var cc = wq[a0++], cx2 = cc % w, cz2 = (cc - cx2) / w;
          for (k = 0; k < 4; k++) {
            var ax = cx2 + DX[k], az = cz2 + DZ[k];
            if (ax < 0 || az < 0 || ax >= w || az >= h) continue;
            var aj = az * w + ax;
            if (wl[aj] !== -1 || heights[aj] >= WALL_H || Math.abs(heights[aj] - heights[cc]) > 1) continue;
            wl[aj] = wid; wq[a1++] = aj;
          }
        }
        wsz.push(a1);
      }
      var bigW = 0; for (k = 1; k < wsz.length; k++) if (wsz[k] > wsz[bigW]) bigW = k;
      var inBig = picked.filter(function (c) { return wl[c] === bigW; });
      if (inBig.length > 1) picked = inBig;
    }
    function dirFor(c) { // 前に7マス以上進める向きのうち、宝にいちばん向いている向き
      var cx = c % w, cz = (c - cx) / w, vx = treasure.x - cx, vz = treasure.z - cz, len = Math.sqrt(vx * vx + vz * vz) || 1, best = null;
      for (var d = 0; d < 4; d++) {
        if (runLen(c, d) < 7) continue;
        var cs = (vx * DX[d] + vz * DZ[d]) / len;
        if (!best || cs > best.cs) best = { d: d, cs: cs };
      }
      return best;
    }
    // 前方に見える黒い壁（高さ10）の数：おいかけ視点で、出発してすぐ迷路（字の形）が画面に入る所を選ぶため
    function wallsAhead(c, d) {
      var cx = c % w, cz = (c - cx) / w, cnt = 0, rx = DZ[d] === 0 ? 0 : 1, rz = DX[d] === 0 ? 0 : 1;
      for (var f = 3; f <= 18; f++) for (var sd = -7; sd <= 7; sd++) {
        var qx = cx + DX[d] * f + rx * sd, qz = cz + DZ[d] * f + rz * sd;
        if (qx >= 0 && qz >= 0 && qx < w && qz < h && heights[qz * w + qx] >= WALL_H) cnt++;
      }
      return cnt;
    }
    if (picked) {
      // 前方がひらけ、宝のほうを向ける所だけに絞り、宝から ほどよい遠さ（遠すぎず近すぎず）で、
      // 前方に黒い壁が見え、宝の方向をまっすぐ向ける所を選ぶ
      var WANT = Math.min(22, 0.2 * Math.sqrt(w * w + h * h)), good = [], open = [];
      picked.forEach(function (c) {
        var bd = dirFor(c); if (!bd) return;
        open.push(c);
        var dist = Math.sqrt(d2(c, tI));
        if (bd.cs >= 0.5 && dist >= 8) good.push({ c: c, key: Math.abs(dist - WANT) + (1 - bd.cs) * 16 - Math.min(wallsAhead(c, bd.d), 90) * 0.12 });
      });
      good.sort(function (p, q) { return p.key - q.key; });
      if (good.length) s0 = good[0].c; else s0 = farthest(tI, open.length ? open : picked);
      // ゲスト：ホストから離れた（12マス以上）中で、いちばん条件のよい所
      var SEP = 12 * 12; s1 = -1;
      for (k = 0; k < good.length; k++) if (good[k].c !== s0 && d2(good[k].c, s0) >= SEP) { s1 = good[k].c; break; }
      if (s1 < 0) {
        var pool2 = (open.length > 1 ? open : picked).filter(function (c) { return c !== s0; });
        s1 = pool2.length ? farthest(s0, pool2) : s0;
      }
    }
    function runLen(cell, d) {
      var cx = cell % w, cz = (cell - cx) / w, run = 0, ph = heights[cell];
      for (;;) {
        var qx = cx + DX[d] * (run + 1), qz = cz + DZ[d] * (run + 1);
        if (qx < 0 || qz < 0 || qx >= w || qz >= h) break;
        if (Math.abs(heights[qz * w + qx] - ph) > 1 || heights[qz * w + qx] >= WALL_H) break;
        run++; if (run >= 8) break;
      }
      return run;
    }

    // --- 向き：すぐ前に進める所が長く続く向き。同じなら宝の方へ ---
    function pickDir(cell) {
      var cx = cell % w, cz = (cell - cx) / w, bestDir = 0, bestScore = -1e9;
      for (var d = 0; d < 4; d++) {
        var run = runLen(cell, d);
        var tvx = treasure.x - cx, tvz = treasure.z - cz, toward = 100 * (tvx * DX[d] + tvz * DZ[d]) / (Math.sqrt(tvx * tvx + tvz * tvz) || 1);
        // 開けている（7マス以上進める）向きのうち宝に近い向き。どれも狭ければ、いちばん開けている向き
        var score = (run >= 7 ? 100000 : run * 1000) + (run >= 1 ? toward : -999);
        if (score > bestScore) { bestScore = score; bestDir = d; }
      }
      return bestDir;
    }
    return {
      w: w, h: h, heights: heights, colors: colors,
      treasure: treasure,
      starts: [{ x: s0 % w, z: (s0 - s0 % w) / w, dir: pickDir(s0) }, { x: s1 % w, z: (s1 - s1 % w) / w, dir: pickDir(s1) }],
      title: '', reading: '', picture: ''
    };
  }

  // ---------- 共通処理 ----------
  // src: canvas か img。大きい画像でも半分ずつ縮めるので速い。
  function build(src, sw, sh, title, reading, opts) {
    if (!(sw > 0 && sh > 0)) throw new Error(KID_ERROR);
    var pic = shrink(src, sw, sh, PIC_LONG);
    var small = shrink(pic, pic.width, pic.height, MAX_LONG);
    var pw = small.width, ph = small.height;
    var rgba = small.getContext('2d').getImageData(0, 0, pw, ph).data;
    var map = analyze(rgba, pw, ph, darkest(src, sw, sh, pw, ph), !!(opts && opts.binary === true));
    map.title = title; map.reading = reading;
    map.picture = pic.toDataURL('image/jpeg', 0.82);
    return map;
  }
  // 元画像（長辺2048まで）を見て、縮小後の各画素が受け持つ範囲の最も暗い輝度を求める。
  // 3x3 の近傍で2番目に暗い値を使い、写真の1画素だけの汚れは拾わない。
  function darkest(src, sw, sh, pw, ph) {
    var big = shrink(src, sw, sh, 2048), bw = big.width, bh = big.height;
    var d = big.getContext('2d').getImageData(0, 0, bw, bh).data;
    var lum = new Float32Array(bw * bh), i;
    for (i = 0; i < bw * bh; i++) {
      var a = d[i * 4 + 3] / 255;
      lum[i] = ((0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) * a + 255 * (1 - a)) / 255;
    }
    var out = new Float32Array(pw * ph);
    for (var pz = 0; pz < ph; pz++) {
      var z0 = Math.floor(pz * bh / ph), z1 = Math.max(z0 + 1, Math.floor((pz + 1) * bh / ph));
      for (var px = 0; px < pw; px++) {
        var x0 = Math.floor(px * bw / pw), x1 = Math.max(x0 + 1, Math.floor((px + 1) * bw / pw));
        var m1 = 1, m2 = 1;
        for (var z = z0; z < z1; z++) for (var x = x0; x < x1; x++) {
          var v = lum[z * bw + x];
          if (v < m1) { m2 = m1; m1 = v; } else if (v < m2) m2 = v;
        }
        out[pz * pw + px] = (z1 - z0) * (x1 - x0) > 1 ? m2 : m1;
      }
    }
    return out;
  }
  function fromCanvas(canvas, title, reading, opts) {
    return build(canvas, canvas.width, canvas.height, title || 'よみこんだ え', reading || 'よみこんだ え', opts);
  }
  function fromFile(file, opts) {
    return new Promise(function (resolve, reject) {
      var fail = function () { reject(new Error(KID_ERROR)); };
      if (!file || !file.size || (file.type && file.type.indexOf('image/') !== 0)) { fail(); return; }
      var url;
      try { url = URL.createObjectURL(file); } catch (e) { fail(); return; }
      var img = new Image();
      img.onload = function () {
        // 描画を一度ブラウザに返してから重い処理（固まった感じを減らす）
        setTimeout(function () {
          try {
            var m = build(img, img.naturalWidth, img.naturalHeight, 'よみこんだ え', 'よみこんだ え', opts);
            URL.revokeObjectURL(url);
            resolve(m);
          } catch (e) { URL.revokeObjectURL(url); fail(); }
        }, 0);
      };
      img.onerror = function () { URL.revokeObjectURL(url); fail(); };
      img.src = url;
    });
  }

  // ---------- encode / decode ----------
  function toB64(u8) {
    var s = '', CH = 0x2000;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  function fromB64(str) {
    var s = atob(str), u8 = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }
  function encode(map) {
    return {
      w: map.w, h: map.h,
      heights: toB64(map.heights), colors: toB64(map.colors),
      treasure: { x: map.treasure.x, z: map.treasure.z },
      starts: map.starts.map(function (s) { return { x: s.x, z: s.z, dir: s.dir }; }),
      title: map.title, reading: map.reading, picture: map.picture
    };
  }
  function decode(o) {
    var m = {
      w: o.w, h: o.h, heights: fromB64(o.heights), colors: fromB64(o.colors),
      treasure: { x: o.treasure.x, z: o.treasure.z },
      starts: o.starts.map(function (s) { return { x: s.x, z: s.z, dir: s.dir }; }),
      title: o.title, reading: o.reading, picture: o.picture
    };
    if (m.heights.length !== m.w * m.h || m.colors.length !== m.w * m.h * 3) throw new Error('map size mismatch');
    return m;
  }

  // ---------- 見本の地図（四字熟語は白黒だけ。イラストは白地に太い黒線） ----------
  var PRESETS = [
    // 四字熟語：字の中に閉じた部分（口・日・田など）があり、小さい字でもつぶれにくい熟語
    { id: 'jiyu', kind: 'yoji', title: '自由自在', reading: 'じゆうじざい' },
    { id: 'shiho', kind: 'yoji', title: '四方八方', reading: 'しほうはっぽう' },
    { id: 'hinkou', kind: 'yoji', title: '品行方正', reading: 'ひんこうほうせい' },
    { id: 'mikka', kind: 'yoji', title: '三日坊主', reading: 'みっかぼうず' },
    { id: 'ichinichi', kind: 'yoji', title: '一日千秋', reading: 'いちじつせんしゅう' },
    // イラスト：閉じた部分（窓・目・花びらなど）が複数ある単純な線画。宝は いちばん小さい閉じた部分に入る
    { id: 'ie', kind: 'illust', title: 'いえ', reading: 'いえ' },
    { id: 'sakana', kind: 'illust', title: 'さかな', reading: 'さかな' },
    { id: 'kuruma', kind: 'illust', title: 'くるま', reading: 'くるま' },
    { id: 'hana', kind: 'illust', title: 'はな', reading: 'はな' },
    { id: 'hoshi', kind: 'illust', title: 'ほし', reading: 'ほし' },
    { id: 'roketto', kind: 'illust', title: 'ロケット', reading: 'ろけっと' }
  ];
  var STROKE = 10;
  var THIN = { '鳥': 0, '麗': 0, '龍': 0, '自': 0, '由': 0, '在': 0 }; // 字ごとの太らせる量（線の多い字は細く。0=太らせない）
  var FONT = "'Hiragino Kaku Gothic ProN','Hiragino Sans','Noto Sans JP','Yu Gothic',sans-serif";
  var S = 640;               // 見本の絵の大きさ（画素）
  var LW = 26;               // イラストの線の太さ（画像1画素=10px の約2.6画素分。縮小しても途切れない）

  // 四字熟語：白地に太い黒字だけ（色の落書きはしない）
  function drawYoji(def) {
    var c = newCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
    var chars = def.title.split(''), size = 262, cell = S / 2;
    g.font = '900 ' + size + 'px ' + FONT;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineJoin = 'round';
    for (var i = 0; i < 4; i++) {
      var cx = (i % 2) * cell + cell / 2, cz = Math.floor(i / 2) * cell + cell / 2 + 6;
      g.fillText(chars[i], cx, cz);
      // 線の多い字（鳥など）は太らせすぎると黒い塊につぶれるので、太らせる量を字ごとに変える
      var lw = THIN[chars[i]] != null ? THIN[chars[i]] : STROKE;
      if (lw > 0) { g.lineWidth = lw; g.strokeText(chars[i], cx, cz); }
    }
    return c;
  }

  // イラストの道具：形を白で塗ってから黒い太線でなぞる（下にある線を隠せる）
  function shape(g, path, white) {
    g.beginPath(); path(g);
    if (white !== false) { g.fillStyle = '#fff'; g.fill(); }
    g.strokeStyle = '#000'; g.lineWidth = LW; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke();
  }
  function poly(pts) { return function (g) { g.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); }; }
  function circle(x, z, r) { return function (g) { g.arc(x, z, r, 0, Math.PI * 2); }; }
  function ellipse(x, z, rx, rz, rot) { return function (g) { g.ellipse(x, z, rx, rz, rot || 0, 0, Math.PI * 2); }; }
  function line(g, x0, z0, x1, z1) { g.beginPath(); g.moveTo(x0, z0); g.lineTo(x1, z1); g.strokeStyle = '#000'; g.lineWidth = LW; g.lineCap = 'round'; g.stroke(); }

  var ILLUST = {
    ie: function (g) { // いえ：やね・かべ・ドア・まど
      shape(g, poly([[160, 305], [500, 305], [500, 535], [160, 535]]));     // かべ
      shape(g, poly([[125, 310], [330, 140], [535, 310]]));                 // やね
      shape(g, poly([[215, 405], [305, 405], [305, 535], [215, 535]]));     // ドア
      shape(g, poly([[360, 380], [440, 380], [440, 460], [360, 460]]));     // まど
    },
    sakana: function (g) { // さかな：しっぽ・ひれ・からだ・め
      shape(g, poly([[420, 330], [550, 220], [550, 440]]));                 // しっぽ
      shape(g, poly([[250, 235], [320, 140], [390, 235]]));                 // せびれ
      shape(g, ellipse(290, 330, 175, 135));                                // からだ
      shape(g, circle(215, 305, 42));                                       // め
    },
    kuruma: function (g) { // くるま：からだ・うえの へや・まど2つ・タイヤ2つ
      shape(g, poly([[185, 300], [245, 190], [405, 190], [465, 300]]));     // うえの へや
      line(g, 325, 195, 325, 300);                                          // まどの しきり
      shape(g, poly([[90, 300], [550, 300], [550, 430], [90, 430]]));       // からだ
      shape(g, circle(210, 430, 62));                                       // タイヤ
      shape(g, circle(430, 430, 62));
    },
    hana: function (g) { // はな：はなびら5つ・まんなか・くき・は2まい
      line(g, 320, 340, 320, 560);                                          // くき
      shape(g, function (g) { g.moveTo(320, 500); g.quadraticCurveTo(250, 380, 140, 420); g.quadraticCurveTo(190, 540, 320, 500); }); // は
      shape(g, function (g) { g.moveTo(320, 450); g.quadraticCurveTo(390, 330, 500, 370); g.quadraticCurveTo(450, 490, 320, 450); });
      for (var i = 0; i < 5; i++) {                                         // はなびら
        var a = -Math.PI / 2 + i * Math.PI * 2 / 5;
        shape(g, circle(320 + Math.cos(a) * 98, 220 + Math.sin(a) * 98, 56));
      }
      shape(g, circle(320, 220, 52));                                       // まんなか
    },
    hoshi: function (g) { // ほし：5つの とがりと まんなか
      var pts = [];
      for (var i = 0; i < 5; i++) { var a = -Math.PI / 2 + i * Math.PI * 4 / 5; pts.push([320 + Math.cos(a) * 250, 340 + Math.sin(a) * 250]); }
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (var k = 1; k < 5; k++) g.lineTo(pts[k][0], pts[k][1]);
      g.closePath(); g.strokeStyle = '#000'; g.lineWidth = LW; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke();
    },
    roketto: function (g) { // ロケット：ほのお・はね2つ・からだ・まど
      g.save(); g.translate(32, 24); g.scale(0.9, 0.9);
      shape(g, poly([[255, 455], [385, 455], [320, 585]]));                 // ほのお
      shape(g, poly([[245, 285], [100, 480], [245, 445]]));                 // はね
      shape(g, poly([[395, 285], [540, 480], [395, 445]]));
      shape(g, function (g) { g.moveTo(320, 70); g.quadraticCurveTo(460, 200, 420, 455); g.lineTo(220, 455); g.quadraticCurveTo(180, 200, 320, 70); }); // からだ
      shape(g, circle(320, 255, 50));                                       // まど
      g.restore();
    }
  };
  function drawIllust(def) {
    var c = newCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
    ILLUST[def.id](g);
    return c;
  }

  function findPreset(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return PRESETS[0];
  }
  // 見本の元の絵（canvas）。確認用にも使う。
  function presetCanvas(id) {
    var def = findPreset(id);
    return def.kind === 'illust' ? drawIllust(def) : drawYoji(def);
  }
  function fromPreset(id, opts) {
    var def = findPreset(id);
    // 見本は常に白黒（高さ0の白と高さ10の黒だけ）。字や線のふちの灰色の小さな段を作らない。
    var o = {}; if (opts) for (var key in opts) o[key] = opts[key];
    o.binary = true;
    return fromCanvas(presetCanvas(def.id), def.title, def.reading, o);
  }

  window.MapGen = {
    presets: PRESETS.map(function (p) { return { id: p.id, title: p.title, reading: p.reading, kind: p.kind }; }),
    fromPreset: fromPreset,
    presetCanvas: presetCanvas,
    fromFile: fromFile,
    fromCanvas: fromCanvas,
    encode: encode,
    decode: decode
  };
})();
