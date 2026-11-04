// 獲得宣言のカメラ（宝石とシーカーがカードに隠れないか）と 4:3 のプレイ画面を、本物の画面で撮って数で確かめる。
//   python seecar/build.py v9fix2_w && cd seecar/test && node world4_awardshot.js [ビルド名=v9fix2_w]
// 宣言のカード：ステージの y 33.5〜58.5%・x 18〜82%。宝石は y 12〜30%、シーカーはカードの下（頭 y>60%）か横に入れば OK。
const { openPage } = require('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/harness.js');
const VER = process.argv[2] || 'v9fix2_w';
const FILE = `C:/Users/s9h0u/.claude/my-first-repo/seecar/dist/seecar_${VER}.html`;
const OUT = 'C:/Users/s9h0u/.claude/my-first-repo/seecar/test/shots/v9/award_';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, info = '') => { if (!cond) fails++; console.log((cond ? 'OK  ' : 'NG  ') + name + (info ? '  ' + info : '')); };

async function toPlay(page, mapIndex) {
  const tap = async (sel) => { await page.locator(sel).first().click({ force: true }); await sleep(350); };
  await sleep(1200);
  await tap('#bootbtn'); await sleep(500);
  await tap('#nav .nbtn.hero'); await tap('.howcard[data-kind=race]'); await tap('[data-who=cpu]'); await tap('.lvcard[data-level=easy]');
  await page.locator('#cards .card:not(.file)').nth(mapIndex).click({ force: true }); await sleep(1200);
  await tap('#nav .nbtn');
  await sleep(4600); // カウントダウン（3・2・1・GO!）
}
// 宝のとなりの低いマス（なければ宝のマスの上）へ置いて、掘る
async function digGem(page, how) {
  const g = await page.evaluate((how) => {
    World._setCpuPose && World._setCpuPose(1.5, 1.5, 0); // CPU は遠くへ（先に取られないように）
    const t = World._debug().treasures[0];
    const DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];
    if (how === 'attack') for (let d = 0; d < 4; d++) {
      const x = t.x + DX[d], z = t.z + DZ[d];
      if (World._debug(x, z).h <= 1) {
        const wx = x + 0.5, wz = z + 0.5, dx = t.x + 0.5 - wx, dz = t.z + 0.5 - wz;
        World._setPose(wx, wz, Math.atan2(-dx, -dz));
        return { t, from: [x, z], how };
      }
    }
    World._setPose(t.x + 0.5, t.z + 0.5, 0); // 宝のマスの上（ジャンプドリル）
    return { t, from: [t.x, t.z], how: 'jd' };
  }, how);
  await sleep(300);
  const b = await page.locator(g.how === 'attack' ? '#b-attack' : '#b-jd').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  let ann = false;
  for (let i = 0; i < 60; i++) { await sleep(100); const ii = await page.evaluate(() => App._info()); if (ii.phase === 'announce') { ann = true; break; } }
  await page.mouse.up();
  return { g, ann };
}

(async () => {
  const SIZES = (process.argv[3] || '1280x720,1024x768').split(',').map(s => s.split('x').map(Number));
  for (const [vw, vh] of SIZES) for (const [mi, how] of [[1, 'attack'], [3, 'jd'], [5, 'attack']]) {
    const { browser, page, errors } = await openPage(FILE, { viewport: { width: vw, height: vh } });
    await toPlay(page, mi);
    const tag = `${vw}x${vh}_m${mi}_${how}`;
    if (how === 'attack' && mi === 1) await page.screenshot({ path: OUT + tag + '_play.png' });
    const { g, ann } = await digGem(page, how);
    const p0 = await page.evaluate(() => [App._info().phase, World._stagePos(0)]);
    let p = null;
    for (let i = 0; i < 25; i++) { p = await page.evaluate(() => World._stagePos(0)); if (!p || p.gemCamK >= 0.97) break; await sleep(80); }
    console.log('    at announce', JSON.stringify(p0));
    await page.screenshot({ path: OUT + tag + '.png' });
    const gemOk = p && p.gem && p.gem[1] >= 10 && p.gem[1] <= 32 && p.gem[0] > 15 && p.gem[0] < 85;
    const seekOk = p && (p.head[1] > 59.5 || p.head[0] < 17 || p.head[0] > 83) && p.feet[1] < 97;
    ok(`${tag}: announce`, ann, JSON.stringify(g.from) + ' gemH=' + g.t.h);
    ok(`${tag}: 宝石が上のほう（y 10〜32%）`, gemOk, JSON.stringify(p));
    ok(`${tag}: シーカーがカードの下か横`, seekOk);
    const errs = errors.filter(e => !/404/.test(e));
    ok(`${tag}: JS エラーなし`, errs.length === 0, errs.join(' | '));
    await browser.close();
  }
  console.log(fails ? `NG ${fails}` : 'ALL OK');
  process.exit(0);
})();
