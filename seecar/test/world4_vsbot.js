// CPU の強さの目安：「上手な人の代わりのボット」と各強さの CPU が、同じ地図・同じ宝で、宝を見つけるまでの時間を比べる。
// （独立レビュー critic4_r2 の p3_cpu.js を移したもの）  cd seecar/test && node world4_vsbot.js [seed数=4] [levels=easy,normal,hard]
// ボット＝CPU と同じ AI に、誤差0・反応0.15秒・道の間違い0・加速+50%（人と同じ）を与えたもの。宝の場所はソナー／光で正確に分かる。
// ボットと CPU は地図の2つのスタートから走る（入れかえた回も走らせ、地図の有利・不利を消す）。ボットの時間 < CPU の時間 なら「ボットの勝ち」。
// 目安（SPEC4 §6-3 を数にしたもの）：ボットの勝率  むずかしい ≈65%、ふつう ≈75〜80%、やさしい ≈90%（ひかり・ソナーの両方）
const { openPage, stopStatic } = require('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/harness.js');
const SEEDS = +(process.argv[2] || 4);
const LEVELS = (process.argv[3] || 'easy,normal,hard').split(',');
const SEARCHES = (process.argv[4] || 'light,sonar').split(',');
const OVERRIDE = process.argv[5] ? JSON.parse(process.argv[5]) : null; // 調整用：{"hard":{"speed":0.9}} のように CPU_LEVELS を一時的に上書き
(async () => {
  const { browser, page, errors } = await openPage('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/world4_test.html', { viewport: { width: 640, height: 360 } });
  await new Promise(r => setTimeout(r, 1200));
  const out = await page.evaluate(async ([SEEDS, LEVELS, SEARCHES, OVERRIDE]) => {
    if (OVERRIDE) for (const k in OVERRIDE) Object.assign(World.CPU_LEVELS[k], OVERRIDE[k]);
    window.autoAward = false;
    World._manual(true);
    World.CPU_LEVELS.bot = { speed: 1.0, accelMax: 0.5, react: 0.15, sonarErr: { ang: 0.0, dist: 0.0 }, mistake: 0, turn: 6.0 };
    const ids = MapGen.presets.map(p => p.id);
    const res = {}, dt = 1 / 20;
    const run = (id, seed, lv, search, myIndex) => {
      MapGen._rand = (function (a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })(seed); // mulberry32（種ごとに宝の場所が ちゃんと変わる）
      const m = MapGen.fromPreset(id, { treasureCount: 1 });
      MapGen._rand = Math.random;
      World.load(m, { myIndex, mode: 'race', search, cpu: { level: lv } });
      World._manual(true); World.go();
      for (let i = 0; i < 300 / dt; i++) { World._step(1, dt); const c = World._cpu(); if (c.hits.length) return c.hits[0]; }
      return 999;
    };
    for (const search of SEARCHES) for (const lv of LEVELS.concat(['bot'])) {
      const times = [];
      // 地図ごとのスタートの有利・不利を消すため、ボットと CPU のスタートを入れかえた回も走らせる
      for (let t = 0; t < SEEDS; t++) for (const id of ids) for (const side of [0, 1]) {
        const seed = 7919 * (t + 1) + 104729 * (ids.indexOf(id) + 1);
        times.push(run(id, seed, lv, search, lv === 'bot' ? 1 - side : side));
        await new Promise(r => setTimeout(r, 0));
      }
      res[search + ':' + lv] = times;
    }
    return res;
  }, [SEEDS, LEVELS, SEARCHES, OVERRIDE]);
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  for (const k in out) console.log(k.padEnd(14), 'median', med(out[k]).toFixed(1), 'mean', (out[k].reduce((a, b) => a + b, 0) / out[k].length).toFixed(1), 'timeouts', out[k].filter(x => x >= 999).length);
  for (const s of SEARCHES) for (const lv of LEVELS) {
    const a = out[s + ':' + lv], o = out[s + ':bot']; let w = 0;
    for (let i = 0; i < a.length; i++) if (o[i] < a[i]) w++;
    console.log(`${s.padEnd(6)} ${lv.padEnd(7)} bot wins ${w}/${a.length} (${Math.round(w / a.length * 100)}%)`);
  }
  if (errors.filter(e => !/404/.test(e)).length) console.log('errors', errors);
  await browser.close(); stopStatic && stopStatic(); process.exit(0);
})();
