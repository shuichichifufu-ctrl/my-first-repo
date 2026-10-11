// 愛知県の市町村パズル：データの正しさ・なめらか化・隣どうしの一致・自己交差・縮尺を数値で確かめる
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { d3, Core, pass } from './common.mjs';
const require = createRequire(import.meta.url);
const PM = require('../src/puzzle.js');
(0, eval)(fs.readFileSync(new URL('../src/aichi_arcs.js', import.meta.url), 'utf8').replace('const AICHI_ARCS', 'globalThis.AICHI_ARCS'));
const J = globalThis.AICHI_ARCS;
const R = 6371008.8;
const official = { 23100: 326.5, 23201: 261.35, 23202: 387.2, 23203: 113.8, 23204: 111.4, 23205: 47.4, 23206: 92.8, 23207: 161.1, 23208: 25.2, 23209: 36.0, 23210: 50.4, 23211: 918.0, 23212: 86.0, 23213: 161.2, 23214: 56.9, 23215: 74.9, 23216: 55.9, 23217: 30.2, 23219: 62.8, 23220: 79.4, 23221: 499.0, 23222: 43.4, 23223: 33.7, 23224: 46.0, 23225: 16.3, 23226: 21.0, 23227: 13.1, 23228: 10.5, 23229: 23.2, 23230: 34.9, 23231: 191.0, 23232: 66.7, 23233: 17.4, 23234: 18.4, 23235: 49.0, 23236: 32.2, 23237: 27.4, 23238: 21.9, 23302: 18.0, 23342: 6.2, 23361: 13.6, 23362: 11.2, 23424: 5.6, 23425: 11.1, 23427: 4.4, 23441: 23.9, 23442: 31.1, 23445: 39.9, 23446: 46.2, 23447: 25.9, 23501: 56.7, 23561: 273.9, 23562: 123.4, 23563: 155.7 };
const projOf = (denom) => d3.geoTransverseMercator().rotate([-137.2, -35.0]).scale((R * 1000) / denom).translate([0, 0]);

// 1. データ：54市町村、面積が公称値に近い
pass(`市町村の数 ${J.prefs.length}（愛知県は54）`, J.prefs.length === 54);
{
  let tot = 0, worst = 0, worstName = '';
  for (const u of J.prefs) {
    let a = 0;
    for (const poly of u.p) a += poly.a;
    tot += a;
    const r = Math.abs(a / official[u.id] - 1);
    if (r > worst) { worst = r; worstName = `${u.n}(${a.toFixed(1)}km² / 公称${official[u.id]})`; }
  }
  pass(`面積の合計 ${tot.toFixed(0)}km²（愛知県 5,173km²）`, Math.abs(tot / 5173 - 1) < 0.01);
  console.log(`  公称面積とのずれが最大の市町村: ${worstName}（海や川を含む数え方の違いと思われる・推測）`);
  const nagoya = J.prefs.find((u) => u.id === 23100);
  pass(`名古屋市（16区をまとめた）の面積 ${nagoya.p.reduce((s, q) => s + q.a, 0).toFixed(1)}km²（公称326.5）・多角形${nagoya.p.length}個`, Math.abs(nagoya.p.reduce((s, q) => s + q.a, 0) / 326.5 - 1) < 0.01);
}
// 弧の共有
const users = new Map();
for (const u of J.prefs) for (const poly of u.p) for (const refs of poly.r) for (const r of refs) { const id = r >= 0 ? r : ~r; if (!users.has(id)) users.set(id, []); users.get(id).push({ u: u.id, fwd: r >= 0 }); }
const shared = [...users.values()].filter((v) => v.length >= 2);
pass(`共有する境の弧 ${shared.length}本（市町村どうしの境）`, shared.length > 80);
{
  const withNagoya = shared.filter((v) => v.some((x) => x.u === 23100)).length;
  pass(`名古屋市が他の市町村と共有する境 ${withNagoya}本（区の間の境は含まない）`, withNagoya >= 8);
  const bad3 = [...users.values()].filter((v) => v.length > 2).length;
  pass('どの弧も、使う市町村は多くて2つ', bad3 === 0, `3つ以上 ${bad3}本`);
}

