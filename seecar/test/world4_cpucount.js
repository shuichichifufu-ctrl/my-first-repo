const { openPage, stopStatic } = require('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/harness.js');
(async () => {
  const { browser, page, errors } = await openPage('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/world4_test.html', { viewport: { width: 640, height: 360 } });
  page.on('console', (m) => { if (m.type() === 'warning' && /World|Seeker/.test(m.text())) errors.push('warn: ' + m.text()); });
  await new Promise(r => setTimeout(r, 1200));
  for (const [lv, s, mp] of [['hard', 'sonar', 'hana'], ['normal', 'light', 'sakana'], ['easy', 'sonar', 'jiyu']]) {
    const t0 = Date.now();
    const r = await page.evaluate(([lv, s, mp]) => { World._manual(true); const m = MapGen.fromPreset(mp, { treasureCount: 10 }); loadMap(m, { cpu: { level: lv }, mode: 'count', search: s });
      const gemOK = m.treasures.every((t) => m.heights[t.z * m.w + t.x] >= 2) && new Set(m.treasures.map((t) => t.gem)).size === 10;
      for (let f = 0; f < 300 * 30; f += 300) { World._step(300, 1 / 30); }
      const c = World._cpu(); return { gemOK, hits: c.hits, collect: events.collect.length, scores: World.scores(), misses: c.misses, info: World.treasureInfo() }; }, [lv, s, mp]);
    console.log(lv, s, mp, 'gems in blocks & 10 kinds', r.gemOK, '| CPU found at', JSON.stringify(r.hits), 'scores', JSON.stringify(r.scores), 'misses', r.misses, 'left', r.info.left, 'wall', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
  console.log(errors.filter(e => !/404/.test(e)));
  await browser.close(); stopStatic();
})();
