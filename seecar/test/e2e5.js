// 「見つけて！PixSee v10.0」UI の通し確認（第5期。e2e4.js を引きついで SPEC5 に合わせて直し、新しい確認を足した）
//   第5期で足したもの：せっていの 既定値と古い保存・スピード・おんがく／タイトルの並び／ちずえらび（タブ・横スクロール・ランダム・えいごの意味）
//   ／視点ボタン 4段階の字の はみ出し／'overGem' の ソナーの光／スワイプ（すすむを押したまま 別の指で なぞる・4:3 の帯・感度）
//   静的な確認（署名・v9.0・§2-4 の固定の指定・px 不使用・禁止語）
//   Boot → タイトル → せってい（いろ・さがしかた）→ 各モード → カウントダウン → プレイ → 獲得宣言 → 結果
//   すべての画面のホームボタン＋モーダル（文言・resetGame・Quit）、通信（2画面・手元の中継サーバー）
//   重なりの確認（1280×720・1024×576・1024×768）
// 使い方: node e2e5.js [file.html]   （既定は test/v10/seecar_v10t.html。ONLY=static|solo|cpu|count|modal|overlap|net|leave|settings|title|pick|cam|swipe）
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, 'v10', 'seecar_v10t.html');
const SRC = path.join(__dirname, '..', 'src');
const SH = path.join(__dirname, 'shots', 'v10');
const PEER_PORT = +(process.env.PEER_PORT || 9881);
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
const shot = (p, n) => p.screenshot({ path: path.join(SH, `e2e5_${n}.png`) });
const PLAY_SONGS = /^(genki|yukai|nonbiri|iyashi)$/;
const gear = (p, ms) => click(p, '#gear', ms);
const TITLE_REPORT = [];
// ロゴ：中心が 横の まん中・上は 10cqmin より上・下は 40〜60（まん中あたり）・はば 100cqmin 以上。はじめる：下の中央。歯車：左上（ホームと 同じ高さ）
const titleLayout = (t) => { const R = t.rects, L = R.logo, S = R['はじめる'], G = R.gear, H = R.home, cx = 177.78 / 2;
  return Math.abs((L[0] + L[2]) / 2 - cx) < 1.5 && L[1] < 10 && L[3] > 40 && L[3] < 60 && L[2] - L[0] >= 100
    && Math.abs((S[0] + S[2]) / 2 - cx) < 1.5 && S[1] > 60 && G[0] < 10 && G[1] < 10 && Math.abs(G[1] - H[1]) < 0.6; };
// タイトル：画面の部品（進行ボタン・記録チップ・署名・版・ホーム）が どれも重ならないか（cqmin）
const titleOverlap = (p) => p.evaluate(() => {
  const st = document.getElementById('stage').getBoundingClientRect(), cq = Math.min(st.width, st.height) / 100;
  const els = { home: '#home', gear: '#gear', logo: '.titlelogo', 'isle-l': '#hero-l', 'isle-r': '#hero-r', recchip: '#recchip', copy: '.footrow .copy', ver: '.footrow .ver' };
  const R = {};
  [...document.querySelectorAll('#nav .nbtn')].forEach((b) => { els[b.dataset.nav] = b; });
  for (const k in els) { const e = typeof els[k] === 'string' ? document.querySelector(els[k]) : els[k]; const b = e.getBoundingClientRect(); R[k] = [b.left - st.left, b.top - st.top, b.right - st.left, b.bottom - st.top].map((v) => +(v / cq).toFixed(1)); }
  const keys = Object.keys(R), hits = []; let minGap = 1e9, minPair = '';
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = R[keys[i]], b = R[keys[j]], gap = Math.max(b[0] - a[2], a[0] - b[2], b[1] - a[3], a[1] - b[3]);
    if (gap < 0) hits.push(keys[i] + '×' + keys[j]);
    if (gap < minGap) { minGap = gap; minPair = keys[i] + '×' + keys[j]; }
  }
  return { rects: R, hits, minGap: +minGap.toFixed(1), minPair };
});
// 音の様子（Sfx._debug）。BGM が鳴っているか・一時停止が残っていないか
const snd = (p) => p.evaluate(() => (window.Sfx && window.Sfx._debug) ? window.Sfx._debug() : null);
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

// 結果画面：見出しが上で切れない・左の列からはみ出さない・ちずの名前は絵の下・紙ふぶきは文字の後ろ
async function endingCheck(p, tag) {
  const r = await p.evaluate(() => {
    const st = document.getElementById('stage').getBoundingClientRect(), cq = Math.min(st.width, st.height) / 100;
    const box = document.querySelector('.endleft'), bb = box.getBoundingClientRect(), fe = document.getElementById('end-found'), f = fe.getBoundingClientRect();
    const kids = [...box.children].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.getBoundingClientRect());
    const map = document.querySelector('.endmap'), pic = document.querySelector('.endpic');
    const z = (s) => +getComputedStyle(document.querySelector(s)).zIndex || 0;
    return { top: +((f.top - st.top) / cq).toFixed(1), fs: +(parseFloat(getComputedStyle(fe).fontSize) / cq).toFixed(2),
      inside: kids.every((k) => k.top >= bb.top - 1 && k.bottom <= bb.bottom + 1), over: box.scrollHeight - box.clientHeight,
      mapInPic: pic.contains(map), confettiBehind: z('#confetti') < z('.endleft') && z('#confetti') < z('.endpic'),
      lines: Math.round(f.height / (parseFloat(getComputedStyle(fe).lineHeight) || 1)) };
  });
  ok(`${tag}：見出しが上で切れない（y ${r.top}cqmin・${r.fs}cqmin・${r.lines}行）・左の列からはみ出さない`, r.top >= 0 && r.inside && r.over <= 1, r);
  ok(`${tag}：ちずの名前は ちずの絵の下・紙ふぶきは文字と絵の後ろ`, r.mapInPic && r.confettiBehind, r);
}

