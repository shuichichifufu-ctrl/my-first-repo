// 使い方: node tools/prep_units.mjs <市町村のGeoJSONが入ったフォルダ> <出力先 src/aichi_arcs.js>
// 愛知県の市町村パズル用。国土数値情報の行政区域（N03、JapanCityGeoJson 2020 が市区町村ごとに分けたもの）から、
//  ・名古屋市の16の区を1つの「名古屋市」にまとめ（区の間の境は消す）
//  ・隣り合う市町村が共有する境を1本の「弧」にまとめて、間引く
// 県境のときと同じ形（弧と環の参照）で書き出す。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const d3 = require('../vendor/d3-7.9.0.min.js');

const [, , inDir, outFile] = process.argv;
const PRE_TOL = 0.0002; // 弧を先に間引く許容(度)。約20m
const MIN_AREA_KM2 = 0.02;
const R_KM = 6371.0088;

const key = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
const edgeKey = (a, b) => { const ka = key(a), kb = key(b); return ka < kb ? ka + '|' + kb : kb + '|' + ka; };

function areaKm2(rings) {
  let a = d3.geoArea({ type: 'Polygon', coordinates: rings });
  if (a > 2 * Math.PI) a = 4 * Math.PI - a;
  return a * R_KM * R_KM;
}
function shoelace(ring) { let s = 0; for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return s / 2; }
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

// 地域（愛知県を4つに分ける）
const GROUP = { 名古屋: 0, 尾張: 1, 西三河: 2, 東三河: 3 };
const WEST_MIKAWA = ['岡崎市', '碧南市', '刈谷市', '豊田市', '安城市', '西尾市', '知立市', '高浜市', 'みよし市', '幸田町'];
const EAST_MIKAWA = ['豊橋市', '豊川市', '蒲郡市', '新城市', '田原市', '設楽町', '東栄町', '豊根村'];
function groupOf(name) {
  if (name === '名古屋市') return GROUP.名古屋;
  if (WEST_MIKAWA.includes(name)) return GROUP.西三河;
  if (EAST_MIKAWA.includes(name)) return GROUP.東三河;
  return GROUP.尾張;
}

// 1. 読み込み。名古屋市の区は1つにまとめる
const units = new Map(); // id -> {id, name, feats:[polygons]}
for (const fn of fs.readdirSync(inDir).filter((f) => f.endsWith('.json')).sort()) {
  const fc = JSON.parse(fs.readFileSync(path.join(inDir, fn), 'utf8'));
  for (const f of fc.features) {
    const p = f.properties;
    const isNagoya = p.N03_003 === '名古屋市';
    const id = isNagoya ? 23100 : Number(p.N03_007);
    const name = isNagoya ? '名古屋市' : p.N03_004;
    if (!units.has(id)) units.set(id, { id, name, polys: [] });
    // このデータは、島などの外周が全部1つの「多角形」の中に環として並んでいるので、環をばらして集める
    const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const poly of polys) for (const ring of poly) units.get(id).polys.push([ring]);
  }
}

// 名古屋市: 区の間の境（同じ辺が逆向きに2回出てくる）を消して、外周だけにする
function dissolve(polys) {
  const edges = new Map(); // "a>b" -> [a, b]
  for (const poly of polys) for (const ring of poly) for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    if (key(a) === key(b)) continue;
    const k = key(a) + '>' + key(b), rk = key(b) + '>' + key(a);
    if (edges.has(rk)) edges.delete(rk); else edges.set(k, [a, b]);
  }
  const outFrom = new Map();
  for (const [, [a, b]] of edges) { const ka = key(a); if (!outFrom.has(ka)) outFrom.set(ka, []); outFrom.get(ka).push([a, b]); }
  const rings = [];
  for (const [, [a0, b0]] of edges) {
    const list0 = outFrom.get(key(a0));
    const idx0 = list0.findIndex((e) => e[0] === a0 && e[1] === b0);
    if (idx0 < 0) continue; // すでに使った
    list0.splice(idx0, 1);
    const ring = [a0, b0];
    let cur = b0;
    while (key(cur) !== key(a0)) {
      const list = outFrom.get(key(cur));
      if (!list || !list.length) break;
      const e = list.shift();
      ring.push(e[1]); cur = e[1];
    }
    if (key(ring[0]) === key(ring[ring.length - 1]) && ring.length >= 4) rings.push(ring);
  }
  return rings.map((r) => [r]);
}
// 環を、外周と穴に分け直して多角形にする。外周の向きは、いちばん大きい環の向きとする
function regroup(rings) {
  const sign = (r) => (shoelace(r) >= 0 ? 1 : -1);
  const big = rings.reduce((a, b) => (Math.abs(shoelace(b)) > Math.abs(shoelace(a)) ? b : a));
  const outerSign = sign(big);
  const outers = rings.filter((r) => sign(r) === outerSign).map((r) => [r]);
  const holes = rings.filter((r) => sign(r) !== outerSign);
  for (const h of holes) {
    const pt = h[0];
    const host = outers.filter((o) => d3.polygonContains(o[0], pt)).sort((a, b) => Math.abs(shoelace(a[0])) - Math.abs(shoelace(b[0])))[0];
    if (host) host.push(h);
  }
  return outers;
}
for (const u of units.values()) {
  const flat = u.polys.map((p) => p[0]);
  if (u.id === 23100) u.polys = regroup(dissolve(u.polys).flat());
  else u.polys = regroup(flat);
}

