/* 全国パズルの計算（画面に依存しない部分）。ブラウザでもNodeの検証でも同じものを使う。 */
const PuzzleMode = (function () {
  const R_M = 6371008.8;
  const COS_MID = Math.cos((37 * Math.PI) / 180); // 間引きで経度方向を縮めて、距離を等方に近づける

  // 地方ごとの色（印刷してもにごらないうすい色）
  const REGION_NAMES = ['北海道', '東北', '関東', '中部', '近畿', '中国', '四国', '九州・沖縄'];
  const REGION_COLORS = ['#cfe8f7', '#d6ecc9', '#fbe3b5', '#f7d1d1', '#e3d3f0', '#cfeee9', '#f9e8a6', '#f6d3b8'];
  function regionOf(id) {
    return id === 1 ? 0 : id <= 7 ? 1 : id <= 14 ? 2 : id <= 23 ? 3 : id <= 30 ? 4 : id <= 35 ? 5 : id <= 39 ? 6 : 7;
  }

  // ---- 弧のなめらか化 ----
  function dpOpen(pts, tol) {
    if (pts.length <= 2) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let maxD = 0, idx = -1;
      const x1 = pts[s][0] * COS_MID, y1 = pts[s][1], x2 = pts[e][0] * COS_MID, y2 = pts[e][1];
      const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
      for (let i = s + 1; i < e; i++) {
        const x = pts[i][0] * COS_MID, y = pts[i][1];
        let t = len2 === 0 ? 0 : ((x - x1) * dx + (y - y1) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  // 角を切り落として丸める(Chaikin)。開いた線は両端の点を動かさない。
  function chaikinOpen(pts, iter) {
    let p = pts;
    for (let k = 0; k < iter; k++) {
      if (p.length < 3) return p;
      const out = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1];
        if (i > 0) out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
        if (i < p.length - 2) out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
      }
      out.push(p[p.length - 1]);
      p = out;
    }
    return p;
  }
  function chaikinClosed(pts, iter) {
    // pts は最後が最初と同じ閉じた列
    let p = pts.slice(0, -1);
    for (let k = 0; k < iter; k++) {
      const n = p.length;
      if (n < 3) break;
      const out = [];
      for (let i = 0; i < n; i++) {
        const a = p[i], b = p[(i + 1) % n];
        out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
      }
      p = out;
    }
    return [...p, p[0]];
  }

  function smoothArc(pts, tolDeg, iter) {
    const closed = pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    if (closed) {
      // いちばん離れた点で2つに分けて間引いてから、閉じた形として丸める
      let far = 1, best = -1;
      for (let i = 1; i < pts.length - 1; i++) {
        const d = Math.hypot((pts[i][0] - pts[0][0]) * COS_MID, pts[i][1] - pts[0][1]);
        if (d > best) { best = d; far = i; }
      }
      const a = dpOpen(pts.slice(0, far + 1), tolDeg), b = dpOpen(pts.slice(far), tolDeg);
      const ring = a.concat(b.slice(1));
      if (ring.length < 4) return pts;
      return chaikinClosed(ring, iter);
    }
    return chaikinOpen(dpOpen(pts, tolDeg), iter);
  }
  function smoothArcs(arcs, tolDeg, iter) {
    return arcs.map((a) => (tolDeg > 0 || iter > 0 ? smoothArc(a, tolDeg, iter) : a));
  }


  // ---- 交差の修復 ----
  // 環が自分自身と交差していると、ハサミで切る形が「ちょうちょ」になってしまう。
  // 交差している弧は、その弧だけ間引きの許容を倍にして、交差がなくなるまで繰り返す。
  function segCross(a, b, c, d) {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  }
  function ringCrossings(arcs, refs, mapFn) {
    // 戻り値: 交差している辺の組が属する弧番号の組の一覧
    const pts = [], segArc = [];
    for (const r of refs) {
      const id = r >= 0 ? r : ~r;
      const a = r >= 0 ? arcs[id] : arcs[id].slice().reverse();
      for (let i = pts.length ? 1 : 0; i < a.length; i++) { pts.push(mapFn ? mapFn(a[i]) : [a[i][0] * COS_MID, a[i][1]]); if (i > 0 || pts.length > 1) segArc.push(id); }
    }
    // segArc[k] は辺 pts[k]→pts[k+1] の弧
    const n = pts.length - 1;
    const sa = [];
    { let k = 0; for (const r of refs) { const id = r >= 0 ? r : ~r; const len = arcs[id].length - 1; for (let i = 0; i < len; i++) sa[k++] = id; } }
    const out = [];
    const bx0 = new Float64Array(n), bx1 = new Float64Array(n), by0 = new Float64Array(n), by1 = new Float64Array(n);
    for (let i = 0; i < n; i++) { bx0[i] = Math.min(pts[i][0], pts[i + 1][0]); bx1[i] = Math.max(pts[i][0], pts[i + 1][0]); by0[i] = Math.min(pts[i][1], pts[i + 1][1]); by1[i] = Math.max(pts[i][1], pts[i + 1][1]); }
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (bx1[i] < bx0[j] || bx1[j] < bx0[i] || by1[i] < by0[j] || by1[j] < by0[i]) continue;
        if (segCross(pts[i], pts[i + 1], pts[j], pts[j + 1])) out.push([sa[i], sa[j]]);
      }
    }
    return out;
  }
  function smoothArcsSafe(arcs, ringRefs, tolDeg, iter, maxRounds, mapFn) {
    const factor = new Float64Array(arcs.length).fill(1);
    let sm = arcs.map((a, i) => smoothArc(a, tolDeg, iter));
    let remaining = 0, rounds = 0;
    for (; rounds < (maxRounds || 8); rounds++) {
      const bad = new Set();
      remaining = 0;
      for (const refs of ringRefs) for (const [a, b] of ringCrossings(sm, refs, mapFn)) { bad.add(a); bad.add(b); remaining++; }
      if (!bad.size) break;
      for (const id of bad) { factor[id] *= 2; sm[id] = smoothArc(arcs[id], tolDeg * factor[id], iter); }
    }
    return { arcs: sm, remaining, rounds };
  }

  function decodeRing(arcs, refs) {
    const pts = [];
    for (const r of refs) {
      const a = r >= 0 ? arcs[r] : arcs[~r].slice().reverse();
      for (let i = pts.length ? 1 : 0; i < a.length; i++) pts.push(a[i]);
    }
    return pts;
  }

  // 残す陸地の番号。最大の陸地は必ず残す。それ以外は、本土から近く(離島を含めるなら全部)、紙の上で小さすぎないもの。
  function keptPolygons(pref, opts) {
    let largest = 0;
    pref.p.forEach((p, i) => { if (p.a > pref.p[largest].a) largest = i; });
    const kept = [];
    let droppedFar = 0, droppedSmall = 0;
    pref.p.forEach((p, i) => {
      if (i !== largest) {
        if (!opts.includeIslands && !p.m) { droppedFar++; return; }
        if (p.a < opts.minKm2) { droppedSmall++; return; }
      }
      kept.push(i);
    });
    return { kept, droppedFar, droppedSmall };
  }
  function keptRingRefs(data, opts) {
    const out = [];
    for (const pref of data.prefs) for (const i of keptPolygons(pref, opts).kept) for (const refs of pref.p[i].r) out.push(refs);
    return out;
  }

  // 1つの県のかたち。
  function buildPrefGeometry(d3, Core, pref, arcs, opts) {
    const k = keptPolygons(pref, opts);
    const coords = k.kept.map((i) => Core.fixRings(d3, pref.p[i].r.map((refs) => decodeRing(arcs, refs))).rings);
    return { multi: { type: 'MultiPolygon', coordinates: coords }, droppedFar: k.droppedFar, droppedSmall: k.droppedSmall };
  }

  // ---- 全国をまとめて描く図法（ランベルト正角円錐図法）----
  const PARALLELS = [36, 43.5];
  function japanProjection(d3, denom) {
    const scale = (R_M * 1000) / denom;
    return d3.geoConicConformal().parallels(PARALLELS).rotate([-137, 0]).center([0, 37]).scale(scale).translate([0, 0]);
  }
  // 緯度 lat での縮尺のずれ（1なら正しい）。経線に沿って少し動かして測る
  function kFactor(d3, proj, lat, lon) {
    const e = 0.05;
    const a = proj([lon, lat - e]), b = proj([lon, lat + e]);
    const mm = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const true_mm = (2 * e * Math.PI / 180) * proj.scale();
    return mm / true_mm;
  }

  // ---- ピースを用紙に並べる(棚詰め) ----
  // pieces: [{id, w, h}] (mm)。area: {x0, y0, x1, y1}。戻り値: {pages:[[{id,x,y}]], unfit:[id]}
  function packPieces(pieces, area, gap) {
    const aw = area.x1 - area.x0, ah = area.y1 - area.y0;
    const sorted = [...pieces].sort((a, b) => b.h - a.h || b.w - a.w);
    const pages = [];
    const unfit = [];
    let cur = null;
    const newPage = () => { cur = { items: [], x: 0, y: 0, rowH: 0 }; pages.push(cur); };
    for (const p of sorted) {
      if (p.w > aw + 1e-9 || p.h > ah + 1e-9) { unfit.push(p.id); continue; }
      if (!cur) newPage();
      if (cur.x > 0 && cur.x + p.w > aw + 1e-9) { cur.y += cur.rowH + gap; cur.x = 0; cur.rowH = 0; }
      if (cur.y + p.h > ah + 1e-9) { newPage(); }
      cur.items.push({ id: p.id, x: area.x0 + cur.x, y: area.y0 + cur.y });
      cur.x += p.w + gap;
      cur.rowH = Math.max(cur.rowH, p.h);
    }
    return { pages: pages.map((q) => q.items), unfit };
  }

  // なめらかさの段階 → 間引きの許容(紙の上のmm)と、丸める回数
  const SMOOTH = { weak: { tolMm: 0.4, iter: 1, label: '弱' }, normal: { tolMm: 0.9, iter: 2, label: 'ふつう' }, strong: { tolMm: 1.8, iter: 2, label: '強' } };
  function toleranceDeg(denom, level) {
    return (SMOOTH[level].tolMm * denom) / 1e6 / 111.2; // 紙の上のmm → 実際のkm → 度
  }
  // ハサミで切れない小さな島（紙の上でこれ未満）は省く
  const MIN_PAPER_MM2 = 25;
  function minKm2(denom) { return MIN_PAPER_MM2 * (denom / 1e6) ** 2; }

  return { R_M, keptPolygons, keptRingRefs, smoothArcsSafe, ringCrossings, REGION_NAMES, REGION_COLORS, regionOf, smoothArcs, decodeRing, buildPrefGeometry, japanProjection, kFactor, packPieces, SMOOTH, toleranceDeg, minKm2, MIN_PAPER_MM2, PARALLELS };
})();
if (typeof module !== 'undefined') module.exports = PuzzleMode;
