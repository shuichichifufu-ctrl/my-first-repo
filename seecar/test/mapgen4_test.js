const { openPage } = require('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/harness.js');
const fs = require('fs');
const dir = 'C:/Users/s9h0u/.claude/my-first-repo/seecar/test/';
let fails = 0;
const ok = (c, msg, extra) => { if (!c) fails++; console.log((c ? 'OK   ' : 'NG   ') + msg + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); };
(async () => {
  const { browser, page, errors } = await openPage(dir + 'mapgen4_test.html');
  const gems = await page.evaluate(() => MapGen.GEMS);
  ok(gems.length === 10 && gems.map(g => g.id).join() === 'diamond,ruby,sapphire,emerald,amethyst,topaz,aquamarine,garnet,peridot,opal', 'GEMS 10種・順序');
  ok(gems.every(g => /^#[0-9a-f]{6}$/i.test(g.color) && /^#[0-9a-f]{6}$/i.test(g.glow) && /^[ァ-ヶー]+$/.test(g.name)), 'GEMS color/glow hex・名前カタカナ', gems.map(g => g.name).join(' '));
  const presets = await page.evaluate(() => MapGen.presets);
  const stat = { relaxed: 0, dropped: 0, total: 0 };
  for (const p of presets) {
    for (const count of [1, 10]) {
      const r = await page.evaluate(([id, count]) => {
        const out = []; let rt = true, shot = null;
        for (let seed = 1; seed <= 20; seed++) {
          MapGen._rand = mulberry(seed * 7919);
          const m = MapGen.fromPreset(id, { treasureCount: count });
          const c = check(m, count); rt = rt && roundtrip(m);
          out.push({ bad: c.bad, p: c.p, sep: c.sep, inWall: c.inWall });
          if (seed === 1) shot = render(m, 5);
        }
        return { out, rt, shot };
      }, [p.id, count]);
      const bads = r.out.filter(o => o.bad.length);
      const pcts = {};
      r.out.forEach(o => { const k = o.p.pct + (o.p.dropped ? 'drop:' + o.p.fallback : ''); pcts[k] = (pcts[k] || 0) + 1; stat.total++; if (o.p.relaxed) stat.relaxed++; if (o.p.dropped) stat.dropped++; });
      ok(!bads.length && r.rt, `${p.id} x${count} (cand=${r.out[0].p.candidates}, D=${r.out[0].p.D.toFixed(1)}, sep=${r.out[0].sep.toFixed(0)}, inWall=${r.out[0].inWall}/${count}, pct=${JSON.stringify(pcts)})`, bads.length ? bads[0].bad : undefined);
      if (count === 10) fs.writeFileSync(dir + 'shots/p4_map_' + p.id + '.png', Buffer.from(r.shot.split(',')[1], 'base64'));
    }
  }
  console.log('relaxation:', JSON.stringify(stat));
  const up = await page.evaluate(() => {
    const mk = (fn, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); fn(g, w, h); return c; };
    const drawings = {
      lines: mk((g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.lineWidth = 14; g.strokeStyle = '#000'; g.strokeRect(80, 80, 440, 340); g.beginPath(); g.arc(300, 250, 90, 0, 7); g.stroke(); g.fillStyle = '#e33'; g.fillRect(40, 440, 80, 40); }, 600, 500),
      gradient: mk((g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#222'); gr.addColorStop(1, '#eee'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#c33'; g.fillRect(100, 100, 150, 150); }, 800, 400),
      blank: mk((g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }, 300, 300),
      black: mk((g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); }, 300, 300),
      tiny: mk((g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#000'; g.fillRect(3, 3, 4, 4); }, 12, 12),
      tall: mk((g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#000'; for (let y = 50; y < h; y += 150) g.fillRect(40, y, 120, 20); }, 200, 900)
    };
    const res = [];
    for (const k in drawings) for (const binary of [false, true]) for (const count of [1, 10]) {
      const bads = []; let pl;
      for (let seed = 1; seed <= 10; seed++) {
        MapGen._rand = mulberry(seed * 31);
        try {
          const m = MapGen.fromCanvas(drawings[k], 'x', 'x', { binary, treasureCount: count });
          const c = check(m, count); pl = m.placement; if (!roundtrip(m)) bads.push('rt');
          c.bad.forEach(b => bads.push(b));
        } catch (e) { bads.push('EXC ' + e.message); }
      }
      const lenient = k === 'blank' || k === 'black'; const okRe = lenient ? /^(height|dist)/ : (k === 'gradient' ? /^starth$/ : /^$/); res.push({ k, binary, count, bads: [...new Set(bads)].filter(b => !(okRe.test(b) && b !== '')), pl });
    }
    return res;
  });
  up.forEach(u => ok(!u.bads.length, `fromCanvas ${u.k} binary=${u.binary} x${u.count} ${JSON.stringify(u.pl)}`, u.bads.length ? u.bads : undefined));
  const fileOk = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 300); g.fillStyle = '#000'; g.fillRect(50, 50, 120, 200); g.fillRect(220, 80, 130, 130);
    const blob = await new Promise(r => c.toBlob(r, 'image/png')); const f = new File([blob], 'a.png', { type: 'image/png' });
    const m = await MapGen.fromFile(f, { binary: true, treasureCount: 10 });
    return check(m, 10);
  });
  ok(!fileOk.bad.length, 'fromFile binary x10', fileOk.bad.length ? fileOk.bad : fileOk.p);
  ok(!/つちのやま|土の山/.test(fs.readFileSync(dir + '../src/mapgen.js', 'utf8')), 'mapgen.js に「つちのやま/土の山」なし');
  const realErr = errors.filter(e => !/404/.test(e)); ok(realErr.length === 0, 'ページエラーなし(404は無視)', realErr);
  console.log(fails ? 'FAILS ' + fails : 'ALL OK');
  await browser.close(); process.exit(fails ? 1 : 0);
})();
