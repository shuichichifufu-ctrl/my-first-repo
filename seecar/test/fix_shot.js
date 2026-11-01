// 既定地図などで おいかけ視点の絵を撮る: node fix_shot.js v3 [presetId]
const { openPage, stopStatic } = require('./harness.js');
const ver = process.argv[2] || 'v3', preset = process.argv[3] || 'mikka';
const FILE = `/home/user/my-first-repo/seecar/dist/seecar_${ver}.html`;
const SH = `/home/user/my-first-repo/seecar/test/shots/fix_${ver}_`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { browser, page, errors } = await openPage(FILE);
  await sleep(500); await page.click('#boot', { force: true }); await sleep(400);
  await page.click('#nav [data-nav="はじめる"]', { force: true }); await sleep(400);
  await page.click(`.card[data-id=${preset}]`, { force: true }); await sleep(600);
  await page.click('#nav [data-nav="しゅっぱつ！"]', { force: true });
  for (let i = 0; i < 400; i++) { const t = await page.evaluate(() => World._debug().intro); if (t < 0) break; await sleep(200); }
  await sleep(1500); await page.screenshot({ path: SH + preset + '_chase.png' });
  // 少し進んで撃つ
  for (let k = 0; k < 3; k++) { await page.evaluate(() => { World.press('fwd', true); World.press('fwd', false); }); await sleep(1200); }
  await page.evaluate(() => World.press('fire', true)); await sleep(100); await page.evaluate(() => World.press('fire', false));
  await sleep(900); await page.screenshot({ path: SH + preset + '_boom.png' });
  await sleep(2500); await page.screenshot({ path: SH + preset + '_chase2.png' });
  await page.evaluate(() => World.setCamera(0)); await sleep(2500); await page.screenshot({ path: SH + preset + '_first.png' });
  await page.evaluate(() => World.setCamera(2)); await sleep(2500); await page.screenshot({ path: SH + preset + '_top.png' });
  console.log('errors', errors); await browser.close(); stopStatic(); process.exit(0);
})();
