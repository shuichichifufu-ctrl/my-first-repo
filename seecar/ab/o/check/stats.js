// 既定地図の統計: node stats.js [file]
const { openPage, stopStatic } = require('/home/user/my-first-repo/seecar/test/harness.js');
const FILE = process.argv[2] || '/home/user/my-first-repo/seecar/ab/o/dist/seecar_v4o.html';
(async () => {
  const { browser, page, errors } = await openPage(FILE);
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => MapGen.presets.map((p) => {
    const m = MapGen.fromPreset(p.id), { w, h, heights, colors } = m;
    const hist = new Array(11).fill(0); let wallDark = 0, wall = 0, nearWallMid = 0;
    for (let i = 0; i < w * h; i++) {
      hist[heights[i]]++;
      if (heights[i] === 10) { wall++; const L = (0.299 * colors[i * 3] + 0.587 * colors[i * 3 + 1] + 0.114 * colors[i * 3 + 2]) / 255; if (L < 0.16) wallDark++; }
      else if (heights[i] >= 2) { const x = i % w, z = (i - x) / w; let adj = false; for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x + dx, nz = z + dz; if (nx >= 0 && nz >= 0 && nx < w && nz < h && heights[nz * w + nx] === 10) adj = true; } if (adj) nearWallMid++; }
    }
    const s = m.starts[0], t = m.treasure; const dist = Math.hypot(s.x - t.x, s.z - t.z);
    return { id: p.id, w, h, hist: hist.join(','), wallDarkPct: Math.round(wallDark / wall * 100), nearWallMid, start: s, s1: m.starts[1], treasure: t, dist: dist.toFixed(1) };
  }));
  r.forEach((x) => console.log(JSON.stringify(x)));
  console.log('errors', errors); await browser.close(); stopStatic(); process.exit(0);
})();
