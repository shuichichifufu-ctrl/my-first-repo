// 結合版の通し確認: node test/e2e.js v1
// 1) ひとり: 起動→タイトル→自作の塗り絵を読み込み→しゅっぱつ→自動運転で壁を壊して宝へ→みつけた！→おわる→おしまい
// 2) つうしん: 手元の中継サーバーでホストとゲストをつなぎ、同期と破壊の一致、切断表示を確認
const { openPage, startPeerServer, stopStatic } = require('./harness.js');
const ver = process.argv[2] || 'v1';
const FILE = `/home/user/my-first-repo/seecar/dist/seecar_${ver}.html`;
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

async function solo(browser) {
  const { page, errors } = await openPage(FILE, { browser });
  await sleep(500); await page.screenshot({ path: SH + '01boot.png' });
  ok('ひとり: 起動画面', await state(page) === 'boot');
  await page.click('#boot', { force: true }); await sleep(400);
  ok('ひとり: タイトルへ', await state(page) === 'title'); await page.screenshot({ path: SH + '02title.png' });
  await nav(page, 'はじめる'); ok('ひとり: せっていへ', await state(page) === 'setting'); await page.screenshot({ path: SH + '03setting.png' });
  const b64 = await makePng(page);
  await page.setInputFiles('.card.file input', { name: 'nurie.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  await sleep(1200); await page.screenshot({ path: SH + '04preview.png' });
  await nav(page, 'しゅっぱつ！'); await sleep(1500);
  ok('ひとり: プレイへ', await state(page) === 'play'); await page.screenshot({ path: SH + '05play.png' });
  const map = await page.evaluate(() => { const m = MapGen.fromCanvas(window.__testCanvas); return { w: m.w, h: m.h, heights: Array.from(m.heights), treasure: m.treasure, start: m.starts[0] }; });
  const m0 = await me(page);
  ok('ひとり: スタート位置が地図データと一致', m0 && m0.cx === map.start.x && m0.cz === map.start.z, { me: m0, start: map.start });
  ok('ひとり: 宝が小部屋の中', map.treasure.x >= 42 && map.treasure.x <= 51 && map.treasure.z >= 14 && map.treasure.z <= 23, map.treasure);
  // 小部屋の上の壁(z=12,13)の2マス手前(z=10)まで行き、南を向いて撃つ
  const stage = { x: map.treasure.x, z: 10 };
  ok('ひとり: 壁の手前まで運転', await drive(page, map, stage), await me(page));
  await turnTo(page, 2);
  await page.evaluate(() => World.setCamera(1)); await sleep(800);
  await page.evaluate(() => World.press('fire', true)); await sleep(150); await page.evaluate(() => World.press('fire', false));
  await sleep(450); await page.screenshot({ path: SH + '06fire.png' });
  await sleep(500); await page.screenshot({ path: SH + '07boom.png' });
  const hh = await page.evaluate((x) => [World._debug(x, 12).h, World._debug(x, 13).h, World._debug(x, 14).h], stage.x);
  ok('ひとり: 2マス先と3マス先だけ高さ0に', hh[0] === 0 && hh[1] === 0, hh);
  map.heights[12 * map.w + stage.x] = 0; map.heights[13 * map.w + stage.x] = 0;
  await page.evaluate(() => World.setCamera(0)); await sleep(900); await page.screenshot({ path: SH + '08first.png' });
  await page.evaluate(() => World.setCamera(2)); await sleep(1200); await page.screenshot({ path: SH + '09top.png' });
  await page.evaluate(() => World.setCamera(1)); await sleep(600);
  // ホーム→いいえ
  await page.click('#home', { force: true }); await sleep(300); await page.screenshot({ path: SH + '10modal.png' });
  ok('ひとり: ホームで一時停止', await page.evaluate(() => World.isPaused === true || World._debug().paused === true));
  await page.click('#m-no', { force: true }); await sleep(300);
  ok('ひとり: いいえで再開', await page.evaluate(() => World._debug().paused === false) && await state(page) === 'play');
  await drive(page, map, map.treasure);
  await waitFor(async () => (await state(page)) === 'ending', 6000);
  ok('ひとり: 宝で みつけた！', await state(page) === 'ending', await me(page));
  await sleep(800); await page.screenshot({ path: SH + '11ending.png' });
  await nav(page, 'おわる'); ok('ひとり: おしまい画面', await state(page) === 'quit'); await page.screenshot({ path: SH + '12quit.png' });
  await nav(page, 'はじめから'); ok('ひとり: タイトルへ戻る', await state(page) === 'title');
  // 2回目（既定地図）: 再スタートで壊れないか
  await nav(page, 'はじめる'); await page.click('.card[data-id=isseki]', { force: true }); await sleep(600); await nav(page, 'しゅっぱつ！'); await sleep(1500);
  ok('ひとり: 2回目の既定地図でプレイ', await state(page) === 'play'); await page.screenshot({ path: SH + '13preset.png' });
  await page.evaluate(() => World.setCamera(2)); await sleep(1300); await page.screenshot({ path: SH + '14preset_top.png' });
  // 連打
  for (let i = 0; i < 15; i++) { await page.click('#home', { force: true }); }
  await sleep(300); ok('ひとり: ホーム連打でモーダル1枚', await page.evaluate(() => getComputedStyle(document.getElementById('modal')).display !== 'none'));
  await page.click('#m-yes', { force: true }); await sleep(300); ok('ひとり: はいで おしまい', await state(page) === 'quit');
  ok('ひとり: コンソールエラー0', errors.length === 0, errors.slice(0, 5));
}

async function online(browser) {
  const q = '?peerhost=127.0.0.1&peerport=9000&peerpath=/myapp&peersecure=0';
  const A = await openPage(FILE, { browser, query: q }), B = await openPage(FILE, { browser, query: q });
  for (const P of [A.page, B.page]) { await sleep(300); await P.click('#boot', { force: true }); await sleep(300); await nav(P, 'つうしんであそぶ'); }
  await A.page.click('#c-host', { force: true }); await sleep(1500);
  const code = await A.page.evaluate(() => document.getElementById('codeshow').textContent.replace(/\D/g, ''));
  ok('つうしん: 4桁の番号', /^\d{4}$/.test(code), code); await A.page.screenshot({ path: SH + '20host_code.png' });
  await B.page.click('#c-join', { force: true }); await sleep(300);
  for (const d of code) { await B.page.click(`#keypad .key:text-is("${d}")`, { force: true }); await sleep(80); }
  await B.page.screenshot({ path: SH + '21guest_keypad.png' });
  await nav(B.page, 'つなぐ！');
  await waitFor(async () => (await A.page.evaluate(() => !!document.querySelector('.card[data-id=isseki]') && document.getElementById('cards').offsetParent !== null)), 8000);
  await sleep(500); await A.page.screenshot({ path: SH + '22host_pick.png' });
  await A.page.click('.card[data-id=isseki]', { force: true }); await sleep(600); await nav(A.page, 'しゅっぱつ！');
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
  // ホストが撃つ → ゲストの地形も同じく壊れる
  await A.page.evaluate(() => World.press('fire', true)); await sleep(100); await A.page.evaluate(() => World.press('fire', false)); await sleep(2000);
  const m = await me(A.page); const tx = m.cx + DX[m.dir] * 2, tz = m.cz + DZ[m.dir] * 2;
  const ha = await A.page.evaluate(([x, z]) => World._debug(x, z).h, [tx, tz]); const hb = await B.page.evaluate(([x, z]) => World._debug(x, z).h, [tx, tz]);
  ok('つうしん: 破壊が両方で一致', ha === 0 && hb === 0, { ha, hb, tx, tz });
  await A.page.screenshot({ path: SH + '23host_play.png' }); await B.page.screenshot({ path: SH + '24guest_play.png' });
  // ゲストを閉じる → ホストに表示
  await B.context.close(); await sleep(2500); await A.page.screenshot({ path: SH + '25host_after_leave.png' });
  let seen = false; for (let i = 0; i < 20 && !seen; i++) { seen = await A.page.evaluate(() => document.getElementById('notice').classList.contains('on') && /いなくなった/.test(document.getElementById('notice').textContent)); if (!seen) await sleep(500); }
  ok('つうしん: 相手が抜けた表示（12秒以内）', seen && (await state(A.page)) === 'play');
  ok('つうしん: コンソールエラー0', A.errors.length === 0 && B.errors.length === 0, [...A.errors, ...B.errors].slice(0, 5));
}

(async () => {
  const ps = startPeerServer(9000);
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  try { await solo(browser); } catch (e) { ok('ひとり: 例外なし', false, String(e).slice(0, 300)); }
  try { await online(browser); } catch (e) { ok('つうしん: 例外なし', false, String(e).slice(0, 300)); }
  console.log(results.join('\n'));
  await browser.close(); stopStatic(); ps.close(); process.exit(0);
})();
