// v9 プレイ画面の3D（ジオラマ化）・獲得時のカメラの確認: node worldfix_shots.js [file] [tag] [WxH] [mapIndex]
const { openPage } = require('../harness.js');
const path = require('path');
const FILE = process.argv[2] || path.join(__dirname, '..', '..', 'dist', 'seecar_v9fix_w.html');
const TAG = process.argv[3] || 'w';
const [VW, VH] = (process.argv[4] || '1280x720').split('x').map(Number);
const MAPI = +(process.argv[5] || 0);
const OUT = path.join(__dirname, '..', 'shots', 'v9fix_w');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const { browser, page, errors } = await openPage(FILE, { viewport: { width: VW, height: VH } });
  const shot = async (n) => { await page.screenshot({ path: path.join(OUT, `${TAG}_${VW}x${VH}_m${MAPI}_${n}.png`) }); };
  const click = async (sel, ms = 350) => { await page.click(sel, { force: true }); await sleep(ms); };
  await sleep(1500);
  await click('#bootbtn', 700);
  await click('#nav [data-nav="はじめる"]');
  await click('.howcard[data-kind=solo]');
  const cards = await page.$$('.card[data-id]');
  await cards[Math.min(MAPI, cards.length - 1)].click({ force: true }); await sleep(1500);
  await click('#nav [data-nav="しゅっぱつ！"]', 600);
  await sleep(1200); await shot('01intro_top');
  await sleep(5200); await shot('02play_chase');
  await page.evaluate(() => { World.press('fwd', true); }); await sleep(1400);
  await page.evaluate(() => { World.press('fwd', false); }); await sleep(400); await shot('03play_chase_moved');
  await click('#cam', 1600); await shot('04sky');
  await click('#cam', 1600); await shot('05first');
  await click('#cam', 1600);
  // 宝石のとなりへ移して、獲得させる
  const info = await page.evaluate(() => {
    const d = World._debug(); const t = d.treasures[0];
    const E = Math.PI / 2, opts = [[0, 1, 0], [0, -1, Math.PI], [1, 0, E], [-1, 0, -E]]; // [dx,dz,heading toward gem]
    for (const [dx, dz, hd] of opts) {
      const x = t.x + dx, z = t.z + dz, q = World._debug(x, z);
      if (q && q.h <= 1) { World._setPose(x + 0.5, z + 0.5, hd); return { t, x, z, hd }; }
    }
    return { t, none: true };
  });
  console.log(JSON.stringify(info));
  await sleep(1200); await shot('06beside_gem');
  await page.evaluate(() => App._gemHit(0, 0));
  await sleep(500); await shot('07award_0_5s');
  await sleep(700); await shot('08award_1_2s');
  await sleep(1000); await shot('09award_2_2s');
  await sleep(900); await shot('10award_3_1s');
  console.log(errors.join('\n'));
  await browser.close(); process.exit(0);
})();
