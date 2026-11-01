// world.js の確認: node test/world_run.js
const { openPage, stopStatic } = require('/home/user/my-first-repo/seecar/test/harness.js');
const SHOT = '/home/user/my-first-repo/seecar/test/shots/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { browser, page, errors } = await openPage('/home/user/my-first-repo/seecar/test/world_test.html');
  const log = (...a) => console.log(...a);
  const press = async (a, ms = 60) => { await page.evaluate((a) => World.press(a, true), a); await wait(ms); await page.evaluate((a) => World.press(a, false), a); };
  const dbg = (x, z) => page.evaluate(([x, z]) => World._debug(x, z), [x, z]);
  await wait(1200);

  // 斜め後ろ（初期モード1）
  await page.screenshot({ path: SHOT + 'world_cam1_chase.png' });
  log('start', JSON.stringify(await dbg()));

  // 前へ1マス
  await press('fwd'); await wait(500);
  let d = await dbg(); log('after fwd', d.me.cx, d.me.cz);
  // もう1マス → (20,28)。次は高さ4の積み木なのでぶつかる
  await press('fwd'); await wait(500);
  await press('fwd'); await wait(500);
  d = await dbg(); log('after bump', d.me.cx, d.me.cz, 'sfx', await page.evaluate(() => sfxLog.join(',')));

  // 戻って、撃つ: (20,30) から2マス先=(20,28) と (20,27)
  await press('back'); await wait(400); await press('back'); await wait(400);
  d = await dbg(); log('back to', d.me.cx, d.me.cz);
  log('h(20,27) before', (await dbg(20, 27)).h);
  await press('fire'); await wait(700);
  await page.screenshot({ path: SHOT + 'world_boom_chase.png' });
  await wait(250);
  await page.screenshot({ path: SHOT + 'world_boom_chase2.png' });
  log('h(20,27) after', (await dbg(20, 27)).h, 'boom events', JSON.stringify(await page.evaluate(() => events.boom)));
  // 連打（間隔制限の確認）
  for (let i = 0; i < 6; i++) await press('fire', 20);
  await wait(900);
  log('boom count after mash', await page.evaluate(() => events.boom.length));

  // 回転して右（東）を向き、もう一度撃つ（ぶつかり確認と破片）
  await press('right'); await wait(400);
  d = await dbg(); log('dir after right', d.me.dir);
  await press('left'); await wait(400);

  // 1人称
  await page.evaluate(() => World.setCamera(0)); await wait(3000);
  await page.screenshot({ path: SHOT + 'world_cam0_first.png' });
  // 補間の途中
  await page.evaluate(() => World.setCamera(2)); await wait(250);
  await page.screenshot({ path: SHOT + 'world_cam_blend.png' });
  await wait(3000);
  await page.screenshot({ path: SHOT + 'world_cam2_top.png' });
  log('cycle ->', await page.evaluate(() => World.cycleCamera()));
  await wait(1200);

  // 相手の戦車
  await page.evaluate(() => World.setCamera(1)); await wait(2500);
  await page.evaluate(() => World.applyRemoteState(1, { x: 22, z: 29, dir: 2, color: '#1e88e5', anim: 'move' }));
  await wait(1500);
  await page.screenshot({ path: SHOT + 'world_remote_tank.png' });
  await page.evaluate(() => World.applyRemoteState(1, { x: 22, z: 29, dir: 2, color: '#1e88e5', anim: 'fire' }));
  await page.evaluate(() => World.applyRemoteBoom([[23, 27], [24, 27]]));
  await wait(900);
  await page.screenshot({ path: SHOT + 'world_remote_boom.png' });
  log('remote boom h(24,27)', (await dbg(24, 27)).h, 'boom events still', await page.evaluate(() => events.boom.length));
  log('remotes', JSON.stringify((await dbg()).remotes));

  // 一時停止
  await page.evaluate(() => World.setPaused(true));
  const before = await dbg();
  await press('fwd'); await wait(500);
  const after = await dbg();
  log('paused', await page.evaluate(() => World.isPaused), 'moved?', before.me.cz !== after.me.cz);
  await page.evaluate(() => World.setPaused(false));

  // 宝へ瞬間移動させず、宝の部屋の壁を壊して入る代わりに、宝の隣から入るテスト地図を読み直す
  await page.evaluate(() => {
    const m = window.testMap; m.starts[0] = { x: m.treasure.x, z: m.treasure.z + 2, dir: 0 };
    World.load(m, { myIndex: 0, players: [{ color: '#e53935' }, { color: '#1e88e5' }], net: false });
  });
  await page.evaluate(() => World.setCamera(1));
  await wait(600);
  await press('fwd'); await wait(400); await press('fwd'); await wait(900);
  log('found events', JSON.stringify(await page.evaluate(() => events.found)));
  await page.screenshot({ path: SHOT + 'world_treasure.png' });

  const perf64 = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); function f() { if (++n < 30) requestAnimationFrame(f); else res((performance.now() - t0) / 30); } requestAnimationFrame(f); }));
  log('64 frame ms(swiftshader)', perf64.toFixed(1));
  // stop → init → load → start
  await page.evaluate(() => { World.stop(); World.init(document.getElementById('wrap')); World.load(window.testMap, { myIndex: 1, players: [{ color: '#e53935' }, { color: '#1e88e5' }], net: true }); World.start(); });
  await wait(800);
  log('restart ok', JSON.stringify((await dbg()).me), 'canvases', await page.evaluate(() => document.querySelectorAll('canvas').length));
  await page.screenshot({ path: SHOT + 'world_restart.png' });

  // 128×128 の重さ
  await page.evaluate(() => { World.stop(); World.init(document.getElementById('wrap')); const t0 = performance.now(); World.load(makeTestMap(128, 128), { myIndex: 0, players: [{ color: '#e53935' }, { color: '#1e88e5' }] }); window.loadMs = performance.now() - t0; World.start(); });
  await wait(1000);
  const perf = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); function f() { if (++n < 60) requestAnimationFrame(f); else res((performance.now() - t0) / 60); } requestAnimationFrame(f); }));
  const d128 = await dbg();
  log('128 load ms', await page.evaluate(() => loadMs), 'frame ms(swiftshader)', perf.toFixed(1), 'calls', d128.calls, 'tris', d128.tris);
  await page.evaluate(() => World.setCamera(2)); await wait(6000);
  await page.screenshot({ path: SHOT + 'world_128_top.png' });
  log('state events', await page.evaluate(() => events.state), JSON.stringify(await page.evaluate(() => window.lastState)));

  log('ERRORS', errors.length, errors.join('\n'));
  await browser.close(); stopStatic();
})().catch((e) => { console.error(e); process.exit(1); });
