/* 画面と、各ページのSVGを組み立てる部分 */
(function () {
  const Core = PuzzleCore;
  const G = Core.GLUE;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const r2 = (v) => Math.round(v * 100) / 100;
  const FONT = "'Noto Sans JP','Hiragino Sans','Yu Gothic','Meiryo','IPAGothic',sans-serif";
  const CREDIT = '出典：地球地図日本（国土地理院）の都道府県境を簡略化して使用（非営利利用）';

  const MAX_PAGES = 400; // これより多いと画面が重くなるので、作らない
  const cm = (mm) => (mm >= 1000 ? `${(mm / 10).toFixed(0)}cm（約${(mm / 1000).toFixed(1)}m）` : `${(mm / 10).toFixed(1)}cm`);
  const scaleName = (d) => (d % 10000 === 0 ? `1/${d / 10000}万` : `1/${fmt(d)}`);

  const state = { mode: 'pref', smooth: 'normal', prefId: 23, denom: 500000, paper: 'A4', orient: 'portrait', islands: false, skipBlank: true, sample: true };

  /* ---------- モデル(計算結果)の作成 ---------- */
  function buildModel(prefId, denom, orient, islands, skipBlank, paper) {
    const pref = PREF_DATA.find((p) => p.id === prefId);
    const geo = Core.buildGeometry(d3, pref, islands);
    const P = Core.buildProjection(d3, geo.multi, denom);
    const { W, H, paperW, paperH } = Core.sheetSize(paper || 'A4', orient);
    const lay = Core.layout(P.MW, P.MH, W, H, G);
    if (lay.pages.length > MAX_PAGES) return { tooMany: true, pref, geo, P, lay, denom, orient, paper, printCount: lay.pages.length, blankCount: 0 };
    const ox = (lay.totalW - P.MW) / 2 - P.x0; // 地図を全ページを合わせた範囲の中央に置く
    const oy = (lay.totalH - P.MH) / 2 - P.y0;
    const path = d3.geoPath(P.proj).digits(2);
    // 各ページの範囲だけを切り出し、何も残らなければ空白ページ
    for (const p of lay.pages) {
      P.proj.translate([ox - p.x0, oy - p.y0]).clipExtent([[0, 0], [W, H]]);
      p.blank = !path(geo.multi);
      // のりしろ(左・上)を除いた範囲に地図がなければ、隣の紙が同じ絵を持っているので、印刷を省いてよい
      P.proj.clipExtent([[p.c > 0 ? G : 0, p.r > 0 ? G : 0], [W, H]]);
      p.skip = p.blank || !path(geo.multi);
    }
    P.proj.clipExtent(null).translate([0, 0]);
    const printed = lay.pages.map((p) => !(skipBlank && p.skip));
    const model = { pref, geo, P, lay, ox, oy, path, printed, denom, orient, skipBlank, islands, paper: paper || 'A4', paperW, paperH };
    model.blankCount = lay.pages.filter((p) => p.skip).length;
    model.printCount = printed.filter(Boolean).length;
    return model;
  }

  /* ---------- 1ページ分のSVG ---------- */
  function scaleBar(x, y) {
    let s = `<line x1="${x}" y1="${y}" x2="${x + 100}" y2="${y}" stroke="#000" stroke-width="0.4"/>`;
    for (let i = 0; i <= 10; i++) {
      const h = i === 0 || i === 10 ? 3 : 1.6;
      s += `<line x1="${x + i * 10}" y1="${y - h}" x2="${x + i * 10}" y2="${y}" stroke="#000" stroke-width="${i % 10 === 0 ? 0.4 : 0.25}"/>`;
    }
    return s;
  }

  function text(x, y, size, str, extra) {
    return `<text x="${r2(x)}" y="${r2(y)}" font-size="${size}" font-family="${FONT}" ${extra || ''}>${esc(str)}</text>`;
  }

  const HALO = 'stroke="#fff" stroke-width="0.6" stroke-linejoin="round" paint-order="stroke"';

  // 説明パネル。白い箱は敷かず、白ふち付きの文字だけにして、下の斜線や県境線を隠さない
  function panelSVG(model, p, rect) {
    const { lay, pref, denom } = model;
    const { x, y } = rect;
    const total = lay.rows * lay.cols;
    const nm = (r, c) => `行${r + 1}-列${c + 1}`;
    const bottomExists = p.r < lay.rows - 1;
    const bottomPrinted = bottomExists && model.printed[(p.r + 1) * lay.cols + p.c];
    let s = text(x + 1, y + 3.7, 3.6, `${pref.n}　縮尺 ${scaleName(denom)}　ページ ${p.n}/${total}　${nm(p.r, p.c)}（全${lay.rows}行×${lay.cols}列）`, `font-weight="700" fill="#111" ${HALO}`);
    s += scaleBar(x + 1, y + 7.9);
    s += text(x + 104, y + 8.4, 2.9, '←この線が10cmなら正しく印刷できています', `fill="#111" ${HALO}`);
    if (bottomExists) {
      s += text(x + 1, y + 11.6, 3.4, `のりしろ：この上に下の紙を重ねて貼る　下へ↓${nm(p.r + 1, p.c)}${bottomPrinted ? '' : '（印刷なし）'}`, `fill="#111" font-weight="700" ${HALO}`);
    }
    const cut = p.c > 0 || p.r > 0 ? '点線の外の白い余白（5mm）を切り落とす' : 'この紙は余白を切らない';
    s += text(x + 1, y + 14.7, 3.0, cut, `fill="#111" font-weight="700" ${HALO}`);
    s += text(x + 1 + cut.length * 3.0 + 3, y + 14.7, 2.6, '出典：地球地図日本（国土地理院）を簡略化して使用', `fill="#333" ${HALO}`);
    return s;
  }

  function choosePanelRect(model, p, geoMulti) {
    const { lay } = model;
    const W = lay.W, H = lay.H;
    const ph = 15;
    if (p.r < lay.rows - 1) return { x: G, y: H - ph, w: W - 2 * G, h: ph };
    const pw = 165;
    const rightLimit = p.c < lay.cols - 1 ? W - G : W - 2;
    const cands = [
      { x: G, y: H - ph - 3 }, { x: rightLimit - pw, y: H - ph - 3 },
      { x: G, y: 3 }, { x: rightLimit - pw, y: 3 },
    ].map((q) => ({ ...q, w: pw, h: ph }));
    let best = null;
    for (const q of cands) {
      model.P.proj.translate([model.ox - p.x0, model.oy - p.y0]).clipExtent([[q.x, q.y], [q.x + q.w, q.y + q.h]]);
      const area = model.path.area(geoMulti);
      if (!best || area < best.area - 1e-6) best = { ...q, area };
      if (area === 0) break;
    }
    model.P.proj.clipExtent(null);
    return best;
  }

  /* ---------- 緯度経度の目盛り（位置合わせの目安・学習用） ---------- */
  function gratStep(denom) {
    // 目盛りの間隔が紙の上で40mm以上になる、いちばん細かい間隔
    for (const st of [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5]) if ((st * 111.2e6) / denom >= 40) return st;
    return 5;
  }
  function buildGraticule(model) {
    const step = gratStep(model.denom);
    const [[w, s0], [e0, n]] = d3.geoBounds(model.geo.multi);
    const e = e0 < w ? e0 + 360 : e0;
    const lo = [Math.floor((w - 2 * step) / step) * step, Math.floor((s0 - 2 * step) / step) * step];
    const hi = [Math.ceil((e + 2 * step) / step) * step, Math.ceil((n + 2 * step) / step) * step];
    const r6 = (v) => Math.round(v * 1e6) / 1e6;
    const lines = [];
    const fine = Math.min(0.05, step / 2); // 点の間隔(度)。途中の点があるので、ページ内の位置に文字を置ける
    for (let lon = lo[0]; lon <= hi[0] + 1e-9; lon += step) {
      const cs = [];
      for (let lat = lo[1]; lat <= hi[1] + 1e-9; lat += fine) cs.push([r6(lon), r6(lat)]);
      lines.push(cs);
    }
    for (let lat = lo[1]; lat <= hi[1] + 1e-9; lat += step) {
      const cs = [];
      for (let lon = lo[0]; lon <= hi[0] + 1e-9; lon += fine) cs.push([r6(lon), r6(lat)]);
      lines.push(cs);
    }
    return { step, lines, geom: { type: 'MultiLineString', coordinates: lines } };
  }
  function graticuleSVG(model, p) {
    const { lay, P, path } = model;
    const gr = model.grat || (model.grat = buildGraticule(model));
    const W = lay.W, H = lay.H;
    P.proj.translate([model.ox - p.x0, model.oy - p.y0]).clipExtent([[-1, -1], [W + 1, H + 1]]);
    const d = path(gr.geom);
    P.proj.clipExtent(null);
    let s = d ? `<path class="grat" d="${d}" fill="none" stroke="#7d93a8" stroke-width="0.15" stroke-opacity="0.9"/>` : '';
    const dec = gr.step >= 1 ? 0 : gr.step >= 0.1 && Math.abs(gr.step * 10 - Math.round(gr.step * 10)) < 1e-9 ? 1 : gr.step >= 0.05 ? 2 : 3;
    const x0 = 14, x1 = W - 34, y0 = 14, y1 = H - 20;
    for (const coords of gr.lines) {
      const meridian = Math.abs(coords[0][0] - coords[1][0]) < 1e-9;
      for (const c of coords) {
        const q = P.proj(c);
        if (q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1) {
          const label = meridian ? `${c[0].toFixed(dec)}°E` : `${c[1].toFixed(dec)}°N`;
          s += text(q[0] + 0.8, q[1] - 0.8, 2.4, label, `fill="#51657a" stroke="#fff" stroke-width="0.5" paint-order="stroke"`);
          break;
        }
      }
    }
    P.proj.translate([0, 0]);
    return s;
  }

  function pageSVG(model, p, marks) {
    const { lay, geo, P, path, printed } = model;
    const W = lay.W, H = lay.H;
    const id = `p${p.n}`;
    const hasRight = p.c < lay.cols - 1;
    const hasBottom = p.r < lay.rows - 1;
    const rightPrinted = hasRight && printed[p.r * lay.cols + p.c + 1];
    const bottomPrinted = hasBottom && printed[(p.r + 1) * lay.cols + p.c];
    let s = `<svg class="pg" xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" data-page="${p.n}" data-row="${p.r + 1}" data-col="${p.c + 1}" role="img" aria-label="ページ${p.n}">`;
    s += `<defs><pattern id="hatch-${id}" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2.4" stroke="#707070" stroke-width="0.4"/></pattern>`;
    s += `<clipPath id="clip-${id}"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath></defs>`;
    s += `<g clip-path="url(#clip-${id})">`;
    if (p.blank) {
      s += text(W / 2, H / 2, 6, 'このページには地図がありません（空白ページ）', 'text-anchor="middle" fill="#888"');
    } else {
      P.proj.translate([model.ox - p.x0, model.oy - p.y0]).clipExtent([[-8, -8], [W + 8, H + 8]]);
      const d = path(geo.multi);
      P.proj.clipExtent(null);
      s += `<path class="land" d="${d}" fill="#f6f1e3" stroke="#1a1a1a" stroke-width="0.3" stroke-linejoin="round"/>`;
      s += graticuleSVG(model, p);
    }
    // のりしろ（右・下）
    if (rightPrinted) {
      s += `<rect class="glue" x="${W - G}" y="0" width="${G}" height="${H}" fill="url(#hatch-${id})" fill-opacity="0.6"/>`;
      s += `<rect x="${W - G}" y="0" width="${G}" height="${H}" fill="#000" fill-opacity="0.035"/>`;
    }
    if (bottomPrinted) {
      s += `<rect class="glue" x="0" y="${H - G}" width="${W}" height="${G}" fill="url(#hatch-${id})" fill-opacity="0.6"/>`;
      s += `<rect x="0" y="${H - G}" width="${W}" height="${G}" fill="#000" fill-opacity="0.035"/>`;
    }
    // 右のりしろの文字
    if (hasRight) {
      const gx = W - G;
      const halo = HALO;
      s += `<text transform="translate(${gx + 1.2},${H / 2}) rotate(90)" text-anchor="middle" font-size="3.1" font-family="${FONT}" fill="#111" ${halo}>のりしろ：この上に右の紙を重ねて貼る</text>`;
      s += text(gx + 4.6, H / 2 - 6, 3.4, '右へ→', `font-weight="700" fill="#111" ${halo}`);
      s += text(gx + 4.6, H / 2 - 1.8, 3.4, `行${p.r + 1}`, `font-weight="700" fill="#111" ${halo}`);
      s += text(gx + 4.6, H / 2 + 2.4, 3.4, `列${p.c + 2}`, `font-weight="700" fill="#111" ${halo}`);
      if (!rightPrinted) s += text(gx + 4.6, H / 2 + 6.6, 2.4, '印刷なし', `fill="#111" ${halo}`);
    }
    // 大きなページ番号（のりしろの帯の中。右端の列は右上）
    {
      const ns = String(p.n);
      const size = Math.min(9, 13 / (0.62 * ns.length));
      if (hasRight) s += text(W - G + G / 2 + 0.5, 25, size, ns, `text-anchor="middle" font-weight="700" fill="#1d4f86" ${HALO}`);
      else s += text(W - 3, 25, size, ns, `text-anchor="end" font-weight="700" fill="#1d4f86" ${HALO}`);
    }
    // 左・上の切り取り線
    if (p.c > 0) s += `<line x1="0.15" y1="0" x2="0.15" y2="${H}" stroke="#666" stroke-width="0.25" stroke-dasharray="2 1.2"/>`;
    if (p.r > 0) s += `<line x1="0" y1="0.15" x2="${W}" y2="0.15" stroke="#666" stroke-width="0.25" stroke-dasharray="2 1.2"/>`;
    // 説明パネル（県名・縮尺・番号・スケールバー・隣のページ）
    const rect = choosePanelRect(model, p, geo.multi);
    s += panelSVG(model, p, rect);
    // 合わせマーク（赤い＋）
    for (const m of marks) {
      s += `<path class="mark" d="M${r2(m.x - 4)},${r2(m.y)}H${r2(m.x + 4)}M${r2(m.x)},${r2(m.y - 4)}V${r2(m.y + 4)}" stroke="#e0001a" stroke-width="0.3" fill="none"/>`;
    }
    s += `</g></svg>`;
    return s;
  }

  /* ---------- 貼り合わせ見本ページ ---------- */
  function sampleSVG(model) {
    const { lay, geo, P, path, pref, denom } = model;
    const W = lay.W, H = lay.H;
    const areaX = 10, areaY = 30, areaW = W - 20, areaH = H - 30 - 72;
    const sc = Math.min(areaW / lay.totalW, areaH / lay.totalH);
    const tx = areaX + (areaW - lay.totalW * sc) / 2, ty = areaY + (areaH - lay.totalH * sc) / 2;
    P.proj.translate([model.ox, model.oy]).clipExtent(null);
    const d = path(geo.multi);
    P.proj.translate([0, 0]);
    const total = lay.rows * lay.cols;
    let s = `<svg class="pg sample" xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" data-sample="1" role="img" aria-label="貼り合わせ見本">`;
    s += text(10, 14, 7, `${pref.n}　貼り合わせ見本（${scaleName(denom)}・${model.paper}）`, 'font-weight="700" fill="#111"');
    s += text(10, 22, 3.6, `${lay.rows}行×${lay.cols}列＝${total}枚。完成サイズ：横${cm(P.MW)} × 縦${cm(P.MH)}。この図は縮小した見本で、実寸ではありません。`, 'fill="#333"');
    s += text(10, 27, 3.2, '青い枠が1枚の紙、数字がページ番号です。', 'fill="#555"');
    s += `<g transform="translate(${r2(tx)},${r2(ty)}) scale(${sc})">`;
    for (const p of lay.pages) {
      const printed = model.printed[p.n - 1];
      s += `<rect x="${p.x0}" y="${p.y0}" width="${W}" height="${H}" fill="${p.skip ? '#9aa5b1' : '#9cc3e8'}" fill-opacity="${p.skip ? 0.3 : 0.25}" stroke="${p.skip ? '#667' : '#1f6fb2'}" stroke-width="${r2(0.5 / sc)}" ${printed ? '' : `stroke-dasharray="${r2(2 / sc)} ${r2(1.5 / sc)}"`}/>`;
    }
    s += `<path d="${d}" fill="#f6f1e3" stroke="#222" stroke-width="${r2(0.3 / sc)}" stroke-linejoin="round"/>`;
    const fs = Math.min(lay.W, lay.H) * 0.3;
    for (const p of lay.pages) {
      s += `<text x="${p.x0 + 6}" y="${p.y0 + fs}" font-size="${fs}" font-family="${FONT}" font-weight="700" fill="${p.skip ? '#667' : '#1d4f86'}" fill-opacity="0.45">${p.n}</text>`;
    }
    s += `</g>`;
    let y = H - 62;
    s += text(10, y, 4.2, '貼り方', 'font-weight="700" fill="#111"');
    const steps = [
      '1. 全ページを印刷し、スケールバー（10cmの線）を定規で測って100mmか確かめる。',
      '2. 点線のある紙は、点線の外側の白い余白（5mm）を切り落とす。行1-列1の紙は切らない。',
      '3. 行1-列1から始め、右の紙・下の紙の順に、斜線ののりしろの上に重ねる。',
      '4. 上の紙を少し透かして、赤い＋が下の紙の＋とぴったり重なるように合わせ、のりで貼る。',
      '5. 地図の細い線は緯度・経度の目盛りです。線がつながるように合わせると、ずれに気づけます。',
      '6. 貼り終わった形が、上の見本と同じになれば完成です。',
    ];
    steps.forEach((t, i) => { s += text(10, y + 7 + i * 5.6, 3.5, t, 'fill="#111"'); });
    if (model.blankCount && model.skipBlank) s += text(10, y + 7 + 6 * 5.6, 3.2, `灰色の点線の枠（空白ページ${model.blankCount}枚）は地図がない、または隣のページと重なるだけなので印刷していません。番号は欠番です。`, 'fill="#555"');
    s += text(10, H - 4, 2.6, '出典：地球地図日本（国土地理院）の都道府県境を簡略化して使用（非営利利用）。縮尺は球体で計算しており約0.2%の誤差があります。', 'fill="#333"');
    s += `</svg>`;
    return s;
  }

  /* ---------- 全体図 ---------- */
  function overviewSVG(model) {
    const { lay, geo, P, path } = model;
    P.proj.translate([model.ox, model.oy]).clipExtent(null);
    const d = path(geo.multi);
    P.proj.translate([0, 0]);
    const pad = 6;
    let s = `<svg id="ovsvg" xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${r2(lay.totalW + 2 * pad)} ${r2(lay.totalH + 2 * pad)}" role="img" aria-label="全体図と分割線">`;
    for (const p of lay.pages) {
      const printed = model.printed[p.n - 1];
      s += `<rect x="${p.x0}" y="${p.y0}" width="${lay.W}" height="${lay.H}" fill="${p.skip ? '#9aa5b1' : '#cfe3f7'}" fill-opacity="${p.skip ? 0.35 : 0.22}" stroke="#2f6db0" stroke-width="1.2" vector-effect="non-scaling-stroke" ${printed ? '' : 'stroke-dasharray="4 3"'}/>`;
    }
    s += `<path d="${d}" fill="#f1ecdc" stroke="#222" stroke-width="1" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
    const fs = Math.min(lay.W, lay.H) * 0.33;
    for (const p of lay.pages) {
      s += `<text x="${p.x0 + 5}" y="${p.y0 + fs}" font-size="${fs}" font-family="${FONT}" font-weight="700" fill="${p.skip ? '#667' : '#1d4f86'}" fill-opacity="0.85">${p.n}</text>`;
    }
    s += `</svg>`;
    return s;
  }

  /* ---------- 日本地図パズル（全国・切り抜き） ---------- */
  const PM = PuzzleMode;
  const AICHI_GROUP_NAMES = ['名古屋', '尾張', '西三河', '東三河'];
  const AICHI_GROUP_COLORS = ['#f7d1d1', '#d6ecc9', '#fbe3b5', '#cfe8f7'];
  // 作るもの（データ）ごとの違い
  const DATASETS = {
    japan: {
      key: 'japan', title: '日本地図パズル', unit: '都道府県', edge: '県境', count: 47, data: () => JAPAN_ARCS, far: true,
      proj: (denom) => PM.japanProjection(d3, denom),
      region: (u) => PM.regionOf(u.id), regionNames: PM.REGION_NAMES, regionColors: PM.REGION_COLORS,
      trim: (n) => n.replace(/[都府県]$/, ''),
      credit: '出典：地球地図日本（国土地理院）の都道府県境を簡略化・なめらかに加工して使用（非営利利用）',
      sampleSub: '全国の大きさ（実物を同縮尺で並べたとき）', pageNote: '全ての県が同じ縮尺です。大きさのずれは、県の中心で合わせています。',
    },
    aichi: {
      key: 'aichi', title: '愛知県の市町村パズル', unit: '市町村', edge: '市町村の境', count: 54, data: () => AICHI_ARCS, far: false,
      proj: (denom) => d3.geoTransverseMercator().rotate([-137.2, -35.0]).scale((PM.R_M * 1000) / denom).translate([0, 0]),
      region: (u) => u.g, regionNames: AICHI_GROUP_NAMES, regionColors: AICHI_GROUP_COLORS,
      trim: (n) => (n.length > 3 ? n.replace(/[市町村]$/, '') : n),
      credit: '出典：国土数値情報（行政区域データ N03-20200101）（国土交通省）を簡略化・なめらかに加工して使用',
      sampleSub: '愛知県の大きさ（実物を同縮尺で並べたとき）', pageNote: '全ての市町村が同じ縮尺です。',
    },
  };
  const dsOf = (mode) => DATASETS[mode === 'aichi' ? 'aichi' : 'japan'];
  const unitName = (ds, id) => ds.data().prefs.find((q) => q.id === id).n;
  const trimName = (n) => n.replace(/[都府県]$/, '').replace(/^北海道$/, '北海道');

  // 名前を県の形の中に収める。形の中でいちばん余裕のある場所を探し、文字の箱が形の中に入る大きさを選ぶ
  function distToRing(ring, x, y) {
    let best = 1e18;
    for (let i = 0; i < ring.length - 1; i++) {
      const ax = ring[i][0], ay = ring[i][1], dx = ring[i + 1][0] - ax, dy = ring[i + 1][1] - ay;
      const l2 = dx * dx + dy * dy;
      let t = l2 === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      const d = (x - (ax + t * dx)) ** 2 + (y - (ay + t * dy)) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
  function labelCandidates(ring) {
    let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
    for (const p of ring) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const out = [];
    const N = 16;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = x0 + ((x1 - x0) * (i + 0.5)) / (N + 1), y = y0 + ((y1 - y0) * (j + 0.5)) / (N + 1);
      if (d3.polygonContains(ring, [x, y])) out.push({ x, y, clr: distToRing(ring, x, y) });
    }
    out.sort((a, b) => b.clr - a.clr);
    return out.slice(0, 8);
  }
  function boxInside(ring, cx, cy, hw, hh) {
    for (const fx of [-1, -0.5, 0, 0.5, 1]) for (const fy of [-1, 0, 1]) if (!d3.polygonContains(ring, [cx + fx * hw, cy + fy * hh])) return false;
    return true;
  }
  // 文字の大きさ(mm、地図の座標と同じ単位)の候補を大きい順に試す。入る最大の大きさと場所を返す
  function bestLabel(cands, len, sizes) {
    for (const sz of sizes) {
      for (const c of cands) if (boxInside(c.ring, c.x, c.y, (len * sz) / 2, sz / 2)) return { x: c.x, y: c.y, size: sz };
    }
    return null;
  }

  function buildJapanModel(ds, denom, orient, paper, level) {
    const { W, H, paperW, paperH } = Core.sheetSize(paper || 'A4', orient);
    const D = ds.data();
    const opts = { includeIslands: !ds.far, minKm2: PM.minKm2(denom) };
    const refs = PM.keptRingRefs(D, opts);
    const proj = ds.proj(denom);
    // 交差の検査は、紙の上の座標（0.01mmに丸めたもの）で行う
    const mapFn = (c) => { const q = proj(c); return [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]; };
    const sm = PM.smoothArcsSafe(D.arcs, refs, PM.toleranceDeg(denom, level), PM.SMOOTH[level].iter, 14, mapFn, PM.MIN_GAP_MM);
    const path = d3.geoPath(proj).digits(2);
    const pieces = [];
    let droppedFar = 0, droppedSmall = 0;
    let gx0 = 1e9, gy0 = 1e9, gx1 = -1e9, gy1 = -1e9, worstK = 0;
    for (const pref of D.prefs) {
      const g = PM.buildPrefGeometry(d3, Core, pref, sm.arcs, opts);
      droppedFar += g.droppedFar; droppedSmall += g.droppedSmall;
      const [[bx0, by0], [bx1, by1]] = path.bounds(g.multi);
      const [[w, s0], [e0, n]] = d3.geoBounds(g.multi);
      const lonC = (w + (e0 < w ? e0 + 360 : e0)) / 2, latC = (s0 + n) / 2;
      const k = PM.kFactor(d3, proj, latC, lonC);
      const f = 1 / k; // 県の中心で縮尺が合うように、ピースを少し拡大・縮小する
      worstK = Math.max(worstK, Math.abs(PM.kFactor(d3, proj, n, lonC) / k - 1), Math.abs(PM.kFactor(d3, proj, s0, lonC) / k - 1));
      // 名前を入れる陸地（いちばん大きい陸地）
      const kept = PM.keptPolygons(pref, opts).kept;
      let li = 0; kept.forEach((ix, i) => { if (pref.p[ix].a > pref.p[kept[li]].a) li = i; });
      const ring = g.multi.coordinates[li][0].map((c) => proj(c));
      const cands = labelCandidates(ring).map((c) => ({ ...c, ring }));
      const name = pref.n;
      const sizes = [4.8, 4.4, 4.0, 3.6, 3.2, 2.9, 2.6].map((z) => z / f);
      const lab = bestLabel(cands, name.length, sizes);
      const inside = !!lab;
      const c = lab ? [lab.x, lab.y] : [0, 0];
      const fitSize = lab ? lab.size * f : 0;
      const w2 = (bx1 - bx0) * f, h2 = (by1 - by0) * f;
      const noteIsl = g.droppedFar > 0;
      pieces.push({ no: pieces.length + 1, id: pref.id, name, d: path(g.multi), bx0, by0, bx1, by1, f, w: w2, h: h2, packH: h2 + (inside ? 0 : 5) + (noteIsl ? 4 : 0), noteIsl, c, inside, fitSize, region: ds.region(pref), polys: g.multi.coordinates.length, ring, cands });
      gx0 = Math.min(gx0, bx0); gy0 = Math.min(gy0, by0); gx1 = Math.max(gx1, bx1); gy1 = Math.max(gy1, by1);
    }
    const area = { x0: 6, y0: 17, x1: W - 6, y1: H - 29 };
    const packed = PM.packPieces(pieces.map((q) => ({ id: q.id, w: q.w, h: q.packH })), area, 7);
    const byId = new Map(pieces.map((q) => [q.id, q]));
    return { mode: ds.key, ds, denom, orient, paper: paper || 'A4', level, W, H, paperW, paperH, pieces, byId, pages: packed.pages, unfit: packed.unfit, droppedFar, droppedSmall, gx0, gy0, gx1, gy1, repairRounds: sm.rounds, repairLeft: sm.remaining, worstK, proj, path };
  }

  function japanPieceSVG(model, q, x, y) {
    const ds = model.ds;
    const f = q.f;
    let s = `<g class="piece" data-id="${q.id}" transform="translate(${r2(x)},${r2(y)}) scale(${r2(f * 1e4) / 1e4}) translate(${r2(-q.bx0)},${r2(-q.by0)})">`;
    s += `<path d="${q.d}" fill="${ds.regionColors[q.region]}" stroke="#111" stroke-width="${r2(0.45 / f)}" stroke-linejoin="round"/></g>`;
    const lx = x + (q.c[0] - q.bx0) * f, ly = y + (q.c[1] - q.by0) * f;
    if (q.inside) s += text(lx, ly + q.fitSize * 0.35, q.fitSize, q.name, `text-anchor="middle" font-weight="700" fill="#222" stroke="#fff" stroke-width="0.5" paint-order="stroke"`);
    else s += text(x + q.w / 2, y + q.h + 4, 3.2, q.name, `text-anchor="middle" font-weight="700" fill="#222"`);
    if (q.noteIsl) s += text(x + q.w / 2, y + q.h + (q.inside ? 3.6 : 7.6), 2.4, '（離島は省略）', `text-anchor="middle" fill="#555"`);
    return s;
  }

  function japanPanel(model, idx, total) {
    const { W, H, denom } = model;
    let s = text(8, 8, 4.2, `${model.ds.title}　縮尺 ${scaleName(denom)}　ピース ${idx}/${total}`, 'font-weight="700" fill="#111"');
    s += text(8, 13.2, 3, `実線にそってハサミで切ります。${model.ds.edge}はなめらかにしてあります。`, 'fill="#333"');
    const y = H - 17;
    s += scaleBar(8, y);
    s += text(112, y + 0.8, 3, '←この線が10cmなら正しく印刷できています', 'fill="#111"');
    s += text(8, H - 8.5, 2.6, model.ds.pageNote, 'fill="#333"');
    s += text(8, H - 4.5, 2.6, model.ds.credit, 'fill="#333"');
    return s;
  }

  function japanPageSVG(model, pi) {
    const { W, H } = model;
    const items = model.pages[pi];
    let s = `<svg class="pg" xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" data-page="${pi + 1}" role="img" aria-label="ピースのページ${pi + 1}">`;
    for (const it of items) s += japanPieceSVG(model, model.byId.get(it.id), it.x, it.y);
    s += japanPanel(model, pi + 1, model.pages.length);
    s += `</svg>`;
    return s;
  }

  // 見本：全国を1枚に縮小して、どこに何県が入るかを示す
  function japanSampleSVG(model) {
    const { W, H, denom, pieces } = model;
    const areaX = 8, areaY = 24, areaW = W - 16, areaH = H - 24 - 52;
    const gw = model.gx1 - model.gx0, gh = model.gy1 - model.gy0;
    const sc = Math.min(areaW / gw, areaH / gh);
    const tx = areaX + (areaW - gw * sc) / 2 - model.gx0 * sc, ty = areaY + (areaH - gh * sc) / 2 - model.gy0 * sc;
    let s = `<svg class="pg sample" xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" data-sample="1" role="img" aria-label="パズルの見本">`;
    s += text(8, 11, 6.5, `${model.ds.title}　見本（${scaleName(denom)}のピースをこう並べます）`, 'font-weight="700" fill="#111"');
    s += text(8, 18, 3.2, `この図は約1/${Math.round(denom / sc / 10000)}万に縮小した見本です。ピースは実物の大きさ（${scaleName(denom)}）で別のページに印刷されます。`, 'fill="#333"');
    s += `<g transform="translate(${r2(tx)},${r2(ty)}) scale(${sc})">`;
    for (const q of pieces) s += `<path d="${q.d}" fill="${model.ds.regionColors[q.region]}" stroke="#222" stroke-width="${r2(0.25 / sc)}" stroke-linejoin="round"/>`;
    s += `</g>`;
    const legend = [];
    for (const q of pieces) {
      const nm = model.ds.trim(q.name);
      const sg = 2.4 / sc; // 見本の上で2.4mmの文字を、地図の座標に直した大きさ
      const lab = bestLabel(q.cands, nm.length, [sg]);
      if (lab) s += text(tx + lab.x * sc, ty + lab.y * sc + 0.8, 2.4, nm, 'text-anchor="middle" font-weight="700" fill="#222" stroke="#fff" stroke-width="0.4" paint-order="stroke"');
      else {
        const c0 = q.cands[0] || { x: (q.bx0 + q.bx1) / 2, y: (q.by0 + q.by1) / 2 };
        s += text(tx + c0.x * sc, ty + c0.y * sc + 0.8, 2.3, String(q.no), 'text-anchor="middle" font-weight="700" fill="#b00020" stroke="#fff" stroke-width="0.4" paint-order="stroke"');
        legend.push(`${q.no} ${q.name}`);
      }
    }
    // 見本の上での長さの目安（km）
    {
      const eff = denom / sc; // 見本の縮尺の分母
      for (const km of [10, 20, 50, 100, 200, 500]) { const len = (km * 1e6) / eff; if (len >= 15 && len <= 80) { const bx = W - 8 - len, by = 24; s += `<line x1="${r2(bx)}" y1="${by}" x2="${r2(bx + len)}" y2="${by}" stroke="#000" stroke-width="0.4"/><line x1="${r2(bx)}" y1="${by - 1.5}" x2="${r2(bx)}" y2="${by + 1.5}" stroke="#000" stroke-width="0.4"/><line x1="${r2(bx + len)}" y1="${by - 1.5}" x2="${r2(bx + len)}" y2="${by + 1.5}" stroke="#000" stroke-width="0.4"/>`; s += text(bx + len / 2, by - 2, 2.8, `${km}km（見本の上での長さ）`, 'text-anchor="middle" fill="#111"'); break; } }
    }
    // 凡例（番号の県）
    let ly = H - 44;
    if (legend.length) {
      s += text(8, ly, 3, `赤い数字の${model.ds.unit}：`, 'font-weight="700" fill="#b00020"');
      const perLine = Math.ceil(legend.length / 3);
      for (let i = 0; i < legend.length; i += perLine) s += text(8, (ly += 4.2), 2.8, legend.slice(i, i + perLine).join('　'), 'fill="#222"');
    }
    // 地方の色
    let lx = 8; const ky = H - 20;
    model.ds.regionNames.forEach((nm, i) => { s += `<rect x="${lx}" y="${ky - 3}" width="4" height="4" fill="${model.ds.regionColors[i]}" stroke="#555" stroke-width="0.2"/>`; s += text(lx + 5.5, ky, 2.8, nm, 'fill="#222"'); lx += 5.5 + nm.length * 2.8 + 5; });
    s += text(8, H - 9, 2.6, `${model.ds.sampleSub}：横${cm(model.gx1 - model.gx0)} × 縦${cm(model.gy1 - model.gy0)}`, 'fill="#333"');
    s += text(8, H - 4.5, 2.6, model.ds.credit, 'fill="#333"');
    s += `</svg>`;
    return s;
  }

  function renderJapan() {
    const t0 = performance.now();
    const ds = dsOf(state.mode);
    const model = buildJapanModel(ds, state.denom, state.orient, state.paper, state.smooth);
    window.__model = model;
    $('pagestyle').textContent = `@page { size: ${state.paper} ${state.orient}; margin: 0; }
.sheet { width: ${model.paperW}mm; height: ${model.paperH - 0.5}mm; }`;
    $('paperTxt').textContent = state.paper;
    $('dlgPaper').textContent = state.paper;
    const biggest = [...model.pieces].sort((a, b) => b.w * b.h - a.w * a.h)[0];
    let sum = `<p class="big"><b>${ds.title}</b>を ${scaleName(state.denom)}（${state.paper}）で作ります。</p>`;
    sum += `<p class="size">全体をすき間なく並べた大きさ：<b>横 ${cm(model.gx1 - model.gx0)} × 縦 ${cm(model.gy1 - model.gy0)}</b></p>`;
    const placed = model.pieces.length - model.unfit.length;
    sum += `<p class="count">${ds.count}${ds.unit}のうち<b>${placed}個</b>のピースを、<b>${model.pages.length}枚</b>に並べました。見本ページ1枚が先頭に入るので、印刷は合計${model.pages.length + 1}ページです。</p>`;
    sum += `<p class="note">いちばん大きいピース：${esc(biggest.name)}（横${cm(biggest.w)} × 縦${cm(biggest.h)}）。</p>`;
    const small = model.pieces.filter((q) => Math.min(q.w, q.h) < 8).map((q) => q.name);
    if (small.length) sum += `<p class="note">小さいピース（短い辺が8mm未満）：${small.map(esc).join('、')}。ハサミで切りにくいので、縮尺を大きくすると切りやすくなります。</p>`;
    if (model.unfit.length) {
      sum += `<p class="warn">⚠ 用紙に入らないピースがあります：${model.unfit.map((id) => esc(unitName(ds, id))).join('、')}。縮尺を小さくするか、${state.paper === 'A4' ? '用紙をA3にするか、' : ''}向きを変えてください。これらは印刷されません。</p>`;
    }
    sum += `<p class="note">${ds.edge}のなめらかさ：${PM.SMOOTH[state.smooth].label}（紙の上で約${PM.SMOOTH[state.smooth].tolMm}mm以下の細かい出入りをならし、角を丸め、幅${PM.MIN_GAP_MM}mm未満の細い切れ込みやくびれは、ならして広げています。隣り合う${ds.unit}の境は、どちらのピースも同じ線です）。</p>`;
    sum += `<p class="note">ハサミで切れない小さな島や飛び地（紙の上で${PM.MIN_PAPER_MM2}mm²未満）${model.droppedSmall}か所` + (ds.far ? `と、本土から50km以上離れた島${model.droppedFar}か所` : '') + `は、ピースに入れていません。</p>`;
    if (ds.key === 'aichi') sum += `<p class="warn">⚠ 名古屋市と、大府市・あま市・豊山町の境は、元のデータの線が食い違っているため、並べると最大で約1mm（1/30万のとき）の重なりやすき間が出ます。ほかの境は、完全に同じ線です。</p>`;
    sum += `<p class="note">縮尺：ピースごとにその中心で縮尺を合わせてあります（図法の上でのピース内のずれは最大で${model.worstK < 0.0001 ? '0.01%未満' : 'およそ' + (model.worstK * 100).toFixed(2) + '%'}）。地球を球として計算しているため、実際の地面との差は、およそ0.2〜0.4%あります。</p>`;
    $('summary').innerHTML = sum;
    $('overview').innerHTML = japanSampleSVG(model).replace('class="pg sample"', 'class="ov"').replace(/width="[\d.]+mm" height="[\d.]+mm"/, '');
    const parts = [];
    $('pages').classList.remove('gridmode');
    $('pages').style.setProperty('--z', Math.max(0.2, Math.min(0.5, 1130 / (3 * (model.paperW * 3.7795 + 14)))));
    parts.push(`<div class="sheet-wrap"><div class="cap">見本ページ（完成図）</div><div class="sheet">${japanSampleSVG(model)}</div></div>`);
    model.pages.forEach((_, pi) => parts.push(`<div class="sheet-wrap"><div class="cap">ピースのページ${pi + 1}</div><div class="sheet">${japanPageSVG(model, pi)}</div></div>`));
    $('pages').innerHTML = parts.join('');
    $('printBtn').disabled = false;
    $('status').textContent = '';
    $('dlgWarn').innerHTML = model.unfit.length ? `<b>⚠ 用紙に入らないピースがあり、印刷されません：</b>${model.unfit.map((id) => esc(unitName(ds, id))).join('、')}` : '';
    model.renderMs = Math.round(performance.now() - t0);
    document.body.dataset.ready = '1';
  }

  /* ---------- 画面の更新 ---------- */
  let model = null;

  function render() {
    applyMode();
    if (state.mode === 'japan' || state.mode === 'aichi') { renderJapan(); return; }
    const t0 = performance.now();
    model = buildModel(state.prefId, state.denom, state.orient, state.islands, state.skipBlank, state.paper);
    const { lay, pref, P, geo } = model;
    const total = lay.rows * lay.cols;
    const sz = Core.sheetSize(state.paper, state.orient);
    $('pagestyle').textContent = `@page { size: ${state.paper} ${state.orient}; margin: 0; }
.sheet { width: ${sz.paperW}mm; height: ${sz.paperH - 0.5}mm; }`;
    $('paperTxt').textContent = state.paper;
    $('dlgPaper').textContent = state.paper;

    // 概要
    const kmW = (P.MW * state.denom) / 1e6;
    const kmH = (P.MH * state.denom) / 1e6;
    let sum = `<p class="big"><b>${esc(pref.n)}</b>を ${scaleName(state.denom)}（${state.paper}）で印刷します。</p>`;
    sum += `<p class="size">完成する地図の大きさ：<b>横 ${cm(P.MW)} × 縦 ${cm(P.MH)}</b>（実際の${fmt(kmW)}km × ${fmt(kmH)}km）</p>`;
    sum += `<p class="size">紙を貼り合わせた全体（余白を切り落とした後）：およそ 横 ${cm(lay.totalW)} × 縦 ${cm(lay.totalH)}</p>`;
    if (model.tooMany) {
      sum += `<p class="warn">⚠ ${lay.rows}行 × ${lay.cols}列 ＝ ${total}枚になり、多すぎて画面に出せません（上限${MAX_PAGES}枚）。縮尺を小さくするか、用紙をA3にしてください。</p>`;
      $('summary').innerHTML = sum;
      $('overview').innerHTML = '';
      $('pages').innerHTML = '';
      $('printBtn').disabled = true;
      document.body.dataset.ready = '1';
      window.__model = model;
      return;
    }
    $('printBtn').disabled = false;
    $('dlgWarn').innerHTML = '';
    sum += `<p class="count">${lay.rows}行 × ${lay.cols}列 ＝ <b>${total}枚</b>に分けます`;
    if (model.blankCount) {
      sum += state.skipBlank
        ? `（地図がない、または隣のページと重なるだけで印刷しなくてよい空白ページ${model.blankCount}枚は印刷しません。番号は欠番になります）→ 印刷するのは <b>${model.printCount}枚</b>`
        : `（うち空白ページ（地図がない、またはのりしろの中だけ）が${model.blankCount}枚あります。すべて印刷します）`;
    }
    sum += `。</p>`;
    if (state.sample) sum += `<p class="note">番号の付かない「貼り合わせ見本ページ」1枚が先頭に入るので、印刷は合計${model.printCount + 1}ページになります。</p>`;
    const bigSize = Math.max(P.MW, P.MH) > 1500;
    if (model.printCount > 30 || bigSize) {
      const smaller = [250000, 500000, 1000000, 2000000].filter((d) => d > state.denom).slice(0, 3);
      const alts = smaller.map((d) => `${scaleName(d)}なら${buildModel(state.prefId, d, state.orient, state.islands, state.skipBlank, state.paper).printCount}枚`);
      const head = model.printCount > 30 ? `${model.printCount}枚と多くなります。` : `印刷は${model.printCount}枚ですが、地図が大きくなります。`;
      sum += `<p class="warn">⚠ ${head}` + (alts.length ? alts.join('、') + 'です。' : 'これ以上小さい縮尺の候補はありません。') + (state.paper === 'A4' ? 'A3にすると枚数が減ります。' : '') + (state.islands && geo.excluded ? '「本土のみ」にすると小さくなります。' : '') + `</p>`;
    }
    if (!state.islands) {
      sum += geo.excluded
        ? `<p class="note">離島など${geo.excluded}か所（合計およそ${fmt(geo.excludedKm2)}km²）は、最大の陸地から50km以上離れているため除いています。含めるときは「離島を含む」を選んでください。</p>`
        : `<p class="note">${esc(pref.n)}には、除く離島はありません。</p>`;
    } else {
      sum += `<p class="note">離島も含めて表示しています。</p>`;
    }
    if (geo.fixedCount) sum += `<p class="note">頂点の並び順が逆の陸地が${geo.fixedCount}か所あったため、自動で直しました。</p>`;
    sum += `<p class="note">地図の細い青灰色の線は、緯度・経度の目盛り（${gratStep(state.denom)}度ごと）です。ページを合わせる目安になります。</p>`;
    $('summary').innerHTML = sum;

    $('overview').innerHTML = overviewSVG(model);

    // ページ
    const marks = Core.marksForPages(lay, model.printed);
    const parts = [];
    const cols = lay.cols;
    const perCol = sz.paperW * 3.7795 + 14;
    $('pages').style.setProperty('--z', Math.max(0.12, Math.min(0.5, 1130 / (Math.min(cols, 6) * perCol))));
    $('pages').style.setProperty('--cols', Math.min(cols, 6));
    $('pages').classList.toggle('gridmode', cols <= 6);
    if (state.sample) parts.push(`<div class="sheet-wrap"><div class="cap">見本ページ（貼り合わせの完成図）</div><div class="sheet">${sampleSVG(model)}</div></div>`);
    for (const p of lay.pages) {
      if (!model.printed[p.n - 1]) { if (cols <= 6) parts.push(`<section class="ph"><span>${p.n}<br>印刷しない<br>（欠番）</span></section>`); continue; }
      parts.push(`<div class="sheet-wrap"><div class="cap">ページ${p.n}（行${p.r + 1}-列${p.c + 1}）${p.blank ? '＝空白' : (p.skip ? '＝重なるだけ' : '')}</div><div class="sheet">${pageSVG(model, p, marks.get(p.n))}</div></div>`);
    }
    $('pages').innerHTML = parts.join('');
    model.renderMs = Math.round(performance.now() - t0);
    $('status').textContent = '';
    document.body.dataset.ready = '1';
    window.__model = model;
  }

  // 作るものに合わせて、画面の部品を出し入れする
  function applyMode() {
    const jp = state.mode === 'japan' || state.mode === 'aichi';
    for (const id of ['prefField', 'islandField', 'blankField']) $(id).hidden = jp;
    $('smoothField').hidden = !jp;
    $('smoothLbl').textContent = state.mode === 'aichi' ? '市町村の境のなめらかさ' : '県境のなめらかさ';
    $('guidePref').hidden = jp;
    $('guideJapan').hidden = !jp;
    $('subtitle').textContent = jp ? (state.mode === 'aichi' ? '愛知県の市町村をハサミで切り抜いて、並べて遊ぶパズルを作ります。' : '日本地図を、県ごとにハサミで切り抜いて、並べて遊ぶパズルを作ります。') : '県を選んで印刷し、A4を貼り合わせると、同じ縮尺の地図になります。';
    $('ovTitle').textContent = jp ? '全体図（見本：ピースの並び）' : '全体図（青い枠が1枚の紙、数字がページ番号）';
    $('pagesTitle').textContent = jp ? '3. 各ページのプレビュー（縮小表示。クリックで拡大。印刷は実寸）' : '3. 各ページのプレビュー（縮小表示。クリックで拡大。印刷は実寸）';
  }

  let pending = 0;
  function schedule() {
    document.body.dataset.ready = '0';
    $('status').textContent = '計算中…';
    clearTimeout(pending);
    pending = setTimeout(render, 20);
  }

  /* ---------- 操作 ---------- */
  function init() {
    const sel = $('pref');
    sel.innerHTML = PREF_DATA.map((p) => `<option value="${p.id}">${esc(p.n)}</option>`).join('');
    sel.value = String(state.prefId);
    sel.addEventListener('change', () => { state.prefId = Number(sel.value); schedule(); });
    document.querySelectorAll('input[name="mode"]').forEach((el) => el.addEventListener('change', () => {
      if (!el.checked) return;
      state.mode = el.value;
      // 作るものに合う縮尺に切り替える（前に選んだ縮尺は、それぞれ覚えておく）
      state.lastDenom = state.lastDenom || { pref: 500000, japan: 3000000, aichi: 300000 };
      state.lastDenom[state.prevMode || 'pref'] = state.denom;
      state.prevMode = state.mode;
      state.denom = state.lastDenom[state.mode];
      setDenomControl(state.denom);
      schedule();
    }));
    document.querySelectorAll('input[name="smooth"]').forEach((el) => el.addEventListener('change', () => { if (el.checked) { state.smooth = el.value; schedule(); } }));
    const dsel = $('denomSel'), dcus = $('denomCustom');
    function setDenomControl(d) {
      const has = [...dsel.options].some((o) => o.value === String(d));
      dsel.value = has ? String(d) : 'custom';
      $('customBox').hidden = has;
      if (!has) dcus.value = String(d);
    }
    function applyDenom() {
      if (dsel.value === 'custom') {
        $('customBox').hidden = false;
        const v = Math.round(Number(dcus.value));
        if (!(v >= 5000 && v <= 10000000)) { $('customMsg').textContent = '5,000〜10,000,000 の数を入れてください'; return; }
        $('customMsg').textContent = '';
        state.denom = v;
      } else {
        $('customBox').hidden = true;
        state.denom = Number(dsel.value);
      }
      schedule();
    }
    dsel.addEventListener('change', applyDenom);
    dcus.addEventListener('input', applyDenom);
    for (const [name, key, conv] of [['paper', 'paper', String], ['orient', 'orient', String], ['islands', 'islands', (v) => v === 'yes']]) {
      document.querySelectorAll(`input[name="${name}"]`).forEach((el) => el.addEventListener('change', () => { if (el.checked) { state[key] = conv(el.value); schedule(); } }));
    }
    $('sample').addEventListener('change', (e) => { state.sample = e.target.checked; schedule(); });
    $('skipBlank').addEventListener('change', (e) => { state.skipBlank = e.target.checked; schedule(); });

    $('pages').addEventListener('click', (e) => {
      const wrap = e.target.closest('.sheet-wrap');
      if (!wrap) return;
      const svg = wrap.querySelector('svg');
      zoom.W = Number(svg.getAttribute('viewBox').split(' ')[2]); zoom.H = Number(svg.getAttribute('viewBox').split(' ')[3]); zoom.f = 1;
      $('zoomBody').innerHTML = svg.outerHTML.replace(/id="(hatch|clip)-p(\d+)"/g, 'id="z$1-p$2"').replace(/url\(#(hatch|clip)-p(\d+)\)/g, 'url(#z$1-p$2)');
      applyZoom();
      $('zoomDialog').showModal();
      $('zoomDialog').scrollTop = 0;
    });
    const zoom = { f: 1, W: 200, H: 287 };
    function applyZoom() {
      const svg = $('zoomBody').querySelector('svg');
      if (!svg) return;
      svg.style.width = zoom.W * 3.7795 * zoom.f + 'px';
      svg.style.height = 'auto';
      svg.style.maxWidth = 'none';
      $('zoomPct').textContent = Math.round(zoom.f * 100) + '%';
    }
    $('zoomIn').addEventListener('click', () => { zoom.f = Math.min(3, zoom.f * 1.25); applyZoom(); });
    $('zoomOut').addEventListener('click', () => { zoom.f = Math.max(0.3, zoom.f / 1.25); applyZoom(); });
    $('zoomReal').addEventListener('click', () => { zoom.f = 1; applyZoom(); });
    $('zoomFit').addEventListener('click', () => { zoom.f = Math.min((window.innerHeight * 0.8) / (zoom.H * 3.7795), (window.innerWidth * 0.9) / (zoom.W * 3.7795)); applyZoom(); });
    $('zoomClose').addEventListener('click', () => $('zoomDialog').close());
    const dlg = $('printDialog');
    $('printBtn').addEventListener('click', () => dlg.showModal());
    $('dlgCancel').addEventListener('click', () => dlg.close());
    $('dlgGo').addEventListener('click', () => { dlg.close(); setTimeout(() => window.print(), 50); });
    render();
  }
  window.__state = state;
  window.__render = render;
  window.__buildModel = buildModel;
  document.addEventListener('DOMContentLoaded', init);
})();