/* ---------- 1. 静的な確認 ---------- */
function staticChecks() {
  const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(SRC, 'style.css'), 'utf8');
  const ui = fs.readFileSync(path.join(SRC, 'ui.js'), 'utf8');
  const pre = html.split('<!DOCTYPE')[0];
  ok('署名コメントが <!DOCTYPE> の直前', /<!--[\s\S]*© 2026 ニルナーリ博士とヤクナーリくんのツールキッチン[\s\S]*-->\s*$/.test(pre));
  ok('画面の版は v10.0（署名コメントと 画面）', /v10\.0/.test(html) && !/v9\.0/.test(html) && /VERSION = 'v10\.0'/.test(ui) && /PixSee  v10\.0/.test(pre));
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
  ok('.card .yomi を横につぶさない（scaleX・字間つめ なし）', !/\.card \.yomi\{[^}]*(scaleX|letter-spacing:-)/.test(css));
  ok('Boot ではホームボタンを出さない・押してもモーダルを開かない', css.includes('body[data-state=boot] #home{display:none}') && /function openModal[^]*?if \(state === 'boot'\) return;/.test(ui));
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
  ok('タイトル：#nav は「はじめる」だけ・歯車の「せってい」は 左上', await p.evaluate(() => { const n = [...document.querySelectorAll('#nav .nbtn')].map((b) => b.dataset.nav); const g = document.getElementById('gear').getBoundingClientRect(), st = document.getElementById('stage').getBoundingClientRect(); return n.join() === 'はじめる' && g.left - st.left < st.width * 0.1 && g.top - st.top < st.height * 0.1; }));
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
  ok('タイトル：コピーライト中央下・v10.0 右下・同じ大きさと透明度', foot.same && foot.centre && foot.right && foot.text.includes('v10.0') && +foot.op < 1, foot);
  ok('タイトル：最下段は #nav と記録チップに重ならない', !foot.overlap, foot);
  const tov = await titleOverlap(p);
  TITLE_REPORT.push(Object.assign({ vp: '1280x720' }, tov));
  ok(`タイトル 1280×720：はじめる・せってい・ロゴ・島・記録チップ・署名・版・ホームが どれも重ならない（最小のすきま ${tov.minGap}cqmin：${tov.minPair}）`, tov.hits.length === 0 && tov.minGap >= 0.5, tov);
  ok(`タイトル 1280×720：ロゴは 上の中央〜まん中（${tov.rects.logo}）・はじめるは 下の中央・歯車は 左上`, titleLayout(tov), tov.rects);
  await fontCheck(p, 'タイトル'); await wordCheck(p, 'タイトル');
  // タイトルのモーダル
  await click(p, '#home');
  ok('タイトル：モーダル「しゅうりょうしますか？」', (await txt(p, '#m-title')) === 'しゅうりょうしますか？');
  ok('モーダル：Sfx.pause(true)', (await logOf(p, 'Sfx.pause')).some((l) => l[1] === true));
  await shot(p, '04modal_title');
  await click(p, '#m-no');
  ok('モーダル：いいえで閉じる', !(await p.evaluate(() => document.getElementById('modal').classList.contains('on'))) && (await st(p)) === 'title');
  // せってい
  await gear(p);
  ok('せってい：10この いろ', (await p.evaluate(() => document.querySelectorAll('.swatch').length)) === 10);
  const dflt = await p.evaluate(() => [...document.querySelectorAll('.seg button.on[data-set]')].map((b) => b.dataset.set + '=' + b.dataset.val).sort().join(','));
  ok('せってい：はじめの 既定は ソナーだけ・スワイプ はんたい・スピード ふつう・おんがく げんき・しろくろ しない', dflt === 'bgm=genki,binary=0,search=sonar,speed=normal,swipeRev=1', dflt);
  await click(p, '.swatch[data-pal="4"]');
  await click(p, '.seg button[data-val="light"]');
  await click(p, '.seg button[data-val="sonar"]');
  await clearLog(p);
  await click(p, '.seg button[data-set="speed"][data-val="fast"]');
  await click(p, '.seg button[data-set="bgm"][data-val="yukai"]', 500);
  const sv = await p.evaluate(() => JSON.parse(localStorage.getItem('pixsee.settings') || '{}'));
  ok('せってい：いろ・さがしかた・スピード・おんがく を pixsee.settings に保存（版 v:10）', sv.palette === 4 && sv.search === 'sonar' && sv.speed === 'fast' && sv.bgm === 'yukai' && sv.v === 10, sv);
  const pv = (await logOf(p, 'Sfx.preview')).concat(await logOf(p, 'Sfx.bgm'));
  ok('せってい：おんがくを えらぶと その曲を 試しに鳴らす（Sfx.preview か bgm）', pv.some((l) => l[1] === 'yukai'), pv);
  const s0 = await snd(p);
  ok('せってい：試しの曲が ほんとうに鳴っている', !s0 || !s0.ready || s0.song === 'yukai', s0);
  await shot(p, '05settings');
  await fontCheck(p, 'せってい'); await wordCheck(p, 'せってい');
  await click(p, '#home');
  ok('せってい：モーダル「タイトルへもどりますか？」', (await txt(p, '#m-title')) === 'タイトルへもどりますか？');
  await clearLog(p);
  await click(p, '#m-yes', 500);
  ok('せってい：はい → タイトル', (await st(p)) === 'title');
  ok('せってい：出ると タイトルの曲へ もどる', (await logOf(p, 'Sfx.bgm')).some((l) => l[1] === 'title'));
  // ひとりで れんしゅう
  await nav(p, 'はじめる');
  await fontCheck(p, 'あそびかた');
  await click(p, '.howcard[data-kind=solo]');
  await click(p, '.card[data-id]', 1500);
  await fontCheck(p, 'ちずえらび');
  const yo = await p.evaluate(() => [...document.querySelectorAll('.card .yomi')].filter((e) => e.textContent).map((e) => {
    const c = e.closest('.card').getBoundingClientRect(), r = e.getBoundingClientRect();
    return { t: e.textContent, tf: getComputedStyle(e).transform, in: r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1 };
  }));
  ok('ちずえらび：よみは つぶさず カードの中に収まる（長いよみは 2行）', yo.length > 0 && yo.every((y) => y.tf === 'none' && y.in), yo.filter((y) => !(y.tf === 'none' && y.in)));
  await clearLog(p);
  await nav(p, 'しゅっぱつ！', 400);
  const lo = await p.evaluate(() => window.__loadOpts);
  ok('プレイ：World.load に palette・search・speed', lo && lo.players && lo.players[0].palette === 4 && lo.search === 'sonar' && lo.speed === 'fast' && lo.cpu === null && lo.mode === 'solo', lo);
  ok('プレイ：カウントダウン中は World が止まり ボタンは押せない', await p.evaluate(() => document.body.classList.contains('counting') && document.body.classList.contains('frozen') && getComputedStyle(document.getElementById('fwd')).pointerEvents === 'none'));
  ok('プレイ：GO! の前は World.go も プレイBGM もない', (await logOf(p, 'World.go')).length === 0 && !(await logOf(p, 'Sfx.bgm')).some((l) => PLAY_SONGS.test(l[1] || '')));
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
  ok('GO!：World.go と せっていで えらんだ曲（ゆかい）', (await logOf(p, 'World.go')).length === 1 && (await logOf(p, 'Sfx.bgm')).some((l) => l[1] === 'yukai') && !(await logOf(p, 'Sfx.bgm')).some((l) => /^play/.test(l[1] || '')), await logOf(p, 'Sfx.bgm'));
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
  // 獲得（直前に 擬音と説明を出しておく → 宣言が はじまると 消える）
  await p.evaluate(() => { window.__emit('onomato', 'drill'); document.getElementById('tip').classList.add('on'); }); await sleep(100);
  await clearLog(p);
  const el0 = (await info(p)).elapsed;
  const tHit = Date.now();
  await p.evaluate(() => window.__emit('gemHit', 0, 0)); await sleep(500);
  await p.evaluate(() => window.__emit('onomato', 'jump')); await sleep(50);
  const together = await p.evaluate(() => ({ counting: document.body.classList.contains('counting'), ono: document.querySelectorAll('#ono-l .ono,#ono-r .ono').length,
    tip: document.getElementById('tip').classList.contains('on'), maptag: getComputedStyle(document.getElementById('maptag')).visibility }));
  ok('獲得宣言：カウントダウン・擬音・説明・ちずの名前とは 同時に出ない（宣言中は 擬音も出ない）', !together.counting && together.ono === 0 && !together.tip && together.maptag === 'hidden', together);
  const i1 = await info(p);
  ok('獲得：World.award(0,0)・freeze(true)・ファンファーレ', (await logOf(p, 'World.award')).length === 1 && (await logOf(p, 'World.freeze')).some((l) => l[1] === true) && (await logOf(p, 'Sfx.play')).some((l) => l[1] === 'fanfare'));
  ok('獲得：宣言「あなたが …を ゲットした！」', (await txt(p, '#ann-who')) === 'あなたが' && /を ゲットした！$/.test(await txt(p, '#ann-what')), await txt(p, '#ann-what'));
  ok('獲得：タイムは獲得の瞬間に確定', i1.raceTime !== null && Math.abs(i1.raceTime - el0) < 0.6, [el0, i1.raceTime]);
  ok('獲得：宣言中はボタン無効', await p.evaluate(() => getComputedStyle(document.getElementById('fwd')).pointerEvents === 'none' && document.body.classList.contains('announcing')));
  await shot(p, '10announce');
  await p.evaluate(() => window.__emit('gemHit', 0, 0)); await sleep(100);
  ok('獲得：同じ宝石は2回目なし', (await logOf(p, 'World.award')).length === 1);
  await sleep(2200);
  { const ms = Date.now() - tHit, s0 = await st(p); ok(`獲得：3.5秒たつまでは結果へ行かない（宣言から ${ms}ms）`, s0 === 'play' || ms >= 3500, { ms, s0 }); }
  await waitFor(async () => (await st(p)) === 'ending', 4000);
  ok('結果：宣言のあとに結果', (await st(p)) === 'ending');
  ok('結果：ジングル practice', (await logOf(p, 'Sfx.jingle')).some((l) => l[1] === 'practice'));
  const i2 = await info(p);
  ok('結果：タイムは宣言の3.5秒を含まない', Math.abs(i2.raceTime - i1.raceTime) < 0.01 && (await txt(p, '#end-who')).includes('タイム'));
  const endpic = await p.evaluate(() => { const a = document.querySelector('.endpic').getBoundingClientRect(), h = document.getElementById('home').getBoundingClientRect(); return { a: [a.left, a.top, a.right, a.bottom], h: [h.left, h.top, h.right, h.bottom], hit: a.left < h.right && h.left < a.right && a.top < h.bottom && h.top < a.bottom }; });
  ok('結果：.endpic がホームボタンにかからない', !endpic.hit, endpic);
  await shot(p, '11ending_solo');
  await endingCheck(p, '結果（ひとり）');
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
  await endingCheck(p, '結果（コンピューターが はやかった）');
  const recT = await txt(p, '#end-rec');
  ok('CPU：結果の記録は「コンピューターが さき」（あいて と書かない）', recT.includes('コンピューターが さき') && !recT.includes('あいて'), recT);
  // 結果の見出し 全種類：上から並べて 切れない（fillEnding と同じ 大きさの きまり）
  const heads = ['みつけた！', 'きみが はやかった！', 'コンピューターが はやかった', 'ともだちが はやかった', 'きみの ほうが おおかった！', 'コンピューターの ほうが おおかった', 'ともだちの ほうが おおかった', 'みんな なかよし！ へいわの しょうり！'];
  const hr = await p.evaluate((hs) => hs.map((h) => {
    const f = document.getElementById('end-found'), st = document.getElementById('stage').getBoundingClientRect(), cq = Math.min(st.width, st.height) / 100;
    f.textContent = h; f.style.fontSize = ''; f.classList.toggle('long', h.length > 7 && h.length <= 11); f.classList.toggle('xlong', h.length > 11);
    const box = document.querySelector('.endleft'), r = f.getBoundingClientRect();
    return { h, top: +((r.top - st.top) / cq).toFixed(1), over: box.scrollHeight - box.clientHeight, w: r.width <= box.getBoundingClientRect().width + 1 };
  }), heads);
  ok('結果の見出し 全8種類：上が切れず 列からはみ出さない', hr.every((x) => x.top >= 0 && x.over <= 1 && x.w), hr);
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
  await sleep(700);
  const s1 = await snd(p);
  ok('プレイ：はい → resetGame のあと タイトルの BGM が ほんとうに鳴っている（Sfx の一時停止が 残らない）', s1 && s1.song === 'title' && s1.paused === false && s1.sources > 0, s1);
  ok('プレイ：はい → resetGame（World.stop・Sfx.stopAll・状態のリセット）→ タイトル', (await st(p)) === 'title' && (await logOf(p, 'World.stop')).length >= 1 && (await logOf(p, 'Sfx.stopAll')).length >= 1 && i.phase === 'idle' && i.opp === '' && i.mode === 'solo' && !i.paused && i.scores.join() === '0,0', i);
  ok('resetGame：カウントダウン・宣言の表示が消える', await p.evaluate(() => !document.body.classList.contains('counting') && !document.body.classList.contains('announcing') && !document.body.classList.contains('frozen')));
  // もう一度あそべる
  await nav(p, 'はじめる'); await click(p, '.howcard[data-kind=solo]'); await click(p, '.card[data-id]', 1500);
  await nav(p, 'しゅっぱつ！', 300);
  ok('resetGame のあと もう一度あそべる', await waitFor(async () => (await info(p)).phase === 'run', 7000));
  await sleep(300);
  const fb = await (await p.$('#fwd')).boundingBox();
  await p.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2); await p.mouse.down(); await sleep(900);
  const s2 = await snd(p);
  await p.mouse.up(); await sleep(200);
  ok('resetGame のあと 次のゲーム：プレイの BGM（既定 げんき）と 走る音（キャタピラ）が 鳴る', s2 && s2.song === 'genki' && PLAY_SONGS.test(s2.song || '') && s2.paused === false && s2.tread === true && s2.sources > 0, s2);
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
  // Quit →「はじめから」→ タイトル：BGM が鳴る
  await click(p, '#home'); await click(p, '#m-yes', 500);
  ok('タイトル：はい → Quit（2回目）', (await st(p)) === 'quit');
  await nav(p, 'はじめから', 800);
  const s3 = await snd(p);
  ok('Quit →「はじめから」→ タイトルの BGM が ほんとうに鳴っている', (await st(p)) === 'title' && s3 && s3.song === 'title' && s3.paused === false && s3.sources > 0, s3);
  const tov = await titleOverlap(p);
  TITLE_REPORT.push(Object.assign({ vp: '1024x768' }, tov));
  ok(`タイトル 1024×768：はじめる・せってい・ロゴ・島・記録チップ・署名・版・ホームが どれも重ならない（最小のすきま ${tov.minGap}cqmin：${tov.minPair}）`, tov.hits.length === 0 && tov.minGap >= 0.5, tov);
  ok(`タイトル 1024×768：ロゴは 上の中央〜まん中・はじめるは 下の中央・歯車は 左上`, titleLayout(tov), tov.rects);
  // その次のゲームでも 音が鳴る
  await nav(p, 'はじめる'); await click(p, '.howcard[data-kind=solo]'); await click(p, '.card[data-id]', 1500);
  await nav(p, 'しゅっぱつ！', 300);
  await waitFor(async () => (await info(p)).phase === 'run', 7000); await sleep(300);
  const fb2 = await (await p.$('#fwd')).boundingBox();
  await p.mouse.move(fb2.x + fb2.width / 2, fb2.y + fb2.height / 2); await p.mouse.down(); await sleep(900);
  const s4 = await snd(p);
  await p.mouse.up(); await sleep(200);
  ok('Quit →「はじめから」のあと 次のゲーム：プレイの BGM と 走る音が 鳴る', s4 && PLAY_SONGS.test(s4.song || '') && s4.paused === false && s4.tread === true, s4);
  ok('エラーなし（CPU）', errors.length === 0, errors);
  await context.close();
}

