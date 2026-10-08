// 使い方: node tools/prep_data.mjs <japan.geojson> <出力先 src/pref_data.js>
// 地球地図日本の都道府県境(dataofjapan/land の japan.geojson)を間引き、
// 各陸地(多角形)に「最大の陸地から50km以内か」の印(m)を付けて、HTMLに埋め込む形式で書き出す。
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const d3 = require('../vendor/d3-7.9.0.min.js');

const [, , inFile, outFile] = process.argv;
const TOL = 0.0005; // 間引きの許容(度)。約50m
const MIN_AREA_KM2 = 0.1; // これより小さい陸地は捨てる
const NEAR_KM = 50;
const R_KM = 6371.0088;

const rad = (x) => (x * Math.PI) / 180;
function hav(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Douglas-Peucker(度の平面上)。閉じた環は両端を固定して処理する。
function dp(pts, tol) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    const [x1, y1] = pts[s], [x2, y2] = pts[e];
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    for (let i = s + 1; i < e; i++) {
      const [x, y] = pts[i];
      let d;
      if (len2 === 0) d = Math.hypot(x - x1, y - y1);
      else {
        let t = ((x - x1) * dx + (y - y1) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
      }
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function simplifyRing(ring) {
  // 閉じた環を、最も離れた2点で2つに分けて間引く(始点終点が近くて潰れるのを防ぐ)
  const n = ring.length - 1;
  let far = 1, best = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > best) { best = d; far = i; }
  }
  const a = dp(ring.slice(0, far + 1), TOL);
  const b = dp(ring.slice(far), TOL);
  const out = a.concat(b.slice(1)).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
  return out;
}

function areaKm2(rings) {
  const g = { type: 'Polygon', coordinates: rings };
  let a = d3.geoArea(g);
  if (a > 2 * Math.PI) a = 4 * Math.PI - a; // 向きが逆でも面積として扱う
  return a * R_KM * R_KM;
}

// 約1km刻みに頂点を補う(距離の見積もりを粗くしないため)
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

const src = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const prefs = [];
let stat = { rawVerts: 0, outVerts: 0, dropped: 0 };

for (const f of src.features) {
  const polysRaw = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
  const polys = polysRaw.map((rings) => {
    const area = areaKm2(rings);
    stat.rawVerts += rings.reduce((s, r) => s + r.length, 0);
    return { rings, area };
  });
  // 最大の陸地
  let li = 0;
  polys.forEach((p, i) => { if (p.area > polys[li].area) li = i; });
  const largest = densify(polys[li].rings[0]);
  const out = [];
  polys.forEach((p, i) => {
    if (p.area < MIN_AREA_KM2 && i !== li) { stat.dropped++; return; }
    let near = i === li;
    let minD = 0;
    if (!near) {
      const pts = densify(p.rings[0]);
      let lo = [1e9, 1e9], hi = [-1e9, -1e9];
      for (const q of pts) { lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])]; hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])]; }
      const pad = 1.0; // 度。約100kmの余裕で候補を絞る
      const cand = largest.filter((q) => q[0] >= lo[0] - pad && q[0] <= hi[0] + pad && q[1] >= lo[1] - pad && q[1] <= hi[1] + pad);
      minD = Infinity;
      for (const q of pts) for (const c of cand) { const d = hav(q, c); if (d < minD) minD = d; }
      near = minD <= NEAR_KM;
    }
    const rings = p.rings.map(simplifyRing).filter((r) => r.length >= 4);
    if (!rings.length) { stat.dropped++; return; }
    stat.outVerts += rings.reduce((s, r) => s + r.length, 0);
    out.push({ m: near ? 1 : 0, a: Math.round(p.area * 10) / 10, d: Math.round(minD), r: rings });
  });
  prefs.push({ id: f.properties.id, n: f.properties.nam_ja, p: out });
}
prefs.sort((a, b) => a.id - b.id);
const js = '/* 出典：地球地図日本（国土地理院）の都道府県境を、間引き・加工して作成 */\nconst PREF_DATA=' + JSON.stringify(prefs) + ';\n';
fs.writeFileSync(outFile, js);
console.log(stat, 'bytes', js.length);
for (const p of prefs) {
  const far = p.p.filter((x) => !x.m).length;
  if (far) console.log(p.n, '陸地', p.p.length, '本土外', far);
}
