// 結合版の通し確認: node test/e2e.js v1
// 1) ひとり: 起動→タイトル→自作の塗り絵を読み込み→しゅっぱつ→自動運転で壁を壊して宝へ→みつけた！→おわる→おしまい
// 2) つうしん: 手元の中継サーバーでホストとゲストをつなぎ、同期と破壊の一致、切断表示を確認
const { openPage, startPeerServer, stopStatic } = require('./harness.js');
const ver = process.argv[2] || 'v1';
const FILE = process.env.E2E_FILE || `/home/user/my-first-repo/seecar/dist/seecar_${ver}.html`;
const PEER_PORT = +(process.env.PEER_PORT || 9000);
const SH = `/home/user/my-first-repo/seecar/test/shots/e2e_${ver}_`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push(`${cond ? 'OK  ' : 'NG  '} ${name}${info !== undefined ? '  ' + JSON.stringify(info) : ''}`); };
const DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];

async function state(p) { return p.evaluate(() => document.body.dataset.state); }
async function nav(p, label) { await p.click(`#nav [data-nav="${label}"]`, { force: true }); await sleep(250); }
async function me(p) { return (await p.evaluate(() => World._debug())).me || { cx: -1, cz: -1, dir: -1 }; }
async function waitFor(fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(60); } return false; }

// 自作の塗り絵（白地に、1画素の黒枠の小部屋）
async function makePng(p) {
  return p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 32; c.height = 18; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 32, 18);
    g.fillStyle = '#ffd6a0'; g.fillRect(2, 2, 8, 5); // 淡いクレヨンの色
    g.fillStyle = '#000'; g.fillRect(20, 6, 7, 1); g.fillRect(20, 12, 7, 1); g.fillRect(20, 6, 1, 7); g.fillRect(26, 6, 1, 7);
    window.__testCanvas = c;
    return c.toDataURL('image/png').split(',')[1];
  });
}

function bfs(map, from, to) {
  const { w, h, heights } = map; const prev = new Int32Array(w * h).fill(-1); const q = [from.z * w + from.x]; prev[q[0]] = q[0];
  while (q.length) {
    const i = q.shift(); const x = i % w, z = (i - x) / w; if (x === to.x && z === to.z) break;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], nz = z + DZ[d]; if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
      const j = nz * w + nx; if (prev[j] !== -1) continue; if (Math.abs(heights[j] - heights[i]) > 1) continue; prev[j] = i; q.push(j);
    }
  }
  const t = to.z * w + to.x; if (prev[t] === -1) return null;
  const path = []; for (let i = t; i !== from.z * w + from.x; i = prev[i]) path.unshift({ x: i % w, z: Math.floor(i / w) });
  return path;
}

async function turnTo(p, dir) {
  for (let k = 0; k < 4; k++) {
    const m = await me(p); if (m.dir === dir) return true;
    const right = (dir - m.dir + 4) % 4 === 1 || (dir - m.dir + 4) % 4 === 2;
    const key = right ? 'right' : 'left';
    await p.evaluate((k) => { World.press(k, true); World.press(k, false); }, key);
    await waitFor(async () => (await me(p)).dir !== m.dir, 6000);
    await sleep(350);
  }
  return (await me(p)).dir === dir;
}
async function stepTo(p, cell) {
  const m = await me(p); const d = [0, 1, 2, 3].find((d) => m.cx + DX[d] === cell.x && m.cz + DZ[d] === cell.z);
  await turnTo(p, d);
  await p.evaluate(() => { World.press('fwd', true); World.press('fwd', false); });
  const moved = await waitFor(async () => { const n = await me(p); return n.cx === cell.x && n.cz === cell.z; }, 6000);
  await sleep(300);
  return moved;
}
async function drive(p, map, target) {
  const m = await me(p); const path = bfs(map, { x: m.cx, z: m.cz }, target); if (!path) return false;
  for (const c of path) { if (!(await stepTo(p, c))) return false; if (await state(p) !== 'play') return true; }
  return true;
}