/* ---------- 4. コンピューター × どっちが おおい？（毎回の宣言・へいわの しょうり） ---------- */
async function cpuCount() {
  const { page: p, errors, context } = await open();
  await bootToTitle(p);
  await nav(p, 'はじめる');
  await click(p, '.howcard[data-kind=count]'); await click(p, '[data-who=cpu]');
  const lvT = await p.evaluate(() => [...document.querySelectorAll('.lvcard em')].map((e) => e.textContent));
  ok('むずかしさ：記録は「コンピューターが おおい」（あいて と書かない）', lvT.length === 3 && lvT.every((t) => t.includes('コンピューターが おおい') && !t.includes('あいて')), lvT);
  await fontCheck(p, 'むずかしさ');
  const lvFit = await p.evaluate(() => [...document.querySelectorAll('.lvcard em')].every((e) => { const c = e.closest('.lvcard').getBoundingClientRect(), r = e.getBoundingClientRect(); return r.left >= c.left - 1 && r.right <= c.right + 1 && r.bottom <= c.bottom + 1; }));
  ok('むずかしさ：記録の文が カードの中に収まる', lvFit);
  await shot(p, '12b_level_count');
  await click(p, '.lvcard[data-level=hard]');
  await click(p, '.card[data-id]', 1800);
  await nav(p, 'しゅっぱつ！', 300);
  await waitFor(async () => (await info(p)).phase === 'run', 7000);
  ok('おおい（CPU）：スコアの名前は「コンピューター」', (await txt(p, '#s-op-n')) === 'コンピューター', await txt(p, '#s-op-n'));
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
  await endingCheck(p, '結果（へいわの しょうり）');
  const recC = await txt(p, '#end-rec');
  ok('おおい（CPU）：結果の記録は「コンピューターが おおい」', recC.includes('コンピューターが おおい') && !recC.includes('あいて'), recC);
  await wordCheck(p, 'へいわ');
  await fontCheck(p, 'へいわ');
  ok('エラーなし（おおい）', errors.length === 0, errors);
  await context.close();
}

