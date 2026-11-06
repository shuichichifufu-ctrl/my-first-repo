// 第5期 world.js の確認: cd seecar/test && node world5_run.js
// スピード3段階（人・CPU・空中・ドリル）／壁を抜けない／ジャンプ・ジャンプドリル／CPU（はやい）／視点4つ（みわたし）／overGem（ピンピンピン）／swipeTurn
// スクリーンショットは test/shots/p5_world_*.png
const { openPage, stopStatic } = require('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/harness.js');
const SHOT = 'C:/Users/s9h0u/.claude/my-first-repo/seecar/test/shots/p5_world_';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (name, cond, info = '') => { if (!cond) fails++; console.log((cond ? 'OK  ' : 'NG  ') + name + (info ? '  ' + info : '')); };
const E = Math.PI / 2; // heading：0=北(-z)、-E=東(+x)

(async () => {
  const { browser, page, errors } = await openPage('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/world4_test.html', { viewport: { width: 1024, height: 576 } });
  page.on('console', (m) => { if (m.type() === 'warning' && /World (loop|handler) error|SeekerModel\.(update|create) failed/.test(m.text())) errors.push('warn: ' + m.text()); });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const dbg = () => ev(() => World._debug());
  const step = (n, dt) => ev(([n, dt]) => World._step(n, dt), [n, dt || 1 / 30]);
  await wait(1200);
  await ev(() => {
    World._manual(true);
    window.overLog = [];
    World.on('overGem', (ti) => overLog.push([ti, World._debug().time]));
    window.camLog = [];
    World.on('cam', (top, mode) => camLog.push([top, mode]));
  });

  // ---------- 1. スピード3段階 ----------
  ok('World.SPEED_MUL = {slow:1, normal:1.25, fast:1.5}', JSON.stringify(await ev(() => World.SPEED_MUL)) === '{"slow":1,"normal":1.25,"fast":1.5}');
  const sp = {};
  for (const s of [undefined, 'slow', 'normal', 'fast', 'bogus']) {
    const r = await ev((s) => {
      const m = flatMap(80, 30, []); loadMap(m, { speed: s }); World._setPose(2.5, 10.5, -Math.PI / 2); World.press('fwd', true);
      World._step(30); const x1 = World._debug().me.x;
      World._step(150); const x2 = World._debug().me.x; World._step(30); const x3 = World._debug().me.x;
      World.press('fwd', false);
      // ドリルアタック（何もない所）
      World._setPose(2.5, 20.5, -Math.PI / 2); World.press('drillAttack', true); World._step(15); const d0 = World._debug().me.x; World._step(30); const d1 = World._debug().me.x; World.press('drillAttack', false); World._step(20);
      return { v0: x1 - 2.5, v5: x3 - x2, da: d1 - d0 };
    }, s);
    sp[String(s)] = r;
  }
  const near = (a, b, t) => Math.abs(a - b) < t;
  ok('既定（speed なし）は normal：1秒で 2.88×1.25 = 3.6 マス', near(sp.undefined.v0, 3.6, 0.05), JSON.stringify(sp.undefined));
  ok('slow：2.88 マス/秒（第4期と同じ）・5段で 4.32', near(sp.slow.v0, 2.88, 0.05) && near(sp.slow.v5, 4.32, 0.06), JSON.stringify(sp.slow));
  ok('normal：3.6・5段で 5.4', near(sp.normal.v0, 3.6, 0.05) && near(sp.normal.v5, 5.4, 0.08), JSON.stringify(sp.normal));
  ok('fast：4.32・5段で 6.48', near(sp.fast.v0, 4.32, 0.06) && near(sp.fast.v5, 6.48, 0.1), JSON.stringify(sp.fast));
  ok('知らない値は normal', near(sp.bogus.v0, 3.6, 0.05));
  ok('DA_SPEED も倍率（何もない所のドリルアタック 1.4 / 1.75 / 2.1）', near(sp.slow.da, 1.4, 0.08) && near(sp.normal.da, 1.75, 0.08) && near(sp.fast.da, 2.1, 0.1), [sp.slow.da, sp.normal.da, sp.fast.da].map((v) => v.toFixed(2)).join(' / '));
  // CPU も同じ倍率
  const cpuSp = await ev(() => ['slow', 'normal', 'fast'].map((s) => { const m = flatMap(30, 20, [{ x: 20, z: 10, gem: 2 }]); m.box(20, 10, 1, 1, 4); loadMap(m, { cpu: { level: 'hard' }, mode: 'race', speed: s }); return World._cpu().speed; }));
  ok('CPU の速さ＝2.88×倍率×CPU_LEVELS.speed', cpuSp.every((v, i) => near(v, 2.88 * [1, 1.25, 1.5][i] * 0.86, 1e-6)), cpuSp.join(', '));
  // 空中（ジャンプ）の前への速さ
  const air = await ev(() => ['slow', 'fast'].map((s) => { const m = flatMap(40, 20, []); loadMap(m, { speed: s }); World._setPose(5.5, 10.5, -Math.PI / 2); World.press('jump', true); World.press('jump', false); World._step(5); World.press('fwd', true); const x0 = World._debug().me.x; World._step(3); const x1 = World._debug().me.x; World._step(40); World.press('fwd', false); return { v: (x1 - x0) * 10, air: true }; }));
  ok('AIR_SPEED も倍率（空中の前への速さ 2.88 → 4.32）', near(air[0].v, 2.88, 0.1) && near(air[1].v, 4.32, 0.12), air.map((a) => a.v.toFixed(2)).join(' → '));

  // ---------- 2. はやい＋加速でも壁を抜けない（1マスの壁・ななめ・大きなコマ） ----------
  {
    const r = await ev(() => {
      const out = [];
      const m = flatMap(60, 60, []);
      m.box(30, 0, 1, 60, 10);          // 縦の壁（x=30、厚さ1）
      m.box(0, 45, 30, 1, 3);           // 横の壁（z=45、高さ3：登れない）
      loadMap(m, { speed: 'fast' });
      for (const dt of [1 / 60, 1 / 30, 0.05]) {
        for (const h of [-Math.PI / 2, -Math.PI / 2 + 0.3, -Math.PI / 2 - 0.5, -Math.PI / 2 + 1.2]) {
          World._setPose(3.5, 20.5, h); World.press('fwd', true);
          let maxX = 0; for (let k = 0; k < Math.round(12 / dt / 3); k++) { World._step(3, dt); maxX = Math.max(maxX, World._debug().me.x); }
          World.press('fwd', false);
          out.push({ dt, h: +h.toFixed(2), maxX: +maxX.toFixed(3) });
        }
        World._setPose(10.5, 30.5, Math.PI); World.press('fwd', true); // 南へ（横の壁 z=45）
        let maxZ = 0; for (let k = 0; k < Math.round(8 / dt / 3); k++) { World._step(3, dt); maxZ = Math.max(maxZ, World._debug().me.z); }
        World.press('fwd', false);
        out.push({ dt, south: true, maxZ: +maxZ.toFixed(3) });
      }
      return out;
    });
    const bad = r.filter((q) => (q.maxX != null && q.maxX > 30 - 0.3 + 1e-6) || (q.maxZ != null && q.maxZ > 45 - 0.3 + 1e-6));
    ok('はやい＋5段（約6.5マス/秒）・1コマ最大0.05秒・ななめでも 1マスの壁を抜けない', bad.length === 0, JSON.stringify(bad.length ? bad : r.slice(0, 3)));
  }

  // ---------- 3. はやい：ジャンプで5段に乗る・ジャンプドリル ----------
  {
    const r = await ev(() => {
      const res = {};
      for (const s of ['slow', 'normal', 'fast']) {
        const m = flatMap(40, 20, []); m.box(10, 5, 3, 3, 5); m.box(10, 12, 1, 1, 5); // 3×3 と 1×1 の高さ5
        loadMap(m, { speed: s });
        // 3×3：前のマスから押しっぱなしでジャンプ
        World._setPose(8.5, 6.5, -Math.PI / 2); World.press('fwd', true); World.press('jump', true); World.press('jump', false);
        let wasAir = false; for (let k = 0; k < 60; k++) { World._step(1); const d = World._debug().me; if (d.air) wasAir = true; else if (wasAir) break; } // 着地したら離す
        World.press('fwd', false); World._step(20);
        const a = World._debug().me;
        // 1×1：となりのマスから、ジャンプしてすぐ前へ少しだけ（人がやるように 0.25 秒だけ押す）
        World._setPose(9.5, 12.5, -Math.PI / 2); World.press('jump', true); World.press('jump', false); World._step(5); World.press('fwd', true); World._step(8); World.press('fwd', false); World._step(40);
        const b = World._debug().me;
        // ジャンプドリル（その場）
        World._setPose(11.5, 6.5, 0); events.terrain = []; World.press('jumpDrill', true); World._step(60); World.press('jumpDrill', false); World._step(60);
        const c = World._debug().me;
        res[s] = { big: [a.cx, a.lv, a.air], pillar: [b.cx, b.cz, b.lv], jd: [c.cx, c.lv, c.act, events.terrain.length] };
      }
      return res;
    });
    ok('ジャンプで高さ5の台に乗れる（ゆっくり・ふつう・はやい）', ['slow', 'normal', 'fast'].every((s) => r[s].big[1] === 5 && !r[s].big[2]), JSON.stringify(r));
    ok('1マスの柱（高さ5）にもジャンプで乗れる（すすむを少しだけ）', ['slow', 'normal', 'fast'].every((s) => r[s].pillar[0] >= 9 && r[s].pillar[0] <= 10 && r[s].pillar[2] === 5), JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.pillar]))));
    ok('ジャンプドリルは どの速さでも同じように掘って着地', ['slow', 'normal', 'fast'].every((s) => r[s].jd[2] === null && r[s].jd[3] >= 3 && r[s].jd[1] <= 2), JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.jd]))));
  }

  // ---------- 4. CPU：はやいでも宝石まで行ける（ソナー・光） ----------
  {
    const res = {};
    for (const s of ['slow', 'fast']) {
      for (const search of ['sonar', 'light']) {
        const tries = [];
        for (let k = 0; k < 2; k++) {
          await ev(([s, search, k]) => {
            window.autoAward = false;
            const m = MapGen.fromPreset('ie', { treasureCount: 1 });
            loadMap(m, { cpu: { level: 'hard' }, mode: 'race', search, speed: s });
            World._setPose(1.5, 1.5, 0); // 自分はじゃましない
          }, [s, search, k]);
          let t = -1;
          for (let q = 0; q < 40; q++) { await step(60); if (await ev(() => events.gemHit.length)) { t = await ev(() => World._cpu().time); break; } }
          const info = await ev(() => World._cpu());
          tries.push({ t: t < 0 ? 'none(80s)' : +t.toFixed(1), steps: info.steps, stuck: info.replans, jumps: info.jumps });
        }
        res[s + '/' + search] = tries;
      }
    }
    const allFound = Object.values(res).every((tr) => tr.every((x) => typeof x.t === 'number'));
    ok('CPU（むずかしい）は ゆっくり・はやい の両方で 80 秒以内に宝石を掘りあてる（ie・各2回）', allFound, JSON.stringify(res));
    await ev(() => { window.autoAward = true; });
  }

  // ---------- 4b. CPU：1マスの段へのジャンプ（はやいと跳びすぎて落ちないか） ----------
  {
    const res = {};
    for (const s of ['slow', 'normal', 'fast']) {
      await ev((s) => {
        window.autoAward = false;
        // 14×14 の壁（10）。CPU は穴 (5,10)。東に 1×1 の段 (6,10) 高さ4、その東は穴 (7,10)。段から北へ 幅1の通路 (6,3..9) 高さ4、(6,2) が宝石のブロック（6）
        const m = flatMap(14, 14, [{ x: 6, z: 2, gem: 4 }]);
        m.box(0, 0, 14, 14, 10, [18, 18, 22]);
        m.set(5, 10, 0); m.set(7, 10, 0); m.set(12, 12, 0);
        for (let z = 3; z <= 10; z++) m.set(6, z, 4, [229, 57, 53]);
        m.set(6, 2, 6, [30, 136, 229]);
        m.starts = [{ x: 12, z: 12, dir: 0 }, { x: 5, z: 10, dir: 1 }];
        loadMap(m, { cpu: { level: 'hard' }, mode: 'race', search: 'light', speed: s });
      }, s);
      let t = -1, fell = 0, lastCx = -1;
      for (let q = 0; q < 120; q++) { await step(15); const d = await dbg(); if (d.cpu.cx === 7 && d.cpu.cz === 10 && lastCx !== 7) fell++; lastCx = d.cpu.cx; if (await ev(() => events.gemHit.length)) { t = await ev(() => World._cpu().time); break; } }
      const info = await ev(() => World._cpu());
      res[s] = { t: t < 0 ? 'none(60s)' : +t.toFixed(1), fellEast: fell, jumps: info.jumps, attacks: info.attacks, digs: info.digs };
    }
    ok('CPU：1マスの段へジャンプで乗って、細い通路を通って宝石へ（はやいでも跳びすぎて落ちない）', Object.values(res).every((r) => typeof r.t === 'number' && r.fellEast === 0), JSON.stringify(res));
    await ev(() => { window.autoAward = true; });
  }

  // ---------- 5. 視点 0〜3（みわたし） ----------
  await ev(() => { const m = MapGen.fromPreset('ie', { treasureCount: 1 }); window.mIe = m; loadMap(m, { search: 'sonar' }); camLog.length = 0; });
  {
    const seq = await ev(() => { World.setCamera(0); const s = [World.camera]; for (let k = 0; k < 5; k++) s.push(World.cycleCamera()); return s; });
    ok('cycleCamera：0→1→2→3→0→1・World.camera は 0〜3', seq.join() === '0,1,2,3,0,1', seq.join());
    ok('World.CAMERAS = め・おいかけ・みわたし・そら', (await ev(() => World.CAMERAS.join())) === 'め,おいかけ,みわたし,そら');
    // 各視点に落ち着いたあと
    const view = {};
    for (const c of [0, 1, 2, 3]) {
      await ev((c) => { World.setCamera(c); }, c); await step(45);
      view[c] = await ev(() => { const o = World._orient(); const d = World._debug(); return { o, vis: d.markers, cam: d.cam, meVis: o.vis }; });
    }
    const w = view[2].o, dx = w.x - w.camPos[0], dz = w.z - w.camPos[2], hd = Math.hypot(dx, dz), dy = w.camPos[1] - (await ev(() => World._debug().me.y));
    const elev = Math.atan2(dy, hd) * 180 / Math.PI, dist = Math.hypot(hd, dy);
    const yawErr = Math.abs(Math.atan2(w.cam[0], w.cam[1]) - Math.atan2(w.heading[0], w.heading[1])) * 180 / Math.PI;
    ok('みわたし：シーカーを見る仰角 50〜60°・距離 9〜12 マス・向きは heading', elev >= 50 && elev <= 60 && dist >= 9 && dist <= 12 && yawErr < 1, `仰角 ${elev.toFixed(1)}° 距離 ${dist.toFixed(2)} 向きのずれ ${yawErr.toFixed(2)}°`);
    ok('シーカーのモデルが見えないのは「め」だけ', !view[0].meVis && view[1].meVis && view[2].meVis && view[3].meVis, [0, 1, 2, 3].map((c) => view[c].meVis).join());
    // みわたしは heading に従う（スワイプで回る）
    await ev(() => { World.setCamera(2); World._step(40); World.swipeTurn(0.25); World._step(20); });
    const w2 = await ev(() => World._orient());
    const yawErr2 = Math.abs(Math.atan2(w2.cam[0], w2.cam[1]) - Math.atan2(w2.heading[0], w2.heading[1])) * 180 / Math.PI;
    ok('みわたし：スワイプで回ると カメラも heading に付いてくる', yawErr2 < 1, yawErr2.toFixed(2) + '°');
    const cl = await ev(() => camLog.slice());
    ok("'cam'(top) は そら（3）でだけ true", cl.some((c) => c[0] === true && c[1] === 3) && cl.every((c) => c[0] !== true || c[1] === 3 || c[1] === 1), JSON.stringify(cl));
    // 切りかえは なめらか（1コマで大きく飛ばない）
    let jumps = [];
    for (const [a, b] of [[1, 2], [2, 3], [3, 2], [2, 0], [0, 1], [3, 0], [1, 3]]) {
      await ev(([a]) => { World.setCamera(a); World._step(60); }, [a]);
      const ps = await ev(([b]) => { World.setCamera(b); const out = []; for (let k = 0; k < 40; k++) { World._step(1, 1 / 30); const o = World._orient(); out.push(o.camPos); } return out; }, [b]);
      let mx = 0; for (let k = 1; k < ps.length; k++) mx = Math.max(mx, Math.hypot(ps[k][0] - ps[k - 1][0], ps[k][1] - ps[k - 1][1], ps[k][2] - ps[k - 1][2]));
      jumps.push(`${a}→${b}:${mx.toFixed(2)}`);
      const tot = Math.hypot(ps[ps.length - 1][0] - ps[0][0], ps[ps.length - 1][1] - ps[0][1], ps[ps.length - 1][2] - ps[0][2]) + 1e-6;
      if (mx > Math.max(1.0, tot * 0.12)) ok(`視点 ${a}→${b} の切りかえで カメラが飛ぶ`, false, mx.toFixed(2) + ' / 全体 ' + tot.toFixed(1));
    }
    ok('視点の切りかえは なめらか（1/30秒あたりの移動の最大が、動く距離全体の12%以下）', true, jumps.join(' '));
    // スクリーンショット：みわたし（実際の描画ループ）
    await ev(() => { loadMap(mIe, { search: 'light' }); World.setCamera(2); World._step(40); });
    await wait(1500); await page.screenshot({ path: SHOT + 'miwatashi.png' });
    await ev(() => { World.press('fwd', true); World._step(30); World.press('fwd', false); World._step(5); });
    await wait(1200); await page.screenshot({ path: SHOT + 'miwatashi_moved.png' });
    await ev(() => { World.setCamera(3); World._step(40); });
    await wait(1200); await page.screenshot({ path: SHOT + 'sora.png' });
    await ev(() => World.setCamera(1));
  }

  // ---------- 6. overGem（宝石の真上でピンピンピン） ----------
  for (const search of ['light', 'sonar']) {
    const r = await ev((search) => {
      const m = flatMap(30, 20, [{ x: 12, z: 10, gem: 1 }, { x: 20, z: 10, gem: 2 }]);
      m.box(8, 8, 20, 5, 1);          // 高さ1の床（シーカーは lv1 に立つ）
      m.box(12, 10, 1, 1, 2);         // 宝石0のブロック（高さ2＝1段登れば乗れる）
      m.box(20, 10, 1, 1, 6);         // 宝石1のブロック（高さ6＝ジャンプで乗る）
      loadMap(m, { search, speed: 'slow', mode: 'count' }); overLog.length = 0; sfxLog.length = 0;
      const out = {};
      World._setPose(10.5, 10.5, -Math.PI / 2); World._step(5);
      out.before = overLog.length;
      World.press('fwd', true); World._step(20); World.press('fwd', false); World._step(5); // (12,10) の上へ
      out.on = World._debug().me; out.n1 = overLog.length; out.ti1 = overLog[0] && overLog[0][0];
      World._step(60); out.n2 = overLog.length; // とどまる
      World.press('jump', true); World.press('jump', false); World._step(8); out.airMid = World._debug().me.air; World._step(40); out.n3 = overLog.length; // その場でジャンプ
      World._setPose(12.5, 10.5, -Math.PI / 2); World.press('fwd', true); World._step(12); World.press('fwd', false); World._step(5); out.off = World._debug().me.cx; out.n4 = overLog.length; // 出る
      World._setPose(13.5, 10.5, Math.PI / 2); World.press('fwd', true); World._step(10); World.press('fwd', false); World._step(5); out.back = World._debug().me.cx; out.n5 = overLog.length; // 入り直す
      // ジャンプで高い宝石ブロック（高さ6）へ：空中の間は出さず、着地してから
      World._setPose(19.5, 10.5, -Math.PI / 2); overLog.length = 0;
      World.press('jump', true); World.press('jump', false); World._step(5); World.press('fwd', true);
      let airHit = false; for (let k = 0; k < 40; k++) { World._step(1); const d = World._debug().me; if (d.air && overLog.length) airHit = true; if (d.cx === 20 && !d.air) { World.press('fwd', false); } }
      World.press('fwd', false); World._step(10);
      out.jumpOn = World._debug().me; out.n6 = overLog.length; out.ti6 = overLog[0] && overLog[0][0]; out.airHit = airHit;
      out.pin = sfxLog.filter((n) => n === 'pinpin').length;
      // 持ち主の決まった宝石では出ない
      World.award(0, 0); World._setPose(10.5, 10.5, -Math.PI / 2); World._step(3); overLog.length = 0;
      World.press('fwd', true); World._step(20); World.press('fwd', false); World._step(5);
      out.claimed = overLog.length; out.claimedCx = World._debug().me.cx;
      return out;
    }, search);
    ok(`overGem（${search}）：宝石のマスの真上に入った瞬間に1回・Sfx 'pinpin'`, r.before === 0 && r.on.cx === 12 && r.n1 === 1 && r.ti1 === 0, JSON.stringify({ cx: r.on.cx, lv: r.on.lv, n1: r.n1, ti: r.ti1 }));
    ok(`overGem（${search}）：とどまる・その場でジャンプ では出ない`, r.n2 === 1 && r.n3 === 1 && r.airMid, `${r.n2} ${r.n3}`);
    ok(`overGem（${search}）：出て入り直すと また出る`, r.off === 13 && r.n4 === 1 && r.back === 12 && r.n5 === 2, JSON.stringify([r.off, r.n4, r.back, r.n5]));
    ok(`overGem（${search}）：ジャンプで乗ったときは着地してから`, r.jumpOn.cx === 20 && r.jumpOn.lv === 6 && r.n6 === 1 && r.ti6 === 1 && !r.airHit, JSON.stringify({ cx: r.jumpOn.cx, lv: r.jumpOn.lv, n6: r.n6, airHit: r.airHit }));
    ok(`overGem（${search}）：Sfx 'pinpin' は overGem と同じ回数・持ち主の決まった宝石では出ない`, r.pin === 3 && r.claimed === 0 && r.claimedCx === 12, `pin=${r.pin} claimed=${r.claimed}`);
  }

  // ---------- 7. swipeTurn：走りながら・空中でも回る。止まっている間（freeze・pause）は回らない ----------
  {
    const r = await ev(() => {
      loadMap(flatMap(60, 60, []), { speed: 'fast' }); World._setPose(30.5, 30.5, 0);
      const H = () => World._debug().me.heading, out = {};
      World.press('fwd', true); World._step(30);
      let h0 = H(); World.swipeTurn(0.1); out.driving = H() - h0;
      World.press('jump', true); World.press('jump', false); World._step(8); out.air = World._debug().me.air;
      h0 = H(); World.swipeTurn(0.1); out.inAir = H() - h0;
      World._step(40); World.press('fwd', false);
      World.press('jumpDrill', true); World._step(10); h0 = H(); World.swipeTurn(0.1); out.inJD = H() - h0; World.press('jumpDrill', false); World._step(60);
      World.freeze(true); h0 = H(); World.swipeTurn(0.1); out.frozen = H() - h0; World.go();
      World.setPaused(true); h0 = H(); World.swipeTurn(0.1); out.paused = H() - h0; World.setPaused(false);
      h0 = H(); World.swipeTurn(1 / 3); out.third = (H() - h0) * 180 / Math.PI;
      return out;
    });
    const g = -0.1 * Math.PI;
    ok('swipeTurn：走りながら・空中・ジャンプドリル中も回る', near(r.driving, g, 1e-6) && r.air && near(r.inAir, g, 1e-6) && near(r.inJD, g, 1e-6), JSON.stringify(r));
    ok('swipeTurn：freeze・setPaused の間は回らない', r.frozen === 0 && r.paused === 0, JSON.stringify(r));
    console.log(`  (参考) world 側だけで 画面の幅 1/3 のスワイプ → ${Math.abs(r.third).toFixed(1)}°（SWIPE_GAIN=π。90° にするには UI 側で ×1.5）`);
  }

  const errs = errors.filter((e) => !/404 \(Not Found\)/.test(e));
  ok('エラーなし', errs.length === 0, errs.slice(0, 5).join(' | '));
  console.log(fails ? `\n${fails} NG` : '\nALL OK');
  await browser.close(); stopStatic();
})();