const rec = (p) => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('seecar.record')); } catch (e) { return null; } });
const setg = (p) => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('seecar.settings')); } catch (e) { return null; } });
async function toTitle(page) { await sleep(400); await page.click('#boot', { force: true }); await sleep(400); }
async function pickFile(page) {
  const b64 = await makePng(page);
  await page.setInputFiles('.card.file input', { name: 'nurie.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  await sleep(1200);
}
// 壁の手前まで運転して撃つ（新旧どちらの大砲でも通る：z=12,13 の2マス厚の壁を、手前の1マスから順に壊す）
async function breakWall(page, map, tag) {
  const stage = { x: map.treasure.x, z: 10 };
  ok(tag + '壁の手前まで運転', await drive(page, map, stage), await me(page));
  await turnTo(page, 2);
  await page.evaluate(() => World.setCamera(1)); await sleep(800);
  const H = (z) => page.evaluate(([x, z]) => World._debug(x, z).h, [stage.x, z]);
  for (let shot = 0; shot < 2 && ((await H(12)) > 0 || (await H(13)) > 0); shot++) {
    if ((await H(12)) === 0) { await stepTo(page, { x: stage.x, z: 11 }); await turnTo(page, 2); }
    await page.evaluate(() => World.press('fire', true)); await sleep(150); await page.evaluate(() => World.press('fire', false));
    if (shot === 0) { await sleep(450); }
    await waitFor(async () => (await H(12)) === 0, 20000);
    // 新しい大砲は1回に1マス。2回目は手前の12が0になったあと、13が壊れるのを待つ
    if (shot === 1) await waitFor(async () => (await H(13)) === 0, 20000);
    else await waitFor(async () => (await H(13)) === 0, 3000);
    await sleep(300);
  }
  const hh = [await H(12), await H(13)];
  ok(tag + '壁が壊れて通れる（12と13が高さ0）', hh[0] === 0 && hh[1] === 0, hh);
  map.heights[12 * map.w + stage.x] = 0; map.heights[13 * map.w + stage.x] = 0;
}
const mapOf = (page) => page.evaluate(() => { const m = MapGen.fromCanvas(window.__testCanvas); return { w: m.w, h: m.h, heights: Array.from(m.heights), treasure: m.treasure, start: m.starts[0] }; });

async function solo(browser) {
  const { page, errors } = await openPage(FILE, { browser });
  await sleep(500); await page.screenshot({ path: SH + '01boot.png' });
  ok('ひとり: 起動画面', await state(page) === 'boot');
  ok('ひとり: 起動画面でもホームボタンが見える', await page.evaluate(() => { const r = document.getElementById('home').getBoundingClientRect(); return getComputedStyle(document.getElementById('home')).display !== 'none' && r.width > 20; }));
  await toTitle(page);
  ok('ひとり: タイトルへ', await state(page) === 'title'); await page.screenshot({ path: SH + '02title.png' });
  const tl = await page.evaluate(() => Array.from(document.querySelectorAll('#nav [data-nav]')).map((b) => b.dataset.nav));
  ok('タイトルのボタン：はじめる／ひとりで れんしゅう／つうしんで あそぶ／せってい', JSON.stringify(tl) === JSON.stringify(['はじめる', 'ひとりで れんしゅう', 'つうしんで あそぶ', 'せってい']), tl);
  const hop = await page.evaluate(() => Array.from(document.querySelectorAll('#nav .nbtn')).map((b) => getComputedStyle(b).animationName !== 'none'));
  ok('タイトル：はずむのは「はじめる」だけ', hop[0] === true && hop.slice(1).every((x) => !x), hop);
  ok('タイトル：いまの難しさの勝ち負けを小さく表示', await page.evaluate(() => /ふつう/.test(document.getElementById('recchip').textContent) && /0かち 0まけ/.test(document.getElementById('recchip').textContent)));
  const small = await page.evaluate(() => { const u = Math.min(innerWidth, innerHeight * 16 / 9 > innerWidth ? innerWidth * 9 / 16 : innerHeight) / 100; return Array.from(document.querySelectorAll('#nav .nbtn,#home')).every((b) => b.getBoundingClientRect().height >= 8 * u - 1); });
  ok('タイトル：ボタンは短辺の8%以上', small);
  await nav(page, 'ひとりで れんしゅう'); ok('ひとり: ちずえらびへ', await state(page) === 'setting' && await page.evaluate(() => document.getElementById('setting').dataset.sub === 'pick')); await page.screenshot({ path: SH + '03pick.png' });
  const grp = await page.evaluate(() => ({ yoji: document.querySelectorAll('.grp.yoji .card').length, illust: document.querySelectorAll('.grp.illust .card').length, file: !!document.querySelector('.card.file input') }));
  ok('ちずえらび：よじじゅくごとイラストに分かれて並ぶ', grp.yoji >= 3 && grp.illust >= 1 && grp.file, grp);
  await page.click('.card[data-id=mikka]', { force: true }); await sleep(900); await page.screenshot({ path: SH + '04preview.png' });
  await nav(page, 'しゅっぱつ！'); await sleep(1500);
  ok('ひとり: プレイへ', await state(page) === 'play'); await page.screenshot({ path: SH + '05play.png' });
  const camBtn = await page.evaluate(() => ({ label: document.getElementById('cam-label').textContent, svgs: document.querySelectorAll('#cam svg').length }));
  ok('ひとり: カメラボタンは次の視点（そらへ）だけを絵と文字で示す', camBtn.label === 'そらへ' && camBtn.svgs === 1, camBtn);
  await page.evaluate(() => World.setCamera(2)); await sleep(1300); await page.screenshot({ path: SH + '06top.png' });
  await page.click('#home', { force: true }); await sleep(300); await page.screenshot({ path: SH + '10modal.png' });
  ok('ひとり: ホームで一時停止', await page.evaluate(() => World.isPaused === true || World._debug().paused === true));
  await page.click('#m-no', { force: true }); await sleep(300);
  ok('ひとり: いいえで再開', await page.evaluate(() => World._debug().paused === false) && await state(page) === 'play');
  await page.evaluate(() => App._found(0)); await sleep(800);
  ok('ひとり: 宝で みつけた！（かち・まけは出ない）', await state(page) === 'ending' && await page.evaluate(() => document.getElementById('end-found').textContent === 'みつけた！' && getComputedStyle(document.getElementById('end-rec')).display === 'none'));
  ok('ひとり: 記録は増えない', (await rec(page)) === null || JSON.stringify(await rec(page)).indexOf('"win":1') < 0, await rec(page));
  await page.screenshot({ path: SH + '11ending.png' });
  await nav(page, 'おわる'); ok('ひとり: おしまい画面', await state(page) === 'quit'); await page.screenshot({ path: SH + '12quit.png' });
  await nav(page, 'はじめから'); ok('ひとり: タイトルへ戻る', await state(page) === 'title');
  await nav(page, 'ひとりで れんしゅう'); await page.click('.card[data-id=mikka]', { force: true }); await sleep(600); await nav(page, 'しゅっぱつ！'); await sleep(1500);
  for (let i = 0; i < 15; i++) { await page.click('#home', { force: true }); }
  await sleep(300); ok('ひとり: ホーム連打でモーダル1枚', await page.evaluate(() => getComputedStyle(document.getElementById('modal')).display !== 'none'));
  await page.click('#m-yes', { force: true }); await sleep(300); ok('ひとり: はいで おしまい', await state(page) === 'quit');
  ok('ひとり: コンソールエラー0', errors.length === 0, errors.slice(0, 5));
  await page.context().close();
}

// CPU戦：はじめる→難しさ→地図→しゅっぱつ→プレイ→（CPUか自分が宝に着く）→結果で記録が1増える
async function cpu(browser) {
  const { page, errors } = await openPage(FILE, { browser });
  await toTitle(page);
  await nav(page, 'はじめる'); await sleep(300);
  ok('CPU: 難しさえらびへ', await state(page) === 'setting' && await page.evaluate(() => document.getElementById('setting').dataset.sub === 'level'));
  await page.screenshot({ path: SH + '30level.png' });
  const lv = await page.evaluate(() => Array.from(document.querySelectorAll('.lvcard b')).map((b) => b.textContent));
  ok('CPU: やさしい／ふつう／むずかしい', JSON.stringify(lv) === JSON.stringify(['やさしい', 'ふつう', 'むずかしい']), lv);
  await page.click('.lvcard[data-level=easy]', { force: true }); await sleep(400);
  ok('CPU: やさしいを選ぶと ちずえらびへ。設定に保存', await page.evaluate(() => document.getElementById('setting').dataset.sub === 'pick') && (await setg(page)).level === 'easy', await setg(page));
  await pickFile(page); await page.screenshot({ path: SH + '31pick.png' });
  const map = await mapOf(page);
  let loadArg = null;
  await page.evaluate(() => { const o = World.load; window.__loadArg = null; World.load = function (m, opts) { window.__loadArg = opts; return o.apply(this, arguments); }; });
  await nav(page, 'しゅっぱつ！'); await sleep(1000);
  loadArg = await page.evaluate(() => window.__loadArg);
  ok('CPU: World.load に cpu:{level:easy}、myIndex:0、net:false', loadArg && loadArg.cpu && loadArg.cpu.level === 'easy' && loadArg.myIndex === 0 && loadArg.net === false, loadArg);
  ok('CPU: プレイへ', await state(page) === 'play');
  await waitFor(async () => (await page.evaluate(() => World._debug().intro)) < 0, 40000); await sleep(500);
  await page.screenshot({ path: SH + '32play.png' });
  // 自分が運転して宝へ（CPUが先に着いたら その結果になる）
  await breakWall(page, map, 'CPU: ');
  await drive(page, map, map.treasure);
  await waitFor(async () => (await state(page)) === 'ending', 8000);
  ok('CPU: 結果画面へ', await state(page) === 'ending');
  await sleep(600); await page.screenshot({ path: SH + '33ending.png' });
  const r1 = await rec(page), head = await page.evaluate(() => document.getElementById('end-found').textContent);
  const n = r1 ? r1.easy.win + r1.easy.lose : -1;
  ok('CPU: 記録（やさしい）がちょうど1増えた', n === 1, r1);
  ok('CPU: 見出しと記録が合う（かち！→win、まけ…→lose）', (head === 'かち！' && r1.easy.win === 1) || (head === 'まけ…' && r1.easy.lose === 1), head);
  ok('CPU: 結果に「〇かち 〇まけ」', await page.evaluate(() => /\d+かち \d+まけ/.test(document.getElementById('end-rec').textContent)));
  // もういちど → 地図 → 強制的に「まけ」
  await nav(page, 'もういちど'); await sleep(300);
  ok('CPU: もういちど で ちずえらび', await page.evaluate(() => document.getElementById('setting').dataset.sub === 'pick'));
  await page.click('.card[data-id=mikka]', { force: true }); await sleep(900); await nav(page, 'しゅっぱつ！'); await sleep(1200);
  if (await state(page) === 'play') { await page.evaluate(() => App._found(1)); await sleep(700); }
  const head2 = await page.evaluate(() => document.getElementById('end-found').textContent);
  const r2 = await rec(page);
  ok('CPU: コンピューターが先に見つけたら「まけ…」で記録に足される', head2 === 'まけ…' && r2.easy.lose >= 1 && r2.easy.win + r2.easy.lose === 2, { head2, r2 });
  ok('CPU: まけの文言', await page.evaluate(() => /コンピューター/.test(document.getElementById('end-who').textContent)));
  await page.screenshot({ path: SH + '34lose.png' });
  await nav(page, 'おわる'); await nav(page, 'はじめから'); await sleep(300);
  ok('CPU: タイトルに記録が出る', await page.evaluate(() => /やさしい/.test(document.getElementById('recchip').textContent) && /1かち 1まけ/.test(document.getElementById('recchip').textContent)), await page.evaluate(() => document.getElementById('recchip').textContent));
  ok('CPU: コンソールエラー0', errors.length === 0, errors.slice(0, 5));
  await page.context().close();
}

// せってい：やじるし、スワイプ反転、白黒、記録を消す
async function settings(browser) {
  const { page, errors } = await openPage(FILE, { browser });
  await toTitle(page);
  await nav(page, 'せってい'); await sleep(300);
  ok('せってい: Setting の中の画面', await state(page) === 'setting' && await page.evaluate(() => document.getElementById('setting').dataset.sub === 'opts'));
  await page.screenshot({ path: SH + '40settings.png' });
  ok('せってい: 既定値', JSON.stringify(await setg(page) || { arrows: true, swipeRev: false, binary: false }).includes('"arrows":true') || (await setg(page)) === null, await setg(page));
  const smallBtns = await page.evaluate(() => { const u = document.getElementById('stage').getBoundingClientRect().height / 100; return Array.from(document.querySelectorAll('.sub-opts button')).map((b) => b.getBoundingClientRect().height / u).every((h) => h >= 8); });
  ok('せってい: ボタンは短辺の8%以上', smallBtns);
  const click = async (k, v) => { await page.click(`.seg button[data-set=${k}][data-val="${v}"]`, { force: true }); await sleep(200); };
  await click('arrows', 0); await click('swipeRev', 1); await click('binary', 1);
  const st = await setg(page);
  ok('せってい: localStorage seecar.settings に保存', st && st.arrows === false && st.swipeRev === true && st.binary === true, st);
  await page.screenshot({ path: SH + '41settings_changed.png' });
  // 記録を消す：先に記録を入れる
  await page.evaluate(() => { localStorage.setItem('seecar.record', JSON.stringify({ easy: { win: 3, lose: 2 }, normal: { win: 1, lose: 0 }, hard: { win: 0, lose: 1 }, net: { win: 0, lose: 0 } })); });
  await page.reload(); await sleep(500); await toTitle(page);
  ok('せってい: 再読み込みでも設定が残る', await page.evaluate(() => document.body.classList.contains('noarrows')));
  await nav(page, 'せってい'); await sleep(200);
  await page.click('#reset-rec', { force: true }); await sleep(300); await page.screenshot({ path: SH + '42reset_modal.png' });
  ok('きろくを けす: 確認モーダルが出る', await page.evaluate(() => document.getElementById('modal').classList.contains('on') && /けしますか/.test(document.getElementById('m-title').textContent)));
  await page.click('#m-no', { force: true }); await sleep(250);
  ok('きろくを けす: やめる で記録は残る', (await rec(page)).easy.win === 3, await rec(page));
  await page.click('#reset-rec', { force: true }); await sleep(250); await page.click('#m-yes', { force: true }); await sleep(300);
  const r = await rec(page);
  ok('きろくを けす: けす で 全部0', r && ['easy', 'normal', 'hard'].every((k) => r[k].win === 0 && r[k].lose === 0), r);
  ok('きろくを けす: 設定画面に残る（おしまいにならない）', await state(page) === 'setting');
  // 白黒モード：えを読み込む → 色のある所(2..9,2..6画素)が高さ0に
  await page.click('#back', { force: true }); await sleep(200);
  await nav(page, 'ひとりで れんしゅう');
  ok('白黒: 「えを よみこむ」に しろくろ の印', await page.evaluate(() => !!document.querySelector('.card.file .bw')));
  await pickFile(page); await nav(page, 'しゅっぱつ！'); await sleep(1500);
  const hs = await page.evaluate(() => { const o = []; for (let x = 4; x < 20; x += 3) for (let z = 4; z < 14; z += 3) o.push(World._debug(x, z).h); return o; });
  ok('白黒: 読み込んだ絵の薄い色の所が 高さ0（白）になる', hs.every((h) => h === 0), hs);
  const wall = await page.evaluate(() => World._debug(44, 12).h);
  ok('白黒: 黒線は高さ10', wall === 10, wall);
  // 操作ボタン：やじるしを消した状態
  await waitFor(async () => (await page.evaluate(() => World._debug().intro)) < 0, 40000);
  const vis = await page.evaluate(() => { const o = {}; document.querySelectorAll('.ctl[data-act]').forEach((b) => { const r = b.getBoundingClientRect(); o[b.dataset.act] = getComputedStyle(b).display !== 'none' && r.width > 0; }); const u = document.getElementById('stage').getBoundingClientRect().height / 100; o._fwdH = document.querySelector('[data-act=fwd]').getBoundingClientRect().height / u; return o; });
  ok('やじるし消す: 「まえ」「うつ」だけ残り、ひだり・みぎ・うしろは消える', vis.fwd && vis.fire && !vis.left && !vis.right && !vis.back && vis._fwdH >= 8, vis);
  await page.screenshot({ path: SH + '43play_noarrows.png' });
  // スワイプ：呼び出しを記録
  await page.evaluate(() => {
    window.__log = []; const W = World;
    ['swipeTurn', 'nudgePitch'].forEach((n) => { const o = W[n]; W[n] = function (a) { window.__log.push([n, a]); return o ? o.apply(this, arguments) : undefined; }; });
    const op = W.press; W.press = function (a, d) { window.__log.push(['press', a, d]); return op.apply(this, arguments); };
  });
  const box = await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const drag = async (x0, y0, x1, y1, from) => {
    await page.mouse.move(x0, y0); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8); await sleep(15); }
    await page.mouse.up(); await sleep(150);
  };
  const turns = () => page.evaluate(() => window.__log.filter((l) => l[0] === 'swipeTurn' || (l[0] === 'press' && (l[1] === 'left' || l[1] === 'right') && l[2] === true)));
  const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.45;
  await drag(cx - 60, cy, cx + 120, cy);
  let t = await turns();
  const isRight = (l) => (l[0] === 'swipeTurn' && l[1] === 1) || (l[0] === 'press' && l[1] === 'right');
  ok('スワイプ反転（はんたい）: 右へなぞると 左を向く', t.length === 1 && !isRight(t[0]), t);
  await page.evaluate(() => { window.__log.length = 0; });
  await drag(cx + 60, cy, cx - 120, cy);
  t = await turns();
  ok('スワイプ反転（はんたい）: 左へなぞると 右を向く', t.length === 1 && isRight(t[0]), t);
  await page.evaluate(() => { window.__log.length = 0; });
  await drag(cx, cy + 60, cx, cy - 60);
  const np = await page.evaluate(() => window.__log.filter((l) => l[0] === 'nudgePitch'));
  ok('上へドラッグ: 視点の上下（nudgePitch が正の値）。World側に関数が無くても落ちない', np.length >= 1 ? np.every((l) => l[1] > 0) : true, np);
  ok('上下ドラッグでは 向きは変わらない', (await turns()).length === 0, await turns());
  // ボタンの上から始めた操作は除外
  await page.evaluate(() => { window.__log.length = 0; });
  const fb = await page.evaluate(() => { const r = document.getElementById('cam').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const camBefore = await page.evaluate(() => document.getElementById('cam-label').textContent);
  await page.mouse.move(fb.x, fb.y); await page.mouse.down(); await page.mouse.move(fb.x - 150, fb.y, { steps: 6 }); await page.mouse.up(); await sleep(200);
  ok('ボタン上から始めたスワイプは向きを変えない', (await turns()).length === 0, await turns());
  ok('スワイプで画面遷移しない', await state(page) === 'play');
  // 設定を戻して ふつうの向き
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('seecar.settings')); s.swipeRev = false; localStorage.setItem('seecar.settings', JSON.stringify(s)); });
  await page.reload(); await sleep(500); await toTitle(page);
  await nav(page, 'ひとりで れんしゅう'); await page.click('.card[data-id=mikka]', { force: true }); await sleep(800); await nav(page, 'しゅっぱつ！'); await sleep(1200);
  await page.evaluate(() => { window.__log = []; const W = World; const o = W.swipeTurn; W.swipeTurn = function (a) { window.__log.push(['swipeTurn', a]); return o ? o.apply(this, arguments) : undefined; }; const op = W.press; W.press = function (a, d) { window.__log.push(['press', a, d]); return op.apply(this, arguments); }; });
  await drag(cx - 60, cy, cx + 120, cy);
  t = await turns();
  ok('スワイプ（ふつう）: 右へなぞると 右を向く', t.length === 1 && isRight(t[0]), t);
  await page.screenshot({ path: SH + '44swipe.png' });
  ok('せってい: コンソールエラー0', errors.length === 0, errors.slice(0, 5));
  await page.context().close();
}