/* ---------- 5. Boot とエンディングのモーダル、縦持ち ---------- */
async function modalBoot() {
  const { page: p, errors, context } = await open();
  await sleep(300);
  // Boot：ホームボタンは出ない。押す操作をしても モーダルは開かず Boot のまま（じゅんびちゅう… と 読み込み後の どちらも）
  const tapHome = () => p.evaluate(() => { const h = document.getElementById('home'); ['pointerdown', 'pointerup', 'click'].forEach((n) => h.dispatchEvent(new PointerEvent(n, { bubbles: true, cancelable: true }))); });
  ok('Boot：ホームボタンは 出ていない', await p.evaluate(() => getComputedStyle(document.getElementById('home')).display === 'none'));
  await tapHome(); await sleep(300);
  ok('Boot（じゅんびちゅう）：ホームを押しても モーダルは開かず Boot のまま', !(await p.evaluate(() => document.getElementById('modal').classList.contains('on'))) && (await st(p)) === 'boot');
  await waitFor(async () => !(await p.evaluate(() => document.getElementById('bootbtn').disabled)), 8000);
  await tapHome(); await sleep(300);
  ok('Boot（タップしてスタート）：ホームを押しても モーダルは開かず Boot のまま', !(await p.evaluate(() => document.getElementById('modal').classList.contains('on'))) && (await st(p)) === 'boot');
  await click(p, '#bootbtn', 500);
  ok('Boot：進むのは「タップしてスタート」の click だけ', (await st(p)) === 'title');
  ok('タイトル：ホームボタンが 出る', await p.evaluate(() => getComputedStyle(document.getElementById('home')).display !== 'none'));
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
    if (vp.width === 1280) { // GO! の表示中に 宝石を取っても カウントダウンは すぐ消え、同時には出ない
      await p.evaluate(() => window.__emit('gemHit', 1, 2)); await sleep(150);
      const g = await p.evaluate(() => ({ counting: document.body.classList.contains('counting'), announcing: document.body.classList.contains('announcing'), n: document.getElementById('count-n').textContent, who: document.getElementById('ann-who').textContent }));
      ok('GO! のすぐ後の獲得：カウントダウンを消してから 宣言（同時に出ない）・「コンピューターが」', !g.counting && g.announcing && g.n === '' && g.who === 'コンピューターが', g);
      await sleep(700); await shot(p, '24announce_centre');
      await waitFor(async () => (await info(p)).phase === 'run', 6000);
    }
    const r = await p.evaluate(() => {
      document.body.classList.add('counting', 'announcing'); document.getElementById('tip').classList.add('on');
      // ちずの名前は いちばん長い よみ、大きいお知らせは 通信で ともだちが いなくなったときの 文で はかる
      const pt = document.getElementById('pt-title'), py = document.getElementById('pt-yomi'), mt = document.getElementById('maptag'), keepT = [pt.textContent, py.textContent];
      pt.textContent = '一日千秋'; py.textContent = 'いちじつせんしゅう';
      const nt = document.getElementById('notice'); nt.textContent = 'ともだちが いなくなったよ' + String.fromCharCode(10) + 'ひとりで つづけよう'; nt.classList.add('on', 'big'); nt.style.animation = 'none';
      const st = document.getElementById('stage').getBoundingClientRect(), cq = Math.min(st.width, st.height) / 100;
      const mtClip = { sw: mt.scrollWidth, cw: mt.clientWidth, sh: mt.scrollHeight, ch: mt.clientHeight, inner: [pt, py].every((e) => { const r = e.getBoundingClientRect(), m = mt.getBoundingClientRect(); return r.right <= m.right + 0.5 && r.bottom <= m.bottom + 0.5; }) };
      const ids = { home: '#home', sonar: '#sonar', 'timer+score': '#hud', maptag: '#maptag', 'お知らせ(大)': '#notice', camera: '#cam', 'すすむ': '#fwd', 'ジャンプ': '#b-jump', 'ドリルアタック': '#b-attack', 'ジャンプドリル': '#b-jd', '擬音(左)': '#ono-l', '擬音(右)': '#ono-r', '獲得宣言': '#ann', 'カウントダウン': '#count', '説明': '#tip' };
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
      // 獲得宣言の文字：8cqmin・いちばん長い文でも 2行（だれが／なにを ゲットした！）でカードに収まる
      ac.style.animation = 'none'; // 拡大の途中ではなく 止まった大きさで はかる
      const card = ac.getBoundingClientRect(), cs = getComputedStyle(ac), inner = card.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const rw = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect().width; };
      const aw = document.getElementById('ann-what'), awho = document.getElementById('ann-who'), annT = [];
      const lines = (el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
      ['アクアマリンを ゲットした！', 'ダイヤモンドを ゲットした！'].forEach((t) => { aw.textContent = t; annT.push({ t, fs: +(parseFloat(getComputedStyle(aw).fontSize) / cq).toFixed(2), w: +(rw(aw) / cq).toFixed(1), inner: +(inner / cq).toFixed(1), lines: lines(aw) }); });
      annT.push({ t: 'コンピューターが', fs: +(parseFloat(getComputedStyle(awho).fontSize) / cq).toFixed(2), w: +((rw(awho) + document.getElementById('ann-gem').getBoundingClientRect().width) / cq).toFixed(1), inner: +(inner / cq).toFixed(1), lines: lines(awho) });
      ac.style.animation = '';
      document.body.classList.remove('counting', 'announcing'); document.getElementById('tip').classList.remove('on');
      nt.classList.remove('on', 'big'); nt.textContent = ''; nt.style.animation = ''; pt.textContent = keepT[0]; py.textContent = keepT[1];
      // 同じ時には出ないので 場所が かさなってよい組（ui.js：宣言を はじめるとき カウントダウンを終わらせ・擬音を消し・説明を消し・ちずの名前を かくす。
      // 宣言中は 擬音を出さない。説明は GO! が消えてから 出す）。この組は「重なり 0」の数から はずし、別に 時間で わかれていることを確かめる
      const NEVER_TOGETHER = ['獲得宣言', 'カウントダウン', '擬音(左)', '擬音(右)', 'maptag', '説明'];
      const allowed = (x, y) => (x === '獲得宣言' || y === '獲得宣言') ? NEVER_TOGETHER.includes(x) && NEVER_TOGETHER.includes(y)
        : ((x === 'カウントダウン' && y === '説明') || (x === '説明' && y === 'カウントダウン'));
      const keys = Object.keys(R), hits = [], shared = [];
      let minGap = 1e9, minPair = '';
      for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
        const a = R[keys[i]], b = R[keys[j]], pair = keys[i] + '×' + keys[j];
        const gx = Math.max(b[0] - a[2], a[0] - b[2]), gy = Math.max(b[1] - a[3], a[1] - b[3]), gap = Math.max(gx, gy);
        if (allowed(keys[i], keys[j])) { if (gap < 0) shared.push(pair); continue; }
        if (gap < 0) hits.push(pair);
        if (gap < minGap) { minGap = gap; minPair = pair; }
      }
      const inside = keys.filter((k) => R[k][0] < -0.1 || R[k][1] < -0.1 || R[k][2] > st.width / cq + 0.1 || R[k][3] > 100.1);
      return { R, hits, shared, annT, fits, mtClip, minGap: +minGap.toFixed(1), minPair, inside, stage: [Math.round(st.width), Math.round(st.height)] };
    });
    ok(`重なり ${vp.width}×${vp.height}：絶対配置の要素どうしが重ならない（最小のすきま ${r.minGap}cqmin：${r.minPair}）`, r.hits.length === 0, r.hits);
    ok(`ちずの名前 ${vp.width}×${vp.height}：いちばん長い「一日千秋 いちじつせんしゅう」でも 切れない（2行）`, r.mtClip.sw <= r.mtClip.cw + 1 && r.mtClip.sh <= r.mtClip.ch + 1 && r.mtClip.inner, r.mtClip);
    ok(`大きいお知らせ ${vp.width}×${vp.height}：すすむ・ドリルアタック・ジャンプにかからない`, ['すすむ', 'ドリルアタック', 'ジャンプ', 'ジャンプドリル'].every((k) => { const a = r.R['お知らせ(大)'], b = r.R[k]; return Math.max(b[0] - a[2], a[0] - b[2], b[1] - a[3], a[1] - b[3]) > 0; }), [r.R['お知らせ(大)'], r.R['ドリルアタック']]);
    ok(`重なり ${vp.width}×${vp.height}：すべて 16:9 のステージの中`, r.inside.length === 0, r.inside);
    const A = r.R['獲得宣言'], cx = (A[0] + A[2]) / 2, cy = (A[1] + A[3]) / 2, sw = r.stage[0] / Math.min(r.stage[0], r.stage[1]) * 100;
    ok(`獲得宣言 ${vp.width}×${vp.height}：画面中央（中心 x ${cx.toFixed(1)}/${(sw / 2).toFixed(1)}・y ${cy.toFixed(1)}）、上の y 12〜30 は 3Dの宝石のために あける`, Math.abs(cx - sw / 2) < 1 && cy > 40 && cy < 52 && A[1] >= 30, A);
    ok(`獲得宣言 ${vp.width}×${vp.height}：文字 8cqmin・2行（だれが／なにを ゲットした！）でカードに収まる`, r.annT.every((x) => x.fs >= 8 && x.lines === 1 && x.w <= x.inner + 0.2), r.annT);
    ok(`重なり ${vp.width}×${vp.height}：場所を わけあうのは 同時に出ない組だけ（${r.shared.join('・')}）`, r.shared.every((x) => /獲得宣言|カウントダウン×説明|説明×カウントダウン/.test(x)), r.shared);
    ok(`重なり ${vp.width}×${vp.height}：擬音（最大の瞬間）・GO!・3・宣言の箱が 自分の帯の中に収まる`, r.fits.length === 0, r.fits);
    report.push({ vp: `${vp.width}x${vp.height}`, stage: r.stage, minGap: r.minGap, minPair: r.minPair, rects: r.R, annText: r.annT,
      sharedNeverTogether: r.shared, note: 'sharedNeverTogether の組は 画面に同時に出ない（ui.js beginAnnounce がカウントダウンを終わらせ・擬音と説明を消し・ちずの名前をかくす。宣言中は擬音を出さない。説明は GO! が消えてから）。それ以外の組は 重なり 0（minGap）' });
    await camCheck(p, `${vp.width}×${vp.height}`);
    if (vp.height === 768) await shot(p, '20play_ipad43');
    ok(`エラーなし（重なり ${vp.width}×${vp.height}）`, errors.length === 0, errors);
    await context.close();
  }
  fs.writeFileSync(path.join(SH, 'overlap_report.json'), JSON.stringify({ play: report, title: TITLE_REPORT }, null, 1));
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
    await g.evaluate(() => localStorage.setItem('pixsee.settings', JSON.stringify({ v: 10, palette: 6, search: 'light', speed: 'slow', bgm: 'iyashi' })));
    await g.reload(); await sleep(300);
    await h.evaluate(() => localStorage.setItem('pixsee.settings', JSON.stringify({ v: 10, palette: 2, search: 'sonar', speed: 'fast', bgm: 'nonbiri' })));
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
    const hlo = await h.evaluate(() => window.__loadOpts);
    ok('通信：スピードは ホストの設定（はやい）を map で送り 両方が同じ', glo.speed === 'fast' && hlo.speed === 'fast', [glo.speed, hlo.speed]);
    ok('通信：クライアントは ready を送る', await waitFor(async () => (await logOf(g, 'net>ready')).length === 1, 5000));
    ok('通信：ホストは ready を受けて count を送る', await waitFor(async () => (await logOf(h, 'net>count')).length === 1, 5000));
    ok('通信：両方 カウントダウン → run', await waitFor(async () => (await info(h)).phase === 'run' && (await info(g)).phase === 'run', 8000));
    ok('通信：曲は それぞれの設定（ホスト のんびり・クライアント いやし）', (await logOf(h, 'Sfx.bgm')).some((l) => l[1] === 'nonbiri') && (await logOf(g, 'Sfx.bgm')).some((l) => l[1] === 'iyashi'));
    await shot(g, '21net_guest_play');
    await sleep(500);
    // ホストが ホームのモーダルを開く → クライアントも止まり「ともだちを まっているよ」→ いいえ で 両方 動く
    await clearLog(h); await clearLog(g);
    await click(h, '#home', 400);
    ok('通信：ホストが モーダルを開くと pause(on) を送る', (await logOf(h, 'net>pause')).some((l) => /"on":true/.test(l[1])));
    ok('通信：クライアントも止まる（World.setPaused・Sfx.pause・「ともだちを まっているよ」）', await waitFor(async () => (await info(g)).paused && (await info(g)).remotePaused, 4000)
      && (await logOf(g, 'World.setPaused')).some((l) => l[1] === true) && (await logOf(g, 'Sfx.pause')).some((l) => l[1] === true)
      && await g.evaluate(() => getComputedStyle(document.getElementById('waitnote')).display === 'flex' && document.getElementById('waitnote').textContent.includes('ともだちを まっているよ')));
    const ge0 = (await info(g)).elapsed; await sleep(1000); const ge1 = (await info(g)).elapsed;
    ok('通信：止まっている間 クライアントの時間は進まない', Math.abs(ge1 - ge0) < 0.05, [ge0, ge1]);
    const wn = await g.evaluate(() => { const st = document.getElementById('stage').getBoundingClientRect(), cq = Math.min(st.width, st.height) / 100, c = document.querySelector('.wn-card').getBoundingClientRect(), hm = document.getElementById('home').getBoundingClientRect();
      return { fs: +(parseFloat(getComputedStyle(document.querySelector('.wn-card span')).fontSize) / cq).toFixed(2), hitHome: c.left < hm.right && hm.left < c.right && c.top < hm.bottom && hm.top < c.bottom, pe: getComputedStyle(document.getElementById('waitnote')).pointerEvents, op: getComputedStyle(document.getElementById('waitnote')).opacity + '/' + getComputedStyle(document.querySelector('.wn-card')).opacity }; });
    ok('通信：「ともだちを まっているよ」は 大きく（7cqmin 以上）・ホームボタンに かからず 押せる', wn.fs >= 7 && !wn.hitHome && wn.pe === 'none' && wn.op === '1/1', wn);
    await shot(g, '21b_net_guest_waiting');
    await fontCheck(g, '通信 まっているよ');
    await click(h, '#m-no', 400);
    ok('通信：ホストが いいえ → クライアントも 動きだす', await waitFor(async () => !(await info(g)).paused && !(await info(g)).remotePaused, 4000)
      && await g.evaluate(() => getComputedStyle(document.getElementById('waitnote')).display === 'none'));
    const ge2 = (await info(g)).elapsed; await sleep(600); const ge3 = (await info(g)).elapsed;
    ok('通信：クライアントの時間が また進む', ge3 - ge2 > 0.3, [ge2, ge3]);
    // クライアントが モーダルを開く → ホストも止まる → いいえ
    await click(g, '#home', 400);
    ok('通信：クライアントが モーダルを開くと ホストも止まる', await waitFor(async () => (await info(h)).paused && (await info(h)).remotePaused, 4000));
    await click(g, '#m-no', 400);
    ok('通信：クライアントが いいえ → ホストも 動きだす', await waitFor(async () => !(await info(h)).paused, 4000));
    // クライアントが宝石を壊す → claim → ホストが award → resume
    await clearLog(h); await clearLog(g);
    // 同じ評価の中で しらべる（手元の中継は速く、ホストの award が すぐ届くため）
    const cl = await g.evaluate(() => { window.__emit('gemHit', 1, 0); return { claim: window.__log.filter((l) => l[0] === 'net>claim').length, award: window.__log.filter((l) => l[0] === 'World.award').length }; });
    ok('通信：クライアントは claim を送り 自分では award しない', cl.claim === 1 && cl.award === 0, cl);
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
  await endingCheck(g, '結果（きみが はやかった！・通信）');
    ok('エラーなし（通信）', H.errors.length === 0 && G.errors.length === 0, H.errors.concat(G.errors));
  } finally {
    await H.context.close(); await G.context.close();
    try { srv.close(); } catch (e) {}
  }
}

