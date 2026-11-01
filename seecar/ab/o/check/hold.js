// ひだりを押しつづけても90度だけ回るか
const { openPage, stopStatic } = require('/home/user/my-first-repo/seecar/test/harness.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { browser, page, errors } = await openPage('/home/user/my-first-repo/seecar/ab/o/dist/seecar_v4o.html');
  await sleep(500); await page.click('#boot', { force: true }); await sleep(400);
  await page.click('#nav [data-nav="はじめる"]', { force: true }); await sleep(400);
  await page.click('.card[data-id=mikka]', { force: true }); await sleep(600);
  await page.click('#nav [data-nav="しゅっぱつ！"]', { force: true }); await sleep(800);
  const d0 = await page.evaluate(() => World._debug());
  // UIのボタンを実際に押したままにする（pointerdown → ゲーム内時間で2秒 → pointerup）
  const box = await page.locator('#dpad [data-act=left]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  for (let i = 0; i < 300; i++) { const t = await page.evaluate(() => World._debug().time); if (t - d0.time > 2.0) break; await sleep(200); }
  const d1 = await page.evaluate(() => World._debug()); await page.mouse.up(); await sleep(1500);
  const d2 = await page.evaluate(() => World._debug());
  console.log('dir', d0.me.dir, '->', d1.me.dir, '->', d2.me.dir, 'gameTime', (d1.time - d0.time).toFixed(2), (d0.me.dir + 3) % 4 === d2.me.dir ? 'OK 90度だけ' : 'NG');
  // 2回たたくと2回まわる
  for (let k = 0; k < 2; k++) { await page.evaluate(() => { World.press('right', true); World.press('right', false); }); for (let i = 0; i < 100; i++) { await sleep(200); if (await page.evaluate(() => World._debug().me.dir) !== (k === 0 ? d2.me.dir : (d2.me.dir + 1) % 4)) break; } }
  const d3 = await page.evaluate(() => World._debug());
  console.log('tap x2 right', d2.me.dir, '->', d3.me.dir, d3.me.dir === (d2.me.dir + 2) % 4 ? 'OK' : 'NG');
  console.log('errors', errors); await browser.close(); stopStatic(); process.exit(0);
})();
