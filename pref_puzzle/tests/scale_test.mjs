// 縮尺：投影後の2地点間距離(mm)を縮尺で実距離に戻し、測地線距離との差を調べる
import { d3, Core, PREFS, R, pass } from './common.mjs';
function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
function check(pref, denom, islands) {
  const g = Core.buildGeometry(d3, pref, islands);
  const P = Core.buildProjection(d3, g.multi, denom);
  const pts = g.multi.coordinates.flatMap((poly) => poly[0]);
  const rand = rng(12345 + pref.id);
  let maxErr = 0, worst = null, n = 0;
  for (let i = 0; i < 4000; i++) {
    const a = pts[Math.floor(rand() * pts.length)], b = pts[Math.floor(rand() * pts.length)];
    const geo = d3.geoDistance(a, b) * R; // m
    if (geo < 2000) continue;
    const pa = P.proj(a), pb = P.proj(b);
    const mm = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
    const real = (mm * denom) / 1000; // m
    const err = Math.abs(real - geo) / geo;
    n++;
    if (err > maxErr) { maxErr = err; worst = { geoKm: geo / 1000, errPct: err * 100 }; }
  }
  return { maxErr, worst, n };
}
const find = (id) => PREFS.find((p) => p.id === id);
console.log('--- 指定の5ケース（本土のみ）---');
for (const [id, den] of [[23, 500000], [1, 1000000], [13, 500000], [47, 500000], [37, 500000]]) {
  const r = check(find(id), den, false);
  pass(`${find(id).n} 1/${den} 本土のみ 最大誤差${(r.maxErr * 100).toFixed(3)}%`, r.maxErr < 0.005, `(${r.n}組, 最悪の距離${r.worst.geoKm.toFixed(0)}km)`);
}
// 縮尺の定義そのもの：中心付近の短い距離で mm×分母 = 実距離
for (const den of [250000, 500000, 1000000]) {
  const pref = find(23), g = Core.buildGeometry(d3, pref, false), P = Core.buildProjection(d3, g.multi, den);
  const a = [P.lon0, P.lat0], b = [P.lon0, P.lat0 + 0.2];
  const pa = P.proj(a), pb = P.proj(b);
  const mm = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
  const geo = d3.geoDistance(a, b) * R;
  pass(`中心から北へ0.2度 1/${den}: ${mm.toFixed(3)}mm`, Math.abs((mm * den) / 1000 - geo) / geo < 0.0005, `誤差${(Math.abs((mm * den) / 1000 - geo) / geo * 100).toFixed(4)}%`);
}
console.log('--- 全県×3縮尺（本土のみ）---');
let worstAll = 0, worstName = '';
for (const p of PREFS) for (const den of [250000, 500000, 1000000]) {
  const r = check(p, den, false);
  if (r.maxErr > worstAll) { worstAll = r.maxErr; worstName = `${p.n} 1/${den}`; }
}
pass(`全県(本土のみ)の最大誤差 ${(worstAll * 100).toFixed(3)}% （${worstName}）`, worstAll < 0.005);
console.log('--- 離島を含む（参考）---');
for (const p of PREFS) {
  if (!p.p.some((x) => !x.m)) continue;
  const r = check(p, 500000, true);
  console.log(`${p.n} 離島を含む 最大誤差 ${(r.maxErr * 100).toFixed(3)}%`);
}
