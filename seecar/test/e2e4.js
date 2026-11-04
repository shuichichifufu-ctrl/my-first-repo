// 「見つけて！PixSee v9.0」UI の通し確認（第4期）
//   静的な確認（署名・v9.0・§2-4 の固定の指定・px 不使用・禁止語）
//   Boot → タイトル → せってい（いろ・さがしかた）→ 各モード → カウントダウン → プレイ → 獲得宣言 → 結果
//   すべての画面のホームボタン＋モーダル（文言・resetGame・Quit）、通信（2画面・手元の中継サーバー）
//   重なりの確認（1280×720・1024×576・1024×768）
// 使い方: node e2e4.js [file.html]   （既定は test/v9/seecar_v9t.html。ONLY=static|solo|cpu|count|modal|overlap|net）
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, 'v9', 'seecar_v9t.html');
const SRC = path.join(__dirname, '..', 'src');
const SH = path.join(__dirname, 'shots', 'v9');
const PEER_PORT = +(process.env.PEER_PORT || 9871);
const ONLY = process.env.ONLY || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (name, cond, info) => { results.push(`${cond ? 'OK  ' : 'NG  '} ${name}${info !== undefined && !cond ? '  ' + JSON.stringify(info).slice(0, 400) : ''}`); if (!cond) console.log('NG', name, info !== undefined ? JSON.stringify(info).slice(0, 400) : ''); };
const BAD_WORDS = /(つちのやま|土の山|ドリルジャンプ|まけ|ひきわけ|たいけつ|たたかう|バトル|大砲|戦車)/;

