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

  const state = { prefId: 23, denom: 500000, orient: 'portrait', islands: false, skipBlank: true, sample: true };

  /* ---------- モデル(計算結果)の作成 ---------- */
  function buildModel(prefId, denom, orient, islands, skipBlank) {
    const pref = PREF_DATA.find((p) => p.id === prefId);
    const geo = Core.buildGeometry(d3, pref, islands);
    const P = Core.buildProjection(d3, geo.multi, denom);
    const { W, H } = Core.SHEETS[orient];
    const lay = Core.layout(P.MW, P.MH, W, H, G);
    const ox = (lay.totalW - P.MW) / 2 - P.x0; // 地図を全ページを合わせた範囲の中央に置く
    const oy = (lay.totalH - P.MH) / 2 - P.y0;
    const path = d3.geoPath(P.proj).digits(2);
    // 各ページの範囲だけを切り出し、何も残らなければ空白ページ
    for (const p of lay.pages) {
      P.proj.translate([ox - p.x0, oy - p.y0]).clipExtent([[0, 0], [W, H]]);
      p.blank = !path(geo.multi);
    }
    P.proj.clipExtent(null).translate([0, 0]);
    const printed = lay.pages.map((p) => !(skipBlank && p.blank));
    const model = { pref, geo, P, lay, ox, oy, path, printed, denom, orient, skipBlank, islands };
    model.blankCount = lay.pages.filter((p) => p.blank).length;
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

  const HALO = 'stroke="#fff" stroke-width="0.9" stroke-linejoin="round" paint-order="stroke"';

  // 説明パネル。白い箱は敷かず、白ふち付きの文字だけにして、下の斜線や県境線を隠さない
  function panelSVG(model, p, rect) {
    const { lay, pref, denom } = model;
    const { x, y } = rect;
    const total = lay.rows * lay.cols;
    const nm = (r, c) => `行${r + 1}-列${c + 1}`;
    const bottomExists = p.r < lay.rows - 1;
    const bottomPrinted = bottomExists && model.printed[(p.r + 1) * lay.cols + p.c];
    let s = text(x + 1, y + 3.5, 3.3, `${pref.n}　縮尺 1/${fmt(denom)}　ページ ${p.n}/${total}　${nm(p.r, p.c)}（全${lay.rows}行×${lay.cols}列）`, `font-weight="700" fill="#111" ${HALO}`);
    s += scaleBar(x + 1, y + 7.7);
    s += text(x + 104, y + 8.2, 2.8, '←この線が10cmなら正しく印刷できています', `fill="#111" ${HALO}`);
    if (bottomExists) {
      s += text(x + 1, y + 11.4, 2.9, `のりしろ：この上に下の紙を重ねて貼る　下へ↓${nm(p.r + 1, p.c)}${bottomPrinted ? '' : '（印刷なし）'}`, `fill="#111" font-weight="700" ${HALO}`);
    }
    const cut = p.c > 0 || p.r > 0 ? '点線の外の白い余白（5mm）を切り落とす' : 'この紙は余白を切らない';
    s += text(x + 1, y + 14.5, 2.9, cut, `fill="#111" font-weight="700" ${HALO}`);
    s += text(x + 1 + cut.length * 2.9 + 3, y + 14.5, 2.2, '出典：地球地図日本（国土地理院）を簡略化して使用', `fill="#333" ${HALO}`);
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
      { x: G, y: H - ph }, { x: rightLimit - pw, y: H - ph },
      { x: G, y: 0 }, { x: rightLimit - pw, y: 0 },
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
      s += `<text transform="translate(${gx + 1.4},${H / 2}) rotate(90)" text-anchor="middle" font-size="2.9" font-family="${FONT}" fill="#111" ${halo}>のりしろ：この上に右の紙を重ねて貼る</text>`;
      s += text(gx + 4.6, H / 2 - 4.2, 2.9, '右へ→', `font-weight="700" fill="#111" ${halo}`);
      s += text(gx + 4.6, H / 2 - 0.6, 2.9, `行${p.r + 1}-列${p.c + 2}`, `font-weight="700" fill="#111" ${halo}`);
      if (!rightPrinted) s += text(gx + 4.6, H / 2 + 3.0, 2.6, '印刷なし', `fill="#111" ${halo}`);
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
    const areaX = 10, areaY = 30, areaW = W - 20, areaH = H - 30 - 66;
    const sc = Math.min(areaW / lay.totalW, areaH / lay.totalH);
    const tx = areaX + (areaW - lay.totalW * sc) / 2, ty = areaY + (areaH - lay.totalH * sc) / 2;
    P.proj.translate([model.ox, model.oy]).clipExtent(null);
    const d = path(geo.multi);
    P.proj.translate([0, 0]);
    const total = lay.rows * lay.cols;
    let s = `<svg class="pg sample" xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" data-sample="1" role="img" aria-label="貼り合わせ見本">`;
    s += text(10, 14, 7, `${pref.n}　貼り合わせ見本（1/${fmt(denom)}）`, 'font-weight="700" fill="#111"');
    s += text(10, 22, 3.6, `${lay.rows}行×${lay.cols}列＝${total}枚。この図は縮小した見本で、実寸ではありません。青い枠が1枚の紙、数字がページ番号です。`, 'fill="#333"');
    s += `<g transform="translate(${r2(tx)},${r2(ty)}) scale(${sc})">`;
    for (const p of lay.pages) {
      const printed = model.printed[p.n - 1];
      s += `<rect x="${p.x0}" y="${p.y0}" width="${W}" height="${H}" fill="${p.blank ? '#9aa5b1' : '#9cc3e8'}" fill-opacity="${p.blank ? 0.3 : 0.25}" stroke="${p.blank ? '#667' : '#1f6fb2'}" stroke-width="${r2(0.5 / sc)}" ${printed ? '' : `stroke-dasharray="${r2(2 / sc)} ${r2(1.5 / sc)}"`}/>`;
    }
    s += `<path d="${d}" fill="#f6f1e3" stroke="#222" stroke-width="${r2(0.3 / sc)}" stroke-linejoin="round"/>`;
    const fs = Math.min(lay.W, lay.H) * 0.3;
    for (const p of lay.pages) {
      s += `<text x="${p.x0 + 6}" y="${p.y0 + fs}" font-size="${fs}" font-family="${FONT}" font-weight="700" fill="${p.blank ? '#667' : '#1d4f86'}" fill-opacity="0.8">${p.n}</text>`;
    }
    s += `</g>`;
    let y = H - 56;
    s += text(10, y, 4.2, '貼り方', 'font-weight="700" fill="#111"');
    const steps = [
      '1. 全ページを印刷し、スケールバー（10cmの線）を定規で測って100mmか確かめる。',
      '2. 点線のある紙は、点線の外側の白い余白（5mm）を切り落とす。行1-列1の紙は切らない。',
      '3. 行1-列1から始め、右の紙・下の紙の順に、斜線ののりしろの上に重ねる。',
      '4. 赤い＋が上下の紙でぴったり重なるように合わせて、のりで貼る。',
      '5. 貼り終わった形が、上の見本と同じになれば完成です。',
    ];
    steps.forEach((t, i) => { s += text(10, y + 7 + i * 5.6, 3.5, t, 'fill="#111"'); });
    if (model.blankCount && model.skipBlank) s += text(10, y + 7 + 5 * 5.6, 3.2, `灰色の点線の枠（空白ページ${model.blankCount}枚）は地図がないので印刷していません。番号は欠番です。`, 'fill="#555"');
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
      s += `<rect x="${p.x0}" y="${p.y0}" width="${lay.W}" height="${lay.H}" fill="${p.blank ? '#9aa5b1' : '#cfe3f7'}" fill-opacity="${p.blank ? 0.35 : 0.22}" stroke="#2f6db0" stroke-width="1.2" vector-effect="non-scaling-stroke" ${printed ? '' : 'stroke-dasharray="4 3"'}/>`;
    }
    s += `<path d="${d}" fill="#f1ecdc" stroke="#222" stroke-width="1" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
    const fs = Math.min(lay.W, lay.H) * 0.33;
    for (const p of lay.pages) {
      s += `<text x="${p.x0 + 5}" y="${p.y0 + fs}" font-size="${fs}" font-family="${FONT}" font-weight="700" fill="${p.blank ? '#667' : '#1d4f86'}" fill-opacity="0.85">${p.n}</text>`;
    }
    s += `</svg>`;
    return s;
  }

  /* ---------- 画面の更新 ---------- */
  let model = null;

  function render() {
    const t0 = performance.now();
    model = buildModel(state.prefId, state.denom, state.orient, state.islands, state.skipBlank);
    const { lay, pref, P, geo } = model;
    const total = lay.rows * lay.cols;

    // 用紙の向き
    $('pagestyle').textContent = `@page { size: A4 ${state.orient}; margin: 0; }
.sheet { width: ${state.orient === 'portrait' ? 210 : 297}mm; height: ${state.orient === 'portrait' ? 296.5 : 209.5}mm; }`;

    // 概要
    const kmW = (P.MW * state.denom) / 1e6;
    const kmH = (P.MH * state.denom) / 1e6;
    let sum = `<p class="big"><b>${esc(pref.n)}</b>を 1/${fmt(state.denom)} で印刷します。</p>`;
    sum += `<p>紙に印刷される地図の大きさは、横${fmt(P.MW)}mm × 縦${fmt(P.MH)}mm（実際の${fmt(kmW)}km × ${fmt(kmH)}km）です。</p>`;
    sum += `<p class="count">${lay.rows}行 × ${lay.cols}列 ＝ <b>${total}枚</b>に分けます`;
    if (model.blankCount) {
      sum += state.skipBlank
        ? `（地図がない空白ページ${model.blankCount}枚は印刷しません。番号は欠番になります）→ 印刷するのは <b>${model.printCount}枚</b>`
        : `（うち地図がない空白ページが${model.blankCount}枚あります。すべて印刷します）`;
    }
    sum += `。</p>`;
    if (model.printCount > 30) {
      const smaller = [500000, 1000000].filter((d) => d > state.denom);
      const alts = smaller.map((d) => `1/${d === 500000 ? '50万' : '100万'}なら${buildModel(state.prefId, d, state.orient, state.islands, state.skipBlank).printCount}枚`);
      sum += `<p class="warn">⚠ ${model.printCount}枚と多くなります。` + (alts.length ? alts.join('、') + 'です。' : 'これ以上小さい縮尺はありません。') + `</p>`;
    }
    if (!state.islands) {
      sum += geo.excluded
        ? `<p class="note">離島など${geo.excluded}か所（合計およそ${fmt(geo.excludedKm2)}km²）は、最大の陸地から50km以上離れているため除いています。含めるときは「離島を含む」を選んでください。</p>`
        : `<p class="note">${esc(pref.n)}には、除く離島はありません。</p>`;
    } else {
      sum += `<p class="note">離島も含めて表示しています。</p>`;
    }
    if (geo.fixedCount) sum += `<p class="note">頂点の並び順が逆の陸地が${geo.fixedCount}か所あったため、自動で直しました。</p>`;
    $('summary').innerHTML = sum;

    $('overview').innerHTML = overviewSVG(model);

    // ページ
    const marks = Core.marksForPages(lay, model.printed);
    const parts = [];
    if (state.sample) parts.push(`<div class="sheet-wrap"><div class="cap">見本ページ（貼り合わせの完成図）</div><div class="sheet">${sampleSVG(model)}</div></div>`);
    for (const p of lay.pages) {
      if (!model.printed[p.n - 1]) continue;
      parts.push(`<div class="sheet-wrap"><div class="cap">ページ${p.n}（行${p.r + 1}-列${p.c + 1}）${p.blank ? '＝空白' : ''}</div><div class="sheet">${pageSVG(model, p, marks.get(p.n))}</div></div>`);
    }
    $('pages').innerHTML = parts.join('');
    model.renderMs = Math.round(performance.now() - t0);
    $('status').textContent = `計算 ${model.renderMs}ms`;
    document.body.dataset.ready = '1';
    window.__model = model;
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
    for (const [name, key, conv] of [['denom', 'denom', Number], ['orient', 'orient', String], ['islands', 'islands', (v) => v === 'yes']]) {
      document.querySelectorAll(`input[name="${name}"]`).forEach((el) => el.addEventListener('change', () => { if (el.checked) { state[key] = conv(el.value); schedule(); } }));
    }
    $('sample').addEventListener('change', (e) => { state.sample = e.target.checked; schedule(); });
    $('skipBlank').addEventListener('change', (e) => { state.skipBlank = e.target.checked; schedule(); });

    $('pages').addEventListener('click', (e) => {
      const wrap = e.target.closest('.sheet-wrap');
      if (!wrap) return;
      const svg = wrap.querySelector('svg');
      $('zoomBody').innerHTML = svg.outerHTML.replace(/id="(hatch|clip)-p(\d+)"/g, 'id="z$1-p$2"').replace(/url\(#(hatch|clip)-p(\d+)\)/g, 'url(#z$1-p$2)');
      $('zoomDialog').showModal();
    });
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
