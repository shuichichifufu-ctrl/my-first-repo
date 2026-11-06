// 第5期 4a の確認：「すすむ」で まっすぐ画面の奥へ進むか（進んだ向き・モデルの前・カメラの向きの差）
// cd seecar/test && node world5_orient.js   （スクリーンショット test/shots/p5_orient_*.png）
const { openPage, stopStatic } = require('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/harness.js');
const SHOT = 'C:/Users/s9h0u/.claude/my-first-repo/seecar/test/shots/p5_orient_';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, info = '') => { if (!cond) fails++; console.log((cond ? 'OK  ' : 'NG  ') + name + (info ? '  ' + info : '')); };
const deg = (a, b) => { let d = Math.atan2(a[0], a[1]) - Math.atan2(b[0], b[1]); while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d * 180 / Math.PI); };

(async () => {
  const { browser, page, errors } = await openPage('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/world4_test.html', { viewport: { width: 1024, height: 576 } });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await wait(1200);
  await ev(() => World._manual(true));
  const E = Math.PI / 2;
  // 2秒「すすむ」を押して、最後の 1.5 秒の向きの差を見る（最初の 0.5 秒はカメラが戻る時間）
  async function drive(label, speed) {
    const o0 = await ev(() => World._orient());
    await ev(() => World.press('fwd', true));
    let worst = { dm: 0, dc: 0, mc: 0, early: 0 }, prev = o0, t = 0;
    for (let k = 0; k < 20; k++) {
      await ev(() => World._step(3, 1 / 30)); t += 0.1;
      const o = await ev(() => World._orient());
      const disp = [o.x - prev.x, o.z - prev.z]; prev = o;
      if (t <= 0.5 + 1e-6) worst.early = Math.max(worst.early, deg(o.heading, o.cam));
      if (t > 0.5) {
        worst.dm = Math.max(worst.dm, deg(disp, o.model));
        worst.dc = Math.max(worst.dc, deg(disp, o.cam));
        worst.mc = Math.max(worst.mc, deg(o.model, o.cam));
      }
    }
    const o1 = await ev(() => World._orient());
    const tot = [o1.x - o0.x, o1.z - o0.z];
    const r = { dist: Math.hypot(tot[0], tot[1]), dispVsModel: deg(tot, o1.model), dispVsCam: deg(tot, o1.cam), modelVsCam: deg(o1.model, o1.cam), dispVsHeading: deg(tot, o1.heading), camBearing: deg([o1.x - o1.camPos[0], o1.z - o1.camPos[2]], o1.heading), worst, orbitAtStart: o0.orbit };
    console.log(`  [${label}] ${JSON.stringify(r, (k, v) => typeof v === 'number' ? Math.round(v * 100) / 100 : v)}`);
    return r;
  }
  const check = (label, r) => ok(`${label}：進んだ向き・モデルの前・カメラの向きの差が 3° 以内`, r.dispVsModel <= 3 && r.dispVsCam <= 3 && r.modelVsCam <= 3 && r.worst.dm <= 3 && r.worst.dc <= 3 && r.worst.mc <= 3 && r.camBearing <= 3,
    `disp-model ${r.dispVsModel.toFixed(2)}° disp-cam ${r.dispVsCam.toFixed(2)}° model-cam ${r.modelVsCam.toFixed(2)}° (worst ${r.worst.dm.toFixed(2)}/${r.worst.dc.toFixed(2)}/${r.worst.mc.toFixed(2)}) カメラ→シーカーの向き ${r.camBearing.toFixed(2)}° 最初0.5秒のカメラのずれ最大 ${r.worst.early.toFixed(1)}°`);

  for (const H of [-E, 0, 0.6]) {
    await ev((H) => { const m = flatMap(80, 80, []); window.mBig = m; loadMap(m); World._setPose(20.5, 60.5, H); World._step(40); }, H);
    // A：止まったところから
    check(`A 止まった所から heading=${H.toFixed(2)}`, await drive('A', 'normal'));
    // B：止まって顔を見せる回りこみが出たあと
    await ev(() => { World.press('fwd', false); World._step(150); });
    const orb = await ev(() => World._cam().orbit);
    const r = await drive('B', 'normal');
    check(`B 回りこみ（orbitK=${orb.toFixed(2)}）のあと heading=${H.toFixed(2)}`, r);
    await ev(() => World.press('fwd', false));
  }
  // 見た目：おいかけで すすむ（実際の描画ループ・倍率1）
  await ev(() => { const m = MapGen.fromPreset('ie', { treasureCount: 1 }); loadMap(m, { search: 'sonar' }); World._step(10); World.press('fwd', true); World._step(30); });
  await wait(1500); await page.screenshot({ path: SHOT + 'chase_fwd.png' });
  await ev(() => { World.press('fwd', false); World._step(150); World.press('fwd', true); World._step(25); });
  await wait(1500); await page.screenshot({ path: SHOT + 'chase_after_orbit.png' });
  await ev(() => World.press('fwd', false));
  const errs = errors.filter((e) => !/404 \(Not Found\)/.test(e));
  ok('エラーなし', errs.length === 0, errs.slice(0, 5).join(' | '));
  console.log(fails ? `\n${fails} NG` : '\nALL OK');
  await browser.close(); stopStatic();
})();
