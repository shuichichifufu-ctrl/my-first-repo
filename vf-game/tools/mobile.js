// スマホ表示の確認。使い方: node tools/mobile.js polygon-fighter.html 出力フォルダ
const { chromium } = require('playwright');
(async () => {
  const file = require('path').resolve(process.argv[2]), out = process.argv[3];
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
  for (const [name, vp] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
    const ctx = await b.newContext({ viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto('file://' + file);
    await p.waitForTimeout(1500);
    console.log(name, 'touchクラス:', await p.evaluate(() => document.body.classList.contains('touch')));
    await p.touchscreen.tap(vp.width / 2, vp.height / 3);   // タップで開始
    await p.waitForTimeout(3500);
    console.log(name, '開始後のフェーズ:', await p.evaluate(() => __vf.game.phase));
    const rect = sel => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
    const tap = async sel => { const [x, y] = await rect(sel); await p.touchscreen.tap(x, y); };
    await tap('[data-k="KeyJ"]'); await p.waitForTimeout(40);
    console.log(name, 'パンチボタン後の1Pの状態:', await p.evaluate(() => __vf.F[0].state));
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/mobile_${name}.png` });
    console.log(name, 'エラー:', errs.length ? errs : 'なし');
    await ctx.close();
  }
  await b.close();
})();
