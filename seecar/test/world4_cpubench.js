// CPU が宝石を見つけるまでの時間（ゲーム内の秒）。node world4_cpubench.js [回数]
const { openPage, stopStatic } = require('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/harness.js');
const N = +(process.argv[2] || 3), LIMIT = +(process.argv[3] || 300);
(async () => {
  const { browser, page, errors } = await openPage('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/world4_test.html', { viewport: { width: 640, height: 360 } });
  page.on('console', (m) => { if (m.type() === 'warning' && /World|Seeker/.test(m.text())) errors.push('warn: ' + m.text()); });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(() => World._manual(true));
  const maps = await page.evaluate(() => MapGen.presets.map(p => p.id));
  const out = {};
  for (const search of ['sonar', 'light']) for (const lv of ['easy', 'normal', 'hard']) {
    const times = [], ideal = [];
    for (let k = 0; k < N; k++) {
      const mp = maps[(k * 3 + (lv === 'easy' ? 0 : lv === 'normal' ? 1 : 2) + (search === 'light' ? 5 : 0)) % maps.length];
      const r = await page.evaluate(async ([lv, s, mp, LIMIT]) => {
        const m = MapGen.fromPreset(mp, { treasureCount: 1 }); loadMap(m, { cpu: { level: lv }, mode: 'race', search: s });
        const st = m.starts[1], t = m.treasures[0], idealT = Math.hypot(st.x - t.x, st.z - t.z) / 2.88;
        for (let f = 0; f < LIMIT * 30; f += 300) { World._step(300, 1 / 30); if (events.gemHit.length) break; }
        const c = World._cpu();
        return { mp, hit: c.hits.length ? c.hits[0] : null, ideal: idealT, misses: c.misses, mistakes: c.mistakes, reads: c.reads };
      }, [lv, search, mp, LIMIT]);
      times.push(r.hit == null ? 'X' : r.hit.toFixed(1) + '(x' + (r.hit / r.ideal).toFixed(1) + ')'); ideal.push(r.ideal.toFixed(1));
      console.log(search, lv, r.mp, 'found', r.hit == null ? 'NO' : r.hit.toFixed(1) + 's', 'straight-line', r.ideal.toFixed(1) + 's', 'misses', r.misses, 'mistakes', r.mistakes);
    }
    out[search + '/' + lv] = times.join(',') + '  (ideal ' + ideal.join(',') + ')';
  }
  console.log(JSON.stringify(out, null, 1));
  console.log(errors.filter(e => !/404/.test(e)));
  await browser.close(); stopStatic();
})();
