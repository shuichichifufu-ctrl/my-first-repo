// ui.js : 「見つけて！PixSee」の画面と操作。6ステート、ボタン、モーダル、ソナー、スワイプ、全体の配線。公開するのは window.App だけ。
// World / MapGen / Net / Sfx が無くても落ちないよう、すべて call() 経由で呼ぶ。
(function () {
  'use strict';
  var PLAYERS = [{ color: '#e08524' }, { color: '#2f8be0' }];
  var INK = '#2b2118';
  var CAM_LABEL = ['め', 'おいかけ', 'そら']; // 視点の名前
  var CAM_GO = ['めへ', 'おいかけへ', 'そらへ'];  // カメラボタンの文字：おすと つぎに なる視点（絵と同じ）
  var LEVELS = ['easy', 'normal', 'hard'];
  var LEVEL_NAME = { easy: 'やさしい', normal: 'ふつう', hard: 'むずかしい' };
  var KIND_NAME = { race: 'どっちが はやい？', count: 'どっちが おおい？', solo: 'ひとりで れんしゅう' };
  var OPP_NAME = { cpu: 'コンピューター', net: 'ともだち' };
  var DEFAULT_ERR = 'つながらなかったよ。ばんごうを たしかめてね';
  var COUNT_SEC = 600;        // どっちが おおい？ の じかん（10ぷん）
  var SONAR_R = 10;           // ソナーの はんけい（ブロック）
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

  // ---------------- 設定と記録（localStorage。読めなくても既定値で動く） ----------------
  var KEY_SET = 'pixsee.settings', KEY_REC = 'pixsee.record';
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  function readJSON(k) { try { var t = lsGet(k); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
  function defaultSettings() { return { swipeRev: false, binary: false, level: 'normal' }; }
  function loadSettings() {
    var d = defaultSettings(), o = readJSON(KEY_SET);
    if (o && typeof o === 'object') {
      if (typeof o.swipeRev === 'boolean') d.swipeRev = o.swipeRev;
      if (typeof o.binary === 'boolean') d.binary = o.binary;
      if (LEVELS.indexOf(o.level) >= 0) d.level = o.level;
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
  // 記録の文（争いの言葉なし）。はやい：「きみが さき 〇かい」「あいてが さき 〇かい」
  function recLines(kind, r) {
    if (kind === 'race') return ['きみが さき ' + r.me + 'かい', 'あいてが さき ' + r.opp + 'かい'];
    if (kind === 'count') return ['きみが おおい ' + r.me + 'かい', 'あいてが おおい ' + r.opp + 'かい', 'おなじ ' + r.same + 'かい'];
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

  // ---------------- 絵（SVG）。色は山田さんのデザイン画：橙・クリーム・水色と黄色のしましま・ピンクの星・緑の目 ----------------
  var ICON = {
    play: '<svg viewBox="0 0 24 24"><path d="M6 3.500l15 8.500-15 8.500z"/></svg>',
    go: '<svg viewBox="0 0 24 24"><path d="M3 4l9 8-9 8zM12 4l9 8-9 8z"/></svg>',
    net: '<svg viewBox="0 0 24 24"><circle cx="5.500" cy="12" r="4"/><circle cx="18.500" cy="12" r="4"/><rect x="8" y="10.500" width="8" height="3"/></svg>',
    again: '<svg viewBox="0 0 24 24"><path d="M12 4V1L7 5.500 12 10V7a5.500 5.500 0 1 1-5.500 5.500H3.500A8.500 8.500 0 1 0 12 4z"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M12 3 1.500 12.500H5V21h5.500v-6h3v6H19v-8.500h3.500z"/></svg>',
    link: '<svg viewBox="0 0 24 24"><circle cx="5.500" cy="12" r="4"/><circle cx="18.500" cy="12" r="4"/><rect x="8" y="10.500" width="8" height="3"/></svg>',
    pic: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="3" fill="#ffe400" stroke="#2b2118" stroke-width="1.500"/><circle cx="8" cy="10" r="2.400" fill="#d97eb8"/><path d="M3 19l6-6 4 4 3-3 5 5z" fill="#19c8f5"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><path d="M19.400 13a7.500 7.500 0 0 0 0-2l2.100-1.600-2-3.500-2.500 1a7.500 7.500 0 0 0-1.700-1L14.900 3h-4l-.4 2.900a7.500 7.500 0 0 0-1.700 1l-2.500-1-2 3.500L6.400 11a7.500 7.500 0 0 0 0 2l-2.100 1.600 2 3.500 2.500-1a7.500 7.500 0 0 0 1.700 1l.4 2.900h4l.4-2.900a7.500 7.500 0 0 0 1.700-1l2.500 1 2-3.500zM12.900 15.500a3.500 3.500 0 1 1 0-7 3.500 3.500 0 0 1 0 7z"/></svg>'
  };
  function gemSvg(c) {
    c = c || '#19c8f5';
    return '<svg viewBox="0 0 24 24"><path d="M12 2.500 20 8.500 12 21.500 4 8.500z" fill="' + c + '" stroke="' + INK + '" stroke-width="1.800" stroke-linejoin="round"/><path d="M4 8.500h16M9 8.500 12 2.500l3 6M9 8.500l3 13 3-13" fill="none" stroke="' + INK + '" stroke-width="1.100" stroke-linejoin="round"/><path d="M7.500 6.500l2.200-2" stroke="#fff" stroke-width="1.600" stroke-linecap="round"/></svg>';
  }
  // シーカー（デザイン画：ロールケーキの体、端面のクリーム色の輪と白い穴とピンクの星、黒いバイザーに緑の目、しましまのドリルハット、棒、キャタピラ）
  function mascot(body) {
    body = body || '#e08524';
    return '<svg viewBox="0 0 124 104">' +
      '<ellipse cx="62" cy="98" rx="46" ry="5" fill="rgba(43,33,24,.2)"/>' +
      '<rect x="20" y="76" width="88" height="18" rx="9" fill="#6f7f8a" stroke="' + INK + '" stroke-width="3.500"/>' +
      '<path d="M28 82h72M28 88h72" stroke="#4d5b64" stroke-width="2" stroke-dasharray="3 4"/>' +
      '<circle cx="38" cy="85" r="6.500" fill="#a7b6bf" stroke="' + INK + '" stroke-width="2.500"/><circle cx="62" cy="85" r="6.500" fill="#a7b6bf" stroke="' + INK + '" stroke-width="2.500"/><circle cx="86" cy="85" r="6.500" fill="#a7b6bf" stroke="' + INK + '" stroke-width="2.500"/>' +
      '<ellipse cx="44" cy="54" rx="22" ry="29" fill="' + body + '" stroke="' + INK + '" stroke-width="3.500"/>' +
      '<rect x="44" y="25" width="30" height="58" fill="' + body + '"/><path d="M44 25h30M44 83h30" stroke="' + INK + '" stroke-width="3.500"/>' +
      '<ellipse cx="74" cy="54" rx="22" ry="29" fill="#f1c36e" stroke="' + INK + '" stroke-width="3.500"/>' +
      '<ellipse cx="74" cy="55" rx="13" ry="18" fill="#fff" stroke="' + INK + '" stroke-width="3"/>' +
      '<path d="M74 44.500l3.200 6.600 7.300.9-5.400 5 1.500 7.200-6.600-3.700-6.600 3.700 1.500-7.200-5.400-5 7.300-.9z" fill="#d97eb8" stroke="' + INK + '" stroke-width="1.800" stroke-linejoin="round"/>' +
      '<rect x="22" y="44" width="22" height="14" rx="7" fill="' + INK + '"/><ellipse cx="29" cy="51" rx="2.800" ry="4.500" fill="#22dd99"/><ellipse cx="37" cy="51" rx="2.800" ry="4.500" fill="#22dd99"/>' +
      '<path d="M72 25v-6" stroke="' + INK + '" stroke-width="3.500" stroke-linecap="round"/>' +
      '<path d="M56 19h32L72 1z" fill="#19c8f5" stroke="' + INK + '" stroke-width="3.500" stroke-linejoin="round"/>' +
      '<path d="M61 15.500 79 8M66 9.500 76 5" stroke="#ffe400" stroke-width="3" stroke-linecap="round"/>' +
      '</svg>';
  }
  function robot() { // コンピューター
    return '<svg viewBox="0 0 124 104"><ellipse cx="62" cy="98" rx="40" ry="5" fill="rgba(43,33,24,.2)"/>' +
      '<path d="M62 12v14" stroke="' + INK + '" stroke-width="4" stroke-linecap="round"/><circle cx="62" cy="10" r="6" fill="#d97eb8" stroke="' + INK + '" stroke-width="3"/>' +
      '<rect x="24" y="26" width="76" height="56" rx="14" fill="#8be6ff" stroke="' + INK + '" stroke-width="3.500"/>' +
      '<rect x="34" y="38" width="56" height="32" rx="10" fill="' + INK + '"/><ellipse cx="50" cy="54" rx="5" ry="8" fill="#22dd99"/><ellipse cx="74" cy="54" rx="5" ry="8" fill="#22dd99"/>' +
      '<rect x="10" y="44" width="14" height="22" rx="6" fill="#ffe400" stroke="' + INK + '" stroke-width="3"/><rect x="100" y="44" width="14" height="22" rx="6" fill="#ffe400" stroke="' + INK + '" stroke-width="3"/>' +
      '<rect x="34" y="82" width="56" height="10" rx="5" fill="#6f7f8a" stroke="' + INK + '" stroke-width="3"/></svg>';
  }
  function nest(svg, x, y, w, h) { return svg.replace('<svg viewBox', '<svg x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" viewBox'); }
  var ART = {
    race: function () { // 2人が たからへ むかう
      return '<svg viewBox="0 0 200 110"><path d="M10 100h180" stroke="' + INK + '" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/>' +
        nest(mascot('#e08524'), 4, 6, 66, 55) + nest(mascot('#2f8be0'), 30, 50, 66, 55) +
        '<path d="M104 56h30m-8-8 8 8-8 8" stroke="' + INK + '" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<g transform="translate(138 24) scale(2.700)">' + gemSvg('#19c8f5').replace('<svg viewBox="0 0 24 24">', '').replace('</svg>', '') + '</g></svg>';
    },
    count: function () { // たから10こ
      var g = '', xs = [8, 46, 84, 122, 160];
      for (var r = 0; r < 2; r++) for (var i = 0; i < 5; i++) {
        g += '<g transform="translate(' + (xs[i] + (r ? 14 : 0) - 6) + ' ' + (r ? 52 : 12) + ') scale(1.500)">' + gemSvg(['#19c8f5', '#ffe400', '#d97eb8', '#22dd99', '#f5a64a'][(i + r * 2) % 5]).replace('<svg viewBox="0 0 24 24">', '').replace('</svg>', '') + '</g>';
      }
      return '<svg viewBox="0 0 200 110">' + g + '</svg>';
    },
    solo: function () {
      return '<svg viewBox="0 0 200 110">' + nest(mascot('#e08524'), 40, 6, 100, 84) +
        '<g transform="translate(142 56) scale(2.200)">' + gemSvg('#ffe400').replace('<svg viewBox="0 0 24 24">', '').replace('</svg>', '') + '</g></svg>';
    },
    cpu: function () { return robot(); },
    friends: function () { return '<svg viewBox="0 0 200 110">' + nest(mascot('#e08524'), 4, 8, 98, 82) + nest(mascot('#2f8be0'), 98, 8, 98, 82) + '</svg>'; }
  };
  // 部品の絵（ボタンなど）
  function chev(c, o) { // 上むきの やじるし2つ
    var d = 'M10 30 24 16l14 14M10 44 24 30l14 14';
    return '<path d="' + d + '" fill="none" stroke="' + INK + '" stroke-width="' + (o + 5) + '" stroke-linecap="round" stroke-linejoin="round"/><path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="' + o + '" stroke-linecap="round" stroke-linejoin="round"/>';
  }
  var SETICO = {
    fwd: '<svg viewBox="0 0 48 56">' + chev('#fff', 7) + '<path d="M24 2 37 16H11z" fill="#fff" stroke="' + INK + '" stroke-width="3.500" stroke-linejoin="round"/></svg>',
    jump: '<svg viewBox="0 0 64 64"><rect x="12" y="56" width="40" height="6" rx="3" fill="#a7b6bf" stroke="' + INK + '" stroke-width="2.500"/>' +
      '<path d="M22 54 42 49 22 44 42 39 22 34" fill="none" stroke="' + INK + '" stroke-width="5.500" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 54 42 49 22 44 42 39 22 34" fill="none" stroke="#fff" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M32 3 47 20H38v12H26V20H17z" fill="#fff" stroke="' + INK + '" stroke-width="3.500" stroke-linejoin="round"/></svg>',
    attack: '<svg viewBox="0 0 64 64"><rect x="44" y="12" width="17" height="40" rx="3" fill="#d9b98c" stroke="' + INK + '" stroke-width="3.500"/><path d="M44 26h17M44 40h17M52 12v14M52 40v12" stroke="' + INK + '" stroke-width="2"/>' +
      '<path d="M3 32 38 15v34z" fill="#19c8f5" stroke="' + INK + '" stroke-width="3.500" stroke-linejoin="round"/><path d="M14 38 26 22M21 42 33 27M28 46 36 36" stroke="#ffe400" stroke-width="3.500" stroke-linecap="round"/>' +
      '<path d="M41 6 45 1M52 6V0M60 8l4-4" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>',
    drilljump: '<svg viewBox="0 0 64 64"><rect x="4" y="52" width="56" height="10" rx="3" fill="#d9b98c" stroke="' + INK + '" stroke-width="3.500"/><path d="M22 52v10M42 52v10" stroke="' + INK + '" stroke-width="2"/>' +
      '<path d="M18 22h28L32 54z" fill="#19c8f5" stroke="' + INK + '" stroke-width="3.500" stroke-linejoin="round"/><path d="M23 29 41 25M27 38 38 35" stroke="#ffe400" stroke-width="3.500" stroke-linecap="round"/>' +
      '<path d="M10 20A24 22 0 0 1 54 20" fill="none" stroke="' + INK + '" stroke-width="8" stroke-linecap="round"/><path d="M10 20A24 22 0 0 1 54 20" fill="none" stroke="#fff" stroke-width="3.500" stroke-linecap="round"/>' +
      '<path d="M45 9 56 19 41 22z" fill="#fff" stroke="' + INK + '" stroke-width="2.500" stroke-linejoin="round"/></svg>',
    swipe: '<svg viewBox="0 0 48 48"><path d="M4 24h40M12 15 4 24l8 9M36 15l8 9-8 9" fill="none" stroke="' + INK + '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="24" r="7" fill="#d97eb8" stroke="' + INK + '" stroke-width="3"/></svg>',
    bw: '<svg viewBox="0 0 48 48"><rect x="3" y="6" width="42" height="36" rx="5" fill="#fff" stroke="' + INK + '" stroke-width="3"/><path d="M24 6h16a5 5 0 0 1 5 5v26a5 5 0 0 1-5 5H24z" fill="#222"/><circle cx="14" cy="18" r="4" fill="#222"/><path d="M8 36l8-8 5 5" fill="none" stroke="#222" stroke-width="3.500" stroke-linecap="round"/></svg>',
    trophy: '<svg viewBox="0 0 48 48"><path d="M14 5h20v14a10 10 0 0 1-20 0z" fill="#ffe400" stroke="' + INK + '" stroke-width="3"/><path d="M14 9H6c0 8 3 12 9 13M34 9h8c0 8-3 12-9 13" fill="none" stroke="' + INK + '" stroke-width="3"/><rect x="21" y="29" width="6" height="8" fill="#e08524" stroke="' + INK + '" stroke-width="2"/><rect x="14" y="37" width="20" height="6" rx="2" fill="#e08524" stroke="' + INK + '" stroke-width="2.500"/></svg>',
    clock: '<svg viewBox="0 0 48 48"><circle cx="24" cy="26" r="19" fill="#fff" stroke="' + INK + '" stroke-width="4"/><path d="M24 14v13l8 5" fill="none" stroke="' + INK + '" stroke-width="4.500" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 4h14" stroke="' + INK + '" stroke-width="4.500" stroke-linecap="round"/></svg>',
    gem: gemSvg('#19c8f5')
  };
  // 難しさの絵：かめ・うさぎ・ロケット
  var LVPIC = {
    easy: '<svg viewBox="0 0 64 64"><ellipse cx="30" cy="38" rx="20" ry="15" fill="#4cc26b" stroke="' + INK + '" stroke-width="3"/><path d="M18 36h24M30 24v26M22 28l-4 16M38 28l4 16" stroke="#2a8a48" stroke-width="2.500" fill="none"/><circle cx="54" cy="36" r="8" fill="#8ee0a5" stroke="' + INK + '" stroke-width="3"/><circle cx="56" cy="34" r="2" fill="' + INK + '"/><rect x="16" y="48" width="8" height="8" rx="3" fill="#8ee0a5" stroke="' + INK + '" stroke-width="2"/><rect x="36" y="48" width="8" height="8" rx="3" fill="#8ee0a5" stroke="' + INK + '" stroke-width="2"/></svg>',
    normal: '<svg viewBox="0 0 64 64"><ellipse cx="26" cy="22" rx="5" ry="14" fill="#fff" stroke="' + INK + '" stroke-width="3"/><ellipse cx="40" cy="22" rx="5" ry="14" fill="#fff" stroke="' + INK + '" stroke-width="3"/><circle cx="33" cy="44" r="16" fill="#fff" stroke="' + INK + '" stroke-width="3"/><circle cx="27" cy="41" r="2.500" fill="' + INK + '"/><circle cx="39" cy="41" r="2.500" fill="' + INK + '"/><circle cx="33" cy="47" r="2.500" fill="#d97eb8"/></svg>',
    hard: '<svg viewBox="0 0 64 64"><path d="M32 4c9 8 12 20 10 36H22C20 24 23 12 32 4z" fill="#fff" stroke="' + INK + '" stroke-width="3"/><circle cx="32" cy="26" r="6" fill="#8be6ff" stroke="' + INK + '" stroke-width="3"/><path d="M22 34 12 46l10-2zM42 34l10 12-10-2z" fill="#e08524" stroke="' + INK + '" stroke-width="2.500"/><path d="M26 42h12l-6 18z" fill="#ffe400" stroke="' + INK + '" stroke-width="2.500"/></svg>'
  };
  // 見本（イラスト）の小さな絵。名前が分かるものだけ
  var ILLUST = {
    'いえ': '<svg viewBox="0 0 48 48"><path d="M24 6 5 24h6v18h26V24h6z" fill="none" stroke="#222" stroke-width="4" stroke-linejoin="round"/><rect x="20" y="28" width="8" height="14" fill="#222"/></svg>',
    'さかな': '<svg viewBox="0 0 48 48"><path d="M5 24c8-12 22-12 30 0-8 12-22 12-30 0zM35 24l9-9v18z" fill="none" stroke="#222" stroke-width="4" stroke-linejoin="round"/><circle cx="14" cy="22" r="2.500" fill="#222"/></svg>',
    'くるま': '<svg viewBox="0 0 48 48"><path d="M4 32v-8l6-2 6-8h16l6 8 6 2v8z" fill="none" stroke="#222" stroke-width="4" stroke-linejoin="round"/><circle cx="14" cy="34" r="5" fill="#fff" stroke="#222" stroke-width="4"/><circle cx="34" cy="34" r="5" fill="#fff" stroke="#222" stroke-width="4"/></svg>',
    'はな': '<svg viewBox="0 0 48 48"><circle cx="24" cy="14" r="7" fill="none" stroke="#222" stroke-width="3.500"/><circle cx="14" cy="22" r="7" fill="none" stroke="#222" stroke-width="3.500"/><circle cx="34" cy="22" r="7" fill="none" stroke="#222" stroke-width="3.500"/><circle cx="24" cy="24" r="4" fill="#222"/><path d="M24 30v14" stroke="#222" stroke-width="4"/></svg>',
    'ほし': '<svg viewBox="0 0 48 48"><path d="M24 4l6 14 14 1-11 9 4 14-13-8-13 8 4-14L4 19l14-1z" fill="none" stroke="#222" stroke-width="4" stroke-linejoin="round"/></svg>',
    'ロケット': '<svg viewBox="0 0 48 48"><path d="M24 4c7 6 9 16 7 28H17C15 20 17 10 24 4z" fill="none" stroke="#222" stroke-width="4" stroke-linejoin="round"/><circle cx="24" cy="19" r="4" fill="#222"/><path d="M17 26 9 38l8-2M31 26l8 12-8-2M20 38l4 8 4-8" fill="none" stroke="#222" stroke-width="3.500" stroke-linejoin="round"/></svg>'
  };
  // カメラの絵。シーカーの色は自分の色（ゲストは青）
  function camIcon(m, color) {
    var c = color || PLAYERS[0].color;
    if (m === 0) // め：自分の目で見る
      return '<svg viewBox="0 0 48 48"><path d="M3 24C10 12 38 12 45 24 38 36 10 36 3 24z" fill="#fff" stroke="' + INK + '" stroke-width="3.500"/><circle cx="24" cy="24" r="8.500" fill="#22dd99" stroke="' + INK + '" stroke-width="2.500"/><circle cx="21" cy="21" r="2.800" fill="#fff"/></svg>';
    if (m === 1) // おいかけ：シーカーを うしろから おいかけて見る
      return mascot(c);
    // そら：真上から地図ぜんぶを見る
    return '<svg viewBox="0 0 48 48"><rect x="4" y="6" width="40" height="36" rx="4" fill="#fff" stroke="' + INK + '" stroke-width="3.500"/><path d="M4 18h24v10h14M18 6v12M30 28v14" stroke="' + INK + '" stroke-width="3.500" fill="none"/><rect x="9" y="30" width="9" height="9" rx="2" fill="' + c + '" stroke="' + INK + '" stroke-width="2"/><circle cx="37" cy="14" r="4" fill="#ffe400" stroke="' + INK + '" stroke-width="2"/></svg>';
  }
  var SAD = '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#ffe400" stroke="' + INK + '" stroke-width="4"/><circle cx="22" cy="26" r="3.500" fill="' + INK + '"/><circle cx="42" cy="26" r="3.500" fill="' + INK + '"/><path d="M20 46q12-12 24 0" stroke="' + INK + '" stroke-width="4" fill="none" stroke-linecap="round"/></svg>';
  var HAPPY = '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#8ee0a5" stroke="' + INK + '" stroke-width="4"/><circle cx="22" cy="26" r="3.500" fill="' + INK + '"/><circle cx="42" cy="26" r="3.500" fill="' + INK + '"/><path d="M20 38q12 12 24 0" stroke="' + INK + '" stroke-width="4" fill="none" stroke-linecap="round"/></svg>';

  // ---------------- 状態 ----------------
  var state = 'boot', sub = 'how';
  var gameMode = 'solo';          // 'race'（どっちが はやい？）| 'count'（どっちが おおい？）| 'solo'（ひとりで れんしゅう）
  var opp = '';                   // 'cpu' | 'net' | ''（ひとり）
  var netRole = '', netOn = false, netTok = 0, netConnected = false, joined = false;
  var code = '';
  var sel = null, loading = false;
  var map = null, myIndex = 0, camMode = 1, running = false, modalOpen = false;
  var pressed = {}, guard = false, hostRetry = 0, recorded = false, ended = false, modalKind = 'quit', sw = null, tipTimer = 0;
  var navKey = '', noticeTimer = 0, popTimer = 0;
  var timeLeft = COUNT_SEC, shownSec = -1, scores = [0, 0], totalTreasure = 1, raceSent = false;
  var lastT = 0, rafId = 0, curLevel = 'normal';
  var els = {};

  // ---------------- 共通のボタン登録 ----------------
  function stopEv(e) { e.stopPropagation(); e.preventDefault(); }
  function tap(el, fn) {
    var armed = false;
    el.addEventListener('pointerdown', function (e) { stopEv(e); armed = true; el.classList.add('down'); unlock(); });
    el.addEventListener('pointerup', function (e) {
      stopEv(e); var was = armed; armed = false; el.classList.remove('down');
      if (was) { sfx('tap'); fn(e); }
    });
    function off(e) { stopEv(e); armed = false; el.classList.remove('down'); }
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
  // 押している間だけ効く操作ボタン。指ごとに別々に動くので、「すすむ」を押しながら ほかのボタンも同時に押せる
  function hold(el, act) {
    var pid = null;
    el.addEventListener('pointerdown', function (e) {
      stopEv(e); unlock();
      if (modalOpen) return;
      pid = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      press(act, true);
    });
    function up(e) { stopEv(e); if (pid === null || e.pointerId === pid) { pid = null; press(act, false); } }
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', function (e) { if (pid !== null && e.pointerId === pid) { pid = null; press(act, false); } });
    el.addEventListener('click', stopEv);
    el.addEventListener('contextmenu', stopEv);
  }

  // ---------------- ロゴ「見つけて！PixSee」 ----------------
  function logoHTML() {
    var L = [['P', '#e08524'], ['i', '#19c8f5'], ['x', '#ffe400'], ['S', '#d97eb8'], ['e', '#22dd99'], ['e', '#e08524']];
    var tsp = L.map(function (l) { return '<tspan fill="' + l[1] + '">' + l[0] + '</tspan>'; }).join('');
    return '<svg class="logo" viewBox="0 0 640 240" role="img" aria-label="見つけて！PixSee">' +
      '<defs><pattern id="stripe" width="34" height="34" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><rect width="34" height="34" fill="#19c8f5"/><rect y="0" width="34" height="9" fill="#ffe400"/></pattern></defs>' +
      '<g transform="translate(150 6)"><rect x="0" y="0" width="250" height="68" rx="34" fill="url(#stripe)" stroke="' + INK + '" stroke-width="8"/>' +
      '<rect x="14" y="10" width="222" height="48" rx="24" fill="#fff4d6" stroke="' + INK + '" stroke-width="4"/>' +
      '<text x="125" y="48" text-anchor="middle" font-size="40" font-weight="900" fill="#e08524" stroke="' + INK + '" stroke-width="1.500">見つけて！</text></g>' +
      '<g font-family="inherit" font-weight="900" font-size="150" text-anchor="middle" stroke-linejoin="round">' +
      '<text x="262" y="206" fill="' + INK + '" stroke="' + INK + '" stroke-width="30">PixSee</text>' +
      '<text x="262" y="194" stroke="' + INK + '" stroke-width="22" paint-order="stroke" stroke-linejoin="round">' + tsp + '</text></g>' +
      '<g transform="translate(560 112)"><ellipse cx="0" cy="62" rx="48" ry="6" fill="rgba(43,33,24,.2)"/>' +
      '<path d="M-26 -30h52L0 -92z" fill="#19c8f5" stroke="' + INK + '" stroke-width="6" stroke-linejoin="round"/><path d="M-14 -40 14 -62M-8 -56 8 -68" stroke="#ffe400" stroke-width="6" stroke-linecap="round"/>' +
      '<path d="M0 -30v12" stroke="' + INK + '" stroke-width="6" stroke-linecap="round"/>' +
      '<ellipse cx="0" cy="22" rx="48" ry="52" fill="#f1c36e" stroke="' + INK + '" stroke-width="6.500"/><ellipse cx="0" cy="23" rx="29" ry="35" fill="#fff" stroke="' + INK + '" stroke-width="5"/>' +
      '<path d="M0 0l7.400 15.400 16.800 2-12.400 11.500 3.400 16.600L0 42.400l-15.200 8.100 3.400-16.600L-24.200 22.500l16.800-2z" fill="#d97eb8" stroke="' + INK + '" stroke-width="3.500" stroke-linejoin="round"/></g>' +
      '</svg>';
  }
  function buildLogos() {
    var list = doc.querySelectorAll('[data-logo]');
    for (var i = 0; i < list.length; i++) {
      list[i].innerHTML = logoHTML();
      list[i].style.setProperty('--k', list[i].getAttribute('data-logo'));
    }
    var ms = doc.querySelectorAll('[data-mascot]');
    for (var j = 0; j < ms.length; j++) ms[j].innerHTML = mascot(ms[j].getAttribute('data-mascot'));
  }

  // ---------------- 進行ボタン #nav ----------------
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
    if (state === 'quit') return [{ label: 'はじめから', icon: 'home', kind: 'primary', fn: function () { go('title'); } }];
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

  // ---------------- 画面遷移 ----------------
  function go(name) {
    var from = state;
    if (from === 'play' && name !== 'play') releaseAll();
    if (name === 'title' || name === 'quit') { stopGame(); closeNet(); gameMode = 'solo'; opp = ''; sel = null; loading = false; hideNotice(); }
    if (name === 'ending') stopGame();
    state = name;
    doc.body.setAttribute('data-state', name);
    if (name !== 'setting') sub = 'how';
    if (from === 'play' && name !== 'play') { sw = null; hideTip(); }
    if (name === 'title') renderRecChip();
    if (name === 'ending') fillEnding.apply(null, [].slice.call(arguments, 1));
    renderNav();
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

  // 流れ：タイトル → あそびかた → （ひとり以外）だれと？ →（コンピューター）難しさ → 地図 → しゅっぱつ
  function startHow() { setMode('solo'); opp = ''; sel = null; loading = false; netRole = ''; enterSetting('how'); }
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
  // 結果のあと「もういちど」：コンピューター・ひとりは おなじ あそびかたで ちずえらびへ。ともだちは あそびかたえらびへ
  function again() {
    if (opp === 'net') { startHow(); return; }
    enterSetting('pick'); goPick();
  }

  // ---------------- 難しさえらび ----------------
  function renderLevels() {
    var list = doc.querySelectorAll('.lvcard');
    for (var i = 0; i < list.length; i++) {
      var lv = list[i].getAttribute('data-level');
      list[i].querySelector('.lvpic').innerHTML = LVPIC[lv];
      var k = gameMode === 'count' ? 'count' : 'race';
      list[i].querySelector('em').innerHTML = recLines(k, recOf(k, 'cpu', lv)).slice(0, 2).join('<br>');
      list[i].classList.toggle('on', settings.level === lv);
    }
  }
  function chooseLevel(lv) {
    if (LEVELS.indexOf(lv) < 0) return;
    settings.level = lv; saveSettings(); renderLevels();
    goPick();
  }

  // ---------------- せってい ----------------
  function renderSettings() {
    var segs = doc.querySelectorAll('.seg button[data-set]');
    for (var i = 0; i < segs.length; i++) {
      var k = segs[i].getAttribute('data-set'), v = segs[i].getAttribute('data-val') === '1';
      var on = (settings[k] === v);
      segs[i].classList.toggle('on', on);
      segs[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    var h = function (id, t) { $(id).textContent = t; };
    h('hint-swipeRev', settings.swipeRev ? 'みぎへ なぞると ひだりを むくよ' : 'みぎへ なぞると みぎを むくよ');
    h('hint-binary', settings.binary ? 'しろと くろの 2いろに するよ' : 'いろの こさで ちずに するよ');
    var t = recTotals();
    h('hint-record', 'ぜんぶで ' + t.all + 'かい あそんだよ（きみ ' + t.me + '・あいて ' + t.opp + '・おなじ ' + t.same + '）');
  }
  function setOpt(k, v) { settings[k] = v; saveSettings(); renderSettings(); }
  function renderRecChip() {
    var t = recTotals();
    els.recchip.innerHTML = '<span class="rc-ico">' + SETICO.trophy + '</span><b>くらべっこ</b><span class="rc-n"></span>';
    els.recchip.querySelector('.rc-n').textContent = 'きみ ' + t.me + ' ・ あいて ' + t.opp + ' ・ おなじ ' + t.same;
  }
  function resetRecord() { record = defaultRecord(); saveRecord(); renderSettings(); renderRecChip(); renderLevels(); }

  // ---------------- 地図えらび ----------------
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
      list.forEach(function (p) {
        var c = doc.createElement('button');
        c.type = 'button'; c.tabIndex = -1; c.className = 'card ' + cls; c.setAttribute('data-id', p.id);
        var th = cls === 'illust' ? thumb(p.id) : '';
        c.innerHTML = (th ? '<i class="ic"><img alt="" src="' + th + '"></i>' : (cls === 'illust' && ILLUST[p.title] ? '<i class="ic">' + ILLUST[p.title] + '</i>' : '')) + '<span class="kan"></span><span class="yomi"></span>';
        c.querySelector('.kan').textContent = p.title;
        c.querySelector('.yomi').textContent = cls === 'illust' ? '' : (p.reading || '');
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
    // ファイル選択欄だけは既定動作を止めない（止めると選択画面が開かない）。ただし他へ伝わらないよう止める。
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
    for (var i = 0; i < list.length; i++) {
      list[i].classList.toggle('on', !!(sel && sel.id === list[i].getAttribute('data-id')));
    }
  }
  function renderPreview(msg) {
    var p = els.preview, h = '';
    if (loading) h = '<div class="spin"></div><div class="hint">つくっているよ…</div>';
    else if (msg) h = '<div class="hint">' + msg + '</div>';
    else if (sel && sel.map) {
      h = (sel.map.picture ? '<img alt="">' : '') + '<div class="pt"></div><div class="py"></div>';
    } else h = '<div class="hint">すきな ちずを<br>えらんでね</div>';
    p.innerHTML = h;
    if (!loading && sel && sel.map && !msg) {
      var img = p.querySelector('img'); if (img) img.src = sel.map.picture;
      p.querySelector('.pt').textContent = sel.map.title || '';
      p.querySelector('.py').textContent = sel.map.reading || '';
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
    // 白黒モード：設定で「する」のとき、明るさ0.5で白（高さ0）と黒（高さ10）の2つに分ける
    var pr = call('MapGen', 'fromFile', file, { treasureCount: treasureCount(), binary: !!settings.binary });
    function done(m) {
      loading = false;
      if (m) sel = { id: 'file', map: m };
      markCards(); renderPreview(m ? '' : 'えを よみこめなかったよ<br>ほかの えを ためしてね'); renderNav();
    }
    if (pr && pr.then) pr.then(done, function () { done(null); }); else done(null);
  }

  // ---------------- 出発 ----------------
  function depart() {
    if (!sel || !sel.map) return;
    if (opp === 'net') {
      if (!netConnected) return;
      var enc = call('MapGen', 'encode', sel.map);
      call('Net', 'send', { t: 'map', map: enc, mode: gameMode });
      startGame(sel.map, 0, true, null);
    } else if (opp === 'cpu') startGame(sel.map, 0, false, { level: settings.level });
    else startGame(sel.map, 0, false, null);
  }

  // ---------------- 通信：へや ----------------
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
    var was = netConnected || netOn || netRole;
    netOn = false; netConnected = false; joined = false;
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
    call('Net', 'send', { t: 'hello', color: PLAYERS[0].color });
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
      call('Net', 'send', { t: 'hello', color: PLAYERS[1].color });
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

  // ---------------- Net の受け口（1回だけ登録） ----------------
  function onNetOpen() {
    if (state === 'setting' && netRole === 'host' && sub === 'code') hostConnected();
  }
  function netSend(o) { if (netOn && !guard) call('Net', 'send', o); }
  function onNetData(d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'map') {
      if (state === 'setting' && netRole === 'join') {
        var m = call('MapGen', 'decode', d.map);
        if (m) { netTok++; setMode(d.mode === 'count' ? 'count' : 'race'); opp = 'net'; startGame(m, 1, true, null); }
        else failNet('ちずが うけとれなかったよ');
      }
      return;
    }
    if (state !== 'play') return;
    var other = 1 - myIndex;
    if (d.t === 'st') call('World', 'applyRemoteState', other, d.s);
    else if (d.t === 'terrain') {
      guard = true; try { call('World', 'applyRemoteTerrain', d.cells); } finally { guard = false; }
    } else if (d.t === 'act') {
      call('World', 'applyRemoteAction', other, d.name);
    } else if (d.t === 'collect') {
      var ti = +d.ti || 0, who = (d.idx === 1) ? 1 : 0;
      guard = true; try { call('World', 'applyRemoteCollect', who, ti); } finally { guard = false; }
      refreshScores();
      if (gameMode === 'count') checkAllFound(); else endRace(who);
    } else if (d.t === 'end') {
      endCount(true);
    }
  }
  function onNetClose() {
    netConnected = false;
    if (state === 'play' && netOn) {
      netOn = false;
      call('World', 'dropRemote', 1 - myIndex); // あいてを 地図から消す
      showNotice('あいてが いなくなったよ　ひとりで つづけよう', true);
    } else if (state === 'setting' && opp === 'net') {
      failNet('あいてと つながらなくなったよ');
    }
    netOn = false;
  }
  // 'error' は Promise の reject と二重になるので、ここでは何も表示しない

  // ---------------- Play ----------------
  function startGame(m, idx, net, cpu) {
    map = m; myIndex = idx; netOn = !!net; recorded = false; ended = false; raceSent = false; sw = null;
    doc.body.setAttribute('data-mode', gameMode);
    curLevel = (opp === 'cpu') ? settings.level : '';
    totalTreasure = (m && m.treasures && m.treasures.length) || (gameMode === 'count' ? 10 : 1);
    scores = [0, 0]; timeLeft = COUNT_SEC; shownSec = -1; lastT = 0;
    renderHud();
    hideNotice();
    call('World', 'load', m, { myIndex: idx, players: PLAYERS, net: netOn, cpu: cpu || null, mode: gameMode });
    call('World', 'resetPitch');
    els.ptTitle.textContent = m.title || '';
    els.ptYomi.textContent = (m.reading && m.reading !== m.title) ? m.reading : '';
    camMode = 1; updateCam();
    doc.body.classList.add('camtop'); // 開始演出は真上から
    go('play');
    call('World', 'setCamera', camMode);
    call('World', 'start');
    running = true;
    applyPortraitPause();
    showTip();
  }
  function stopGame() {
    if (running) { running = false; call('World', 'stop'); }
  }
  function updateCam() {
    var col = PLAYERS[myIndex] ? PLAYERS[myIndex].color : PLAYERS[0].color, nx = (camMode + 1) % 3;
    // 押したら次になる視点だけを、絵と文字の両方で見せる（絵＝次の視点、文字＝「〜へ」）
    els.camIco.innerHTML = camIcon(nx, col);
    els.camLabel.textContent = CAM_GO[nx];
    els.cam.setAttribute('aria-label', 'おすと ' + CAM_LABEL[nx] + 'に なる');
  }
  function cycleCam() {
    var m = call('World', 'cycleCamera');
    camMode = (typeof m === 'number') ? m : (camMode + 1) % 3;
    updateCam();
  }
  // 知らせ：big なら大きく出して、4.5秒あとに小さくする。プレイが終わるまで出しつづける
  function showNotice(t, big) {
    clearTimeout(noticeTimer);
    els.notice.textContent = t; els.notice.classList.add('on');
    els.notice.classList.toggle('big', !!big);
    if (big) noticeTimer = setTimeout(function () { els.notice.classList.remove('big'); }, 4500);
  }
  function hideNotice() { clearTimeout(noticeTimer); els.notice.classList.remove('on'); els.notice.classList.remove('big'); }
  function showPop(t, mine) {
    var p = els.pop;
    p.textContent = t; p.classList.toggle('mine', !!mine);
    p.classList.remove('on'); void p.offsetWidth; p.classList.add('on');
    clearTimeout(popTimer);
    popTimer = setTimeout(function () { p.classList.remove('on'); }, 1400);
  }

  // ---- 宝を拾ったとき・おわり ----
  function curScores() {
    var s = call('World', 'scores');
    if (s && s.length >= 2) return [num(s[0]), num(s[1])];
    return [scores[0], scores[1]];
  }
  function refreshScores() {
    var s = curScores(); scores = s; renderHud();
  }
  function renderHud() {
    if (els.sMe) { els.sMe.textContent = scores[0]; els.sOp.textContent = scores[1]; }
  }
  function checkAllFound() {
    if (gameMode === 'count' && scores[0] + scores[1] >= totalTreasure) endCount(false);
  }
  function onCollect(idx, ti, sc) {
    if (state !== 'play') return;
    if (sc && sc.length >= 2) { scores = [num(sc[0]), num(sc[1])]; renderHud(); } else refreshScores();
    var mine = (idx === myIndex);
    if (mine && !guard) netSend({ t: 'collect', idx: idx, ti: ti | 0 });
    if (gameMode === 'count') {
      showPop(mine ? 'みつけた！' : 'あいてが みつけたよ', mine);
      checkAllFound();
    } else {
      if (mine) raceSent = true;
      endRace(idx);
    }
  }
  function onFound(idx) { // 互換：宝1つのモードで 最初に拾った人
    if (state !== 'play' || guard || gameMode === 'count') return;
    if (idx === myIndex && !raceSent) { raceSent = true; netSend({ t: 'collect', idx: idx, ti: 0 }); }
    endRace(idx);
  }
  function endRace(winner) {
    if (state !== 'play' || ended) return;
    ended = true;
    go('ending', { winner: winner === 1 ? 1 : 0 });
  }
  function endCount(fromNet) {
    if (state !== 'play' || ended) return;
    ended = true;
    var s = curScores();
    if (netOn && !fromNet) netSend({ t: 'end' });
    call('World', 'finish');
    go('ending', { scores: s });
  }
  function onTerrain(cells) { if (cells && cells.length) netSend({ t: 'terrain', cells: cells }); }
  function onAction(name) { netSend({ t: 'act', name: name }); }
  function onState(s) {
    if (guard || !netOn || state !== 'play') return;
    call('Net', 'send', { t: 'st', s: s });
  }

  // ---- 毎フレーム：のこり時間とソナー ----
  function isPortrait() { return !!(window.matchMedia && window.matchMedia('(orientation: portrait)').matches); }
  function fmtTime(sec) { var s = Math.max(0, Math.ceil(sec)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function updateTimer() {
    var sec = Math.max(0, Math.ceil(timeLeft));
    if (sec !== shownSec) { shownSec = sec; els.tVal.textContent = fmtTime(timeLeft); els.timer.classList.toggle('low', sec <= 30); }
  }
  function frame(t) {
    rafId = window.requestAnimationFrame(frame);
    if (state !== 'play') { lastT = 0; return; }
    var dt = lastT ? Math.min(0.25, Math.max(0, (t - lastT) / 1000)) : 0; lastT = t;
    if (gameMode === 'count' && !ended && !modalOpen && !isPortrait()) {
      timeLeft = Math.max(0, timeLeft - dt);
      updateTimer();
      if (timeLeft <= 0) endCount(false);
    }
    if (state === 'play') { drawSonar(t); if (gameMode === 'count') refreshScoresLight(); }
  }
  var scoreTick = 0;
  function refreshScoresLight() { // World.scores() を ときどき読んで、あいての数も ずれないようにする
    if (++scoreTick % 15) return;
    var s = call('World', 'scores');
    if (s && s.length >= 2 && (num(s[0]) !== scores[0] || num(s[1]) !== scores[1])) { scores = [num(s[0]), num(s[1])]; renderHud(); checkAllFound(); }
  }

  // ---- ソナー（左上の円形レーダー。上が いま向いている方向。自分は中央の矢印、宝は光る点、深いほどうすい） ----
  function drawSonar(t) {
    var cv = els.sonarCv; if (!cv || !cv.getContext) return;
    var g = cv.getContext('2d'), W = cv.width, c = W / 2, R = c - 10;
    var s = call('World', 'sonar', SONAR_R) || { heading: 0, items: [] };
    var fx, fz;
    if (s.forward && isFinite(s.forward.x) && isFinite(s.forward.z)) { fx = +s.forward.x; fz = +s.forward.z; }
    else { var h = +s.heading || 0; fx = Math.sin(h); fz = Math.cos(h); } // ヨー角：0のとき +z（さいしょの シーカーの前）
    var fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    g.clearRect(0, 0, W, W);
    // 盤
    var bg = g.createRadialGradient(c, c, 4, c, c, R);
    bg.addColorStop(0, 'rgba(26,86,96,.93)'); bg.addColorStop(1, 'rgba(12,48,60,.93)');
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fillStyle = bg; g.fill();
    g.save(); g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.clip();
    g.lineWidth = 2.5; g.strokeStyle = 'rgba(139,230,255,.5)';
    [0.5].forEach(function (k) { g.beginPath(); g.arc(c, c, R * k, 0, Math.PI * 2); g.setLineDash([6, 8]); g.stroke(); });
    g.setLineDash([]);
    g.beginPath(); g.moveTo(c, c - R); g.lineTo(c, c + R); g.moveTo(c - R, c); g.lineTo(c + R, c); g.strokeStyle = 'rgba(139,230,255,.28)'; g.stroke();
    // ぐるっと まわる走査線
    var a = ((t || 0) / 1800) % 1 * Math.PI * 2;
    var sg = g.createConicGradient ? g.createConicGradient(a - Math.PI / 2, c, c) : null;
    if (sg) { sg.addColorStop(0, 'rgba(139,230,255,0)'); sg.addColorStop(0.9, 'rgba(139,230,255,0)'); sg.addColorStop(1, 'rgba(139,230,255,.35)'); g.fillStyle = sg; g.fillRect(0, 0, W, W); }
    // 宝
    var items = s.items || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i]; if (!it) continue;
      var dx = +it.dx || 0, dz = +it.dz || 0;
      var sx = (dx * -fz + dz * fx), sy = -(dx * fx + dz * fz); // 上が いま向いている方向
      var d = Math.hypot(sx, sy); if (d > SONAR_R) { sx *= SONAR_R / d; sy *= SONAR_R / d; }
      var px = c + sx * R / SONAR_R, py = c + sy * R / SONAR_R;
      var depth = Math.max(0, +it.depth || 0), al = Math.max(0.28, 1 - depth * 0.2);
      var pulse = 1 + 0.18 * Math.sin((t || 0) / 220 + i);
      var rad = (depth <= 0 ? 12 : 9) * pulse;
      var gl = g.createRadialGradient(px, py, 0, px, py, rad * 2.4);
      gl.addColorStop(0, 'rgba(255,228,0,' + (al * 0.9).toFixed(2) + ')'); gl.addColorStop(1, 'rgba(255,228,0,0)');
      g.fillStyle = gl; g.beginPath(); g.arc(px, py, rad * 2.4, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(px, py, rad * 0.62, 0, Math.PI * 2); g.fillStyle = 'rgba(255,248,190,' + al.toFixed(2) + ')'; g.fill();
      g.lineWidth = 2.5; g.strokeStyle = 'rgba(43,33,24,' + al.toFixed(2) + ')'; g.stroke();
    }
    g.restore();
    // 自分（中央の矢印。上むき）
    g.save(); g.translate(c, c);
    g.beginPath(); g.moveTo(0, -17); g.lineTo(12, 13); g.lineTo(0, 7); g.lineTo(-12, 13); g.closePath();
    g.fillStyle = '#e08524'; g.fill(); g.lineWidth = 4; g.strokeStyle = INK; g.lineJoin = 'round'; g.stroke();
    g.restore();
    // ふち（クリーム色とこい線）と 12時の しるし
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.lineWidth = 8; g.strokeStyle = '#fff4d6'; g.stroke();
    g.beginPath(); g.arc(c, c, R + 4, 0, Math.PI * 2); g.lineWidth = 3.500; g.strokeStyle = INK; g.stroke();
    g.beginPath(); g.moveTo(c, c - R + 2); g.lineTo(c - 9, c - R - 8); g.lineTo(c + 9, c - R - 8); g.closePath(); g.fillStyle = '#ffe400'; g.fill(); g.lineWidth = 3; g.strokeStyle = INK; g.stroke();
  }

  // ---------------- Ending（争いの言葉は使わない） ----------------
  var END_BOX_W = 84, END_BOX_H = 62; // .endpic の中に入る大きさ（cqmin。枠の太さぶん小さめ）
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
  function fillEnding(r) {
    r = r || {};
    var m = map || {}, who = OPP_NAME[opp] || 'あいて';
    var head = '', line = '', res = 'solo', kind = gameMode, rr = null;
    if (kind === 'race') {
      var meWon = (r.winner === myIndex);
      res = meWon ? 'me' : 'opp';
      head = meWon ? 'きみが はやかった！' : who + 'が はやかった';
      line = meWon ? 'たからを さきに みつけたよ！' : 'たからを さきに みつけられたよ';
      if (!recorded) { recorded = true; rr = recOf('race', opp, curLevel); rr[meWon ? 'me' : 'opp']++; saveRecord(); }
    } else if (kind === 'count') {
      var s = r.scores || scores, a = num(s[0]), b = num(s[1]);
      res = a > b ? 'me' : (a < b ? 'opp' : 'same');
      head = res === 'me' ? 'きみの ほうが おおかった！' : (res === 'opp' ? who + 'の ほうが おおかった' : 'おなじ！');
      line = 'きみは ' + a + 'こ、' + who + 'は ' + b + 'こ みつけたよ';
      if (!recorded) { recorded = true; rr = recOf('count', opp, curLevel); rr[res]++; saveRecord(); }
    } else {
      head = 'みつけた！';
      line = 'たからを ほりだしたよ！';
      if (!recorded) { recorded = true; record.solo.n++; saveRecord(); }
      rr = record.solo;
    }
    els.ending.setAttribute('data-res', res);
    els.ending.setAttribute('data-kind', kind);
    els.endFound.textContent = head;
    els.endFound.classList.toggle('long', head.length > 9);
    els.endWho.innerHTML = '<i class="gemi">' + gemSvg(kind === 'solo' ? '#ffe400' : '#19c8f5') + '</i><span></span>';
    els.endWho.querySelector('span').textContent = line;
    // 記録（モード × あいて × むずかしさ）
    var lab = KIND_NAME[kind] + (opp === 'cpu' ? '・' + OPP_NAME.cpu + '・' + LEVEL_NAME[curLevel] : (opp === 'net' ? '・' + OPP_NAME.net : ''));
    els.endRec.innerHTML = '<span class="rc-ico">' + SETICO.trophy + '</span><span class="rc-col"><b></b><span class="rc-n"></span></span>';
    els.endRec.querySelector('b').textContent = lab;
    els.endRec.querySelector('.rc-n').textContent = recLines(kind, rr || record.solo).join('　');
    els.endTitle.textContent = m.title || '';
    els.endTitle.style.display = m.title ? '' : 'none';
    els.endYomi.textContent = (m.reading && m.reading !== m.title) ? m.reading : '';
    els.endYomi.style.display = els.endYomi.textContent ? '' : 'none';
    if (m.picture) { showEndPic(m.picture); els.endPic.style.display = ''; } else els.endPic.style.display = 'none';
    var c = els.confetti; c.innerHTML = '';
    var cols = ['#d97eb8', '#ffe400', '#19c8f5', '#22dd99', '#f5a64a', '#e08524'];
    for (var i = 0; i < 26; i++) {
      var sp = doc.createElement('i');
      sp.style.left = (i * 3.9 + Math.random() * 3) + '%';
      sp.style.background = cols[i % cols.length];
      sp.style.animationDuration = (3 + Math.random() * 3) + 's';
      sp.style.animationDelay = (-Math.random() * 5) + 's';
      c.appendChild(sp);
    }
  }

  // ---------------- スワイプ（プレイ中の画面なぞり） ----------------
  // 左右：なぞった分だけ なめらかに向きが変わる（World.swipeTurn(画面はば比)）。上下：視点を少し上下。
  // ボタンの上から始めた操作は #swipe に届かない。ボタンを押している指とは 別の指で なぞれる。
  function newWorld() { return hasFn('World', 'sonar'); } // 新しい World なら 連続の swipeTurn、古いなら 90度ずつの代用
  function turnLegacy(d) {
    var act = d < 0 ? 'left' : 'right';
    call('World', 'press', act, true);
    setTimeout(function () { call('World', 'press', act, false); }, 40);
  }
  function unitPx() { var r = els.stage.getBoundingClientRect(); return Math.max(1, Math.min(r.width, r.height) / 100); }
  function swipeDown(e) {
    stopEv(e); unlock();
    if (state !== 'play' || modalOpen || sw) return;
    sw = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, axis: '', acc: 0 };
    try { els.swipe.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function swipeMove(e) {
    if (!sw || e.pointerId !== sw.id) return;
    stopEv(e);
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
      var d = mx / rw * (settings.swipeRev ? -1 : 1);
      if (newWorld() && hasFn('World', 'swipeTurn')) call('World', 'swipeTurn', d);
      else { // 古い World：一定いどう なぞるごとに 1回だけ向きを変える
        sw.acc += d; if (Math.abs(sw.acc) >= 0.12) { turnLegacy(sw.acc); sw.acc = 0; }
      }
    } else {
      var dd = e.clientY - sw.ly; sw.ly = e.clientY;
      if (dd) { hideTip(); call('World', 'nudgePitch', Math.max(-1, Math.min(1, -dd / (30 * u)))); } // 指を上へ＝視点が上へ
    }
  }
  function swipeUp(e) {
    if (!sw || e.pointerId !== sw.id) return;
    stopEv(e); sw = null;
  }
  function showTip() {
    clearTimeout(tipTimer); els.tip.classList.add('on');
    tipTimer = setTimeout(hideTip, 6500);
  }
  function hideTip() { clearTimeout(tipTimer); if (els.tip) els.tip.classList.remove('on'); }

  // ---------------- ホームとモーダル ----------------
  function openModal(kind) {
    if (modalOpen) return;
    modalKind = kind === 'reset' ? 'reset' : 'quit';
    $('m-title').textContent = modalKind === 'reset' ? 'きろくを ぜんぶ けしますか？' : 'おわりにしますか？';
    $('m-no-t').textContent = modalKind === 'reset' ? 'やめる' : 'いいえ';
    $('m-yes-t').textContent = modalKind === 'reset' ? 'けす' : 'はい';
    modalOpen = true; els.modal.classList.add('on'); sw = null;
    releaseAll();
    if (state === 'play') call('World', 'setPaused', true);
  }
  function closeModal() {
    if (!modalOpen) return;
    modalOpen = false; els.modal.classList.remove('on');
    if (state === 'play') applyPortraitPause();
  }
  function quitYes() {
    modalOpen = false; els.modal.classList.remove('on');
    if (modalKind === 'reset') { resetRecord(); return; }
    stopGame(); closeNet();
    go('quit');
  }
  function applyPortraitPause() {
    if (state !== 'play') return;
    call('World', 'setPaused', modalOpen || isPortrait());
  }

  // ---------------- キーボード（確認用） ----------------
  var KEYS = { ArrowUp: 'fwd', w: 'fwd', W: 'fwd', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
    ' ': 'jump', z: 'drillAttack', Z: 'drillAttack', x: 'drillJump', X: 'drillJump' };
  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (state === 'boot') { e.preventDefault(); if (!e.repeat) leaveBoot(); return; }
    if (modalOpen) {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
      return;
    }
    if (state === 'play') {
      var act = KEYS[e.key];
      if (act) { e.preventDefault(); if (!e.repeat) press(act, true); return; }
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); if (!e.repeat) cycleCam(); return; }
      if (e.key === 'Escape') { e.preventDefault(); openModal(); }
      return;
    }
    if (state === 'setting' && sub === 'keypad') {
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); keyIn(e.key); return; }
      if (e.key === 'Backspace') { e.preventDefault(); keyIn('del'); return; }
    }
    if (e.key === 'Enter') {
      var b = els.nav.querySelector('.nbtn');
      if (b) { e.preventDefault(); sfx('tap'); var it = navItems()[0]; if (it) it.fn(); }
    }
  }
  function onKeyUp(e) {
    var act = KEYS[e.key];
    if (act && state === 'play') { e.preventDefault(); press(act, false); }
  }

  function leaveBoot() {
    if (state !== 'boot') return;
    unlock(); sfx('tap');
    go('title');
  }

  // ---------------- 初期化 ----------------
  function init() {
    ['stage', 'nav', 'home', 'modal', 'setting', 'sethead', 'cards', 'preview', 'keypad', 'codein', 'codeshow', 'msgface', 'msgtext',
      'cam', 'notice', 'pop', 'confetti', 'swipe', 'tip', 'recchip', 'ending', 'timer'].forEach(function (id) { els[id] = $(id); });
    els.endFound = $('end-found'); els.endRec = $('end-rec');
    els.ptTitle = $('pt-title'); els.ptYomi = $('pt-yomi');
    els.camIco = $('cam-ico'); els.camLabel = $('cam-label');
    els.endWho = $('end-who'); els.endTitle = $('end-title'); els.endYomi = $('end-yomi'); els.endPic = $('end-pic');
    els.sonarCv = $('sonar-cv'); els.tVal = $('t-val'); els.sMe = $('s-me'); els.sOp = $('s-op');

    doc.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    ['gesturestart', 'gesturechange', 'gestureend', 'dblclick'].forEach(function (n) { doc.addEventListener(n, function (e) { e.preventDefault(); }); });
    doc.addEventListener('keydown', onKeyDown);
    doc.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseAll);
    if (window.matchMedia) {
      var mq = window.matchMedia('(orientation: portrait)');
      var h = function () { applyPortraitPause(); };
      if (mq.addEventListener) mq.addEventListener('change', h); else if (mq.addListener) mq.addListener(h);
    }

    settings = loadSettings(); record = loadRecord();
    buildLogos();
    buildKeypad();
    var icos = doc.querySelectorAll('[data-ico]');
    for (var ii = 0; ii < icos.length; ii++) icos[ii].innerHTML = SETICO[icos[ii].getAttribute('data-ico')] || '';
    var arts = doc.querySelectorAll('[data-art]');
    for (var aa = 0; aa < arts.length; aa++) { var f0 = ART[arts[aa].getAttribute('data-art')]; arts[aa].innerHTML = f0 ? f0() : ''; }
    renderCards(); renderPreview();
    renderLevels(); renderSettings(); renderRecChip();
    updateCam();

    // Boot：画面のどこでも
    tap($('boot'), leaveBoot);
    tap(els.home, function () { openModal('quit'); });
    tap($('m-no'), closeModal);
    tap($('m-yes'), quitYes);
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
      tap(b, function () { setOpt(b.getAttribute('data-set'), b.getAttribute('data-val') === '1'); });
    })(segs[j]);
    var lvs = doc.querySelectorAll('.lvcard');
    for (var q = 0; q < lvs.length; q++) (function (b) { tap(b, function () { chooseLevel(b.getAttribute('data-level')); }); })(lvs[q]);
    var hows = doc.querySelectorAll('.howcard');
    for (var hh = 0; hh < hows.length; hh++) (function (b) { tap(b, function () { chooseKind(b.getAttribute('data-kind')); }); })(hows[hh]);
    var whos = doc.querySelectorAll('[data-who]');
    for (var ww = 0; ww < whos.length; ww++) (function (b) { tap(b, function () { chooseWho(b.getAttribute('data-who')); }); })(whos[ww]);
    // スワイプ受け口（ボタンより下の層。ボタンの上から始めた操作はここへ来ない）
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
    call('World', 'on', 'collect', onCollect);
    call('World', 'on', 'found', onFound);
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
  }

  window.App = {
    // 確認用の手がかり（ゲームの進行には使わない）
    _found: function (idx) { if (gameMode === 'count') endCount(false); else endRace(idx === 1 ? 1 : 0); },
    _setTime: function (sec) { timeLeft = Math.max(0, +sec || 0); shownSec = -1; updateTimer(); }, // どっちが おおい？ の のこり時間を みじかくする
    _finish: function () { endCount(false); },
    _info: function () { return { mode: gameMode, opp: opp, level: curLevel, left: timeLeft, scores: scores.slice(), total: totalTreasure, ended: ended }; },
    go: function (name) { if (['boot', 'title', 'setting', 'play', 'ending', 'quit'].indexOf(name) >= 0) go(name); },
    get state() { return state; }
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})();
