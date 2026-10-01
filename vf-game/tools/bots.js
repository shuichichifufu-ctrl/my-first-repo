// CPUの強さを測る検証用ボット。使い方: node tools/bots.js versions/v4.html [戦数] [ボット名,...]
const { chromium } = require('playwright');
const BOTS = `
const mk = {
  throwspam() { let c = 0, hold = 0; return (a, b) => { const i = a.input; reset(i); const d = dist(a, b); c++;
    if (hold > 0) { hold--; i.g = true; i.p = true; return; }
    if (d > 1.1) { i.fwd = true; return; }
    if (c % 25 === 0) { i.pBuf = 5; i.gBuf = 5; i.g = true; i.p = true; hold = 2; } }; },
  jabguard() { let ph = 0, t = 0; return (a, b) => { const i = a.input; reset(i); const d = dist(a, b); t++;
    if (ph === 0) { if (d > 1.4) i.fwd = true; else { i.pBuf = 5; i.p = true; ph = 1; t = 0; } }
    else { i.g = true; if (t > 16) ph = 0; } }; },
  rangekick() { let t = 0, ph = 0; return (a, b) => { const i = a.input; reset(i); const d = dist(a, b); t++;
    if (ph === 0) { if (d > 1.85) i.fwd = true; else if (d < 1.55) i.back = true; else { i.kBuf = 5; i.k = true; ph = 1; t = 0; } }
    else { i.back = t < 12; i.g = true; if (t > 24) ph = 0; } }; },
  human() { let seenAt = -99, lastAtk = '', hold = 0, crouchHold = 0, c = 0, cdn = 0; return (a, b) => { const i = a.input; reset(i); const d = dist(a, b); c++;
    if (b.state === 'attack' && b.move && b.t === 1) { seenAt = c; lastAtk = b.move.h; }
    if (c - seenAt === 14 && d < 2.4 && b.state === 'attack') { hold = 22; crouchHold = lastAtk === 'low' ? 22 : 0; }
    if (hold > 0) { hold--; i.g = true; if (crouchHold > 0) { crouchHold--; i.crouch = true; } return; }
    if (cdn > 0) cdn--;
    const rec = b.state === 'attack' && b.move && b.t > b.move.su + b.move.ac;
    if (rec && d < 1.5 && cdn === 0) { i.pBuf = 5; i.p = true; cdn = 12; return; }
    if (rec && d < 1.85 && cdn === 0) { i.kBuf = 5; i.k = true; cdn = 14; return; }
    if (b.state === 'blockstun' || b.state === 'hitstun') { if (d < 1.4 && cdn === 0) { i.pBuf = 5; i.p = true; cdn = 10; } else if (d >= 1.4) i.fwd = true; return; }
    i.g = true;
    if (d > 1.9) { i.fwd = true; return; }
    if (b.input.g && d < 1.2 && cdn === 0) { i.pBuf = 5; i.gBuf = 5; i.p = true; cdn = 30; return; }
    if (d < 1.5 && cdn === 0 && c % 3 === 0) { const r = (c / 3) % 4; if (r === 0) { i.pBuf = 5; i.p = true; } else if (r === 1) { i.kBuf = 5; i.k = true; } else if (r === 2) { i.crouch = true; i.kBuf = 5; i.k = true; } else { i.fwd = true; i.pBuf = 5; i.p = true; } cdn = 22; } }; },
  masher() { let c = 0; return (a, b) => { const i = a.input; reset(i); c++; const d = dist(a, b);
    if (d > 1.5) i.fwd = true; if (c % 6 === 0) { if (Math.random() < 0.5) { i.pBuf = 5; i.p = true; } else { i.kBuf = 5; i.k = true; } } }; },
  sidestep() { let c = 0, ph = 0, t = 0; return (a, b) => { const i = a.input; reset(i); const d = dist(a, b); t++;
    if (d > 1.8) { i.fwd = true; return; }
    if (ph === 0) { i.sideIn = true; if (t > 14) { ph = 1; t = 0; } }
    else { i.kBuf = 5; i.k = true; if (t > 25) { ph = 0; t = 0; } } }; },
};
function reset(i) { i.fwd = i.back = i.crouch = i.sideIn = i.sideOut = i.p = i.k = i.g = false; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
`;
(async () => {
  const file = process.argv[2], n = +(process.argv[3] || 8);
  const names = (process.argv[4] || 'throwspam,jabguard,rangekick,human,masher,sidestep').split(',');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const name of names) {
    const p = await b.newPage({ viewport: { width: 400, height: 300 } });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + require('path').resolve(file) + '?start=1&norender=1&speed=30');
    await p.evaluate(`(() => { ${BOTS}; window.__res = []; window.__vf.bot = mk['${name}'](); window.__last = null;
      setInterval(() => { const g = window.__vf.game; if (g.phase === 'matchEnd' && window.__last !== g.matchWinner) { window.__last = g.matchWinner; window.__res.push({ w: g.matchWinner.idx, hp: window.__vf.F.map(f => f.wins) });
        setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' })), 50); } }, 30); })()`);
    const t0 = Date.now(); let res = [];
    while (Date.now() - t0 < 150000) { await p.waitForTimeout(500); res = await p.evaluate('window.__res'); if (res.length >= n) break; }
    const wins = res.filter(r => r.w === 0).length;
    console.log(name.padEnd(10), `ボット勝ち ${wins}/${res.length}`, errs.length ? 'ERR ' + errs[0] : '');
    await p.close();
  }
  await b.close();
})();
