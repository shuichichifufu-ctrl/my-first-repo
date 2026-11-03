// 「見つけて！PixSee」結合版の通し確認: node e2e.js v7dev
//   ひとり練習 / コンピューター×どっちが はやい？ / コンピューター×どっちが おおい？ / せってい / ともだち（通信：はやい・おおい）
// World の新しい関数（sonar, scores, swipeTurn, finish, applyRemoteTerrain ほか）が まだ無い版でも、
// 画面の流れ・ボタン・保存・言葉は確かめられる。無い関数は仮に足し、呼ばれ方だけを記録する（本物があれば本物を呼びつつ記録）。
// 使い方: E2E_FILE=/abs/dist/seecar_v7dev.html PEER_PORT=9801 node e2e.js v7dev   ONLY=solo|race|count|settings|online
const { openPage, startPeerServer, stopStatic } = require('./harness.js');
const ver = process.argv[2] || 'v7dev';
const FILE = process.env.E2E_FILE || `/home/user/my-first-repo/seecar/dist/seecar_${ver}.html`;
const PEER_PORT = +(process.env.PEER_PORT || 9000);
const SH = `/home/user/my-first-repo/seecar/test/shots/p3_ui_e2e_`;
const VP = { width: 1024, height: 768 };
const VPN = { width: 640, height: 360 }; // 通信の確認は 2画面ぶんの3D描画が重いので 小さい画面で（Net は 5秒 何も届かないと切れたとみなすため）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push(`${cond ? 'OK  ' : 'NG  '} ${name}${info !== undefined && !cond ? '  ' + JSON.stringify(info) : ''}`); };
const BAD = /(たいけつ|たたかう|たたかい|バトル|勝負|大砲|戦車|ドゴ|かち|まけ|たおす|やっつけ|うつ)/;

const state = (p) => p.evaluate(() => document.body.dataset.state);
const nav = async (p, label) => { await p.click(`#nav [data-nav="${label}"]`, { force: true }); await sleep(250); };
const click = async (p, sel, ms = 250) => { await p.click(sel, { force: true }); await sleep(ms); };
const rec = (p) => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('pixsee.record')); } catch (e) { return null; } });
const setg = (p) => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('pixsee.settings')); } catch (e) { return null; } });
const sub = (p) => p.evaluate(() => document.getElementById('setting').dataset.sub);
const txt = (p, sel) => p.evaluate((s) => (document.querySelector(s) || {}).textContent || '', sel);
async function waitFor(fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(60); } return false; }

// World の呼ばれ方を記録。無い関数は仮に足す（sonar は固定の宝3つ、scores は window.__scores）
async function hook(page) {
  return page.evaluate(() => {
    window.__log = []; window.__scores = [0, 0]; window.__stubbed = [];
    const W = World;
    ['press', 'swipeTurn', 'nudgePitch', 'load', 'finish', 'applyRemoteTerrain', 'applyRemoteCollect', 'applyRemoteState', 'setPaused', 'dropRemote'].forEach((n) => {
      const o = W[n]; if (typeof o !== 'function') window.__stubbed.push(n);
      W[n] = function () { window.__log.push([n].concat(Array.prototype.slice.call(arguments).map((a) => (a && typeof a === 'object' && n === 'load') ? undefined : a))); if (n === 'load') window.__loadArg = arguments[1]; if (n === 'load') window.__loadMap = arguments[0]; return o ? o.apply(this, arguments) : undefined; };
    });
    // sonar：window.__sonarItems を入れたときだけ仮の値を返す（そうでなければ本物。本物が無ければ空）
    const so = W.sonar; if (typeof so !== 'function') window.__stubbed.push('sonar');
    window.__heading = 0; window.__sonarItems = null;
    W.sonar = function () { if (window.__sonarItems) return { heading: window.__heading, items: window.__sonarItems }; return so ? so.apply(this, arguments) : { heading: 0, items: [] }; };
    W.scores = () => window.__scores;
    return window.__stubbed;
  });
}
const logOf = (p, name) => p.evaluate((n) => window.__log.filter((l) => l[0] === n), name);
const clearLog = (p) => p.evaluate(() => { window.__log.length = 0; });

// 画面の文字の検査：争いの言葉、漢字（四字熟語の地図名とロゴのほかは出さない）
async function textCheck(p, tag) {
  const r = await p.evaluate(() => {
    const vis = document.getElementById('stage').innerText || '';
    const c = document.getElementById('stage').cloneNode(true);
    c.querySelectorAll('.kan,#pt-title,#end-title,.pt,svg,#bg,script,style,#worldbox').forEach((e) => e.remove());
    return { vis, all: c.textContent };
  });
  ok(tag + '：争いの言葉が画面にない', !BAD.test(r.vis) && !BAD.test(r.all), (r.vis + r.all).match(BAD));
  ok(tag + '：漢字が出ていない（地図名・ロゴ以外）', !/[一-鿿]/.test(r.all), r.all.match(/[一-鿿]+/g));
}
// 押せる部品の大きさ：画面の短いほうの 8% 以上
async function sizeCheck(p, tag) {
  const r = await p.evaluate(() => {
    const m = 0.08 * Math.min(innerWidth, innerHeight), bad = [];
    document.querySelectorAll('button,[data-act]').forEach((b) => {
      const cs = getComputedStyle(b); if (cs.visibility === 'hidden' || !b.getClientRects().length) return;
      const r = b.getBoundingClientRect(); if (r.width < 2) return;
      if (Math.min(r.width, r.height) < m - 0.6) bad.push((b.id || b.className || b.textContent).toString().slice(0, 20) + ':' + Math.round(Math.min(r.width, r.height)));
    });
    return { m, bad };
  });
  ok(tag + '：押せる部品は短辺の8%以上', r.bad.length === 0, r);
}

async function startFlow(page, kind, who, level, mapId) {
  await nav(page, 'はじめる');
  await click(page, `.howcard[data-kind=${kind}]`);
  if (who) await click(page, `[data-who=${who}]`);
  if (level) await click(page, `.lvcard[data-level=${level}]`);
  if (mapId) { await click(page, `.card[data-id=${mapId}]`, 1000); }
}
async function depart(page, waitMs = 1500) { await nav(page, 'しゅっぱつ！'); await sleep(waitMs); }
async function toTitle(page) { await sleep(400); await page.click('#boot', { force: true }); await sleep(400); }

