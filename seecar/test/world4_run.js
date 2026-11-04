// 第4期 world.js の確認: cd seecar/test && node world4_run.js
// 加速（段・リセット）・押し続けるドリルアタック／ジャンプドリル・宝石（gemHit／award／演出）・freeze／go・擬音と音・目じるし・CPU（ソナー推理）
// 動きの確かめは World._step(n, dt)（確認用：ゲーム内時間を すぐに進める）。スクリーンショットは test/shots/p4_world_*.png
const { openPage, stopStatic } = require('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/harness.js');
const fs = require('fs');
const SHOT = 'C:/Users/s9h0u/.claude/my-first-repo/seecar/test/shots/p4_world_';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, info = '') => { if (!cond) fails++; console.log((cond ? 'OK  ' : 'NG  ') + name + (info ? '  ' + info : '')); };
const E = Math.PI / 2; // heading：0=北(-z)、-E=東(+x)、E=西、PI=南

(async () => {
  const { browser, page, errors } = await openPage('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/world4_test.html', { viewport: { width: 1024, height: 576 } });
  page.on('console', (m) => { if (m.type() === 'warning' && /World (loop|handler) error|SeekerModel\.(update|create) failed/.test(m.text())) errors.push('warn: ' + m.text()); });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const dbg = (x, z) => ev(([x, z]) => World._debug(x, z), [x, z]);
  const step = (n, dt) => ev(([n, dt]) => World._step(n, dt), [n, dt || 1 / 30]);
  const hOf = async (x, z) => (await dbg(x, z)).h;
  await wait(1200);
  await ev(() => World._manual(true));

  // ---------- 0. CPU のきまり：宝の座標を読むのは cpuSense だけ（ソースを調べる） ----------
  {
    const src = fs.readFileSync('C:/Users/s9h0u/.claude/my-first-repo/seecar/src/world.js', 'utf8');
    const a = src.indexOf('/* ===== W22.'), b = src.indexOf('/* ===== W23.');
    const cpu = src.slice(a, b);
    const s0 = cpu.indexOf('function cpuSense('), s1 = cpu.indexOf('function cpuBelief(');
    const outside = cpu.slice(0, s0) + cpu.slice(s1);
    const bad = (outside.replace(/\/\/.*$/gm, '').match(/S\.treasures|S\.gemAt|gemInfo|\.owner|treasureInfo|sonar\(/g) || []);
    ok('CPU：宝石の座標（S.treasures・S.gemAt）に触れるのは cpuSense() だけ', a > 0 && b > a && s0 > 0 && bad.length === 0, bad.join(','));
    ok('CPU：「CPU は宝の座標を直接読まない」のコメントがある', /CPU は宝の座標を直接読まない/.test(src));
    ok('CPU_LEVELS が1か所（先頭近く）にまとまっている', (src.match(/var CPU_LEVELS = /g) || []).length === 1 && src.indexOf('var CPU_LEVELS') < 6000);
    const sec = (src.match(/\/\* ===== W\d\d\. /g) || []).length;
    ok('連番のコメントブロック（W01〜）', sec >= 20, sec + ' 個');
  }

  // ---------- 1. 読み込みは止まった状態・go で動く ----------
  await ev(() => { const m = flatMap(60, 30, []); window.mFlat = m; loadMap(m, { stayFrozen: true }); World._setPose(3.5, 10.5, -Math.PI / 2); });
  let d = await dbg();
  ok('読み込んだ直後は frozen', d.frozen === true);
  await ev(() => World.press('fwd', true)); await step(30);
  d = await dbg();
  ok('frozen の間は「すすむ」を押しても動かない', Math.abs(d.me.x - 3.5) < 1e-6, `x=${d.me.x}`);
  await ev(() => { World.press('fwd', false); World.go(); World.press('fwd', true); }); await step(30);
  d = await dbg();
  ok('go() のあとは動く（1秒で約2.88マス＝基本の速さ×1.2）', Math.abs(d.me.x - 3.5 - 2.88) < 0.12, `進んだ ${(d.me.x - 3.5).toFixed(3)} マス`);

  // ---------- 2. 加速 ----------
  await ev(() => { World.press('fwd', false); World._step(2); World._setPose(2.5, 10.5, -Math.PI / 2); World.press('fwd', true); });
  const stages = [];
  let xPrev = (await dbg()).me.x, v5 = 0;
  for (let s = 0; s < 7; s++) { await step(30); const dd = await dbg(); stages.push(dd.me.stage); if (s === 6) v5 = dd.me.x - xPrev; xPrev = dd.me.x; }
  ok('まっすぐ進むと1秒ごとに1段（+10%）、5段（+50%）で止まる', stages.join() === '1,2,3,4,5,5,5', stages.join());
  ok('5段の速さ ≒ 2.88×1.5 = 4.32 マス/秒', Math.abs(v5 - 4.32) < 0.08, v5.toFixed(3));
  const eng = await ev(() => engLog.slice());
  ok('Sfx.engine に run:0〜run:5 が順に渡る', ['run:1', 'run:2', 'run:3', 'run:4', 'run:5'].every((k) => eng.includes(k)), eng.join(' '));
  // リセット：向き（大きいスワイプ）、ごく小さな揺れは無視
  await ev(() => World.swipeTurn(0.005)); await step(2);
  ok('ごく小さなスワイプ（約0.9°）ではリセットしない', (await dbg()).me.stage === 5);
  await ev(() => World.swipeTurn(0.05)); await step(2);
  ok('スワイプで向きが変わったら0段へ', (await dbg()).me.stage === 0);
  // 「すすむ」を離す
  await ev(() => { World._setPose(2.5, 12.5, -Math.PI / 2); World.press('fwd', true); }); await step(75);
  let st0 = (await dbg()).me.stage;
  await ev(() => World.press('fwd', false)); await step(1); await ev(() => World.press('fwd', true)); await step(2);
  ok('「すすむ」を離したら0段へ', st0 === 2 && (await dbg()).me.stage === 0, `前=${st0}`);
  // ジャンプ・ドリルのボタン
  for (const b of ['jump', 'drillAttack', 'jumpDrill']) {
    await ev(() => { World.press('jumpDrill', false); World.press('drillAttack', false); World._setPose(2.5, 14.5, -Math.PI / 2); World.press('fwd', true); }); await step(75);
    st0 = (await dbg()).me.stage;
    await ev((b) => { World.press(b, true); if (b === 'jump') World.press(b, false); }, b); await step(1);
    const s1 = (await dbg()).me.stage;
    await ev((b) => World.press(b, false), b); await step(60);
    ok(`「${b}」を押したら0段へ`, st0 === 2 && s1 === 0, `前=${st0} 後=${s1}`);
  }
  // 壁にぶつかる
  await ev(() => { World.press('fwd', false); const m = flatMap(60, 30, []); m.box(20, 0, 1, 30, 10); window.mWall = m; loadMap(m); World._setPose(2.5, 10.5, -Math.PI / 2); World.press('fwd', true); });
  let maxSt = 0;
  for (let k = 0; k < 14; k++) { await step(15); maxSt = Math.max(maxSt, (await dbg()).me.stage); }
  d = await dbg();
  ok('壁にぶつかったら0段へ（押し続けても上がらない）', maxSt >= 3 && d.me.stage === 0 && d.me.cx === 19, `最高=${maxSt} 今=${d.me.stage} cx=${d.me.cx}`);
  const bumps = await ev(() => events.onomato.filter((o) => o[0] === 'bump'));
  const gaps = bumps.slice(1).map((b, i) => b[1] - bumps[i][1]);
  ok("ぶつかり続けると 'bump' の擬音は 0.8秒に1回まで・Sfx 'bump'", bumps.length >= 2 && gaps.every((g) => g >= 0.79) && (await ev(() => sfxLog.includes('bump'))), `${bumps.length}回 間隔=${gaps.map((g) => g.toFixed(2)).join(',')}`);
  await ev(() => World.press('fwd', false));
  // 段差：降りる・1段登る ではリセットしない
  await ev(() => { const m = flatMap(60, 30, []); m.box(0, 5, 10, 3, 3); m.box(20, 5, 10, 3, 1); m.box(30, 5, 10, 3, 2); m.box(40, 5, 20, 3, 3); loadMap(m); World._setPose(2.5, 6.5, -Math.PI / 2); World.press('fwd', true); });
  const trace = [];
  for (let k = 0; k < 40; k++) { await step(10); const dd = await dbg(); trace.push([dd.me.cx, dd.me.lv, dd.me.stage]); }
  await ev(() => World.press('fwd', false));
  const drops = trace.filter((t, i) => i > 0 && t[2] < trace[i - 1][2]);
  const climbed = trace.some((t) => t[1] === 3 && t[0] >= 40);
  ok('段差を降りる・1段ずつ登る では0段へ戻らない（3→0へ降りて 0→1→2→3 と登る）', drops.length === 0 && climbed && trace[trace.length - 1][2] >= 4, JSON.stringify(trace.filter((t, i) => i % 3 === 0)));
  ok("1段を登ると Sfx 'step'（ガタン）", await ev(() => sfxLog.filter((n) => n === 'step').length >= 3), await ev(() => sfxLog.filter((n) => n === 'step').length + '回'));
  // freeze で加速のタイマーが止まる
  await ev(() => { loadMap(mFlat); World._setPose(2.5, 10.5, -Math.PI / 2); World.press('fwd', true); }); await step(45);
  const a1 = await dbg();
  await ev(() => World.freeze(true)); await step(90);
  const a2 = await dbg();
  await ev(() => World.go()); await step(20);
  const a3 = await dbg();
  ok('freeze の間は動かず、加速のタイマーも止まる（再開で続きから）', a1.me.stage === 1 && a2.me.stage === 1 && Math.abs(a2.me.x - a1.me.x) < 1e-6 && a3.me.stage === 2, `${a1.me.stage}→${a2.me.stage}→${a3.me.stage}`);
  await ev(() => { World.setPaused(true); }); const p0 = (await dbg()).time; await step(30); const p1 = (await dbg()).time;
  await ev(() => { World.setPaused(false); World.press('fwd', false); });
  ok('setPaused(true) は全部止める（時間も進まない）', p0 === p1);

  // ---------- 3. ドリルアタック（押している間ずっと） ----------
  await ev(() => { const m = flatMap(40, 20, []); m.box(10, 5, 20, 3, 4); m.box(10, 12, 3, 3, 10); window.mDrill = m; loadMap(m); World._setPose(8.5, 6.5, -Math.PI / 2); });
  await ev(() => { events.terrain = []; events.action = []; World.press('drillAttack', true); });
  const dtrace = [];
  for (let k = 0; k < 10; k++) { await step(15); const dd = await dbg(); dtrace.push([+(dd.time).toFixed(2), +dd.me.x.toFixed(2), dd.me.hatF.toFixed(2)]); }
  d = await dbg();
  const broken = (await ev(() => events.terrain.length));
  const holdSecs = 5;
  ok('ドリルアタックを押している間、前のマスを壊しながら進み続ける', broken >= 4 && d.me.x > 12, `${holdSecs}秒で ${broken} マス壊した・x=${d.me.x.toFixed(2)} cells/s=${(broken / holdSecs).toFixed(2)}`);
  // 速さ：ブロックの中（連続で壊す）と、何もない所
  const xa = d.me.x; await step(60); d = await dbg();
  const solidRate = (d.me.x - xa) / 2;
  ok('掘り進む速さ 約1.0〜1.3 マス/秒（第3期の1回ずつ＋走る 約0.96マス/秒より速い）', solidRate >= 1.0 && solidRate <= 1.35, solidRate.toFixed(2) + ' マス/秒');
  ok('壊したマスは足元の段（0）まで下がる', (await hOf(11, 6)) === 0 && (await hOf(12, 6)) === 0, `h(11,6)=${await hOf(11, 6)}`);
  ok('押している間ドリルは正面を向いたまま（hatForward=1）', d.me.hatF === 1 && /drillAttack:hold/.test(d.me.act), `${d.me.act} hatF=${d.me.hatF}`);
  ok("押している間 擬音 'drill' は約0.9秒おき", await ev(() => { const o = events.onomato.filter((x) => x[0] === 'drill'); return o.length >= 6 && o.slice(1).every((x, i) => x[1] - o[i][1] >= 0.89); }), await ev(() => events.onomato.filter((x) => x[0] === 'drill').length + '回'));
  ok("壊すたびに Sfx 'break'・擬音 'break' は 0.5秒以上あける", await ev(() => { const o = events.onomato.filter((x) => x[0] === 'break'); return sfxLog.filter((n) => n === 'break').length >= 5 && o.length >= 3 && o.slice(1).every((x, i) => x[1] - o[i][1] >= 0.49); }));
  ok("ドリル中は Sfx.engine('drill')", (await ev(() => engLog.slice(-3))).some((k) => /^drill/.test(k)), (await ev(() => engLog.slice(-3))).join(' '));
  await ev(() => World.press('drillAttack', false)); await step(4);
  const r1 = await dbg(); await step(10); const r2 = await dbg();
  ok('離したらドリルが頭上へ戻る（約0.25秒）', r1.me.hatF < 1 && r2.me.hatF === 0 && r2.me.act === null, `${r1.me.hatF.toFixed(2)} → ${r2.me.hatF}`);
  ok("'action' drillAttack → drillAttackEnd", (await ev(() => events.action.join())) === 'drillAttack,drillAttackEnd', await ev(() => events.action.join()));
  // 何もない所の速さ
  await ev(() => { World._setPose(2.5, 17.5, -Math.PI / 2); World.press('drillAttack', true); }); await step(15);
  const o0 = (await dbg()).me.x; await step(30); const o1 = (await dbg()).me.x;
  await ev(() => World.press('drillAttack', false)); await step(20);
  ok('何もない所では ドリルを向けたまま約1.4マス/秒で進む（ふつうより遅い）', Math.abs(o1 - o0 - 1.4) < 0.1, (o1 - o0).toFixed(2));
  // 壁（10）も同じ時間で壊せる
  await ev(() => { World._setPose(8.5, 13.5, -Math.PI / 2); events.terrain = []; World.press('drillAttack', true); }); await step(60);
  await ev(() => World.press('drillAttack', false)); await step(15);
  ok('壁（高さ10）も同じように掘り進める', (await ev(() => events.terrain.length)) >= 1 && (await hOf(10, 13)) === 0, `${await ev(() => JSON.stringify(events.terrain))}`);

  // ---------- 4. ジャンプドリル（押している間ずっと） ----------
  await ev(() => { const m = flatMap(30, 20, []); m.box(10, 8, 6, 3, 9); window.mJD = m; loadMap(m); World._setPose(11.5, 9.5, -Math.PI / 2); events.terrain = []; events.action = []; World.press('jumpDrill', true); });
  const jdTrace = []; let minFlip = 1;
  for (let k = 0; k < 90; k++) { await step(1); const dd = await dbg(); if (k > 15) minFlip = Math.min(minFlip, dd.me.flip); if (k % 6 === 0) jdTrace.push(dd.me.y.toFixed(2)); }
  d = await dbg();
  const jdBreaks = await ev(() => events.terrain.length);
  const h11 = await hOf(11, 9);
  ok('押している間 逆さのまま（flip=1）、足元を1段ずつ壊して跳ねる', minFlip === 1 && h11 <= 4 && h11 >= 2, `3秒で h 9→${h11}（${jdBreaks}回） y=${jdTrace.join(',')}`);
  // 1回の時間（壊した時刻の間隔）
  const tt = await ev(() => events.terrainT.slice());
  const gapsJ = tt.slice(1).map((t, i) => t - tt[i]), cyc = gapsJ.reduce((p, q) => p + q, 0) / gapsJ.length;
  ok('「壊す→跳ねる」1回 約0.45秒', cyc > 0.4 && cyc < 0.5, `${cyc.toFixed(3)} 秒/回 [${gapsJ.map((g) => g.toFixed(2)).join(',')}]`);
  await step(90);
  await ev(() => World.press('jumpDrill', false));
  const fl = []; for (let k = 0; k < 40; k++) { await step(1); const dd = await dbg(); fl.push(dd.me.flip); if (!dd.me.act) break; }
  d = await dbg();
  const smooth = fl.every((f, i) => i === 0 || f <= fl[i - 1] + 1e-9) && fl.some((f) => f > 0.2 && f < 0.8);
  ok('離したら通常の姿勢へなめらかに戻って着地（穴の中）', d.me.act === null && d.me.flip === 0 && smooth && d.me.cx === 11 && d.me.lv === (await hOf(11, 9)), `flip=${fl.map((f) => f.toFixed(2)).slice(0, 12).join(',')}… lv=${d.me.lv}`);
  ok("'action' jumpDrill → jumpDrillEnd", (await ev(() => events.action.join())) === 'jumpDrill,jumpDrillEnd', await ev(() => events.action.join()));
  // 「すすむ」を押していれば、跳ねるたびに少し前へ
  await ev(() => { loadMap(mJD); World._setPose(10.5, 9.5, -Math.PI / 2); events.terrain = []; World.press('fwd', true); World.press('jumpDrill', true); });
  await step(120);
  d = await dbg();
  await ev(() => { World.press('jumpDrill', false); World.press('fwd', false); }); await step(40);
  const cellsJD = await ev(() => { const s = new Set(); events.terrain.forEach((t) => s.add(t[0][0] + ',' + t[0][1])); return [...s]; });
  ok('ジャンプドリル＋すすむ：跳ねるたびに少し前へ進んで掘る', d.me.x > 11.5 && cellsJD.length >= 2, `x 10.5→${d.me.x.toFixed(2)} 掘ったマス ${cellsJD.join(' ')}`);
  // 旧名 drillJump も同じ
  await ev(() => { loadMap(mJD); World._setPose(11.5, 9.5, 0); events.action = []; World.press('drillJump', true); }); await step(20);
  ok("旧名 'drillJump' も 'jumpDrill' として受ける", /jumpDrill/.test((await dbg()).me.act || '') && (await ev(() => events.action[0])) === 'jumpDrill');
  await ev(() => World.press('drillJump', false)); await step(60);
  ok('ジャンプドリルのあと ふつうに戻る', (await dbg()).me.act === null);

  // ---------- 5. 宝石：gemHit（壊した人だけ）・award・演出 ----------
  await ev(() => { const m = flatMap(30, 20, [{ x: 12, z: 6, gem: 0 }, { x: 12, z: 12, gem: 9 }]); m.box(12, 6, 1, 1, 4); m.box(12, 12, 1, 1, 3); window.mGem = m; window.autoAward = false; loadMap(m, { mode: 'count' }); World._setPose(10.5, 6.5, -Math.PI / 2); });
  d = await dbg();
  ok('宝石はブロックの中で見えない（光の柱だけ）', d.treasures.every((t) => !t.shown && t.beam && t.owner === -1));
  await ev(() => World.press('drillAttack', true)); await step(45); await ev(() => World.press('drillAttack', false)); await step(10);
  let gh = await ev(() => events.gemHit.map((g) => [g[0], g[1]]));
  ok("宝石のマスを壊した人について 'gemHit'(idx, ti)・World は所有者を決めない", JSON.stringify(gh) === '[[0,0]]' && (await dbg()).treasures[0].owner === -1 && (await ev(() => events.collect.length)) === 0, JSON.stringify(gh));
  // 相手（通信）が壊したときは出ない
  await ev(() => World.applyRemoteTerrain([[12, 12, 1]])); await step(5);
  ok("applyRemoteTerrain では 'gemHit' を出さない", (await ev(() => events.gemHit.length)) === 1);
  // award
  const aw1 = await ev(() => World.award(0, 0));
  const aw2 = await ev(() => World.award(1, 0));
  let col = await ev(() => events.collect);
  ok("award(0,0)：所有者が決まり 'collect'(0,0,[1,0])。2回目は無視", aw1 === true && aw2 === false && JSON.stringify(col) === '[[0,0,[1,0]]]' && (await dbg()).treasures[0].owner === 0, JSON.stringify(col));
  const info = await ev(() => World.gemInfo(0));
  ok('gemInfo(ti) → {gem, x, z, owner}', info.gem === 0 && info.x === 12 && info.z === 6 && info.owner === 0, JSON.stringify(info));
  ok("award で Sfx 'gemRise'", await ev(() => sfxLog.includes('gemRise')));
  // 演出：浮き上がって回って光る（freeze 中も続く）→ 持ち主へ
  await ev(() => World.freeze(true));
  const gy = [];
  for (let k = 0; k < 8; k++) { await step(15); const dd = await dbg(); gy.push([dd.treasures[0].anim, dd.treasures[0].shown]); }
  ok('freeze 中も宝石の演出は進む（浮き上がり・光る）', gy[0][1] && gy[5][0] >= 2.9 && gy[3][1] && gy[7][0] >= 3.5, JSON.stringify(gy));
  await step(30);
  ok('約3.5秒で持ち主へ吸い込まれて見えなくなる', !(await dbg()).treasures[0].shown);
  await ev(() => World.go());
  ok('持ち主の決まった宝石は光の柱も消える', !(await dbg()).treasures[0].beam);
  // 持ち主の決まった宝石のマスをもう一度壊しても出ない
  await ev(() => { World._setPose(10.5, 6.5, -Math.PI / 2); events.gemHit = []; }); await step(5);
  ok('ソナー：持ち主の決まった宝は出ない', await ev(() => World.sonar(40).items.every((it) => it.i !== 0)));
  // 2つ目：ジャンプドリルで上から（1段下げただけでも当たり）
  await ev(() => { loadMap(mGem, { mode: 'count' }); World._setPose(12.5, 12.5, 0); }); d = await dbg();
  await ev(() => World.press('jumpDrill', true)); await step(20); await ev(() => World.press('jumpDrill', false)); await step(40);
  gh = await ev(() => events.gemHit.map((g) => [g[0], g[1]]));
  ok('ジャンプドリルで宝石のマスを1段下げても gemHit', JSON.stringify(gh) === '[[0,1]]' && (await hOf(12, 12)) === 2 && d.me.lv === 3, JSON.stringify(gh));
  // race：found
  await ev(() => { window.autoAward = true; const m = flatMap(30, 20, [{ x: 12, z: 6, gem: 3 }]); m.box(12, 6, 1, 1, 6); loadMap(m, { mode: 'race' }); World._setPose(10.5, 6.5, -Math.PI / 2); World.press('drillAttack', true); });
  await step(45); await ev(() => World.press('drillAttack', false)); await step(5);
  ok("race：最初の award で 'found'(idx) と over", JSON.stringify(await ev(() => events.found)) === '[0]' && (await dbg()).over);
  await step(8); await page.screenshot({ path: SHOT + 'gem_rise.png' }); // 浮き上がる宝石（_step で止めた場面）

  // ---------- 6. CPU の gemHit は CPU の番号・CPU も同じ規則 ----------
  await ev(() => { window.autoAward = false; const m = flatMap(30, 20, [{ x: 20, z: 10, gem: 2 }]); m.box(20, 10, 1, 1, 4); m.starts = [{ x: 2, z: 2, dir: 1 }, { x: 16, z: 10, dir: 1 }]; loadMap(m, { cpu: { level: 'hard' }, mode: 'race', search: 'sonar' }); });
  for (let k = 0; k < 20; k++) { await step(30); if (await ev(() => events.gemHit.length)) break; }
  gh = await ev(() => events.gemHit.map((g) => [g[0], g[1]]));
  ok("CPU が壊すと 'gemHit'(1, ti)（CPU も UI の award を待つ）", JSON.stringify(gh) === '[[1,0]]' && (await dbg()).treasures[0].owner === -1, JSON.stringify(gh) + ' ' + JSON.stringify(await ev(() => World._cpu())));
  await ev(() => World.award(1, 0));
  ok("CPU の award で 'collect'(1,0,[0,1])", JSON.stringify(await ev(() => events.collect)) === '[[1,0,[0,1]]]');
  ok('CPU の速さ：むずかしい＝人の基本の速さ×CPU_LEVELS.hard.speed（加速の上限は人の+50%より小さい）', await ev(() => Math.abs(World._cpu().speed - 2.88 * World.CPU_LEVELS.hard.speed) < 1e-6 && World.CPU_LEVELS.hard.accelMax < 0.5), JSON.stringify(await ev(() => [World._cpu().speed, World.CPU_LEVELS.hard])));

  // CPU のソナーは人の画面と同じ：円の中は全部、円の外は いちばん近い1つの向きだけ（'light' は光の柱で全部の向き）
  {
    const r = await ev(() => {
      const m = flatMap(60, 60, [{ x: 10, z: 30, gem: 0 }, { x: 40, z: 30, gem: 1 }, { x: 50, z: 50, gem: 2 }, { x: 22, z: 5, gem: 3 }]);
      [[10, 30], [40, 30], [50, 50], [22, 5]].forEach(([x, z]) => m.box(x, z, 1, 1, 4));
      m.starts = [{ x: 2, z: 2, dir: 1 }, { x: 25, z: 30, dir: 1 }];
      const out = {};
      for (const s of ['light', 'sonar']) { loadMap(m, { cpu: { level: 'hard' }, mode: 'count', search: s }); out[s] = World._cpuSense(); }
      World._setCpuPose(37.5, 30.5, 0); out.near = World._cpuSense(); // 宝1は円の中、ほかは外
      return out;
    });
    // CPU(25,30) から：宝0=15、宝1=15、宝2=32、宝3=25 → 円の外。いちばん近いのは 宝0 か 宝1（同じ距離）
    ok('CPU のソナー（円の外）：いちばん近い1つの向きだけ', r.sonar.length === 1 && !r.sonar[0].dist && [0, 1].includes(r.sonar[0].key), JSON.stringify(r.sonar));
    ok("CPU の 'light'：光の柱で全部の向き", r.light.length === 4, JSON.stringify(r.light));
    ok('CPU のソナー（円の中＋外の1つ）', r.near.length === 2 && r.near.some(q => q.key === 1 && q.dist) && r.near.some(q => !q.dist), JSON.stringify(r.near));
  }

  // ---------- 7. 目じるし・色 ----------
  await ev(() => { window.autoAward = true; const m = MapGen.fromPreset('ie', { treasureCount: 1 }); window.mIe = m; loadMap(m, { cpu: { level: 'normal' }, mode: 'race', players: [{ palette: 3 }, { palette: 3 }] }); World.setCamera(2); });
  await step(40);
  d = await dbg();
  ok('そら：自分（三角）とCPU（丸）の目じるしが出る', d.markers.length === 2 && d.markers.every((m) => m.vis), JSON.stringify(d.markers));
  await wait(1500); await page.screenshot({ path: SHOT + 'sky_markers.png' });
  await ev(() => World.setCamera(1)); await step(40);
  d = await dbg();
  ok('おいかけ：目じるしが出る', d.markers.every((m) => m.vis), JSON.stringify(d.markers));
  ok('palette で SeekerModel を作る（箱の代わりではない）', d.hasSeekerModel);

  // ---------- 8. スクリーンショット（実際の描画ループ） ----------
  await ev(() => { const m = flatMap(40, 24, [{ x: 13, z: 12, gem: 0 }]); m.box(12, 9, 12, 7, 5, [67, 160, 71]); m.box(26, 4, 4, 4, 8, [30, 136, 229]); window.mShot = m; loadMap(m, { mode: 'solo' }); World._setPose(10.5, 12.5, -Math.PI / 2); World.press('drillAttack', true); });
  await step(40); await wait(1200); await page.screenshot({ path: SHOT + 'drill_attack.png' });
  await ev(() => World.press('drillAttack', false)); await step(20);
  await ev(() => { World._setPose(27.5, 5.5, -Math.PI / 2); World.press('jumpDrill', true); }); await step(52);
  await wait(1200); await page.screenshot({ path: SHOT + 'jump_drill.png' });
  await ev(() => World.press('jumpDrill', false)); await step(40);
  // 宝石の浮き上がり：おいかけ視点で
  await ev(() => { loadMap(mShot, { mode: 'solo' }); World._setPose(11.5, 12.5, -Math.PI / 2); World.press('drillAttack', true); }); await step(75);
  await ev(() => World.press('drillAttack', false)); await step(30);
  await ev(() => World.press('fwd', true)); await step(1); await ev(() => World.press('fwd', false)); // 顔を見せる回りこみを止める
  await wait(1200); await page.screenshot({ path: SHOT + 'gem_glow.png' });
  // 加速の土ぼこり
  await ev(() => { loadMap(mFlat); World._setPose(2.5, 15.5, -Math.PI / 2); World.press('fwd', true); }); await step(150);
  await wait(1000); await page.screenshot({ path: SHOT + 'accel_dust.png' });
  await ev(() => World.press('fwd', false));
  // 'sonar' モード：光の柱なし
  await ev(() => loadMap(mShot, { mode: 'solo', search: 'sonar' })); await step(5);
  ok("search:'sonar' では光の柱を出さない", (await dbg()).treasures.every((t) => !t.beam));

  // ---------- 9. 通信の相手（状態の再現・色・award・抜けた） ----------
  await ev(() => { window.autoAward = true; const m = flatMap(30, 20, [{ x: 20, z: 10, gem: 7 }]); m.box(20, 10, 1, 1, 3); loadMap(m, { net: true, isHost: true, mode: 'race', players: [{ palette: 0 }, { palette: 5 }] }); World.setCamera(2); });
  await ev(() => World.applyRemoteState(1, { x: 18, z: 10, y: 0, heading: 0, anim: 'jumpDrill', flip: 1, palette: 5 })); await step(30);
  d = await dbg();
  ok('相手の状態を再現（逆さの姿勢・目じるしは白い丸）', d.remotes.length === 1 && d.remotes[0].flip > 0.9 && d.markers.find((m) => m.idx === 1 && !m.me && m.vis), JSON.stringify(d.remotes) + JSON.stringify(d.markers));
  await ev(() => World.applyRemoteTerrain([[20, 10, 2]])); await step(2);
  ok('相手の壊しでは gemHit なし（ホストが award で知らせる）', (await ev(() => events.gemHit.length)) === 0 && (await hOf(20, 10)) === 2);
  await ev(() => World.award(1, 0)); await step(120);
  ok("相手への award：'collect'(1,0,[0,1])・'found'(1)・宝石は相手へ飛ぶ", JSON.stringify(await ev(() => events.collect)) === '[[1,0,[0,1]]]' && JSON.stringify(await ev(() => events.found)) === '[1]' && !(await dbg()).treasures[0].shown);
  await ev(() => World.dropRemote(1)); await step(2);
  ok('dropRemote で相手を消す', (await dbg()).remotes.length === 0);
  await ev(() => { World.stop(); World.init(document.getElementById('wrap')); loadMap(flatMap(20, 20, [{ x: 10, z: 10, gem: 1 }])); World.start(); });
  await step(10);
  ok('stop → init → load → start で動く', (await dbg()).running && !(await dbg()).frozen);

  const errs = errors.filter((e) => !/404 \(Not Found\)/.test(e));
  ok('エラーなし', errs.length === 0, errs.slice(0, 5).join(' | '));
  console.log(fails ? `\n${fails} NG` : '\nALL OK');
  await browser.close(); stopStatic();
})();
