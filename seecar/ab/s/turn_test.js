const { openPage, stopStatic } = require('/home/user/my-first-repo/seecar/test/harness.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { browser, page, errors } = await openPage('/home/user/my-first-repo/seecar/ab/s/dist/seecar_v4s.html');
  await sleep(500); await page.click('#boot', { force: true }); await sleep(400);
  await page.click('#nav [data-nav="はじめる"]', { force: true }); await sleep(400);
  await page.click('.card[data-id=mikka]', { force: true }); await sleep(600);
  await page.click('#nav [data-nav="しゅっぱつ！"]', { force: true });
  await sleep(1500);
  const me = async () => (await page.evaluate(() => World._debug())).me;
  console.log('start', await me());
  // 押しっぱなし 3秒
  await page.evaluate(() => World.press('right', true)); await sleep(3000); console.log('held right 3s', await me());
  await page.evaluate(() => World.press('right', false)); await sleep(1500);
  console.log('released', await me());
  await page.evaluate(() => { World.press('right', true); World.press('right', false); }); await sleep(2500); console.log('tap right', await me());
  await page.evaluate(() => { World.press('fwd', true); World.press('fwd', false); }); await sleep(2500); console.log('tap fwd', await me());
  console.log(errors); await browser.close(); stopStatic(); process.exit(0);
})();