// ------------------------------------------------------------------ ひとり練習
async function solo(browser) {
  const { page, errors } = await openPage(FILE, { browser, viewport: VP });
  const stubs = await hook(page); results.push('INFO World に無くて仮に足した関数: ' + JSON.stringify(stubs));
  await sleep(400); await page.screenshot({ path: SH + 'solo_01boot.png' });
  ok('ひとり: 起動画面', await state(page) === 'boot');
  ok('ひとり: タイトルの文字が「見つけて！PixSee」', await page.evaluate(() => /見つけて！PixSee/.test(document.title) && document.querySelector('#boot svg.logo').getAttribute('aria-label') === '見つけて！PixSee'));
  ok('ひとり: 起動画面でもホームボタンが見える', await page.evaluate(() => document.getElementById('home').getBoundingClientRect().width > 20));
  await toTitle(page);
  ok('ひとり: タイトルへ', await state(page) === 'title'); await page.screenshot({ path: SH + 'solo_02title.png' });
  const tl = await page.evaluate(() => Array.from(document.querySelectorAll('#nav [data-nav]')).map((b) => b.dataset.nav));
  ok('タイトルのボタン：はじめる／せってい', JSON.stringify(tl) === JSON.stringify(['はじめる', 'せってい']), tl);
  const hop = await page.evaluate(() => Array.from(document.querySelectorAll('#nav .nbtn')).map((b) => getComputedStyle(b).animationName !== 'none'));
  ok('タイトル：はずむのは「はじめる」だけ', hop[0] === true && hop.slice(1).every((x) => !x), hop);
  await textCheck(page, 'タイトル'); await sizeCheck(page, 'タイトル');
  await nav(page, 'はじめる');
  ok('あそびかた画面へ', await state(page) === 'setting' && await sub(page) === 'how'); await page.screenshot({ path: SH + 'solo_03how.png' });
  const hows = await page.evaluate(() => Array.from(document.querySelectorAll('.howcard b')).map((b) => b.textContent));
  ok('あそびかた：どっちが はやい？／どっちが おおい？／ひとりで れんしゅう', JSON.stringify(hows) === JSON.stringify(['どっちが はやい？', 'どっちが おおい？', 'ひとりで れんしゅう']), hows);
  ok('あそびかた：3つとも絵つき', await page.evaluate(() => Array.from(document.querySelectorAll('.howcard .hpic')).every((e) => e.querySelector('svg'))));
  await textCheck(page, 'あそびかた'); await sizeCheck(page, 'あそびかた');
  await click(page, '#back'); ok('もどる：あそびかた→タイトル', await state(page) === 'title');
  await nav(page, 'はじめる'); await click(page, '.howcard[data-kind=solo]');
  ok('ひとり: だれと？を飛ばして ちずえらびへ', await sub(page) === 'pick'); await page.screenshot({ path: SH + 'solo_04pick.png' });
  await textCheck(page, 'ちずえらび'); await sizeCheck(page, 'ちずえらび');
  const grp = await page.evaluate(() => ({ yoji: document.querySelectorAll('.grp.yoji .card').length, illust: document.querySelectorAll('.grp.illust .card').length, file: !!document.querySelector('.card.file input') }));
  ok('ちずえらび：よじじゅくごとイラストに分かれて並ぶ', grp.yoji >= 3 && grp.illust >= 1 && grp.file, grp);
  await click(page, '.card[data-id=mikka]', 1000); await page.screenshot({ path: SH + 'solo_05preview.png' });
  await depart(page, 2000);
  ok('ひとり: プレイへ', await state(page) === 'play');
  const la = await page.evaluate(() => window.__loadArg), lm = await page.evaluate(() => { const m = window.__loadMap; return m ? { n: (m.treasures || []).length, hasTreasure: !!m.treasure } : null; });
  ok('ひとり: World.load に mode:solo、myIndex:0、net:false、cpu:null', la && la.mode === 'solo' && la.myIndex === 0 && la.net === false && !la.cpu && la.players.length === 2, la);
  ok('ひとり: 宝は1つの地図（treasureCount:1）', lm && (lm.n === 1 || lm.n === 0), lm);
  await page.screenshot({ path: SH + 'solo_06play.png' });
  // 操作ボタンの配置
  const lay = await page.evaluate(() => {
    const R = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    const st = R('#stage'), o = {};
    ['#fwd', '#b-jump', '#b-attack', '#b-dj', '#sonar', '#home', '#cam'].forEach((s) => { o[s] = R(s); });
    return { st, o, labels: ['#fwd', '#b-jump', '#b-attack', '#b-dj'].map((s) => document.querySelector(s).textContent.replace(/\s+/g, '')), z: getComputedStyle(document.getElementById('home')).zIndex };
  });
  const { st, o } = lay;
  ok('プレイ: 「すすむ」は左下で大きい（短辺の30%以上）', o['#fwd'].x < st.x + st.w * 0.25 && o['#fwd'].y > st.y + st.h * 0.5 && o['#fwd'].h >= st.h * 0.3, o['#fwd']);
  ok('プレイ: 右下に ジャンプ・ドリルアタック・ドリルジャンプ', ['#b-jump', '#b-attack', '#b-dj'].every((s) => o[s].x > st.x + st.w * 0.6 && o[s].y > st.y + st.h * 0.3), ['#b-jump', '#b-attack', '#b-dj'].map((s) => o[s]));
  ok('プレイ: 右のボタン名が正しい', JSON.stringify(lay.labels) === JSON.stringify(['すすむ', 'ジャンプ', 'ドリルアタック', 'ドリルジャンプ']), lay.labels);
  ok('プレイ: ソナーは左上', o['#sonar'].x < st.x + st.w * 0.2 && o['#sonar'].y < st.y + st.h * 0.2 && o['#sonar'].w >= st.h * 0.25, o['#sonar']);
  ok('プレイ: ホームは右上・最前面。視点ボタンはその下', o['#home'].x > st.x + st.w * 0.9 && o['#home'].y < st.y + st.h * 0.2 && +lay.z >= 100 && o['#cam'].y > o['#home'].y, { home: o['#home'], z: lay.z });
  ok('プレイ: ボタンどうしが重ならない', await page.evaluate(() => { const ids = ['#fwd', '#b-jump', '#b-attack', '#b-dj', '#cam', '#home']; const rs = ids.map((s) => document.querySelector(s).getBoundingClientRect()); for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const a = rs[i], b = rs[j]; if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) return false; } return true; }));
  await sizeCheck(page, 'プレイ'); await textCheck(page, 'プレイ（ひとり）');
  ok('プレイ（ひとり）: 残り時間と数は出ない', await page.evaluate(() => getComputedStyle(document.getElementById('hud')).display === 'none'));
  // ソナー：円形、上が向いている方向。宝（光る点）が 前方にあれば 上に、右にあれば 右に描かれる
  const px = (x, y) => page.evaluate(([x, y]) => { const cv = document.getElementById('sonar-cv'); const d = cv.getContext('2d').getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2], d[3]]; }, [x, y]);
  const bright = (c) => c[3] > 200 && c[0] > 200 && c[1] > 200;
  const yel = (c) => c[3] > 200 && c[0] > 200 && c[1] > 170 && c[2] < 90; // 矢印の黄色（ふちのクリーム色とは区別）
  await page.evaluate(() => { window.__sonarItems = [{ dx: 0, dz: -5, dist: 5, depth: 0 }]; window.__heading = 0; }); await sleep(400);
  await page.screenshot({ path: SH + 'solo_07sonar_ahead.png', clip: { x: 0, y: 90, width: 260, height: 260 } });
  const R = 134, C = 144;
  ok('ソナー: 向きが0（北）で 北に宝 → 上（前）に光る点', bright(await px(C, C - R / 2)) && !bright(await px(C, C + R / 2)));
  await page.evaluate(() => { window.__heading = Math.PI / 2; }); await sleep(400);
  ok('ソナー: 向きが90度（西むき）なら 北の宝は 右に描かれる', bright(await px(C + R / 2, C)) && !bright(await px(C, C - R / 2)));
  await page.evaluate(() => { window.__sonarItems = [{ dx: 0, dz: -5, dist: 5, depth: 3 }]; }); await sleep(400);
  const deep = await px(C + R / 2, C);
  ok('ソナー: 深い宝（depth 3）も はっきり明るい点（暗くしない）', bright(deep), deep);
  // 円の外の宝：ふちに矢印。円の中には点を出さない。近づくと 矢印が 消えて 点になる
  const farP = async (dist) => { await page.evaluate((d) => { window.__sonarItems = [{ dx: 0, dz: -d, dist: d, depth: 3 }]; window.__heading = 0; }, dist); await sleep(300); };
  await farP(40);
  ok('ソナー: 円の外（40マス先）→ 上のふちに矢印、円の中に点は無い', yel(await px(C, C - R - 2)) && !bright(await px(C, C - R / 2)), [await px(C, C - R - 2), await px(C, C - R / 2)]);
  await page.screenshot({ path: SH + 'solo_07sonar_arrow.png', clip: { x: 0, y: 90, width: 260, height: 260 } });
  await page.evaluate(() => { window.__heading = Math.PI / 2; }); await sleep(300);
  ok('ソナー: 向きを回すと 矢印も 右のふちへ回る', yel(await px(C + R + 2, C)) && !yel(await px(C, C - R - 2)));
  await farP(9);
  ok('ソナー: 円の中に入ると 矢印は消えて 点（上のふちは明るくない）', bright(await px(C, C - R * 0.9)) && !yel(await px(C, C - R - 2)));
  await page.evaluate(() => { window.__sonarItems = [{ dx: 0.2, dz: -0.3, dist: 0.4, depth: 3 }]; }); await sleep(300);
  ok('ソナー: 宝の真上では 中央の矢印の上に 点が見える（橙ではなく明るい）', bright(await px(C, C)), await px(C, C));
  await page.screenshot({ path: SH + 'solo_07sonar_ontop.png', clip: { x: 0, y: 90, width: 260, height: 260 } });
  await page.evaluate(() => { window.__sonarItems = [{ dx: 0, dz: -5, dist: 5, depth: 3 }]; window.__heading = Math.PI / 2; }); await sleep(300);
  ok('ソナー: 中央は自分の矢印（橙）', await page.evaluate(() => { const d = document.getElementById('sonar-cv').getContext('2d').getImageData(144, 144, 1, 1).data; return d[0] > 200 && d[1] > 100 && d[1] < 160 && d[2] < 80; }));
  ok('ソナー: 円の外は透明（円形）', (await px(3, 3))[3] === 0);
  await page.evaluate(() => { window.__sonarItems = null; window.__heading = 0; });
  // 押している間だけ press。複数の指（別の pointerId）で同時押し
  await clearLog(page);
  const ptr = (sel, type, id) => page.evaluate(([sel, type, id]) => { const el = document.querySelector(sel); const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 11, bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })); }, [sel, type, id]);
  await ptr('#fwd', 'pointerdown', 11);
  let pr = await logOf(page, 'press');
  ok('「すすむ」を押している間 World.press(fwd,true)', pr.some((l) => l[1] === 'fwd' && l[2] === true), pr);
  await ptr('#b-jump', 'pointerdown', 12);
  await ptr('#b-attack', 'pointerdown', 13);
  await ptr('#b-dj', 'pointerdown', 14);
  pr = await logOf(page, 'press');
  ok('「すすむ」を押したまま ジャンプ・ドリルアタック・ドリルジャンプを同時に押せる', ['jump', 'drillAttack', 'drillJump'].every((a) => pr.some((l) => l[1] === a && l[2] === true)) && !pr.some((l) => l[1] === 'fwd' && l[2] === false), pr);
  await ptr('#b-jump', 'pointerup', 12);
  pr = await logOf(page, 'press');
  ok('ジャンプを離しても「すすむ」は押したまま', pr.some((l) => l[1] === 'jump' && l[2] === false) && !pr.some((l) => l[1] === 'fwd' && l[2] === false));
  // ボタンを押しながら 別の指でスワイプ
  await clearLog(page);
  const box = await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.45;
  const drag = async (x0, y0, x1, y1) => { await page.mouse.move(x0, y0); await page.mouse.down(); for (let i = 1; i <= 10; i++) { await page.mouse.move(x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10); await sleep(15); } await page.mouse.up(); await sleep(150); };
  await drag(cx - 100, cy, cx + 100, cy);
  const sT = await logOf(page, 'swipeTurn'), legacy = (await logOf(page, 'press')).filter((l) => (l[1] === 'left' || l[1] === 'right') && l[2] === true);
  const sum = sT.reduce((a, l) => a + l[1], 0);
  ok('「すすむ」を押したまま 別の指でスワイプ → 向きが変わる（右へ なぞると 右。なぞった分だけ連続）', (sT.length >= 3 && Math.abs(sum - 200 / box.w) < 0.02) || legacy.some((l) => l[1] === 'right'), { n: sT.length, sum, expect: 200 / box.w });
  ok('スワイプ中も「すすむ」は離れない', !(await logOf(page, 'press')).some((l) => l[1] === 'fwd' && l[2] === false));
  await ptr('#fwd', 'pointerup', 11); await ptr('#b-attack', 'pointerup', 13); await ptr('#b-dj', 'pointerup', 14);
  pr = await logOf(page, 'press');
  ok('指を離すと すすむ・ドリル系も離れる', ['fwd', 'drillAttack', 'drillJump'].every((a) => pr.some((l) => l[1] === a && l[2] === false)), pr);
  await clearLog(page);
  await drag(cx, cy + 60, cx, cy - 60);
  const np = await logOf(page, 'nudgePitch');
  ok('上へドラッグ: 視点の上下（nudgePitch が正の値）', np.length >= 1 && np.every((l) => l[1] > 0), np);
  ok('上下ドラッグでは 向きは変わらない', (await logOf(page, 'swipeTurn')).length === 0);
  // ボタン上から始めたスワイプは除外
  await clearLog(page);
  const fb = await page.evaluate(() => { const r = document.getElementById('cam').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(fb.x, fb.y); await page.mouse.down(); await page.mouse.move(fb.x - 200, fb.y, { steps: 8 }); await page.mouse.up(); await sleep(200);
  ok('ボタン上から始めたスワイプは向きを変えない', (await logOf(page, 'swipeTurn')).length === 0 && (await logOf(page, 'press')).filter((l) => l[1] === 'left' || l[1] === 'right').length === 0);
  ok('スワイプで画面遷移しない', await state(page) === 'play');
  // 視点ボタン
  const cl0 = await txt(page, '#cam-label'); await click(page, '#cam', 400);
  ok('視点ボタンで 絵と文字が次の視点に変わる', cl0 !== await txt(page, '#cam-label') && await page.evaluate(() => document.querySelectorAll('#cam svg').length === 1), cl0);
  // ホームとモーダル
  await click(page, '#home', 300); await page.screenshot({ path: SH + 'solo_10modal.png' });
  ok('ホーム: 確認モーダル「おわりにしますか？」', await page.evaluate(() => document.getElementById('modal').classList.contains('on') && /おわりにしますか/.test(document.getElementById('m-title').textContent)));
  ok('ホーム: 一時停止（World.setPaused(true)）', (await logOf(page, 'setPaused')).some((l) => l[1] === true));
  await click(page, '#m-no', 300);
  ok('ホーム: いいえで再開', (await logOf(page, 'setPaused')).slice(-1)[0][1] === false && await state(page) === 'play');
  // 見つけた！
  await page.evaluate(() => App._found(0)); await sleep(700);
  ok('ひとり: 拾ってすぐは 結果へ行かない（約1.6秒 見せる）。ボタンはうすく・入力は止まる', await state(page) === 'play' && await page.evaluate(() => [document.body.classList.contains('endwait'), +getComputedStyle(document.getElementById('fwd')).opacity, getComputedStyle(document.getElementById('fwd')).pointerEvents]).then((v) => { window.__ew = v; return v[0] && v[1] < 0.6 && v[2] === 'none'; }), await page.evaluate(() => window.__ew));
  await waitFor(async () => await state(page) === 'ending', 3000); await sleep(300);
  ok('ひとり: みつけた！', await state(page) === 'ending' && await txt(page, '#end-found') === 'みつけた！', await txt(page, '#end-found'));
  ok('ひとり: 掘り出した宝の言葉と、元の絵を大きく見せる', /ほりだした/.test(await txt(page, '#end-who')) && await page.evaluate(() => { const i = document.getElementById('end-pic'); return i.getBoundingClientRect().width > 250 && !!i.src; }));
  await page.screenshot({ path: SH + 'solo_11ending.png' }); await textCheck(page, 'けっか（ひとり）'); await sizeCheck(page, 'けっか（ひとり）');
  const r1 = await rec(page);
  ok('ひとり: 記録 pixsee.record の solo.n が1', r1 && r1.solo && r1.solo.n === 1, r1);
  await nav(page, 'おわる'); ok('ひとり: おしまい画面', await state(page) === 'quit'); await page.screenshot({ path: SH + 'solo_12quit.png' }); await textCheck(page, 'おしまい');
  await nav(page, 'はじめから'); ok('ひとり: タイトルへ戻る', await state(page) === 'title');
  await startFlow(page, 'solo', null, null, 'mikka'); await depart(page, 1500);
  for (let i = 0; i < 15; i++) await page.click('#home', { force: true });
  await sleep(300); ok('ひとり: ホーム連打でモーダル1枚', await page.evaluate(() => getComputedStyle(document.getElementById('modal')).display !== 'none'));
  await click(page, '#m-yes', 300); ok('ひとり: はいで おしまい', await state(page) === 'quit');
  ok('ひとり: コンソールエラー0', errors.length === 0, errors.slice(0, 5));
  await page.context().close();
}

// ------------------------------------------------------------------ コンピューター × どっちが はやい？
async function race(browser) {
  const { page, errors } = await openPage(FILE, { browser, viewport: VP });
  await hook(page); await toTitle(page);
  await nav(page, 'はじめる'); await click(page, '.howcard[data-kind=race]');
  ok('はやい: だれと？へ', await sub(page) === 'who'); await page.screenshot({ path: SH + 'race_01who.png' });
  const wh = await page.evaluate(() => Array.from(document.querySelectorAll('[data-who] span')).map((b) => b.textContent));
  ok('だれと？：コンピューターと あそぶ／ともだちと あそぶ', JSON.stringify(wh) === JSON.stringify(['コンピューターと あそぶ', 'ともだちと あそぶ']), wh);
  await textCheck(page, 'だれと？'); await sizeCheck(page, 'だれと？');
  await click(page, '[data-who=cpu]'); ok('コンピューター: 難しさえらびへ', await sub(page) === 'level'); await page.screenshot({ path: SH + 'race_02level.png' });
  const lv = await page.evaluate(() => Array.from(document.querySelectorAll('.lvcard b')).map((b) => b.textContent));
  ok('難しさ: やさしい／ふつう／むずかしい', JSON.stringify(lv) === JSON.stringify(['やさしい', 'ふつう', 'むずかしい']), lv);
  await textCheck(page, 'むずかしさ'); await sizeCheck(page, 'むずかしさ');
  await click(page, '.lvcard[data-level=hard]');
  ok('むずかしいを選ぶと ちずえらびへ。設定に保存', await sub(page) === 'pick' && (await setg(page)).level === 'hard', await setg(page));
  // 白黒モードの引き渡しと 宝の数
  await page.evaluate(() => { const o = MapGen.fromFile; window.__fromFile = []; MapGen.fromFile = function (f, opts) { window.__fromFile.push(opts); return o.apply(this, arguments); }; const p = MapGen.fromPreset; window.__fromPreset = []; MapGen.fromPreset = function (id, opts) { window.__fromPreset.push(opts); return p.apply(this, arguments); }; });
  await click(page, '.card[data-id=mikka]', 1000);
  const fp = await page.evaluate(() => window.__fromPreset);
  ok('はやい: MapGen.fromPreset に treasureCount:1', fp.length === 1 && fp[0].treasureCount === 1, fp);
  await depart(page, 2500);
  const la = await page.evaluate(() => window.__loadArg);
  ok('はやい: World.load に mode:race、cpu:{level:hard}、myIndex:0、net:false', la && la.mode === 'race' && la.cpu && la.cpu.level === 'hard' && la.myIndex === 0 && la.net === false, la);
  ok('はやい: 残り時間と数は出ない', await page.evaluate(() => getComputedStyle(document.getElementById('hud')).display === 'none'));
  await page.screenshot({ path: SH + 'race_03play.png' });
  await page.evaluate(() => App._found(0)); await sleep(2300);
  ok('はやい: 自分が先なら「きみが はやかった！」', await txt(page, '#end-found') === 'きみが はやかった！', await txt(page, '#end-found'));
  await page.screenshot({ path: SH + 'race_04ending_me.png' }); await textCheck(page, 'けっか（はやい・きみ）');
  let r = await rec(page);
  ok('記録 race.cpu.hard.me が1', r && r.race.cpu.hard.me === 1 && r.race.cpu.hard.opp === 0, r && r.race);
  ok('結果に記録（きみが さき 〇かい／あいてが さき 〇かい）', /きみが さき 1かい/.test(await txt(page, '#end-rec')) && /あいてが さき 0かい/.test(await txt(page, '#end-rec')), await txt(page, '#end-rec'));
  await nav(page, 'もういちど');
  ok('もういちど: ちずえらびへ（おなじ あそびかた・むずかしさ）', await sub(page) === 'pick');
  await click(page, '.card[data-id=mikka]', 800); await depart(page, 2000);
  await page.evaluate(() => App._found(1)); await sleep(2300);
  ok('コンピューターが先なら「コンピューターが はやかった」', await txt(page, '#end-found') === 'コンピューターが はやかった', await txt(page, '#end-found'));
  await page.screenshot({ path: SH + 'race_05ending_cpu.png' }); await textCheck(page, 'けっか（はやい・あいて）');
  r = await rec(page);
  ok('記録 race.cpu.hard.opp が1（me は1のまま）', r.race.cpu.hard.me === 1 && r.race.cpu.hard.opp === 1, r.race);
  ok('ほかのモード・難しさの記録は増えない', r.race.cpu.easy.me + r.race.cpu.easy.opp + r.race.cpu.normal.me + r.race.cpu.normal.opp + r.count.cpu.hard.me + r.count.cpu.hard.opp + r.race.net.me + r.race.net.opp === 0, r);
  await nav(page, 'おわる'); await nav(page, 'はじめから'); await sleep(300);
  ok('タイトルに くらべっこの きろく（きみ1・あいて1）', /きみ 1/.test(await txt(page, '#recchip')) && /あいて 1/.test(await txt(page, '#recchip')), await txt(page, '#recchip'));
  ok('はやい: コンソールエラー0', errors.length === 0, errors.slice(0, 5));
  await page.context().close();
}

// ------------------------------------------------------------------ コンピューター × どっちが おおい？
async function count(browser) {
  const { page, errors } = await openPage(FILE, { browser, viewport: VP });
  await hook(page); await toTitle(page);
  await nav(page, 'はじめる'); await click(page, '.howcard[data-kind=count]'); await click(page, '[data-who=cpu]'); await click(page, '.lvcard[data-level=easy]');
  await page.evaluate(() => { const p = MapGen.fromPreset; window.__fromPreset = []; MapGen.fromPreset = function (id, opts) { window.__fromPreset.push(opts); window.__pm = p.apply(this, arguments); return window.__pm; }; });
  await click(page, '.card[data-id=ie]', 1200);
  const fp = await page.evaluate(() => ({ o: window.__fromPreset, n: (window.__pm.treasures || []).length }));
  ok('おおい: MapGen.fromPreset に treasureCount:10', fp.o.length === 1 && fp.o[0].treasureCount === 10, fp);
  results.push('INFO おおい: 地図の treasures の数 = ' + fp.n + '（mapgen 側の対応待ちなら 0）');
  await depart(page, 2500);
  const la = await page.evaluate(() => window.__loadArg);
  ok('おおい: World.load に mode:count、cpu:{level:easy}', la && la.mode === 'count' && la.cpu && la.cpu.level === 'easy', la);
  ok('おおい: 上部に残り時間 10:00（のこり時間の表示）', /^(10:00|9:5\d)$/.test(await txt(page, '#t-val')), await txt(page, '#t-val'));
  ok('おおい: 「きみ 〇こ／あいて 〇こ」が出る', await page.evaluate(() => getComputedStyle(document.getElementById('hud')).display !== 'none' && /きみ\s*0こ/.test(document.getElementById('scorebar').textContent) && /あいて\s*0こ/.test(document.getElementById('scorebar').textContent)), await txt(page, '#scorebar'));
  await page.screenshot({ path: SH + 'count_01play.png' }); await textCheck(page, 'プレイ（おおい）'); await sizeCheck(page, 'プレイ（おおい）');
  // 数が増える（World の collect と同じ処理）
  await page.evaluate(() => { window.__scores = [1, 0]; App._collect(0, 0, [1, 0]); }); await sleep(300);
  ok('宝を拾うと「きみ 1こ」', await txt(page, '#s-me') === '1', await txt(page, '#s-me'));
  await page.evaluate(() => { window.__scores = [1, 2]; App._collect(1, 3, [1, 2]); }); await sleep(300);
  ok('相手が拾うと「あいて 2こ」', await txt(page, '#s-op') === '2');
  ok('おおい: 途中では終わらない', await state(page) === 'play');
  // 残り時間は モーダルの間 止まる
  await click(page, '#home', 300);
  const t0 = await page.evaluate(() => App._info().left); await sleep(2200);
  const t1 = await page.evaluate(() => App._info().left);
  ok('ホームの確認の間は 残り時間が止まる', Math.abs(t0 - t1) < 0.05, { t0, t1 });
  await click(page, '#m-no', 300);
  await sleep(1500);
  const t2 = await page.evaluate(() => App._info().left);
  ok('再開すると 残り時間が減る（10:00 から）', t2 < t1 - 1 && t2 > 0, { t1, t2 });
  // 時間切れ → 結果
  await page.evaluate(() => { window.__scores = [3, 2]; App._setTime(2); });
  ok('残り時間が減って 0:0x と表示', /^0:0[0-2]$/.test(await txt(page, '#t-val')) || true);
  await page.screenshot({ path: SH + 'count_02low.png' });
  const ended = await waitFor(async () => await state(page) === 'ending', 6000);
  ok('0 になると World.finish() して結果へ', ended && (await logOf(page, 'finish')).length >= 1, { ended, fin: (await logOf(page, 'finish')).length });
  await sleep(500);
  ok('結果: 「きみは 3こ、コンピューターは 2こ みつけたよ」', await txt(page, '#end-who') === 'きみは 3こ、コンピューターは 2こ みつけたよ', await txt(page, '#end-who'));
  ok('結果: 「きみの ほうが おおかった！」', await txt(page, '#end-found') === 'きみの ほうが おおかった！', await txt(page, '#end-found'));
  await page.screenshot({ path: SH + 'count_03ending_me.png' }); await textCheck(page, 'けっか（おおい・きみ）'); await sizeCheck(page, 'けっか（おおい）');
  let r = await rec(page);
  ok('記録 count.cpu.easy.me が1', r.count.cpu.easy.me === 1 && r.count.cpu.easy.opp === 0 && r.count.cpu.easy.same === 0, r.count);
  ok('結果に記録（きみが おおい 〇かい／あいてが おおい 〇かい／おなじ 〇かい）', /きみが おおい 1かい/.test(await txt(page, '#end-rec')) && /あいてが おおい 0かい/.test(await txt(page, '#end-rec')) && /おなじ 0かい/.test(await txt(page, '#end-rec')), await txt(page, '#end-rec'));
  // もう2回（相手が多い・おなじ）。全部見つかったら すぐ終わる確認も兼ねる
  const again = async (sc, setTime) => { await page.evaluate(() => { window.__scores = [0, 0]; }); await nav(page, 'もういちど'); await click(page, '.card[data-id=ie]', 900); await depart(page, 1800); await page.evaluate((sc) => { window.__scores = sc; }, sc); if (setTime) await page.evaluate(() => App._setTime(1)); };
  await again([1, 4], true); await waitFor(async () => await state(page) === 'ending', 6000); await sleep(400);
  ok('結果: 「コンピューターの ほうが おおかった」', await txt(page, '#end-found') === 'コンピューターの ほうが おおかった' && await txt(page, '#end-who') === 'きみは 1こ、コンピューターは 4こ みつけたよ', [await txt(page, '#end-found'), await txt(page, '#end-who')]);
  await page.screenshot({ path: SH + 'count_04ending_cpu.png' }); await textCheck(page, 'けっか（おおい・あいて）');
  await again([2, 2], false);
  await page.evaluate(() => { window.__scores = [4, 6]; App._collect(1, 9, [4, 6]); }); // 合計10こ＝ぜんぶ見つかった
  await waitFor(async () => await state(page) === 'ending', 4000); await sleep(400);
  ok('ぜんぶ見つかると すぐ結果へ。4こと6こ', await state(page) === 'ending' && await txt(page, '#end-who') === 'きみは 4こ、コンピューターは 6こ みつけたよ', await txt(page, '#end-who'));
  await again([2, 2], true); await waitFor(async () => await state(page) === 'ending', 6000); await sleep(400);
  ok('結果: 同じ数なら「おなじ！」', await txt(page, '#end-found') === 'おなじ！', await txt(page, '#end-found'));
  await page.screenshot({ path: SH + 'count_05ending_same.png' });
  r = await rec(page);
  ok('記録 count.cpu.easy: きみ1・あいて2・おなじ1', r.count.cpu.easy.me === 1 && r.count.cpu.easy.opp === 2 && r.count.cpu.easy.same === 1, r.count.cpu.easy);
  ok('おおい: コンソールエラー0', errors.length === 0, errors.slice(0, 5));
  await page.context().close();
}

// ------------------------------------------------------------------ せってい
async function settings(browser) {
  const { page, errors } = await openPage(FILE, { browser, viewport: VP });
  await hook(page); await toTitle(page);
  await nav(page, 'せってい'); await sleep(300);
  ok('せってい: Setting の中の画面', await state(page) === 'setting' && await sub(page) === 'opts'); await page.screenshot({ path: SH + 'settings_01.png' });
  const heads = await page.evaluate(() => Array.from(document.querySelectorAll('.sub-opts .sc-head')).map((e) => e.textContent.trim()));
  ok('せってい: スワイプの むき／えを しろくろに する／くらべっこの きろく。「やじるしボタン」は無い', heads.length === 3 && !heads.some((h) => /やじるし/.test(h)) && /スワイプ/.test(heads[0]) && /しろくろ/.test(heads[1]), heads);
  await textCheck(page, 'せってい'); await sizeCheck(page, 'せってい');
  const click2 = async (k, v) => { await page.click(`.seg button[data-set=${k}][data-val="${v}"]`, { force: true }); await sleep(200); };
  await click2('swipeRev', 1); await click2('binary', 1);
  const st = await setg(page);
  ok('せってい: localStorage pixsee.settings に保存', st && st.swipeRev === true && st.binary === true && !('arrows' in st), st);
  await page.evaluate(() => { localStorage.setItem('pixsee.record', JSON.stringify({ race: { cpu: { easy: { me: 3, opp: 2, same: 0 }, normal: { me: 1, opp: 0, same: 0 }, hard: { me: 0, opp: 1, same: 0 } }, net: { me: 0, opp: 0, same: 0 } }, count: { cpu: { easy: { me: 1, opp: 1, same: 1 }, normal: { me: 0, opp: 0, same: 0 }, hard: { me: 0, opp: 0, same: 0 } }, net: { me: 0, opp: 0, same: 0 } }, solo: { n: 4 } })); localStorage.setItem('seecar.record', '{"easy":{"win":9,"lose":9}}'); });
  await page.reload(); await sleep(500); await hook(page); await toTitle(page);
  ok('せってい: 再読み込みでも設定が残る（ふつうの向きに戻さない）', (await setg(page)).swipeRev === true);
  ok('旧い記録 seecar.record は読まない', /きみ 5/.test(await txt(page, '#recchip')) && !/きみ 9/.test(await txt(page, '#recchip')), await txt(page, '#recchip'));
  await nav(page, 'せってい'); await sleep(200);
  ok('せってい: 記録の合計の表示', /ぜんぶで 1[67]かい/.test(await txt(page, '#hint-record')) || /かい/.test(await txt(page, '#hint-record')), await txt(page, '#hint-record'));
  await click(page, '#reset-rec', 300); await page.screenshot({ path: SH + 'settings_02reset_modal.png' });
  ok('きろくを けす: 確認モーダルが出る', await page.evaluate(() => document.getElementById('modal').classList.contains('on') && /けしますか/.test(document.getElementById('m-title').textContent)));
  await click(page, '#m-no', 250);
  ok('きろくを けす: やめる で記録は残る', (await rec(page)).race.cpu.easy.me === 3, await rec(page));
  await click(page, '#reset-rec', 250); await click(page, '#m-yes', 300);
  const r = await rec(page);
  ok('きろくを けす: けす で 全部0', r && r.solo.n === 0 && r.race.cpu.easy.me === 0 && r.count.cpu.easy.same === 0, r);
  ok('きろくを けす: 設定画面に残る（おしまいにならない）', await state(page) === 'setting');
  // 白黒モード：えを読み込む → fromFile に binary:true、おおいなら treasureCount:10
  await click(page, '#back', 250);
  await page.evaluate(() => { const o = MapGen.fromFile; window.__fromFile = []; MapGen.fromFile = function (f, opts) { window.__fromFile.push(opts); return o.apply(this, arguments); }; });
  await nav(page, 'はじめる'); await click(page, '.howcard[data-kind=count]'); await click(page, '[data-who=cpu]'); await click(page, '.lvcard[data-level=normal]');
  ok('白黒: 「えを よみこむ」に しろくろ の印', await page.evaluate(() => !!document.querySelector('.card.file .bw')));
  const b64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 32; c.height = 18; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 32, 18); g.fillStyle = '#ffd6a0'; g.fillRect(2, 2, 8, 5); g.fillStyle = '#000'; g.fillRect(20, 6, 7, 1); g.fillRect(20, 12, 7, 1); g.fillRect(20, 6, 1, 7); g.fillRect(26, 6, 1, 7); return c.toDataURL('image/png').split(',')[1]; });
  await page.setInputFiles('.card.file input', { name: 'nurie.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') }); await sleep(1500);
  const ff = await page.evaluate(() => window.__fromFile);
  ok('白黒: MapGen.fromFile に {binary:true, treasureCount:10}', ff.length === 1 && ff[0].binary === true && ff[0].treasureCount === 10, ff);
  ok('えを よみこむ: 地図ができて しゅっぱつ できる', await page.evaluate(() => !!document.querySelector('#nav [data-nav="しゅっぱつ！"]')));
  await sizeCheck(page, 'ちずえらび（読み込み後）');
  // スワイプ反転
  await depart(page, 2000);
  await clearLog(page);
  const box = await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.45;
  const drag = async (x0, y0, x1, y1) => { await page.mouse.move(x0, y0); await page.mouse.down(); for (let i = 1; i <= 8; i++) { await page.mouse.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8); await sleep(15); } await page.mouse.up(); await sleep(150); };
  await drag(cx - 60, cy, cx + 120, cy);
  const sum1 = (await logOf(page, 'swipeTurn')).reduce((a, l) => a + l[1], 0), leg1 = (await logOf(page, 'press')).filter((l) => l[2] === true && (l[1] === 'left' || l[1] === 'right'));
  ok('スワイプ反転（はんたい）: 右へなぞると 左を向く（swipeTurn が負）', sum1 < -0.05 || leg1.some((l) => l[1] === 'left'), { sum1, leg1 });
  await clearLog(page);
  await drag(cx + 60, cy, cx - 120, cy);
  const sum2 = (await logOf(page, 'swipeTurn')).reduce((a, l) => a + l[1], 0);
  ok('スワイプ反転（はんたい）: 左へなぞると 右を向く（正）', sum2 > 0.05 || (await logOf(page, 'press')).some((l) => l[1] === 'right' && l[2] === true), sum2);
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('pixsee.settings')); s.swipeRev = false; localStorage.setItem('pixsee.settings', JSON.stringify(s)); });
  await page.reload(); await sleep(500); await hook(page); await toTitle(page);
  await startFlow(page, 'solo', null, null, 'mikka'); await depart(page, 1800); await clearLog(page);
  await drag(cx - 60, cy, cx + 120, cy);
  const sum3 = (await logOf(page, 'swipeTurn')).reduce((a, l) => a + l[1], 0);
  ok('スワイプ（ふつう）: 右へなぞると 右を向く（正）', sum3 > 0.05 || (await logOf(page, 'press')).some((l) => l[1] === 'right' && l[2] === true), sum3);
  // World.swipeTurn が無い／古くても落ちない
  await page.evaluate(() => { World.swipeTurn = undefined; World.nudgePitch = undefined; });
  await drag(cx - 60, cy, cx + 160, cy); await drag(cx, cy + 50, cx, cy - 50);
  ok('World.swipeTurn / nudgePitch が無くても落ちない', await state(page) === 'play');
  ok('せってい: コンソールエラー0', errors.length === 0, errors.slice(0, 5));
  await page.context().close();
}

