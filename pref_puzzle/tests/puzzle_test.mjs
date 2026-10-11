// 全国パズル：県境のなめらかさ・隣どうしの一致・自己交差・ピースの縮尺・並べ方を数値で確かめる
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { d3, Core, pass } from './common.mjs';
const require = createRequire(import.meta.url);
const PM = require('../src/puzzle.js');
(0, eval)(fs.readFileSync(new URL('../src/japan_arcs.js', import.meta.url), 'utf8').replace('const JAPAN_ARCS', 'globalThis.JAPAN_ARCS'));
const J = globalThis.JAPAN_ARCS;
const R = 6371008.8;

// 1. 弧と環：どの環も閉じていて、共有する弧は2つの県が同じものを使っている
const refCount = new Map();
for (const p of J.prefs) for (const poly of p.p) for (const refs of poly.r) for (const r of refs) { const id = r >= 0 ? r : ~r; refCount.set(id, (refCount.get(id) || 0) + 1); }
const sharedArcs = [...refCount.values()].filter((v) => v >= 2).length;
pass(`弧の共有: 2つの県が使う弧 ${sharedArcs}本 / 弧の総数 ${J.arcs.length}本`, sharedArcs > 20);

function turnStats(ring, denom) {
  // 紙の上のmmで、鋭い曲がり(60度以上)の点の数と、最短の辺
  const proj = PM.japanProjection(d3, denom);
  const pts = ring.map((c) => proj(c));
  let sharp = 0, shortest = 1e9;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const v1 = [b[0] - a[0], b[1] - a[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
    shortest = Math.min(shortest, l1, l2);
    if (l1 < 1e-9 || l2 < 1e-9) continue;
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2);
    if (Math.acos(Math.max(-1, Math.min(1, cos))) > Math.PI / 3) sharp++;
  }
  return { sharp, shortest, n: pts.length };
}
function segIntersect(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}
function selfIntersections(pts) {
  // 外周の自己交差の数。箱で絞って調べる
  let cnt = 0;
  const n = pts.length - 1;
  const bb = [];
  for (let i = 0; i < n; i++) bb.push([Math.min(pts[i][0], pts[i + 1][0]), Math.max(pts[i][0], pts[i + 1][0]), Math.min(pts[i][1], pts[i + 1][1]), Math.max(pts[i][1], pts[i + 1][1])]);
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (bb[i][1] < bb[j][0] || bb[j][1] < bb[i][0] || bb[i][3] < bb[j][2] || bb[j][3] < bb[i][2]) continue;
    if (segIntersect(pts[i], pts[i + 1], pts[j], pts[j + 1])) cnt++;
  }
  return cnt;
}

const ringsOf = (opts) => {
  const out = [];
  for (const p of J.prefs) for (const i of PM.keptPolygons(p, opts).kept) p.p[i].r.forEach((refs, ri) => out.push({ pref: p, refs, outer: ri === 0 }));
  return out;
};
for (const denom of [1000000, 2000000, 3000000, 5000000]) {
  const opts = { includeIslands: false, minKm2: PM.minKm2(denom) };
  const list = ringsOf(opts);
  const proj = PM.japanProjection(d3, denom);
  const raw = { sharp: 0, selfX: 0 };
  for (const it of list) { if (!it.outer) continue; const pp = PM.decodeRing(J.arcs, it.refs).map((c) => proj(c)); raw.selfX += selfIntersections(pp); raw.sharp += turnStats(PM.decodeRing(J.arcs, it.refs), denom).sharp; }
  for (const level of ['weak', 'normal', 'strong']) {
    const sm = PM.SMOOTH[level];
    const r = PM.smoothArcsSafe(J.arcs, list.map((x) => x.refs), PM.toleranceDeg(denom, level), sm.iter, 12);
    let rings = 0, notClosed = 0, selfX = 0, sharp = 0, vertsRaw = 0, vertsSm = 0, maxAreaDiff = 0;
    const perPref = new Map();
    for (const it of list) {
      rings++;
      const ringRaw = PM.decodeRing(J.arcs, it.refs), ring = PM.decodeRing(r.arcs, it.refs);
      vertsRaw += ringRaw.length; vertsSm += ring.length;
      if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) notClosed++;
      if (!it.outer) continue;
      const pp = ring.map((c) => proj(c));
      selfX += selfIntersections(pp);
      sharp += turnStats(ring, denom).sharp;
      const e = perPref.get(it.pref.id) || { a0: 0, a1: 0 };
      e.a0 += Math.abs(d3.polygonArea(ringRaw.map((c) => proj(c)))); e.a1 += Math.abs(d3.polygonArea(pp));
      perPref.set(it.pref.id, e);
    }
    // 県ごとの面積の変化。いちばん大きい陸地の面積が小さい県は、細かさの影響が大きいので別に数える
    const diffs = [...perPref.values()].map((e) => Math.abs(e.a1 - e.a0) / e.a0).sort((a, b) => a - b);
    maxAreaDiff = diffs[diffs.length - 1];
    const med = diffs[Math.floor(diffs.length / 2)];
    pass(`1/${denom / 10000}万 なめらかさ${sm.label}: 環${rings}本・閉じていない${notClosed}・自己交差 ${raw.selfX}→${selfX}・頂点 ${vertsRaw}→${vertsSm}・鋭い曲がり(60度超) ${raw.sharp}→${sharp}か所・面積の変化 中央値${(med * 100).toFixed(1)}%/最大${(maxAreaDiff * 100).toFixed(1)}%・修復${r.rounds}回`, notClosed === 0 && selfX === 0);
  }
}

