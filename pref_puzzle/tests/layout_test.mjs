// 分割の計算：列数・行数・各ページの範囲が式どおりか、隣り合うページの重なりがちょうど15mmか
import { Core, pass } from './common.mjs';
const G = 15;
let bad = 0, cases = 0;
const sizes = [[200, 287], [287, 200]];
const maxs = [];
for (let m = 1; m <= 2600; m += 7.3) maxs.push(m);
maxs.push(200, 287, 200.0000001, 199.999, 185, 185.0001, 370, 370.0001, 385, 385.0001, 555, 740, 15, 1, 570);
for (const [W, H] of sizes) {
  for (const MW of maxs) for (const MH of [50, 187.3, 200, 287, 287.5, 560, 1234.5]) {
    cases++;
    const L = Core.layout(MW, MH, W, H, G);
    // 式を別の書き方で: 最小の列数 n で W+(n-1)(W-G) >= MW
    let n = 1; while (W + (n - 1) * (W - G) < MW - 1e-7) n++;
    let m = 1; while (H + (m - 1) * (H - G) < MH - 1e-7) m++;
    if (L.cols !== n || L.rows !== m) { bad++; console.log('cols/rows mismatch', W, H, MW, MH, L.cols, n, L.rows, m); continue; }
    if (L.pages.length !== n * m) { bad++; continue; }
    for (const p of L.pages) {
      if (Math.abs(p.x0 - p.c * (W - G)) > 1e-9 || Math.abs(p.y0 - p.r * (H - G)) > 1e-9) { bad++; console.log('origin'); }
      const right = L.pages.find((q) => q.r === p.r && q.c === p.c + 1);
      if (right && Math.abs((p.x0 + W) - right.x0 - G) > 1e-9) { bad++; console.log('overlap x'); }
      const down = L.pages.find((q) => q.c === p.c && q.r === p.r + 1);
      if (down && Math.abs((p.y0 + H) - down.y0 - G) > 1e-9) { bad++; console.log('overlap y'); }
    }
    // 全体の範囲が地図を覆う
    if (L.totalW < MW - 1e-7 || L.totalH < MH - 1e-7) { bad++; console.log('cover'); }
  }
}
pass(`分割の式 ${cases}通り`, bad === 0, `不一致 ${bad}`);

// 具体例（手計算）
const ex = [[200, 200, 1], [200.1, 200.1, 2], [385, 385, 2], [385.01, 385.01, 3], [555, 555, 3]];
for (const [mw, , cols] of ex) {
  const c = Core.layout(mw, 100, 200, 287, 15).cols;
  pass(`MW=${mw} → 列数${cols}`, c === cols, `得た値 ${c}`);
}
// 地図の配置：全ページを合わせた範囲の中央
const L2 = Core.layout(300, 100, 200, 287, 15);
pass('総幅=W+(列数-1)(W-G)', Math.abs(L2.totalW - (200 + 185)) < 1e-9);

// 合わせマーク：位置は全体座標で一度だけ決まり、重なる2ページ以上で一致する
let markBad = 0;
for (const [cols, rows] of [[2, 1], [3, 2], [4, 3], [1, 3], [5, 5]]) {
  const L = Core.layout(200 + (cols - 1) * 185 - 1, 287 + (rows - 1) * 272 - 1, 200, 287, 15);
  const printed = L.pages.map(() => true);
  const marks = Core.marksForPages(L, printed);
  const seen = new Map();
  for (const p of L.pages) for (const m of marks.get(p.n)) {
    const key = m.sx + ',' + m.sy;
    const gx = p.x0 + m.x, gy = p.y0 + m.y;
    if (Math.abs(gx - m.sx) > 1e-6 || Math.abs(gy - m.sy) > 1e-6) markBad++;
    seen.set(key, (seen.get(key) || 0) + 1);
    if (m.x < 4 - 1e-9 || m.x > 200 - 4 + 1e-9 || m.y < 4 - 1e-9 || m.y > 287 - 4 + 1e-9) markBad++;
  }
  for (const [k, v] of seen) if (v < 2) markBad++;
  if (cols * rows > 1 && seen.size === 0) markBad++;
}
pass('合わせマーク(全体座標で1回だけ決め、各点が2ページ以上に載る)', markBad === 0, `不一致 ${markBad}`);