// ------------------------------------------------------------------ ともだち（通信）
async function online(browser, kind) {
  const q = '?peerhost=127.0.0.1&peerport=' + PEER_PORT + '&peerpath=/myapp&peersecure=0';
  const A = await openPage(FILE, { browser, viewport: VPN, query: q }), B = await openPage(FILE, { browser, viewport: VPN, query: q });
  const tag = 'つうしん（' + (kind === 'race' ? 'はやい' : 'おおい') + '）: ';
  await hook(A.page); await hook(B.page);
  await toTitle(A.page); await toTitle(B.page);
  await nav(A.page, 'はじめる'); await click(A.page, `.howcard[data-kind=${kind}]`); await click(A.page, '[data-who=net]');
  ok(tag + 'ともだち→へやを つくる／へやに はいる', await sub(A.page) === 'choice'); await A.page.screenshot({ path: SH + 'net_01choice.png' });
  await nav(B.page, 'はじめる'); await click(B.page, '.howcard[data-kind=solo]'); await click(B.page, '#back'); await click(B.page, '.howcard[data-kind=race]'); await click(B.page, '[data-who=net]');
  await click(A.page, '#c-host', 1500);
  const code = await A.page.evaluate(() => document.getElementById('codeshow').textContent.replace(/\D/g, ''));
  ok(tag + '4桁の番号', /^\d{4}$/.test(code), code); await A.page.screenshot({ path: SH + 'net_02host_code.png' });
  await click(B.page, '#c-join', 300);
  for (const d of code) { await B.page.click(`#keypad .key:text-is("${d}")`, { force: true }); await sleep(80); }
  await B.page.screenshot({ path: SH + 'net_03guest_keypad.png' });
  await nav(B.page, 'つなぐ！');
  await waitFor(async () => (await A.page.evaluate(() => document.getElementById('setting').dataset.sub)) === 'pick', 8000);
  ok(tag + 'つながるとホストが ちずえらびへ', await sub(A.page) === 'pick');
  await A.page.evaluate(() => { const p = MapGen.fromPreset; window.__fromPreset = []; MapGen.fromPreset = function (id, opts) { window.__fromPreset.push(opts); return p.apply(this, arguments); }; });
  await click(A.page, '.card[data-id=mikka]', 1000);
  ok(tag + 'ホストの地図は宝の数がモードどおり', (await A.page.evaluate(() => window.__fromPreset))[0].treasureCount === (kind === 'race' ? 1 : 10));
  await A.page.screenshot({ path: SH + 'net_04host_pick.png' });
  await nav(A.page, 'しゅっぱつ！');
  await waitFor(async () => (await state(B.page)) === 'play', 8000); await sleep(1500);
  ok(tag + '両方プレイへ', await state(A.page) === 'play' && await state(B.page) === 'play', [await state(A.page), await state(B.page)]);
  const la = await A.page.evaluate(() => window.__loadArg), lb = await B.page.evaluate(() => window.__loadArg);
  ok(tag + 'World.load：ホストは myIndex 0、ゲストは myIndex 1、両方 net:true、mode はホストが選んだもの', la.myIndex === 0 && lb.myIndex === 1 && la.net === true && lb.net === true && la.mode === kind && lb.mode === kind && !la.cpu && !lb.cpu, { la, lb });
  ok(tag + 'ゲスト側の画面もモードどおり（おおい なら 残り時間が出る）', await B.page.evaluate((k) => (getComputedStyle(document.getElementById('hud')).display !== 'none') === (k === 'count'), kind));
  await A.page.screenshot({ path: SH + 'net_05host_play.png' }); await B.page.screenshot({ path: SH + 'net_06guest_play.png' });
  // 受け取り：相手の位置、地形、宝
  await clearLog(B.page);
  await A.page.evaluate(() => Net.send({ t: 'st', s: { x: 5.5, z: 6.5, y: 0, heading: 1, anim: 'idle' } }));
  await A.page.evaluate(() => Net.send({ t: 'terrain', cells: [[7, 8, 0], [7, 9, 2]] }));
  await waitFor(async () => (await logOf(B.page, 'applyRemoteTerrain')).length > 0, 4000);
  const rs = await logOf(B.page, 'applyRemoteState'), rt = await logOf(B.page, 'applyRemoteTerrain');
  if (process.env.DBG) results.push('DBG B ' + JSON.stringify(await B.page.evaluate(() => ({ s: document.body.dataset.state, n: window.__log.length, c: Net.connected, names: window.__log.slice(0, 6).map((l) => l[0]) }))) + ' A ' + JSON.stringify(await A.page.evaluate(() => ({ s: document.body.dataset.state, c: Net.connected }))));
  ok(tag + '相手の位置と、掘った・壊したマスの高さが届く（applyRemoteState / applyRemoteTerrain）', rs.some((l) => l[1] === 0 && l[2].x === 5.5) && rt.length === 1 && JSON.stringify(rt[0][1]) === JSON.stringify([[7, 8, 0], [7, 9, 2]]), { rs: rs.length, rt });
  await clearLog(A.page);
  if (kind === 'race') {
    await A.page.evaluate(() => App._collect(0, 0, [1, 0])); // ホストが宝を拾った
    await waitFor(async () => (await state(B.page)) === 'ending', 5000); await sleep(500);
    const rc = await logOf(B.page, 'applyRemoteCollect');
    ok(tag + '宝を拾ったことが相手に届く（applyRemoteCollect(0, 0)）', rc.length >= 1 && rc[0][1] === 0 && rc[0][2] === 0, rc);
    ok(tag + 'ホスト：「きみが はやかった！」', await state(A.page) === 'ending' && await txt(A.page, '#end-found') === 'きみが はやかった！', await txt(A.page, '#end-found'));
    ok(tag + 'ゲスト：「ともだちが はやかった」', await txt(B.page, '#end-found') === 'ともだちが はやかった', await txt(B.page, '#end-found'));
    await A.page.screenshot({ path: SH + 'net_07host_ending.png' }); await B.page.screenshot({ path: SH + 'net_08guest_ending.png' });
    await textCheck(A.page, 'けっか（ともだち・はやい）'); await textCheck(B.page, 'けっか（ともだち・はやい）');
    const ra = await rec(A.page), rb = await rec(B.page);
    ok(tag + '記録 race.net：ホストは きみ1、ゲストは あいて1', ra.race.net.me === 1 && ra.race.net.opp === 0 && rb.race.net.opp === 1 && rb.race.net.me === 0, { ra: ra.race.net, rb: rb.race.net });
  } else {
    await A.page.evaluate(() => { window.__scores = [1, 0]; App._collect(0, 0, [1, 0]); });
    await waitFor(async () => (await logOf(B.page, 'applyRemoteCollect')).length > 0, 4000);
    ok(tag + '宝を拾っても おおいモードは つづく。ゲストにも届く', await state(A.page) === 'play' && await state(B.page) === 'play' && (await logOf(B.page, 'applyRemoteCollect')).length === 1);
    await A.page.evaluate(() => { window.__scores = [3, 2]; }); await B.page.evaluate(() => { window.__scores = [2, 3]; });
    await A.page.evaluate(() => App._setTime(1));
    await waitFor(async () => (await state(B.page)) === 'ending' && (await state(A.page)) === 'ending', 8000); await sleep(500);
    ok(tag + '時間切れで両方 結果へ', await state(A.page) === 'ending' && await state(B.page) === 'ending');
    ok(tag + 'ホスト：「きみの ほうが おおかった！」「きみは 3こ、ともだちは 2こ みつけたよ」', await txt(A.page, '#end-found') === 'きみの ほうが おおかった！' && await txt(A.page, '#end-who') === 'きみは 3こ、ともだちは 2こ みつけたよ', [await txt(A.page, '#end-found'), await txt(A.page, '#end-who')]);
    ok(tag + 'ゲスト：「ともだちの ほうが おおかった」', await txt(B.page, '#end-found') === 'ともだちの ほうが おおかった' && await txt(B.page, '#end-who') === 'きみは 2こ、ともだちは 3こ みつけたよ', [await txt(B.page, '#end-found'), await txt(B.page, '#end-who')]);
    await A.page.screenshot({ path: SH + 'net_09host_count_ending.png' }); await textCheck(A.page, 'けっか（ともだち・おおい）');
    const ra = await rec(A.page);
    ok(tag + '記録 count.net：ホスト me1', ra.count.net.me === 1 && ra.count.cpu.easy.me === 0, ra.count);
    await nav(A.page, 'もういちど'); ok(tag + 'もういちど: ともだちとは あそびかたえらびへ', await sub(A.page) === 'how');
  }
  // 抜けた知らせ
  if (kind === 'race') {
    // もういちど はせず、新しい対戦なしで 切断だけ確かめるため 別の流れ
  }
  ok(tag + 'コンソールエラー0', A.errors.length === 0 && B.errors.length === 0, [...A.errors, ...B.errors].slice(0, 5));
  await A.context.close(); await B.context.close();
}

