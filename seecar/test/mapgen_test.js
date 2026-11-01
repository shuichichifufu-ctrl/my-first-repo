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
    let colored = 0; for (let i = 0; i < n; i++) { const r = m.colors[i * 3], g = m.colors[i * 3 + 1], b = m.colors[i * 3 + 2]; if (Math.max(r, g, b) - Math.min(r, g, b) > 8) colored++; }
    // 壁を壊せば行けるか：壁は壊すと高さ0（壊す手数＝費用1）。登りは1段まで、降りは自由。0-1幅優先で最少の壊す数を求める
    const reach = (from) => {
      const INF = 1e9, dist = new Int32Array(n).fill(INF); dist[from] = 0;
      let level = [from], d = 0;
      while (level.length) {
        const next = []; // 費用 d+1 の候補
        for (let k = 0; k < level.length; k++) { const i = level[k]; if (dist[i] !== d) continue; const x = i % w, z = (i - x) / w, hi = H[i] >= 10 ? 0 : H[i];
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, nz = z + dz; if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue; const j = nz * w + nx, wall = H[j] >= 10;
            if (!wall && H[j] - hi > 1) continue; const nd = d + (wall ? 1 : 0); if (nd < dist[j]) { dist[j] = nd; if (nd === d) level.push(j); else next.push(j); } } }
        level = next; d++;
      }
      return dist[m.treasure.z * w + m.treasure.x];
    };
    const dd = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    return { ms, w, h, t: m.treasure, reg: { cells: reg.cells, touchesEdge: reg.touchesEdge }, th: H[m.treasure.z * w + m.treasure.x], starts: st, hist, colored,
      cost: m.starts.map(s => reach(s.z * w + s.x)), sep: dd(m.starts[0], m.starts[1]), pic: m.picture.slice(0, 22), picLen: m.picture.length,
      only0or10: H.every(v => v === 0 || v === 10), img: T.render(m, 6), src: binary ? null : MapGen.presetCanvas(id).toDataURL('image/png'),
      title: m.title, reading: m.reading, dirs: m.starts.map(s => s.dir) };
  }, [id, binary]);
  for (const p of presets) {
    const r = await common(p.id, false);
    save('p2_map_' + p.id + '.png', r.img); save('p2_map_' + p.id + '_src.png', r.src);
    ok(r.w === 128 && r.h === 128, p.id + ' 128x128', [r.w, r.h]);
    ok(r.title === p.title && r.reading === p.reading, p.id + ' title/reading', [r.title, r.reading]);
    ok(!r.reg.touchesEdge && r.reg.cells >= 16, p.id + ' 宝は囲まれた領域内', { t: r.t, ...r.reg });
    ok(r.th <= 1, p.id + ' 宝の高さ0〜1', r.th);
    ok(r.starts.every(s => s.h === 0 && !s.inTreasureRegion), p.id + ' スタート高さ0・宝の領域外', r.starts);
    ok(r.sep >= 12, p.id + ' スタート2つは離れている', +r.sep.toFixed(1));
    ok(r.cost.every(c => c < 40), p.id + ' 壁を壊せばスタートから宝へ行ける(壊す数)', r.cost);
    ok(r.pic.startsWith('data:image/jpeg'), p.id + ' picture jpeg', r.picLen);
    ok(r.colored === 0, p.id + ' 色(彩度のあるマス)が無い', r.colored);
    ok(r.hist[10] > 300, p.id + ' 壁(高さ10)が十分ある', r.hist[10]);
    console.log('     高さ分布', r.hist.join(','), ' ms=' + r.ms.toFixed(0));
    // 白黒モード
    const b = await common(p.id, true);
    save('p2_map_' + p.id + '_bw.png', b.img);
    ok(b.only0or10, p.id + ' 白黒モード 高さは0と10だけ', b.hist.join(','));
    ok(!b.reg.touchesEdge && b.reg.cells >= 16 && b.th === 0, p.id + ' 白黒モードでも宝は囲まれた領域内・高さ0', { t: b.t, ...b.reg });
    ok(b.starts.every(s => s.h === 0 && !s.inTreasureRegion) && b.sep >= 12 && b.cost.every(c => c < 40), p.id + ' 白黒モードのスタートと行き方', { cost: b.cost, sep: +b.sep.toFixed(1) });
  }
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
    let colored = 0; for (let i = 0; i < fb.w * fb.h; i++) { const r = fb.colors[i * 3], g = fb.colors[i * 3 + 1], b = fb.colors[i * 3 + 2]; if (!((r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255))) colored++; }
    const hs = {}; fb.heights.forEach(v => hs[v] = (hs[v] || 0) + 1); const hn = {}; fn.heights.forEach(v => hn[v] = (hn[v] || 0) + 1);
    // 細い線（元は薄い灰色の1画素線）が白黒でも途切れない：暗い所を探す仕組みの維持
    const tl = document.createElement('canvas'); tl.width = 2000; tl.height = 2000; const tg = tl.getContext('2d'); tg.fillStyle = '#fff'; tg.fillRect(0, 0, 2000, 2000); tg.fillStyle = '#000'; tg.fillRect(0, 1000, 2000, 6);
    const tm = MapGen.fromCanvas(tl, 't', 'r', { binary: true }); let broken = 0; for (let x = 0; x < tm.w; x++) { let any = false; for (let z = 0; z < tm.h; z++) if (tm.heights[z * tm.w + x] === 10) any = true; if (!any) broken++; }
    return { rowsN, rowsB, same, fbH: hs, fnH: hn, colored, broken };
  });
  ok(bw.rowsN.join() === '0,1,2,3,4,5,6,7,8,9,10', 'opts 無しは今まで通り(階調)', bw.rowsN);
  ok(bw.same, 'binary:false は opts 無しと同じ');
  ok(bw.rowsB.join() === '0,0,0,0,0,0,10,10,10,10,10', '白黒モード fromCanvas：0.5未満=10、それ以外=0', bw.rowsB);
  ok(Object.keys(bw.fbH).every(k => k === '0' || k === '10') && bw.fbH[10] > 0 && bw.fbH[0] > 0, '白黒モード fromFile：高さは0と10だけ', bw.fbH);
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