/* ---------- 8. 通信：とちゅうで 片方が「はい」（resetGame）→ もう片方は 止まったままに ならず ひとりで つづける ---------- */
async function netLeave() {
  const { startPeerServer } = require('./harness.js');
  const port = PEER_PORT + 1, srv = startPeerServer(port);
  const query = `?peerhost=127.0.0.1&peerport=${port}&peerpath=/myapp&peersecure=0`;
  const VPN = { width: 1024, height: 768 };
  const H = await open(VPN, { query }), G = await open(VPN, { query });
  const h = H.page, g = G.page;
  try {
    await bootToTitle(h); await bootToTitle(g);
    await nav(h, 'はじめる'); await click(h, '.howcard[data-kind=count]'); await click(h, '[data-who=net]'); await click(h, '#c-host', 1500);
    const code = await h.evaluate(() => [...document.querySelectorAll('#codeshow b')].map((b) => b.textContent).join(''));
    await nav(g, 'はじめる'); await click(g, '.howcard[data-kind=count]'); await click(g, '[data-who=net]'); await click(g, '#c-join');
    for (const d of code) await click(g, `.key:not(.del):not(.nul) >> text="${d}"`, 120);
    await nav(g, 'つなぐ！', 500);
    ok('通信（ぬける）：つながる', await waitFor(async () => (await h.evaluate(() => document.getElementById('setting').dataset.sub)) === 'pick', 15000));
    await sleep(800);
    await click(h, '.card[data-id]', 1500);
    await nav(h, 'しゅっぱつ！', 300);
    ok('通信（ぬける）：両方 run', await waitFor(async () => (await info(h)).phase === 'run' && (await info(g)).phase === 'run', 15000));
    await sleep(500);
    await click(g, '#home', 400);
    ok('通信（ぬける）：クライアントの モーダルで ホストも止まる', await waitFor(async () => (await info(h)).paused && (await info(h)).remotePaused, 4000));
    await shot(h, '25net_host_waiting_43');
    await clearLog(g);
    await click(g, '#m-yes', 800);
    ok('通信（ぬける）：クライアントは はい → タイトル', (await st(g)) === 'title');
    const gs = await snd(g);
    ok('通信（ぬける）：クライアントの タイトルの BGM が 鳴っている', gs && gs.song === 'title' && gs.paused === false && gs.sources > 0, gs);
    ok('通信（ぬける）：ホストは「ともだちが いなくなったよ」を出し 止まったままに ならない', await waitFor(async () => { const x = await info(h); return !x.paused && !x.remotePaused && !x.netOn; }, 8000)
      && await h.evaluate(() => document.getElementById('notice').classList.contains('big') && document.getElementById('notice').textContent.includes('ともだちが いなくなったよ') && getComputedStyle(document.getElementById('waitnote')).display === 'none'));
    const nb = await h.evaluate(() => { const R = (s) => document.querySelector(s).getBoundingClientRect(), n = R('#notice'); return ['#fwd', '#b-attack', '#b-jump', '#b-jd'].filter((s) => { const b = R(s); return n.left < b.right && b.left < n.right && n.top < b.bottom && b.top < n.bottom; }); });
    ok('通信（ぬける）：大きいお知らせは 操作ボタンに かからない（4:3）', nb.length === 0, nb);
    await sleep(300);
    await shot(h, '26net_host_partner_left_43');
    const he0 = (await info(h)).left; await sleep(800); const he1 = (await info(h)).left;
    ok('通信（ぬける）：ホストは ひとりで つづける（時間が進む）', he0 - he1 > 0.4 && (await info(h)).phase === 'run', [he0, he1]);
    ok('通信（ぬける）：大きいお知らせは しばらくすると消える', await waitFor(async () => !(await h.evaluate(() => document.getElementById('notice').classList.contains('on'))), 6000));
    ok('エラーなし（通信 ぬける）', H.errors.length === 0 && G.errors.length === 0, H.errors.concat(G.errors));
  } finally {
    await H.context.close(); await G.context.close();
    try { srv.close(); } catch (e) {}
  }
}

/* ========== 第5期で足した確認 ========== */
const VPS = [{ width: 1280, height: 720 }, { width: 1024, height: 768 }];
const rectsCq = (p, sels) => p.evaluate((sels) => {
  const st = document.getElementById('stage').getBoundingClientRect(), cq = Math.min(st.width, st.height) / 100, R = {};
  for (const k in sels) { const e = document.querySelector(sels[k]); if (!e) { R[k] = null; continue; } const b = e.getBoundingClientRect(); R[k] = [b.left - st.left, b.top - st.top, b.right - st.left, b.bottom - st.top].map((v) => +(v / cq).toFixed(1)); }
  return R;
}, sels);
function pairHits(R) {
  const keys = Object.keys(R).filter((k) => R[k]), hits = []; let minGap = 1e9, minPair = '';
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = R[keys[i]], b = R[keys[j]], gap = Math.max(b[0] - a[2], a[0] - b[2], b[1] - a[3], a[1] - b[3]);
    if (gap < 0) hits.push(keys[i] + '×' + keys[j]);
    if (gap < minGap) { minGap = gap; minPair = keys[i] + '×' + keys[j]; }
  }
  return { hits, minGap: +minGap.toFixed(1), minPair };
}
// 字が 箱から はみ出していない（scrollWidth ≤ clientWidth）・中身が 親の箱の中
const fitCheck = (p, sel) => p.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length).map((e) => {
  const over = e.scrollWidth - e.clientWidth, overH = e.scrollHeight - e.clientHeight;
  return { t: (e.textContent || '').trim().slice(0, 16), over, overH };
}).filter((x) => x.over > 1 || x.overH > 1), sel);

