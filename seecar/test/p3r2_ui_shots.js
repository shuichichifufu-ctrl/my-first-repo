// 第3期 ラウンド2：ソナーの矢印・点・真上、開始時の説明文  node p3r2_ui_shots.js <file.html>
const { openPage, stopStatic } = require('./harness.js');
const { chromium } = require('playwright');
const FILE = process.argv[2] || process.env.E2E_FILE;
const OUT = '/home/user/my-first-repo/seecar/test/shots/p3r2_ui_';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  for (const [vw, vh] of [[1024, 768], [844, 390]]) {
    const tag = vw + 'x' + vh + '_';
    const { page, errors } = await openPage(FILE, { browser, viewport: { width: vw, height: vh } });
    const nav = async (l) => { await page.click(`#nav [data-nav="${l}"]`, { force: true }); await sleep(300); };
    await sleep(600); await page.click('#boot', { force: true }); await sleep(400);
    await nav('はじめる'); await page.click('.howcard[data-kind=solo]', { force: true }); await sleep(300);
    await page.click('.card[data-id=mikka]', { force: true }); await sleep(1200);
    await nav('しゅっぱつ！'); await sleep(1800);
    await page.screenshot({ path: OUT + tag + 'start_tip.png' });
    await page.screenshot({ path: OUT + tag + 'sonar_arrow.png', clip: await page.evaluate(() => { const r = document.getElementById('sonar').getBoundingClientRect(); return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: r.width + 16, height: r.height + 16 }; }) });
    const info = await page.evaluate(() => { const r = document.getElementById('tip').getBoundingClientRect(); const o = {}; ['b-attack', 'b-dj', 'b-jump', 'fwd'].forEach((i) => { const b = document.getElementById(i).getBoundingClientRect(); o[i] = [b.left | 0, b.top | 0, b.right | 0, b.bottom | 0]; }); return { tip: [r.left | 0, r.top | 0, r.right | 0, r.bottom | 0], o, s: World.sonar(200) }; });
    console.log(tag, JSON.stringify(info));
    const sr = await page.evaluate(() => { const r = document.getElementById('sonar').getBoundingClientRect(); return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: r.width + 16, height: r.height + 16 }; });
    const crop = sr;
    const stub = async (items, name) => {
      await page.evaluate((it) => { if (!window.__so) window.__so = World.sonar; World.sonar = () => ({ heading: 0, items: it }); }, items);
      await sleep(250); await page.screenshot({ path: OUT + tag + name + '.png', clip: crop });
    };
    await stub([{ dx: 0, dz: -5, dist: 5, depth: 3 }], 'sonar_dot');
    await stub([{ dx: 0.3, dz: -0.4, dist: 0.5, depth: 3 }], 'sonar_ontop');
    await stub([{ dx: 14, dz: -14, dist: 19.8, depth: 3 }], 'sonar_arrow_mid');
    await stub([{ dx: -60, dz: 40, dist: 72, depth: 3 }], 'sonar_arrow_far');
    console.log(tag, 'errors', errors.length, errors.slice(0, 3));
    await page.close();
  }
  await browser.close(); stopStatic && stopStatic();
})();
