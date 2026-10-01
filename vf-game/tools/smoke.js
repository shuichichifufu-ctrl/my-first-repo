// 使い方: node tools/smoke.js versions/v1.html [秒数] [スクショ出力先]
const { chromium } = require('playwright');
(async () => {
  const file = process.argv[2], secs = +(process.argv[3] || 10), shot = process.argv[4];
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto('file://' + require('path').resolve(file) + '?auto=1&speed=3');
  await p.waitForTimeout(secs * 1000);
  const st = await p.evaluate(() => ({ phase: __vf.game.phase, round: __vf.game.round, hp: __vf.F.map(f => f.hp), wins: __vf.F.map(f => f.wins), states: __vf.F.map(f => f.state) }));
  console.log(JSON.stringify(st));
  if (shot) await p.screenshot({ path: shot });
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
})();