/* ---------- 9. せってい：既定値・古い保存・はみ出しと重なり（16:9 と 4:3） ---------- */
async function settingsFlow() {
  for (const vp of VPS) {
    const { page: p, errors, context } = await open(vp);
    await bootToTitle(p);
    const d = (await info(p)).settings;
    ok(`せってい ${vp.width}×${vp.height}：保存が ないときの 既定 {swipeRev:true, search:'sonar', speed:'normal', bgm:'genki', level:'normal', palette:0, binary:false}`, d.swipeRev === true && d.search === 'sonar' && d.speed === 'normal' && d.bgm === 'genki' && d.level === 'normal' && d.palette === 0 && d.binary === false, d);
    await gear(p, 500);
    const fit = await fitCheck(p, '#setting .setcard, #setting .seg button, #setting .sc-hint, #setting .sc-head');
    ok(`せってい ${vp.width}×${vp.height}：カード・ボタン・説明の 字が はみ出さない（scrollWidth ≤ clientWidth）`, fit.length === 0, fit);
    const kids = await p.evaluate(() => {
      const st = document.getElementById('stage').getBoundingClientRect(), cq = Math.min(st.width, st.height) / 100, bad = [];
      document.querySelectorAll('#setting .setcard').forEach((c) => { const cb = c.getBoundingClientRect(); c.querySelectorAll('button,.sc-hint,.sc-head').forEach((e) => { const b = e.getBoundingClientRect(); if (b.left < cb.left - 1 || b.right > cb.right + 1 || b.top < cb.top - 1 || b.bottom > cb.bottom + 1) bad.push(c.dataset.card + ':' + (e.textContent || '').trim().slice(0, 8)); }); });
      return bad;
    });
    ok(`せってい ${vp.width}×${vp.height}：ボタンと説明が カードの中に おさまる`, kids.length === 0, kids);
    const R = await rectsCq(p, { back: '#back', head: '#sethead', home: '#home', palette: '[data-card=palette]', search: '[data-card=search]', speed: '[data-card=speed]', swipeRev: '[data-card=swipeRev]', bgm: '[data-card=bgm]', binary: '[data-card=binary]', record: '[data-card=record]' });
    const ph = pairHits(R);
    ok(`せってい ${vp.width}×${vp.height}：カードどうし・もどる・見出し・ホームが 重ならない（最小のすきま ${ph.minGap}cqmin：${ph.minPair}）`, ph.hits.length === 0, ph);
    ok(`せってい ${vp.width}×${vp.height}：スピード（はやい／ふつう／ゆっくり）と おんがく（げんき／ゆかい／のんびり／いやし）の 行がある`, await p.evaluate(() => [...document.querySelectorAll('[data-set=speed]')].map((b) => b.textContent).join() === 'はやい,ふつう,ゆっくり' && [...document.querySelectorAll('[data-set=bgm]')].map((b) => b.textContent).join() === 'げんき,ゆかい,のんびり,いやし'));
    await fontCheck(p, `せってい ${vp.width}×${vp.height}`);
    if (vp.width === 1280) await shot(p, '30settings_169'); else await shot(p, '30settings_43');
    // 古い（v9 までの）保存：いろ・むずかしさは ひきつぎ、swipeRev と search は 新しい既定
    await p.evaluate(() => localStorage.setItem('pixsee.settings', JSON.stringify({ swipeRev: false, binary: true, level: 'hard', palette: 3, search: 'light' })));
    await p.reload(); await bootToTitle(p);
    const m = (await info(p)).settings;
    ok(`せってい ${vp.width}×${vp.height}：古い保存（版なし）でも swipeRev=はんたい・search=ソナーだけ に なり、ほかは ひきつぐ`, m.swipeRev === true && m.search === 'sonar' && m.palette === 3 && m.level === 'hard' && m.binary === true && m.speed === 'normal' && m.bgm === 'genki', m);
    await p.evaluate(() => localStorage.setItem('pixsee.settings', JSON.stringify({ v: 10, swipeRev: false, search: 'light', speed: 'slow', bgm: 'iyashi' })));
    await p.reload(); await bootToTitle(p);
    const n = (await info(p)).settings;
    ok(`せってい ${vp.width}×${vp.height}：v10 の保存は そのまま（ふつう・ひかり・ゆっくり・いやし）`, n.swipeRev === false && n.search === 'light' && n.speed === 'slow' && n.bgm === 'iyashi', n);
    ok(`エラーなし（せってい ${vp.width}×${vp.height}）`, errors.length === 0, errors);
    await context.close();
  }
}

/* ---------- 10. タイトル（4:3 の写真も） ---------- */
async function titleFlow() {
  const { page: p, errors, context } = await open({ width: 1024, height: 768 });
  await bootToTitle(p); await sleep(400);
  const tov = await titleOverlap(p);
  ok(`タイトル 1024×768（はじめから）：どれも重ならない（最小のすきま ${tov.minGap}cqmin：${tov.minPair}）・並び`, tov.hits.length === 0 && tov.minGap >= 0.5 && titleLayout(tov), tov);
  await fontCheck(p, 'タイトル 4:3');
  await shot(p, '31title_43');
  ok('エラーなし（タイトル 4:3）', errors.length === 0, errors);
  await context.close();
}