// 2. 隣り合う県の境がなめらか化のあとも一致している（すき間・重なりがない）
{
  const denom = 3000000, level = 'strong';
  const arcs = PM.smoothArcsSafe(J.arcs, PM.keptRingRefs(J, { includeIslands: false, minKm2: PM.minKm2(denom) }), PM.toleranceDeg(denom, level), PM.SMOOTH[level].iter, 12).arcs;
  const users = new Map(); // 弧番号 -> [{pref, 順逆}]
  for (const p of J.prefs) for (const poly of p.p) for (const refs of poly.r) for (const r of refs) { const id = r >= 0 ? r : ~r; if (!users.has(id)) users.set(id, []); users.get(id).push({ pref: p.id, fwd: r >= 0 }); }
  let pairs = 0, mismatch = 0;
  for (const [id, us] of users) {
    if (us.length < 2) continue;
    pairs++;
    const a = PM.decodeRing(arcs, [us[0].fwd ? id : ~id]);
    const b = PM.decodeRing(arcs, [us[1].fwd ? id : ~id]).reverse();
    if (a.length !== b.length || a.some((p, i) => p[0] !== b[i][0] || p[1] !== b[i][1])) mismatch++;
    if (us[0].fwd === us[1].fwd) mismatch++; // 向きが同じなら共有になっていない
  }
  pass(`共有する県境 ${pairs}本: 隣どうしで頂点が完全に一致（ずれ0）`, pairs > 20 && mismatch === 0, `不一致 ${mismatch}`);
}

// 3. ピースごとの縮尺（県の中心の緯度で補正）：測地線距離との差
{
  let worst = 0, worstName = '', worstNoFix = 0, worstNoFixName = '';
  for (const denom of [1000000, 3000000, 5000000]) {
    const proj = PM.japanProjection(d3, denom);
    const arcs = PM.smoothArcsSafe(J.arcs, PM.keptRingRefs(J, { includeIslands: false, minKm2: PM.minKm2(denom) }), PM.toleranceDeg(denom, 'normal'), 2, 12).arcs;
    for (const pref of J.prefs) {
      const g = PM.buildPrefGeometry(d3, Core, pref, arcs, { includeIslands: false, minKm2: PM.minKm2(denom) });
      const pts = g.multi.coordinates.flatMap((poly) => poly[0]);
      const [[w, s], [e, n]] = d3.geoBounds(g.multi);
      const latC = (s + n) / 2, lonC = (w + e) / 2;
      const f = 1 / PM.kFactor(d3, proj, latC, lonC);
      let rs = 1;
      for (let t = 0; t < 1500; t++) {
        rs = (rs * 48271) % 2147483647;
        const i = rs % pts.length; rs = (rs * 48271) % 2147483647; const j = rs % pts.length;
        const geo = d3.geoDistance(pts[i], pts[j]) * R;
        if (geo < 3000) continue;
        const pa = proj(pts[i]), pb = proj(pts[j]);
        const mm = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
        const err = Math.abs((mm * f * denom) / 1000 - geo) / geo;
        const errNo = Math.abs((mm * denom) / 1000 - geo) / geo;
        if (err > worst) { worst = err; worstName = `${pref.n} 1/${denom / 10000}万`; }
        if (errNo > worstNoFix) { worstNoFix = errNo; worstNoFixName = `${pref.n} 1/${denom / 10000}万`; }
      }
    }
  }
  pass(`ピース単位の縮尺（補正あり）全県×3縮尺の最大誤差 ${(worst * 100).toFixed(3)}%（${worstName}）`, worst < 0.005);
  console.log(`参考: 補正なしで1つの図法のまま使うと最大 ${(worstNoFix * 100).toFixed(2)}%（${worstNoFixName}）`);
}