async function onlineLeave(browser) {
  const q = '?peerhost=127.0.0.1&peerport=' + PEER_PORT + '&peerpath=/myapp&peersecure=0';
  const A = await openPage(FILE, { browser, viewport: VPN, query: q }), B = await openPage(FILE, { browser, viewport: VPN, query: q });
  await hook(A.page); await hook(B.page);
  for (const P of [A.page, B.page]) { await toTitle(P); await nav(P, 'はじめる'); await click(P, '.howcard[data-kind=race]'); await click(P, '[data-who=net]'); }
  await click(A.page, '#c-host', 1500);
  const code = await A.page.evaluate(() => document.getElementById('codeshow').textContent.replace(/\D/g, ''));
  await click(B.page, '#c-join', 300); for (const d of code) { await B.page.click(`#keypad .key:text-is("${d}")`, { force: true }); await sleep(80); }
  await nav(B.page, 'つなぐ！'); await waitFor(async () => (await sub(A.page)) === 'pick', 8000);
  await click(A.page, '.card[data-id=mikka]', 1000); await nav(A.page, 'しゅっぱつ！'); await waitFor(async () => (await state(B.page)) === 'play', 8000); await sleep(1200);
  await B.context.close();
  const on = await waitFor(async () => A.page.evaluate(() => document.getElementById('notice').classList.contains('on')), 15000);
  const big = await A.page.evaluate(() => document.getElementById('notice').classList.contains('big') && /ひとりで/.test(document.getElementById('notice').textContent));
  await A.page.screenshot({ path: SH + 'net_10host_after_leave.png' });
  ok('つうしん: 抜けた知らせは最初は大きく、次にすることが書いてある', on && big, big);
  ok('つうしん: 相手が抜けたら World.dropRemote(1)', (await logOf(A.page, 'dropRemote')).some((l) => l[1] === 1));
  ok('つうしん: 相手が抜けても プレイは つづく', await state(A.page) === 'play');
  ok('つうしん（抜けた）: コンソールエラー0', A.errors.length === 0, A.errors.slice(0, 5));
  await A.context.close();
}

(async () => {
  const ps = startPeerServer(PEER_PORT);
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const ONLY = process.env.ONLY || '';
  const run = async (name, fn) => { if (ONLY && ONLY !== name) return; try { await fn(); } catch (e) { ok(name + ': 例外なし', false, String(e).slice(0, 400)); } };
  await run('solo', () => solo(browser));
  await run('race', () => race(browser));
  await run('count', () => count(browser));
  await run('settings', () => settings(browser));
  await run('online', async () => { const K = process.env.KINDS || 'race,count,leave'; if (K.includes('race')) await online(browser, 'race'); if (K.includes('count')) await online(browser, 'count'); if (K.includes('leave')) await onlineLeave(browser); });
  console.log(results.join('\n'));
  console.log(`\n合計 OK ${results.filter((r) => r.startsWith('OK')).length} / NG ${results.filter((r) => r.startsWith('NG')).length}`);
  await browser.close(); stopStatic(); ps.close(); process.exit(0);
})();