/* ---------- 11. ちずえらび：タブ・1列の横スクロール（指）・ランダム・えいごの意味（16:9 と 4:3） ---------- */
async function pickFlow() {
  for (const vp of VPS) {
    const tag = `${vp.width}×${vp.height}`;
    const { page: p, errors, context } = await open(vp, { touch: true });
    await bootToTitle(p);
    await nav(p, 'はじめる'); await click(p, '.howcard[data-kind=solo]', 500);
    const tabs = await p.evaluate(() => [...document.querySelectorAll('.mtab')].map((t) => ({ k: t.dataset.tab, name: t.querySelector('span').textContent, n: +t.querySelector('b').textContent, cards: document.querySelectorAll('.mrow[data-kind=' + t.dataset.tab + '] .card').length })));
    const names = tabs.map((t) => t.name).join('・');
    ok(`ちずえらび ${tag}：種類の タブ（${names}）`, names === 'よじじゅくご・ことわざ・えいご・イラスト' && tabs.every((t) => t.n === t.cards && t.n > 0), tabs);
    const cnt = Object.fromEntries(tabs.map((t) => [t.k, t.n]));
    ok(`ちずえらび ${tag}：見本の数 よじじゅくご ${cnt.yoji}・ことわざ ${cnt.kotowaza}・えいご ${cnt.eigo}（15・10・10 以上。MapGen の担当）`, cnt.yoji >= 15 && cnt.kotowaza >= 10 && cnt.eigo >= 10, cnt);
    const row = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('.mrow')].filter((r) => getComputedStyle(r).display !== 'none'), r = rows[0], cs = getComputedStyle(r);
      const card = r.querySelector('.card'), kan = card.querySelector('.kan'), rb = r.getBoundingClientRect();
      const part = [...r.querySelectorAll('.card')].some((c) => { const b = c.getBoundingClientRect(); return b.left < rb.right - 4 && b.right > rb.right + 4; });
      return { shown: rows.length, ox: cs.overflowX, snap: cs.scrollSnapType, ta: cs.touchAction, cardTa: getComputedStyle(card).touchAction, kanTa: getComputedStyle(kan).touchAction, align: getComputedStyle(card).scrollSnapAlign, more: r.scrollWidth > r.clientWidth + 10, part, arrow: getComputedStyle(document.querySelector('.mnav.next')).display };
    });
    ok(`ちずえらび ${tag}：見えている列は 1つ・横スクロール（overflow-x auto・scroll-snap x）`, row.shown === 1 && row.ox === 'auto' && /x/.test(row.snap) && /start/.test(row.align), row);
    ok(`ちずえらび ${tag}：iPad の指の横スクロールのため 列・カード・カードの中の字が touch-action:pan-x`, row.ta === 'pan-x' && row.cardTa === 'pan-x' && row.kanTa === 'pan-x', row);
    ok(`ちずえらび ${tag}：右はしの カードが 少しだけ見えて「まだ つづく」とわかる（＋ 矢印）`, row.more && row.part && row.arrow !== 'none', row);
    // 指（CDP のタッチ）で 横に なぞる → 列が スクロールし、カードは えらばれない
    const cdp = await context.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
    const rb = await p.evaluate(() => { const r = document.querySelector('.mrow.on').getBoundingClientRect(); return { x: r.left + r.width * 0.7, y: r.top + r.height / 2, w: r.width }; });
    const sl0 = await p.evaluate(() => document.querySelector('.mrow.on').scrollLeft);
    await T('touchStart', [[rb.x, rb.y, 1]]);
    for (let i = 1; i <= 12; i++) { await T('touchMove', [[rb.x - i * rb.w * 0.045, rb.y, 1]]); await sleep(16); }
    await T('touchEnd', []); await sleep(900);
    const sl1 = await p.evaluate(() => document.querySelector('.mrow.on').scrollLeft);
    const sel1 = await p.evaluate(() => document.querySelectorAll('.card.on').length);
    ok(`ちずえらび ${tag}：指で 横に なぞると 列が スクロールする（scrollLeft ${sl0} → ${Math.round(sl1)}）・なぞっただけでは えらばない`, sl1 - sl0 > 40 && sel1 === 0, { sl0, sl1, sel1 });
    // タブを かえる → その種類の 列（左はしから）
    await click(p, '.mtab[data-tab=eigo]', 400);
    const eg = await p.evaluate(() => { const r = document.querySelector('.mrow.on'); return { k: r.dataset.kind, sl: r.scrollLeft, mean: [...r.querySelectorAll('.card')].map((c) => (c.querySelector('.mean') || {}).textContent || '') }; });
    ok(`ちずえらび ${tag}：えいごの タブ → えいごの列・すべての カードに 意味（${eg.mean.slice(0, 3).join('・')}…）`, eg.k === 'eigo' && eg.sl === 0 && eg.mean.length > 0 && eg.mean.every((m) => m.length > 0), eg);
    const fs = await p.evaluate(() => { const st = document.getElementById('stage').getBoundingClientRect(), cq = Math.min(st.width, st.height) / 100, e = document.querySelector('.mrow.on .mean'); return +(parseFloat(getComputedStyle(e).fontSize) / cq).toFixed(2); });
    ok(`ちずえらび ${tag}：意味は 小さく（${fs}cqmin、3.4 以上）`, fs >= 3.4 && fs < 5, fs);
    if (vp.width === 1280) await shot(p, '32pick_eigo_169');
    // どの種類の カードも 字が カードから はみ出さない
    const out = await p.evaluate(() => { const bad = []; document.querySelectorAll('.mrow').forEach((r) => { const keep = r.style.display; r.style.display = 'flex';
      r.querySelectorAll('.card').forEach((c) => { const cb = c.getBoundingClientRect(); c.querySelectorAll('.kan,.yomi,.mean,.ic').forEach((e) => { const b = e.getBoundingClientRect(); if (b.width && (b.left < cb.left - 0.5 || b.right > cb.right + 0.5 || b.top < cb.top - 0.5 || b.bottom > cb.bottom + 0.5)) bad.push(c.dataset.id + ':' + e.className); }); });
      r.style.display = keep; }); return bad; });
    ok(`ちずえらび ${tag}：4種類 すべての カードで 字・絵が カードの中`, out.length === 0, out);
    await fontCheck(p, `ちずえらび ${tag}`);
    // ランダム：えらばれて しゅっぱつ！が 出る。えらばれた カードは その種類の タブで 見えるところ
    await clearLog(p);
    await click(p, '#m-random', 300);
    await waitFor(async () => (await p.evaluate(() => !!document.querySelector('#nav [data-nav="しゅっぱつ！"]'))), 8000);
    await sleep(700);
    const rr = await p.evaluate(() => { const c = document.querySelector('.card.on'), r = document.querySelector('.mrow.on'); if (!c) return null; const b = c.getBoundingClientRect(), rb = r.getBoundingClientRect();
      return { id: c.dataset.id, kind: c.dataset.kind, tab: document.querySelector('.mtab.on').dataset.tab, inView: b.left >= rb.left - 2 && b.right <= rb.right + 2, go: !!document.querySelector('#nav [data-nav="しゅっぱつ！"]'), pt: (document.querySelector('#preview .pt') || {}).textContent }; });
    ok(`ちずえらび ${tag}：ランダム → 見本から 1つ えらび（${rr && rr.pt}）、カードを 押したときと 同じに しゅっぱつ！ が出る・その種類の タブで 見える`, rr && rr.go && rr.kind === rr.tab && rr.inView, rr);
    const R = await rectsCq(p, { back: '#back', head: '#sethead', home: '#home', tabs: '.mtabs', row: '.mrows', tools: '.mtools', preview: '#preview', go: '#nav .nbtn' });
    const ph = pairHits(R);
    ok(`ちずえらび ${tag}：タブ・カードの列・ランダム・えを よみこむ・右の ちず・しゅっぱつ！・もどる・ホームが 重ならない（最小のすきま ${ph.minGap}cqmin：${ph.minPair}）`, ph.hits.length === 0, ph);
    const tabFit = await p.evaluate(() => { const m = document.querySelector('.mtabs').getBoundingClientRect(); return [...document.querySelectorAll('.mtab')].every((t) => t.getBoundingClientRect().right <= m.right + 0.5) && [...document.querySelectorAll('.mtools > *')].every((t) => t.getBoundingClientRect().right <= document.querySelector('.mtools').getBoundingClientRect().right + 0.5); });
    ok(`ちずえらび ${tag}：タブと 下の ボタンが 列の はばに おさまる`, tabFit);
    if (vp.width === 1280) await shot(p, '33pick_random_169'); else await shot(p, '33pick_random_43');
    // しゅっぱつ（ランダムで えらんだ ちず）
    await nav(p, 'しゅっぱつ！', 400);
    ok(`ちずえらび ${tag}：ランダムで えらんだ ちずで プレイが はじまる`, (await st(p)) === 'play' && !!(await p.evaluate(() => window.__loadOpts)));
    ok(`エラーなし（ちずえらび ${tag}）`, errors.length === 0, errors);
    await context.close();
  }
}

/* ---------- 12. 視点ボタン：4段階の名前が ボタンの内側に収まる（overlap() の中で 16:9・4:3 と よぶ） ---------- */
async function camCheck(p, tag) {
  const names = [];
  for (let k = 0; k < 5; k++) {
    const r = await p.evaluate(() => {
      const b = document.getElementById('cam'), l = document.getElementById('cam-label'), bb = b.getBoundingClientRect(), lb = l.getBoundingClientRect();
      const rg = document.createRange(); rg.selectNodeContents(l); const tb = rg.getBoundingClientRect(), cs = getComputedStyle(b);
      const st = document.getElementById('stage').getBoundingClientRect(), cq = Math.min(st.width, st.height) / 100;
      return { t: l.textContent, sw: l.scrollWidth, cw: l.clientWidth, inBtn: tb.left >= bb.left + parseFloat(cs.paddingLeft) - 0.5 && tb.right <= bb.right - parseFloat(cs.paddingRight) + 0.5 && lb.bottom <= bb.bottom + 0.5,
        fs: +(parseFloat(getComputedStyle(l).fontSize) / cq).toFixed(2), dots: document.querySelectorAll('#cam-dots b').length, on: [...document.querySelectorAll('#cam-dots b')].findIndex((d) => d.classList.contains('on')),
        world: window.World && window.World._debug ? window.World._debug().cam : null };
    });
    names.push(r);
    await click(p, '#cam', 250);
  }
  const ls = names.slice(0, 4).map((r) => r.t).join('・');
  ok(`視点ボタン ${tag}：4段階（${ls}）→ 5回目で もとに もどる・World の視点と 同じ`, ls === 'おいかけ・みわたし・そら・め' && names[4].t === 'おいかけ' && names.every((r) => r.dots === 4 && (r.world === null || r.world === ['め', 'おいかけ', 'みわたし', 'そら'].indexOf(r.t))), names);
  ok(`視点ボタン ${tag}：4つの名前 すべて 字が ボタンの内側（scrollWidth ≤ clientWidth、${names.map((r) => r.t + ' ' + r.sw + '/' + r.cw).join('、')}）・3.4cqmin 以上`, names.every((r) => r.sw <= r.cw && r.inBtn && r.fs >= 3.35), names);
}

/* ---------- 13. 'overGem'：ソナーが ふわっと光って もどる（点滅しない・UI は音を鳴らさない） ---------- */
async function overGemFlow() {
  const { page: p, errors, context } = await open();
  await bootToTitle(p);
  await nav(p, 'はじめる'); await click(p, '.howcard[data-kind=solo]'); await click(p, '.card[data-id]', 1500);
  await nav(p, 'しゅっぱつ！', 300);
  await waitFor(async () => (await info(p)).phase === 'run', 8000);
  await clearLog(p);
  ok('overGem：UI が World.on("overGem") に 登録している', await p.evaluate(() => (window.__wh.overGem || []).length >= 1));
  await p.evaluate(() => window.__emit('overGem', 0));
  const ks = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 2600) { ks.push(await p.evaluate(() => App._info().glow)); await sleep(120); }
  const cls = await p.evaluate(() => document.getElementById('sonar').classList.contains('glow'));
  let turns = 0; for (let i = 2; i < ks.length; i++) { const a = ks[i - 1] - ks[i - 2], b = ks[i] - ks[i - 1]; if (a > 0.02 && b < -0.02) turns++; if (a < -0.02 && b > 0.02) turns += 10; }
  ok(`overGem：光は 1回 上がって ゆっくり もどる（点滅しない。最大 ${Math.max(...ks).toFixed(2)}・おわり ${ks[ks.length - 1].toFixed(2)}）`, Math.max(...ks) > 0.9 && ks[ks.length - 1] === 0 && turns <= 1 && !cls, ks.map((k) => +k.toFixed(2)));
  const sp = (await logOf(p, 'Sfx.play')).filter((l) => l[1] === 'pinpin');
  ok('overGem：UI は 音を 鳴らさない（pinpin は World が鳴らす）', sp.length === 0, sp);
  await p.evaluate(() => window.__emit('overGem', 0)); await sleep(500);
  await shot(p, '34sonar_glow');
  ok('エラーなし（overGem）', errors.length === 0, errors);
  await context.close();
}

