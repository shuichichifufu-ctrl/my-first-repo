/* mapgen.js : 「見つけて！PixSee」v10.0（第5期）。画像 -> 地図データ（MapData）、宝石の位置と種類、既定地図。公開する名前は window.MapGen だけ。 */
(function () {
  'use strict';

  /* ===== M01. 定数・宝石の種類 ===== */

  var MAX_AREA = 64 * 64;   // v10：（v9 は「長い辺64画素」）縮小後の画素の数の上限（=見本の地図と同じ 128x128 マス = 16384 マス）
  var MAX_SIDE = 96;        // v10：縮小後の長い辺の上限（細長い絵で地図が長くなりすぎないように）
  var BLOCK = 2;            // 画像1画素 = 2x2マス
  var PIC_LONG = 512;       // みつけた！画面用の元画像の長い辺
  var WALL_H = 10;          // 高さ10（真っ黒）だけが壁。濃い青や赤の塗りは壁にしない
  var MIN_PIXELS = 4;       // 4画素（=16マス）未満の領域は除外
  var DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];
  var KID_ERROR = 'この え は つかえないよ';

  // 宝石 10種類（順番とidは固定）。color=主色、glow=光の色
  var GEMS = [
    { id: 'diamond',    name: 'ダイヤモンド', color: '#e8f6ff', glow: '#b9e4ff' },  // 無色透明（虹色の輝きは光の色と演出で）
    { id: 'ruby',       name: 'ルビー',       color: '#e0143c', glow: '#ff5a78' },  // 赤
    { id: 'sapphire',   name: 'サファイア',   color: '#1f4fd8', glow: '#5b8cff' },  // 青
    { id: 'emerald',    name: 'エメラルド',   color: '#12a85a', glow: '#4be08c' },  // 緑
    { id: 'amethyst',   name: 'アメシスト',   color: '#9b4fd0', glow: '#c98cff' },  // 紫
    { id: 'topaz',      name: 'トパーズ',     color: '#f5a623', glow: '#ffd36a' },  // 黄〜橙
    { id: 'aquamarine', name: 'アクアマリン', color: '#4fd3e0', glow: '#9af0f7' },  // 水色
    { id: 'garnet',     name: 'ガーネット',   color: '#9c1030', glow: '#d94a68' },  // 深紅
    { id: 'peridot',    name: 'ペリドット',   color: '#a6d32a', glow: '#d3f06a' },  // 黄緑
    { id: 'opal',       name: 'オパール',     color: '#f3ece6', glow: '#ffc8e8' }   // 乳白色（遊色）
  ];

  /* ===== M02. 小さな道具 ===== */
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
  // 地図にするときの画素の大きさ：面積が MAX_AREA 以下、長い辺が MAX_SIDE 以下（小さい画像は拡大しない）
  function mapSize(sw, sh) {
    var lim = api._limits || { area: MAX_AREA, side: MAX_SIDE }; // _limits：テストで v9 の大きさ（{area:1e9, side:64}）と比べる
    var k = Math.min(1, lim.side / Math.max(sw, sh), Math.sqrt(lim.area / (sw * sh)));
    var tw = Math.max(1, Math.floor(sw * k + 1e-6)), th = Math.max(1, Math.floor(sh * k + 1e-6));
    return { w: tw, h: th };
  }
  function shrink(src, sw, sh, maxLong, size) {
    var k = Math.min(1, maxLong / Math.max(sw, sh));
    var tw = Math.max(1, Math.round(sw * k)), th = Math.max(1, Math.round(sh * k));
    if (size) { tw = size.w; th = size.h; }
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

  /* ===== M03. 画像の解析（高さ・色・領域） ===== */
  // 画素(pw x ph)のRGBA -> MapData（絵の部分）。picture/title/reading は呼び出し側で入れる。
  function analyze(rgba, pw, ph, darkL, binary, opts) {
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

    return analyzeCells(heights, colors, w, h, opts);
  }
  function analyzeCells(heights, colors, w, h, opts) {
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
      return analyzeCells(heights, colors, w, h, opts);
    }
    return finish(heights, colors, w, h, label, regions, main, opts);
  }

  /* ===== M04. スタート・宝の置き方（第4期：スタートを先に決め、宝は地図のブロックの中へ） ===== */
  var START_SEP = 12;              // スタート同士の最小の距離（マス）
  var MIN_BLOCK_H = 2;             // 宝を入れるブロックの最小の高さ
  var JUMP_UP = 5;                 // ジャンプで上れる段数
  var D_START = 0.30, D_MIN = 0.15, D_STEP = 0.05; // 距離 D（短辺に対する比率）：30%から5%ずつ緩め、最小15%

  // 乱数。テストでは MapGen._rand を差し替えて種を固定できる
  function rnd() { return api._rand(); }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  /* ===== M05. 壊せる場所の判定（ドリルを使わずに行ける範囲） ===== */
  // starts（マス番号の配列）から、登り1段・降り自由・ジャンプで5段上まで、4方向に歩いて行けるマスの印
  function reachableFrom(heights, w, h, starts) {
    var n = w * h, seen = new Uint8Array(n), q = new Int32Array(n), qh = 0, qt = 0, i;
    starts.forEach(function (s) { if (!seen[s]) { seen[s] = 1; q[qt++] = s; } });
    while (qh < qt) {
      var c = q[qh++], cx = c % w, cz = (c - cx) / w;
      for (var d = 0; d < 4; d++) {
        var nx = cx + DX[d], nz = cz + DZ[d];
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        i = nz * w + nx;
        if (seen[i] || heights[i] > heights[c] + JUMP_UP) continue;
        seen[i] = 1; q[qt++] = i;
      }
    }
    return seen;
  }

  function finish(heights, colors, w, h, label, regions, main, opts) {
    var n = w * h, i, x, z;
    var count = opts && opts.treasureCount === 10 ? 10 : 1;
    function d2(a, b) { var ax = a % w, az = (a - ax) / w, bx = b % w, bz = (b - bx) / w; return (ax - bx) * (ax - bx) + (az - bz) * (az - bz); }
    function edgeDist(c) { var cx = c % w, cz = (c - cx) / w; return Math.min(cx, cz, w - 1 - cx, h - 1 - cz); }

    var minH = 255; // 外の領域でいちばん低い高さ（スタートの高さ）
    for (i = 0; i < n; i++) if (label[i] === main.id && heights[i] < minH) minH = heights[i];

    /* ----- スタート2つ：外の領域の高さ最小のマス。ふちから離し、歩いて行けるいちばん広い範囲の中 ----- */
    var picked = null;
    for (var margin = 6; margin >= 0 && !picked; margin--) {
      var pool = [];
      for (i = 0; i < n; i++) if (label[i] === main.id && heights[i] === minH && edgeDist(i) >= margin) pool.push(i);
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
    if (!picked) { picked = []; for (i = 0; i < n; i++) if (label[i] === main.id) picked.push(i); if (!picked.length) picked = [0, n - 1]; }
    (function () { // 段差1以内でつながるいちばん広い範囲
      var wl = new Int32Array(n).fill(-1), wsz = [], wq = new Int32Array(n);
      for (var s = 0; s < n; s++) {
        if (label[s] !== main.id || wl[s] !== -1) continue;
        var wid = wsz.length, a0 = 0, a1 = 0; wl[s] = wid; wq[a1++] = s;
        while (a0 < a1) {
          var cc = wq[a0++], cx2 = cc % w, cz2 = (cc - cx2) / w;
          for (var kk = 0; kk < 4; kk++) {
            var ax = cx2 + DX[kk], az = cz2 + DZ[kk];
            if (ax < 0 || az < 0 || ax >= w || az >= h) continue;
            var aj = az * w + ax;
            if (wl[aj] !== -1 || heights[aj] >= WALL_H || Math.abs(heights[aj] - heights[cc]) > 1) continue;
            wl[aj] = wid; wq[a1++] = aj;
          }
        }
        wsz.push(a1);
      }
      var bigW = 0; for (var q = 1; q < wsz.length; q++) if (wsz[q] > wsz[bigW]) bigW = q;
      var inBig = picked.filter(function (c) { return wl[c] === bigW; });
      if (inBig.length > 1) picked = inBig;
    })();
    function runLen(cell, d) { // 向き d にまっすぐ進める長さ（最大8）
      var cx = cell % w, cz = (cell - cx) / w, run = 0, ph = heights[cell];
      for (;;) {
        var qx = cx + DX[d] * (run + 1), qz = cz + DZ[d] * (run + 1);
        if (qx < 0 || qz < 0 || qx >= w || qz >= h) break;
        if (Math.abs(heights[qz * w + qx] - ph) > 1 || heights[qz * w + qx] >= WALL_H) break;
        run++; if (run >= 8) break;
      }
      return run;
    }
    var mcx = (w - 1) / 2, mcz = (h - 1) / 2;
    function dirFor(c) { // 前に7マス以上進める向きのうち、地図の中心にいちばん向いている向き
      var cx = c % w, cz = (c - cx) / w, vx = mcx - cx, vz = mcz - cz, len = Math.sqrt(vx * vx + vz * vz) || 1, best = null;
      for (var d = 0; d < 4; d++) {
        if (runLen(c, d) < 7) continue;
        var cs = (vx * DX[d] + vz * DZ[d]) / len;
        if (!best || cs > best.cs) best = { d: d, cs: cs };
      }
      return best;
    }
    function wallsAhead(c, d) { // 前方に見える黒い壁の数（出発してすぐ字や絵が画面に入る所を選ぶ）
      var cx = c % w, cz = (c - cx) / w, cnt = 0, rx = DZ[d] === 0 ? 0 : 1, rz = DX[d] === 0 ? 0 : 1;
      for (var f = 3; f <= 18; f++) for (var sd = -7; sd <= 7; sd++) {
        var qx = cx + DX[d] * f + rx * sd, qz = cz + DZ[d] * f + rz * sd;
        if (qx >= 0 && qz >= 0 && qx < w && qz < h && heights[qz * w + qx] >= WALL_H) cnt++;
      }
      return cnt;
    }
    var short = Math.min(w, h), cand = [];
    picked.forEach(function (c) {
      var bd = dirFor(c); if (!bd) return;
      cand.push({ c: c, key: (1 - bd.cs) * 16 - Math.min(wallsAhead(c, bd.d), 90) * 0.12 });
    });
    cand.sort(function (p, q) { return p.key - q.key; });
    var s0 = -1, s1 = -1, bestPair = null, top = cand.slice(0, 400);
    for (var a = 0; a < top.length; a++) for (var b = a + 1; b < top.length; b++) {
      var dd = Math.sqrt(d2(top[a].c, top[b].c)); if (dd < START_SEP) continue;
      var sc = top[a].key + top[b].key - 0.6 * Math.min(dd, 0.6 * short); // 離れているほどよい（短辺の6割まで）
      if (!bestPair || sc < bestPair.sc) bestPair = { sc: sc, a: top[a].c, b: top[b].c };
    }
    if (bestPair) { s0 = bestPair.a; s1 = bestPair.b; }
    else { // 条件に合う所が無い：離れた2マス
      var pl = picked.length ? picked : [0, n - 1]; s0 = pl[0]; s1 = pl[0];
      var fb = -1; pl.forEach(function (c) { var d3 = d2(c, s0); if (d3 > fb) { fb = d3; s1 = c; } });
    }
    function pickDir(cell) { // すぐ前に進める所が長く続く向き。同じなら中心の方へ
      var cx = cell % w, cz = (cell - cx) / w, bestDir = 0, bestScore = -1e9;
      for (var d = 0; d < 4; d++) {
        var run = runLen(cell, d), tvx = mcx - cx, tvz = mcz - cz, toward = 100 * (tvx * DX[d] + tvz * DZ[d]) / (Math.sqrt(tvx * tvx + tvz * tvz) || 1);
        var score = (run >= 7 ? 100000 : run * 1000) + (run >= 1 ? toward : -999);
        if (score > bestScore) { bestScore = score; bestDir = d; }
      }
      return bestDir;
    }
    var starts = [{ x: s0 % w, z: (s0 - s0 % w) / w, dir: pickDir(s0) }, { x: s1 % w, z: (s1 - s1 % w) / w, dir: pickDir(s1) }];

    /* ===== M06. 宝（宝石）の置き方：高さ2以上のブロックから、壊せて、スタートから遠いものを完全ランダムに ===== */
    var reach = reachableFrom(heights, w, h, [s0, s1]);
    var isStart = {}; isStart[s0] = isStart[s1] = true;
    var blockOk = [], blockAny = [], anyCell = []; // 壊せるブロック / 高さ2以上のすべて / スタート以外のすべて
    for (i = 0; i < n; i++) {
      if (isStart[i]) continue;
      anyCell.push(i);
      if (heights[i] < MIN_BLOCK_H) continue;
      blockAny.push(i);
      x = i % w; z = (i - x) / w;
      var okc = reach[i] === 1;                                   // 上面にそのまま乗れる
      for (var d4 = 0; d4 < 4 && !okc; d4++) {                    // または歩いて行けるマスに隣り合っている
        var ax2 = x + DX[d4], az2 = z + DZ[d4];
        if (ax2 >= 0 && az2 >= 0 && ax2 < w && az2 < h && reach[az2 * w + ax2]) okc = true;
      }
      if (okc) blockOk.push(i);
    }
    function minStartDist(c) { return Math.min(Math.sqrt(d2(c, s0)), Math.sqrt(d2(c, s1))); }
    var info = { D: 0, pct: 0, relaxed: false, dropped: false, candidates: 0, fallback: '' };
    function tryPool(pool, withDist) {
      if (!withDist) return pool.length >= count ? { list: pool, D: 0, pct: 0 } : null;
      for (var pc = D_START; pc >= D_MIN - 1e-9; pc -= D_STEP) {
        var D = short * pc, list = pool.filter(function (c) { return minStartDist(c) >= D; });
        if (list.length >= count) return { list: list, D: D, pct: Math.round(pc * 100) };
      }
      return null;
    }
    var r = tryPool(blockOk, true);
    if (r) { info.D = r.D; info.pct = r.pct; info.relaxed = r.pct < Math.round(D_START * 100); }
    else if ((r = tryPool(blockOk, false))) { info.dropped = true; info.fallback = 'distance-dropped'; }
    else if ((r = tryPool(blockAny, false))) { info.dropped = true; info.fallback = 'unreachable-blocks'; }
    else if ((r = tryPool(anyCell, false))) { info.dropped = true; info.fallback = 'any-cell'; }
    else { r = { list: anyCell.length ? anyCell : [s0], D: 0, pct: 0 }; info.dropped = true; info.fallback = 'tiny-map'; }
    var chosen = r.list; info.candidates = chosen.length;
    // 完全にランダム：部分フィッシャー・イェーツ（同じマスは2回選ばない）
    var pickN = Math.min(count, chosen.length), arr = chosen.slice();
    for (i = 0; i < pickN; i++) { var j = i + Math.floor(rnd() * (arr.length - i)), tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp; }
    var gems = count === 10 ? shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) : [Math.floor(rnd() * GEMS.length)];
    var tr = [];
    for (i = 0; i < pickN; i++) tr.push({ x: arr[i] % w, z: (arr[i] - arr[i] % w) / w, gem: gems[i] });
    return {
      w: w, h: h, heights: heights, colors: colors,
      treasure: tr[0], treasures: tr,
      starts: starts,
      placement: info,
      title: '', reading: '', picture: ''
    };
  }

  /* ===== M07. 画像 -> 地図（共通処理・fromCanvas・fromFile） ===== */
  // src: canvas か img。大きい画像でも半分ずつ縮めるので速い。
  function build(src, sw, sh, title, reading, opts) {
    if (!(sw > 0 && sh > 0)) throw new Error(KID_ERROR);
    var pic = shrink(src, sw, sh, PIC_LONG);
    var small = shrink(pic, pic.width, pic.height, 0, mapSize(sw, sh));
    var pw = small.width, ph = small.height;
    var rgba = small.getContext('2d').getImageData(0, 0, pw, ph).data;
    var map = analyze(rgba, pw, ph, darkest(src, sw, sh, pw, ph), !!(opts && opts.binary === true), opts);
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

  /* ===== M08. encode / decode（宝石の種類 gem も運ぶ） ===== */
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
      treasures: (map.treasures || [map.treasure]).map(function (t) { return { x: t.x, z: t.z, gem: t.gem | 0 }; }),
      starts: map.starts.map(function (s) { return { x: s.x, z: s.z, dir: s.dir }; }),
      title: map.title, reading: map.reading, picture: map.picture
    };
  }
  function decode(o) {
    var m = {
      w: o.w, h: o.h, heights: fromB64(o.heights), colors: fromB64(o.colors),
      treasures: (o.treasures || [o.treasure]).map(function (t) { return { x: t.x, z: t.z, gem: t.gem | 0 }; }),
      starts: o.starts.map(function (s) { return { x: s.x, z: s.z, dir: s.dir }; }),
      title: o.title, reading: o.reading, picture: o.picture
    };
    m.treasure = m.treasures[0];
    if (m.heights.length !== m.w * m.h || m.colors.length !== m.w * m.h * 3) throw new Error('map size mismatch');
    return m;
  }

  /* ===== M09. 見本の地図（字の見本は白黒だけ。イラストは白地に太い黒線） ===== */
  // kind: 'yoji'（四字熟語）・'kotowaza'（ことわざ）・'eigo'（英単語）・'illust'（イラスト）
  // lines：地図に描く字の行（無ければ title から作る。四字熟語は 2字x2行）。ことわざは長いので短い形・2〜3行にする。
  // どれも mapgen5_test で「宝石10個が置ける・スタートから届く・部屋に入れる」を確かめたもの。
  var PRESETS = [
    // 四字熟語：字の中に閉じた部分（口・日・田・目など）があり、小さい字でもつぶれにくいもの（「鳥」はつぶれるので使わない）
    { id: 'jiyu', kind: 'yoji', title: '自由自在', reading: 'じゆうじざい' },
    { id: 'shiho', kind: 'yoji', title: '四方八方', reading: 'しほうはっぽう' },
    { id: 'hinkou', kind: 'yoji', title: '品行方正', reading: 'ひんこうほうせい' },
    { id: 'mikka', kind: 'yoji', title: '三日坊主', reading: 'みっかぼうず' },
    { id: 'ichinichi', kind: 'yoji', title: '一日千秋', reading: 'いちじつせんしゅう' },
    { id: 'juunin', kind: 'yoji', title: '十人十色', reading: 'じゅうにんといろ' },
    { id: 'touzai', kind: 'yoji', title: '東西南北', reading: 'とうざいなんぼく' },
    { id: 'nisshin', kind: 'yoji', title: '日進月歩', reading: 'にっしんげっぽ' },
    { id: 'onko', kind: 'yoji', title: '温故知新', reading: 'おんこちしん' },
    { id: 'taiki', kind: 'yoji', title: '大器晩成', reading: 'たいきばんせい' },
    { id: 'hyappatsu', kind: 'yoji', title: '百発百中', reading: 'ひゃっぱつひゃくちゅう' },
    { id: 'ichigo', kind: 'yoji', title: '一期一会', reading: 'いちごいちえ' },
    { id: 'koumei', kind: 'yoji', title: '公明正大', reading: 'こうめいせいだい' },
    { id: 'isshin', kind: 'yoji', title: '一心同体', reading: 'いっしんどうたい' },
    { id: 'tenka', kind: 'yoji', title: '天下一品', reading: 'てんかいっぴん' },
    { id: 'shiroku', kind: 'yoji', title: '四六時中', reading: 'しろくじちゅう' },
    { id: 'ishinfu', kind: 'yoji', title: '一心不乱', reading: 'いっしんふらん' },
    { id: 'meimei', kind: 'yoji', title: '明明白白', reading: 'めいめいはくはく' },
    { id: 'jucchu', kind: 'yoji', title: '十中八九', reading: 'じっちゅうはっく' },
    // ことわざ：title は正しい形、lines は地図に描く形（ひらがなと 画数の少ない漢字。1行4〜5字まで）
    { id: 'isogaba', kind: 'kotowaza', title: 'いそがば まわれ', reading: 'いそがばまわれ', lines: ['いそがば', 'まわれ'] },
    { id: 'nanakorobi', kind: 'kotowaza', title: '七転び八起き', reading: 'ななころびやおき', lines: ['七ころび', '八おき'] },
    { id: 'ishinoue', kind: 'kotowaza', title: '石の上にも三年', reading: 'いしのうえにもさんねん', lines: ['石の上にも', '三年'] },
    { id: 'hayaoki', kind: 'kotowaza', title: '早起きは三文の徳', reading: 'はやおきはさんもんのとく', lines: ['早おきは', '三文のとく'] },
    { id: 'keizoku', kind: 'kotowaza', title: '継続は力なり', reading: 'けいぞくはちからなり', lines: ['けいぞくは', '力なり'] },
    { id: 'amefutte', kind: 'kotowaza', title: '雨降って地固まる', reading: 'あめふってじかたまる', lines: ['あめふって', 'じかたまる'] },
    { id: 'sukikoso', kind: 'kotowaza', title: '好きこそ物の上手なれ', reading: 'すきこそもののじょうずなれ', lines: ['すきこそ', 'ものの', '上手なれ'] },
    { id: 'chirimo', kind: 'kotowaza', title: 'ちりも積もれば山となる', reading: 'ちりもつもればやまとなる', lines: ['ちりも', 'つもれば', '山となる'] },
    { id: 'tokiwa', kind: 'kotowaza', title: '時は金なり', reading: 'ときはかねなり', lines: ['時は', '金なり'] },
    { id: 'naseba', kind: 'kotowaza', title: 'なせば なる', reading: 'なせばなる', lines: ['なせば', 'なる'] },
    { id: 'narau', kind: 'kotowaza', title: '習うより慣れよ', reading: 'ならうよりなれよ', lines: ['ならうより', 'なれよ'] },
    { id: 'daiwa', kind: 'kotowaza', title: '大は小をかねる', reading: 'だいはしょうをかねる', lines: ['大は小を', 'かねる'] },
    { id: 'zenwa', kind: 'kotowaza', title: '善は急げ', reading: 'ぜんはいそげ', lines: ['ぜんは', 'いそげ'] },
    { id: 'ichiwo', kind: 'kotowaza', title: '一を聞いて十を知る', reading: 'いちをきいてじゅうをしる', lines: ['一をきいて', '十をしる'] },
    // 英単語：大文字。reading はカタカナ、meaning は ひらがな。閉じた部分のある字（A B D O P Q R）を含む短い単語
    { id: 'cat', kind: 'eigo', title: 'CAT', reading: 'キャット', meaning: 'ねこ' },
    { id: 'dog', kind: 'eigo', title: 'DOG', reading: 'ドッグ', meaning: 'いぬ' },
    { id: 'star', kind: 'eigo', title: 'STAR', reading: 'スター', meaning: 'ほし' },
    { id: 'apple', kind: 'eigo', title: 'APPLE', reading: 'アップル', meaning: 'りんご' },
    { id: 'book', kind: 'eigo', title: 'BOOK', reading: 'ブック', meaning: 'ほん' },
    { id: 'moon', kind: 'eigo', title: 'MOON', reading: 'ムーン', meaning: 'つき' },
    { id: 'bird', kind: 'eigo', title: 'BIRD', reading: 'バード', meaning: 'とり' },
    { id: 'frog', kind: 'eigo', title: 'FROG', reading: 'フロッグ', meaning: 'かえる' },
    { id: 'boat', kind: 'eigo', title: 'BOAT', reading: 'ボート', meaning: 'ふね' },
    { id: 'happy', kind: 'eigo', title: 'HAPPY', reading: 'ハッピー', meaning: 'しあわせ' },
    { id: 'dream', kind: 'eigo', title: 'DREAM', reading: 'ドリーム', meaning: 'ゆめ' },
    { id: 'friend', kind: 'eigo', title: 'FRIEND', reading: 'フレンド', meaning: 'ともだち' },
    // イラスト：閉じた部分（窓・目・花びらなど）が複数ある単純な線画
    { id: 'ie', kind: 'illust', title: 'いえ', reading: 'いえ' },
    { id: 'sakana', kind: 'illust', title: 'さかな', reading: 'さかな' },
    { id: 'kuruma', kind: 'illust', title: 'くるま', reading: 'くるま' },
    { id: 'hana', kind: 'illust', title: 'はな', reading: 'はな' },
    { id: 'hoshi', kind: 'illust', title: 'ほし', reading: 'ほし' },
    { id: 'roketto', kind: 'illust', title: 'ロケット', reading: 'ろけっと' }
  ];
  // 字の形はフォントで描く。この PC（Windows：游ゴシック など）と iPad（ヒラギノ）で形・太さが違うので、
  // 1) 一般的なフォントの並びを使い、2) 描いたあとに線の太さを測って、決まった太さ（地図の画素で STROKE_PX）にそろえる。
  var FONT_JA = "'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','YuGothic','Meiryo','Noto Sans JP',sans-serif";
  var FONT_EN = "'Helvetica Neue','Arial','Hiragino Sans','Yu Gothic',sans-serif"; // iPad=Helvetica Neue Bold、Windows=Arial Bold（どちらにもある形に近いもの）
  var STROKE_PX = 2.6;       // 字の線の太さの目標（地図の画素。1画素=2マス）。字が小さいときは 1em の STROKE_EM 倍まで細く
  var STROKE_EM = 0.085, STROKE_MIN = 1.8;
  var STROKE_MAX_ADD = 1.4;  // 太らせる量の上限（地図の画素）。太らせすぎると小さな部屋がつぶれる
  var STROKE_MAX_CUT = 1.2;  // 細くする量の上限（地図の画素）
  var TEXT_ASPECT = 2.2;     // 絵の縦横比の上限（細長すぎる地図にしない。足りない所は白い余白）
  var SCALE = 10;            // 見本の絵：地図の1画素 = 絵の10px
  var S = 640;               // イラストの絵の大きさ（画素）
  var LW = 18;               // イラストの線の太さ（画像1画素=10px の約2.6画素分。縮小しても途切れない）

  function charsOf(str) { return Array.from ? Array.from(str) : str.split(''); }
  function textLines(def) {
    if (def.lines) return def.lines.slice();
    var t = def.title.replace(/\s+/g, '');
    if (def.kind === 'yoji' && t.length === 4) return [t.slice(0, 2), t.slice(2)];
    return [t];
  }
  // 線の太さの目安：黒い画素の数 A と、ふちの画素の数 P から 2A/P（細長い線ならほぼ線の幅）
  function strokeWidth(g, w, h) {
    var d = g.getImageData(0, 0, w, h).data, A = 0, P = 0, x, z;
    function blk(xx, zz) { return xx >= 0 && zz >= 0 && xx < w && zz < h && d[(zz * w + xx) * 4] < 128; }
    for (z = 0; z < h; z++) for (x = 0; x < w; x++) {
      if (!blk(x, z)) continue;
      A++;
      if (!blk(x - 1, z) || !blk(x + 1, z) || !blk(x, z - 1) || !blk(x, z + 1)) P++;
    }
    return P ? 2 * A / P : 0;
  }
  // 字の見本（四字熟語・ことわざ・英単語）：行の数と字の数に合わせて大きさを決める
  function textLayout(def) {
    var lines = textLines(def), en = def.kind === 'eigo', font = (en ? api._fontEn : api._fontJa) || (en ? FONT_EN : FONT_JA); // _font*：テストで別のフォントを試す
    var meas = newCanvas(8, 8).getContext('2d'), EM = 100, i, k;
    meas.font = '900 ' + EM + 'px ' + font;
    var adv = en ? 0.12 : 1.0, lh = en ? 1.15 : 1.0;    // 英字は字幅＋すきま、漢字・かなは 1em のます目（字の大きさは 0.82em）
    var rows = lines.map(function (ln) {
      var cs = charsOf(ln), xs = [], wsum = 0;
      for (k = 0; k < cs.length; k++) {
        var cw = en ? meas.measureText(cs[k]).width / EM + adv : adv;
        xs.push(wsum + cw / 2); wsum += cw;
      }
      return { chars: cs, xs: xs, w: wsum };
    });
    var cw0 = 0; for (i = 0; i < rows.length; i++) cw0 = Math.max(cw0, rows[i].w);
    var pad = en ? 0.3 : 0.0;                             // 字のまわりの余白（em）。スタートを置く床
    var W = cw0 + pad * 2, H = rows.length * lh + pad * 2;
    if (W / H > TEXT_ASPECT) H = W / TEXT_ASPECT;         // 細長すぎるときは上下に余白
    if (H / W > TEXT_ASPECT) W = H / TEXT_ASPECT;
    var ms = mapSize(W * 1000, H * 1000);                 // 地図の画素（面積 MAX_AREA 以下）
    var em = SCALE * ms.w / W;                            // 絵の 1em の px
    return { rows: rows, font: font, en: en, lh: lh, W: W, H: H, em: em, cw: Math.round(W * em), ch: Math.round(H * em) };
  }
  function drawText(def, info) {
    var L = textLayout(def), c = newCanvas(L.cw, L.ch), g = c.getContext('2d');
    var size = L.em * (L.en ? 1 : 0.82), top = (L.ch - L.rows.length * L.lh * L.em) / 2;
    function each(fn) {
      L.rows.forEach(function (row, r) {
        var left = (L.cw - row.w * L.em) / 2, cz = top + (r + 0.5) * L.lh * L.em + L.em * 0.02;
        row.chars.forEach(function (ch, k) { fn(ch, left + row.xs[k] * L.em, cz); });
      });
    }
    function paint(extra) {
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.font = '900 ' + size + 'px ' + L.font;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.fillStyle = '#000'; g.strokeStyle = '#000';
      each(function (ch, x, z) { g.fillText(ch, x, z); if (extra > 0.5) { g.lineWidth = extra; g.strokeText(ch, x, z); } });
      if (extra < -0.5) { g.strokeStyle = '#fff'; g.lineWidth = -extra; each(function (ch, x, z) { g.strokeText(ch, x, z); }); } // 白でなぞって細くする
    }
    paint(0);
    var sw0 = strokeWidth(g, c.width, c.height), target = Math.max(STROKE_MIN * SCALE, Math.min(STROKE_PX * SCALE, L.em * STROKE_EM));
    var lo = -STROKE_MAX_CUT * SCALE, hi = STROKE_MAX_ADD * SCALE;
    var extra = Math.max(lo, Math.min(hi, target - sw0));
    if (Math.abs(extra) > 0.5) {
      paint(extra);
      // もう1回：太さの変わり方（傾き）から直す（フォントによって、なぞった量どおりに変わらないため）
      var sw1 = strokeWidth(g, c.width, c.height), slope = (sw1 - sw0) / extra;
      if (Math.abs(sw1 - target) > 0.15 * SCALE && slope > 0.2) {
        var e2 = Math.max(lo, Math.min(hi, extra + (target - sw1) / slope));
        if (Math.abs(e2 - extra) > 0.5) { extra = e2; paint(extra); }
      }
    }
    if (info) { info.stroke0 = sw0 / SCALE; info.extra = extra / SCALE; info.stroke = strokeWidth(g, c.width, c.height) / SCALE; info.cw = c.width; info.ch = c.height; info.lines = L.rows.map(function (r) { return r.chars.join(''); }); }
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
    return def.kind === 'illust' ? drawIllust(def) : drawText(def);
  }
  function fromPreset(id, opts) {
    var def = findPreset(id);
    // 見本は常に白黒（高さ0の白と高さ10の黒だけ）。字や線のふちの灰色の小さな段を作らない。
    var o = {}; if (opts) for (var key in opts) o[key] = opts[key];
    o.binary = true;
    return fromCanvas(presetCanvas(def.id), def.title, def.reading, o);
  }

  /* ===== M10. 公開 ===== */
  var api = window.MapGen = {
    GEMS: GEMS,
    _rand: Math.random,   // テスト用：差し替えて種を固定できる
    presets: PRESETS.map(function (p) { var o = { id: p.id, title: p.title, reading: p.reading, kind: p.kind }; if (p.meaning) o.meaning = p.meaning; return o; }),
    _textInfo: function (id) { var info = {}, def = findPreset(id); if (def.kind !== 'illust') drawText(def, info); return info; }, // テスト用：字の線の太さなど
    fromPreset: fromPreset,
    presetCanvas: presetCanvas,
    fromFile: fromFile,
    fromCanvas: fromCanvas,
    encode: encode,
    decode: decode
  };
})();