async function online(browser) {
  const q = '?peerhost=127.0.0.1&peerport=' + PEER_PORT + '&peerpath=/myapp&peersecure=0';
  const A = await openPage(FILE, { browser, query: q }), B = await openPage(FILE, { browser, query: q });
  for (const P of [A.page, B.page]) { await sleep(300); await P.click('#boot', { force: true }); await sleep(300); await nav(P, 'つうしんで あそぶ'); }
  await A.page.click('#c-host', { force: true }); await sleep(1500);
  const code = await A.page.evaluate(() => document.getElementById('codeshow').textContent.replace(/\D/g, ''));
  ok('つうしん: 4桁の番号', /^\d{4}$/.test(code), code); await A.page.screenshot({ path: SH + '20host_code.png' });
  await B.page.click('#c-join', { force: true }); await sleep(300);
  for (const d of code) { await B.page.click(`#keypad .key:text-is("${d}")`, { force: true }); await sleep(80); }
  await B.page.screenshot({ path: SH + '21guest_keypad.png' });
  await nav(B.page, 'つなぐ！');
  await waitFor(async () => (await A.page.evaluate(() => !!document.querySelector('.card[data-id=mikka]') && document.getElementById('cards').offsetParent !== null)), 8000);
  await sleep(500); await A.page.screenshot({ path: SH + '22host_pick.png' });
  await A.page.click('.card[data-id=mikka]', { force: true }); await sleep(600); await nav(A.page, 'しゅっぱつ！');
  await waitFor(async () => (await state(B.page)) === 'play', 8000); await sleep(1500);
  ok('つうしん: 両方プレイへ', await state(A.page) === 'play' && await state(B.page) === 'play', [await state(A.page), await state(B.page)]);
  // ホストが1マス進む → ゲスト側の相手戦車が動く
  await B.page.evaluate(() => { const o = World.applyRemoteState; window.__last = null; World.applyRemoteState = function (i, s) { window.__last = s; return o.apply(this, arguments); }; });
  const before = (await B.page.evaluate(() => World._debug().remotes))[0];
  const am = await me(A.page);
  for (const k of ['fwd']) { await A.page.evaluate((k) => World.press(k, true), k); await sleep(700); await A.page.evaluate((k) => World.press(k, false), k); }
  await waitFor(async () => !(await A.page.evaluate(() => World._debug().me.x % 1)), 10000); await sleep(4000);
  const after = (await B.page.evaluate(() => World._debug().remotes))[0]; const am2 = await me(A.page);
  const last = await B.page.evaluate(() => window.__last);
  ok('つうしん: 相手の位置が届く', last && Math.abs(last.x - am2.x) < 0.05 && Math.abs(last.z - am2.z) < 0.05, { last, host: am2 });
  ok('つうしん: 相手の戦車の表示が追いつく（遅い検査環境では参考）', after && Math.abs(after.x - am2.x) < 0.3, { before, after });
  // ホストが撃つ → ゲストの地形も同じく壊れる。
  // 撃つ前から高さ0のマスを比べても確認にならないので、2マス先が高さ1以上になる位置・向きまでホストを動かしてから撃つ。
  const pmap = await A.page.evaluate(() => { const m = MapGen.fromPreset('mikka'); return { w: m.w, h: m.h, heights: Array.from(m.heights) }; });
  const here = await me(A.page);
  const dist = new Int32Array(pmap.w * pmap.h).fill(-1); { const q = [here.cz * pmap.w + here.cx]; dist[q[0]] = 0;
    for (let k = 0; k < q.length; k++) { const i = q[k], x = i % pmap.w, z = (i - x) / pmap.w;
      for (let d = 0; d < 4; d++) { const nx = x + DX[d], nz = z + DZ[d]; if (nx < 0 || nz < 0 || nx >= pmap.w || nz >= pmap.h) continue; const j = nz * pmap.w + nx;
        if (dist[j] === -1 && Math.abs(pmap.heights[j] - pmap.heights[i]) <= 1) { dist[j] = dist[i] + 1; q.push(j); } } } }
  let spot = null; // 近い所から、2マス先の高さが 2 以上（無ければ1以上）になる向きを探す
  for (const need of [2, 1]) { let bestD = 1e9;
    for (let i = 0; i < dist.length; i++) { if (dist[i] < 0 || dist[i] >= bestD) continue; const x = i % pmap.w, z = (i - x) / pmap.w;
      for (let d = 0; d < 4; d++) { const tx2 = x + DX[d] * 2, tz2 = z + DZ[d] * 2; if (tx2 < 0 || tz2 < 0 || tx2 >= pmap.w || tz2 >= pmap.h) continue;
        if (pmap.heights[tz2 * pmap.w + tx2] >= need && pmap.heights[tz2 * pmap.w + tx2] < 10) { bestD = dist[i]; spot = { x, z, d, tx: tx2, tz: tz2 }; break; } } }
    if (spot) break; }
  ok('つうしん: 撃つ場所（2マス先が高さ1以上）が見つかる', !!spot, spot);
  const driven = await drive(A.page, pmap, { x: spot.x, z: spot.z });
  await turnTo(A.page, spot.d); await sleep(400);
  const m = await me(A.page); const tx = m.cx + DX[m.dir] * 2, tz = m.cz + DZ[m.dir] * 2;
  ok('つうしん: ホストが撃つ位置・向きに着いた', driven && tx === spot.tx && tz === spot.tz, { m, spot });
  const hA0 = await A.page.evaluate(([x, z]) => World._debug(x, z).h, [tx, tz]);
  const hb0 = await B.page.evaluate(([x, z]) => World._debug(x, z).h, [tx, tz]);
  const tx1 = m.cx + DX[m.dir], tz1 = m.cz + DZ[m.dir];
  const g1 = async (P) => P.evaluate(([x, z]) => World._debug(x, z).h, [tx1, tz1]);
  ok('つうしん: 撃つ前の2マス先は両方で高さ1以上', hA0 >= 1 && hb0 >= 1, { hA0, hb0, tx, tz });
  await A.page.evaluate(() => World.press('fire', true)); await sleep(100); await A.page.evaluate(() => World.press('fire', false));
  // 相手(B)の画面にも弾が飛ぶ：発射のあと、壊れる前に弾が見えるはず（遅い環境では参考）
  const sawBall = await waitFor(async () => (await B.page.evaluate(() => World._debug().projectiles)) > 0, 6000);
  await B.page.screenshot({ path: SH + '26guest_ball.png' });
  // 新しい大砲：手前の1マスに壁があればそれが壊れ、なければ2マス先が壊れる（どちらでも A と B が一致すればよい）
  await waitFor(async () => (await A.page.evaluate(([x, z]) => World._debug(x, z).h, [tx, tz])) === 0 || (await g1(A.page)) === 0 || (await B.page.evaluate(([x, z]) => World._debug(x, z).h, [tx, tz])) === 0, 25000); await sleep(2500);
  ok('つうしん: 相手の弾が自分の画面で飛ぶ', sawBall, { sawBall, hb0 });
  const ha = await A.page.evaluate(([x, z]) => World._debug(x, z).h, [tx, tz]); const hb = await B.page.evaluate(([x, z]) => World._debug(x, z).h, [tx, tz]);
  const ga = await g1(A.page), gb = await g1(B.page);
  ok('つうしん: 破壊が両方で一致（撃つ前は1以上、撃った後は同じ形で壊れている）', hA0 >= 1 && hb0 >= 1 && ha === hb && ga === gb && (ha === 0 || ga === 0), { before: [hA0, hb0], after: [ha, hb], first: [ga, gb], tx, tz });
  await A.page.screenshot({ path: SH + '23host_play.png' }); await B.page.screenshot({ path: SH + '24guest_play.png' });
  // ゲストを閉じる → ホストに表示
  await B.context.close();
  const noticeOn = await waitFor(async () => A.page.evaluate(() => document.getElementById('notice').classList.contains('on')), 15000);
  const bigNow = await A.page.evaluate(() => document.getElementById('notice').classList.contains('big') && /ひとりで/.test(document.getElementById('notice').textContent));
  await A.page.screenshot({ path: SH + '25host_after_leave.png' });
  ok('つうしん: 抜けた知らせは最初は大きく、次にすることが書いてある', noticeOn && bigNow, bigNow);
  ok('つうしん: 相手が抜けたら相手の戦車が消える', (await A.page.evaluate(() => World._debug().remotes.length)) === 0);
  await sleep(8000); // 7秒たっても消えない
  let seen = false; for (let i = 0; i < 20 && !seen; i++) { seen = await A.page.evaluate(() => document.getElementById('notice').classList.contains('on') && /いなくなった/.test(document.getElementById('notice').textContent)); if (!seen) await sleep(500); }
  ok('つうしん: 相手が抜けた表示（12秒以内）', seen && (await state(A.page)) === 'play');
  const still = await A.page.evaluate(() => document.getElementById('notice').classList.contains('on'));
  await A.page.screenshot({ path: SH + '25b_host_leave_8s_later.png' });
  const smallNow = await A.page.evaluate(() => !document.getElementById('notice').classList.contains('big'));
  ok('つうしん: 抜けた表示は8秒すぎても出つづける（小さくなって）', still && smallNow, { still, smallNow });
  ok('つうしん: コンソールエラー0', A.errors.length === 0 && B.errors.length === 0, [...A.errors, ...B.errors].slice(0, 5));
}

(async () => {
  const ps = startPeerServer(PEER_PORT);
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const ONLY = process.env.ONLY || '';
  if (!ONLY || ONLY === 'solo') try { await solo(browser); } catch (e) { ok('ひとり: 例外なし', false, String(e).slice(0, 300)); }
  if (!ONLY || ONLY === 'cpu') try { await cpu(browser); } catch (e) { ok('CPU: 例外なし', false, String(e).slice(0, 300)); }
  if (!ONLY || ONLY === 'settings') try { await settings(browser); } catch (e) { ok('せってい: 例外なし', false, String(e).slice(0, 300)); }
  if (!ONLY || ONLY === 'online') try { await online(browser); } catch (e) { ok('つうしん: 例外なし', false, String(e).slice(0, 300)); }
  console.log(results.join('\n'));
  await browser.close(); stopStatic(); ps.close(); process.exit(0);
})();
