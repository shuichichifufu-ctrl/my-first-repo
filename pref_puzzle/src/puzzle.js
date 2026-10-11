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
  function ptSeg(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    let t = l2 === 0 ? 0 : ((px - a[0]) * dx + (py - a[1]) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  }
  function segGap(a, b, c, d) {
    if (segCross(a, b, c, d)) return 0;
    return Math.min(ptSeg(a[0], a[1], c, d), ptSeg(b[0], b[1], c, d), ptSeg(c[0], c[1], a, b), ptSeg(d[0], d[1], a, b));
  }
  // 環の問題を探す。交差（gapMm=0でも見つかる）と、輪郭の離れた2か所が gapMm より近づく「細い切れ込み・くびれ」。
  // mapFn を渡すと、その座標（紙の上のmm）で調べる。戻り値は、問題の辺の組が属する弧番号の組の一覧。
  function ringIssues(arcs, refs, mapFn, gapMm) {
    const pts = [];
    const sa = [];
    for (const r of refs) {
      const id = r >= 0 ? r : ~r;
      const a = r >= 0 ? arcs[id] : arcs[id].slice().reverse();
      for (let i = pts.length ? 1 : 0; i < a.length; i++) pts.push(mapFn ? mapFn(a[i]) : [a[i][0] * COS_MID, a[i][1]]);
      for (let i = 0; i < a.length - 1; i++) sa.push(id);
    }
    const n = pts.length - 1;
    const gap = gapMm || 0;
    const minIdx = 6; // 輪郭の上で近い辺どうし（曲がり角のすぐそば）は調べない
    const out = [];
    const bx0 = new Float64Array(n), bx1 = new Float64Array(n), by0 = new Float64Array(n), by1 = new Float64Array(n);
    for (let i = 0; i < n; i++) { bx0[i] = Math.min(pts[i][0], pts[i + 1][0]) - gap; bx1[i] = Math.max(pts[i][0], pts[i + 1][0]) + gap; by0[i] = Math.min(pts[i][1], pts[i + 1][1]) - gap; by1[i] = Math.max(pts[i][1], pts[i + 1][1]) + gap; }
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        if (bx1[i] < bx0[j] || bx1[j] < bx0[i] || by1[i] < by0[j] || by1[j] < by0[i]) continue;
        const near = gap > 0 && j - i >= minIdx && n - (j - i) >= minIdx && n >= 12;
        if (segCross(pts[i], pts[i + 1], pts[j], pts[j + 1])) out.push([sa[i], sa[j], 'x']);
        else if (near && segGap(pts[i], pts[i + 1], pts[j], pts[j + 1]) < gap) out.push([sa[i], sa[j], 'g']);
      }
    }
    return out;
  }
  function ringCrossings(arcs, refs, mapFn) { return ringIssues(arcs, refs, mapFn, 0); }
  function ringGaps(arcs, refs, mapFn, gapMm) { return ringIssues(arcs, refs, mapFn, gapMm).filter((x) => x[2] === 'g'); }
  function smoothArcsSafe(arcs, ringRefs, tolDeg, iter, maxRounds, mapFn, gapMm) {
    const factor = new Float64Array(arcs.length).fill(1);
    const sm = arcs.map((a) => smoothArc(a, tolDeg, iter));
    // 交差は重大なので、細い切れ込みの1000倍の重みで数える
    const count = (gap) => { let n = 0, x = 0; const bad = new Set(); for (const refs of ringRefs) for (const [a, b, k] of ringIssues(sm, refs, mapFn, gap)) { bad.add(a); bad.add(b); n += k === 'x' ? 1000 : 1; if (k === 'x') x++; } return { n, bad, x }; };
    const rounds1 = maxRounds || 8;
    let rounds = 0;
    // 1. 交差がなくなるまで、交差している弧だけ間引きを強める
    for (; rounds < rounds1; rounds++) {
      const { bad } = count(0);
      if (!bad.size) break;
      for (const id of bad) { if (factor[id] < 64) factor[id] *= 2; sm[id] = smoothArc(arcs[id], tolDeg * factor[id], iter); }
    }
    // 2. 細い切れ込み・くびれを、交差を増やさない範囲で、ならして広げる
    if (gapMm > 0) {
      let cur = count(gapMm);
      for (let k = 0; k < 8 && cur.n > 0; k++) {
        const saved = new Map();
        for (const id of cur.bad) { saved.set(id, [sm[id], factor[id]]); if (factor[id] < 64) factor[id] *= 2; sm[id] = smoothArc(arcs[id], tolDeg * factor[id], iter); }
        const nxt = count(gapMm);
        if (nxt.n < cur.n) { cur = nxt; rounds++; }
        else { for (const [id, [a, f]] of saved) { sm[id] = a; factor[id] = f; } break; }
      }
      return { arcs: sm, remaining: cur.n, crossings: cur.x, narrow: cur.n - cur.x * 1000, rounds };
    }
    const fin = count(0);
    return { arcs: sm, remaining: fin.n, crossings: fin.x, narrow: 0, rounds };
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

  return { R_M, ringIssues, ringGaps, MIN_GAP_MM: 1.0, keptPolygons, keptRingRefs, smoothArcsSafe, ringCrossings, REGION_NAMES, REGION_COLORS, regionOf, smoothArcs, decodeRing, buildPrefGeometry, japanProjection, kFactor, packPieces, SMOOTH, toleranceDeg, minKm2, MIN_PAPER_MM2, PARALLELS };
})();
if (typeof module !== 'undefined') module.exports = PuzzleMode;
