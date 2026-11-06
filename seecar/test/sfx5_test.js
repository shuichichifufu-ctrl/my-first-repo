// Sfx（第5期）の自動検査。node sfx5_test.js [書き出し先フォルダ]
// ・プレイ曲4つ（genki/yukai/nonbiri/iyashi）と古い名前 play1〜3 が鳴る。PLAY_TRACKS の形
// ・すばやい切り替え・bgm(null)・pause・stopAll・preview で曲が重なったまま残らない
// ・pinpin が鳴る／1秒以内の2回目は鳴らない／長さ・音割れ・高音の割合
// ・各曲を OfflineAudioContext で1周書き出して、RMS と K 特性の大きさ（LUFS 近似）を比べる
const path = require('path');
const fs = require('fs');
const HARNESS = 'C:/Users/s9h0u/.claude/my-first-repo/seecar/test/harness.js';
const { openPage, stopStatic } = require(HARNESS);
const { chromium } = require('module').createRequire(HARNESS)('playwright');

const OUT = process.argv[2] || path.join(__dirname, 'shots', 'audio5');
const results = [];
function check(name, ok, info) { results.push({ name, ok: !!ok, info }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }

(async () => {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: false,
    args: ['--headless=new', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const { page, errors } = await openPage('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/sfx5_test.html', { browser });
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // 0) 公開の形
  const api = await ev(() => ({
    pt: Sfx.PLAY_TRACKS, preview: typeof Sfx.preview,
    tracks: Sfx.TRACKS.map((t) => ({ n: t.name, loop: t.loop, bars: Math.max(...t.parts.map((p) => (Array.isArray(p.notes) ? p.notes.length : 1))), tempo: t.tempo }))
  }));
  check('PLAY_TRACKS の形', JSON.stringify(api.pt) === JSON.stringify([{ name: 'genki', label: 'げんき' }, { name: 'yukai', label: 'ゆかい' }, { name: 'nonbiri', label: 'のんびり' }, { name: 'iyashi', label: 'いやし' }]), api.pt);
  check('preview がある', api.preview === 'function');
  const byName = Object.fromEntries(api.tracks.map((t) => [t.n, t]));
  check('4曲と古い名前が TRACKS にあり、ループで16小節以上', ['genki', 'yukai', 'nonbiri', 'iyashi', 'play1', 'play2', 'play3'].every((n) => byName[n] && byName[n].loop && byName[n].bars >= 16),
    ['genki', 'yukai', 'nonbiri', 'iyashi'].map((n) => byName[n]));
  check('genki のテンポ 130〜145', byName.genki.tempo >= 130 && byName.genki.tempo <= 145, byName.genki.tempo);

  // 譜面の小節のマス数（第4期と同じ検査）
  const bars = await ev(() => {
    const bad = [];
    Sfx.TRACKS.forEach((t) => {
      const per = (t.beatsPerBar || 4) * (t.stepsPerBeat || 2);
      t.parts.forEach((p, pi) => (Array.isArray(p.notes) ? p.notes : [p.notes]).forEach((b, bi) => {
        if (typeof b !== 'string') { bad.push(t.name + ' part' + pi + ' bar' + (bi + 1) + ': not string'); return; }
        const n = b.trim().split(/\s+/).length;
        const last = bi === p.notes.length - 1;
        if (n !== per && !(t.loop === false && last && n < per)) bad.push(t.name + ' part' + pi + ' bar' + (bi + 1) + ': ' + n);
      }));
    });
    return bad;
  });
  check('譜面の小節のマス数', bars.length === 0, bars);

  // unlock 前の preview / pinpin は何もしない
  const pre = await ev(() => { Sfx.preview('genki'); Sfx.play('pinpin'); Sfx.bgm('genki'); return { created: __cnt.created, dbg: Sfx._debug() }; });
  check('unlock 前は何もしない', pre.created === 0 && !pre.dbg.ready, pre);
  await ev(() => { Sfx.unlock(); });   // unlock 前に頼んだ genki が鳴り始める
  await page.waitForTimeout(800);
  const st = await ev(() => Sfx._debug());
  check('unlock 前に頼んだ曲が unlock で鳴る', st.ready && st.song === 'genki' && st.sources > 0, st);

  // 1) 4曲と古い名前がそれぞれ鳴る
  const each = await ev(async () => {
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    for (const n of ['genki', 'yukai', 'nonbiri', 'iyashi', 'play1', 'play2', 'play3']) {
      Sfx.bgm(n); await sl(2500);
      const d = Sfx._debug(); out[n] = { song: d.song, owners: d.owners, sources: d.sources };
    }
    return out;
  });
  check('4曲と play1〜3 がそれぞれ鳴る（前の曲は消えて持ち主は1つ）', Object.keys(each).every((n) => each[n].song === n && each[n].sources > 0 && each[n].owners === 1), each);

  // 2) すばやい切り替え（設定画面で次々にタップ）
  const fast = await ev(async () => {
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    const seq = ['genki', 'yukai', 'nonbiri', 'iyashi', 'genki', 'iyashi', 'yukai', 'nonbiri', 'genki', 'yukai'];
    let maxOwners = 0, maxFading = 0;
    for (const n of seq) {
      Sfx.bgm(n); await sl(120);
      const d = Sfx._debug(); maxOwners = Math.max(maxOwners, d.owners); maxFading = Math.max(maxFading, d.fading);
    }
    await sl(700);
    const settled = Sfx._debug();
    return { maxOwners, maxFading, settled };
  });
  // 持ち主の数＝いまの曲＋ゆっくり消える前の曲1つ＋0.12秒で急いで消している曲（ほぼ無音）まで
  check('すばやい切り替え中も、消えかけの曲は1つまで（持ち主は3つまで）', fast.maxOwners <= 3 && fast.maxFading <= 1, fast);
  check('切り替えのあと0.7秒で最後の曲だけ', fast.settled.song === 'yukai' && fast.settled.owners === 1 && fast.settled.fading === 0, fast.settled);

  // 3) bgm(null)
  const nul = await ev(async () => {
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    Sfx.bgm('genki'); await sl(100); Sfx.bgm('iyashi'); await sl(100); Sfx.bgm(null); await sl(1200);
    return { active: __cnt.active, dbg: Sfx._debug() };
  });
  check('切り替え直後の bgm(null) で全部消える', nul.active === 0 && nul.dbg.owners === 0 && !nul.dbg.timer && !nul.dbg.song, nul);

  // 4) pause 中の切り替え
  const pz = await ev(async () => {
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    Sfx.bgm('genki'); await sl(1500);
    Sfx.pause(true); await sl(100);
    Sfx.bgm('yukai'); await sl(100); Sfx.bgm('iyashi'); await sl(1200);
    const during = { active: __cnt.active, dbg: Sfx._debug() };
    Sfx.pause(false); await sl(1000);
    const after = { active: __cnt.active, dbg: Sfx._debug() };
    return { during, after };
  });
  check('pause 中に曲を替えても鳴らない', pz.during.active === 0 && pz.during.dbg.song === 'iyashi', pz.during);
  check('pause(false) で最後に選んだ曲だけが鳴る', pz.after.active > 0 && pz.after.dbg.song === 'iyashi' && pz.after.dbg.owners === 1, pz.after);

  // 5) preview：数秒で前の曲に戻る／途中の bgm が優先／stopAll で戻らない／続けて呼ぶと最後のものだけ
  const pv = await ev(async () => {
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    const r = {};
    Sfx.bgm('title'); await sl(600);
    Sfx.preview('yukai', 1.2); await sl(300); r.during = Sfx._debug().song;
    await sl(1300); r.back = Sfx._debug(); await sl(700); r.backOwners = Sfx._debug().owners;
    Sfx.preview('genki', 1.0); await sl(200); Sfx.preview('iyashi', 1.0); await sl(200); Sfx.preview('nonbiri', 1.0); await sl(300);
    r.chain = Sfx._debug().song; await sl(1100); r.chainBack = Sfx._debug();
    Sfx.preview('genki', 1.0); await sl(300); Sfx.bgm('iyashi'); await sl(1300); r.override = Sfx._debug();
    Sfx.preview('yukai', 1.0); await sl(300); Sfx.stopAll(); await sl(1300); r.stop = { dbg: Sfx._debug(), active: __cnt.active };
    return r;
  });
  check('preview 中はその曲', pv.during === 'yukai', pv.during);
  check('preview が終わると前の曲に戻る', pv.back.song === 'title' && !pv.back.preview && pv.backOwners === 1, pv.back);
  check('preview を続けて呼ぶと最後の曲 → 最初の曲に戻る', pv.chain === 'nonbiri' && pv.chainBack.song === 'title' && pv.chainBack.owners <= 2, pv);
  check('preview 中の bgm() が優先（あとで戻らない）', pv.override.song === 'iyashi' && !pv.override.preview, pv.override);
  check('preview 中の stopAll で何も戻らない', !pv.stop.dbg.song && pv.stop.active === 0 && pv.stop.dbg.owners === 0, pv.stop);

  // 6) jingle は preview を止める
  const jp = await ev(async () => {
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    Sfx.bgm('title'); Sfx.preview('genki', 1.0); await sl(200); Sfx.jingle('win'); await sl(1500);
    const d = Sfx._debug(); await sl(4000);
    return { mid: d, end: { dbg: Sfx._debug(), active: __cnt.active } };
  });
  check('preview 中の jingle で曲は戻らない', !jp.mid.song && !jp.mid.preview && !jp.end.dbg.song && jp.end.active === 0, jp);

  // 7) pinpin
  const pp = await ev(async () => {
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    const c0 = __cnt.created; Sfx.play('pinpin'); const c1 = __cnt.created;
    await sl(500); Sfx.play('pinpin'); const c2 = __cnt.created;
    await sl(700); Sfx.play('pinpin'); const c3 = __cnt.created;
    await sl(1500);
    return { first: c1 - c0, within1s: c2 - c1, after1_2s: c3 - c2, end: { active: __cnt.active, owners: Sfx._debug().owners } };
  });
  check('pinpin が鳴る', pp.first > 0, pp);
  check('pinpin は1秒以内の2回目を鳴らさない', pp.within1s === 0 && pp.after1_2s > 0, pp);
  check('pinpin が鳴り終わると音源が残らない', pp.end.active === 0 && pp.end.owners === 0, pp.end);

  check('ページのエラーなし（ここまで）', errors.length === 0, errors);

  // 8) 書き出し：1周ぶんの大きさ
  fs.mkdirSync(OUT, { recursive: true });
  const jobs = [
    ['bgm', 'genki', 24 * 4 * 60 / 138], ['bgm', 'yukai', 24 * 4 * 60 / 120], ['bgm', 'nonbiri', 16 * 4 * 60 / 82], ['bgm', 'iyashi', 16 * 4 * 60 / 72],
    ['bgm', 'play1', 16 * 4 * 60 / 116], ['bgm', 'play3', 16 * 4 * 60 / 124], ['bgm', 'title', 16 * 3 * 60 / 100],
    ['sfx', 'pinpin', 1.2], ['sfx', 'notice', 1.5], ['sfx', 'bump', 0.5], ['sfx', 'tap', 0.5]
  ];
  const table = [];
  for (const [kind, name, secs] of jobs) {
    const r = await ev(async ([k, n, sec]) => {
      const buf = await Sfx._render(k, n, sec + 0.1);
      const L = buf.getChannelData(0), sr = buf.sampleRate;
      let pk = 0; for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]));
      let lastLoud = 0; for (let i = 0; i < L.length; i++) if (Math.abs(L[i]) > pk * 0.03) lastLoud = i;   // ピークから -30dB まで
      return { lv: __levels(buf), kw: await __kweight(buf), wav: __wav(buf), tailSec: Math.round(lastLoud / sr * 100) / 100 };
    }, [kind, name, secs]);
    fs.writeFileSync(path.join(OUT, kind + '_' + name + '.wav'), Buffer.from(r.wav, 'base64'));
    table.push({ kind, name, secs: Math.round(secs * 10) / 10, ...r.lv, ...r.kw, tailSec: r.tailSec });
  }
  console.table(table);
  const T = Object.fromEntries(table.map((t) => [t.name, t]));
  const four = ['genki', 'yukai', 'nonbiri', 'iyashi'].map((n) => T[n]);
  const spreadK = Math.max(...four.map((t) => t.lufsish)) - Math.min(...four.map((t) => t.lufsish));
  const spreadR = Math.max(...four.map((t) => t.rmsDb)) - Math.min(...four.map((t) => t.rmsDb));
  check('4曲の聞こえの大きさ（K特性）の差が 2dB 以内', spreadK <= 2, { spreadK, spreadR, k: four.map((t) => [t.name, t.lufsish]) });
  const oldK = (T.play1.lufsish + T.play3.lufsish + T.nonbiri.lufsish) / 3, newK = four.reduce((a, t) => a + t.lufsish, 0) / 4;
  check('4曲の平均が 第4期の play 曲の平均から ±1.5dB', Math.abs(newK - oldK) <= 1.5, { oldK: Math.round(oldK * 10) / 10, newK: Math.round(newK * 10) / 10 });
  check('書き出しで音割れなし', table.every((t) => t.peakDb < -0.3), table.map((t) => [t.name, t.peakDb]));
  check('pinpin は 0.4〜0.9 秒で -30dB まで消える', T.pinpin.tailSec >= 0.4 && T.pinpin.tailSec <= 0.95, T.pinpin.tailSec);
  const bgmMax = Math.max(...four.map((t) => t.rmsDb));
  check('pinpin は BGM よりはっきり大きい（最も大きい300ms が BGM の RMS より 10dB 以上）', T.pinpin.loudest300msDb > bgmMax + 10, { pinpin: T.pinpin.loudest300msDb, bgmMax });
  check('pinpin の 5kHz より上は少ない（-20dB 未満）', T.pinpin.above5kDb < -20, T.pinpin.above5kDb);

  check('ページのエラーなし', errors.length === 0, errors);
  await browser.close(); stopStatic();
  const fails = results.filter((r) => !r.ok).length;
  console.log(fails ? fails + ' 件 失敗' : 'すべて合格');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
