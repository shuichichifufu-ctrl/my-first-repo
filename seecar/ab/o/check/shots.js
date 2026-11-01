// 既定地図5つの、開始演出のあとの おいかけ視点を撮る: node shots.js [presetId...]
const { openPage, stopStatic } = require('/home/user/my-first-repo/seecar/test/harness.js');
const FILE = '/home/user/my-first-repo/seecar/ab/o/dist/seecar_v4o.html';
const OUT = '/home/user/my-first-repo/seecar/ab/o/shots/';
const VP = { width: +(process.env.VW || 1024), height: +(process.env.VH || 768) };
const TAG = process.env.TAG || 'ipad';
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['jiyu', 'shiho', 'hinkou', 'mikka', 'ichinichi'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { browser, page, errors } = await openPage(FILE, { viewport: VP });
  await sleep(500); await page.click('#boot', { force: true }); await sleep(400);
  for (const id of ids) {
    if (await page.evaluate(() => document.body.dataset.state) !== 'title') { console.log('state?', await page.evaluate(() => document.body.dataset.state)); }
    await page.click('#nav [data-nav="はじめる"]', { force: true }); await sleep(400);
    await page.click(`.card[data-id=${id}]`, { force: true }); await sleep(600);
    await page.click('#nav [data-nav="しゅっぱつ！"]', { force: true });
    for (let i = 0; i < 600; i++) { const t = await page.evaluate(() => World._debug().intro); if (t < 0) break; await sleep(200); }
    // 頭のふりむき（ゲーム内で0.9秒）を待つ
    const t0 = await page.evaluate(() => World._debug().time);
    for (let i = 0; i < 300; i++) { const t = await page.evaluate(() => World._debug().time); if (t - t0 > 2.0) break; await sleep(200); }
    await page.screenshot({ path: OUT + `${TAG}_chase_${id}.png` });
    if (process.env.TOP) { await page.evaluate(() => World.setCamera(2)); await sleep(9000); await page.screenshot({ path: OUT + `${TAG}_top_${id}.png` }); }
    console.log(id, JSON.stringify(await page.evaluate(() => World._debug().me)));
    // タイトルへもどる
    await page.click('#home', { force: true }); await sleep(400); await page.click('#m-yes', { force: true }); await sleep(600);
    const st = await page.evaluate(() => document.body.dataset.state);
    if (st === 'quit') { await page.click('#nav [data-nav]', { force: true }).catch(() => {}); await sleep(600); }
    console.log('state', await page.evaluate(() => document.body.dataset.state));
  }
  console.log('errors', errors); await browser.close(); stopStatic(); process.exit(0);
})();
