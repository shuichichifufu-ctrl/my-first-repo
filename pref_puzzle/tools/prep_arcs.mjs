// 使い方: node tools/prep_arcs.mjs <japan.geojson> <出力先 src/japan_arcs.js>
// 全国パズル用。隣り合う県が共有する県境を「弧」として1本にまとめ、
// どちらの県も同じ弧を使う形にする（あとで県境をなめらかにしても、隣どうしがずれないようにするため）。
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const d3 = require('../vendor/d3-7.9.0.min.js');

const [, , inFile, outFile] = process.argv;
const PRE_TOL = 0.0015; // 弧を先に間引く許容(度)。約150m
const MIN_AREA_KM2 = 1; // これより小さい陸地は捨てる
const NEAR_KM = 50;
const R_KM = 6371.0088;
const rad = (x) => (x * Math.PI) / 180;
function hav(a, b) {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
function densify(ring, stepKm = 1) {
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    const n = Math.max(1, Math.ceil(hav(a, b) / stepKm));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  out.push(ring[ring.length - 1]);
  return out;
}
function areaKm2(rings) {
  let a = d3.geoArea({ type: 'Polygon', coordinates: rings });
  if (a > 2 * Math.PI) a = 4 * Math.PI - a;
  return a * R_KM * R_KM;
}
function dp(pts, tol) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    const [x1, y1] = pts[s], [x2, y2] = pts[e];
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    for (let i = s + 1; i < e; i++) {
      const [x, y] = pts[i];
      let t = len2 === 0 ? 0 : ((x - x1) * dx + (y - y1) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const key = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
const src = JSON.parse(fs.readFileSync(inFile, 'utf8'));

// 1. 全ての辺について、どの県が持っているかを集める
const edgeOwners = new Map();
const edgeKey = (a, b) => { const ka = key(a), kb = key(b); return ka < kb ? ka + '|' + kb : kb + '|' + ka; };
const feats = src.features.map((f) => ({
  id: f.properties.id, n: f.properties.nam_ja,
  polys: f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates],
}));
for (const f of feats) for (const poly of f.polys) for (const ring of poly) {
  for (let i = 0; i < ring.length - 1; i++) {
    if (key(ring[i]) === key(ring[i + 1])) continue;
    const k = edgeKey(ring[i], ring[i + 1]);
    if (!edgeOwners.has(k)) edgeOwners.set(k, new Set());
    edgeOwners.get(k).add(f.id);
  }
}

// 2. 環を弧に分ける
const arcs = []; // 座標列
const arcIndex = new Map(); // 共有弧の正規化キー -> 弧番号
let sharedClosed = 0;
function arcFor(points, shared) {
  // points: 始点から終点まで。戻り値: 弧の参照(順向きなら id、逆向きなら ~id)
  const keys = points.map(key);
  const fwd = keys.join(';'), rev = [...keys].reverse().join(';');
  if (shared) {
    const canon = fwd < rev ? fwd : rev;
    if (arcIndex.has(canon)) {
      const id = arcIndex.get(canon);
      return fwd === arcs[id].fwd ? id : ~id;
    }
    arcs.push({ pts: points, fwd });
    arcIndex.set(canon, arcs.length - 1);
    return arcs.length - 1;
  }
  arcs.push({ pts: points, fwd });
  return arcs.length - 1;
}

const out = [];
const stat = { rings: 0, closedSingle: 0, arcsRef: 0 };
for (const f of feats) {
  // 最大の陸地と、そこからの距離（これまでと同じ「本土」の判定）
  const polys = f.polys.map((rings) => ({ rings, area: areaKm2(rings) }));
  let li = 0;
  polys.forEach((p, i) => { if (p.area > polys[li].area) li = i; });
  const largest = densify(polys[li].rings[0]);
  const outPolys = [];
  polys.forEach((p, i) => {
    if (p.area < MIN_AREA_KM2 && i !== li) return;
    let near = i === li, minD = 0;
    if (!near) {
      const pts = densify(p.rings[0]);
      let lo = [1e9, 1e9], hi = [-1e9, -1e9];
      for (const q of pts) { lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])]; hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])]; }
      const cand = largest.filter((q) => q[0] >= lo[0] - 1 && q[0] <= hi[0] + 1 && q[1] >= lo[1] - 1 && q[1] <= hi[1] + 1);
      minD = Infinity;
      for (const q of pts) for (const c of cand) { const d = hav(q, c); if (d < minD) minD = d; }
      near = minD <= NEAR_KM;
    }
    const ringsOut = p.rings.map((ring) => {
      stat.rings++;
      const n = ring.length - 1; // 最後は始点と同じ
      const pts = ring.slice(0, n);
      // 辺ごとの「共有している相手」
      const lab = [];
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const o = key(a) === key(b) ? null : edgeOwners.get(edgeKey(a, b));
        lab.push(o && o.size > 1 ? [...o].filter((x) => x !== f.id).join('+') : '');
      }
      // ラベルが変わる位置を探す
      let start = -1;
      for (let i = 0; i < n; i++) if (lab[i] !== lab[(i + n - 1) % n]) { start = i; break; }
      const refs = [];
      if (start < 0) {
        // 全周が同じラベル: 1本の閉じた弧
        stat.closedSingle++;
        const shared = lab[0] !== '';
        if (shared) {
          // 始点と向きをそろえる（相手側の環と同じ弧になるように）
          let mi = 0;
          for (let i = 1; i < n; i++) if (key(pts[i]) < key(pts[mi])) mi = i;
          const seq = [...pts.slice(mi), ...pts.slice(0, mi)];
          const rseq = [seq[0], ...seq.slice(1).reverse()];
          const useSeq = key(seq[1]) < key(rseq[1]) ? seq : rseq;
          refs.push(arcFor([...useSeq, useSeq[0]], true));
          sharedClosed++;
        } else refs.push(arcFor([...pts, pts[0]], false));
      } else {
        let i = start, count = 0;
        while (count < n) {
          const label = lab[i];
          const seg = [pts[i]];
          let j = i;
          while (count < n && lab[j] === label) { seg.push(pts[(j + 1) % n]); j = (j + 1) % n; count++; }
          refs.push(arcFor(seg, label !== ''));
          i = j;
        }
      }
      stat.arcsRef += refs.length;
      return refs;
    });
    outPolys.push({ m: near ? 1 : 0, a: Math.round(p.area * 10) / 10, r: ringsOut });
  });
  out.push({ id: f.id, n: f.n, p: outPolys });
}
out.sort((a, b) => a.id - b.id);