// 3b. 隣り合うピースの縮尺補正の差による、境の長さのずれ（紙の上のmm）
{
  const denom = 3000000;
  const opts = { includeIslands: false, minKm2: PM.minKm2(denom) };
  const refs = PM.keptRingRefs(J, opts);
  const arcs = PM.smoothArcsSafe(J.arcs, refs, PM.toleranceDeg(denom, 'normal'), 2, 12).arcs;
  const proj = PM.japanProjection(d3, denom);
  const fOf = new Map();
  for (const pref of J.prefs) {
    const g = PM.buildPrefGeometry(d3, Core, pref, arcs, opts);
    const [[w, s], [e, n]] = d3.geoBounds(g.multi);
    fOf.set(pref.id, 1 / PM.kFactor(d3, proj, (s + n) / 2, (w + e) / 2));
  }
  const users = new Map();
  for (const p of J.prefs) for (const i of PM.keptPolygons(p, opts).kept) for (const rr of p.p[i].r) for (const r of rr) { const id = r >= 0 ? r : ~r; if (!users.has(id)) users.set(id, new Set()); users.get(id).add(p.id); }
  let worst = 0, worstPair = '';
  for (const [id, set] of users) {
    if (set.size < 2) continue;
    const [A, B] = [...set];
    const pts = arcs[id].map((c) => proj(c));
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const mis = Math.abs(fOf.get(A) - fOf.get(B)) * len;
    if (mis > worst) { worst = mis; worstPair = `${J.prefs.find((x) => x.id === A).n}と${J.prefs.find((x) => x.id === B).n}の境(${len.toFixed(0)}mm)`; }
  }
  pass(`隣り合うピースの境の長さのずれ（1/300万）最大 ${worst.toFixed(2)}mm（${worstPair}）`, worst < 1.0);
}

// 4. 並べ方：重ならない・用紙の範囲内
{
  const area = { x0: 6, y0: 18, x1: 194, y1: 261 };
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let bad = 0, total = 0;
  for (let t = 0; t < 200; t++) {
    const pieces = Array.from({ length: 47 }, (_, i) => ({ id: i + 1, w: 8 + rnd() * 120, h: 8 + rnd() * 120 }));
    const r = PM.packPieces(pieces, area, 6);
    const byId = new Map(pieces.map((p) => [p.id, p]));
    const placed = new Set();
    for (const page of r.pages) {
      for (const it of page) { placed.add(it.id); const p = byId.get(it.id); if (it.x < area.x0 - 1e-6 || it.y < area.y0 - 1e-6 || it.x + p.w > area.x1 + 1e-6 || it.y + p.h > area.y1 + 1e-6) bad++; }
      for (let i = 0; i < page.length; i++) for (let j = i + 1; j < page.length; j++) {
        const a = page[i], b = page[j], pa = byId.get(a.id), pb = byId.get(b.id);
        if (a.x < b.x + pb.w + 5.99 && b.x < a.x + pa.w + 5.99 && a.y < b.y + pb.h + 5.99 && b.y < a.y + pa.h + 5.99) bad++;
      }
    }
    total += pieces.length;
    if (placed.size + r.unfit.length !== 47) bad++;
  }
  pass(`並べ方: ランダムな大きさ 200通り×47個で、はみ出し・重なり・紛失 ${bad}件`, bad === 0);
}
