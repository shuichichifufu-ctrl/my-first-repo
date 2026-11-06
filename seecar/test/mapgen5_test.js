// 第5期 MapGen の検査：すべての見本で 宝石10個・スタート・部屋 を確かめて表にする。node mapgen5_test.js [seeds]
const { openPage } = require('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/harness.js');
const fs = require('fs');
const dir = 'C:/Users/s9h0u/.claude/my-first-repo/seecar/test/';
const SEEDS = +(process.argv[2] || 20);
let fails = 0;
const ok = (c, msg, extra) => { if (!c) fails++; console.log((c ? 'OK   ' : 'NG   ') + msg + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); };
(async () => {
  const { browser, page, errors } = await openPage(dir + 'mapgen5_test.html');
  if (!fs.existsSync(dir + 'shots')) fs.mkdirSync(dir + 'shots');
  const presets = await page.evaluate(() => MapGen.presets);
  const kinds = {}; presets.forEach(p => { kinds[p.kind] = (kinds[p.kind] || 0) + 1; });
  ok(kinds.yoji >= 15 && kinds.kotowaza >= 10 && kinds.eigo >= 10 && kinds.illust >= 4, '見本の数', kinds);
  ok(new Set(presets.map(p => p.id)).size === presets.length, 'id が重ならない');
  ok(presets.every(p => /^(yoji|kotowaza|eigo|illust)$/.test(p.kind) && p.title && p.reading), 'kind/title/reading');
  ok(presets.filter(p => p.kind === 'eigo').every(p => /^[A-Z]+$/.test(p.title) && /^[ァ-ヶー]+$/.test(p.reading) && /^[ぁ-ゖー]+$/.test(p.meaning)), '英単語：大文字・読みカタカナ・意味ひらがな');
  ok(presets.filter(p => p.kind !== 'eigo').every(p => p.meaning === undefined), 'meaning は英単語だけ');
  ok(presets.filter(p => p.kind === 'yoji' || p.kind === 'kotowaza').every(p => /^[ぁ-ゖー]+$/.test(p.reading)), '四字熟語・ことわざの読みはひらがな');
  // この PC に入っているフォント（字の幅が monospace / serif の代わりと違えば「ある」）
  const fontInfo = await page.evaluate(() => {
    const g = document.createElement('canvas').getContext('2d');
    const has = (f, ch) => ['monospace', 'serif'].some(fb => { g.font = '900 40px ' + fb; const a = g.measureText(ch + ch + 'W').width; g.font = '900 40px "' + f + '",' + fb; return g.measureText(ch + ch + 'W').width !== a; });
    return { ja: ['Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'YuGothic', 'Meiryo', 'Noto Sans JP'].filter(f => has(f, '永')), en: ['Helvetica Neue', 'Arial', 'Arial Black'].filter(f => has(f, 'R')) };
  });
  console.log('fonts on this PC:', JSON.stringify(fontInfo));
  const rows = [];
  for (const p of presets) {
    const r = await page.evaluate(([id, SEEDS]) => {
      const t0 = performance.now(); MapGen._rand = mulberry(1); const m0 = MapGen.fromPreset(id, { treasureCount: 10 }); const ms = performance.now() - t0;
      const info = MapGen._textInfo(id), rooms = checkRooms(m0), st = checkStarts(m0);
      const bads = {}; let pmin = 100, inWallMin = 10, rt = true, stBad = st.bad.slice();
      for (let seed = 1; seed <= SEEDS; seed++) for (const count of [1, 10]) {
        MapGen._rand = mulberry(seed * 7919 + count);
        const m = MapGen.fromPreset(id, { treasureCount: count });
        const g = checkGems(m, count); g.bad.forEach(b => { bads[b] = (bads[b] || 0) + 1; });
        if (count === 10) { pmin = Math.min(pmin, g.pct); inWallMin = Math.min(inWallMin, g.inWall); }
        checkStarts(m).bad.forEach(b => stBad.push(b));
        rt = rt && roundtrip(m);
      }
      return { w: m0.w, h: m0.h, ms, info, rooms, sep: st.sep, stBad: [...new Set(stBad)], bads, pmin, inWallMin, rt, shot: render(m0, 4), pic: MapGen.presetCanvas(id).toDataURL('image/png') };
    }, [p.id, SEEDS]);
    fs.writeFileSync(dir + 'shots/p5_map_' + p.id + '.png', Buffer.from(r.shot.split(',')[1], 'base64'));
    const text = p.kind !== 'illust';
    const problems = [];
    if (Object.keys(r.bads).length) problems.push('gems:' + JSON.stringify(r.bads));
    if (r.stBad.length) problems.push('starts:' + r.stBad.join(','));
    if (!r.rt) problems.push('roundtrip');
    if (r.rooms.rooms < 1) problems.push('no-room');
    if (r.rooms.maxBreak > 10) problems.push('room-break' + r.rooms.maxBreak);
    if (r.rooms.maxD > 10) problems.push('thick' + r.rooms.maxD);
    if (r.w * r.h > 16384) problems.push('cells' + r.w * r.h);
    if (r.inWallMin < 10) problems.push('notInWall');
    if (r.pmin < 15) problems.push('pct' + r.pmin);
    if (problems.length) fails++;
    rows.push({ id: p.id, kind: p.kind, title: p.title, size: r.w + 'x' + r.h, cells: r.w * r.h, ms: r.ms.toFixed(0), stroke: text ? r.info.stroke0.toFixed(2) + '->' + r.info.stroke.toFixed(2) : '-', rooms: r.rooms.rooms, brk: r.rooms.maxBreak, thick: r.rooms.maxD, wall: r.rooms.wallPct + '%', sep: r.sep.toFixed(0), Dpct: r.pmin, res: problems.length ? 'NG ' + problems.join(' ') : 'OK' });
  }
  console.log('\n| id | kind | title | map | cells | ms | stroke(px) | rooms | break | thick | wall | startSep | D%min | result |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  rows.forEach(r => console.log(`| ${r.id} | ${r.kind} | ${r.title} | ${r.size} | ${r.cells} | ${r.ms} | ${r.stroke} | ${r.rooms} | ${r.brk} | ${r.thick} | ${r.wall} | ${r.sep} | ${r.Dpct} | ${r.res} |`));
  console.log('\nlegend: rooms=閉じた床(8マス以上) / break=部屋に入るのに壊す壁の最大マス数 / thick=壁マスから床までの最大距離 / D%min=宝とスタートの距離の比率(20種の最小) / 各見本 seeds=' + SEEDS + ' x {1,10}個');
  // 一覧の画像（目で見る用）
  const sheet = await page.evaluate(() => {
    const ps = MapGen.presets, cols = 6, cw = 220, chh = 150, c = document.createElement('canvas'); c.width = cols * cw; c.height = Math.ceil(ps.length / cols) * chh; const g = c.getContext('2d');
    g.fillStyle = '#ddd'; g.fillRect(0, 0, c.width, c.height);
    ps.forEach((p, i) => { MapGen._rand = mulberry(1); const m = MapGen.fromPreset(p.id, { treasureCount: 10 }); const im = document.createElement('canvas'); im.width = m.w; im.height = m.h; const ig = im.getContext('2d'), d = ig.createImageData(m.w, m.h);
      for (let k = 0; k < m.w * m.h; k++) { const v = m.heights[k] >= 10 ? 0 : 255; d.data[k * 4] = d.data[k * 4 + 1] = d.data[k * 4 + 2] = v; d.data[k * 4 + 3] = 255; }
      m.treasures.forEach(t => { const k = t.z * m.w + t.x; d.data[k * 4] = 255; d.data[k * 4 + 1] = 40; d.data[k * 4 + 2] = 40; });
      m.starts.forEach(s => { const k = s.z * m.w + s.x; d.data[k * 4] = 0; d.data[k * 4 + 1] = 90; d.data[k * 4 + 2] = 255; });
      ig.putImageData(d, 0, 0); const k = Math.min((cw - 10) / m.w, (chh - 24) / m.h), x = (i % cols) * cw + 5, y = Math.floor(i / cols) * chh + 20;
      g.imageSmoothingEnabled = false; g.drawImage(im, x, y, m.w * k, m.h * k); g.fillStyle = '#000'; g.font = '14px sans-serif'; g.fillText(p.id + ' ' + p.title + ' ' + m.w + 'x' + m.h, x, y - 5); });
    return c.toDataURL('image/png');
  });
  fs.writeFileSync(dir + 'shots/p5_presets_sheet.png', Buffer.from(sheet.split(',')[1], 'base64'));
  // フォントが違っても成り立つか（iPad のヒラギノの代わりに、この PC にある太さ・形の違うフォントで試す）
  const VARIANTS = [{ ja: "'Noto Sans JP',sans-serif" }, { ja: "'Meiryo',sans-serif" }, { ja: "'MS Gothic',monospace" }, { en: "'Arial Black',sans-serif" }, { en: "'Verdana',sans-serif" }, { en: "'Segoe UI',sans-serif" }];
  for (const v of VARIANTS) {
    const res = await page.evaluate(([v, ids]) => {
      MapGen._fontJa = v.ja; MapGen._fontEn = v.en; const out = [];
      ids.forEach(id => {
        const bad = []; let rooms = null;
        for (let seed = 1; seed <= 3; seed++) { MapGen._rand = mulberry(seed * 13); const m = MapGen.fromPreset(id, { treasureCount: 10 }); checkGems(m, 10).bad.forEach(b => bad.push(b)); checkStarts(m).bad.forEach(b => bad.push(b)); if (seed === 1) rooms = checkRooms(m); }
        if (rooms.rooms < 1) bad.push('no-room'); if (rooms.maxBreak > 10) bad.push('break' + rooms.maxBreak); if (rooms.maxD > 10) bad.push('thick' + rooms.maxD);
        const info = MapGen._textInfo(id);
        out.push({ id, bad: [...new Set(bad)], stroke: info.stroke0.toFixed(1) + '->' + info.stroke.toFixed(1), thick: rooms.maxD });
      });
      MapGen._fontJa = MapGen._fontEn = undefined;
      return out;
    }, [v, presets.filter(p => v.ja ? (p.kind === 'yoji' || p.kind === 'kotowaza') : p.kind === 'eigo').map(p => p.id)]);
    const ng = res.filter(r => r.bad.length);
    console.log('font ' + JSON.stringify(v) + ': ' + (res.length - ng.length) + '/' + res.length + ' OK' + (ng.length ? '  NG: ' + ng.map(r => r.id + '(' + r.bad.join(',') + ' stroke ' + r.stroke + ')').join(' ') : '') + '  stroke range ' + res.map(r => r.stroke).filter((x, i, a) => i === 0 || i === a.length - 1).join(' .. '));
  }
  ok(!/つちのやま|土の山/.test(fs.readFileSync(dir + '../src/mapgen.js', 'utf8')), 'mapgen.js に「つちのやま/土の山」なし');
  const realErr = errors.filter(e => !/404/.test(e)); ok(realErr.length === 0, 'ページエラーなし(404は無視)', realErr);
  console.log(fails ? 'FAILS ' + fails : 'ALL OK');
  await browser.close(); process.exit(fails ? 1 : 0);
})();