// 3. 弧を先に間引く（端点は固定。共有弧は1本なので、隣どうしで同じ形になる）
let before = 0, after = 0;
const arcOut = arcs.map((a) => {
  before += a.pts.length;
  let pts = a.pts;
  if (pts.length > 2) {
    const closed = key(pts[0]) === key(pts[pts.length - 1]);
    if (closed && pts.length > 4) {
      // 閉じた弧は、いちばん離れた点で2つに分けて間引く
      let far = 1, best = -1;
      for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > best) { best = d; far = i; } }
      pts = dp(pts.slice(0, far + 1), PRE_TOL).concat(dp(pts.slice(far), PRE_TOL).slice(1));
    } else pts = dp(pts, PRE_TOL);
  }
  const q = pts.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
  after += q.length;
  return q;
});

// 4. 検査: 弧から環を作り直して、閉じているか確かめる
let bad = 0;
const decode = (refs) => {
  const pts = [];
  for (const r of refs) {
    const a = r >= 0 ? arcOut[r] : [...arcOut[~r]].reverse();
    pts.push(...(pts.length ? a.slice(1) : a));
  }
  return pts;
};
for (const p of out) for (const poly of p.p) for (const refs of poly.r) {
  const pts = decode(refs);
  const a = pts[0], b = pts[pts.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) bad++;
}
const js = '/* 出典：地球地図日本（国土地理院）の都道府県境を、共有する弧にまとめて簡略化して作成 */\nconst JAPAN_ARCS=' + JSON.stringify({ arcs: arcOut, prefs: out }) + ';\n';
fs.writeFileSync(outFile, js);
console.log({ ...stat, arcs: arcs.length, sharedClosed, pointsBefore: before, pointsAfter: after, notClosed: bad, bytes: js.length });
