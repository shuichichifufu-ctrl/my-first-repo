// 画面のスクリーンショット（1024x768 と 844x390）: node p3_ui_shots.js [file.html]
const { openPage, stopStatic } = require('./harness.js');
const { chromium } = require('playwright');
const FILE = process.argv[2] || process.env.E2E_FILE || '/home/user/my-first-repo/seecar/dist/seecar_v7dev.html';
const OUT = '/home/user/my-first-repo/seecar/test/shots/p3_ui_';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  for (const [vw, vh] of [[1024, 768], [844, 390]]) {
    const tag = vw + 'x' + vh + '_';
    const { page, errors } = await openPage(FILE, { browser, viewport: { width: vw, height: vh } });
    const shot = async (n) => { await sleep(350); await page.screenshot({ path: OUT + tag + n + '.png' }); };
    const nav = async (l) => { await page.click(`#nav [data-nav="${l}"]`, { force: true }); await sleep(300); };
    await sleep(600); await shot('01boot');
    await page.click('#boot', { force: true }); await sleep(400); await shot('02title');
    await nav('はじめる'); await shot('03how');
    await page.click('.howcard[data-kind=count]', { force: true }); await sleep(300); await shot('04who');
    await page.click('[data-who=cpu]', { force: true }); await sleep(300); await shot('05level');
    await page.click('.lvcard[data-level=normal]', { force: true }); await sleep(300);
    await page.click('.card[data-id=mikka]', { force: true }); await sleep(1200); await shot('06pick');
    await page.click('#back', { force: true }); await sleep(200); await page.click('#back', { force: true }); await sleep(200);
    await page.click('[data-who=net]', { force: true }); await sleep(300); await shot('07choice');
    await page.click('#back', { force: true }); await sleep(150); await page.click('#back', { force: true }); await sleep(150); await page.click('#back', { force: true }); await sleep(300);
    await nav('せってい'); await shot('08settings');
    await page.click('#back', { force: true }); await sleep(300);
    // プレイ（どっちが おおい？）。World.sonar が無ければ見た目確認用の仮を入れる
    await page.evaluate(() => {
      if (typeof World.sonar !== 'function') { window.__stub = true; World.sonar = () => ({ heading: 0.6, items: [{ dx: 3, dz: -4, dist: 5, depth: 3 }, { dx: -6, dz: 2, dist: 6.3, depth: 1 }, { dx: 1, dz: 8, dist: 8.1, depth: 0 }] }); }
    });
    await nav('はじめる'); await page.click('.howcard[data-kind=count]', { force: true }); await sleep(200);
    await page.click('[data-who=cpu]', { force: true }); await sleep(200); await page.click('.lvcard[data-level=easy]', { force: true }); await sleep(200);
    await page.click('.card[data-id=ie]', { force: true }); await sleep(1500); await shot('09pick_illust');
    await nav('しゅっぱつ！'); await sleep(5500); await shot('10play_count');
    await page.evaluate(() => App._setTime(29)); await sleep(1300); await shot('11play_count_low');
    await page.click('#home', { force: true }); await sleep(300); await shot('12modal'); await page.click('#m-no', { force: true }); await sleep(300);
    await page.evaluate(() => App._finish()); await sleep(900); await shot('13ending_count');
    await nav('おわる'); await shot('14quit'); await nav('はじめから'); await sleep(300);
    // ひとり／はやい
    await nav('はじめる'); await page.click('.howcard[data-kind=solo]', { force: true }); await sleep(200);
    await page.click('.card[data-id=mikka]', { force: true }); await sleep(1200); await nav('しゅっぱつ！'); await sleep(5500); await shot('15play_solo');
    await page.evaluate(() => App._found(0)); await sleep(900); await shot('16ending_solo');
    await nav('もういちど'); await page.click('.card[data-id=mikka]', { force: true }); await sleep(1200);
    await page.click('#back', { force: true }); await sleep(200);
    await page.click('.howcard[data-kind=race]', { force: true }); await page.click('[data-who=cpu]', { force: true }); await sleep(200);
    await page.click('.lvcard[data-level=hard]', { force: true }); await sleep(200); await page.click('.card[data-id=mikka]', { force: true }); await sleep(1200);
    await nav('しゅっぱつ！'); await sleep(2500); await page.evaluate(() => App._found(1)); await sleep(900); await shot('17ending_race_cpu');
    console.log(tag, 'errors', errors.slice(0, 4));
    await page.context().close();
  }
  await browser.close(); stopStatic(); process.exit(0);
})();
