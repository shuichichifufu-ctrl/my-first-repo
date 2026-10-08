/* 計算の中核（画面に依存しない部分）。ブラウザでもNodeの検証でも同じものを使う。 */
const PuzzleCore = (function () {
  const R_M = 6371008.8; // 地球の半径(m)。球体として計算する
  const GLUE = 15; // のりしろ幅(mm)
  const MARK_LEN = 8; // 合わせマークの長さ(mm)
  const MARK_INSET = MARK_LEN / 2; // ページの端からマークの中心までの距離(mm)
  const EPS = 1e-9;
  const SHEETS = {
    portrait: { W: 200, H: 287 }, // 描画できる範囲(用紙の四辺5mmを除く)
    landscape: { W: 287, H: 200 },
  };

  // 列数(行数)。地図の長さM、描画幅W、のりしろG
  function gridCount(M, W, G) {
    if (M <= W + EPS) return 1;
    return Math.ceil((M - G) / (W - G) - EPS);
  }

  // 分割。ページ r行c列 が地図全体(シート座標)で占める範囲は x0=c×(W−G), y0=r×(H−G) から W×H
  function layout(MW, MH, W, H, G) {
    const cols = gridCount(MW, W, G);
    const rows = gridCount(MH, H, G);
    const totalW = W + (cols - 1) * (W - G);
    const totalH = H + (rows - 1) * (H - G);
    const pages = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        pages.push({ r, c, n: r * cols + c + 1, x0: c * (W - G), y0: r * (H - G) });
      }
    }
    return { cols, rows, W, H, G, totalW, totalH, pages };
  }

  // 頂点の並び順が逆で、県ではなく地球全体を塗りつぶしてしまう多角形を見つけて直す
  function fixRings(d3, rings) {
    const area = d3.geoArea({ type: 'Polygon', coordinates: rings });
    if (area > 2 * Math.PI) return { rings: rings.map((r) => r.slice().reverse()), fixed: true };
    return { rings, fixed: false };
  }

  // 県のデータから、描く陸地(MultiPolygon)を作る
  function buildGeometry(d3, pref, includeIslands) {
    const coords = [];
    let excluded = 0;
    let excludedKm2 = 0;
    let fixedCount = 0;
    for (const p of pref.p) {
      if (!includeIslands && !p.m) {
        excluded++;
        excludedKm2 += p.a;
        continue;
      }
      const f = fixRings(d3, p.r);
      if (f.fixed) fixedCount++;
      coords.push(f.rings);
    }
    return {
      multi: { type: 'MultiPolygon', coordinates: coords },
      excluded,
      excludedKm2,
      fixedCount,
      count: coords.length,
    };
  }

  // 県ごとに中心を合わせた横メルカトル図法。座標の単位はmm
  function buildProjection(d3, multi, denom) {
    const [[w, s], [e0, n]] = d3.geoBounds(multi);
    const e = e0 < w ? e0 + 360 : e0;
    const lon0 = (w + e) / 2;
    const lat0 = (s + n) / 2;
    const scale = (R_M * 1000) / denom; // 地球の半径(mm)÷縮尺の分母 = 1ラジアンあたりのmm
    const proj = d3.geoTransverseMercator().rotate([-lon0, -lat0]).scale(scale).translate([0, 0]);
    const path = d3.geoPath(proj);
    const [[x0, y0], [x1, y1]] = path.bounds(multi);
    return { proj, path, lon0, lat0, scale, x0, y0, x1, y1, MW: x1 - x0, MH: y1 - y0 };
  }

  // 合わせマークの位置(シート座標)。
  // のりしろの帯ごとに、帯の中央に1つ（帯の両端と、縦横の帯が交わる所）。端のページには端から4mm内側。
  function markGrid(lay) {
    const xs = new Set([round3(MARK_INSET), round3(lay.totalW - MARK_INSET)]);
    const ys = new Set([round3(MARK_INSET), round3(lay.totalH - MARK_INSET)]);
    for (let c = 1; c < lay.cols; c++) xs.add(round3(c * (lay.W - lay.G) + lay.G / 2));
    for (let r = 1; r < lay.rows; r++) ys.add(round3(r * (lay.H - lay.G) + lay.G / 2));
    return { xs: [...xs].sort((a, b) => a - b), ys: [...ys].sort((a, b) => a - b) };
  }
  function round3(v) {
    return Math.round(v * 1000) / 1000;
  }

  // 点(x,y)(シート座標)を、マークごと含むページ(印刷するものだけ)
  function pagesHoldingMark(lay, printed, x, y) {
    const out = [];
    for (const p of lay.pages) {
      if (!printed[p.n - 1]) continue;
      if (
        x >= p.x0 + MARK_INSET - EPS && x <= p.x0 + lay.W - MARK_INSET + EPS &&
        y >= p.y0 + MARK_INSET - EPS && y <= p.y0 + lay.H - MARK_INSET + EPS
      ) out.push(p);
    }
    return out;
  }

  // 各ページが描く合わせマーク(ページ内座標)。2枚以上の印刷ページにかかる点だけ。
  function marksForPages(lay, printed) {
    const grid = markGrid(lay);
    const byPage = new Map(lay.pages.map((p) => [p.n, []]));
    for (const x of grid.xs) {
      for (const y of grid.ys) {
        const holders = pagesHoldingMark(lay, printed, x, y);
        if (holders.length < 2) continue;
        for (const p of holders) byPage.get(p.n).push({ x: round3(x - p.x0), y: round3(y - p.y0), sx: x, sy: y });
      }
    }
    return byPage;
  }

  return { R_M, GLUE, MARK_LEN, MARK_INSET, SHEETS, gridCount, layout, fixRings, buildGeometry, buildProjection, markGrid, marksForPages, pagesHoldingMark };
})();
if (typeof module !== 'undefined') module.exports = PuzzleCore;
