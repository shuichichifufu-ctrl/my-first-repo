// 頂点の並び順：全面塗りつぶしが起きないか。元のデータ・全部を逆にしたデータ・一部だけ逆にしたデータで確かめる
import { d3, Core, PREFS, R, pass } from './common.mjs';
function tooBig(P, g, denom) {
  // 描画範囲が異常に大きい（県の大きさの数倍以上）なら全面塗りつぶし
  const area = d3.geoPath(P.proj).area(g.multi); // mm²
  const trueArea = d3.geoArea(g.multi) * R * R / 1e6; // km² を m² から
  const expected = (trueArea * 1e6) / ((denom / 1000) ** 2); // mm²
  return { ratio: area / expected, area };
}
for (const mode of ['元のデータ', '全部逆', '一部だけ逆']) {
  let worst = 0, fixedTotal = 0, bigCount = 0, n = 0;
  for (const p of PREFS) {
    const pref = mode === '元のデータ' ? p : {
      ...p,
      p: p.p.map((x, i) => ({ ...x, r: (mode === '全部逆' || i % 2 === 0) ? x.r.map((r) => r.slice().reverse()) : x.r })),
    };
    for (const isl of [false, true]) {
      const g = Core.buildGeometry(d3, pref, isl);
      fixedTotal += g.fixedCount;
      const P = Core.buildProjection(d3, g.multi, 500000);
      const t = tooBig(P, g, 500000);
      n++;
      const dev = Math.abs(t.ratio - 1);
      if (dev > worst) worst = dev;
      if (P.MW > 20000 || P.MH > 20000 || !isFinite(P.MW)) bigCount++;
    }
  }
  pass(`${mode}: 全県で面積が地理上の面積と一致 (最大のずれ ${(worst * 100).toFixed(2)}%)・異常な範囲 ${bigCount}件・自動修正 ${fixedTotal}か所`, worst < 0.02 && bigCount === 0);
}
// 修正しないとどうなるか（検証の意味の確認）
{
  const p = PREFS.find((x) => x.id === 23);
  const rev = p.p.map((x) => x.r.map((r) => r.slice().reverse()));
  const multi = { type: 'MultiPolygon', coordinates: rev };
  const a = d3.geoArea(multi);
  console.log(`参考: 愛知県を逆向きのまま扱うと球面上の面積は ${(a / (4 * Math.PI) * 100).toFixed(1)}% (地球全体にほぼ近い) → 修正が必要`);
}