/* ---------- 14. スワイプ（4e）：すすむを 押したまま 別の指で なぞる（CDP の タッチ 2本）・4:3 の帯・感度・たて混じり ---------- */
async function swipeFlow() {
  for (const vp of VPS) {
    const tag = `${vp.width}×${vp.height}`;
    const { page: p, errors, context } = await open(vp, { touch: true });
    await bootToTitle(p);
    await nav(p, 'はじめる'); await click(p, '.howcard[data-kind=solo]'); await click(p, '.card[data-id]', 1500);
    await nav(p, 'しゅっぱつ！', 300);
    await waitFor(async () => (await info(p)).phase === 'run', 8000);
    await sleep(400);
    const cdp = await context.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
    const geo = await p.evaluate(() => { const s = document.getElementById('stage').getBoundingClientRect(), f = document.getElementById('fwd').getBoundingClientRect(); return { sl: s.left, st: s.top, sw: s.width, sh: s.height, fx: f.left + f.width / 2, fy: f.top + f.height / 2, vh: innerHeight }; });
    const head = () => p.evaluate(() => window.World._debug().me.heading);
    const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    // CDP のタッチ：touchStart・touchMove は「いま画面にある指 ぜんぶ」、touchEnd は「はなす指」を送る
    const FWD = [geo.fx, geo.fy, 1];
    const lift = async (pt) => { await T('touchEnd', [pt]); };
    const swipe = async (x0, y0, dx, dy, hold, id = 2, steps = 14) => {
      const base = hold === true ? [FWD] : (Array.isArray(hold) ? hold : []);
      await T('touchStart', base.concat([[x0, y0, id]])); await sleep(30);
      for (let i = 1; i <= steps; i++) { await T('touchMove', base.concat([[x0 + dx * i / steps, y0 + dy * i / steps, id]])); await sleep(16); }
      await lift([x0 + dx, y0 + dy, id]); await sleep(60);
    };
    // 1本目の指で すすむ を押す
    await clearLog(p);
    await T('touchStart', [[geo.fx, geo.fy, 1]]); await sleep(400);
    const pr0 = await logOf(p, 'World.press');
    ok(`スワイプ ${tag}：1本目の指で すすむ を押している`, pr0.some((l) => l[1] === 'fwd' && l[2] === true), pr0);
    // 2本目の指で ステージの横幅の 1/3 を なぞる（右へ）→ 90度（はんたい の既定なので 左へ まわる）
    const h0 = await head();
    await swipe(geo.sl + geo.sw * 0.38, geo.st + geo.sh * 0.55, geo.sw / 3, 0, true, 2);
    const h1 = await head(), d1 = wrap(h1 - h0);
    const pr1 = await logOf(p, 'World.press');
    const sw1 = (await info(p)).sw;
    ok(`スワイプ ${tag}：2本目の指を はなすと なぞりの状態が のこらない（のこると 次の なぞりを 受けない：v9 の 不具合）`, sw1 === null, sw1);
    ok(`スワイプ ${tag}：すすむを 押したまま 別の指で なぞると 向きが かわる（${(d1 * 180 / Math.PI).toFixed(1)}度）`, Math.abs(d1) > 0.3, { h0, h1 });
    ok(`スワイプ ${tag}：感度 ステージの横幅の 1/3 で 約90度（${(Math.abs(d1) * 180 / Math.PI).toFixed(1)}度・75〜105）`, Math.abs(d1) * 180 / Math.PI > 75 && Math.abs(d1) * 180 / Math.PI < 105, d1);
    ok(`スワイプ ${tag}：なぞっている間も すすむは 押されたまま（press(fwd,false) が 出ない）`, !pr1.some((l) => l[1] === 'fwd' && l[2] === false), pr1);
    // もう一度（反対へ）：2回目も 確実に 回る
    const h2a = await head();
    await swipe(geo.sl + geo.sw * 0.7, geo.st + geo.sh * 0.5, -geo.sw / 4, 0, true, 3);
    const d2 = wrap((await head()) - h2a);
    ok(`スワイプ ${tag}：2回目（逆むき）も 回る（${(d2 * 180 / Math.PI).toFixed(1)}度）・向きは 1回目と 反対`, Math.abs(d2) > 0.3 && Math.sign(d2) === -Math.sign(d1), d2);
    // たて混じりの なぞり（はじめに 少し たてに動いてから 横へ）でも 回る
    const h3a = await head();
    {
      const x0 = geo.sl + geo.sw * 0.45, y0 = geo.st + geo.sh * 0.45, base = [[geo.fx, geo.fy, 1]];
      await T('touchStart', base.concat([[x0, y0, 4]]));
      for (let i = 1; i <= 4; i++) { await T('touchMove', base.concat([[x0 + i, y0 + i * 6, 4]])); await sleep(16); }
      for (let i = 1; i <= 12; i++) { await T('touchMove', base.concat([[x0 + 4 + i * geo.sw / 40, y0 + 24, 4]])); await sleep(16); }
      await lift([x0 + 4 + 12 * geo.sw / 40, y0 + 24, 4]); await sleep(60);
    }
    const d3 = wrap((await head()) - h3a);
    ok(`スワイプ ${tag}：はじめに たてへ 動いてから 横へ なぞっても 回る（${(d3 * 180 / Math.PI).toFixed(1)}度）`, Math.abs(d3) > 0.3, d3);
    // 前の指が はなれないまま（のこったまま）でも 新しい指で 回る
    const h4a = await head();
    const STAY = [geo.sl + geo.sw * 0.3, geo.st + geo.sh * 0.3, 5];
    await T('touchStart', [FWD, STAY]); await sleep(30);
    await swipe(geo.sl + geo.sw * 0.5, geo.st + geo.sh * 0.6, geo.sw / 5, 0, [FWD, STAY], 6);
    const d4 = wrap((await head()) - h4a);
    ok(`スワイプ ${tag}：前の指（はなした しらせが とどかない指）が 画面に のこっていても 新しい指の なぞりで 回る（${(d4 * 180 / Math.PI).toFixed(1)}度）`, Math.abs(d4) > 0.3, d4);
    await T('touchEnd', []); await sleep(200);
    const pr2 = await logOf(p, 'World.press');
    ok(`スワイプ ${tag}：さいごに 指を ぜんぶ はなすと すすむも はなれる`, pr2.some((l) => l[1] === 'fwd' && l[2] === false), pr2);
    // 4:3：ステージの 上下の 3D の帯でも なぞれる
    if (geo.st > 20) {
      const h5a = await head();
      await swipe(geo.sl + geo.sw * 0.4, geo.st * 0.5, geo.sw / 4, 0, false, 7);
      const d5 = wrap((await head()) - h5a);
      ok(`スワイプ ${tag}：ステージの上の 3D の帯（y ${Math.round(geo.st * 0.5)}px）で なぞっても 回る（${(d5 * 180 / Math.PI).toFixed(1)}度）`, Math.abs(d5) > 0.3, d5);
      const h6a = await head();
      await T('touchStart', [FWD]); await sleep(100);
      await swipe(geo.sl + geo.sw * 0.4, geo.vh - geo.st * 0.5, geo.sw / 4, 0, true, 8);
      const d6 = wrap((await head()) - h6a);
      ok(`スワイプ ${tag}：ステージの下の 帯でも、すすむを 押しながら 回る（${(d6 * 180 / Math.PI).toFixed(1)}度）`, Math.abs(d6) > 0.3, d6);
      await T('touchEnd', []);
    }
    const ta = await p.evaluate(() => ({ swipe: getComputedStyle(document.getElementById('swipe')).touchAction, wb: getComputedStyle(document.getElementById('worldbox')).touchAction, fwd: getComputedStyle(document.getElementById('fwd')).touchAction }));
    ok(`スワイプ ${tag}：なぞりの面（#swipe・#worldbox）と すすむ は touch-action:none`, ta.swipe === 'none' && ta.wb === 'none' && ta.fwd === 'none', ta);
    // マウスでも（PC）：右へ なぞると（はんたい なので）heading が ふえる
    const h7a = await head();
    await p.mouse.move(geo.sl + geo.sw * 0.4, geo.st + geo.sh * 0.5); await p.mouse.down();
    for (let i = 1; i <= 10; i++) { await p.mouse.move(geo.sl + geo.sw * 0.4 + i * geo.sw / 60, geo.st + geo.sh * 0.5); await sleep(16); }
    await p.mouse.up();
    const d7 = wrap((await head()) - h7a);
    ok(`スワイプ ${tag}：マウスでも 回る・スワイプの向き はんたい（右へ なぞると 左を むく）`, d7 > 0.3, d7);
    if (vp.height === 768) await shot(p, '35swipe_43');
    ok(`エラーなし（スワイプ ${tag}）`, errors.length === 0, errors);
    await context.close();
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
    if (!ONLY || ONLY === 'net' || ONLY === 'leave') await netLeave();
    if (!ONLY || ONLY === 'settings') await settingsFlow();
    if (!ONLY || ONLY === 'title') await titleFlow();
    if (!ONLY || ONLY === 'pick') await pickFlow();
    if (!ONLY || ONLY === 'cam' || ONLY === 'overgem') await overGemFlow();
    if (!ONLY || ONLY === 'swipe') await swipeFlow();
  } catch (e) { ok('例外なく終わる', false, e.stack); }
  if (browser) await browser.close();
  if (server) server.close();
  console.log(results.join('\n'));
  const ng = results.filter((r) => r.startsWith('NG')).length;
  console.log(`\n${results.length - ng} / ${results.length} OK`);
  process.exit(ng ? 1 : 0);
})();
