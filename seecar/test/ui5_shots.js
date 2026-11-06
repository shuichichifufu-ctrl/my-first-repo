// v10 UI の画面写真（deviceScaleFactor 1）：タイトル・せってい・ちずえらび を 16:9（1280×720）と 4:3（1024×768）で
// 使い方: node ui5_shots.js [file.html]   → test/shots/v10/
const path = require('path');
const { openPage } = require('./harness.js');
const FILE = process.argv[2] || path.join(__dirname, 'v10', 'seecar_v10t.html');
const SH = path.join(__dirname, 'shots', 'v10');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let browser = null;
  for (const vp of [{ width: 1280, height: 720, tag: '169' }, { width: 1024, height: 768, tag: '43' }]) {
    const o = await openPage(FILE, { viewport: { width: vp.width, height: vp.height }, browser });
    browser = o.browser; const p = o.page;
    await p.waitForFunction(() => !document.getElementById('bootbtn').disabled, null, { timeout: 10000 });
    await p.click('#bootbtn', { force: true }); await sleep(900);
    await p.screenshot({ path: path.join(SH, `title_${vp.tag}.png`) });
    await p.click('#gear', { force: true }); await sleep(600);
    await p.screenshot({ path: path.join(SH, `settings_${vp.tag}.png`) });
    await p.click('#back', { force: true }); await sleep(400);
    await p.click('#nav [data-nav="はじめる"]', { force: true }); await sleep(400);
    await p.click('.howcard[data-kind=solo]', { force: true }); await sleep(600);
    await p.screenshot({ path: path.join(SH, `pick_${vp.tag}.png`) });
    for (const k of ['kotowaza', 'eigo', 'illust']) {
      const t = await p.$(`.mtab[data-tab=${k}]`); if (!t) continue;
      await t.click({ force: true }); await sleep(400);
      if (k === 'eigo') { await p.click('.mrow.on .card', { force: true }); await sleep(1800); }
      await p.screenshot({ path: path.join(SH, `pick_${k}_${vp.tag}.png`) });
    }
    console.log(vp.tag, o.errors);
    await o.context.close();
  }
  await browser.close();
  process.exit(0);
})();
