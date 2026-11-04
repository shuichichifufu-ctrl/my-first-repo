const { openPage, stopStatic } = require('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/harness.js');
(async () => {
  const { browser, page } = await openPage('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/world4_test.html', { viewport: { width: 1024, height: 576 } });
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(() => { World._manual(true); const m = flatMap(80, 30, []); loadMap(m); World._setPose(2.5, 15.5, -Math.PI / 2); World.press('fwd', true); World._step(150); World.setCamera(0); World.setCamera(1); });
  // 横から見るため、少し左へ向けてカメラだけ
  await page.evaluate(() => { World._step(12); });
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: 'C:/Users/s9h0u/.claude/my-first-repo/seecar/test/shots/p4_world_accel_dust.png' });
  await browser.close(); stopStatic();
})();
