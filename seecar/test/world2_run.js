// 第2期 world.js の確認: node test/world2_run.js
// 降りる段差・大砲（手前の1マスから1つ）・CPU戦（3つの難しさ）・swipeTurn/nudgePitch・コンソールエラー
// world_test.html（makeTestMap が入っている）を土台に、地図は page.evaluate で読み直す。
// 作業環境のブラウザは遅いので、時間の比べはゲーム内時間（World._debug().time / cpu.time）で行う。
const { openPage, stopStatic } = require('/home/user/my-first-repo/seecar/test/harness.js');
const SHOT = '/home/user/my-first-repo/seecar/test/shots/p2_world_';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, info = '') => { if (!cond) fails++; console.log((cond ? 'OK  ' : 'NG  ') + name + (info ? '  ' + info : '')); };

(async () => {
  const { browser, page, errors } = await openPage('/home/user/my-first-repo/seecar/test/world_test.html', { viewport: { width: 1024, height: 576 } });
  const dbg = (x, z) => page.evaluate(([x, z]) => World._debug(x, z), [x, z]);
  const until = async (fn, ms = 20000, step = 100) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn)) return true; await wait(step); } return false; };
  const press = async (a) => { await page.evaluate((a) => World.press(a, true), a); await wait(30); await page.evaluate((a) => World.press(a, false), a); };
  const idle = () => until(() => { const d = World._debug(); return d.projectiles === 0 && !window.__busy(); }, 8000);
  await wait(1000);

  // 小さな検査用の地図を作る道具（白い紙・高さ0）
  await page.evaluate(() => {
    window.flatMap = function (W, H) {
      const heights = new Uint8Array(W * H), colors = new Uint8Array(W * H * 3).fill(250);
      const m = { w: W, h: H, heights, colors, treasure: { x: W - 2, z: H - 2 }, starts: [{ x: 2, z: 2, dir: 1 }, { x: 2, z: 4, dir: 1 }], title: 't', reading: 't', picture: '' };
      m.set = (x, z, h, rgb) => { const i = z * W + x; heights[i] = h; rgb = rgb || (h >= 10 ? [18, 18, 22] : [229, 57, 53]); colors[i * 3] = rgb[0]; colors[i * 3 + 1] = rgb[1]; colors[i * 3 + 2] = rgb[2]; };
      return m;
    };
    window.loadFlat = function (m, st, opts) {
      m.starts[0] = st; window.events = { found: [], boom: [], fire: [], state: 0 };
      World.load(m, Object.assign({ myIndex: 0, players: [{ color: '#e53935' }, { color: '#1e88e5' }], net: false }, opts || {}));
      World.setCamera(0); World.setCamera(1); // 開始演出を飛ばす
    };
    World.on('fire', (f) => events.fire.push(f));
    // 動きの途中か（確認用）：位置が整数で止まっているか
    window.__busy = () => { const d = World._debug(); return Math.abs(d.me.x - d.me.cx) > 1e-6 || Math.abs(d.me.z - d.me.cz) > 1e-6; };
  });

  // ---------- 1. 降りる段差・登る段差 ----------
  await page.evaluate(() => {
    const m = flatMap(16, 16);
    m.set(5, 8, 10); m.set(4, 8, 10); m.set(7, 8, 2); // 壁の上(5,8) → 床(6,8) → 高さ2(7,8)
    m.set(6, 11, 1); m.set(7, 11, 2); m.set(8, 11, 3); // 階段（1段ずつ）
    m.set(6, 13, 4); // 高さ4の上から 3段以上（4→0）を降りる用にも使う
    window.mDrop = m; loadFlat(m, { x: 5, z: 8, dir: 1 });
  });
  await until(() => World._debug().blend >= 1, 8000); await wait(300);
  await press('fwd');
  // 降りている途中（空中）を撮る
  await until(() => { const d = World._debug(); return d.me.x > 5.45; }, 5000, 20);
  const mid = await dbg();
  await page.screenshot({ path: SHOT + 'drop_mid.png' });
  await idle();
  let d = await dbg();
  ok('高さ10の壁の上から床へ降りられる（10段）', d.me.cx === 6 && d.me.cz === 8, `cx=${d.me.cx} midY=${mid.me.y.toFixed(2)}`);
  ok('降りる途中の高さは間の値（滑らか）', mid.me.y > 0.05 && mid.me.y < 1.8, `y=${mid.me.y.toFixed(2)}`);
  await press('fwd'); await wait(800); await idle();
  d = await dbg();
  ok('高さ0から高さ2へは登れない（2段）', d.me.cx === 6, `cx=${d.me.cx}`);
  await page.evaluate(() => loadFlat(mDrop, { x: 5, z: 11, dir: 1 }));
  for (let k = 0; k < 3; k++) { await press('fwd'); await wait(300); await idle(); }
  d = await dbg();
  ok('1段ずつなら登れる（0→1→2→3）', d.me.cx === 8 && d.me.cz === 11, `cx=${d.me.cx}`);
  await page.evaluate(() => loadFlat(mDrop, { x: 6, z: 13, dir: 1 }));
  await press('fwd'); await wait(300); await idle();
  d = await dbg();
  ok('高さ4から0へ（4段）降りられる', d.me.cx === 7, `cx=${d.me.cx}`);
  await press('back'); await wait(600); await idle();
  d = await dbg();
  ok('うしろでも4段は登れない', d.me.cx === 7, `cx=${d.me.cx}`);

  // ---------- 2. 大砲 ----------
  const shoot = async () => {
    const n0 = await page.evaluate(() => events.boom.length);
    await press('fire');
    await until(() => events.boom.length > 0 && World._debug().projectiles === 0, 8000);
    await wait(100);
    return page.evaluate((n0) => ({ boom: events.boom.slice(n0), fire: events.fire[events.fire.length - 1] }), n0);
  };
  await page.evaluate(() => {
    const m = flatMap(16, 16);
    m.set(4, 3, 3); m.set(5, 3, 10); // A: 1マス先に高さ3、2マス先に壁
    m.set(5, 6, 5); m.set(6, 6, 10); // B: 1マス先は空、2マス先に高さ5、3マス先に壁
    m.set(6, 9, 10);                 // C: 1・2マス先とも空、3マス先に壁
    m.set(4, 12, 1);                 // D: 1マス先に高さ1（床に塗った色でもブロック扱い）
    window.mGun = m; loadFlat(m, { x: 3, z: 3, dir: 1 });
  });
  await wait(500);
  let r = await shoot();
  let h = { a1: (await dbg(4, 3)).h, a2: (await dbg(5, 3)).h };
  ok('A：1マス先にブロック → それだけ壊す', h.a1 === 0 && h.a2 === 10 && JSON.stringify(r.boom[0]) === '[[4,3]]' && JSON.stringify(r.fire.cells) === '[[4,3]]', JSON.stringify({ h, boom: r.boom, fire: r.fire }));
  await page.evaluate(() => loadFlat(mGun, { x: 3, z: 6, dir: 1 })); await wait(300);
  r = await shoot();
  h = { b1: (await dbg(4, 6)).h, b2: (await dbg(5, 6)).h, b3: (await dbg(6, 6)).h };
  ok('B：1マス先が空 → 2マス先を壊す（3マス先は残る）', h.b2 === 0 && h.b3 === 10 && JSON.stringify(r.boom[0]) === '[[5,6]]', JSON.stringify({ h, boom: r.boom }));
  await page.screenshot({ path: SHOT + 'boom.png' });
  await page.evaluate(() => loadFlat(mGun, { x: 3, z: 9, dir: 1 })); await wait(300);
  r = await shoot();
  h = { c3: (await dbg(6, 9)).h };
  ok('C：1・2マス先とも空 → 何も壊さない（boom は空配列）', h.c3 === 10 && JSON.stringify(r.boom[0]) === '[]' && r.fire.cells.length === 0, JSON.stringify({ h, boom: r.boom, fire: r.fire }));
  await page.evaluate(() => loadFlat(mGun, { x: 3, z: 12, dir: 1 })); await wait(300);
  r = await shoot();
  ok('D：高さ1のマスもブロックとして壊す', (await dbg(4, 12)).h === 0 && JSON.stringify(r.boom[0]) === '[[4,12]]', JSON.stringify(r.boom));
  // 通信での再現：同じ cells/from で、相手の画面でも同じマスだけ壊れる
  await page.evaluate(() => loadFlat(mGun, { x: 10, z: 14, dir: 0 })); await wait(300);
  await page.evaluate(() => { window.events.boom = []; World.applyRemoteBoom([[5, 6]], { x: 3, z: 6, dir: 1 }); World.applyRemoteBoom([], { x: 3, z: 9, dir: 1 }); });
  await until(() => events.boom.length >= 2, 8000);
  const rb = await page.evaluate(() => events.boom);
  ok('applyRemoteBoom：弾を飛ばして指定の1マスだけ壊す・空なら何も壊さない', (await dbg(5, 6)).h === 0 && (await dbg(6, 6)).h === 10 && (await dbg(6, 9)).h === 10 && rb.length === 2, JSON.stringify(rb));
  await page.evaluate(() => World.applyRemoteBoom([[4, 3]])); // from なし：すぐ壊す
  ok('applyRemoteBoom（from なし）：すぐ壊す', (await dbg(4, 3)).h === 0);

  // ---------- 3. swipeTurn / nudgePitch ----------
  await page.evaluate(() => loadFlat(mGun, { x: 8, z: 8, dir: 0 })); await wait(300);
  await page.evaluate(() => World.swipeTurn(1)); await wait(500); await idle();
  d = await dbg(); ok('swipeTurn(+1) で右へ90度', d.me.dir === 1, `dir=${d.me.dir}`);
  await page.evaluate(() => World.swipeTurn(-1)); await wait(500); await idle();
  await page.evaluate(() => World.swipeTurn(-1)); await wait(500); await idle();
  d = await dbg(); ok('swipeTurn(-1) を2回で左へ180度ぶん', d.me.dir === 3, `dir=${d.me.dir}`);
  await page.evaluate(() => { World.nudgePitch(0.6); World.nudgePitch(0.6); });
  let p1 = (await dbg()).pitch;
  await wait(1500);
  await page.screenshot({ path: SHOT + 'pitch_up.png' });
  await page.evaluate(() => { World.nudgePitch(-5); World.nudgePitch(-1); World.nudgePitch(-1); });
  let p2 = (await dbg()).pitch;
  await wait(1500);
  await page.screenshot({ path: SHOT + 'pitch_down.png' });
  await page.evaluate(() => World.resetPitch());
  let p3 = (await dbg()).pitch;
  ok('nudgePitch は -1〜+1 に収まる・resetPitch で0', p1 === 1 && p2 === -1 && p3 === 0, `${p1} ${p2} ${p3}`);
  await page.evaluate(() => World.setCamera(0)); await wait(400);
  await page.evaluate(() => World.nudgePitch(1)); await wait(1500);
  await page.screenshot({ path: SHOT + 'pitch_first_up.png' });
  await page.evaluate(() => { World.resetPitch(); World.setCamera(1); });

  // ---------- 4. 止まっていても砲塔は前を向いたまま ----------
  await page.evaluate(() => { window.events.boom = []; loadFlat(window.testMap, { x: 20, z: 30, dir: 0 }); });
  await wait(4000);
  await page.screenshot({ path: SHOT + 'idle_chase.png' });

  // ---------- 5. カーキ色の高い積み木を残さない ----------
  await page.evaluate(() => {
    const m = flatMap(24, 16);
    // 黒い字のふち：高さ9・8・7 でも平均色はカーキや灰色に出る
    const khaki = [[150, 140, 90], [170, 160, 110], [120, 115, 90], [140, 140, 140], [200, 190, 140]];
    for (let x = 6; x < 18; x++) { m.set(x, 4, 10); m.set(x, 5, 9, khaki[x % 5]); m.set(x, 6, 8, khaki[(x + 1) % 5]); m.set(x, 7, 6, khaki[(x + 2) % 5]); }
    // ふつうの色の積み木はそのまま色で
    m.set(8, 9, 4, [229, 57, 53]); m.set(10, 9, 5, [253, 216, 53]); m.set(12, 9, 3, [30, 136, 229]); m.set(14, 9, 6, [67, 160, 71]);
    loadFlat(m, { x: 12, z: 13, dir: 0 });
  });
  await wait(2500);
  await page.screenshot({ path: SHOT + 'khaki.png' });

  // ---------- 6. CPU戦 ----------
  // 既定の地図に相当する地図：makeTestMap(64,64)。宝は壁で囲まれた小部屋（入口なし）の中。CPUのスタートは (26,38)
  const results = {};
  for (const level of ['easy', 'normal', 'hard']) {
    await page.evaluate((level) => {
      window.events = { found: [], boom: [], fire: [], state: 0 };
      World.load(window.testMap, { myIndex: 0, players: [{ color: '#e53935' }, { color: '#1e88e5' }], net: false, cpu: { level } });
      window.__trail = [];
    }, level);
    const t0 = (await dbg()).time;
    let shotDone = false, cells = new Set(), last = '', sameFor = 0, maxSame = 0;
    const tReal = Date.now();
    while (Date.now() - tReal < 240000) {
      const s = await page.evaluate(() => ({ d: World._debug(), f: events.found.slice(), b: events.boom.length }));
      const key = s.d.cpu.cx + ',' + s.d.cpu.cz;
      cells.add(key);
      if (key === last) { sameFor++; maxSame = Math.max(maxSame, sameFor); } else sameFor = 0;
      last = key;
      if (!shotDone && level === 'normal' && s.b > 0) { shotDone = true; await page.screenshot({ path: SHOT + 'cpu_boom.png' }); }
      if (level === 'hard' && s.d.time - t0 > 6 && s.d.time - t0 < 6.6) await page.screenshot({ path: SHOT + 'cpu_chase.png' });
      if (s.f.length) break;
      await wait(150);
    }
    const s = await page.evaluate(() => ({ d: World._debug(), f: events.found.slice(), b: events.boom.length }));
    results[level] = { found: s.f, gameTime: +(s.d.time - t0).toFixed(1), cpuTime: +s.d.cpu.time.toFixed(1), steps: s.d.cpu.steps, booms: s.b, cells: cells.size, at: [s.d.cpu.cx, s.d.cpu.cz] };
    ok(`CPU（${level}）が宝に着いて found(1)`, s.f.length === 1 && s.f[0] === 1 && s.d.cpu.cx === 34 && s.d.cpu.cz === 12, JSON.stringify(results[level]));
    ok(`CPU（${level}）は大砲で壁を壊した`, s.b > 0, `boom=${s.b}`);
    if (level === 'easy') {
      // 見つけたあとは両方止まる：人が押しても動かない
      const before = await dbg();
      await press('fwd'); await wait(1200);
      const after = await dbg();
      ok('どちらかが見つけたら両方止まる（人も動かない）', before.me.cz === after.me.cz && after.found === true);
      await page.screenshot({ path: SHOT + 'cpu_found.png' });
    }
  }
  ok('難しさの順に着くまでの時間が短い（ゲーム内時間）', results.easy.cpuTime > results.normal.cpuTime && results.normal.cpuTime > results.hard.cpuTime, `easy ${results.easy.cpuTime}s / normal ${results.normal.cpuTime}s / hard ${results.hard.cpuTime}s`);

  // 人が先に着いたら found(0)、CPUはそこで止まる
  await page.evaluate(() => {
    const m = window.testMap; const m2 = Object.assign({}, m, { starts: [{ x: m.treasure.x, z: m.treasure.z + 2, dir: 0 }, m.starts[1]] });
    window.events = { found: [], boom: [], fire: [], state: 0 };
    World.load(m2, { myIndex: 0, players: [{ color: '#e53935' }, { color: '#1e88e5' }], net: false, cpu: { level: 'hard' } });
    World.setCamera(0); World.setCamera(1); // 開始演出を飛ばして、CPUを先に動かしはじめる
  });
  await until(() => World._debug().cpu.steps >= 3, 10000);
  await press('fwd'); await wait(400); await idle(); await press('fwd');
  await until(() => events.found.length > 0, 10000);
  const c1 = (await dbg()).cpu; await wait(3000); const c2 = (await dbg()).cpu;
  const f0 = await page.evaluate(() => events.found);
  ok('人が先に着いたら found(0)・CPUは止まる', JSON.stringify(f0) === '[0]' && c1.steps >= 3 && c1.cx === c2.cx && c1.cz === c2.cz && c1.steps === c2.steps, JSON.stringify({ f0, c1, c2 }));

  // CPUの戦車の顔（こちらを向いている青い戦車）
  await page.evaluate(() => {
    const m = window.testMap; const m2 = Object.assign({}, m, { starts: [{ x: 26, z: 35, dir: 2 }, { x: 26, z: 38, dir: 0 }] });
    window.events = { found: [], boom: [], fire: [], state: 0 };
    World.load(m2, { myIndex: 0, players: [{ color: '#e53935' }, { color: '#1e88e5' }], net: false, cpu: { level: 'easy' } });
  });
  await wait(3000); // 開始演出のとちゅう（CPUはまだ動かない）
  await page.evaluate(() => World.setCamera(0));
  await until(() => World._debug().blend >= 1, 8000);
  await page.screenshot({ path: SHOT + 'cpu_face.png' });
  await page.evaluate(() => World.setCamera(1));

  // そら視点（2台の戦車と宝）
  await page.evaluate(() => { window.events = { found: [], boom: [], fire: [], state: 0 }; World.load(window.testMap, { myIndex: 0, players: [{ color: '#e53935' }, { color: '#1e88e5' }], net: false, cpu: { level: 'normal' } }); });
  await wait(1500);
  await page.screenshot({ path: SHOT + 'intro_top.png' });

  // 停止・再開・通信モードで cpu を無視
  await page.evaluate(() => { World.stop(); World.init(document.getElementById('wrap')); World.load(window.testMap, { myIndex: 0, players: [{ color: '#e53935' }, { color: '#1e88e5' }], net: true, cpu: { level: 'hard' } }); World.start(); });
  await wait(800);
  ok('通信のときは cpu を使わない・stop→init→load で壊れない', (await dbg()).cpu === null);

  console.log('ERRORS', errors.length, errors.join('\n'));
  ok('コンソールエラー 0', errors.length === 0);
  console.log(fails ? `NG ${fails}件` : 'ALL OK');
  await browser.close(); stopStatic();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
