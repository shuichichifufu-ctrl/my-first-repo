const { openPage, stopStatic } = require('/home/user/my-first-repo/seecar/test/harness.js');
const fs = require('fs');
const dir = '/home/user/my-first-repo/seecar/test/';
let fails = 0;
const ok = (c, msg, extra) => { if (!c) fails++; console.log((c ? 'OK   ' : 'NG   ') + msg + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); };
(async () => {
  const { browser, page, errors } = await openPage(dir + 'mapgen_test.html');
  const save = (name, url) => fs.writeFileSync(dir + 'shots/' + name, Buffer.from(url.split(',')[1], 'base64'));
  const presets = await page.evaluate(() => MapGen.presets);
  ok(presets.length >= 3, 'presets 3件以上', presets.map(p => p.kind + ':' + p.title + '/' + p.reading));
  const illusts = presets.filter(p => p.kind === 'illust'), yojis = presets.filter(p => p.kind === 'yoji');
  ok(illusts.length >= 4, 'イラスト見本が4つ以上', illusts.map(p => p.title));
  ok(yojis.length >= 3 && presets.every(p => p.kind === 'yoji' || p.kind === 'illust'), '四字熟語3つ以上・kindは yoji/illust だけ', yojis.map(p => p.title));
  ok(illusts.every(p => /^[ぁ-ゖ゠-ヿー]+$/.test(p.title) && /^[ぁ-ゖー]+$/.test(p.reading)), 'イラストの title は かな、reading は ひらがな');
  // 全見本の共通の確認（ふつうモードと白黒モードの両方）
  const common = (id, binary) => page.evaluate(([id, binary]) => {
    const opts = binary ? { binary: true } : undefined;
    const t0 = performance.now(); const m = MapGen.fromPreset(id, opts); const ms = performance.now() - t0;
    const w = m.w, h = m.h, n = w * h, H = m.heights;
    const hist = new Array(11).fill(0); H.forEach(v => hist[v]++);
    const reg = T.region(m), st = T.startsInfo(m);
    let colored = 0; for (let i = 0; i < n; i++) { if (m.buried[i]) continue; const r = m.colors[i * 3], g = m.colors[i * 3 + 1], b = m.colors[i * 3 + 2]; if (Math.max(r, g, b) - Math.min(r, g, b) > 8) colored++; }
    const reach = (from) => T.pathCost(m, from)[m.treasure.z * w + m.treasure.x];
    const dd = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    return { ms, w, h, t: m.treasure, reg: { cells: reg.cells, touchesEdge: reg.touchesEdge }, th: H[m.treasure.z * w + m.treasure.x], starts: st, hist, colored,
      cost: m.starts.map(s => reach(s.z * w + s.x)), sep: dd(m.starts[0], m.starts[1]), pic: m.picture.slice(0, 22), picLen: m.picture.length,
      only0or10: H.every(v => v === 0 || v === 3 || v === 10), nColors: (() => { const s = new Set(); for (let i = 0; i < n; i++) s.add(m.colors[i*3] + ',' + m.colors[i*3+1] + ',' + m.colors[i*3+2]); return s.size; })(), bwOnly: (() => { for (let i = 0; i < n; i++) { const v = m.colors[i*3]; if (m.buried[i]) continue; if ((v !== 0 && v !== 255) || m.colors[i*3+1] !== v || m.colors[i*3+2] !== v || m.buried[i] ? (H[i] !== 3 || v !== 217) : (H[i] === 10) !== (v === 0)) return false; } return true; })(), img: T.render(m, 6), src: binary ? null : MapGen.presetCanvas(id).toDataURL('image/png'),
      title: m.title, reading: m.reading, dirs: m.starts.map(s => s.dir) };
  }, [id, binary]);
  for (const p of presets) {
    const r = await common(p.id, false);
    save('p2_map_' + p.id + '.png', r.img); save('p2r2_map_' + p.id + '.png', r.img); save('p2_map_' + p.id + '_src.png', r.src);
    ok(r.w === 128 && r.h === 128, p.id + ' 128x128', [r.w, r.h]);
    ok(r.title === p.title && r.reading === p.reading, p.id + ' title/reading', [r.title, r.reading]);
    ok(!r.reg.touchesEdge && r.reg.cells >= 16, p.id + ' 宝は囲まれた領域内', { t: r.t, ...r.reg });
    ok(r.th === 3, p.id + ' 宝のマスは土の山の高さ3', r.th);
    ok(r.starts.every(s => s.h === 0 && !s.inTreasureRegion), p.id + ' スタート高さ0・宝の領域外', r.starts);
    ok(r.sep >= 12, p.id + ' スタート2つは離れている', +r.sep.toFixed(1));
    ok(r.cost.every(c => c < 200), p.id + ' 壁を壊せばスタートから宝へ行ける(道のり)', r.cost);
    ok(r.pic.startsWith('data:image/jpeg'), p.id + ' picture jpeg', r.picLen);
    ok(r.colored === 0, p.id + ' 色(彩度のあるマス)が無い', r.colored);
    ok(r.only0or10 && r.hist[0] + r.hist[3] + r.hist[10] === r.w * r.h, p.id + ' 見本は ふつうモードでも高さが0・3(土の山)・10だけ', r.hist.join(','));
    ok(r.bwOnly, p.id + ' 見本の色は白と黒だけ（土の山の茶色を除く）', r.nColors);
    ok(r.reg.cells >= 40, p.id + ' 宝の領域が細いすき間でない(40マス以上)', r.reg.cells);
    ok(r.hist[10] > 300, p.id + ' 壁(高さ10)が十分ある', r.hist[10]);
    console.log('     高さ分布', r.hist.join(','), ' ms=' + r.ms.toFixed(0));
    // 白黒モード
    const b = await common(p.id, true);
    save('p2_map_' + p.id + '_bw.png', b.img);
    ok(b.only0or10, p.id + ' 白黒モード 高さは0・3(土の山)・10だけ', b.hist.join(','));
    ok(!b.reg.touchesEdge && b.reg.cells >= 16 && b.th === 3, p.id + ' 白黒モードでも宝は囲まれた領域内', { t: b.t, ...b.reg });
    ok(b.starts.every(s => s.h === 0 && !s.inTreasureRegion) && b.sep >= 12 && b.cost.every(c => c < 200), p.id + ' 白黒モードのスタートと行き方', { cost: b.cost, sep: +b.sep.toFixed(1) });
  }

  // ---- 第3期：宝1個／10個、土の山、公平なスタート（全見本） ----
  const fair = [];
  for (const p of presets) for (const cnt of [1, 10]) {
    const r = await page.evaluate(([id, cnt]) => {
      const m = MapGen.fromPreset(id, { treasureCount: cnt }), w = m.w, h = m.h, H = m.heights;
      const ts = m.treasures, dd = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
      let minGap = 1e9; for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) minGap = Math.min(minGap, dd(ts[i], ts[j]));
      // 山：3x3がぜんぶ高さ3・buried=1。宝のマスの下は地面（見本は0か10か3だけ。山のマスは壁でなかったので、もとは地面0）
      let moundOK = true, buriedN = 0, full = 0; m.buried.forEach(v => { buriedN += v; });
      ts.forEach(t => { let f = true; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const i = (t.z + dz) * w + t.x + dx; if (H[i] === 10) { f = false; continue; } if (H[i] !== 3 || !m.buried[i]) moundOK = false; } if (f) full++; });
      const colorOK = (() => { for (let i = 0; i < w * h; i++) if (m.buried[i] && (m.colors[i*3] !== 217 || m.colors[i*3+1] !== 185 || m.colors[i*3+2] !== 140)) return false; return true; })();
      const costs = m.starts.map(s => T.pathCost(m, s.z * w + s.x));
      const toT = costs.map(c => ts.map(t => c[t.z * w + t.x]));
      const sep = dd(m.starts[0], m.starts[1]), cen = { x: (w - 1) / 2, z: (h - 1) / 2 };
      const refl = dd({ x: w - 1 - m.starts[0].x, z: h - 1 - m.starts[0].z }, m.starts[1]);
      const enc = MapGen.decode(JSON.parse(JSON.stringify(MapGen.encode(m))));
      const m2 = JSON.parse(JSON.stringify(m.treasures)) && enc;
      return { full, n: ts.length, compat: m.treasure === ts[0] || JSON.stringify(m.treasure) === JSON.stringify(ts[0]), minGap, moundOK, buriedN, colorOK, tH: ts.map(t => H[t.z * w + t.x]),
        inEncl: ts.map(t => { const q = [t.z * w + t.x], seen = new Uint8Array(w * h); seen[q[0]] = 1; let edge = false, c = 0; while (q.length) { const i = q.pop(), x = i % w, z = (i - x) / w; c++; if (x === 0 || z === 0 || x === w - 1 || z === h - 1) edge = true; [[1,0],[-1,0],[0,1],[0,-1]].forEach(d => { const nx = x + d[0], nz = z + d[1]; if (nx < 0 || nz < 0 || nx >= w || nz >= h) return; const j = nz * w + nx; if (!seen[j] && H[j] < 10) { seen[j] = 1; q.push(j); } }); } return { c, edge }; }),
        startsH: m.starts.map(s => H[s.z * w + s.x]), startsBuried: m.starts.map(s => m.buried[s.z * w + s.x]), sep, refl, toT,
        reachAll: toT.every(a => a.every(v => v < 1e9)), encSame: enc.treasures.length === ts.length && enc.buried.every((v, i) => v === m.buried[i]) && JSON.stringify(enc.treasures) === JSON.stringify(ts),
        img: T.render(m, 6) };
    }, [p.id, cnt]);
    save('p3_map_' + p.id + '_' + cnt + '.png', r.img);
    const tag = p.id + ' 宝' + cnt + ' ';
    ok(r.n === cnt && r.compat, tag + '宝の数・treasure は treasures[0]', r.n);
    ok(r.tH.every(v => v === 3) && r.moundOK && r.full >= (cnt === 1 ? 1 : 7) && r.colorOK, tag + '宝は高さ3の土の山(3x3、壁にかからない完全な山は ' + r.full + '/' + cnt + ')・山は茶色・buried印・宝のマスのもとは地面', { buriedN: r.buriedN });
    ok(r.minGap >= 4, tag + '宝同士は4マス以上離れている', +(r.minGap > 1e8 ? 99 : r.minGap).toFixed(1));
    ok(r.inEncl.every(e => !e.edge), tag + '宝は壁で囲まれた領域の中', r.inEncl.map(e => e.c));
    ok(r.startsH.every(v => v === 0) && r.startsBuried.every(v => v === 0) && r.sep >= 12, tag + 'スタートは高さ0・山の外・互いに離れる', { sep: +r.sep.toFixed(1) });
    ok(r.reachAll, tag + '2つのスタートから全部の宝へ(壊せば)行ける');
    if (cnt === 1) {
      const a = r.toT[0][0], b = r.toT[1][0], diff = Math.abs(a - b), mx = Math.max(a, b);
      fair.push(p.id + ':' + a + '/' + b + '(差' + diff + ')');
      ok(diff <= Math.max(0.1 * mx, 3), tag + '宝までの道のりの差が1割以内か3以内', { a, b, diff });
    } else {
      ok(r.refl <= 8, tag + 'スタートは地図の中心について対称に近い(ずれ8マス以内)', +r.refl.toFixed(1));
    }
  }
  console.log('     道のりの差 ' + fair.join('  '));
  // 領域が足りない地図（囲み1つ）でも10個置ける／既定は1個
  const few = await page.evaluate(() => { const nest = [[4, 4, 60, 44, 2], [12, 10, 40, 38, 2], [20, 16, 30, 26, 2]];
    const m10 = MapGen.fromCanvas(T.rects(nest), 't', 'r', { treasureCount: 10 }), m1 = MapGen.fromCanvas(T.rects(nest), 't', 'r');
    let gap = 1e9; m10.treasures.forEach((a, i) => m10.treasures.forEach((b, j) => { if (i < j) gap = Math.min(gap, Math.hypot(a.x - b.x, a.z - b.z)); }));
    return { n10: m10.treasures.length, n1: m1.treasures.length, gap, img: T.render(m10, 8) }; });
  save('p3_map_few_regions_10.png', few.img);
  ok(few.n10 === 10 && few.gap >= 4 && few.n1 === 1, '囲みが少ない地図でも宝10個を離して置ける・既定は1個', few);
  // 絵の種類ごとの確認：四字熟語は白黒だけ。イラストの閉じた部分は2つ以上。
  for (const p of illusts) {
    const k = await page.evaluate((id) => { const m = MapGen.fromPreset(id), w = m.w, h = m.h, seen = new Uint8Array(w * h); const sizes = [];
      for (let s = 0; s < w * h; s++) { if (seen[s] || m.heights[s] >= 10) continue; const q = [s]; seen[s] = 1; let c = 0, edge = false;
        while (q.length) { const i = q.pop(), x = i % w, z = (i - x) / w; c++; if (x === 0 || z === 0 || x === w - 1 || z === h - 1) edge = true;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, nz = z + dz; if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue; const j = nz * w + nx; if (!seen[j] && m.heights[j] < 10) { seen[j] = 1; q.push(j); } } }
        if (!edge && c >= 16) sizes.push(c); }
      sizes.sort((a, b) => a - b); const T0 = T.region(m); return { sizes, tcells: T0.cells }; }, p.id);
    ok(k.sizes.length >= 2, p.id + ' 閉じた部分が2つ以上', k.sizes);
    ok(k.tcells === k.sizes[0], p.id + ' 宝はいちばん小さい閉じた部分', { tcells: k.tcells, smallest: k.sizes[0] });
  }
  // 白黒モード：既存の呼び方（opts なし）は今まで通り／binary:false は無指定と同じ／fromCanvas と fromFile の両方
  const bw = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 11; const g = c.getContext('2d');
    for (let i = 0; i <= 10; i++) { const v = Math.round(255 * (1 - i / 10)); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, i, 64, 1); }
    const norm = MapGen.fromCanvas(c, 't', 'r'), off = MapGen.fromCanvas(c, 't', 'r', { binary: false }), on = MapGen.fromCanvas(c, 't', 'r', { binary: true });
    const col = (m, i) => i; const rowsN = [], rowsB = [];
    for (let i = 0; i <= 10; i++) { rowsN.push(norm.heights[(i * 2) * norm.w + 5]); rowsB.push(on.heights[(i * 2) * on.w + 5]); }
    const same = norm.heights.every((v, i) => v === off.heights[i]);
    // fromFile：赤っぽい色と細い線で確認（色は白黒になる）
    const cc = document.createElement('canvas'); cc.width = 400; cc.height = 400; const gg = cc.getContext('2d'); gg.fillStyle = '#fff'; gg.fillRect(0, 0, 400, 400);
    gg.fillStyle = '#c33'; gg.fillRect(40, 40, 320, 320); gg.fillStyle = '#ffe0a0'; gg.fillRect(120, 120, 160, 160);
    const blob = await new Promise(r => cc.toBlob(r, 'image/png')); const f = new File([blob], 'a.png', { type: 'image/png' });
    const fb = await MapGen.fromFile(f, { binary: true }), fn = await MapGen.fromFile(f);
    let colored = 0; for (let i = 0; i < fb.w * fb.h; i++) { const r = fb.colors[i * 3], g = fb.colors[i * 3 + 1], b = fb.colors[i * 3 + 2]; if (fb.buried[i]) continue; if (!((r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255))) colored++; }
    const hs = {}; fb.heights.forEach(v => hs[v] = (hs[v] || 0) + 1); const hn = {}; fn.heights.forEach(v => hn[v] = (hn[v] || 0) + 1);
    // 細い線（元は薄い灰色の1画素線）が白黒でも途切れない：暗い所を探す仕組みの維持
    const tl = document.createElement('canvas'); tl.width = 2000; tl.height = 2000; const tg = tl.getContext('2d'); tg.fillStyle = '#fff'; tg.fillRect(0, 0, 2000, 2000); tg.fillStyle = '#000'; tg.fillRect(0, 1000, 2000, 6);
    const tm = MapGen.fromCanvas(tl, 't', 'r', { binary: true }); let broken = 0; for (let x = 0; x < tm.w; x++) { let any = false; for (let z = 0; z < tm.h; z++) if (tm.heights[z * tm.w + x] === 10) any = true; if (!any) broken++; }
    return { rowsN, rowsB, same, fbH: hs, fnH: hn, colored, broken };
  });
  ok(bw.rowsN.join() === '0,1,2,3,4,5,6,7,8,9,10', 'opts 無しは今まで通り(階調)', bw.rowsN);
  ok(bw.same, 'binary:false は opts 無しと同じ');
  ok(bw.rowsB.join() === '0,0,0,0,0,0,10,10,10,10,10', '白黒モード fromCanvas：0.5未満=10、それ以外=0', bw.rowsB);
  ok(Object.keys(bw.fbH).every(k => k === '0' || k === '3' || k === '10') && bw.fbH[10] > 0 && bw.fbH[0] > 0, '白黒モード fromFile：高さは0・3(土の山)・10だけ', bw.fbH);
  ok(Object.keys(bw.fnH).length > 2, 'fromFile を opts 無しで呼ぶと階調のまま', bw.fnH);
  ok(bw.colored === 0, '白黒モードの色は黒か白だけ', bw.colored);
  ok(bw.broken === 0, '白黒モードでも細い線が途切れない', bw.broken);
  // 塗り絵風：大枠・中枠・小枠（内側6x6画素）。ごみの小さな囲み(1画素)も入れる
  const rectCase = async (name, specs, expect) => {
    const r = await page.evaluate((specs) => { const m = MapGen.fromCanvas(T.rects(specs), 't', 'r'); const reg = T.region(m); return { t: m.treasure, cells: reg.cells, edge: reg.touchesEdge, img: T.render(m, 8), starts: T.startsInfo(m) }; }, specs);
    save('mapgen_' + name + '.png', r.img);
    ok(r.t.x >= expect[0] && r.t.x < expect[2] && r.t.z >= expect[1] && r.t.z < expect[3] && !r.edge, name + ' 宝=' + JSON.stringify(r.t) + ' 領域' + r.cells + 'マス 期待範囲' + JSON.stringify(expect));
    ok(r.starts.every(s => s.h === 0 && !s.inTreasureRegion), name + ' スタート', r.starts.map(s => [s.x, s.z]));
  };
  const nest = [[4, 4, 60, 44, 2], [12, 10, 40, 38, 2], [20, 16, 30, 26, 2]];
  await rectCase('nested', nest, [44, 36, 56, 48]);
  await rectCase('nested_speck', nest.concat([[44, 30, 47, 33, 1]]), [44, 36, 56, 48]);   // 1画素の囲みは除外される
  await rectCase('interior2x2', [[4, 4, 60, 44, 2], [12, 10, 40, 38, 2], [20, 16, 26, 22, 2]], [44, 36, 48, 40]); // ちょうど4画素(2x2)は採用
  await rectCase('interior1x3', [[4, 4, 60, 44, 2], [12, 10, 40, 38, 2], [20, 16, 25, 23, 2]], [0, 0, 128, 128]); // 3画素は除外→中枠の内側(中枠と大枠の間より小さい方)
  // 高さの対応
  const hs = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 11; const g = c.getContext('2d');
    for (let i = 0; i <= 10; i++) { const v = Math.round(255 * (1 - i / 10)); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, i, 64, 1); }
    const m = MapGen.fromCanvas(c, 't', 'r'); const out = []; for (let i = 0; i <= 10; i++) out.push(m.heights[(i * 2) * m.w + 5]); return out; });
  ok(hs.join() === '0,1,2,3,4,5,6,7,8,9,10', '輝度→高さ 0..10', hs);
  const tr = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 8; c.height = 8; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 4, 8); /* 右半分は透明 */
    const m = MapGen.fromCanvas(c, 't', 'r'); return [m.heights[0], m.heights[m.w - 1]]; });
  ok(tr[0] === 10 && tr[1] === 0, '透明は白扱い', tr);
  // 大きな画像
  for (const [W, H] of [[2000, 1500], [4000, 3000]]) {
    const r = await page.evaluate(async ([W, H]) => { const f = await T.bigFile(W, H); const t0 = performance.now(); const m = await MapGen.fromFile(f); const ms = performance.now() - t0;
      const enc = MapGen.encode(m), dec = MapGen.decode(JSON.parse(JSON.stringify(enc)));
      const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
      return { ms, size: [m.w, m.h], fileKB: Math.round(f.size / 1024), t: m.treasure, starts: m.starts, reading: m.reading,
        same: same(m.heights, dec.heights) && same(m.colors, dec.colors) && JSON.stringify(m.treasure) === JSON.stringify(dec.treasure) && JSON.stringify(m.starts) === JSON.stringify(dec.starts) && m.title === dec.title && m.reading === dec.reading && m.picture === dec.picture && m.w === dec.w && m.h === dec.h,
        isU8: dec.heights instanceof Uint8Array && dec.colors instanceof Uint8Array, encBytes: JSON.stringify(enc).length, pic: m.picture.slice(0, 22), img: T.render(m, 5), startH: m.starts.map(s => m.heights[s.z * m.w + s.x]) };
    }, [W, H]);
    save('mapgen_photo' + W + '.png', r.img);
    ok(r.ms < 3000, `${W}x${H}(${r.fileKB}KB) 処理 ${r.ms.toFixed(0)}ms`, { size: r.size });
    ok(r.same && r.isU8, 'encode→JSON→decode 一致', r.encBytes + ' bytes');
    ok(r.pic.startsWith('data:image/jpeg') && r.startH.every(h => typeof h === 'number'), '写真 picture/start', { startH: r.startH, t: r.t });
  }
  // 画像でないファイル
  const bad = await page.evaluate(async () => { const out = []; for (const f of [new File(['hello'], 'a.txt', { type: 'text/plain' }), new File(['notimage'], 'b.png', { type: 'image/png' }), new File([], 'c.png', { type: 'image/png' }), null]) { try { await MapGen.fromFile(f); out.push('resolved'); } catch (e) { out.push(e.message); } } return out; });
  ok(bad.every(m => m === 'この え は つかえないよ'), '読めない画像はreject', bad);
  ok(await page.evaluate(() => Object.keys(window).filter(k => k === 'MapGen').length === 1 && typeof window.analyze === 'undefined'), 'グローバルはMapGenだけ');
  ok(errors.length === 0, 'コンソールエラー0', errors);
  await browser.close(); stopStatic();
  console.log(fails ? 'NG: ' + fails : 'ALL OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