// 2. 辺ごとに、どの市町村が持っているかを集める
const edgeOwners = new Map();
for (const u of units.values()) for (const poly of u.polys) for (const ring of poly) {
  for (let i = 0; i < ring.length - 1; i++) {
    if (key(ring[i]) === key(ring[i + 1])) continue;
    const k = edgeKey(ring[i], ring[i + 1]);
    if (!edgeOwners.has(k)) edgeOwners.set(k, new Set());
    edgeOwners.get(k).add(u.id);
  }
}

// 3. 環を弧に分ける（prep_arcs.mjs と同じ）
const arcs = [];
const arcIndex = new Map();
function arcFor(points, shared) {
  const keys = points.map(key);
  const fwd = keys.join(';'), rev = [...keys].reverse().join(';');
  if (shared) {
    const canon = fwd < rev ? fwd : rev;
    if (arcIndex.has(canon)) { const id = arcIndex.get(canon); return fwd === arcs[id].fwd ? id : ~id; }
    arcs.push({ pts: points, fwd });
    arcIndex.set(canon, arcs.length - 1);
    return arcs.length - 1;
  }
  arcs.push({ pts: points, fwd });
  return arcs.length - 1;
}
const out = [];
const stat = { rings: 0, closedSingle: 0, sharedClosed: 0 };
for (const u of [...units.values()].sort((a, b) => a.id - b.id)) {
  const outPolys = [];
  for (const rings of u.polys) {
    const area = areaKm2(rings);
    if (area < MIN_AREA_KM2) continue;
    const ringsOut = rings.map((ring) => {
      stat.rings++;
      const n = ring.length - 1;
      const pts = ring.slice(0, n);
      const lab = [];
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const o = key(a) === key(b) ? null : edgeOwners.get(edgeKey(a, b));
        lab.push(o && o.size > 1 ? [...o].filter((x) => x !== u.id).join('+') : '');
      }
      let start = -1;
      for (let i = 0; i < n; i++) if (lab[i] !== lab[(i + n - 1) % n]) { start = i; break; }
      const refs = [];
      if (start < 0) {
        stat.closedSingle++;
        if (lab[0] !== '') {
          let mi = 0;
          for (let i = 1; i < n; i++) if (key(pts[i]) < key(pts[mi])) mi = i;
          const seq = [...pts.slice(mi), ...pts.slice(0, mi)];
          const rseq = [seq[0], ...seq.slice(1).reverse()];
          const useSeq = key(seq[1]) < key(rseq[1]) ? seq : rseq;
          refs.push(arcFor([...useSeq, useSeq[0]], true)); stat.sharedClosed++;
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
      return refs;
    });
    outPolys.push({ m: 1, a: Math.round(area * 100) / 100, r: ringsOut });
  }
  out.push({ id: u.id, n: u.name, g: groupOf(u.name), p: outPolys });
}

// 4. 弧を先に間引く
let before = 0, after = 0;
const arcOut = arcs.map((a) => {
  before += a.pts.length;
  let pts = a.pts;
  if (pts.length > 2) {
    const closed = key(pts[0]) === key(pts[pts.length - 1]);
    if (closed && pts.length > 4) {
      let far = 1, best = -1;
      for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > best) { best = d; far = i; } }
      pts = dp(pts.slice(0, far + 1), PRE_TOL).concat(dp(pts.slice(far), PRE_TOL).slice(1));
    } else pts = dp(pts, PRE_TOL);
  }
  const q = pts.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);
  after += q.length;
  return q;
});

// 5. 検査
let bad = 0;
const decode = (refs) => { const pts = []; for (const r of refs) { const a = r >= 0 ? arcOut[r] : [...arcOut[~r]].reverse(); pts.push(...(pts.length ? a.slice(1) : a)); } return pts; };
for (const u of out) for (const poly of u.p) for (const refs of poly.r) { const pts = decode(refs); const a = pts[0], b = pts[pts.length - 1]; if (a[0] !== b[0] || a[1] !== b[1]) bad++; }
const js = '/* 出典：国土数値情報（行政区域データ N03-20200101）（国土交通省）を加工して作成 */\nconst AICHI_ARCS=' + JSON.stringify({ arcs: arcOut, prefs: out }) + ';\n';
fs.writeFileSync(outFile, js);
console.log({ units: out.length, ...stat, arcs: arcs.length, pointsBefore: before, pointsAfter: after, notClosed: bad, bytes: js.length });
console.log(out.map((u) => `${u.id}${u.n}(${u.p.length})`).join(' '));