// 2. 自己交差・なめらかさ・隣の一致・面積の変化
function turnSharp(ring, proj) {
  const pts = ring.map((c) => proj(c));
  let sharp = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
    if (l1 < 1e-9 || l2 < 1e-9) continue;
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2);
    if (Math.acos(Math.max(-1, Math.min(1, cos))) > Math.PI / 3) sharp++;
  }
  return sharp;
}
for (const denom of [100000, 200000, 300000, 500000]) {
  const opts = { includeIslands: true, minKm2: PM.minKm2(denom) };
  const proj = projOf(denom);
  const mapFn = (c) => { const q = proj(c); return [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]; };
  const list = [];
  for (const u of J.prefs) for (const i of PM.keptPolygons(u, opts).kept) u.p[i].r.forEach((refs, ri) => list.push({ u, refs, outer: ri === 0 }));
  for (const level of ['weak', 'normal', 'strong']) {
    const sm = PM.SMOOTH[level];
    const r = PM.smoothArcsSafe(J.arcs, list.map((x) => x.refs), PM.toleranceDeg(denom, level), sm.iter, 12, mapFn);
    // 紙の上の座標での交差を、別の書き方で数え直す
    let selfX = 0, sharpRaw = 0, sharpSm = 0, notClosed = 0;
    const per = new Map();
    for (const it of list) {
      const ring = PM.decodeRing(r.arcs, it.refs), raw = PM.decodeRing(J.arcs, it.refs);
      if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) notClosed++;
      selfX += PM.ringCrossings(r.arcs, it.refs, mapFn).length;
      if (!it.outer) continue;
      sharpRaw += turnSharp(raw, proj); sharpSm += turnSharp(ring, proj);
      const e = per.get(it.u.id) || { a0: 0, a1: 0 };
      e.a0 += Math.abs(d3.polygonArea(raw.map((c) => proj(c)))); e.a1 += Math.abs(d3.polygonArea(ring.map((c) => proj(c))));
      per.set(it.u.id, e);
    }
    const diffs = [...per.values()].map((e) => Math.abs(e.a1 - e.a0) / e.a0).sort((a, b) => a - b);
    pass(`1/${denom / 10000}万 なめらかさ${sm.label}: 環${list.length}本・閉じていない${notClosed}・自己交差${selfX}（修復${r.rounds}回）・鋭い曲がり(60度超) ${sharpRaw}→${sharpSm}・面積の変化 中央値${(diffs[diffs.length >> 1] * 100).toFixed(1)}%/最大${(diffs[diffs.length - 1] * 100).toFixed(1)}%`, notClosed === 0 && selfX === 0);
    if (denom === 300000) {
      // 隣り合う境の一致
      let pairs = 0, mismatch = 0;
      for (const [id, us] of users) {
        if (us.length < 2) continue;
        pairs++;
        const a = PM.decodeRing(r.arcs, [us[0].fwd ? id : ~id]);
        const b = PM.decodeRing(r.arcs, [us[1].fwd ? id : ~id]).reverse();
        if (a.length !== b.length || a.some((p, i) => p[0] !== b[i][0] || p[1] !== b[i][1]) || us[0].fwd === us[1].fwd) mismatch++;
      }
      pass(`  共有する境${pairs}本: 隣どうしの頂点が完全に一致`, mismatch === 0, `不一致 ${mismatch}`);
    }
  }
}

// 3. ピース単位の縮尺（図法の中心で補正）
{
  let worst = 0, worstName = '';
  for (const denom of [100000, 300000, 500000]) {
    const proj = projOf(denom);
    const opts = { includeIslands: true, minKm2: PM.minKm2(denom) };
    const arcs = PM.smoothArcsSafe(J.arcs, PM.keptRingRefs(J, opts), PM.toleranceDeg(denom, 'normal'), 2, 12).arcs;
    for (const u of J.prefs) {
      const g = PM.buildPrefGeometry(d3, Core, u, arcs, opts);
      const pts = g.multi.coordinates.flatMap((poly) => poly[0]);
      const [[w, s], [e, n]] = d3.geoBounds(g.multi);
      const f = 1 / PM.kFactor(d3, proj, (s + n) / 2, (w + e) / 2);
      let rs = 11;
      for (let t = 0; t < 600; t++) {
        rs = (rs * 48271) % 2147483647; const i = rs % pts.length; rs = (rs * 48271) % 2147483647; const j = rs % pts.length;
        const geo = d3.geoDistance(pts[i], pts[j]) * R;
        if (geo < 2000) continue;
        const pa = proj(pts[i]), pb = proj(pts[j]);
        const err = Math.abs((Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) * f * denom) / 1000 - geo) / geo;
        if (err > worst) { worst = err; worstName = `${u.n} 1/${denom / 10000}万`; }
      }
    }
  }
  pass(`ピースの縮尺 全市町村×3縮尺の最大誤差 ${(worst * 100).toFixed(3)}%（${worstName}）`, worst < 0.005);
}
