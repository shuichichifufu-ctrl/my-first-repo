const { openPage, stopStatic } = require('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/harness.js');
const LV = process.argv[2] || 'hard', SEARCH = process.argv[3] || 'sonar', MAP = process.argv[4] || 'mikka';
(async () => {
  const { browser, page, errors } = await openPage('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/world4_test.html', { viewport: { width: 640, height: 360 } });
  page.on('console', (m) => { if (m.type() === 'warning' && /World|Seeker/.test(m.text())) errors.push('warn: ' + m.text()); });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(([lv, s, mp]) => { World._manual(true); const m = MapGen.fromPreset(mp, { treasureCount: 1 }); window.M = m; loadMap(m, { cpu: { level: lv }, mode: 'race', search: s }); }, [LV, SEARCH, MAP]);
  const t0 = Date.now();
  for (let k = 0; k < 40; k++) {
    const r = await page.evaluate(() => { World._step(150, 1/30); return { c: World._cpu(), d: World._debug().cpu, hit: events.gemHit, t: M.treasures[0] }; });
    console.log(Math.round(r.c.time), 'pos', r.d.cx, r.d.cz, 'lv', r.d.lv, 'est', JSON.stringify(r.c.est), 'conf', r.c.conf.toFixed(2), 'goal', JSON.stringify(r.c.goal), r.c.hold, 'reads', r.c.reads, 'miss', r.c.misses, 'mist', r.c.mistakes, 'repl', r.c.replans, 'stage', r.c.stage, 'tgt', r.t.x, r.t.z);
    if (r.hit.length) { console.log('HIT', JSON.stringify(r.hit)); break; }
  }
  console.log('wall', (Date.now() - t0) / 1000, errors.filter(e => !/404/.test(e)));
  await browser.close(); stopStatic();
})();
