// ui.js : 「見つけて！PixSee v9.0」の画面と操作。6ステート、ボタン、モーダル、カウントダウン、獲得宣言、擬音、ソナー、スワイプ、全体の配線。
// 公開するのは window.App だけ。World / MapGen / Net / Sfx / SeekerModel が無くても落ちないよう、すべて call() 経由で呼ぶ。
(function () {
  'use strict';

  /* ===== U01. 定数と小さな道具 ===== */
  var VERSION = 'v9.0';
  var INK = '#2b2f3a';
  var CAM_LABEL = ['め', 'おいかけ', 'そら'];      // 視点の名前
  var CAM_GO = ['めへ', 'おいかけへ', 'そらへ'];   // カメラボタンの文字：おすと つぎに なる視点
  var LEVELS = ['easy', 'normal', 'hard'];
  var LEVEL_NAME = { easy: 'やさしい', normal: 'ふつう', hard: 'むずかしい' };
  var KIND_NAME = { race: 'どっちが はやい？', count: 'どっちが おおい？', solo: 'ひとりで れんしゅう' };
  var OPP_NAME = { cpu: 'コンピューター', net: 'ともだち' };
  var DEFAULT_ERR = 'つながらなかったよ。ばんごうを たしかめてね';
  var COUNT_SEC = 600;        // どっちが おおい？ の じかん（10ぷん）
  var SONAR_R = 10;           // ソナーの はんけい（ブロック）
  var SONAR_FAR = 200;        // 円の外の宝の方向を しらべる はんけい
  var CD_STEP = 1.0;          // カウントダウン「3」「2」「1」の ながさ（秒）
  var CD_GO = 0.8;            // 「GO!」の ながさ（秒）
  var ANN_SEC = 3.5;          // 獲得宣言の ながさ（秒）
  var ANN_FAILSAFE = 6.0;     // クライアント：ホストの resume が来なくても ここで解く（秒）
  var READY_FAILSAFE = 10000; // ホスト：クライアントの ready が来なくても カウントダウンを始める（ミリ秒）
  var PLAY_TRACKS = ['play1', 'play2', 'play3'];
  var ONO_TEXT = { jump: 'ビョーン！', drill: 'ゴゴゴゴゴ', bump: 'ガン！', 'break': 'ガラッ' };
  var doc = document;

  function $(id) { return doc.getElementById(id); }
  function call(obj, name) {
    var o = window[obj];
    if (o && typeof o[name] === 'function') {
      try { return o[name].apply(o, Array.prototype.slice.call(arguments, 2)); }
      catch (e) { try { console.warn(obj + '.' + name + ' failed', e); } catch (_) {} }
    }
    return undefined;
  }
  function prop(obj, name) { var o = window[obj]; return o ? o[name] : undefined; }
  function hasFn(obj, name) { var o = window[obj]; return !!(o && typeof o[name] === 'function'); }
  function sfx(name) { call('Sfx', 'play', name); }
  function unlock() { call('Sfx', 'unlock'); }
  function num(v) { return Math.max(0, Math.floor(+v) || 0); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  // 色を明るく（k>0）・暗く（k<0）する
  function shade(hex, k) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex;
    var n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, t = k < 0 ? 0 : 255, p = Math.abs(k);
    r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  var uid = 0; function nid(p) { return p + (++uid); }

  /* ===== U02. 設定と記録（localStorage。読めなくても既定値で動く） ===== */
  var KEY_SET = 'pixsee.settings', KEY_REC = 'pixsee.record';
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  function readJSON(k) { try { var t = lsGet(k); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
  function defaultSettings() { return { swipeRev: false, binary: false, level: 'normal', palette: 0, search: 'light' }; }
  function loadSettings() {
    var d = defaultSettings(), o = readJSON(KEY_SET);
    if (o && typeof o === 'object') {
      if (typeof o.swipeRev === 'boolean') d.swipeRev = o.swipeRev;
      if (typeof o.binary === 'boolean') d.binary = o.binary;
      if (LEVELS.indexOf(o.level) >= 0) d.level = o.level;
      if (typeof o.palette === 'number' && o.palette >= 0 && o.palette <= 9) d.palette = Math.floor(o.palette);
      if (o.search === 'light' || o.search === 'sonar') d.search = o.search;
    }
    return d;
  }
  // 記録：モード（race／count／solo）× あいて（cpu／net）× むずかしさ。me=きみ opp=あいて same=おなじ
  function blank() { return { me: 0, opp: 0, same: 0 }; }
  function cleanR(o) { var r = blank(); if (o && typeof o === 'object') { r.me = num(o.me); r.opp = num(o.opp); r.same = num(o.same); } return r; }
  function defaultRecord() {
    function pair() { return { cpu: { easy: blank(), normal: blank(), hard: blank() }, net: blank() }; }
    return { race: pair(), count: pair(), solo: { n: 0 } };
  }
  function loadRecord() {
    var d = defaultRecord(), o = readJSON(KEY_REC);
    if (o && typeof o === 'object') {
      ['race', 'count'].forEach(function (k) {
        if (!o[k] || typeof o[k] !== 'object') return;
        LEVELS.forEach(function (l) { d[k].cpu[l] = cleanR(o[k].cpu && o[k].cpu[l]); });
        d[k].net = cleanR(o[k].net);
      });
      if (o.solo) d.solo.n = num(o.solo.n);
    }
    return d;
  }
  var settings = defaultSettings(), record = defaultRecord();
  function saveSettings() { lsSet(KEY_SET, JSON.stringify(settings)); }
  function saveRecord() { lsSet(KEY_REC, JSON.stringify(record)); }
  function recOf(kind, o, level) {
    if (kind === 'solo') return record.solo;
    return o === 'net' ? record[kind].net : record[kind].cpu[level];
  }
  // 記録の文（争いの言葉なし）。o='cpu' のときは「コンピューター」、通信は「あいて」
  function recLines(kind, r, o) {
    var who = o === 'cpu' ? OPP_NAME.cpu : 'あいて';
    var sp = String.fromCharCode(160); // 「おおい 0かい」は 折らない（折るのは「…が」のあと）
    if (kind === 'race') return ['きみが さき' + sp + r.me + 'かい', who + 'が さき' + sp + r.opp + 'かい'];
    if (kind === 'count') return ['きみが おおい' + sp + r.me + 'かい', who + 'が おおい' + sp + r.opp + 'かい', 'おなじ' + sp + r.same + 'かい'];
    return ['れんしゅう ' + (r.n || 0) + 'かい'];
  }
  function recTotals() {
    var t = { me: 0, opp: 0, same: 0, all: record.solo.n };
    ['race', 'count'].forEach(function (k) {
      var list = LEVELS.map(function (l) { return record[k].cpu[l]; }).concat([record[k].net]);
      list.forEach(function (r) { t.me += r.me; t.opp += r.opp; t.same += r.same; t.all += r.me + r.opp + r.same; });
    });
    return t;
  }

  /* ===== U03. シーカーの色（10パターン）と宝石（10種類）。本物（SeekerModel / MapGen）が無いときの控え ===== */
  var PAL_FALLBACK = [
    { id: 'orange', name: 'オレンジ', body: '#e08524', accent: '#f6d38c', track: '#5d6673' },
    { id: 'sky', name: 'そらいろ', body: '#2f8be0', accent: '#cfe6ff', track: '#4a5563' },
    { id: 'green', name: 'みどり', body: '#35a35a', accent: '#d9f2c9', track: '#4a5563' },
    { id: 'red', name: 'あか', body: '#d64545', accent: '#ffd9cf', track: '#4a5563' },
    { id: 'purple', name: 'むらさき', body: '#8a5cc7', accent: '#eadcff', track: '#4a5563' },
    { id: 'yellow', name: 'きいろ', body: '#f2c230', accent: '#fff4c4', track: '#5d6673' },
    { id: 'pink', name: 'ピンク', body: '#f07aa8', accent: '#ffe3ee', track: '#5d6673' },
    { id: 'white', name: 'しろ', body: '#f1f1ec', accent: '#c9d0da', track: '#5d6673' },
    { id: 'black', name: 'くろ', body: '#383b44', accent: '#a7adba', track: '#262830' },
    { id: 'brown', name: 'ちゃいろ', body: '#9a6a3e', accent: '#f0d8b4', track: '#4a5563' }
  ];
  function palettes() {
    var p = prop('SeekerModel', 'PALETTES');
    return (p && p.length >= 10) ? p : PAL_FALLBACK;
  }
  function pal(n) {
    var list = palettes(), q = list[clamp(n | 0, 0, list.length - 1)] || PAL_FALLBACK[0], f = PAL_FALLBACK[clamp(n | 0, 0, 9)];
    return { name: q.name || f.name, body: q.body || f.body, accent: q.accent || f.accent, track: q.track || f.track };
  }
  // コンピューターの色：プレイヤーと かぶらない色（見分けやすい順に えらぶ）
  function cpuPalette(mine) { var order = [1, 0, 3, 2, 5, 4, 6, 9, 8, 7]; for (var i = 0; i < order.length; i++) if (order[i] !== mine) return order[i]; return 1; }
  var previewCache = {};
  // 色のプレビュー：SeekerModel.preview(n, size) があれば その絵。なければ（または失敗したら）この中の SVG
  function seekerPic(n, cls) {
    var key = n + '';
    if (previewCache[key] === undefined) {
      var u = '';
      try { u = call('SeekerModel', 'preview', n, 160) || ''; } catch (e) { u = ''; }
      previewCache[key] = (typeof u === 'string' && u.indexOf('data:image') === 0) ? u : '';
    }
    var src = previewCache[key];
    return src ? '<img class="' + (cls || '') + '" alt="" src="' + src + '">' : '<i class="sk ' + (cls || '') + '">' + mascot(pal(n)) + '</i>';
  }
  var GEM_FALLBACK = [
    { id: 'diamond', name: 'ダイヤモンド', color: '#e9f6ff', glow: '#ffffff' },
    { id: 'ruby', name: 'ルビー', color: '#e0115f', glow: '#ff6f9a' },
    { id: 'sapphire', name: 'サファイア', color: '#2456d6', glow: '#7aa6ff' },
    { id: 'emerald', name: 'エメラルド', color: '#12a65c', glow: '#6ff0a8' },
    { id: 'amethyst', name: 'アメシスト', color: '#9b59d0', glow: '#d9b0ff' },
    { id: 'topaz', name: 'トパーズ', color: '#ffae00', glow: '#ffe08a' },
    { id: 'aquamarine', name: 'アクアマリン', color: '#5fd0e6', glow: '#bdf5ff' },
    { id: 'garnet', name: 'ガーネット', color: '#8f1c2e', glow: '#e3657c' },
    { id: 'peridot', name: 'ペリドット', color: '#9acd32', glow: '#dcff8f' },
    { id: 'opal', name: 'オパール', color: '#f4efe6', glow: '#ffd9f2' }
  ];
  function gemOf(gi) {
    var list = prop('MapGen', 'GEMS'), f = GEM_FALLBACK[clamp(gi | 0, 0, 9)];
    var g = (list && list[gi]) || f;
    return { id: g.id || f.id, name: g.name || f.name, color: g.color || f.color, glow: g.glow || f.glow, idx: gi | 0 };
  }

  /* ===== U04. 絵（SVG）：アイソメトリックのブロック、シーカー、ロゴ、アイコン。輪郭の太い線は使わない ===== */
  // ブロック1つ（上面・左面・右面）。(X,Y) は上面の いちばん上の点
  function cube(X, Y, s, c) {
    var w = s * 0.866, h = s * 0.5, top = c.t || shade(c.c, 0.2), l = c.l || c.c, r = c.r || shade(c.c, -0.16);
    function P(a) { return a.map(function (v) { return v.toFixed(1); }).join(' '); }
    return '<path d="M' + P([X, Y]) + 'L' + P([X + w, Y + h]) + 'L' + P([X, Y + 2 * h]) + 'L' + P([X - w, Y + h]) + 'Z" fill="' + top + '"/>' +
      '<path d="M' + P([X - w, Y + h]) + 'L' + P([X, Y + 2 * h]) + 'L' + P([X, Y + 2 * h + s]) + 'L' + P([X - w, Y + h + s]) + 'Z" fill="' + l + '"/>' +
      '<path d="M' + P([X, Y + 2 * h]) + 'L' + P([X + w, Y + h]) + 'L' + P([X + w, Y + h + s]) + 'L' + P([X, Y + 2 * h + s]) + 'Z" fill="' + r + '"/>' +
      '<path d="M' + P([X - w, Y + h]) + 'L' + P([X, Y]) + 'L' + P([X + w, Y + h]) + '" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="' + (s * 0.04).toFixed(2) + '" stroke-linejoin="round"/>';
  }
  var BLK = {
    grass: { t: '#a5dc7a', l: '#e7b27a', r: '#cf9358' },
    dirt: { t: '#efc08c', l: '#e2a96c', r: '#c98e52' },
    orange: { c: '#ff9800' }, sky: { c: '#2a9fd4' }, cream: { t: '#ffffff', l: '#fbf1dc', r: '#eadcbf' },
    gold: { c: '#ffd54f' }, ink: { t: '#5a6070', l: '#3d4250', r: '#2f3340' }, leaf: { t: '#7fd36a', l: '#5fbb52', r: '#4aa443' },
    trunk: { t: '#c08a5a', l: '#a8743f', r: '#8d6034' }, pink: { c: '#ef8aa6' }, mint: { c: '#4fc493' }
  };
  // 島：cells = [[gx,gy,gz,'色'],...]。extra(X,Y) は 上に のせる絵（シーカーや宝石）
  function island(cells, s, extra, haze) {
    var w = s * 0.866, h = s * 0.5, out = '', minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    var list = cells.slice().sort(function (a, b) { return (a[0] + a[1]) - (b[0] + b[1]) || a[2] - b[2] || a[0] - b[0]; });
    list.forEach(function (q) {
      var X = (q[0] - q[1]) * w, Y = (q[0] + q[1]) * h - q[2] * s, c = BLK[q[3]] || BLK.cream;
      if (haze) c = { t: mix(c.t || shade(c.c, 0.2), haze), l: mix(c.l || c.c, haze), r: mix(c.r || shade(c.c, -0.16), haze) };
      out += cube(X, Y, s, c);
      minX = Math.min(minX, X - w); maxX = Math.max(maxX, X + w); minY = Math.min(minY, Y); maxY = Math.max(maxY, Y + 2 * h + s);
    });
    function mix(c, k) { return shade(c, k); }
    var top = { minX: minX, minY: minY, w: w, h: h, s: s };
    var ex = extra ? extra(function (gx, gy, gz) { return { x: (gx - gy) * w, y: (gx + gy) * h - gz * s + h }; }) : '';
    var pad = s * 0.3, vy = minY - (extra ? s * 3.2 : pad);
    return '<svg viewBox="' + (minX - pad).toFixed(1) + ' ' + vy.toFixed(1) + ' ' + (maxX - minX + 2 * pad).toFixed(1) + ' ' + (maxY - vy + pad * 2.2).toFixed(1) + '">' +
      '<ellipse cx="' + ((minX + maxX) / 2).toFixed(1) + '" cy="' + (maxY + pad * 1.2).toFixed(1) + '" rx="' + ((maxX - minX) * 0.36).toFixed(1) + '" ry="' + (s * 0.22).toFixed(1) + '" fill="rgba(43,47,58,' + (haze ? 0.05 : 0.10) + ')"/>' +
      out + ex + '</svg>';
  }
  function slab(nx, ny, kind, z) { var a = []; for (var x = 0; x < nx; x++) for (var y = 0; y < ny; y++) a.push([x, y, z || 0, kind]); return a; }
  // 小さな宝石（島の上で光る）
  function gemMini(x, y, r, col) {
    var g = nid('gm');
    return '<g transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')"><defs><radialGradient id="' + g + '"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></radialGradient></defs>' +
      '<circle r="' + (r * 2.4).toFixed(1) + '" fill="url(#' + g + ')"/>' +
      '<path d="M0 ' + (-r) + 'L' + (r * 0.8) + ' ' + (-r * 0.25) + 'L0 ' + r + 'L' + (-r * 0.8) + ' ' + (-r * 0.25) + 'Z" fill="' + col + '"/>' +
      '<path d="M0 ' + (-r) + 'L' + (r * 0.8) + ' ' + (-r * 0.25) + 'L0 ' + (-r * 0.05) + 'Z" fill="#fff" opacity=".55"/></g>';
  }
  // シーカー（デザイン画：ロールケーキの体、端面の輪と白い穴とピンクの星、黒いバイザーに緑の目、しましまのドリルハット、棒、キャタピラ）
  function mascot(p) {
    p = p || pal(0);
    var body = p.body, acc = p.accent, trk = p.track || '#5d6673';
    var gb = nid('mb'), gc = nid('mc'), gd = nid('md'), cl = nid('mk');
    var dark = shade(body, -0.22), lite = shade(body, 0.28);
    return '<svg viewBox="0 0 124 108"><defs>' +
      '<linearGradient id="' + gb + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + lite + '"/><stop offset=".55" stop-color="' + body + '"/><stop offset="1" stop-color="' + dark + '"/></linearGradient>' +
      '<linearGradient id="' + gc + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + shade(acc, 0.3) + '"/><stop offset="1" stop-color="' + shade(acc, -0.12) + '"/></linearGradient>' +
      '<linearGradient id="' + gd + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + shade(trk, 0.25) + '"/><stop offset="1" stop-color="' + shade(trk, -0.15) + '"/></linearGradient>' +
      '<clipPath id="' + cl + '"><path d="M55 22h34L72 2z"/></clipPath></defs>' +
      '<ellipse cx="62" cy="101" rx="46" ry="5.5" fill="rgba(43,47,58,.16)"/>' +
      '<rect x="18" y="77" width="90" height="20" rx="10" fill="url(#' + gd + ')"/>' +
      '<rect x="22" y="80" width="82" height="3" rx="1.5" fill="rgba(255,255,255,.18)"/>' +
      '<circle cx="36" cy="87.5" r="6.5" fill="' + shade(trk, 0.5) + '"/><circle cx="62" cy="87.5" r="6.5" fill="' + shade(trk, 0.5) + '"/><circle cx="88" cy="87.5" r="6.5" fill="' + shade(trk, 0.5) + '"/>' +
      '<circle cx="36" cy="87.5" r="2.4" fill="' + trk + '"/><circle cx="62" cy="87.5" r="2.4" fill="' + trk + '"/><circle cx="88" cy="87.5" r="2.4" fill="' + trk + '"/>' +
      '<ellipse cx="44" cy="55" rx="23" ry="29" fill="url(#' + gb + ')"/>' +
      '<rect x="44" y="26" width="30" height="58" fill="url(#' + gb + ')"/>' +
      '<path d="M44 30h30" stroke="rgba(255,255,255,.35)" stroke-width="3" stroke-linecap="round"/>' +
      '<ellipse cx="74" cy="55" rx="23" ry="29" fill="url(#' + gc + ')"/>' +
      '<ellipse cx="74" cy="56" rx="14" ry="18.5" fill="#fff"/>' +
      '<path d="M74 45l3.300 6.700 7.400.9-5.400 5.100 1.500 7.300-6.800-3.700-6.800 3.700 1.500-7.300-5.400-5.100 7.400-.9z" fill="#ef6c8f"/>' +
      '<rect x="20" y="45" width="24" height="15" rx="7.5" fill="' + INK + '"/>' +
      '<ellipse cx="28" cy="52.5" rx="3" ry="4.6" fill="#3be8a0"/><ellipse cx="37" cy="52.5" rx="3" ry="4.6" fill="#3be8a0"/>' +
      '<circle cx="27" cy="50.6" r="1.1" fill="#fff"/><circle cx="36" cy="50.6" r="1.1" fill="#fff"/>' +
      '<rect x="69.8" y="19" width="4.4" height="9" rx="2" fill="' + INK + '"/>' +
      '<g clip-path="url(#' + cl + ')"><rect x="50" y="0" width="44" height="24" fill="#2a9fd4"/>' +
      '<path d="M50 20 94 2M50 12 94-6M50 28 94 10" stroke="#ffd54f" stroke-width="4.5"/>' +
      '<path d="M72 2 89 22H72z" fill="rgba(0,0,0,.12)"/></g>' +
      '</svg>';
  }
  function robot() { // コンピューター（だれと？の絵）
    return '<svg viewBox="0 0 124 104"><defs><linearGradient id="rbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe8fa"/><stop offset="1" stop-color="#7cc7ea"/></linearGradient></defs>' +
      '<ellipse cx="62" cy="98" rx="40" ry="5" fill="rgba(43,47,58,.15)"/>' +
      '<rect x="59.500" y="12" width="5" height="16" rx="2.500" fill="' + INK + '"/><circle cx="62" cy="10" r="6.500" fill="#ef6c8f"/>' +
      '<rect x="24" y="26" width="76" height="56" rx="16" fill="url(#rbg)"/>' +
      '<rect x="34" y="38" width="56" height="32" rx="11" fill="' + INK + '"/><ellipse cx="50" cy="54" rx="5" ry="8" fill="#3be8a0"/><ellipse cx="74" cy="54" rx="5" ry="8" fill="#3be8a0"/>' +
      '<rect x="10" y="44" width="14" height="22" rx="7" fill="#ffd54f"/><rect x="100" y="44" width="14" height="22" rx="7" fill="#ffd54f"/>' +
      '<rect x="34" y="82" width="56" height="11" rx="5.500" fill="#6b7480"/></svg>';
  }
  // よみ：7文字以上は まん中で 2行に わける（小さい「ゃゅょっ」の前では わけない）。横に つぶさない
  function setYomi(el, t) {
    el.textContent = '';
    if (t.length < 7) { el.textContent = t; el.classList.remove('two'); return; }
    var k = Math.floor(t.length / 2);
    while (k < t.length - 1 && /[ゃゅょっぁぃぅぇぉャュョッァィゥェォー]/.test(t.charAt(k))) k++;
    el.appendChild(doc.createTextNode(t.slice(0, k))); el.appendChild(doc.createElement('br')); el.appendChild(doc.createTextNode(t.slice(k)));
    el.classList.add('two');
  }
  function nest(svg, x, y, w, h) { return svg.replace('<svg viewBox', '<svg x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" viewBox'); }
  function inner(svg) { return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, ''); }
  // 宝石（ファセットのある形。輪郭線なし。色の明暗で立体に）
  function gemSvg(col, glow) {
    col = col || '#2a9fd4';
    var hi = shade(col, 0.45), mid = col, lo = shade(col, -0.25), g = nid('gg');
    return '<svg viewBox="0 0 24 24"><defs><radialGradient id="' + g + '"><stop offset="0" stop-color="' + (glow || hi) + '" stop-opacity=".9"/><stop offset="1" stop-color="' + (glow || hi) + '" stop-opacity="0"/></radialGradient></defs>' +
      (glow ? '<circle cx="12" cy="12" r="12" fill="url(#' + g + ')"/>' : '') +
      '<path d="M12 21.500 2.800 9 6.500 3.500h11L21.200 9z" fill="' + mid + '"/>' +
      '<path d="M2.800 9h18.400L12 21.500z" fill="' + lo + '"/>' +
      '<path d="M6.500 3.500 9 9h6l2.500-5.500z" fill="' + hi + '"/>' +
      '<path d="M9 9l3 12.500L15 9z" fill="' + shade(col, 0.15) + '"/>' +
      '<path d="M7.500 5.200l1.300 2.300" stroke="#fff" stroke-width="1.200" stroke-linecap="round" opacity=".9"/></svg>';
  }
  // 宝石（宣言用の大きな絵）。ダイヤモンドは虹、オパールは遊色
  function bigGem(gm) {
    var g = nid('bg'), r = nid('br'), cols;
    if (gm.id === 'diamond') cols = ['#ffffff', '#d9f1ff', '#ffe3f4', '#e6ffe0', '#fff6cf'];
    else if (gm.id === 'opal') cols = ['#fbf6ee', '#d8f3ff', '#ffd8ef', '#e3ffd8', '#fff1c8'];
    else cols = [shade(gm.color, 0.55), shade(gm.color, 0.2), gm.color, shade(gm.color, -0.18), shade(gm.color, -0.32)];
    return '<svg viewBox="-20 -20 140 140"><defs><radialGradient id="' + r + '"><stop offset="0" stop-color="' + gm.glow + '" stop-opacity=".95"/><stop offset=".6" stop-color="' + gm.glow + '" stop-opacity=".25"/><stop offset="1" stop-color="' + gm.glow + '" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="' + g + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + cols[0] + '"/><stop offset="1" stop-color="' + cols[3] + '"/></linearGradient></defs>' +
      '<circle cx="50" cy="52" r="68" fill="url(#' + r + ')"/>' +
      '<path d="M50 94 6 36 24 12h52l18 24z" fill="url(#' + g + ')"/>' +
      '<path d="M6 36h88L50 94z" fill="' + cols[3] + '"/>' +
      '<path d="M24 12l12 24h28l12-24z" fill="' + cols[0] + '"/>' +
      '<path d="M36 36l14 58 14-58z" fill="' + cols[1] + '"/>' +
      '<path d="M6 36 24 12l12 24zM94 36 76 12 64 36z" fill="' + cols[2] + '"/>' +
      '<path d="M6 36l30 0 14 58z" fill="' + cols[4] + '" opacity=".55"/>' +
      '<path d="M28 18l6 11" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".9"/>' +
      '<circle cx="78" cy="22" r="3" fill="#fff" opacity=".9"/></svg>';
  }
  // ロゴ「見つけて！PixSee」：立体の文字（厚み）＋ やわらかい影。輪郭は白いふちだけ
  function logoHTML() {
    var L = [['P', '#ff9800'], ['i', '#2a9fd4'], ['x', '#ffc928'], ['S', '#ef6c8f'], ['e', '#3dbb85'], ['e', '#ff9800']];
    function tsp(dark) { return L.map(function (l) { return '<tspan fill="' + (dark ? shade(l[1], -0.3) : l[1]) + '">' + l[0] + '</tspan>'; }).join(''); }
    var depth = '', base = 196, TL = 'textLength="452" lengthAdjust="spacingAndGlyphs"';
    for (var k = 7; k >= 1; k--) depth += '<text x="292" y="' + (base + k * 2.2).toFixed(1) + '" ' + TL + '>' + tsp(true) + '</text>';
    var pg = nid('lp');
    return '<svg class="logo" viewBox="0 0 640 250" role="img" aria-label="見つけて！PixSee">' +
      '<defs><linearGradient id="' + pg + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fb8e6"/><stop offset="1" stop-color="#1f8fc4"/></linearGradient></defs>' +
      '<ellipse cx="300" cy="232" rx="230" ry="12" fill="rgba(43,47,58,.10)"/>' +
      '<g class="lg-pill"><rect x="168" y="12" width="250" height="62" rx="31" fill="#14699a"/><rect x="168" y="6" width="250" height="62" rx="31" fill="url(#' + pg + ')"/>' +
      '<rect x="186" y="12" width="214" height="8" rx="4" fill="rgba(255,255,255,.28)"/>' +
      '<text x="293" y="50" text-anchor="middle" font-size="38" font-weight="800" fill="#fff" letter-spacing="2">見つけて！</text></g>' +
      '<g class="lg-letters" font-family="inherit" font-weight="900" font-size="150" text-anchor="middle">' +
      '<text x="292" y="' + (base + 16) + '" ' + TL + ' fill="#fff" stroke="#fff" stroke-width="26" stroke-linejoin="round">PixSee</text>' +
      '<text x="292" y="' + base + '" ' + TL + ' fill="#fff" stroke="#fff" stroke-width="26" stroke-linejoin="round">PixSee</text>' +
      depth +
      '<text x="292" y="' + base + '" ' + TL + '>' + tsp(false) + '</text>' +
      '</g>' +
      // マスコット：文字の列から はなして 右上（「見つけて！」の となり）に のせる。目とキャタピラのある 乗りもの
      nest(mascot(pal(0)), 434, 0, 112, 97.5) +
      '</svg>';
  }
  var ICON = { // 進行ボタンのアイコン（文字の色）
    play: '<svg viewBox="0 0 24 24"><path d="M7 4.200c0-1 1.100-1.600 1.900-1.100l11 7.300c.8.500.8 1.700 0 2.200l-11 7.300C8.100 20.400 7 19.800 7 18.800z"/></svg>',
    go: '<svg viewBox="0 0 24 24"><path d="M3 5.200c0-.9 1-1.400 1.700-.9L12 9.600V5.200c0-.9 1-1.400 1.700-.9l8 6c.6.500.6 1.400 0 1.900l-8 6c-.7.500-1.700 0-1.700-.9v-4.400l-7.300 5.300C4 18.200 3 17.700 3 16.800z"/></svg>',
    again: '<svg viewBox="0 0 24 24"><path d="M12 4V1.500c0-.5-.6-.8-1-.4L7 4.800c-.3.300-.3.700 0 1l4 3.700c.4.400 1 .1 1-.4V7a5.500 5.500 0 1 1-5.500 5.500c0-.8-.7-1.500-1.500-1.500S3.500 11.700 3.500 12.500A8.500 8.500 0 1 0 12 4z"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="3.500"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M12 3.200c.4 0 .7.100 1 .4l8.400 7.600c.6.600.2 1.600-.6 1.600H19v7c0 .7-.6 1.200-1.200 1.200h-3.600v-5.500h-4.400V21H6.200C5.600 21 5 20.500 5 19.800v-7H3.200c-.8 0-1.200-1-.6-1.600L11 3.600c.3-.3.600-.4 1-.4z"/></svg>',
    link: '<svg viewBox="0 0 24 24"><circle cx="5.500" cy="12" r="4"/><circle cx="18.500" cy="12" r="4"/><rect x="8" y="10.500" width="8" height="3" rx="1.500"/></svg>',
    pic: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="3.500" fill="#ffd54f"/><circle cx="8" cy="10" r="2.400" fill="#ef6c8f"/><path d="M4 19l5.500-5.500 4 4 3-3L21 19z" fill="#2a9fd4"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><path d="M19.400 13a7.500 7.500 0 0 0 0-2l2.100-1.600-2-3.500-2.500 1a7.500 7.500 0 0 0-1.700-1L14.900 3h-4l-.4 2.900a7.500 7.500 0 0 0-1.700 1l-2.500-1-2 3.500L6.400 11a7.500 7.500 0 0 0 0 2l-2.100 1.600 2 3.500 2.500-1a7.500 7.500 0 0 0 1.700 1l.4 2.900h4l.4-2.900a7.500 7.500 0 0 0 1.700-1l2.500 1 2-3.500zM12.900 15.500a3.500 3.500 0 1 1 0-7 3.500 3.500 0 0 1 0 7z"/></svg>'
  };
  // 部品の絵（操作ボタン・設定）：塗りの面と明暗だけ。線の太いふちは使わない
  var SETICO = {
    fwd: '<svg viewBox="0 0 48 56"><path d="M24 3c1 0 1.900.400 2.500 1.200l12 15c1.200 1.500.1 3.800-1.900 3.800H31v8H17v-8h-5.600c-2 0-3.100-2.300-1.900-3.800l12-15C22.100 3.400 23 3 24 3z" fill="#fff"/><path d="M12 38l12-9 12 9M12 50l12-9 12 9" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/></svg>',
    jump: '<svg viewBox="0 0 64 64"><rect x="12" y="55" width="40" height="6" rx="3" fill="#c79a1a" opacity=".55"/>' +
      '<path d="M22 52 42 47 22 42 42 37 22 32" fill="none" stroke="#8a6a00" stroke-width="4.500" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M32 3c.9 0 1.700.400 2.300 1.100l11 12.500c1.100 1.300.2 3.400-1.600 3.400H39v8.500c0 1.100-.9 2-2 2H27c-1.100 0-2-.9-2-2V20h-4.700c-1.800 0-2.700-2.100-1.600-3.400l11-12.500C30.300 3.400 31.100 3 32 3z" fill="' + INK + '"/></svg>',
    attack: '<svg viewBox="0 0 64 64"><rect x="44" y="12" width="17" height="40" rx="3.500" fill="#e2a96c"/><rect x="44" y="12" width="17" height="6" rx="3" fill="#efc08c"/><path d="M44 31h17M52.500 12v19M52.500 31v21" stroke="#c98e52" stroke-width="2"/>' +
      '<path d="M3 32 38 15v34z" fill="#2a9fd4"/><path d="M3 32 38 15v17z" fill="#5cc0ec"/><path d="M14 38 26 22M21 42 33 27M28 46 36 36" stroke="#ffd54f" stroke-width="3.500" stroke-linecap="round"/>' +
      '<path d="M41 6 44 1M51 6V0M59 8l4-4" stroke="#1a6baf" stroke-width="3" stroke-linecap="round"/></svg>',
    jumpdrill: '<svg viewBox="0 0 64 64"><rect x="4" y="52" width="56" height="10" rx="3.500" fill="#e2a96c"/><rect x="4" y="52" width="56" height="4" rx="2" fill="#efc08c"/><path d="M22 52v10M42 52v10" stroke="#c98e52" stroke-width="2"/>' +
      '<path d="M18 22h28L32 54z" fill="#2a9fd4"/><path d="M18 22h14v32z" fill="#5cc0ec"/><path d="M23 29 41 25M27 38 38 35" stroke="#ffd54f" stroke-width="3.500" stroke-linecap="round"/>' +
      '<path d="M10 18A24 22 0 0 1 54 18" fill="none" stroke="#b83a5c" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M46 8 57 17 43 21z" fill="#b83a5c"/></svg>',
    swipe: '<svg viewBox="0 0 48 48"><path d="M5 24h38M13 15 5 24l8 9M35 15l8 9-8 9" fill="none" stroke="#2a9fd4" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="24" r="7" fill="#ff9800"/></svg>',
    bw: '<svg viewBox="0 0 48 48"><rect x="3" y="6" width="42" height="36" rx="7" fill="#fff"/><path d="M24 6h14a7 7 0 0 1 7 7v22a7 7 0 0 1-7 7H24z" fill="' + INK + '"/><circle cx="14" cy="18" r="4" fill="' + INK + '"/><path d="M8 36l8-8 5 5" fill="none" stroke="' + INK + '" stroke-width="3.500" stroke-linecap="round"/><rect x="3" y="6" width="42" height="36" rx="7" fill="none" stroke="#d8cdb8" stroke-width="2"/></svg>',
    trophy: '<svg viewBox="0 0 48 48"><path d="M14 5h20v14a10 10 0 0 1-20 0z" fill="#ffd54f"/><path d="M14 9H7c0 8 3 12 8 13M34 9h7c0 8-3 12-8 13" fill="none" stroke="#f5bf1f" stroke-width="3.500" stroke-linecap="round"/><rect x="21" y="28" width="6" height="9" fill="#f5a623"/><rect x="13" y="37" width="22" height="7" rx="2.500" fill="#ff9800"/><path d="M18 8v9" stroke="#fff" stroke-width="2.500" stroke-linecap="round" opacity=".7"/></svg>',
    clock: '<svg viewBox="0 0 48 48"><circle cx="24" cy="26" r="19" fill="#2a9fd4"/><circle cx="24" cy="26" r="14.500" fill="#fff"/><path d="M24 16v11l7 4" fill="none" stroke="' + INK + '" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><rect x="17" y="2" width="14" height="5" rx="2.500" fill="#2a9fd4"/></svg>',
    palette: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="#ffe0b2"/><circle cx="15" cy="18" r="5" fill="#ff9800"/><circle cx="26" cy="12" r="5" fill="#2a9fd4"/><circle cx="35" cy="21" r="5" fill="#3dbb85"/><circle cx="32" cy="33" r="5" fill="#ef6c8f"/><circle cx="17" cy="31" r="5" fill="#9b6fd6"/></svg>',
    search: '<svg viewBox="0 0 48 48"><circle cx="20" cy="20" r="13" fill="#e3f4fc"/><circle cx="20" cy="20" r="13" fill="none" stroke="#2a9fd4" stroke-width="5"/><path d="M30 30l11 11" stroke="#ff9800" stroke-width="7" stroke-linecap="round"/><path d="M14 16a7 7 0 0 1 6-4" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none"/></svg>',
    beam: '<svg viewBox="0 0 48 48"><defs><linearGradient id="bmg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3b0" stop-opacity="0"/><stop offset="1" stop-color="#ffd54f"/></linearGradient></defs><path d="M17 2h14l4 38H13z" fill="url(#bmg)"/><path d="M9 38l15-7 15 7-15 7z" fill="#e2a96c"/><path d="M24 31l15 7-15 7z" fill="#c98e52"/>' + inner(gemSvg('#2a9fd4')).replace('<defs>', '<g transform="translate(15 20) scale(.75)"><defs>') + '</g></svg>',
    sonar: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="#1d4e63"/><circle cx="24" cy="24" r="13" fill="none" stroke="#7fd6f5" stroke-width="2" stroke-dasharray="3 4"/><path d="M24 24 24 3A21 21 0 0 1 43 15z" fill="#7fd6f5" opacity=".35"/><circle cx="33" cy="15" r="4" fill="#ffd54f"/><path d="M24 17l5 11-5-3-5 3z" fill="#ff9800"/></svg>',
    gem: gemSvg('#2a9fd4')
  };
  // むずかしさの絵：かめ・うさぎ・ロケット（面の明暗だけ）
  var LVPIC = {
    easy: '<svg viewBox="0 0 64 64"><ellipse cx="30" cy="48" rx="24" ry="4" fill="rgba(43,47,58,.12)"/><rect x="15" y="40" width="9" height="10" rx="4" fill="#79c98d"/><rect x="35" y="40" width="9" height="10" rx="4" fill="#79c98d"/><circle cx="53" cy="34" r="8" fill="#8fdba2"/><circle cx="55.500" cy="32" r="2" fill="' + INK + '"/><path d="M10 40c0-12 9-20 20-20s20 8 20 20z" fill="#3dbb85"/><path d="M18 40c0-8 5-14 12-14s12 6 12 14" fill="#5fd3a0"/><path d="M30 26v14M21 33h18" stroke="#2c9a6a" stroke-width="2.500" stroke-linecap="round"/></svg>',
    normal: '<svg viewBox="0 0 64 64"><ellipse cx="33" cy="60" rx="17" ry="3" fill="rgba(43,47,58,.12)"/><ellipse cx="25" cy="18" rx="5.500" ry="14" fill="#fff"/><ellipse cx="25" cy="19" rx="2.500" ry="10" fill="#ffc6d4"/><ellipse cx="41" cy="18" rx="5.500" ry="14" fill="#fff"/><ellipse cx="41" cy="19" rx="2.500" ry="10" fill="#ffc6d4"/><circle cx="33" cy="42" r="17" fill="#fff"/><circle cx="27" cy="39" r="2.600" fill="' + INK + '"/><circle cx="39" cy="39" r="2.600" fill="' + INK + '"/><ellipse cx="33" cy="45" rx="2.600" ry="2" fill="#ef6c8f"/><circle cx="22" cy="46" r="3" fill="#ffc6d4" opacity=".7"/><circle cx="44" cy="46" r="3" fill="#ffc6d4" opacity=".7"/></svg>',
    hard: '<svg viewBox="0 0 64 64"><path d="M26 44h12l-6 17z" fill="#ffd54f"/><path d="M28.500 44h7l-3.500 10z" fill="#ff9800"/><path d="M22 34 11 47l11-3zM42 34l11 13-11-3z" fill="#ff9800"/><path d="M32 3c10 8 13 21 10 37H22C19 24 22 11 32 3z" fill="#fff"/><path d="M32 3c10 8 13 21 10 37h-10z" fill="#e8edf3"/><circle cx="32" cy="24" r="6.500" fill="#2a9fd4"/><circle cx="30" cy="22" r="2" fill="#fff"/></svg>'
  };
  // 見本（イラスト）の小さな絵
  var ILLUST = {
    'いえ': '<svg viewBox="0 0 48 48"><path d="M24 6 5 24h6v18h26V24h6z" fill="none" stroke="' + INK + '" stroke-width="4" stroke-linejoin="round"/><rect x="20" y="28" width="8" height="14" fill="' + INK + '"/></svg>',
    'さかな': '<svg viewBox="0 0 48 48"><path d="M5 24c8-12 22-12 30 0-8 12-22 12-30 0zM35 24l9-9v18z" fill="none" stroke="' + INK + '" stroke-width="4" stroke-linejoin="round"/><circle cx="14" cy="22" r="2.500" fill="' + INK + '"/></svg>',
    'くるま': '<svg viewBox="0 0 48 48"><path d="M4 32v-8l6-2 6-8h16l6 8 6 2v8z" fill="none" stroke="' + INK + '" stroke-width="4" stroke-linejoin="round"/><circle cx="14" cy="34" r="5" fill="#fff" stroke="' + INK + '" stroke-width="4"/><circle cx="34" cy="34" r="5" fill="#fff" stroke="' + INK + '" stroke-width="4"/></svg>',
    'はな': '<svg viewBox="0 0 48 48"><circle cx="24" cy="14" r="7" fill="none" stroke="' + INK + '" stroke-width="3.500"/><circle cx="14" cy="22" r="7" fill="none" stroke="' + INK + '" stroke-width="3.500"/><circle cx="34" cy="22" r="7" fill="none" stroke="' + INK + '" stroke-width="3.500"/><circle cx="24" cy="24" r="4" fill="' + INK + '"/><path d="M24 30v14" stroke="' + INK + '" stroke-width="4"/></svg>',
    'ほし': '<svg viewBox="0 0 48 48"><path d="M24 4l6 14 14 1-11 9 4 14-13-8-13 8 4-14L4 19l14-1z" fill="none" stroke="' + INK + '" stroke-width="4" stroke-linejoin="round"/></svg>',
    'ロケット': '<svg viewBox="0 0 48 48"><path d="M24 4c7 6 9 16 7 28H17C15 20 17 10 24 4z" fill="none" stroke="' + INK + '" stroke-width="4" stroke-linejoin="round"/><circle cx="24" cy="19" r="4" fill="' + INK + '"/><path d="M17 26 9 38l8-2M31 26l8 12-8-2M20 38l4 8 4-8" fill="none" stroke="' + INK + '" stroke-width="3.500" stroke-linejoin="round"/></svg>'
  };
  // 選択画面の大きな絵（ジオラマ：ブロックの島の上のシーカーと宝石）
  var ART = {
    race: function () {
      return '<svg viewBox="0 0 200 110">' + nest(island(slab(3, 2, 'grass').concat([[2, 0, 1, 'orange'], [2, 1, 1, 'sky']]), 20), 6, 30, 120, 78) +
        nest(mascot(pal(settings.palette)), 22, 10, 56, 48) + nest(mascot(pal(cpuPalette(settings.palette))), 66, 30, 50, 43) +
        '<path d="M124 64h22m-7-7 7 7-7 7" stroke="#2a9fd4" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
        nest(island([[0, 0, 0, 'gold'], [1, 0, 0, 'cream'], [0, 1, 0, 'cream']], 16), 146, 50, 50, 44) + gemMini(170, 44, 9, '#2a9fd4') + '</svg>';
    },
    count: function () {
      var g = '', cols = ['#2a9fd4', '#ffc928', '#ef6c8f', '#3dbb85', '#ff9800', '#9b59d0', '#5fd0e6', '#e0115f', '#9acd32', '#f4efe6'];
      for (var r = 0; r < 2; r++) for (var i = 0; i < 5; i++) g += gemMini(28 + i * 36 + (r ? 18 : 0), 32 + r * 40, 10, cols[r * 5 + i]);
      return '<svg viewBox="0 0 200 110">' + g + '</svg>';
    },
    solo: function () {
      return '<svg viewBox="0 0 200 110">' + nest(island(slab(3, 3, 'grass').concat([[0, 2, 1, 'cream'], [2, 2, 1, 'orange']]), 18), 30, 26, 130, 84) +
        nest(mascot(pal(settings.palette)), 60, 8, 64, 56) + gemMini(158, 34, 10, '#ffc928') + '</svg>';
    },
    cpu: function () { return '<svg viewBox="0 0 200 110">' + nest(robot(), 56, 6, 88, 74) + nest(island(slab(4, 2, 'cream'), 14), 50, 74, 100, 34) + '</svg>'; },
    friends: function () {
      return '<svg viewBox="0 0 200 110">' + nest(island(slab(4, 3, 'grass'), 16), 30, 44, 140, 66) +
        nest(mascot(pal(settings.palette)), 30, 10, 76, 64) + nest(mascot(pal(cpuPalette(settings.palette))), 96, 10, 76, 64) + '</svg>';
    },
    host: function () {
      return '<svg viewBox="0 0 200 110">' + nest(island(slab(3, 3, 'grass').concat([[0, 0, 1, 'orange'], [1, 0, 1, 'orange'], [0, 1, 1, 'orange'], [0, 0, 2, 'gold']]), 18), 40, 14, 120, 92) + '</svg>';
    },
    join: function () {
      return '<svg viewBox="0 0 200 110">' + nest(island(slab(3, 2, 'grass'), 18), 70, 40, 110, 66) + nest(mascot(pal(settings.palette)), 92, 10, 66, 56) +
        '<path d="M24 66h40m-12-12 12 12-12 12" stroke="#ff9800" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
  };
  // カメラの絵
  function camIcon(m, p) {
    if (m === 0) return '<svg viewBox="0 0 48 48"><path d="M3 24C10 12 38 12 45 24 38 36 10 36 3 24z" fill="#fff"/><path d="M3 24C10 12 38 12 45 24" fill="none" stroke="#c9d6e0" stroke-width="2"/><circle cx="24" cy="24" r="9" fill="#3be8a0"/><circle cx="24" cy="24" r="4.500" fill="' + INK + '"/><circle cx="21" cy="21" r="2.400" fill="#fff"/></svg>';
    if (m === 1) return mascot(p);
    return '<svg viewBox="0 0 48 48"><rect x="4" y="6" width="40" height="36" rx="7" fill="#e3f4fc"/><path d="M4 19h22v10h18M17 6v13M31 29v13" stroke="#8cc8e6" stroke-width="3.500" fill="none"/><rect x="9" y="30" width="9" height="9" rx="2.500" fill="' + p.body + '"/><circle cx="37" cy="14" r="4" fill="#ffd54f"/></svg>';
  }
  var SAD = '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#ffd54f"/><circle cx="22" cy="27" r="3.500" fill="' + INK + '"/><circle cx="42" cy="27" r="3.500" fill="' + INK + '"/><path d="M21 45q11-9 22 0" stroke="' + INK + '" stroke-width="4" fill="none" stroke-linecap="round"/></svg>';
  var HAPPY = '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#8fdba2"/><circle cx="22" cy="27" r="3.500" fill="' + INK + '"/><circle cx="42" cy="27" r="3.500" fill="' + INK + '"/><path d="M20 38q12 11 24 0" stroke="' + INK + '" stroke-width="4" fill="none" stroke-linecap="round"/></svg>';

  // 背景の島（遠い島はかすむ。ゆっくり上下に漂う）
  var ISLES = [
    { x: 3, y: 5, w: 18, far: 0.55, d: 11, cells: function () { return slab(2, 2, 'grass').concat([[0, 0, 1, 'sky']]); } },
    { x: 148, y: 4, w: 20, far: 0.5, d: 12, cells: function () { return slab(3, 2, 'grass').concat([[0, 0, 1, 'orange'], [0, 1, 1, 'cream']]); } },
    { x: 26, y: 24, w: 11, far: 0.68, d: 13, cells: function () { return slab(2, 1, 'grass').concat([[1, 0, 1, 'gold']]); } },
    { x: 142, y: 30, w: 12, far: 0.68, d: 10, cells: function () { return slab(1, 2, 'grass').concat([[0, 0, 1, 'pink']]); } }
  ];
  function buildIsles() {
    var box = $('isles'); if (!box) return;
    var h = '';
    ISLES.forEach(function (s, i) {
      h += '<i class="isle far" style="left:' + s.x + 'cqmin;top:' + s.y + 'cqmin;width:' + s.w + 'cqmin;animation-duration:' + s.d + 's;animation-delay:-' + (i * 2.3).toFixed(1) + 's">' + island(s.cells(), 20, null, s.far) + '</i>';
    });
    box.innerHTML = h;
  }
  // タイトルの左右の島（シーカーが乗っている）
  function buildHeroIsles() {
    var me = settings.palette, other = cpuPalette(me);
    var l = $('hero-l'), r = $('hero-r');
    if (l) l.innerHTML = island(slab(3, 3, 'grass').concat([[2, 0, 1, 'orange'], [2, 0, 2, 'gold'], [0, 0, 1, 'sky'], [1, 0, 1, 'cream']]), 20,
      function (at) { var p = at(1, 2, 0); return nest(mascot(pal(me)), (p.x - 33).toFixed(1), (p.y - 54).toFixed(1), 66, 57.5); });
    if (r) r.innerHTML = island(slab(3, 3, 'grass').concat([[0, 0, 1, 'sky'], [0, 0, 2, 'cream'], [2, 0, 1, 'gold'], [0, 1, 1, 'pink']]), 20,
      function (at) { var p = at(2, 2, 0), g = at(0, 0, 2); return nest(mascot(pal(other)), (p.x - 33).toFixed(1), (p.y - 54).toFixed(1), 66, 57.5) + gemMini(g.x, g.y - 20, 9, '#ef6c8f'); });
  }

  /* ===== U05. 状態 ===== */
  var state = 'boot', sub = 'how';
  var gameMode = 'solo';          // 'race' | 'count' | 'solo'
  var opp = '';                   // 'cpu' | 'net' | ''
  var netRole = '', netOn = false, netTok = 0, netConnected = false, joined = false;
  var code = '', remotePal = null, netPals = null, netSearch = null;
  var sel = null, loading = false;
  var map = null, myIndex = 0, camMode = 1, running = false, modalOpen = false, isPaused = false;
  var pressed = {}, guard = false, hostRetry = 0, recorded = false, ended = false, modalKind = 'quit', sw = null, tipTimer = 0, endTimer = 0, readyTimer = 0;
  var navKey = '', noticeTimer = 0;
  var remotePaused = false, sentPause = false; // 通信：ともだちが ホームのモーダルを開いている／自分が止めたことを 知らせたか
  var timeLeft = COUNT_SEC, shownSec = -1, scores = [0, 0], totalTreasure = 1;
  var lastT = 0, rafId = 0, curLevel = 'normal';
  // プレイの段階：'wait'（通信のそろい待ち）| 'count'（3・2・1・GO!）| 'run' | 'announce'（獲得宣言）| 'end'
  var phase = 'idle', cdT = 0, cdStep = -1, counting = false;
  var elapsed = 0, raceTime = null, winner = -1;
  var owners = {}, announced = {}, annQueue = [], ann = null;
  var onoSide = 0, myPal = 0, oppPal = 1;
  var bootReady = false;
  var els = {};

  /* ===== U06. ボタンの共通の登録（すべて e.stopPropagation(); e.preventDefault();） ===== */
  function stopEv(e) { e.stopPropagation(); e.preventDefault(); }
  function tap(el, fn) {
    var armed = false;
    el.addEventListener('pointerdown', function (e) { e.stopPropagation(); e.preventDefault(); armed = true; el.classList.add('down'); unlock(); });
    el.addEventListener('pointerup', function (e) {
      e.stopPropagation(); e.preventDefault();
      var was = armed; armed = false; el.classList.remove('down');
      if (was) { sfx('tap'); fn(e); }
    });
    function off(e) { e.stopPropagation(); e.preventDefault(); armed = false; el.classList.remove('down'); }
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('click', stopEv);
    el.addEventListener('contextmenu', stopEv);
  }
  function setBtnDown(act, on) {
    var list = doc.querySelectorAll('[data-act="' + act + '"]');
    for (var i = 0; i < list.length; i++) list[i].classList.toggle('down', on);
  }
  function press(act, on) {
    if (!!pressed[act] === on) return;
    pressed[act] = on;
    setBtnDown(act, on);
    call('World', 'press', act, on);
  }
  function releaseAll() { Object.keys(pressed).forEach(function (a) { if (pressed[a]) press(a, false); }); }
  function inputLocked() { return modalOpen || isPaused || ended || phase !== 'run'; }
  // 押している間だけ効く操作ボタン（すすむ・ドリルアタック・ジャンプドリル。ジャンプも同じ部品で、World が押した瞬間だけ使う）
  function hold(el, act) {
    var pid = null;
    el.addEventListener('pointerdown', function (e) {
      e.stopPropagation(); e.preventDefault(); unlock();
      if (inputLocked()) return;
      pid = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      press(act, true);
    });
    function up(e) { e.stopPropagation(); e.preventDefault(); if (pid === null || e.pointerId === pid) { pid = null; press(act, false); } }
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', function (e) { if (pid !== null && e.pointerId === pid) { pid = null; press(act, false); } });
    el.addEventListener('click', stopEv);
    el.addEventListener('contextmenu', stopEv);
  }

  function buildLogos() {
    var list = doc.querySelectorAll('[data-logo]');
    for (var i = 0; i < list.length; i++) list[i].innerHTML = logoHTML();
  }

  /* ===== U07. 進行ボタン #nav ===== */
  function navItems() {
    if (state === 'title') return [
      { label: 'はじめる', icon: 'play', kind: 'primary hero', fn: startHow },
      { brk: true },
      { label: 'せってい', icon: 'gear', kind: 'secondary sub', fn: openSettings }];
    if (state === 'setting') {
      if (sub === 'pick' && sel && !loading) return [{ label: 'しゅっぱつ！', icon: 'go', kind: 'primary', fn: depart }];
      if (sub === 'keypad' && code.length === 4) return [{ label: 'つなぐ！', icon: 'link', kind: 'primary', fn: doJoin }];
      if (sub === 'error') return [{ label: 'もういちど', icon: 'again', kind: 'primary', fn: retry }];
      return [];
    }
    if (state === 'ending') return [
      { label: 'もういちど', icon: 'again', kind: 'primary', fn: again },
      { label: 'おわる', icon: 'stop', kind: 'secondary', fn: function () { go('quit'); } }];
    if (state === 'quit') return [{ label: 'はじめから', icon: 'home', kind: 'primary', fn: function () { resetGame(); } }];
    return [];
  }
  function renderNav() {
    var items = navItems();
    var key = state + '|' + sub + '|' + items.map(function (i) { return i.label || '-'; }).join('/');
    if (key === navKey) return;
    navKey = key;
    els.nav.innerHTML = '';
    items.forEach(function (it) {
      if (it.brk) { var br = doc.createElement('div'); br.className = 'brk'; els.nav.appendChild(br); return; }
      var b = doc.createElement('button');
      b.type = 'button'; b.tabIndex = -1; b.className = 'nbtn ' + it.kind;
      b.innerHTML = '<i>' + ICON[it.icon] + '</i><span>' + it.label + '</span>';
      b.setAttribute('data-nav', it.label);
      tap(b, it.fn);
      els.nav.appendChild(b);
    });
  }

  /* ===== U08. 画面遷移（BGM もここで切り替える） ===== */
  function go(name) {
    var from = state;
    clearTimeout(endTimer); doc.body.classList.remove('endwait');
    if (from === 'play' && name !== 'play') { releaseAll(); leavePlayFx(); remotePaused = false; sentPause = false; if (els.waitnote) els.waitnote.classList.remove('on'); }
    if (name === 'title' || name === 'quit') { stopGame(); closeNet(); gameMode = 'solo'; opp = ''; sel = null; loading = false; hideNotice(); }
    if (name === 'ending') stopGame();
    state = name;
    doc.body.setAttribute('data-state', name);
    if (name !== 'setting') sub = 'how';
    if (from === 'play' && name !== 'play') { sw = null; hideTip(); }
    if (name === 'title') { renderRecChip(); buildHeroIsles(); }
    // BGM：タイトルと設定は 'title'。プレイは GO! まで鳴らさない。結果はジングル。Quit は全部止める
    if (name === 'title' || name === 'setting') call('Sfx', 'bgm', 'title');
    else if (name === 'play' || name === 'ending') call('Sfx', 'bgm', null);
    else if (name === 'quit') call('Sfx', 'stopAll');
    if (name === 'ending') fillEnding.apply(null, [].slice.call(arguments, 1));
    if (from === 'play' && name !== 'play') applyPause(); // ともだちの一時停止は プレイの外へは もちこまない
    renderNav();
  }
  function leavePlayFx() {
    counting = false; phase = 'idle'; ann = null; annQueue = [];
    doc.body.classList.remove('counting', 'announcing', 'frozen', 'camtop');
    call('Sfx', 'engine', 'idle', 0);
    clearOno();
  }

  var HEADS = { how: 'あそびかたを えらんでね', who: 'だれと あそぶ？', choice: 'どちらに する？', code: 'この ばんごうを ともだちに おしえてね', keypad: 'ばんごうを いれてね', msg: 'ちょっと まってね', error: 'あれれ？', pick: 'ちずを えらんでね', level: 'むずかしさを えらんでね', opts: 'せってい' };
  function setSub(s, headText) {
    sub = s;
    els.setting.setAttribute('data-sub', s);
    els.sethead.textContent = headText || HEADS[s] || '';
    renderNav();
  }
  function enterSetting(s, head) { go('setting'); setSub(s, head); }
  function setMode(k) { gameMode = k; doc.body.setAttribute('data-mode', k); }

  /* ===== U09. 設定・選択の流れ：タイトル → あそびかた → だれと？ → むずかしさ → ちず → しゅっぱつ ===== */
  function startHow() { setMode('solo'); opp = ''; sel = null; loading = false; netRole = ''; renderArts(); enterSetting('how'); }
  function chooseKind(k) {
    setMode(k); sel = null; loading = false;
    if (k === 'solo') { opp = ''; goPick(); } else { opp = ''; setSub('who'); }
  }
  function chooseWho(o) {
    opp = o; sel = null; loading = false;
    if (o === 'cpu') { renderLevels(); setSub('level'); } else { netRole = ''; setSub('choice'); }
  }
  function goPick(head) { sel = null; loading = false; renderCards(); renderPreview(); setSub('pick', head); }
  function openSettings() { renderSettings(); enterSetting('opts'); }
  function backFromSetting() {
    var s = sub;
    if (s === 'how' || s === 'opts') { go('title'); return; }
    if (s === 'who') { setSub('how'); return; }
    if (s === 'level') { setSub('who'); return; }
    if (s === 'pick') {
      if (gameMode === 'solo') setSub('how');
      else if (opp === 'cpu') { sel = null; loading = false; renderLevels(); setSub('level'); }
      else { closeNet(); sel = null; loading = false; setSub('choice'); }
      return;
    }
    if (s === 'choice') { setSub('who'); return; }
    if (opp === 'net') { closeNet(); sel = null; loading = false; setSub('choice'); return; }
    go('title');
  }
  function again() {
    if (opp === 'net') { startHow(); return; }
    enterSetting('pick'); goPick();
  }
  function renderArts() {
    var arts = doc.querySelectorAll('[data-art]');
    for (var a = 0; a < arts.length; a++) { var f = ART[arts[a].getAttribute('data-art')]; arts[a].innerHTML = f ? f() : ''; }
  }

  /* ===== U10. むずかしさ・せってい（シーカーの いろ／さがしかた ほか） ===== */
  function renderLevels() {
    var list = doc.querySelectorAll('.lvcard');
    for (var i = 0; i < list.length; i++) {
      var lv = list[i].getAttribute('data-level');
      list[i].querySelector('.lvpic').innerHTML = LVPIC[lv];
      var k = gameMode === 'count' ? 'count' : 'race';
      list[i].querySelector('em').innerHTML = recLines(k, recOf(k, 'cpu', lv), 'cpu').slice(0, 2).join('<br>');
      list[i].classList.toggle('on', settings.level === lv);
    }
  }
  function chooseLevel(lv) {
    if (LEVELS.indexOf(lv) < 0) return;
    settings.level = lv; saveSettings(); renderLevels();
    goPick();
  }
  function buildSwatches() {
    var box = els.swatches; if (!box) return;
    box.innerHTML = '';
    for (var n = 0; n < 10; n++) (function (n) {
      var b = doc.createElement('button');
      b.type = 'button'; b.tabIndex = -1; b.className = 'swatch'; b.setAttribute('data-pal', n);
      b.innerHTML = seekerPic(n) + '<span></span>';
      b.querySelector('span').textContent = pal(n).name;
      b.setAttribute('aria-label', pal(n).name);
      tap(b, function () { settings.palette = n; saveSettings(); renderSettings(); });
      box.appendChild(b);
    })(n);
  }
  function renderSettings() {
    var segs = doc.querySelectorAll('.seg button[data-set]');
    for (var i = 0; i < segs.length; i++) {
      var k = segs[i].getAttribute('data-set'), raw = segs[i].getAttribute('data-val');
      var v = (k === 'search') ? raw : (raw === '1');
      var on = (settings[k] === v);
      segs[i].classList.toggle('on', on);
      segs[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    var sw2 = doc.querySelectorAll('.swatch');
    for (var j = 0; j < sw2.length; j++) sw2[j].classList.toggle('on', +sw2[j].getAttribute('data-pal') === settings.palette);
    var h = function (id, t) { var e = $(id); if (e) e.textContent = t; };
    h('hint-swipeRev', settings.swipeRev ? 'みぎへ なぞると ひだりを むくよ' : 'みぎへ なぞると みぎを むくよ');
    h('hint-binary', settings.binary ? 'しろと くろの 2いろに するよ' : 'いろの こさで ちずに するよ');
    h('hint-search', settings.search === 'sonar' ? 'ひかりの はしらは でないよ' : 'たからの ばしょから ひかりが でるよ');
    var t = recTotals();
    h('hint-record', 'ぜんぶで ' + t.all + 'かい あそんだよ');
  }
  function setOpt(k, v) { settings[k] = v; saveSettings(); renderSettings(); }
  function renderRecChip() {
    var t = recTotals();
    els.recchip.innerHTML = '<span class="rc-ico">' + SETICO.trophy + '</span><b>くらべっこ</b><span class="rc-n"></span>';
    els.recchip.querySelector('.rc-n').textContent = 'きみ ' + t.me + ' ・ あいて ' + t.opp + ' ・ おなじ ' + t.same;
  }
  function resetRecord() { record = defaultRecord(); saveRecord(); renderSettings(); renderRecChip(); renderLevels(); }

  /* ===== U11. ちずえらび（見本・よみこみ。きみの シーカーの プレビューつき） ===== */
  var thumbs = {};
  function thumb(id) {
    if (thumbs[id] !== undefined) return thumbs[id];
    var u = '';
    try {
      var cv = call('MapGen', 'presetCanvas', id);
      if (cv && cv.width) {
        var k = 96 / Math.max(cv.width, cv.height), t = doc.createElement('canvas');
        t.width = Math.max(1, Math.round(cv.width * k)); t.height = Math.max(1, Math.round(cv.height * k));
        var g = t.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cv, 0, 0, t.width, t.height);
        u = t.toDataURL('image/png');
      }
    } catch (e) { u = ''; }
    thumbs[id] = u; return u;
  }
  function renderCards() {
    var presets = prop('MapGen', 'presets') || [];
    var grid = els.cards;
    grid.innerHTML = '';
    var yoji = [], illust = [];
    presets.forEach(function (p) { (p.kind === 'illust' ? illust : yoji).push(p); });
    var n = Math.min(6, Math.max(3, yoji.length, illust.length));
    grid.style.setProperty('--n', n);
    grid.className = 'maps' + (n >= 5 ? ' dense' : '');
    function group(title, cls, list) {
      var g = doc.createElement('div'); g.className = 'grp ' + cls;
      var l = doc.createElement('div'); l.className = 'gl'; l.textContent = title; g.appendChild(l);
      var row = doc.createElement('div'); row.className = 'row'; g.appendChild(row);
      row.style.setProperty('--n', Math.max(list.length, 4));
      list.forEach(function (p) {
        var c = doc.createElement('button');
        c.type = 'button'; c.tabIndex = -1; c.className = 'card ' + cls; c.setAttribute('data-id', p.id);
        var th = cls === 'illust' ? thumb(p.id) : '';
        c.innerHTML = (th ? '<i class="ic"><img alt="" src="' + th + '"></i>' : (cls === 'illust' && ILLUST[p.title] ? '<i class="ic">' + ILLUST[p.title] + '</i>' : '')) + '<span class="kan"></span><span class="yomi"></span>';
        c.querySelector('.kan').textContent = p.title;
        setYomi(c.querySelector('.yomi'), cls === 'illust' ? '' : (p.reading || ''));
        tap(c, function () { choosePreset(p); });
        row.appendChild(c);
      });
      grid.appendChild(g);
    }
    group('よじじゅくご', 'yoji', yoji);
    group('イラスト', 'illust', illust);
    var f = doc.createElement('div');
    f.className = 'card file'; f.setAttribute('data-id', 'file');
    f.innerHTML = '<i class="ic">' + ICON.pic + '</i><span class="kan">えを よみこむ</span>' + (settings.binary ? '<span class="bw">しろくろ</span>' : '') + '<input type="file" accept="image/*" aria-label="えを よみこむ">';
    var inp = f.querySelector('input');
    // ファイル選択欄だけは既定動作を止めない（止めると選択画面が開かない）。他へ伝わらないよう伝播だけ止める
    ['pointerdown', 'pointerup'].forEach(function (n) { inp.addEventListener(n, function (e) { e.stopPropagation(); unlock(); }); });
    inp.addEventListener('change', function () {
      var file = inp.files && inp.files[0];
      inp.value = '';
      if (file) chooseFile(file);
    });
    grid.appendChild(f);
    markCards();
  }
  function markCards() {
    var list = els.cards.querySelectorAll('.card');
    for (var i = 0; i < list.length; i++) list[i].classList.toggle('on', !!(sel && sel.id === list[i].getAttribute('data-id')));
  }
  function crewHTML() {
    var h = '<div class="crew"><figure>' + seekerPic(settings.palette) + '<figcaption>きみ</figcaption></figure>';
    if (opp === 'cpu') h += '<figure>' + seekerPic(cpuPalette(settings.palette)) + '<figcaption>コンピューター</figcaption></figure>';
    return h + '</div>';
  }
  function renderPreview(msg) {
    var p = els.preview, h = '';
    if (loading) h = '<div class="spin"></div><div class="hint">つくっているよ…</div>';
    else if (msg) h = '<div class="hint">' + msg + '</div>';
    else if (sel && sel.map) h = (sel.map.picture ? '<img class="mapimg" alt="">' : '') + '<div class="pt"></div><div class="py"></div>';
    else h = '<div class="hint">すきな ちずを<br>えらんでね</div>';
    p.innerHTML = h + crewHTML();
    if (!loading && sel && sel.map && !msg) {
      var img = p.querySelector('img.mapimg'); if (img) img.src = sel.map.picture;
      p.querySelector('.pt').textContent = sel.map.title || '';
      p.querySelector('.py').textContent = (sel.map.reading && sel.map.reading !== sel.map.title) ? sel.map.reading : '';
    }
  }
  function treasureCount() { return gameMode === 'count' ? 10 : 1; }
  function choosePreset(p) {
    if (loading) return;
    loading = true; sel = null; markCards(); renderPreview(); renderNav();
    setTimeout(function () {
      var m = null;
      try { m = call('MapGen', 'fromPreset', p.id, { treasureCount: treasureCount(), binary: true }); } catch (e) {}
      loading = false;
      if (m) sel = { id: p.id, map: m };
      markCards(); renderPreview(m ? '' : 'うまく つくれなかったよ'); renderNav();
    }, 40);
  }
  function chooseFile(file) {
    if (loading) return;
    loading = true; sel = null; markCards(); renderPreview(); renderNav();
    var pr = call('MapGen', 'fromFile', file, { treasureCount: treasureCount(), binary: !!settings.binary });
    function done(m) {
      loading = false;
      if (m) sel = { id: 'file', map: m };
      markCards(); renderPreview(m ? '' : 'えを よみこめなかったよ<br>ほかの えを ためしてね'); renderNav();
    }
    if (pr && pr.then) pr.then(done, function () { done(null); }); else done(null);
  }

  /* ===== U12. 出発 ===== */
  function depart() {
    if (!sel || !sel.map) return;
    if (opp === 'net') {
      if (!netConnected) return;
      var enc = call('MapGen', 'encode', sel.map);
      var pals = [settings.palette, remotePal == null ? cpuPalette(settings.palette) : remotePal];
      call('Net', 'send', { t: 'map', map: enc, mode: gameMode, pals: pals, search: settings.search });
      startGame(sel.map, 0, true, null, pals, settings.search);
    } else if (opp === 'cpu') startGame(sel.map, 0, false, { level: settings.level }, [settings.palette, cpuPalette(settings.palette)], settings.search);
    else startGame(sel.map, 0, false, null, [settings.palette, cpuPalette(settings.palette)], settings.search);
  }

  /* ===== U13. 通信：へや（つくる・はいる） ===== */
  function rand4() { return ('0000' + Math.floor(Math.random() * 10000)).slice(-4); }
  function errText(e) {
    var m = typeof e === 'string' ? e : (e && e.message);
    return (m && /[ぁ-ん]/.test(m)) ? m : DEFAULT_ERR;
  }
  function showDigits(el, str, n) {
    var h = '';
    for (var i = 0; i < n; i++) h += '<b>' + (str.charAt(i) || '') + '</b>';
    el.innerHTML = h;
  }
  function failNet(msg) {
    netTok++; closeNet();
    els.msgface.innerHTML = SAD;
    els.msgtext.textContent = msg || DEFAULT_ERR;
    setSub('error');
  }
  function infoNet(text, face) {
    els.msgface.innerHTML = face || '<div class="spin"></div>';
    els.msgtext.textContent = text;
    setSub('msg');
  }
  function closeNet() {
    netTok++;
    clearTimeout(readyTimer);
    var was = netConnected || netOn || netRole;
    netOn = false; netConnected = false; joined = false; remotePal = null;
    if (was) call('Net', 'close');
  }
  function startHost() {
    closeNet();
    netRole = 'host';
    var tok = ++netTok;
    code = call('Net', 'makeCode') || rand4();
    showDigits(els.codeshow, code, 4);
    setSub('code');
    var p = call('Net', 'host', code);
    if (!p || !p.then) { failNet('つうしんが つかえないよ'); return; }
    p.then(function () {
      if (tok !== netTok) return;
      if (prop('Net', 'connected')) hostConnected();
    }, function (e) {
      if (tok !== netTok) return;
      if (e && e.code === 'unavailable-id' && hostRetry < 4) { hostRetry++; startHost(); return; }
      failNet(errText(e));
    });
  }
  function hostConnected() {
    if (netConnected) return;
    netConnected = true; hostRetry = 0;
    call('Net', 'send', { t: 'hello', palette: settings.palette });
    goPick('つながったよ！ ちずを えらんでね');
  }
  function startJoin() {
    closeNet();
    netRole = 'join'; code = '';
    updateKeypad(); setSub('keypad');
  }
  function updateKeypad() { showDigits(els.codein, code, 4); renderNav(); }
  function doJoin() {
    if (code.length !== 4) return;
    var tok = ++netTok; joined = false;
    infoNet('さがしているよ…');
    var p = call('Net', 'join', code);
    if (!p || !p.then) { failNet('つうしんが つかえないよ'); return; }
    p.then(function () {
      if (tok !== netTok) return;
      joined = true; netConnected = true;
      call('Net', 'send', { t: 'hello', palette: settings.palette });
      if (state === 'setting') infoNet('つながったよ！ ちずが くるのを まっているよ…', HAPPY);
    }, function (e) {
      if (tok !== netTok) return;
      failNet(errText(e));
    });
  }
  function retry() { if (netRole === 'host') startHost(); else startJoin(); }
  function buildKeypad() {
    var kp = els.keypad;
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'nul'].forEach(function (k) {
      var b = doc.createElement('button');
      b.type = 'button'; b.tabIndex = -1;
      if (k === 'nul') { b.className = 'key nul'; kp.appendChild(b); return; }
      b.className = 'key' + (k === 'del' ? ' del' : '');
      b.textContent = k === 'del' ? 'けす' : k;
      tap(b, function () { keyIn(k); });
      kp.appendChild(b);
    });
  }
  function keyIn(k) {
    if (sub !== 'keypad') return;
    if (k === 'del') code = code.slice(0, -1);
    else if (code.length < 4) code += k;
    updateKeypad();
  }

  /* ===== U14. 通信の受け口（hello / map / ready / count / claim / award / resume ほか） ===== */
  function onNetOpen() { if (state === 'setting' && netRole === 'host' && sub === 'code') hostConnected(); }
  function netSend(o) { if (netOn && !guard) call('Net', 'send', o); }
  function onNetData(d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'hello') { if (typeof d.palette === 'number') remotePal = clamp(d.palette | 0, 0, 9); return; }
    if (d.t === 'map') {
      if (state === 'setting' && netRole === 'join') {
        var m = call('MapGen', 'decode', d.map);
        if (m) {
          netTok++; setMode(d.mode === 'count' ? 'count' : 'race'); opp = 'net';
          var pals = (d.pals && d.pals.length === 2) ? [clamp(d.pals[0] | 0, 0, 9), settings.palette] : [remotePal == null ? 0 : remotePal, settings.palette];
          startGame(m, 1, true, null, pals, d.search === 'sonar' ? 'sonar' : 'light');
        } else failNet('ちずが うけとれなかったよ');
      }
      return;
    }
    if (state !== 'play') return;
    var other = 1 - myIndex;
    if (d.t === 'st') call('World', 'applyRemoteState', other, d.s);
    else if (d.t === 'terrain') { guard = true; try { call('World', 'applyRemoteTerrain', d.cells); } finally { guard = false; } }
    else if (d.t === 'act') call('World', 'applyRemoteAction', other, d.name);
    else if (d.t === 'ready') { if (netRole === 'host' && phase === 'wait') { netSend({ t: 'count' }); startCountdown(); } }
    else if (d.t === 'count') { if (netRole === 'join' && phase === 'wait') startCountdown(); }
    else if (d.t === 'claim') { // クライアントが宝石のブロックを壊した：まだ持ち主がいなければ ホストが決める
      var ti = d.ti | 0;
      if (netRole === 'host' && owners[ti] === undefined && !gemOwned(ti)) { doAward(other, ti); netSend({ t: 'award', idx: other, ti: ti }); }
    }
    else if (d.t === 'award') { if (netRole === 'join') doAward(d.idx === 0 ? 0 : 1, d.ti | 0); }
    else if (d.t === 'resume') { if (netRole === 'join' && ann) ann.resume = true; }
    else if (d.t === 'end') endCount(true);
    else if (d.t === 'pause') { remotePaused = !!d.on; applyPause(); } // ともだちが ホームのモーダルを開いた／閉じた
  }
  function onNetClose() {
    netConnected = false;
    if (state === 'play' && netOn) {
      netOn = false;
      remotePaused = false; sentPause = false; applyPause(); // ともだちが 止めたままでも ひとりで つづける
      call('World', 'dropRemote', 1 - myIndex);
      showNotice('ともだちが いなくなったよ' + String.fromCharCode(10) + 'ひとりで つづけよう', true);
      if (phase === 'wait') startCountdown();          // まだ始まっていなければ ひとりで始める
      if (ann && netRole === 'join') ann.resume = true; // ホストを待たずに 宣言を終える
    } else if (state === 'setting' && opp === 'net') {
      failNet('あいてと つながらなくなったよ');
    }
    netOn = false;
  }

  /* ===== U15. プレイ開始とカウントダウン（3・2・1・GO!） ===== */
  function startGame(m, idx, net, cpu, pals, search) {
    map = m; myIndex = idx; netOn = !!net; recorded = false; ended = false; sw = null;
    clearTimeout(endTimer); clearTimeout(readyTimer); doc.body.classList.remove('endwait');
    doc.body.setAttribute('data-mode', gameMode);
    curLevel = (opp === 'cpu') ? settings.level : '';
    pals = pals || [settings.palette, cpuPalette(settings.palette)];
    myPal = pals[idx]; oppPal = pals[1 - idx];
    totalTreasure = (m && m.treasures && m.treasures.length) || (gameMode === 'count' ? 10 : 1);
    scores = [0, 0]; timeLeft = COUNT_SEC; shownSec = -1; lastT = 0; elapsed = 0; raceTime = null; winner = -1;
    owners = {}; announced = {}; annQueue = []; ann = null; remotePaused = false; sentPause = false;
    renderHud(); updateTimer(true);
    hideNotice(); clearOno();
    var players = pals.map(function (n) { return { palette: n, color: pal(n).body }; });
    call('World', 'load', m, { myIndex: idx, players: players, net: netOn, isHost: !netOn || idx === 0, cpu: cpu || null, mode: gameMode, search: search || 'light' });
    call('World', 'resetPitch');
    var tinfo = call('World', 'treasureInfo'); if (tinfo && tinfo.total) totalTreasure = tinfo.total;
    els.ptTitle.textContent = m.title || '';
    els.ptYomi.textContent = (m.reading && m.reading !== m.title) ? m.reading : '';
    els.maptag.classList.toggle('none', !m.title);
    if (els.sOpName) els.sOpName.textContent = opp === 'cpu' ? 'コンピューター' : 'あいて'; // 宣言・結果と おなじ よびかた
    camMode = 1; updateCam();
    doc.body.classList.add('camtop');
    go('play');
    call('World', 'setCamera', camMode);
    call('World', 'start');
    call('World', 'freeze', true); // World は読み込み直後 止まっている。念のため
    running = true;
    applyPause();
    // 通信：クライアントは「読み終えた」を知らせ、ホストの合図でカウントダウン。ひとり・CPU はすぐ
    if (netOn) {
      phase = 'wait'; doc.body.classList.add('frozen');
      if (idx === 1) netSend({ t: 'ready' });
      else readyTimer = setTimeout(function () { if (state === 'play' && phase === 'wait') { netSend({ t: 'count' }); startCountdown(); } }, READY_FAILSAFE);
    } else startCountdown();
  }
  function startCountdown() {
    clearTimeout(readyTimer);
    phase = 'count'; cdT = 0; cdStep = -1; counting = true;
    doc.body.classList.add('counting', 'frozen');
    releaseAll(); hideTip();
    stepCountdown();
  }
  function showCount(step) {
    var b = els.countN;
    b.className = '';
    void b.offsetWidth;
    if (step < 3) { b.textContent = String(3 - step); b.className = 'pop'; sfx('count'); }
    else { b.textContent = 'GO!'; b.className = 'go'; sfx('go'); }
  }
  function stepCountdown() {
    var step = cdT < 3 * CD_STEP ? Math.floor(cdT / CD_STEP) : 3;
    if (step !== cdStep) {
      cdStep = step; showCount(step);
      if (step === 3) beginRun();
    }
    if (cdT >= 3 * CD_STEP + CD_GO) { counting = false; doc.body.classList.remove('counting'); if (phase === 'run') showTip(); } // 説明は GO! が消えてから（カウントダウンの場所に出す）
  }
  // GO!：World を動かし、時間と BGM を始める
  function beginRun() {
    phase = 'run';
    doc.body.classList.remove('frozen');
    call('World', 'go');
    call('Sfx', 'bgm', PLAY_TRACKS[Math.floor(Math.random() * PLAY_TRACKS.length)]);
  }
  function stopGame() {
    if (running) { running = false; call('World', 'stop'); }
  }
  function updateCam() {
    var nx = (camMode + 1) % 3;
    els.camIco.innerHTML = camIcon(nx, pal(myPal));
    els.camLabel.textContent = CAM_GO[nx];
    els.cam.setAttribute('aria-label', 'おすと ' + CAM_LABEL[nx] + 'に なる');
  }
  function cycleCam() {
    var m = call('World', 'cycleCamera');
    camMode = (typeof m === 'number') ? m : (camMode + 1) % 3;
    updateCam();
  }
  function showNotice(t, big) {
    clearTimeout(noticeTimer);
    els.notice.textContent = t; els.notice.classList.add('on');
    els.notice.classList.toggle('big', !!big);
    // 大きいお知らせは 4.5秒で消す（小さく残すと 上の カウントダウン・説明の場所に かかるため）
    if (big) noticeTimer = setTimeout(hideNotice, 4500);
  }
  function hideNotice() { clearTimeout(noticeTimer); els.notice.classList.remove('on'); els.notice.classList.remove('big'); }

  /* ===== U16. 宝石の獲得（壊した人だけ。通信はホストが決める）と 3.5秒の獲得宣言 ===== */
  function gemOwned(ti) {
    var g = call('World', 'gemInfo', ti);
    return !!(g && g.owner !== undefined && g.owner !== null && g.owner >= 0);
  }
  // World の 'gemHit'(idx, ti)：自分または CPU が 宝石の入ったブロックを壊した
  function onGemHit(idx, ti) {
    if (state !== 'play' || ended) return;
    ti = ti | 0;
    if (owners[ti] !== undefined) return;
    if (netOn && netRole === 'join') { netSend({ t: 'claim', ti: ti }); return; } // クライアントは ホストに たずねる
    doAward(idx, ti);
    if (netOn) netSend({ t: 'award', idx: idx, ti: ti });
  }
  function doAward(idx, ti) {
    if (owners[ti] !== undefined) return;
    owners[ti] = idx;
    if (gameMode !== 'count' && raceTime === null) { raceTime = elapsed; winner = idx; } // タイムは獲得の瞬間に確定
    call('World', 'award', idx, ti);
    queueAnnounce(idx, ti);
  }
  function queueAnnounce(idx, ti) {
    if (announced[ti]) return;
    announced[ti] = true;
    if (ann) { annQueue.push([idx, ti]); return; }
    beginAnnounce(idx, ti);
  }
  function gemIndexOf(ti) {
    var g = call('World', 'gemInfo', ti);
    if (g && typeof g.gem === 'number') return g.gem;
    var t = map && map.treasures && map.treasures[ti];
    if (t && typeof t.gem === 'number') return t.gem;
    return gameMode === 'count' ? ti % 10 : 0;
  }
  function whoName(idx) { return idx === myIndex ? 'あなた' : (opp === 'cpu' ? 'コンピューター' : 'あいて'); }
  function beginAnnounce(idx, ti) {
    var gm = gemOf(gemIndexOf(ti));
    ann = { idx: idx, ti: ti, t: 0, resume: false };
    phase = 'announce';
    call('World', 'freeze', true);
    releaseAll(); sw = null; hideTip();
    // カウントダウン・擬音とは 同時に出さない（同じ場所を つかうため）
    if (counting) { counting = false; doc.body.classList.remove('counting'); if (els.countN) { els.countN.textContent = ''; els.countN.className = ''; } }
    clearOno();
    els.annGem.innerHTML = bigGem(gm);
    els.annWho.textContent = whoName(idx) + 'が';
    els.annWhat.textContent = gm.name + 'を ゲットした！';
    els.ann.style.setProperty('--g', gm.glow);
    doc.body.classList.add('announcing', 'frozen');
    fitAnn();
    // アニメーションを はじめから
    var card = els.ann.querySelector('.ann-card'); card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
    els.annGem.style.animation = 'none'; void els.annGem.offsetWidth; els.annGem.style.animation = '';
    sfx('fanfare');
    refreshScores();
  }
  // 宣言の文字：8cqmin 以上で 2行。書体の差で はばが足りないときだけ 少し小さくする（下限 7cqmin）
  function fitAnn() {
    [els.annWho, els.annWhat].forEach(function (el) {
      el.style.fontSize = '';
      var card = els.ann.querySelector('.ann-card'), cs = getComputedStyle(card);
      var avail = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (el === els.annWho) avail -= els.annGem.offsetWidth + parseFloat(getComputedStyle(el.parentNode).columnGap || 0);
      var r = doc.createRange(); r.selectNodeContents(el);
      var k = card.getBoundingClientRect().width / (card.offsetWidth || 1) || 1; // 出てくる途中の 拡大・縮小を のぞく
      var w = r.getBoundingClientRect().width / k, fs = parseFloat(getComputedStyle(el).fontSize);
      if (w > avail && w > 0) {
        var cq = els.stage.getBoundingClientRect(); cq = Math.min(cq.width, cq.height) / 100;
        el.style.fontSize = Math.max(7, fs * avail / w / cq - 0.05).toFixed(2) + 'cqmin';
      }
    });
  }
  function stepAnnounce(dt) {
    if (!ann) return;
    ann.t += dt;
    var client = netOn && netRole === 'join';
    if (client ? (ann.resume || ann.t >= ANN_FAILSAFE) : ann.t >= ANN_SEC) endAnnounce();
  }
  function endAnnounce() {
    if (!ann) return;
    var a = ann; ann = null;
    doc.body.classList.remove('announcing');
    if (netOn && netRole === 'host') netSend({ t: 'resume' });
    refreshScores();
    if (gameMode !== 'count') { // どっちが はやい？ ・ ひとり：宣言のあと 結果へ
      phase = 'end'; ended = true;
      call('World', 'finish');
      go('ending', { winner: winner >= 0 ? winner : a.idx });
      return;
    }
    if (annQueue.length) { var n = annQueue.shift(); beginAnnounce(n[0], n[1]); return; }
    if (scores[0] + scores[1] >= totalTreasure) { endCount(false); return; }
    phase = 'run';
    doc.body.classList.remove('frozen');
    call('World', 'freeze', false);
  }
  // 'collect'(idx, ti, scores)：World がスコアを足した。宣言がまだなら（古い World の「さわって拾う」）ここで出す
  function onCollect(idx, ti, sc) {
    if (state !== 'play') return;
    if (sc && sc.length >= 2) { scores = [num(sc[0]), num(sc[1])]; renderHud(); } else refreshScores();
    ti = ti | 0;
    if (!announced[ti]) {
      if (owners[ti] === undefined) owners[ti] = idx;
      if (gameMode !== 'count' && raceTime === null) { raceTime = elapsed; winner = idx; }
      queueAnnounce(idx, ti);
    }
  }
  function curScores() {
    var s = call('World', 'scores');
    if (s && s.length >= 2) return [num(s[0]), num(s[1])];
    return [scores[0], scores[1]];
  }
  function refreshScores() { scores = curScores(); renderHud(); }
  function renderHud() { if (els.sMe) { els.sMe.textContent = scores[0]; els.sOp.textContent = scores[1]; } }
  function endLater(fn, ms) {
    ended = true; sw = null; releaseAll();
    doc.body.classList.add('endwait'); hideTip();
    clearTimeout(endTimer);
    endTimer = setTimeout(function () { if (state === 'play') fn(); }, ms || 900);
  }
  function endCount(fromNet) {
    if (state !== 'play' || ended) return;
    var s = curScores();
    if (netOn && !fromNet) netSend({ t: 'end' });
    phase = 'end';
    call('World', 'finish');
    endLater(function () { go('ending', { scores: s }); });
  }
  function onTerrain(cells) { if (cells && cells.length) netSend({ t: 'terrain', cells: cells }); }
  function onAction(name) { netSend({ t: 'act', name: name }); }
  function onState(s) { if (guard || !netOn || state !== 'play') return; call('Net', 'send', { t: 'st', s: s }); }

  /* ===== U17. 擬音（ビョーン！・ゴゴゴゴゴ・ガン！・ガラッ）。左右の決まった帯に 交互に出す ===== */
  function onOnomato(kind) {
    if (state !== 'play' || phase !== 'run' || isPaused) return;
    var t = ONO_TEXT[kind]; if (!t) return;
    var zone = onoSide ? els.onoR : els.onoL; onoSide = 1 - onoSide;
    zone.innerHTML = '';
    var e = doc.createElement('b');
    e.className = 'ono ' + (kind === 'break' ? 'break' : kind);
    e.textContent = t;
    zone.appendChild(e);
    e.addEventListener('animationend', function () { if (e.parentNode) e.parentNode.removeChild(e); });
  }
  function clearOno() { if (els.onoL) { els.onoL.innerHTML = ''; els.onoR.innerHTML = ''; } }

  /* ===== U18. 毎フレーム：カウントダウン・宣言・時間・ソナー（モーダル中と縦持ちのあいだは進めない） ===== */
  function isPortrait() { return !!(window.matchMedia && window.matchMedia('(orientation: portrait)').matches); }
  function fmtTime(sec) { var s = Math.max(0, Math.floor(sec)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function updateTimer(force) {
    var v = gameMode === 'count' ? Math.ceil(timeLeft) : Math.floor(raceTime !== null ? raceTime : elapsed);
    if (v !== shownSec || force) {
      shownSec = v; els.tVal.textContent = fmtTime(v);
      els.timer.classList.toggle('low', gameMode === 'count' && v <= 30);
    }
  }
  function frame(t) {
    rafId = window.requestAnimationFrame(frame);
    if (state !== 'play') { lastT = 0; return; }
    var dt = lastT ? Math.min(0.25, Math.max(0, (t - lastT) / 1000)) : 0; lastT = t;
    var stop = isPaused || isPortrait();
    if (!stop) {
      if (counting) { cdT += dt; stepCountdown(); }
      if (phase === 'announce') stepAnnounce(dt);
      else if (phase === 'run' && !ended) {
        elapsed += dt;
        if (gameMode === 'count') {
          timeLeft = Math.max(0, timeLeft - dt);
          if (timeLeft <= 0) endCount(false);
        }
        updateTimer();
        if (gameMode === 'count') refreshScoresLight();
      }
    }
    drawSonar(t);
  }
  var scoreTick = 0;
  function refreshScoresLight() {
    if (++scoreTick % 15) return;
    var s = call('World', 'scores');
    if (s && s.length >= 2 && (num(s[0]) !== scores[0] || num(s[1]) !== scores[1])) { scores = [num(s[0]), num(s[1])]; renderHud(); }
  }
  // ソナー（左上の円形レーダー。上が いま向いている方向。自分は中央の矢印、宝は光る点。ゆっくり脈うつ。点滅しない）
  function drawSonar(t) {
    var cv = els.sonarCv; if (!cv || !cv.getContext) return;
    var g = cv.getContext('2d'), W = cv.width, c = W / 2, R = c - 14;
    var s = call('World', 'sonar', SONAR_FAR) || { heading: 0, items: [] };
    var fx, fz;
    if (s.forward && isFinite(s.forward.x) && isFinite(s.forward.z)) { fx = +s.forward.x; fz = +s.forward.z; }
    else { var h = +s.heading || 0; fx = -Math.sin(h); fz = -Math.cos(h); }
    var fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    var T = t || 0;
    g.clearRect(0, 0, W, W);
    // ふち（クリーム色の太い輪）と 盤
    g.beginPath(); g.arc(c, c, R + 11, 0, Math.PI * 2); g.fillStyle = '#fffaf0'; g.fill();
    var bg = g.createRadialGradient(c, c - R * 0.3, 6, c, c, R);
    bg.addColorStop(0, '#2d6f86'); bg.addColorStop(1, '#173f52');
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fillStyle = bg; g.fill();
    g.save(); g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.clip();
    g.lineWidth = 2.5; g.strokeStyle = 'rgba(127,214,245,.45)'; g.setLineDash([5, 9]);
    g.beginPath(); g.arc(c, c, R * 0.5, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    g.beginPath(); g.moveTo(c, c - R); g.lineTo(c, c + R); g.moveTo(c - R, c); g.lineTo(c + R, c); g.strokeStyle = 'rgba(127,214,245,.2)'; g.stroke();
    var a = (T / 2600) % 1 * Math.PI * 2; // ゆっくり まわる走査線
    if (g.createConicGradient) {
      var sg = g.createConicGradient(a - Math.PI / 2, c, c);
      sg.addColorStop(0, 'rgba(127,214,245,0)'); sg.addColorStop(0.88, 'rgba(127,214,245,0)'); sg.addColorStop(1, 'rgba(127,214,245,.32)');
      g.fillStyle = sg; g.fillRect(0, 0, W, W);
    }
    g.restore();
    // 自分（中央の矢印。上むき。自分のシーカーの色）
    var me = pal(myPal);
    g.save(); g.translate(c, c);
    g.beginPath(); g.moveTo(0, -19); g.lineTo(13, 13); g.lineTo(0, 6); g.lineTo(-13, 13); g.closePath();
    g.lineJoin = 'round'; g.lineWidth = 6; g.strokeStyle = '#fffaf0'; g.stroke();
    g.fillStyle = me.body; g.fill();
    g.restore();
    // 宝：円の中は光る点（近いほど大きい）。円の外で いちばん近い宝は ふちのくさびで知らせる
    var items = s.items || [], far = null;
    var pulse = 0.5 + 0.5 * Math.sin(T / 520);
    g.save(); g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.clip();
    for (var i = 0; i < items.length; i++) {
      var it = items[i]; if (!it) continue;
      var dx = +it.dx || 0, dz = +it.dz || 0;
      var dist = isFinite(+it.dist) ? +it.dist : Math.hypot(dx, dz);
      if (dist > SONAR_R) { if (!far || dist < far.dist) far = { dx: dx, dz: dz, dist: dist }; continue; }
      var sx = (dx * -fz + dz * fx), sy = -(dx * fx + dz * fz);
      var px = c + sx * R / SONAR_R, py = c + sy * R / SONAR_R;
      var depth = Math.max(0, +it.depth || 0);
      var rad = Math.max(10, 16 - Math.min(depth, 6) * 0.8) * (1 + 0.08 * pulse);
      var gl = g.createRadialGradient(px, py, 0, px, py, rad * 2.6);
      gl.addColorStop(0, 'rgba(255,224,110,' + (0.65 + 0.25 * pulse).toFixed(2) + ')'); gl.addColorStop(1, 'rgba(255,213,79,0)');
      g.fillStyle = gl; g.beginPath(); g.arc(px, py, rad * 2.6, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(px, py, rad * 0.78, 0, Math.PI * 2); g.fillStyle = '#ffd54f'; g.fill();
      g.lineWidth = 3; g.strokeStyle = '#fffaf0'; g.stroke();
      if (dist < 2.2) {
        var rr = 25 + 3 * pulse;
        g.beginPath(); g.arc(c, c, rr, 0, Math.PI * 2); g.lineWidth = 6; g.strokeStyle = 'rgba(255,213,79,' + (0.7 + 0.3 * pulse).toFixed(2) + ')'; g.stroke();
      }
    }
    g.restore();
    g.beginPath(); g.moveTo(c, c - R + 3); g.lineTo(c - 9, c - R - 8); g.lineTo(c + 9, c - R - 8); g.closePath(); g.fillStyle = '#ff9800'; g.fill();
    if (far) {
      var fsx = (far.dx * -fz + far.dz * fx), fsy = -(far.dx * fx + far.dz * fz);
      var ang = Math.atan2(fsy, fsx), kk = clamp(1 - (far.dist - SONAR_R) / 90, 0, 1);
      var len = 22 + 22 * kk, hw = 11 + 10 * kk, tip = R + 9, base = tip - len;
      g.save(); g.translate(c, c); g.rotate(ang);
      g.beginPath(); g.moveTo(tip, 0); g.lineTo(base, -hw); g.lineTo(base + len * 0.28, 0); g.lineTo(base, hw); g.closePath();
      g.shadowColor = 'rgba(255,213,79,.9)'; g.shadowBlur = 8 + 10 * kk;
      g.globalAlpha = 0.7 + 0.3 * kk;
      g.fillStyle = '#ffd54f'; g.fill();
      g.shadowBlur = 0; g.globalAlpha = 1;
      g.lineWidth = 3; g.lineJoin = 'round'; g.strokeStyle = '#fffaf0'; g.stroke();
      g.restore();
    }
  }

  /* ===== U19. エンディング（争いの言葉なし。同数は「へいわの しょうり」） ===== */
  var END_BOX_W = 76, END_BOX_H = 42; // .endpic の中に入る大きさ（cqmin）
  function showEndPic(src) {
    var img = els.endPic;
    img.onload = function () {
      var nw = img.naturalWidth || 1, nh = img.naturalHeight || 1, k = Math.min(END_BOX_W / nw, END_BOX_H / nh);
      img.style.width = (nw * k).toFixed(2) + 'cqmin';
      img.style.height = (nh * k).toFixed(2) + 'cqmin';
      img.classList.toggle('pix', Math.max(nw, nh) < 256);
    };
    img.src = src;
  }
  function figure(n, label, ped, top) {
    return '<figure class="' + (top ? 'top' : '') + '">' + seekerPic(n) + '<div class="ped"></div></figure>';
  }
  function fillEnding(r) {
    r = r || {};
    var m = map || {}, who = OPP_NAME[opp] || 'あいて';
    var head = '', line = '', res = 'solo', kind = gameMode, rr = null, jingle = 'practice';
    var tStr = raceTime !== null ? fmtTime(raceTime) : fmtTime(elapsed);
    var teamHTML = '', peds = [];
    if (kind === 'race') {
      var meWon = (r.winner === myIndex);
      res = meWon ? 'me' : 'opp'; jingle = meWon ? 'win' : 'lose';
      head = meWon ? 'きみが はやかった！' : who + 'が はやかった';
      line = (meWon ? 'たからを さきに みつけたよ！' : 'たからを さきに みつけられたよ') + '　タイム ' + tStr;
      if (!recorded) { recorded = true; rr = recOf('race', opp, curLevel); rr[meWon ? 'me' : 'opp']++; saveRecord(); }
      teamHTML = figure(myPal, '', '', meWon) + figure(oppPal, '', '', !meWon);
      peds = ['きみ', opp === 'cpu' ? 'コンピューター' : 'あいて'];
    } else if (kind === 'count') {
      var s = r.scores || scores, a = num(s[0]), b = num(s[1]);
      res = a > b ? 'me' : (a < b ? 'opp' : 'same');
      jingle = res === 'me' ? 'win' : (res === 'opp' ? 'lose' : 'peace');
      head = res === 'me' ? 'きみの ほうが おおかった！' : (res === 'opp' ? who + 'の ほうが おおかった' : 'みんな なかよし！ へいわの しょうり！');
      line = res === 'same' ? 'どちらも ' + a + 'こ みつけたよ！' : 'きみは ' + a + 'こ、' + who + 'は ' + b + 'こ みつけたよ';
      if (!recorded) { recorded = true; rr = recOf('count', opp, curLevel); rr[res]++; saveRecord(); }
      teamHTML = figure(myPal, '', '', res !== 'opp') + figure(oppPal, '', '', res !== 'me');
      peds = ['きみ ' + a + 'こ', (opp === 'cpu' ? 'コンピューター ' : 'あいて ') + b + 'こ'];
    } else {
      head = 'みつけた！';
      line = 'たからを ほりだしたよ！　タイム ' + tStr;
      if (!recorded) { recorded = true; record.solo.n++; saveRecord(); }
      rr = record.solo;
      teamHTML = figure(myPal, '', '', true);
      peds = ['きみ'];
    }
    els.ending.setAttribute('data-res', res);
    els.ending.setAttribute('data-kind', kind);
    els.endFound.textContent = head;
    els.endFound.classList.toggle('long', head.length > 7 && head.length <= 11);
    els.endFound.classList.toggle('xlong', head.length > 11);
    els.endFound.style.fontSize = '';
    els.endTeam.innerHTML = teamHTML;
    var pe = els.endTeam.querySelectorAll('.ped');
    for (var i = 0; i < pe.length; i++) pe[i].textContent = peds[i] || '';
    var gi = 0; for (var k in owners) { if (owners[k] === myIndex) { gi = gemIndexOf(+k); break; } }
    var gm = gemOf(gi);
    els.endWho.innerHTML = '<i class="gemi">' + gemSvg(gm.id === 'diamond' || gm.id === 'opal' ? '#7fd6f5' : gm.color) + '</i><span></span>';
    els.endWho.querySelector('span').textContent = line;
    var lab = KIND_NAME[kind] + (opp === 'cpu' ? '・' + OPP_NAME.cpu + '・' + LEVEL_NAME[curLevel] : (opp === 'net' ? '・' + OPP_NAME.net : ''));
    els.endRec.innerHTML = '<span class="rc-ico">' + SETICO.trophy + '</span><span class="rc-col"><b></b><span class="rc-n"></span></span>';
    els.endRec.querySelector('b').textContent = lab;
    els.endRec.querySelector('.rc-n').innerHTML = recLines(kind, rr || record.solo, opp).map(function (t) { return '<span class="rl">' + t + '</span>'; }).join('');
    els.endTitle.textContent = m.title || '';
    els.endYomi.textContent = (m.reading && m.reading !== m.title) ? m.reading : '';
    els.endTitle.parentNode.style.display = m.title ? '' : 'none';
    if (m.picture) { showEndPic(m.picture); els.endPic.style.display = ''; } else els.endPic.style.display = 'none';
    // 紙ふぶき（ゆっくり）。へいわの しょうりは 全員の色で
    var c = els.confetti; c.innerHTML = '';
    var cols = res === 'same' ? [pal(myPal).body, pal(oppPal).body, '#ffd54f', '#ef6c8f', '#ffffff'] : ['#ff9800', '#2a9fd4', '#ffd54f', '#3dbb85', '#ef6c8f', '#ffffff'];
    for (var j = 0; j < 24; j++) {
      var sp = doc.createElement('i');
      // 文字の列（左がわ）の上は とおらない：左のはし と 右がわ（ちずの絵のまわり）だけ
      sp.style.left = (j < 3 ? j * 2.4 + Math.random() : 50 + (j - 3) * 2.3 + Math.random() * 1.5) + '%';
      sp.style.background = cols[j % cols.length];
      sp.style.animationDuration = (6 + Math.random() * 4) + 's';
      sp.style.animationDelay = (-Math.random() * 8) + 's';
      c.appendChild(sp);
    }
    fitEnding();
    call('Sfx', 'engine', 'idle', 0);
    call('Sfx', 'jingle', jingle);
  }
  // 結果の左の列：上から ならべ、入りきらないときは 見出しを 小さくする（上も下も 切れない）
  function fitEnding() {
    var box = doc.querySelector('.endleft'); if (!box || !box.clientHeight) return;
    var cq = els.stage.getBoundingClientRect(); cq = Math.min(cq.width, cq.height) / 100;
    for (var n = 0; n < 12 && box.scrollHeight > box.clientHeight + 1; n++) {
      var fs = parseFloat(getComputedStyle(els.endFound).fontSize) / cq;
      if (fs <= 5.2) break;
      els.endFound.style.fontSize = (fs - 0.4).toFixed(2) + 'cqmin';
    }
  }

  /* ===== U20. スワイプ（プレイ中の画面なぞり） ===== */
  function unitPx() { var r = els.stage.getBoundingClientRect(); return Math.max(1, Math.min(r.width, r.height) / 100); }
  function swipeDown(e) {
    e.stopPropagation(); e.preventDefault(); unlock();
    if (state !== 'play' || inputLocked() || sw) return;
    sw = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, axis: '' };
    try { els.swipe.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function swipeMove(e) {
    if (!sw || e.pointerId !== sw.id) return;
    e.stopPropagation(); e.preventDefault();
    if (inputLocked()) { sw = null; return; }
    var u = unitPx(), dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (!sw.axis) {
      if (Math.hypot(dx, dy) < 1.6 * u) return;
      sw.axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v'; sw.lx = sw.x; sw.ly = sw.y;
    }
    if (sw.axis === 'h') {
      var mx = e.clientX - sw.lx; sw.lx = e.clientX;
      if (!mx) return;
      hideTip();
      var rw = els.stage.getBoundingClientRect().width || 1;
      call('World', 'swipeTurn', mx / rw * (settings.swipeRev ? -1 : 1));
    } else {
      var dd = e.clientY - sw.ly; sw.ly = e.clientY;
      if (dd) { hideTip(); call('World', 'nudgePitch', clamp(-dd / (30 * u), -1, 1)); }
    }
  }
  function swipeUp(e) { if (!sw || e.pointerId !== sw.id) return; e.stopPropagation(); e.preventDefault(); sw = null; }
  function showTip() { clearTimeout(tipTimer); els.tip.classList.add('on'); tipTimer = setTimeout(hideTip, 6500); }
  function hideTip() { clearTimeout(tipTimer); if (els.tip) els.tip.classList.remove('on'); }

  /* ===== U21. ホームボタン・確認モーダル・resetGame() ===== */
  function openModal(kind) {
    if (modalOpen) return;
    if (state === 'boot') return; // Boot から先へ進むのは「タップしてスタート」の click だけ
    modalKind = kind === 'reset' ? 'reset' : (state === 'title' ? 'quit' : 'back');
    var t = { reset: 'きろくを ぜんぶ けしますか？', quit: 'しゅうりょうしますか？', back: 'タイトルへもどりますか？' }[modalKind];
    $('m-title').textContent = t;
    $('m-no-t').textContent = modalKind === 'reset' ? 'やめる' : 'いいえ';
    $('m-yes-t').textContent = modalKind === 'reset' ? 'けす' : 'はい';
    modalOpen = true; els.modal.classList.add('on'); sw = null;
    releaseAll();
    applyPause();
  }
  function closeModal() {
    if (!modalOpen) return;
    modalOpen = false; els.modal.classList.remove('on');
    applyPause();
  }
  function modalYes() {
    var k = modalKind;
    modalOpen = false; els.modal.classList.remove('on');
    if (k === 'reset') { applyPause(); resetRecord(); return; }
    if (k === 'quit') { // タイトル画面：Quit へ移って window.close() を ためす
      isPaused = false; doc.body.classList.remove('paused');
      call('Sfx', 'pause', false); call('Sfx', 'stopAll');
      stopGame(); closeNet(); go('quit');
      try { window.close(); } catch (e) {}
      return;
    }
    resetGame();
  }
  // モーダルと縦持ち：isPaused で ゲームループ・タイマー・BGM・演出・カウントダウンを止める
  // 通信のプレイ中は ともだちの画面も止める：自分が止めた／動かしたことを {t:'pause', on} で知らせる。
  // ともだちが止めている間は こちらも止めて「ともだちが まっているよ」を出す（自分のモーダルは いつでも開ける）
  function applyPause() {
    var mine = modalOpen || (state === 'play' && isPortrait());
    var playNet = state === 'play' && netOn;
    if (playNet && mine !== sentPause) { sentPause = mine; netSend({ t: 'pause', on: mine }); }
    if (!playNet) { remotePaused = false; sentPause = false; }
    var waiting = playNet && remotePaused;
    if (els.waitnote) els.waitnote.classList.toggle('on', waiting);
    var p = mine || waiting;
    if (p === isPaused) return;
    isPaused = p;
    doc.body.classList.toggle('paused', p);
    if (state === 'play') call('World', 'setPaused', p);
    call('Sfx', 'pause', p);
    if (p) releaseAll();
  }
  // すべてを はじめの状態に もどして タイトルへ
  function resetGame() {
    clearTimeout(endTimer); clearTimeout(noticeTimer); clearTimeout(tipTimer); clearTimeout(readyTimer);
    releaseAll(); pressed = {}; sw = null;
    if (running) call('World', 'freeze', false);
    stopGame();                                   // ゲームループ
    closeNet();                                   // 通信
    call('Sfx', 'pause', false);                  // モーダルで止めた音の「一時停止」を先に解く（解かないとタイトルの BGM も鳴らない）
    call('Sfx', 'stopAll');                       // BGM・効果音・ループ
    phase = 'idle'; counting = false; cdT = 0; cdStep = -1;          // カウントダウン
    ann = null; annQueue = []; owners = {}; announced = {};           // 獲得宣言
    elapsed = 0; raceTime = null; winner = -1; timeLeft = COUNT_SEC; shownSec = -1; scores = [0, 0]; // タイマー・スコア
    ended = false; recorded = false;                                  // 終了フラグ
    sel = null; loading = false; gameMode = 'solo'; opp = ''; netRole = ''; code = ''; remotePal = null; map = null; // 選択状態
    modalOpen = false; isPaused = false; els.modal.classList.remove('on');
    remotePaused = false; sentPause = false; if (els.waitnote) els.waitnote.classList.remove('on');
    doc.body.classList.remove('counting', 'announcing', 'frozen', 'endwait', 'camtop', 'paused');
    doc.body.setAttribute('data-mode', 'solo');
    hideNotice(); hideTip(); clearOno(); renderHud(); updateTimer(true);
    if (els.countN) { els.countN.textContent = ''; els.countN.className = ''; }
    go('title');
  }

  /* ===== U22. キーボード（PC での確認用。Boot はキーでは進まない） ===== */
  var KEYS = { ArrowUp: 'fwd', w: 'fwd', W: 'fwd', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
    ' ': 'jump', z: 'drillAttack', Z: 'drillAttack', x: 'jumpDrill', X: 'jumpDrill' };
  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (state === 'boot') return;
    if (modalOpen) { if (e.key === 'Escape') { e.preventDefault(); closeModal(); } return; }
    if (state === 'play') {
      var act = KEYS[e.key];
      if (inputLocked() && e.key !== 'Escape') { if (act) e.preventDefault(); return; }
      if (act) { e.preventDefault(); if (!e.repeat) press(act, true); return; }
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); if (!e.repeat) cycleCam(); return; }
      if (e.key === 'Escape') { e.preventDefault(); openModal(); }
      return;
    }
    if (state === 'setting' && sub === 'keypad') {
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); keyIn(e.key); return; }
      if (e.key === 'Backspace') { e.preventDefault(); keyIn('del'); return; }
    }
  }
  function onKeyUp(e) { var act = KEYS[e.key]; if (act && state === 'play') { e.preventDefault(); press(act, false); } }

  /* ===== U23. Boot（読み込みが終わるまで「じゅんびちゅう...」。進むのはボタンの click だけ） ===== */
  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function setBootReady() {
    if (bootReady) return;
    bootReady = true;
    var b = $('bootbtn');
    b.disabled = false; b.classList.add('ready');
    $('bootbtn-t').textContent = 'タップしてスタート';
  }
  function leaveBoot(e) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    if (state !== 'boot' || !bootReady) return;
    unlock();                                           // AudioContext の初期化は OS を問わず必ず
    if (!isIOS()) {                                     // iOS・iPadOS では全画面をスキップ
      try {
        var de = doc.documentElement, rf = de.requestFullscreen || de.webkitRequestFullscreen;
        if (rf) { var pr = rf.call(de); if (pr && pr.catch) pr.catch(function () {}); }
      } catch (err) {}
    }
    sfx('tap');
    go('title');
  }

  /* ===== U24. 初期化と window.App ===== */
  function init() {
    ['stage', 'nav', 'home', 'modal', 'setting', 'sethead', 'cards', 'preview', 'keypad', 'codein', 'codeshow', 'msgface', 'msgtext',
      'cam', 'notice', 'confetti', 'swipe', 'tip', 'recchip', 'ending', 'timer', 'maptag', 'swatches', 'ann', 'waitnote'].forEach(function (id) { els[id] = $(id); });
    els.endFound = $('end-found'); els.endRec = $('end-rec'); els.endTeam = $('end-team');
    els.ptTitle = $('pt-title'); els.ptYomi = $('pt-yomi');
    els.camIco = $('cam-ico'); els.camLabel = $('cam-label');
    els.endWho = $('end-who'); els.endTitle = $('end-title'); els.endYomi = $('end-yomi'); els.endPic = $('end-pic');
    els.sonarCv = $('sonar-cv'); els.tVal = $('t-val'); els.sMe = $('s-me'); els.sOp = $('s-op');
    els.countN = $('count-n'); els.annGem = $('ann-gem'); els.annWho = $('ann-who'); els.annWhat = $('ann-what');
    els.onoL = $('ono-l'); els.onoR = $('ono-r'); els.sOpName = $('s-op-n');

    document.addEventListener('contextmenu', e => { if(e.target.tagName !== 'INPUT') e.preventDefault(); }, { passive: false });
    ['gesturestart', 'gesturechange', 'gestureend', 'dblclick'].forEach(function (n) { doc.addEventListener(n, function (e) { e.preventDefault(); }); });
    doc.addEventListener('keydown', onKeyDown);
    doc.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseAll);
    if (window.matchMedia) {
      var mq = window.matchMedia('(orientation: portrait)');
      if (mq.addEventListener) mq.addEventListener('change', applyPause); else if (mq.addListener) mq.addListener(applyPause);
    }

    settings = loadSettings(); record = loadRecord();
    buildLogos(); buildIsles(); buildHeroIsles();
    buildKeypad();
    var icos = doc.querySelectorAll('[data-ico]');
    for (var ii = 0; ii < icos.length; ii++) icos[ii].innerHTML = SETICO[icos[ii].getAttribute('data-ico')] || '';
    renderArts();
    buildSwatches();
    renderCards(); renderPreview();
    renderLevels(); renderSettings(); renderRecChip();
    updateCam();

    // Boot：ボタンの click だけで進む
    var bb = $('bootbtn');
    bb.addEventListener('pointerdown', function (e) { e.stopPropagation(); e.preventDefault(); if (bootReady) bb.classList.add('down'); });
    bb.addEventListener('pointerup', function (e) { e.stopPropagation(); e.preventDefault(); bb.classList.remove('down'); });
    bb.addEventListener('pointercancel', function (e) { e.stopPropagation(); e.preventDefault(); bb.classList.remove('down'); });
    bb.addEventListener('pointerleave', function (e) { e.stopPropagation(); e.preventDefault(); bb.classList.remove('down'); });
    bb.addEventListener('click', leaveBoot);
    tap(els.home, function () { openModal(); });
    tap($('m-no'), closeModal);
    tap($('m-yes'), modalYes);
    els.modal.addEventListener('pointerdown', stopEv);
    els.modal.addEventListener('pointerup', stopEv);
    els.modal.addEventListener('click', stopEv);
    tap($('back'), backFromSetting);
    tap($('c-host'), startHost);
    tap($('c-join'), startJoin);
    tap(els.cam, cycleCam);
    tap($('reset-rec'), function () { openModal('reset'); });
    var segs = doc.querySelectorAll('.seg button[data-set]');
    for (var j = 0; j < segs.length; j++) (function (b) {
      tap(b, function () { var k = b.getAttribute('data-set'), v = b.getAttribute('data-val'); setOpt(k, k === 'search' ? v : v === '1'); });
    })(segs[j]);
    var lvs = doc.querySelectorAll('.lvcard');
    for (var q = 0; q < lvs.length; q++) (function (b) { tap(b, function () { chooseLevel(b.getAttribute('data-level')); }); })(lvs[q]);
    var hows = doc.querySelectorAll('.howcard');
    for (var hh = 0; hh < hows.length; hh++) (function (b) { tap(b, function () { chooseKind(b.getAttribute('data-kind')); }); })(hows[hh]);
    var whos = doc.querySelectorAll('[data-who]');
    for (var ww = 0; ww < whos.length; ww++) (function (b) { tap(b, function () { chooseWho(b.getAttribute('data-who')); }); })(whos[ww]);
    els.swipe.addEventListener('pointerdown', swipeDown);
    els.swipe.addEventListener('pointermove', swipeMove);
    els.swipe.addEventListener('pointerup', swipeUp);
    els.swipe.addEventListener('pointercancel', swipeUp);
    els.swipe.addEventListener('lostpointercapture', function (e) { if (sw && e.pointerId === sw.id) sw = null; });
    els.swipe.addEventListener('click', stopEv);
    els.swipe.addEventListener('contextmenu', stopEv);
    ['touchstart', 'touchmove'].forEach(function (n) { els.swipe.addEventListener(n, function (e) { e.preventDefault(); }, { passive: false }); });
    var ctls = doc.querySelectorAll('.ctl[data-act]');
    for (var i = 0; i < ctls.length; i++) hold(ctls[i], ctls[i].getAttribute('data-act'));

    call('World', 'init', $('worldbox'));
    call('World', 'on', 'gemHit', onGemHit);
    call('World', 'on', 'collect', onCollect);
    call('World', 'on', 'onomato', onOnomato);
    call('World', 'on', 'terrain', onTerrain);
    call('World', 'on', 'action', onAction);
    call('World', 'on', 'cam', function (top) { doc.body.classList.toggle('camtop', !!top); });
    call('World', 'on', 'state', onState);
    call('Net', 'on', 'open', onNetOpen);
    call('Net', 'on', 'data', onNetData);
    call('Net', 'on', 'close', onNetClose);

    state = 'boot'; doc.body.setAttribute('data-state', 'boot');
    renderNav();
    if (window.requestAnimationFrame) rafId = window.requestAnimationFrame(frame);
    // 読み込みが終わったら「タップしてスタート」
    var ready = function () { setTimeout(setBootReady, 600); };
    if (doc.readyState === 'complete') ready(); else window.addEventListener('load', ready);
  }

  window.App = {
    version: VERSION,
    go: function (name) { if (['boot', 'title', 'setting', 'play', 'ending', 'quit'].indexOf(name) >= 0) go(name); },
    resetGame: function () { resetGame(); },
    get state() { return state; },
    // 確認用の手がかり（ゲームの進行には使わない）
    _info: function () { return { mode: gameMode, opp: opp, level: curLevel, phase: phase, left: timeLeft, elapsed: elapsed, raceTime: raceTime, scores: scores.slice(), total: totalTreasure, ended: ended, paused: isPaused, remotePaused: remotePaused, cdT: cdT, ann: ann ? { idx: ann.idx, ti: ann.ti, t: ann.t } : null, owners: JSON.parse(JSON.stringify(owners)), myPal: myPal, oppPal: oppPal, netRole: netRole, netOn: netOn }; },
    _setTime: function (sec) { timeLeft = Math.max(0, +sec || 0); shownSec = -1; updateTimer(true); },
    _gemHit: function (idx, ti) { onGemHit(idx, ti); },
    _onomato: function (k) { onOnomato(k); },
    _finish: function () { endCount(false); }
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})();