/* ---------- ページを開く（CDN を手元に差し替え。World/Sfx/Net の呼ばれ方を記録） ---------- */
const LOCAL = {
  'three.min.js': path.join(__dirname, 'node_modules/three/build/three.min.js'),
  'peerjs.min.js': path.join(__dirname, 'node_modules/peerjs/dist/peerjs.min.js'),
};
let server = null, serverPort = 0;
function startStatic() {
  if (server) return Promise.resolve(serverPort);
  return new Promise((res) => {
    server = http.createServer((req, resp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
      fs.readFile(p, (err, data) => {
        if (err) { resp.writeHead(404); resp.end(); return; }
        resp.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' }); resp.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => { serverPort = server.address().port; res(serverPort); });
  });
}
const INIT = () => {
  window.__log = []; window.__wh = {}; window.__in = {};
  const QUIET = new Set(['sonar', 'scores', 'gemInfo', 'engine', 'treasureInfo', 'speedStage', 'applyRemoteState']);
  const brief = (x) => (x && typeof x === 'object') ? (Array.isArray(x) ? JSON.stringify(x).slice(0, 120) : '{obj}') : x;
  function trap(name) {
    let real;
    Object.defineProperty(window, name, {
      configurable: true, get() { return real; },
      set(v) {
        if (!v || typeof v !== 'object') { real = v; return; }
        real = new Proxy(v, { get(t, k) {
          const f = t[k]; if (typeof f !== 'function') return f;
          return function (...a) {
            const key = name + '.' + String(k), outer = !window.__in[key];
            if (outer && !QUIET.has(k)) window.__log.push([key].concat(a.map(brief)));
            if (name === 'World' && k === 'load') window.__loadOpts = JSON.parse(JSON.stringify(a[1] || {}));
            if (name === 'Net' && k === 'send' && a[0] && a[0].t !== 'st') window.__log.push(['net>' + a[0].t, JSON.stringify(a[0]).slice(0, 160)]);
            if (name === 'World' && k === 'on') { const l = (window.__wh[a[0]] = window.__wh[a[0]] || []); if (l.indexOf(a[1]) < 0) l.push(a[1]); }
            window.__in[key] = (window.__in[key] || 0) + 1;
            try { return f.apply(t, a); } finally { window.__in[key]--; }
          };
        } });
      }
    });
  }
  ['World', 'Sfx', 'Net'].forEach(trap);
  window.__emit = (e, ...a) => (window.__wh[e] || []).forEach((f) => { try { f(...a); } catch (x) { console.error(x && x.message); } });
  window.__fs = 0;
  const rf = Element.prototype.requestFullscreen;
  Element.prototype.requestFullscreen = function () { window.__fs++; return rf ? rf.call(this).catch(() => {}) : Promise.resolve(); };
};
let browser = null;
async function open(viewport = { width: 1280, height: 720 }, opts = {}) {
  const port = await startStatic();
  if (!browser) browser = await chromium.launch(process.platform === 'win32' ? { channel: process.env.PW_CHANNEL || 'chrome', headless: false, args: ['--headless=new', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] } : { args: ['--use-gl=swiftshader'] });
  const context = await browser.newContext({ viewport, hasTouch: !!opts.touch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console.error: ' + m.text()); });
  await page.route(/^https:\/\/(cdnjs\.cloudflare\.com|unpkg\.com|cdn\.jsdelivr\.net)\//, (route) => {
    const url = route.request().url(); const key = Object.keys(LOCAL).find((k) => url.endsWith(k));
    if (key) return route.fulfill({ path: LOCAL[key], contentType: 'text/javascript' });
    return route.abort();
  });
  await page.addInitScript(INIT);
  const q = opts.query || '';
  await page.goto(`http://127.0.0.1:${port}${FILE.split(path.sep).join('/').replace(/^([A-Za-z]:)/, '/$1')}${q}`);
  return { context, page, errors };
}

/* ---------- 小さな道具 ---------- */
const st = (p) => p.evaluate(() => document.body.dataset.state);
const info = (p) => p.evaluate(() => App._info());
const click = async (p, sel, ms = 300) => { await p.click(sel, { force: true }); await sleep(ms); };
const nav = (p, label, ms) => click(p, `#nav [data-nav="${label}"]`, ms);
const logOf = (p, name) => p.evaluate((n) => window.__log.filter((l) => l[0] === n), name);
const clearLog = (p) => p.evaluate(() => { window.__log.length = 0; });
const txt = (p, sel) => p.evaluate((s) => (document.querySelector(s) || {}).textContent || '', sel);
const shot = (p, n) => p.screenshot({ path: path.join(SH, `e2e4_${n}.png`) });
async function waitFor(fn, ms = 10000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(80); } return false; }
async function bootToTitle(p) {
  await waitFor(async () => !(await p.evaluate(() => document.getElementById('bootbtn').disabled)), 8000);
  await click(p, '#bootbtn', 500);
}
async function wordCheck(p, tag) {
  const t = await p.evaluate(() => document.getElementById('stage').innerText || '');
  const m = t.match(BAD_WORDS);
  ok(`${tag}：画面に禁止の言葉がない`, !m, m && m[0]);
}
async function fontCheck(p, tag) {
  const r = await p.evaluate(() => {
    const st = document.getElementById('stage').getBoundingClientRect(), cq = Math.min(st.width, st.height) / 100, bad = [];
    const w = document.createTreeWalker(document.getElementById('stage'), NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) {
      if (!n.textContent.trim()) continue;
      const e = n.parentElement; if (!e || e.closest('svg')) continue;
      const rr = e.getBoundingClientRect(); if (!rr.width || !rr.height) continue;
      const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
      let hid = false; for (let a = e; a; a = a.parentElement) { if (getComputedStyle(a).display === 'none') { hid = true; break; } } if (hid) continue;
      const fs = parseFloat(cs.fontSize) / cq;
      if (fs < 3.35) bad.push(n.textContent.trim().slice(0, 14) + ':' + fs.toFixed(2));
    }
    return bad;
  });
  ok(`${tag}：文字は 3.4cqmin 以上`, r.length === 0, r);
}

/* ---------- 1. 静的な確認 ---------- */
function staticChecks() {
  const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(SRC, 'style.css'), 'utf8');
  const ui = fs.readFileSync(path.join(SRC, 'ui.js'), 'utf8');
  const pre = html.split('<!DOCTYPE')[0];
  ok('署名コメントが <!DOCTYPE> の直前', /<!--[\s\S]*© 2026 ニルナーリ博士とヤクナーリくんのツールキッチン[\s\S]*-->\s*$/.test(pre));
  ok('画面の版は v9.0', /v9\.0/.test(html) && !/v8\b/.test(html));
  ok('contextmenu（§2-4 のとおり）', ui.includes("document.addEventListener('contextmenu', e => { if(e.target.tagName !== 'INPUT') e.preventDefault(); }, { passive: false });"));
  ok('html,body（§2-4 のとおり）', /html,body\{height:100vh;height:100dvh;position:fixed;inset:0;\}/.test(css));
  ok('* user-select（§2-4 のとおり）', css.includes('* { user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; }'));
  const pxs = (css.match(/[\d.]+px/g) || []).filter((v) => v !== '8px');
  ok('CSS に px を使っていない（モーダルの blur(8px) は固定仕様）', pxs.length === 0, pxs);
  ok('ホームボタンの位置（固定仕様）', css.includes('top:max(env(safe-area-inset-top) + 1.5cqmin, 3cqmin);') && css.includes('right:max(env(safe-area-inset-right) + 1.5cqmin, 2.5cqmin);'));
  ok('ホームボタンの見た目（固定仕様）', css.includes('background:rgba(255,255,255,0.95);') && css.includes('border-radius:50%;') && css.includes('border:0.25cqmin solid #333;') && html.includes('>🏠</button>'));
  ok('モーダルの背景（固定仕様）', css.includes('background: rgba(0,0,0,0.45); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);'));
  ok('モーダルの箱（固定仕様）', /\.mcard\{background:#fff;border-radius:2cqmin;border:0\.3cqmin solid #444;box-shadow:/.test(css));
  ok('はい／いいえ（固定仕様）', css.includes('.mbtn.yes{background:linear-gradient(145deg,#ff9800,#f57c00);box-shadow:0 1cqmin 0 #e65100}') && css.includes('.mbtn.no{background:linear-gradient(145deg,#1a6baf,#2a9fd4);box-shadow:0 1cqmin 0 #0d47a1}') && /\.mbtn\{[^}]*border-radius:3cqmin/.test(css));
  const all = html + ui;
  const strip = all.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, '');
  const bad = strip.match(/(つちのやま|土の山|ドリルジャンプ|まけ|ひきわけ)/g);
  ok('ソースの文字に禁止の言葉がない（つちのやま・ドリルジャンプ・まけ・ひきわけ）', !bad, bad);
  ok('ジャンプドリルの名前', html.includes('ジャンプ<br>ドリル') && html.includes('data-act="jumpDrill"'));
  ok('連番のコメントブロック', /===== U01\./.test(ui) && /===== C01\./.test(css) && /===== H01\./.test(html));
  ok('Boot の文面（§9）', ['覚えたい言葉や絵の中を探検し、形の特徴に気付いて親しむ。', '立体的なマップを理解し、地図を見ながら目的地を探す力を養う。', '「すすむ」で まえへ。がめんを よこに なぞると むきが かわるよ', '「そら」で ちず ぜんたいを みて、ソナーで たからの ほうこうを たしかめよう', 'ドリルで ブロックを ほって、たからを みつけよう', '「ジャンプドリル」で ジャンプしながら したへ ほりすすめるよ'].every((t) => html.includes(t)));
}

/* ---------- 2. Boot → タイトル → せってい → ひとりで れんしゅう ---------- */
async function soloFlow() {
  const { page: p, errors, context } = await open();
  await sleep(150);
  ok('Boot：はじめは「じゅんびちゅう...」で押せない', (await txt(p, '#bootbtn')) === 'じゅんびちゅう...' && await p.evaluate(() => document.getElementById('bootbtn').disabled));
  await shot(p, '01boot_loading');
  await waitFor(async () => !(await p.evaluate(() => document.getElementById('bootbtn').disabled)), 8000);
  ok('Boot：読み込み後「タップしてスタート」', (await txt(p, '#bootbtn')) === 'タップしてスタート');
  await shot(p, '02boot_ready');
  await p.mouse.click(300, 300); await p.keyboard.press('Enter'); await p.keyboard.press('Space'); await sleep(300);
  ok('Boot：画面のほかの所やキーでは進まない', (await st(p)) === 'boot');
  await clearLog(p);
  await click(p, '#bootbtn', 600);
  ok('Boot：ボタンの click でタイトルへ', (await st(p)) === 'title');
  ok('Boot：Sfx.unlock を呼ぶ', (await logOf(p, 'Sfx.unlock')).length > 0);
  ok('Boot：iOS 以外は requestFullscreen を ためす', (await p.evaluate(() => window.__fs)) >= 1);
  ok('タイトル：Sfx.bgm(title)', (await logOf(p, 'Sfx.bgm')).some((l) => l[1] === 'title'));
  await shot(p, '03title');
  const foot = await p.evaluate(() => {
    const c = document.querySelector('.footrow .copy'), v = document.querySelector('.footrow .ver');
    const cs = getComputedStyle(c), vs = getComputedStyle(v), R = (e) => e.getBoundingClientRect();
    const st = document.getElementById('stage').getBoundingClientRect();
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const others = [...document.querySelectorAll('#nav .nbtn'), document.getElementById('recchip')].map(R);
    return { same: cs.fontSize === vs.fontSize && cs.opacity === vs.opacity, op: cs.opacity, text: c.textContent + '|' + v.textContent,
      centre: Math.abs((R(c).left + R(c).right) / 2 - (st.left + st.right) / 2) < 2, right: st.right - R(v).right < st.width * 0.04,
      overlap: others.some((o) => hit(o, R(c)) || hit(o, R(v))) };
  });
  ok('タイトル：コピーライト中央下・v9.0 右下・同じ大きさと透明度', foot.same && foot.centre && foot.right && foot.text.includes('v9.0') && +foot.op < 1, foot);
  ok('タイトル：最下段は #nav と記録チップに重ならない', !foot.overlap, foot);
  await fontCheck(p, 'タイトル'); await wordCheck(p, 'タイトル');
  // タイトルのモーダル
  await click(p, '#home');
  ok('タイトル：モーダル「しゅうりょうしますか？」', (await txt(p, '#m-title')) === 'しゅうりょうしますか？');
  ok('モーダル：Sfx.pause(true)', (await logOf(p, 'Sfx.pause')).some((l) => l[1] === true));
  await shot(p, '04modal_title');
  await click(p, '#m-no');
  ok('モーダル：いいえで閉じる', !(await p.evaluate(() => document.getElementById('modal').classList.contains('on'))) && (await st(p)) === 'title');
  // せってい
  await nav(p, 'せってい');
  ok('せってい：10この いろ', (await p.evaluate(() => document.querySelectorAll('.swatch').length)) === 10);
  await click(p, '.swatch[data-pal="4"]');
  await click(p, '.seg button[data-val="sonar"]');
  const sv = await p.evaluate(() => JSON.parse(localStorage.getItem('pixsee.settings') || '{}'));
  ok('せってい：いろ と さがしかた を pixsee.settings に保存', sv.palette === 4 && sv.search === 'sonar', sv);
  await shot(p, '05settings');
  await fontCheck(p, 'せってい'); await wordCheck(p, 'せってい');
  await click(p, '#home');
  ok('せってい：モーダル「タイトルへもどりますか？」', (await txt(p, '#m-title')) === 'タイトルへもどりますか？');
  await click(p, '#m-yes', 500);
  ok('せってい：はい → タイトル', (await st(p)) === 'title');
  // ひとりで れんしゅう
  await nav(p, 'はじめる');
  await fontCheck(p, 'あそびかた');
  await click(p, '.howcard[data-kind=solo]');
  await click(p, '.card[data-id]', 1500);
  await fontCheck(p, 'ちずえらび');
  await clearLog(p);
  await nav(p, 'しゅっぱつ！', 400);
  const lo = await p.evaluate(() => window.__loadOpts);
  ok('プレイ：World.load に palette と search', lo && lo.players && lo.players[0].palette === 4 && lo.search === 'sonar' && lo.cpu === null && lo.mode === 'solo', lo);
  ok('プレイ：カウントダウン中は World が止まり ボタンは押せない', await p.evaluate(() => document.body.classList.contains('counting') && document.body.classList.contains('frozen') && getComputedStyle(document.getElementById('fwd')).pointerEvents === 'none'));
  ok('プレイ：GO! の前は World.go も プレイBGM もない', (await logOf(p, 'World.go')).length === 0 && !(await logOf(p, 'Sfx.bgm')).some((l) => /^play/.test(l[1] || '')));
  await shot(p, '06count3');
  // モーダルで カウントダウンが止まる
  await sleep(700);
  await click(p, '#home', 200);
  const c1 = (await info(p)).cdT; await sleep(1500); const c2 = (await info(p)).cdT;
  ok('カウントダウン：モーダル中は止まる', Math.abs(c2 - c1) < 0.05 && (await logOf(p, 'World.setPaused')).some((l) => l[1] === true), [c1, c2]);
  await shot(p, '07count_modal');
  await click(p, '#m-no', 200);
  await waitFor(async () => (await info(p)).phase === 'run', 6000);
  const cnt = await logOf(p, 'Sfx.play');
  ok('カウントダウン：count 3回 と go 1回', cnt.filter((l) => l[1] === 'count').length === 3 && cnt.filter((l) => l[1] === 'go').length === 1, cnt.map((l) => l[1]));
  ok('GO!：World.go と プレイBGM（play1〜3）', (await logOf(p, 'World.go')).length === 1 && (await logOf(p, 'Sfx.bgm')).some((l) => /^play[123]$/.test(l[1] || '')));
  await shot(p, '08go');
  await sleep(1200);
  // 押している間ずっと：ドリルアタック・ジャンプドリル
  await clearLog(p);
  const b = await p.$('#b-attack'); const bb = await b.boundingBox();
  await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await sleep(600);
  const mid = await logOf(p, 'World.press');
  await p.mouse.up(); await sleep(200);
  const pr = await logOf(p, 'World.press');
  ok('ドリルアタック：押して down、離して up', mid.length === 1 && mid[0][1] === 'drillAttack' && mid[0][2] === true && pr.length === 2 && pr[1][2] === false, pr);
  const j = await p.$('#b-jd'); const jb = await j.boundingBox();
  await p.mouse.move(jb.x + jb.width / 2, jb.y + jb.height / 2); await p.mouse.down(); await sleep(400); await p.mouse.up(); await sleep(200);
  const pr2 = (await logOf(p, 'World.press')).slice(2);
  ok('ジャンプドリル：press(jumpDrill) を 押す/離す', pr2.length === 2 && pr2[0][1] === 'jumpDrill' && pr2[0][2] === true && pr2[1][2] === false, pr2);
  // 擬音
  await p.evaluate(() => window.__emit('onomato', 'jump')); await sleep(200);
  await p.evaluate(() => window.__emit('onomato', 'drill')); await sleep(250);
  const ono = await p.evaluate(() => [...document.querySelectorAll('.ono')].map((e) => e.textContent + '@' + e.parentElement.id));
  ok('擬音：ビョーン！ と ゴゴゴゴゴ が 左右の帯に', ono.length === 2 && ono.some((t) => t.startsWith('ビョーン！')) && ono.some((t) => t.startsWith('ゴゴゴゴゴ')), ono);
  await shot(p, '09onomato');
  await sleep(1200);
  ok('擬音：短い時間で消える', (await p.evaluate(() => document.querySelectorAll('.ono').length)) === 0);
  await fontCheck(p, 'プレイ'); await wordCheck(p, 'プレイ');
  // 獲得
  await clearLog(p);
  const el0 = (await info(p)).elapsed;
  await p.evaluate(() => window.__emit('gemHit', 0, 0)); await sleep(500);
  const i1 = await info(p);
  ok('獲得：World.award(0,0)・freeze(true)・ファンファーレ', (await logOf(p, 'World.award')).length === 1 && (await logOf(p, 'World.freeze')).some((l) => l[1] === true) && (await logOf(p, 'Sfx.play')).some((l) => l[1] === 'fanfare'));
  ok('獲得：宣言「あなたが …を ゲットした！」', (await txt(p, '#ann-who')) === 'あなたが' && /を ゲットした！$/.test(await txt(p, '#ann-what')), await txt(p, '#ann-what'));
  ok('獲得：タイムは獲得の瞬間に確定', i1.raceTime !== null && Math.abs(i1.raceTime - el0) < 0.6, [el0, i1.raceTime]);
  ok('獲得：宣言中はボタン無効', await p.evaluate(() => getComputedStyle(document.getElementById('fwd')).pointerEvents === 'none' && document.body.classList.contains('announcing')));
  await shot(p, '10announce');
  await p.evaluate(() => window.__emit('gemHit', 0, 0)); await sleep(100);
  ok('獲得：同じ宝石は2回目なし', (await logOf(p, 'World.award')).length === 1);
  await sleep(2200);
  ok('獲得：3.5秒たつまでは結果へ行かない', (await st(p)) === 'play');
  await waitFor(async () => (await st(p)) === 'ending', 4000);
  ok('結果：宣言のあとに結果', (await st(p)) === 'ending');
  ok('結果：ジングル practice', (await logOf(p, 'Sfx.jingle')).some((l) => l[1] === 'practice'));
  const i2 = await info(p);
  ok('結果：タイムは宣言の3.5秒を含まない', Math.abs(i2.raceTime - i1.raceTime) < 0.01 && (await txt(p, '#end-who')).includes('タイム'));
  const endpic = await p.evaluate(() => { const a = document.querySelector('.endpic').getBoundingClientRect(), h = document.getElementById('home').getBoundingClientRect(); return { a: [a.left, a.top, a.right, a.bottom], h: [h.left, h.top, h.right, h.bottom], hit: a.left < h.right && h.left < a.right && a.top < h.bottom && h.top < a.bottom }; });
  ok('結果：.endpic がホームボタンにかからない', !endpic.hit, endpic);
  await shot(p, '11ending_solo');
  await fontCheck(p, '結果'); await wordCheck(p, '結果');
  // 結果のモーダル → resetGame
  await clearLog(p);
  await click(p, '#home');
  ok('結果：モーダル「タイトルへもどりますか？」', (await txt(p, '#m-title')) === 'タイトルへもどりますか？');
  await click(p, '#m-yes', 500);
  ok('結果：はい → resetGame → タイトル（Sfx.stopAll）', (await st(p)) === 'title' && (await logOf(p, 'Sfx.stopAll')).length >= 1);
  ok('Boot 後に エラーなし（ひとり）', errors.length === 0, errors);
  await context.close();
}

/* ---------- 3. コンピューター × どっちが はやい？（あいてが獲得）とプレイ中の resetGame ---------- */
async function cpuRace() {
  const { page: p, errors, context } = await open({ width: 1024, height: 768 }, { touch: false });
  await bootToTitle(p);
  await nav(p, 'はじめる');
  await click(p, '.howcard[data-kind=race]'); await click(p, '[data-who=cpu]');
  await shot(p, '12level');
  await click(p, '.lvcard[data-level=easy]');
  await click(p, '.card[data-id]', 1500);
  await shot(p, '13pick_cpu');
  await nav(p, 'しゅっぱつ！', 400);
  const lo = await p.evaluate(() => window.__loadOpts);
  ok('CPU：World.load cpu=easy・色がかぶらない', lo.cpu && lo.cpu.level === 'easy' && lo.players[0].palette !== lo.players[1].palette && lo.mode === 'race', lo);
  await waitFor(async () => (await info(p)).phase === 'run', 7000);
  await sleep(500);
  await p.evaluate(() => window.__emit('gemHit', 1, 0)); await sleep(600);
  ok('CPU：宣言「コンピューターが」', (await txt(p, '#ann-who')) === 'コンピューターが');
  await shot(p, '14announce_cpu');
  await waitFor(async () => (await st(p)) === 'ending', 6000);
  ok('CPU：結果「コンピューターが はやかった」と lose のジングル', (await txt(p, '#end-found')) === 'コンピューターが はやかった' && (await logOf(p, 'Sfx.jingle')).some((l) => l[1] === 'lose'));
  await shot(p, '15ending_cpu_race');
  await wordCheck(p, 'CPU 結果');
  // もういちど → プレイ中にホーム → resetGame
  await nav(p, 'もういちど');
  await click(p, '.card[data-id]', 1500);
  await nav(p, 'しゅっぱつ！', 2500);
  await clearLog(p);
  await click(p, '#home');
  ok('プレイ：モーダル「タイトルへもどりますか？」', (await txt(p, '#m-title')) === 'タイトルへもどりますか？');
  await click(p, '#m-yes', 500);
  const i = await info(p);
  ok('プレイ：はい → resetGame（World.stop・Sfx.stopAll・状態のリセット）→ タイトル', (await st(p)) === 'title' && (await logOf(p, 'World.stop')).length >= 1 && (await logOf(p, 'Sfx.stopAll')).length >= 1 && i.phase === 'idle' && i.opp === '' && i.mode === 'solo' && !i.paused && i.scores.join() === '0,0', i);
  ok('resetGame：カウントダウン・宣言の表示が消える', await p.evaluate(() => !document.body.classList.contains('counting') && !document.body.classList.contains('announcing') && !document.body.classList.contains('frozen')));
  // もう一度あそべる
  await nav(p, 'はじめる'); await click(p, '.howcard[data-kind=solo]'); await click(p, '.card[data-id]', 1500);
  await nav(p, 'しゅっぱつ！', 300);
  ok('resetGame のあと もう一度あそべる', await waitFor(async () => (await info(p)).phase === 'run', 7000));
  // Quit はタイトルからだけ
  await click(p, '#home'); await click(p, '#m-yes', 500);
  await click(p, '#home');
  await click(p, '#m-yes', 500);
  ok('タイトル：はい → Quit', (await st(p)) === 'quit');
  await shot(p, '16quit');
  await click(p, '#home');
  ok('Quit：モーダル「タイトルへもどりますか？」', (await txt(p, '#m-title')) === 'タイトルへもどりますか？');
  await click(p, '#m-yes', 500);
  ok('Quit：はい → タイトル', (await st(p)) === 'title');
  ok('エラーなし（CPU）', errors.length === 0, errors);
  await context.close();
}

/* ---------- 4. コンピューター × どっちが おおい？（毎回の宣言・へいわの しょうり） ---------- */
async function cpuCount() {
  const { page: p, errors, context } = await open();
  await bootToTitle(p);
  await nav(p, 'はじめる');
  await click(p, '.howcard[data-kind=count]'); await click(p, '[data-who=cpu]'); await click(p, '.lvcard[data-level=hard]');
  await click(p, '.card[data-id]', 1800);
  await nav(p, 'しゅっぱつ！', 300);
  await waitFor(async () => (await info(p)).phase === 'run', 7000);
  await sleep(1200);
  const t0 = (await info(p)).left;
  await p.evaluate(() => { window.__emit('gemHit', 0, 0); window.__emit('gemHit', 1, 1); }); await sleep(800);
  const a = await info(p);
  ok('おおい：獲得のたびに宣言（2つめは待つ）', a.phase === 'announce' && a.ann && a.ann.ti === 0);
  await sleep(1500);
  const t1 = (await info(p)).left;
  ok('おおい：宣言中は時間が止まる', Math.abs(t1 - t0) < 0.5, [t0, t1]);
  await waitFor(async () => { const x = await info(p); return x.ann && x.ann.ti === 1; }, 5000);
  ok('おおい：2つめの宣言「コンピューターが」', (await txt(p, '#ann-who')) === 'コンピューターが');
  await waitFor(async () => (await info(p)).phase === 'run', 5000);
  ok('おおい：宣言のあと プレイにもどる（World.freeze(false)）', (await info(p)).phase === 'run' && (await logOf(p, 'World.freeze')).some((l) => l[1] === false));
  await shot(p, '17count_run');
  await p.evaluate(() => App._finish());
  await waitFor(async () => (await st(p)) === 'ending', 4000);
  const head = await txt(p, '#end-found');
  ok('おおい：同数は「みんな なかよし！ へいわの しょうり！」＋ peace', head === 'みんな なかよし！ へいわの しょうり！' && (await logOf(p, 'Sfx.jingle')).some((l) => l[1] === 'peace'), head);
  ok('おおい：全員が勝者の見た目（全員に かんむり）', await p.evaluate(() => document.querySelectorAll('#end-team figure.top').length === 2));
  await shot(p, '18ending_peace');
  await wordCheck(p, 'へいわ');
  await fontCheck(p, 'へいわ');
  ok('エラーなし（おおい）', errors.length === 0, errors);
  await context.close();
}

/* ---------- 5. Boot とエンディングのモーダル、縦持ち ---------- */
async function modalBoot() {
  const { page: p, errors, context } = await open();
  await sleep(300);
  await click(p, '#home');
  ok('Boot：モーダル「タイトルへもどりますか？」', (await txt(p, '#m-title')) === 'タイトルへもどりますか？');
  await click(p, '#m-yes', 500);
  ok('Boot：はい → resetGame → タイトル', (await st(p)) === 'title');
  await context.close();
  const { page: q, context: c2 } = await open({ width: 600, height: 900 });
  await sleep(500);
  ok('縦持ちの警告', await q.evaluate(() => getComputedStyle(document.getElementById('portrait')).display === 'flex'));
  await shot(q, '19portrait');
  await c2.close();
  ok('エラーなし（Boot）', errors.length === 0, errors);
}

/* ---------- 6. 重なりの確認（プレイ画面） ---------- */
async function overlap() {
  const vps = [{ width: 1280, height: 720 }, { width: 1024, height: 576 }, { width: 1024, height: 768 }];
  const report = [];
  for (const vp of vps) {
    const { page: p, errors, context } = await open(vp, { touch: vp.height === 768 });
    await bootToTitle(p);
    await nav(p, 'はじめる'); await click(p, '.howcard[data-kind=count]'); await click(p, '[data-who=cpu]'); await click(p, '.lvcard[data-level=normal]');
    await click(p, '.card[data-id]', 1500);
    await nav(p, 'しゅっぱつ！', 400);
    await waitFor(async () => (await info(p)).phase === 'run', 7000);
    const r = await p.evaluate(() => {
      document.body.classList.add('counting', 'announcing');
      const st = document.getElementById('stage').getBoundingClientRect(), cq = Math.min(st.width, st.height) / 100;
      const ids = { home: '#home', sonar: '#sonar', 'timer+score': '#hud', maptag: '#maptag', camera: '#cam', 'すすむ': '#fwd', 'ジャンプ': '#b-jump', 'ドリルアタック': '#b-attack', 'ジャンプドリル': '#b-jd', '擬音(左)': '#ono-l', '擬音(右)': '#ono-r', '獲得宣言': '#ann', 'カウントダウン': '#count' };
      const R = {};
      for (const k in ids) { const b = document.querySelector(ids[k]).getBoundingClientRect(); R[k] = [b.left - st.left, b.top - st.top, b.right - st.left, b.bottom - st.top].map((v) => +(v / cq).toFixed(1)); }
      // 擬音の文字そのもの（いちばん大きくなる瞬間）と、カウントダウン「GO!」・宣言の箱の中身が 帯の中に収まるか
      const fits = [];
      const inZone = (b, z) => b.left >= z.left - 0.5 * cq && b.right <= z.right + 0.5 * cq && b.top >= z.top - 0.5 * cq && b.bottom <= z.bottom + 0.5 * cq;
      [['jump', 'ビョーン！'], ['drill', 'ゴゴゴゴゴ'], ['bump', 'ガン！'], ['break', 'ガラッ']].forEach(([k, t]) => ['ono-l', 'ono-r'].forEach((zid) => {
        const z = document.getElementById(zid), e = document.createElement('b');
        e.className = 'ono ' + k; e.textContent = t; e.style.animationDelay = '-0.209s'; e.style.animationPlayState = 'paused';
        z.appendChild(e); const b = e.getBoundingClientRect(), zb = z.getBoundingClientRect();
        if (!inZone(b, zb)) fits.push(t + '@' + zid + ':' + [b.left - zb.left, b.top - zb.top, b.right - zb.right, b.bottom - zb.bottom].map((v) => (v / cq).toFixed(1)).join(','));
        e.remove();
      }));
      const cn = document.getElementById('count-n'); cn.textContent = 'GO!'; cn.className = 'go'; cn.style.animationDelay = '-0.25s'; cn.style.animationPlayState = 'paused';
      if (!inZone(cn.getBoundingClientRect(), document.getElementById('count').getBoundingClientRect())) fits.push('GO!');
      cn.textContent = '3'; cn.className = 'pop'; cn.style.animationDelay = '-0.55s';
      if (!inZone(cn.getBoundingClientRect(), document.getElementById('count').getBoundingClientRect())) fits.push('3');
      cn.textContent = ''; cn.className = ''; cn.style.animationDelay = ''; cn.style.animationPlayState = '';
      document.getElementById('ann-who').textContent = 'コンピューターが'; document.getElementById('ann-what').textContent = 'アクアマリンを ゲットした！';
      const ac = document.querySelector('.ann-card'); ac.style.animation = 'none';
      if (!inZone(ac.getBoundingClientRect(), document.getElementById('ann').getBoundingClientRect())) fits.push('ann-card');
      ac.style.animation = '';
      document.body.classList.remove('counting', 'announcing');
      const keys = Object.keys(R), hits = [];
      let minGap = 1e9, minPair = '';
      for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
        const a = R[keys[i]], b = R[keys[j]];
        const gx = Math.max(b[0] - a[2], a[0] - b[2]), gy = Math.max(b[1] - a[3], a[1] - b[3]), gap = Math.max(gx, gy);
        if (gap < 0) hits.push(keys[i] + '×' + keys[j]);
        if (gap < minGap) { minGap = gap; minPair = keys[i] + '×' + keys[j]; }
      }
      const inside = keys.filter((k) => R[k][0] < -0.1 || R[k][1] < -0.1 || R[k][2] > st.width / cq + 0.1 || R[k][3] > 100.1);
      return { R, hits, fits, minGap: +minGap.toFixed(1), minPair, inside, stage: [Math.round(st.width), Math.round(st.height)] };
    });
    ok(`重なり ${vp.width}×${vp.height}：絶対配置の要素どうしが重ならない（最小のすきま ${r.minGap}cqmin：${r.minPair}）`, r.hits.length === 0, r.hits);
    ok(`重なり ${vp.width}×${vp.height}：すべて 16:9 のステージの中`, r.inside.length === 0, r.inside);
    ok(`重なり ${vp.width}×${vp.height}：擬音（最大の瞬間）・GO!・3・宣言の箱が 自分の帯の中に収まる`, r.fits.length === 0, r.fits);
    report.push({ vp: `${vp.width}x${vp.height}`, stage: r.stage, minGap: r.minGap, minPair: r.minPair, rects: r.R });
    if (vp.height === 768) await shot(p, '20play_ipad43');
    ok(`エラーなし（重なり ${vp.width}×${vp.height}）`, errors.length === 0, errors);
    await context.close();
  }
  fs.writeFileSync(path.join(SH, 'overlap_report.json'), JSON.stringify(report, null, 1));
}

/* ---------- 7. 通信（ホストとクライアント。カウントダウンの同期・claim/award/resume） ---------- */
async function netFlow() {
  const { startPeerServer } = require('./harness.js');
  const srv = startPeerServer(PEER_PORT);
  const query = `?peerhost=127.0.0.1&peerport=${PEER_PORT}&peerpath=/myapp&peersecure=0`;
  const VPN = { width: 800, height: 450 };
  const H = await open(VPN, { query }), G = await open(VPN, { query });
  const h = H.page, g = G.page;
  try {
    await g.evaluate(() => localStorage.setItem('pixsee.settings', JSON.stringify({ palette: 6, search: 'light' })));
    await g.reload(); await sleep(300);
    await h.evaluate(() => localStorage.setItem('pixsee.settings', JSON.stringify({ palette: 2, search: 'sonar' })));
    await h.reload(); await sleep(300);
    await bootToTitle(h); await bootToTitle(g);
    await nav(h, 'はじめる'); await click(h, '.howcard[data-kind=race]'); await click(h, '[data-who=net]'); await click(h, '#c-host', 1500);
    const code = await h.evaluate(() => [...document.querySelectorAll('#codeshow b')].map((b) => b.textContent).join(''));
    ok('通信：へやの ばんごう', /^\d{4}$/.test(code), code);
    await nav(g, 'はじめる'); await click(g, '.howcard[data-kind=race]'); await click(g, '[data-who=net]'); await click(g, '#c-join');
    for (const d of code) await click(g, `.key:not(.del):not(.nul) >> text="${d}"`, 120);
    await nav(g, 'つなぐ！', 500);
    ok('通信：つながる', await waitFor(async () => (await h.evaluate(() => document.getElementById('setting').dataset.sub)) === 'pick', 15000));
    await sleep(800);
    await click(h, '.card[data-id]', 1500);
    await clearLog(h); await clearLog(g);
    await nav(h, 'しゅっぱつ！', 300);
    ok('通信：クライアントも プレイへ', await waitFor(async () => (await st(g)) === 'play', 10000));
    const glo = await g.evaluate(() => window.__loadOpts);
    ok('通信：hello の いろ交換（クライアントの World.load にホストの色）・ホストの さがしかた', glo.players[0].palette === 2 && glo.players[1].palette === 6 && glo.myIndex === 1 && glo.search === 'sonar' && glo.isHost === false, glo);
    ok('通信：クライアントは ready を送る', await waitFor(async () => (await logOf(g, 'net>ready')).length === 1, 5000));
    ok('通信：ホストは ready を受けて count を送る', await waitFor(async () => (await logOf(h, 'net>count')).length === 1, 5000));
    ok('通信：両方 カウントダウン → run', await waitFor(async () => (await info(h)).phase === 'run' && (await info(g)).phase === 'run', 8000));
    await shot(g, '21net_guest_play');
    await sleep(500);
    // クライアントが宝石を壊す → claim → ホストが award → resume
    await clearLog(h); await clearLog(g);
    await g.evaluate(() => window.__emit('gemHit', 1, 0));
    ok('通信：クライアントは claim を送り 自分では award しない', (await logOf(g, 'net>claim')).length === 1 && (await logOf(g, 'World.award')).length === 0);
    ok('通信：ホストが award を決めて送る', await waitFor(async () => (await logOf(h, 'net>award')).length === 1, 5000) && (await logOf(h, 'World.award')).some((l) => l[1] === 1 && l[2] === 0));
    ok('通信：クライアントも award', await waitFor(async () => (await logOf(g, 'World.award')).some((l) => l[1] === 1 && l[2] === 0), 5000));
    await h.evaluate(() => window.__emit('gemHit', 0, 0)); await sleep(200);
    ok('通信：横取りできない（ホストの同じ宝石は 2回目の award なし）', (await logOf(h, 'World.award')).length === 1);
    await sleep(400);
    ok('通信：宣言 ホスト「あいてが」・クライアント「あなたが」', (await txt(h, '#ann-who')) === 'あいてが' && (await txt(g, '#ann-who')) === 'あなたが');
    await shot(h, '22net_host_announce');
    ok('通信：ホストが 3.5秒後に resume', await waitFor(async () => (await logOf(h, 'net>resume')).length === 1, 6000));
    ok('通信：両方 結果へ', await waitFor(async () => (await st(h)) === 'ending' && (await st(g)) === 'ending', 6000));
    ok('通信：結果 ホスト「ともだちが はやかった」・クライアント「きみが はやかった！」', (await txt(h, '#end-found')) === 'ともだちが はやかった' && (await txt(g, '#end-found')) === 'きみが はやかった！', [await txt(h, '#end-found'), await txt(g, '#end-found')]);
    await shot(g, '23net_guest_ending');
    ok('エラーなし（通信）', H.errors.length === 0 && G.errors.length === 0, H.errors.concat(G.errors));
  } finally {
    await H.context.close(); await G.context.close();
    try { srv.close(); } catch (e) {}
  }
}

(async () => {
  try {
    if (!ONLY || ONLY === 'static') staticChecks();
    if (!ONLY || ONLY === 'solo') await soloFlow();
    if (!ONLY || ONLY === 'cpu') await cpuRace();
    if (!ONLY || ONLY === 'count') await cpuCount();
    if (!ONLY || ONLY === 'modal') await modalBoot();
    if (!ONLY || ONLY === 'overlap') await overlap();
    if (!ONLY || ONLY === 'net') await netFlow();
  } catch (e) { ok('例外なく終わる', false, e.stack); }
  if (browser) await browser.close();
  if (server) server.close();
  console.log(results.join('\n'));
  const ng = results.filter((r) => r.startsWith('NG')).length;
  console.log(`\n${results.length - ng} / ${results.length} OK`);
  process.exit(ng ? 1 : 0);
})();
