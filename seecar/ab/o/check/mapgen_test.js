const { openPage, stopStatic } = require('/home/user/my-first-repo/seecar/test/harness.js');
const fs = require('fs');
const dir = '/home/user/my-first-repo/seecar/ab/o/check/';
let fails = 0;
const ok = (c, msg, extra) => { if (!c) fails++; console.log((c ? 'OK   ' : 'NG   ') + msg + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); };
(async () => {
  const { browser, page, errors } = await openPage(dir + 'mapgen_test.html');
  const save = (name, url) => fs.writeFileSync(dir + 'shots/' + name, Buffer.from(url.split(',')[1], 'base64'));
  const presets = await page.evaluate(() => MapGen.presets);
  ok(presets.length >= 3, 'presets 3件以上', presets.map(p => p.title + '/' + p.reading));
  for (const p of presets) {
    const r = await page.evaluate((id) => {
      const t0 = performance.now(); const m = MapGen.fromPreset(id); const ms = performance.now() - t0;
      let hist = new Array(11).fill(0); m.heights.forEach(v => hist[v]++);
      return { ms, w: m.w, h: m.h, t: m.treasure, reg: (({ cells, touchesEdge, treasureHeight }) => ({ cells, touchesEdge, treasureHeight }))(T.region(m)),
        starts: T.startsInfo(m), hist, pic: m.picture.slice(0, 22), picLen: m.picture.length, title: m.title, reading: m.reading, img: T.render(m, 6) };
    }, p.id);
    save('mapgen_' + p.id + '.png', r.img);
    ok(r.w === 128 && r.h === 128, p.id + ' 128x128', [r.w, r.h]);
    ok(!r.reg.touchesEdge && r.reg.cells >= 16, p.id + ' 宝は囲まれた領域内', { t: r.t, ...r.reg });
    ok(r.starts.every(s => s.h === 0 && !s.inTreasureRegion), p.id + ' スタート高さ0・領域外', r.starts);
    ok(r.pic.startsWith('data:image/jpeg') , p.id + ' picture jpeg', r.picLen);
    // v3: 色の積み木（高さ2〜6）が少しある／戦車が通れる道（高さ0〜1）がつながっている／宝は低い所
    const q = await page.evaluate((id) => {
      const m = MapGen.fromPreset(id), w = m.w, h = m.h, n = w * h;
      const blocks = m.heights.filter(v => v >= 2 && v <= 6).length, low = m.heights.filter(v => v <= 1).length;
      const seen = new Uint8Array(n), st = m.starts[0], qu = [st.z * w + st.x]; seen[qu[0]] = 1; let reach = 0, reachLow = 0, k = 0;
      while (k < qu.length) { const i = qu[k++], x = i % w, z = (i - x) / w; reach++; if (m.heights[i] <= 1) reachLow++;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, nz = z + dz; if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue; const j = nz * w + nx;
          if (!seen[j] && m.heights[j] < 10 && Math.abs(m.heights[j] - m.heights[i]) <= 1) { seen[j] = 1; qu.push(j); } } }
      const s1 = m.starts[1], colored = [...Array(n).keys()].filter(i => { const r = m.colors[i * 3], g = m.colors[i * 3 + 1], b = m.colors[i * 3 + 2]; return Math.max(r, g, b) - Math.min(r, g, b) > 40; }).length;
      const c = document.createElement('canvas'); c.width = w * 5; c.height = h * 5; const g = c.getContext('2d');
      for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) { const i = z * w + x; g.fillStyle = `rgb(${m.colors[i * 3]},${m.colors[i * 3 + 1]},${m.colors[i * 3 + 2]})`; g.fillRect(x * 5, z * 5, 5, 5); }
      return { blocks, low, reachLow, s1ok: !!seen[s1.z * w + s1.x], th: m.heights[m.treasure.z * w + m.treasure.x], colored, img: c.toDataURL('image/png') };
    }, p.id);
    save('mapgen_color_' + p.id + '.png', q.img);
    ok(q.blocks >= 300 && q.blocks <= 6000, p.id + ' 色の積み木(高さ2〜6)が少しある', q.blocks);
    ok(q.reachLow / q.low >= 0.6, p.id + ' 高さ0〜1の道がつながっている(開始地点から)', { ratio: +(q.reachLow / q.low).toFixed(2), s1ok: q.s1ok });
    ok(q.s1ok, p.id + ' ゲストのスタートにも行ける');
    ok(q.th <= 1, p.id + ' 宝は低い所(高さ0〜1)', q.th);
    ok(q.colored >= 2500, p.id + ' 色のついたマスが多い', q.colored);
    console.log('     高さ分布', r.hist.join(','), ' ms=' + r.ms.toFixed(0));
  }
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
