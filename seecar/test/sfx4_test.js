// Sfx（第4期）の自動検査。node sfx4_test.js [書き出し先フォルダ]
// ・すべての関数を unlock 前／後に呼んでエラーが出ないこと
// ・engine() を同じ引数で600回呼んでも音源が増えないこと
// ・BGM の切り替え、stopAll、pause で鳴りっぱなしの音源が残らないこと
// ・OfflineAudioContext で各音を書き出し、ピーク・RMS を測る（WAV も保存）
const path = require('path');
const fs = require('fs');
const HARNESS = 'C:/Users/s9h0u/.claude/my-first-repo/seecar/test/harness.js';
const { openPage, stopStatic } = require(HARNESS);
const { chromium } = require('module').createRequire(HARNESS)('playwright');

const OUT = process.argv[2] || path.join(__dirname, 'shots', 'audio');
const results = [];
function check(name, ok, info) { results.push({ name, ok: !!ok, info }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }

(async () => {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: false,
    args: ['--headless=new', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const { page, errors } = await openPage('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/sfx4_test.html', { browser });
  const wait = (ms) => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // 1) unlock 前はすべて何もしない
  const pre = await ev(() => {
    const names = ['tap','count','go','jump','land','step','bump','break','drillHit','gemRise','fanfare','notice','move','turn','fire','boom','found','nope'];
    names.forEach((n) => Sfx.play(n));
    Sfx.engine('run', 3); Sfx.engine('drill', 0); Sfx.bgm('play1'); Sfx.jingle('win'); Sfx.pause(true); Sfx.pause(false); Sfx.stopAll();
    return { created: __cnt.created, dbg: Sfx._debug(), tracks: Sfx.TRACKS.length };
  });
  check('unlock前は音源を作らない', pre.created === 0 && pre.dbg.ready === false, pre);

  // 曲データ：各小節のマス数がそろっているか
  const bars = await ev(() => {
    const bad = [];
    Sfx.TRACKS.forEach((t) => {
      const per = (t.beatsPerBar || 4) * (t.stepsPerBeat || 2);
      t.parts.forEach((p, pi) => (Array.isArray(p.notes) ? p.notes : [p.notes]).forEach((b, bi) => {
        const n = b.trim().split(/\s+/).length;
        const last = bi === p.notes.length - 1;
        if (n !== per && !(t.loop === false && last && n < per)) bad.push(t.name + ' part' + pi + ' bar' + (bi + 1) + ': ' + n);
      }));
    });
    return bad;
  });
  check('譜面の小節のマス数', bars.length === 0, bars);

  // 2) unlock
  await ev(() => { Sfx.unlock(); });
  await wait(300);
  const st = await ev(() => Sfx._debug());
  check('unlock で AudioContext が動く', st.ready && st.state === 'running', st);

  // 3) 効果音すべて
  const c0 = await ev(() => __cnt.created);
  await ev(() => ['tap','count','go','jump','land','step','bump','break','drillHit','gemRise','fanfare','notice','move','turn','fire','boom','found','collect','dig'].forEach((n, i) => setTimeout(() => Sfx.play(n), i * 60)));
  await wait(1500);
  const c1 = await ev(() => __cnt.created);
  check('効果音がすべて鳴る（音源が作られる）', c1 - c0 > 100, { created: c1 - c0 });
  await wait(3500);
  const afterSfx = await ev(() => ({ active: __cnt.active, dbg: Sfx._debug() }));
  check('効果音が鳴り終わると音源が残らない', afterSfx.active === 0 && afterSfx.dbg.owners === 0, afterSfx);

  // 4) engine：600回同じ引数 → 新しい音源なし
  await ev(() => Sfx.engine('run', 2));
  await wait(200);
  const e0 = await ev(() => __cnt.created);
  await ev(() => { for (let i = 0; i < 600; i++) Sfx.engine('run', 2); });
  await wait(200);
  const e1 = await ev(() => ({ created: __cnt.created, dbg: Sfx._debug() }));
  check('engine 同じ引数600回で音源が増えない', e1.created === e0, { before: e0, after: e1.created, dbg: e1.dbg });
  // 段を変えても作り直さない、drill はキャタピラと重ならない
  const e2 = await ev(async () => {
    const before = __cnt.created;
    for (let s = 0; s <= 5; s++) { for (let k = 0; k < 60; k++) Sfx.engine('run', s); await new Promise((r) => setTimeout(r, 60)); }
    const afterStages = __cnt.created - before;
    Sfx.engine('turn', 0); await new Promise((r) => setTimeout(r, 200));
    Sfx.engine('drill', 0); await new Promise((r) => setTimeout(r, 1200));
    const d = Sfx._debug();
    Sfx.engine('air', 0); await new Promise((r) => setTimeout(r, 1300));
    const a = Sfx._debug();
    return { afterStages, drillOnly: d, air: a, active: __cnt.active };
  });
  check('段を変えても音源を作り直さない', e2.afterStages === 0, e2.afterStages);
  check('drill ではキャタピラが止まる（重ならない）', e2.drillOnly.drill && !e2.drillOnly.tread, e2.drillOnly);
  check('air ではループが消えて止まる', !e2.air.tread && !e2.air.drill && e2.active === 0, e2);

  // 5) BGM：同じ名前は続ける、切り替え、null
  const b = await ev(async () => {
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    Sfx.bgm('title'); await sl(1500);
    const s1 = __cnt.started;
    Sfx.bgm('title'); await sl(50);
    const same = Sfx._debug().song;
    const r = { same, scheduling: __cnt.started > s1 };
    Sfx.bgm('play1'); await sl(1200); r.p1 = Sfx._debug().song;
    Sfx.bgm('play2'); await sl(1200); r.p2 = Sfx._debug().song;
    Sfx.bgm('play3'); await sl(1200); r.p3 = Sfx._debug().song;
    r.owners3 = Sfx._debug().owners;
    Sfx.bgm(null); await sl(1500);
    r.afterNull = { active: __cnt.active, dbg: Sfx._debug() };
    return r;
  });
  check('bgm 同じ名前は続ける', b.same === 'title' && b.scheduling, b);
  check('bgm 切り替え', b.p1 === 'play1' && b.p2 === 'play2' && b.p3 === 'play3', b);
  check('bgm(null) のあと音源が残らない', b.afterNull.active === 0 && b.afterNull.dbg.owners === 0 && !b.afterNull.dbg.timer, b.afterNull);

  // 6) pause
  const p = await ev(async () => {
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    Sfx.bgm('play2'); Sfx.engine('run', 3); await sl(1500);
    Sfx.pause(true); await sl(800);
    const a = { active: __cnt.active, created: __cnt.created, dbg: Sfx._debug() };
    for (let i = 0; i < 100; i++) Sfx.engine('run', 3);
    await sl(1000);
    const b2 = { created: __cnt.created, active: __cnt.active };
    Sfx.pause(false); await sl(800);
    const c = { active: __cnt.active, dbg: Sfx._debug(), created: __cnt.created };
    return { paused: a, during: b2, resumed: c };
  });
  check('pause(true) で BGM とループの音源が止まる', p.paused.active === 0 && p.paused.dbg.paused, p.paused);
  check('一時停止中は音源を作らない', p.during.created === p.paused.created && p.during.active === 0, p.during);
  check('pause(false) で BGM とループが戻る', p.resumed.active > 0 && p.resumed.dbg.tread && p.resumed.dbg.song === 'play2', p.resumed);

  // 7) stopAll
  const s = await ev(async () => {
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    Sfx.engine('drill', 0); Sfx.play('fanfare'); Sfx.play('break'); await sl(300);
    const before = __cnt.active;
    Sfx.stopAll(); await sl(400);
    return { before, active: __cnt.active, dbg: Sfx._debug() };
  });
  check('stopAll で全部止まる', s.before > 0 && s.active === 0 && s.dbg.owners === 0 && !s.dbg.timer && !s.dbg.song, s);

  // 8) ジングル（BGM を止める）
  const j = await ev(async () => {
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    for (const n of ['win', 'lose', 'practice', 'peace']) {
      Sfx.bgm('play1'); Sfx.engine('run', 1); await sl(600);
      Sfx.jingle(n); await sl(300);
      out[n] = { song: Sfx._debug().song, tread: Sfx._debug().tread, active: __cnt.active };
    }
    await sl(12500);
    out.end = { active: __cnt.active, dbg: Sfx._debug() };
    return out;
  });
  check('jingle は BGM とループを止めて鳴る', ['win', 'lose', 'practice', 'peace'].every((n) => j[n].song === null && !j[n].tread && j[n].active > 0), j);
  check('jingle が終わると音源が残らない', j.end.active === 0 && j.end.dbg.owners === 0, j.end);

  // 9) muted
  const m = await ev(async () => {
    Sfx.muted = true; const c = __cnt.created; Sfx.play('tap'); Sfx.play('bump');
    const r = __cnt.created === c; Sfx.muted = false; return r;
  });
  check('muted のとき効果音を作らない', m);

  // 10) 書き出しと音量
  fs.mkdirSync(OUT, { recursive: true });
  const jobs = [
    ['sfx', 'tap', 0.5], ['sfx', 'count', 0.5], ['sfx', 'go', 1.2], ['sfx', 'jump', 0.8], ['sfx', 'land', 0.5], ['sfx', 'step', 0.5],
    ['sfx', 'bump', 0.5], ['sfx', 'break', 0.9], ['sfx', 'drillHit', 0.5], ['sfx', 'gemRise', 1.6], ['sfx', 'fanfare', 3.6], ['sfx', 'notice', 1.5],
    ['engine', 'run:0', 3], ['engine', 'run:5', 3], ['engine', 'turn:0', 3], ['engine', 'drill:0', 3],
    ['bgm', 'title', 30], ['bgm', 'play1', 34], ['bgm', 'play2', 47], ['bgm', 'play3', 32],
    ['jingle', 'win', 4.5], ['jingle', 'lose', 6], ['jingle', 'practice', 5.5], ['jingle', 'peace', 9.5],
    ['mix', 'play1', 9]
  ];
  const table = [];
  for (const [kind, name, secs] of jobs) {
    const r = await ev(async ([k, n, sec]) => {
      const buf = await Sfx._render(k, n, sec);
      return { lv: __levels(buf), wav: __wav(buf) };
    }, [kind, name, secs]);
    const file = path.join(OUT, kind + '_' + name.replace(':', '-') + '.wav');
    fs.writeFileSync(file, Buffer.from(r.wav, 'base64'));
    table.push({ kind, name, ...r.lv });
  }
  console.table(table);
  const clip = table.filter((t) => t.peakDb > -0.3);
  check('書き出しで音割れなし（ピーク < -0.3dBFS）', clip.length === 0, clip.map((t) => t.name));
  const bgmMax = Math.max(...table.filter((t) => t.kind === 'bgm').map((t) => t.rmsDb));
  const sfxMain = table.filter((t) => t.kind === 'sfx' && ['bump', 'break', 'jump', 'step', 'drillHit', 'land'].includes(t.name));
  const sfxMin = Math.min(...sfxMain.map((t) => t.loudest300msDb));
  check('BGM の RMS は効果音（最も大きい300ms）よりはっきり小さい', bgmMax < sfxMin - 6, { bgmMaxRms: bgmMax, sfxMinLoudest: sfxMin });

  check('ページのエラーなし', errors.length === 0, errors);
  await browser.close(); stopStatic();
  const fails = results.filter((r) => !r.ok).length;
  console.log(fails ? fails + ' 件 失敗' : 'すべて合格');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
