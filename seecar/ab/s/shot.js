// おいかけ視点の撮影: node shot.js <tag> [preset ...]
const { openPage, stopStatic } = require('/home/user/my-first-repo/seecar/test/harness.js');
const tag = process.argv[2] || 'x';
const presets = process.argv.slice(3).length ? process.argv.slice(3) : ['jiyu','shiho','hinkou','mikka','ichinichi'];
const FILE = '/home/user/my-first-repo/seecar/ab/s/dist/seecar_v4s.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  for (const preset of presets) {
    const { browser, page, errors } = await openPage(FILE, { viewport: { width: 1024, height: 768 } });
    await sleep(500); await page.click('#boot', { force: true }); await sleep(400);
    await page.click('#nav [data-nav="はじめる"]', { force: true }); await sleep(400);
    await page.click(`.card[data-id=${preset}]`, { force: true }); await sleep(600);
    await page.click('#nav [data-nav="しゅっぱつ！"]', { force: true });
    for (let i = 0; i < 400; i++) { const t = await page.evaluate(() => World._debug().intro); if (t < 0) break; await sleep(200); }
    await sleep(2500);
    await page.screenshot({ path: `/home/user/my-first-repo/seecar/ab/s/shots/${tag}_${preset}_chase.png` });
    if (process.env.TOP) { await page.evaluate(() => World.setCamera(2)); await sleep(3000); await page.screenshot({ path: `/home/user/my-first-repo/seecar/ab/s/shots/${tag}_${preset}_top.png` }); }
    console.log(preset, 'errors', errors);
    await browser.close();
  }
  stopStatic(); process.exit(0);
})();
