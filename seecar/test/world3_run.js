// 第3期 world.js の確認: node test/world3_run.js
// 自由な向きの移動・高さの規則・ジャンプ・ドリルアタック・ドリルジャンプ・宝（土の山）・count モード・ソナー・CPU（3つの難しさ）・通信の再現・コンソールエラー
// 動きの確かめは World._step(n, dt)（確認用：ゲーム内時間を すぐに進める）で行う。作業環境のブラウザは描画が遅いため。
// スクリーンショットは実際の描画ループで撮る（test/shots/p3_world_*.png）。
const { openPage, stopStatic } = require('/home/user/my-first-repo/seecar/test/harness.js');
const SHOT = '/home/user/my-first-repo/seecar/test/shots/p3_world_';
const SHOT2 = '/home/user/my-first-repo/seecar/test/shots/p3r2_world_'; // 第3期 r2 の確認画像
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, info = '') => { if (!cond) fails++; console.log((cond ? 'OK  ' : 'NG  ') + name + (info ? '  ' + info : '')); };
const E = Math.PI / 2; // heading：0=北(-z)、-E=東(+x)、E=西、PI=南

(async () => {
  const { browser, page, errors } = await openPage('/home/user/my-first-repo/seecar/test/world3_test.html', { viewport: { width: 1024, height: 576 } });
  // World の中で飲みこまれた例外（console.warn 'World loop error' など）もエラーとして数える
  page.on('console', (m) => { if (m.type() === 'warning' && /World (loop|handler) error|SeekerModel\.update failed/.test(m.text())) errors.push('warn: ' + m.text()); });
  // 確認用の画像：_step で時間を進めて止めた場面を、描画が追いつくのを待ってから撮る（作業環境は描画が遅い）
  const snap = async (name) => { await wait(1500); await page.screenshot({ path: SHOT2 + name + '.png' }); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const dbg = (x, z) => ev(([x, z]) => World._debug(x, z), [x, z]);
  const step = (n, dt) => ev(([n, dt]) => World._step(n, dt), [n, dt || 1 / 30]);
  const hOf = async (x, z) => (await dbg(x, z)).h;
  // 実際の描画ループで、条件になったら止めて撮る（止めたら setPaused(false) で再開）
  const shotWhen = async (cond, name, ms = 30000) => {
    const got = await ev(([src, ms]) => new Promise((res) => {
      const f = new Function('d', 'return (' + src + ')'), t0 = performance.now();
      (function chk() { const d = World._debug(); if (f(d)) { World.setPaused(true); res(true); } else if (performance.now() - t0 > ms) res(false); else requestAnimationFrame(chk); })();
    }), [cond, ms]);
    if (got) { await wait(250); await page.screenshot({ path: SHOT + name + '.png' }); }
    await ev(() => World.setPaused(false));
    return got;
  };
  await wait(800);
  await ev(() => World._manual(true));

  await ev(() => {
    // 検査用の地図（白い紙・高さ0）。treasures を渡すと world.js が土の山（3×3、高さ3）をかぶせる
    window.flatMap = function (W, H, treasures) {
      const heights = new Uint8Array(W * H), colors = new Uint8Array(W * H * 3).fill(248);
      const m = { w: W, h: H, heights, colors, treasures: treasures || [], treasure: (treasures || [])[0], starts: [{ x: 2, z: 2, dir: 1 }, { x: 2, z: 4, dir: 1 }], title: 't', reading: 't', picture: '' };
      m.set = (x, z, h, rgb) => { const i = z * W + x; heights[i] = h; rgb = rgb || (h >= 10 ? [18, 18, 22] : [229, 57, 53]); colors[i * 3] = rgb[0]; colors[i * 3 + 1] = rgb[1]; colors[i * 3 + 2] = rgb[2]; };
      return m;
    };
    window.loadMap = function (m, opts) {
      resetEvents();
      World.load(m, Object.assign({ myIndex: 0, players: [{ color: '#e08524' }, { color: '#2f8be0' }], net: false, mode: 'solo' }, opts || {}));
      World.setCamera(0); World.setCamera(1); // 開始演出を飛ばす
      World._step(30);
    };
  });

  // ---------- 1. 高さの規則：登り1・降り自由 ----------
  await ev(() => {
    const m = flatMap(20, 30, [{ x: 17, z: 27 }]);
    m.set(5, 8, 1); m.set(6, 8, 2); m.set(7, 8, 3); m.set(8, 8, 5);        // 階段 0→1→2→3、その先 5（2段）
    m.set(5, 10, 2);                                                       // 0→2 は登れない
    m.set(3, 12, 10); m.set(4, 12, 10);                                    // 壁の上から降りる
    m.set(5, 14, 5); m.set(6, 14, 10);                                     // ジャンプで5段（その先は壁）
    m.set(5, 16, 6);                                                       // ジャンプで6段は無理
    m.set(5, 18, 10);                                                      // ドリルアタック（足元0）
    m.set(4, 20, 3); m.set(5, 20, 8);                                      // ドリルアタック（足元3 → 8 を 3 まで）
    m.set(4, 22, 3); m.set(5, 22, 4);                                      // ドリルジャンプ（足元を1段）
    m.set(5, 24, 3);                                                       // ドリルジャンプ＋すすむ（1マス前を1段）
    window.mRules = m; loadMap(m);
  });
  const run = async (x, z, heading, secs, opt = {}) => {
    await ev(([x, z, h]) => World._setPose(x, z, h), [x, z, heading]);
    await ev(() => World.press('fwd', true));
    if (opt.jump) { await step(3); await ev(() => { World.press('jump', true); World.press('jump', false); }); }
    await step(Math.round(secs * 30));
    await ev(() => World.press('fwd', false));
    await step(20);
    return (await dbg()).me;
  };
  let me = await run(4.5, 8.5, -E, 4);
  ok('登りは1段ずつ（0→1→2→3）、3→5 の2段は登れない', me.cx === 7 && me.lv === 3, `cx=${me.cx} lv=${me.lv} y=${me.y.toFixed(2)}`);
  me = await run(4.5, 10.5, -E, 2);
  ok('0→2 は登れない（壁にすべって止まる）', me.cx === 4 && me.lv === 0, `x=${me.x.toFixed(2)}`);
  me = await run(3.5, 12.5, -E, 2);
  ok('高さ10の壁の上から床へ降りられる（降りは自由）', me.cx >= 5 && me.lv === 0 && me.y === 0, `cx=${me.cx} y=${me.y}`);
  me = await run(4.5, 14.5, -E, 2, { jump: true });
  ok('前方ジャンプで5段に乗れる', me.cx === 5 && me.lv === 5, `cx=${me.cx} lv=${me.lv} y=${me.y.toFixed(2)}`);
  me = await run(4.5, 16.5, -E, 2, { jump: true });
  ok('ジャンプでも6段には乗れない', me.cx === 4 && me.lv === 0, `cx=${me.cx} lv=${me.lv}`);
  // ジャンプの高さと凹み：最高点・凹みの量・前方ジャンプの飛ぶ距離
  await ev(() => World._setPose(10.5, 4.5, -Math.PI / 2));
  await ev(() => { World.press('jump', true); World.press('jump', false); });
  let maxY = 0, maxSq = 0, airFrames = 0;
  for (let k = 0; k < 40; k++) { await step(1); const d = (await dbg()).me; maxY = Math.max(maxY, d.y); maxSq = Math.max(maxSq, d.squash); if (d.air) airFrames++; }
  ok('その場ジャンプ：凹んでから跳ぶ（最高 0.8〜0.95＝5段の見た目より少し上）', maxSq > 0.6 && maxY > 0.8 && maxY < 0.95, `squash=${maxSq.toFixed(2)} maxY=${maxY.toFixed(3)} 空中=${(airFrames / 30).toFixed(2)}秒`);
  // 遅い端末（1コマ0.05秒）でも5段まで届く
  await ev(() => { World._setPose(4.5, 14.5, -Math.PI / 2); World.press('fwd', true); World.press('jump', true); World.press('jump', false); });
  await step(40, 0.05); await ev(() => World.press('fwd', false)); await step(10, 0.05);
  me = (await dbg()).me;
  ok('1コマ0.05秒でも前方ジャンプで5段に乗れる', me.cx === 5 && me.lv === 5, `cx=${me.cx} lv=${me.lv}`);
  await ev(() => World._setPose(2.5, 6.5, -Math.PI / 2));
  await ev(() => World.press('fwd', true)); await step(8);
  const x0 = (await dbg()).me.x;
  await ev(() => { World.press('jump', true); World.press('jump', false); });
  let air = false, xs = 0, xe = 0;
  for (let k = 0; k < 40; k++) { await step(1); const d = (await dbg()).me; if (d.air && !air) xs = d.x; if (!d.air && air) { xe = d.x; break; } air = d.air; }
  await ev(() => World.press('fwd', false)); await step(10);
  ok('前方ジャンプ：空中でも前へ進む（1マス以上）', xe - xs > 1.0, `空中で ${(xe - xs).toFixed(2)} マス（走り出し ${x0.toFixed(2)}）`);

  // ---------- 2. ドリルアタック ----------
  await ev(() => { events.terrain = []; World._setPose(4.5, 18.5, -Math.PI / 2); World.press('drillAttack', true); World.press('drillAttack', false); });
  await step(30);
  let t = await ev(() => events.terrain);
  ok('ドリルアタック：正面の壁(10)を足元(0)まで下げる・terrain を出す', (await hOf(5, 18)) === 0 && JSON.stringify(t) === '[[[5,18,0]]]', JSON.stringify(t));
  await ev(() => { events.terrain = []; World._setPose(4.5, 20.5, -Math.PI / 2); World.press('drillAttack', true); World.press('drillAttack', false); });
  await step(30);
  t = await ev(() => events.terrain);
  ok('ドリルアタック：足元3なら正面の8を3まで', (await hOf(5, 20)) === 3 && JSON.stringify(t) === '[[[5,20,3]]]', JSON.stringify(t));
  await ev(() => { events.terrain = []; World._setPose(10.5, 20.5, -Math.PI / 2); World.press('drillAttack', true); World.press('drillAttack', false); });
  await step(30);
  ok('ドリルアタック：正面が低ければ空振り（terrain なし）', (await ev(() => events.terrain.length)) === 0);

  // ---------- 3. ドリルジャンプ ----------
  await ev(() => { events.terrain = []; events.action = []; World._setPose(4.5, 22.5, -Math.PI / 2); World.press('drillJump', true); World.press('drillJump', false); });
  let maxFlip = 0, phases = new Set();
  for (let k = 0; k < 80; k++) { await step(1); const d = (await dbg()).me; maxFlip = Math.max(maxFlip, d.flip); if (d.act) phases.add(d.act.split(':')[1]); if (!d.act && k > 5) break; }
  me = (await dbg()).me;
  t = await ev(() => events.terrain);
  ok('ドリルジャンプ：跳ぶ→逆さ→潜る→掘る→戻る で足元を1段下げる', (await hOf(4, 22)) === 2 && JSON.stringify(t) === '[[[4,22,2]]]' && maxFlip === 1 && ['flip', 'hang', 'dive', 'bore', 'pop'].every((p) => phases.has(p)) && me.flip === 0 && me.cx === 4, `${JSON.stringify(t)} phases=${[...phases]} flip=${maxFlip}`);
  await ev(() => { events.terrain = []; World._setPose(4.5, 24.5, -Math.PI / 2); World.press('fwd', true); World.press('drillJump', true); World.press('drillJump', false); });
  await step(2); await ev(() => World.press('fwd', false)); await step(80);
  me = (await dbg()).me; t = await ev(() => events.terrain);
  ok('ドリルジャンプ＋すすむ：1マス前（高さ3）を1段下げて、そこに乗る', (await hOf(5, 24)) === 2 && (await hOf(4, 24)) === 0 && me.cx === 5 && me.lv === 2, `${JSON.stringify(t)} cx=${me.cx} lv=${me.lv}`);
  ok("'action' イベント", (await ev(() => events.action)).join() === 'drillJump,drillJump', await ev(() => events.action.join()));
  // 連打：空中でジャンプ・ドリルを連打しても壊れない
  await ev(() => World._setPose(10.5, 10.5, 0));
  for (let k = 0; k < 12; k++) { await ev((k) => { const a = ['jump', 'drillJump', 'drillAttack'][k % 3]; World.press(a, true); World.press(a, false); World.swipeTurn(0.05); }, k); await step(2); }
  await step(90);
  me = (await dbg()).me;
  ok('連打してもふつうの状態に戻る', !me.act && !me.air && me.flip === 0 && Math.abs(me.y - 0) < 1e-3, JSON.stringify(me));

  // ---------- 4. swipeTurn ----------
  await ev(() => World._setPose(10.5, 10.5, 0));
  await ev(() => World.swipeTurn(0.25));
  let h1 = (await dbg()).me.heading;
  await ev(() => World.swipeTurn(-0.5));
  let h2 = (await dbg()).me.heading;
  ok('swipeTurn：+で右へ（なぞった量だけ）、-で左へ', Math.abs(h1 + Math.PI / 4) < 1e-6 && Math.abs(h2 - Math.PI / 4) < 1e-6, `${h1.toFixed(3)} ${h2.toFixed(3)}`);
  await ev(() => { World._setPose(10.5, 10.5, -Math.PI / 4); World.press('fwd', true); }); await step(15); await ev(() => World.press('fwd', false)); await step(5);
  me = (await dbg()).me;
  ok('ななめ（自由な向き）に進む', me.x > 11.2 && me.z < 9.8 && Math.abs((me.x - 10.5) + (me.z - 10.5)) < 0.05, `x=${me.x.toFixed(2)} z=${me.z.toFixed(2)}`);

  // ---------- 5. 宝：土の山を掘ると出てくる・拾う ----------
  await ev(() => { const m = flatMap(20, 20, [{ x: 10, z: 10 }]); loadMap(m, { mode: 'solo' }); World._setPose(7.5, 10.5, -Math.PI / 2); });
  let d = await dbg(9, 10);
  ok('土の山（3×3、高さ3）がかぶさり、宝は見えない', d.h === 3 && (await hOf(10, 10)) === 3 && (await hOf(11, 11)) === 3 && !d.treasures[0].revealed);
  let so = await ev(() => World.sonar(10));
  ok('sonar：宝の位置（相対）と深さ', so.items.length === 1 && so.items[0].dx === 3 && so.items[0].dz === 0 && so.items[0].depth === 3 && Math.abs(so.heading + E) < 1e-6, JSON.stringify(so));
  await ev(() => { World.press('fwd', true); }); await step(12); await ev(() => World.press('fwd', false)); await step(10);
  await ev(() => { World.press('drillAttack', true); World.press('drillAttack', false); }); await step(25);
  ok('手前の土を1マス掘った', (await hOf(9, 10)) === 0);
  await ev(() => { World.press('fwd', true); }); await step(20); await ev(() => World.press('fwd', false)); await step(10);
  await ev(() => { World._setPose(9.5, 10.5, -Math.PI / 2); World.press('drillAttack', true); World.press('drillAttack', false); }); await step(12);
  d = await dbg();
  ok('宝のマスが0になると宝石が出る', (await hOf(10, 10)) === 0 && d.treasures[0].revealed && !d.treasures[0].taken);
  so = await ev(() => World.sonar(10));
  ok('sonar：掘った宝は深さ0', so.items.length === 1 && so.items[0].depth === 0);
  await step(20);
  await ev(() => { World.press('fwd', true); }); await step(20); await ev(() => World.press('fwd', false)); await step(5);
  let c = await ev(() => ({ collect: events.collect, found: events.found, sc: World.scores(), over: World._debug().over, sonar: World.sonar(10).items.length }));
  ok("入ると拾う：collect(0,0,[1,0]) と found(0)、終わる、ソナーから消える", JSON.stringify(c.collect) === '[[0,0,[1,0]]]' && JSON.stringify(c.found) === '[0]' && c.over && c.sonar === 0, JSON.stringify(c));
  // 上からドリルジャンプで掘る（3回）
  await ev(() => { const m = flatMap(20, 20, [{ x: 10, z: 10 }]); loadMap(m, { mode: 'solo' }); World._setPose(10.5, 10.5, 0); });
  for (let k = 0; k < 3; k++) { await ev(() => { World.press('drillJump', true); World.press('drillJump', false); }); await step(80); }
  c = await ev(() => ({ collect: events.collect, h: World._debug(10, 10).h, ter: events.terrain }));
  ok('山の上でドリルジャンプ3回 → 宝が出て、そのまま拾う', c.h === 0 && c.collect.length === 1 && c.ter.length === 3, JSON.stringify(c));

  // ---------- 6. count モード：宝10個・sonar 半径10 ----------
  const T10 = [[5, 5], [12, 5], [20, 5], [28, 5], [5, 14], [16, 14], [28, 14], [5, 24], [16, 26], [28, 26]].map(([x, z]) => ({ x, z }));
  await ev((T10) => { const m = flatMap(34, 32, T10); m.starts[0] = { x: 16, z: 18, dir: 0 }; loadMap(m, { mode: 'count' }); }, T10);
  so = await ev(() => World.sonar(10));
  const me0 = (await dbg()).me;
  const expect = T10.filter((p) => Math.hypot(p.x + 0.5 - me0.x, p.z + 0.5 - me0.z) <= 10).length;
  ok('sonar(10)：半径10の宝だけ返す', so.items.length === expect && so.items.every((i) => i.dist <= 10 && i.depth === 3), `${so.items.length}/${expect} ` + JSON.stringify(so.items.map((i) => i.dist)));
  ok('count モード：宝10個', JSON.stringify(await ev(() => World.treasureInfo())) === '{"total":10,"left":10,"mode":"count"}');
  for (let k = 0; k < 10; k++) {
    await ev(([x, z]) => { World.applyRemoteTerrain([[x, z, 0]]); }, [T10[k].x, T10[k].z]);
    await step(15);
    await ev(([x, z]) => World._setPose(x + 0.5, z + 0.5, 0), [T10[k].x, T10[k].z]);
    await step(2);
    if (k === 4) { await ev(() => World.finish && 0); }
  }
  c = await ev(() => ({ n: events.collect.length, last: events.collect[events.collect.length - 1], found: events.found, done: events.done, sc: World.scores(), over: World._debug().over, ter: events.terrain.length }));
  ok('count モード：10個を数える（collect 10回、found は出ない、全部で done）', c.n === 10 && JSON.stringify(c.sc) === '[10,0]' && c.found.length === 0 && c.done.length === 1 && c.over && c.ter === 0, JSON.stringify(c));
  await ev((T10) => { const m = flatMap(34, 32, T10); m.starts[0] = { x: 16, z: 18, dir: 0 }; loadMap(m, { mode: 'count' }); World.applyRemoteTerrain([[5, 5, 0]]); }, T10);
  await step(15); await ev(() => World._setPose(5.5, 5.5, 0)); await step(2);
  c = await ev(() => ({ sc: World.finish(), over: World._debug().over }));
  await ev(() => { World.press('fwd', true); }); await step(20); await ev(() => World.press('fwd', false));
  ok('finish() で止まり、数を返す・押しても動かない', JSON.stringify(c.sc) === '[1,0]' && c.over && Math.abs((await dbg()).me.z - 5.5) < 1e-6, JSON.stringify(c));

  // ---------- 7. 通信の再現 ----------
  await ev(() => { const m = flatMap(20, 20, [{ x: 10, z: 10 }, { x: 15, z: 4 }]); m.starts[1] = { x: 4, z: 15, dir: 0 }; loadMap(m, { net: true, mode: 'count' }); });
  await ev(() => World.applyRemoteState(1, { x: 6, z: 15, y: 0.6, heading: 1.0, anim: 'drillJump', flip: 1, squash: 0, hatForward: 0, spin: 5, color: '#2f8be0' }));
  await step(60);
  d = await dbg();
  ok('applyRemoteState：位置・高さ・向き・逆さを再現', d.remotes.length === 1 && Math.abs(d.remotes[0].x - 6.5) < 0.05 && Math.abs(d.remotes[0].y - 0.6) < 0.05 && Math.abs(d.remotes[0].heading - 1) < 0.05 && d.remotes[0].flip > 0.95, JSON.stringify(d.remotes));
  await ev(() => { World.applyRemoteTerrain([[10, 10, 0], [9, 10, 1]]); });
  await step(20);
  c = await ev(() => ({ h: World._debug(10, 10).h, h2: World._debug(9, 10).h, ter: events.terrain.length, rev: World._debug().treasures[0].revealed }));
  ok('applyRemoteTerrain：地形を再現（terrain は出さない）・宝が出る', c.h === 0 && c.h2 === 1 && c.ter === 0 && c.rev, JSON.stringify(c));
  await ev(() => { World.applyRemoteCollect(1, 0); World.applyRemoteCollect(1, 0); });
  await step(10);
  c = await ev(() => ({ sc: World.scores(), col: events.collect.length, t: World._debug().treasures[0] }));
  ok('applyRemoteCollect：相手の数が1（二重に数えない、イベントは出さない）', JSON.stringify(c.sc) === '[0,1]' && c.col === 0 && c.t.taken && c.t.by === 1, JSON.stringify(c));
  let sto = await ev(() => window.lastState);
  ok("'state' に x,z,y,heading,anim,flip", sto && ['x', 'z', 'y', 'heading', 'anim', 'flip', 'squash', 'hatForward', 'spin'].every((k) => k in sto), JSON.stringify(sto));

  // ---------- 8. CPU（race、見本相当の地図）：3つの難しさ ----------
  const results = {};
  for (const level of ['easy', 'normal', 'hard']) {
    await ev((level) => { resetEvents(); World.load(window.testMap, { myIndex: 0, players: [{ color: '#e08524' }, { color: '#2f8be0' }], net: false, cpu: { level }, mode: 'race' }); World._setPose(2.5, 60.5, 0); }, level);
    let cells = new Set(), r = null;
    for (let k = 0; k < 400; k++) { // 最大 400×90コマ＝1200秒（ゲーム内）
      await step(90);
      r = await ev(() => ({ d: World._debug(), f: events.found.slice(), col: events.collect.slice() }));
      cells.add(r.d.cpu.cx + ',' + r.d.cpu.cz);
      if (r.f.length) break;
    }
    const cp = r.d.cpu;
    results[level] = { found: r.f, time: +cp.time.toFixed(1), steps: cp.steps, jumps: cp.jumps, attacks: cp.attacks, digs: cp.digs, replans: cp.replans, cells: cells.size };
    ok(`CPU（${level}）が宝を掘り出して拾う found(1)`, JSON.stringify(r.f) === '[1]' && JSON.stringify(r.col[0]) === '[1,0,[0,1]]', JSON.stringify(results[level]));
    ok(`CPU（${level}）は壊して・掘って進んだ`, cp.attacks + cp.digs >= 2, `attacks=${cp.attacks} digs=${cp.digs} jumps=${cp.jumps}`);
  }
  ok('難しさの順に拾うまでの時間が短い（ゲーム内時間）', results.easy.time > results.normal.time && results.normal.time > results.hard.time, `easy ${results.easy.time}s / normal ${results.normal.time}s / hard ${results.hard.time}s`);

  // count モード：CPUが次々に集める（小さな地図、宝4個）
  await ev(() => {
    const m = flatMap(30, 30, [{ x: 6, z: 6 }, { x: 22, z: 6 }, { x: 6, z: 22 }, { x: 22, z: 22 }]);
    for (let z = 10; z < 20; z++) { m.set(14, z, 10); m.set(15, z, 10); } // 真ん中に壁
    m.set(10, 14, 4); m.set(11, 14, 4);
    m.starts = [{ x: 1, z: 1, dir: 2 }, { x: 14, z: 25, dir: 0 }];
    resetEvents(); World.load(m, { myIndex: 0, players: [{ color: '#e08524' }, { color: '#2f8be0' }], net: false, cpu: { level: 'hard' }, mode: 'count' });
  });
  let cc = null;
  for (let k = 0; k < 200; k++) { await step(90); cc = await ev(() => ({ n: events.collect.length, done: events.done, d: World._debug() })); if (cc.done.length) break; }
  ok('count モード：CPUが宝4個を次々に集める（同じ所を回り続けない）', cc.n === 4 && JSON.stringify(cc.done[0]) === '[0,4]', `collect=${cc.n} cpuTime=${cc.d.cpu.time.toFixed(1)}s jumps=${cc.d.cpu.jumps} attacks=${cc.d.cpu.attacks} digs=${cc.d.cpu.digs}`);

  // 見本の地図（mapgen.js）でも CPU が宝に行ける
  const presets = await ev(() => (window.MapGen && MapGen.presets ? MapGen.presets.map((p) => p.id) : []));
  for (const id of presets.slice(0, 8)) {
    await ev((id) => { resetEvents(); const m = MapGen.fromPreset(id, { treasureCount: 1 }); World.load(m, { myIndex: 0, players: [{ color: '#e08524' }, { color: '#2f8be0' }], net: false, cpu: { level: 'hard' }, mode: 'race' }); World._setPose(m.starts[0].x + 0.5, m.starts[0].z + 0.5, 0); }, id);
    let rr = null;
    for (let k = 0; k < 200; k++) { await step(90); rr = await ev(() => ({ f: events.found.slice(), d: World._debug() })); if (rr.f.length) break; }
    ok(`見本の地図「${id}」：CPU（むずかしい）が宝を拾う`, JSON.stringify(rr.f) === '[1]', `cpuTime=${rr.d.cpu.time.toFixed(1)}s attacks=${rr.d.cpu.attacks} digs=${rr.d.cpu.digs} jumps=${rr.d.cpu.jumps}`);
  }


  // ---------- 11. 第3期 r2：目じるし・ドリルの深さ・カメラ ----------
  // 11a. 埋まっている宝の目じるし：見本の地図2つで、出発直後のおいかけ視点に入る（20マス前後先）・掘り出したら消える
  for (const id of ['jiyu', 'shiho']) {
    const hi = await ev((id) => {
      const m = MapGen.fromPreset(id, { treasureCount: 1 }); resetEvents();
      World.load(m, { myIndex: 0, players: [{ color: '#e08524' }, { color: '#2f8be0' }], net: false, cpu: { level: 'normal' }, mode: 'race' });
      World.setCamera(0); World.setCamera(1); World._step(45);
      return World._hintInfo();
    }, id);
    ok(`目じるし（${id}）：出発直後のおいかけ視点の画面に入る`, hi.length === 1 && hi[0].on && hi[0].onScreen && hi[0].dist >= 15, JSON.stringify(hi));
    await snap('start_' + id);
  }
  let hi2 = await ev(() => { const t = World._debug().treasures[0]; World.applyRemoteTerrain([[t.x, t.z, 0]]); World._step(5); return World._hintInfo(); });
  ok('目じるし：宝が出たら消える（宝石の光にかわる）', hi2[0].revealed && !hi2[0].on, JSON.stringify(hi2));
  hi2 = await ev(() => { const T10 = []; for (let k = 0; k < 10; k++) T10.push({ x: 3 + (k % 5) * 6, z: 4 + Math.floor(k / 5) * 12 }); const m = flatMap(34, 24, T10); loadMap(m, { mode: 'count' }); return { h: World._hintInfo(), calls0: World._debug().calls }; });
  ok('目じるし：count モードでは10この山 すべてに出る', hi2.h.length === 10 && hi2.h.every((h) => h.on), JSON.stringify(hi2.h.map((h) => h.on)));

  // 11b. ドリルジャンプ：掘っている間、ドリルの先が掘っているマスの上面より下に入る
  await ev(() => { const m = flatMap(20, 20, [{ x: 10, z: 10 }]); loadMap(m, { mode: 'solo' }); World._setPose(10.5, 10.5, 0); });
  const bores = [];
  for (let rep = 0; rep < 2; rep++) {
    await ev(() => { World.press('drillJump', true); World.press('drillJump', false); });
    for (let k = 0; k < 90; k++) {
      const r = await ev(() => { World._step(1); const d = World._debug(); return d.me.act === 'drillJump:bore' ? World._meLow() : null; });
      if (r) bores.push(r);
    }
  }
  const deep = bores.length ? Math.min(...bores.map((b) => b.low - b.top)) : 9;
  ok('ドリルジャンプ：ドリルの先が掘っているマスに入る（上面より下）', bores.length > 5 && deep < -0.2, `いちばん深い所 ${deep.toFixed(2)}（上面からの差）tip=${bores[0] && bores[0].tip.toFixed(3)}`);

  // 11c. ドリルアタック中はカメラが右上へずれ、終わると戻る
  await ev(() => { const m = flatMap(20, 20, []); m.set(10, 9, 10); loadMap(m, { mode: 'solo' }); World._setPose(10.5, 10.5, 0); World.press('drillAttack', true); World.press('drillAttack', false); });
  let cam = await ev(() => { World._step(10); return World._cam(); });
  ok('ドリルアタック中：カメラを横・上へずらす', cam.atk > 0.6, JSON.stringify(cam));
  cam = await ev(() => { World._step(90); return World._cam(); });
  ok('ドリルアタックのあと：カメラが戻る', cam.atk < 0.1, JSON.stringify(cam));

  // 11d. 止まっていると回りこんで顔を見せる（向きは変えない）。すすむ で すぐ戻る
  await ev(() => { const m = flatMap(20, 20, []); loadMap(m, { mode: 'solo' }); World._setPose(10.5, 14.5, 0); });
  cam = await ev(() => { World._step(120); return World._cam(); });
  ok('出発してすぐ（まだ動いていない）は回りこまない', cam.orbit < 0.01, JSON.stringify(cam));
  await ev(() => { World.press('fwd', true); World._step(10); World.press('fwd', false); });
  const hd0 = (await dbg()).me.heading;
  cam = await ev(() => { World._step(150); return World._cam(); });
  const hd1 = (await dbg()).me.heading;
  ok('止まって約3秒で回りこむ・向き（操作）は変わらない', cam.orbit > 0.8 && hd0 === hd1, JSON.stringify(cam));
  cam = await ev(() => { World.press('fwd', true); World._step(10); const c = World._cam(); World.press('fwd', false); return c; });
  ok('すすむ を押すと すぐ後ろへ戻る', cam.orbit < 0.25, JSON.stringify(cam));

  // 11e. おいかけ視点で、カメラとの間の壁は薄く透かす
  await ev(() => { const m = flatMap(20, 24, []); for (let z = 6; z < 20; z++) { m.set(11, z, 10); m.set(12, z, 10); m.set(9, z, 10); } loadMap(m, { mode: 'solo' }); World._setPose(10.5, 12.5, 0); World._step(30); });
  let fade = await ev(() => World._fading());
  ok('1マスの通路で、シーカーを隠す横の壁を透かす', fade > 0, `透かしているマス ${fade}`);
  cam = await ev(() => { const m = flatMap(20, 24, []); for (let z = 6; z < 20; z++) { m.set(11, z, 10); m.set(12, z, 10); } loadMap(m, { mode: 'solo' }); World._setPose(10.5, 12.5, 0); World._step(40); return World._cam(); });
  ok('右どなりだけ高い壁なら、カメラは左うしろへ移る', cam.side < -0.8, JSON.stringify(cam));
  await ev(() => { const m = flatMap(20, 24, []); loadMap(m, { mode: 'solo' }); World._setPose(10.5, 12.5, 0); World._step(30); });
  fade = await ev(() => World._fading());
  ok('間に壁がなければ透かさない', fade === 0, `${fade}`);

  // 11f. 拾った同じコマで UI が World.stop() を呼んでも、内部のエラーが出ない（第3期 r1 の 'reading parts'）
  {
    const warnBefore = errors.length;
    const r = await ev(() => {
      const m = flatMap(20, 20, [{ x: 10, z: 10 }]); loadMap(m, { mode: 'solo' });
      World.applyRemoteTerrain([[10, 10, 0], [9, 10, 0]]); World._step(20);
      World._setPose(9.5, 10.5, -Math.PI / 2);
      window.stopNow = function () { World.stop(); };
      World.on('found', window.stopNow);
      let err = null;
      try { World.press('fwd', true); World._step(40); } catch (e) { err = String(e); }
      World.press('fwd', false);
      World.off('found', window.stopNow);
      const out = { err, found: events.found.slice(), running: World._debug().running };
      World.init(document.getElementById('wrap')); World.load(window.testMap, { myIndex: 0, players: [{ color: '#e08524' }, { color: '#2f8be0' }], net: false, mode: 'solo' }); World.start();
      return out;
    });
    ok('拾った瞬間に World.stop() されても例外が出ない', !r.err && JSON.stringify(r.found) === '[0]' && errors.length === warnBefore, JSON.stringify(r));
  }

  // ---------- 9. スクリーンショット（描画ループで） ----------
  await ev(() => World._manual(false));
  await ev(() => { const m = window.testMap; resetEvents(); World.load(m, { myIndex: 0, players: [{ color: '#e08524' }, { color: '#2f8be0' }], net: false, cpu: { level: 'normal' }, mode: 'race' }); });
  await wait(1200);
  await page.screenshot({ path: SHOT + 'sky.png' }); // 開始演出の真上（そら）
  await ev(() => { World.setCamera(0); World.setCamera(1); World._setPose(20.5, 33.5, 0); World.press('fwd', true); });
  await shotWhen('d.me.z < 32.3', 'chase_run');
  await ev(() => World.press('fwd', false));
  // ジャンプ：凹み・頂点
  await ev(() => { World._setPose(20.5, 31.5, 0); World.press('jump', true); World.press('jump', false); });
  await shotWhen('d.me.squash > 0.6 && !d.me.air', 'jump_squash');
  await shotWhen('d.me.air && d.me.y > 0.75', 'jump_top');
  await wait(1500);
  // ドリルアタック（正面の色の積み木 (20,27) 高さ4）
  await ev(() => { World._setPose(20.5, 28.5, 0); World._step(5); World.press('drillAttack', true); World.press('drillAttack', false); });
  await shotWhen("d.me.hatF > 0.95 && d.me.act === 'drillAttack:'", 'drill_attack');
  await wait(800);
  // ドリルジャンプ：逆さ・潜る
  await ev(() => { World._setPose(16.5, 26.5, Math.PI); World._step(5); World.press('drillJump', true); World.press('drillJump', false); });
  await shotWhen("d.me.act === 'drillJump:hang'", 'djump_flip');
  await shotWhen("d.me.act === 'drillJump:bore'", 'djump_bore');
  await wait(1500);
  // 宝が出た瞬間（宝の山の手前から）
  await ev(() => { World._setPose(34.5, 15.5, 0); World.applyRemoteTerrain([[34, 13, 0]]); World._step(10); World._setPose(34.5, 13.5, 0); World._step(5); World.press('drillAttack', true); World.press('drillAttack', false); });
  await shotWhen('d.treasures[0].revealed', 'reveal_0');
  await wait(1400);
  await page.screenshot({ path: SHOT + 'reveal.png' });
  // そら視点（遊んでいる途中）
  await ev(() => World.setCamera(2)); await wait(2500);
  await page.screenshot({ path: SHOT + 'sky_play.png' });
  await ev(() => World.setCamera(1));
  // CPU を後ろから見る（相手の色）
  await ev(() => { resetEvents(); World.load(window.testMap, { myIndex: 0, players: [{ color: '#e08524' }, { color: '#2f8be0' }], net: false, cpu: { level: 'easy' }, mode: 'race' }); World.setCamera(0); World.setCamera(1); World._setPose(26.5, 41.5, 0); });
  await wait(2500);
  await page.screenshot({ path: SHOT + 'cpu_view.png' });


  // ---------- 12. 第3期 r2 の確認画像（_step で場面を作って撮る）＋ 拾ったあと1.6秒の演出の間エラーが出ないこと ----------
  await ev(() => World._manual(true));
  const loadTest = () => ev(() => { resetEvents(); World.load(window.testMap, { myIndex: 0, players: [{ color: '#e08524' }, { color: '#2f8be0' }], net: false, mode: 'solo' }); World.setCamera(0); World.setCamera(1); World._step(40); });
  // ドリルアタック：正面の積み木 (20,27) 高さ4 が壊れた直後
  await loadTest();
  await ev(() => { World._setPose(20.5, 28.5, 0); World.press('fwd', true); World._step(3); World.press('fwd', false); World._setPose(20.5, 28.5, 0); World._step(10); World.press('drillAttack', true); World.press('drillAttack', false); World._step(13); });
  ok('（画像）ドリルアタックで正面が壊れた', (await hOf(20, 27)) === 0);
  await snap('attack');
  // ドリルジャンプ：高さ3の積み木の上で潜っているところ
  await loadTest();
  await ev(() => { World._setPose(15.5, 26.5, -Math.PI / 2); World._step(10); World.press('drillJump', true); World.press('drillJump', false); for (let k = 0; k < 120; k++) { World._step(1); if (World._debug().me.act === 'drillJump:bore') break; } World._step(7); });
  const bl = await ev(() => World._meLow());
  ok('（画像）ドリルジャンプで潜っている：先がマスの中', bl.low < bl.top, JSON.stringify(bl));
  await snap('djump_bore');
  // 横の壁の通路：透かし
  await loadTest();
  await ev(() => { World._setPose(31.5, 30.5, 0); World.press("fwd", true); World._step(3); World.press("fwd", false); World._setPose(31.5, 30.5, 0); World._step(30); });
  await snap('wall_side');
  // 止まっているとき（回りこんで顔と星）
  await loadTest();
  await ev(() => { World._setPose(20.5, 34.5, 0); World.press('fwd', true); World._step(12); World.press('fwd', false); World._step(150); });
  ok('（画像）止まっているときは回りこんでいる', (await ev(() => World._cam().orbit)) > 0.8);
  await snap('idle_face');
  // 拾った瞬間：UI と同じく1.6秒あとに stop する。その間に宝石が飛んでくる・顔が見える・エラーが出ない
  {
    const warnBefore = errors.length;
    await loadTest();
    await ev(() => {
      World.applyRemoteTerrain([[34, 12, 0], [34, 13, 0]]); World._step(20);
      World._setPose(34.5, 13.7, 0);
      window.colT = -1;
      window.lateStop = function () { window.colT = World._debug().time; }; // 拾った時刻だけ記録（stop は撮影のあとで、UI と同じ1.6秒待って呼ぶ）
      World.on('found', window.lateStop);
      World.press('fwd', true);
      for (let k = 0; k < 60 && window.colT < 0; k++) World._step(1);
      World.press('fwd', false);
      World._step(12); // 宝石がシーカーへ飛んでいる途中
    });
    await snap('pickup_fly');
    await ev(() => World._step(26)); // とどいて きらきら・回りこみ
    await snap('pickup_face');
    const pk = await ev(() => ({ colT: window.colT, cam: World._cam(), t: World._debug().treasures[0] }));
    await ev(() => { World._manual(false); setTimeout(function () { World.stop(); window.stopped = true; }, 1600); });
    for (let k = 0; k < 40 && !(await ev(() => !!window.stopped)); k++) await wait(250);
    await ev(() => World.off('found', window.lateStop));
    ok('拾ったあと1.6秒の演出（宝石が飛ぶ・回りこむ）→ stop でエラーなし', pk.colT >= 0 && pk.t.taken && pk.cam.orbit > 0.5 && errors.length === warnBefore, JSON.stringify(pk));
    await ev(() => { World.init(document.getElementById('wrap')); World.load(window.testMap, { myIndex: 0, players: [{ color: '#e08524' }, { color: '#2f8be0' }], net: false, mode: 'solo' }); World.start(); });
  }
  await ev(() => World._manual(false));

  // ---------- 10. stop → init → load → start ----------
  await ev(() => { World.stop(); World.init(document.getElementById('wrap')); World.load(window.testMap, { myIndex: 0, players: [{ color: '#e08524' }, { color: '#2f8be0' }], net: true, cpu: { level: 'hard' }, mode: 'race' }); World.start(); });
  await wait(1500);
  d = await dbg();
  ok('stop→init→load→start で動く・通信のときは cpu を使わない', d.cpu === null && d.running && d.time > 0);

  console.log('ERRORS', errors.length, errors.join('\n'));
  ok('コンソールエラー 0', errors.length === 0);
  console.log(fails ? `NG ${fails}件` : 'ALL OK');
  await browser.close(); stopStatic();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
