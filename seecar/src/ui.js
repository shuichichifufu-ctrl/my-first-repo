// ui.js : 6ステート、ボタン、モーダル、操作ボタン、全体の配線。公開するのは window.App だけ。
// World / MapGen / Net / Sfx が無くても落ちないよう、すべて call() 経由で呼ぶ。
(function () {
  'use strict';
  var PLAYERS = [{ color: '#e53935' }, { color: '#1e88e5' }];
  var CAM_LABEL = ['め', 'おいかけ', 'そら']; // 視点の名前
  var CAM_GO = ['めへ', 'おいかけへ', 'そらへ'];  // カメラボタンの文字：おすと つぎに なる視点（絵と同じ） // 移動の「うしろ」とかぶらない名前
  var LEVELS = ['easy', 'normal', 'hard'];
  var LEVEL_NAME = { easy: 'やさしい', normal: 'ふつう', hard: 'むずかしい', net: 'つうしん' };
  var DEFAULT_ERR = 'つながらなかったよ。ばんごうを たしかめてね';
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
  function sfx(name) { call('Sfx', 'play', name); }
  function unlock() { call('Sfx', 'unlock'); }

  // ---------------- 設定と記録（localStorage。読めなくても既定値で動く） ----------------
  var KEY_SET = 'seecar.settings', KEY_REC = 'seecar.record';
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  function readJSON(k) { try { var t = lsGet(k); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
  function defaultSettings() { return { arrows: true, swipeRev: false, binary: false, level: 'normal' }; }
  function defaultRecord() {
    return { easy: { win: 0, lose: 0 }, normal: { win: 0, lose: 0 }, hard: { win: 0, lose: 0 }, net: { win: 0, lose: 0 } };
  }
  function loadSettings() {
    var d = defaultSettings(), o = readJSON(KEY_SET);
    if (o && typeof o === 'object') {
      if (typeof o.arrows === 'boolean') d.arrows = o.arrows;
      if (typeof o.swipeRev === 'boolean') d.swipeRev = o.swipeRev;
      if (typeof o.binary === 'boolean') d.binary = o.binary;
      if (LEVELS.indexOf(o.level) >= 0) d.level = o.level;
    }
    return d;
  }
  function loadRecord() {
    var d = defaultRecord(), o = readJSON(KEY_REC);
    if (o && typeof o === 'object') Object.keys(d).forEach(function (k) {
      var r = o[k];
      if (r && typeof r === 'object') {
        d[k].win = Math.max(0, Math.floor(+r.win) || 0);
        d[k].lose = Math.max(0, Math.floor(+r.lose) || 0);
      }
    });
    return d;
  }
  var settings = defaultSettings(), record = defaultRecord();
  function saveSettings() { lsSet(KEY_SET, JSON.stringify(settings)); }
  function saveRecord() { lsSet(KEY_REC, JSON.stringify(record)); }
  function recText(k) { var r = record[k] || { win: 0, lose: 0 }; return r.win + 'かち ' + r.lose + 'まけ'; }
  function applySettings() {
    doc.body.classList.toggle('noarrows', !settings.arrows);
  }

  var ICON = {
    play: '<svg viewBox="0 0 24 24"><path d="M6 3.500l15 8.500-15 8.500z"/></svg>',
    go: '<svg viewBox="0 0 24 24"><path d="M3 4l9 8-9 8zM12 4l9 8-9 8z"/></svg>',
    net: '<svg viewBox="0 0 24 24"><circle cx="5.500" cy="12" r="4"/><circle cx="18.500" cy="12" r="4"/><rect x="8" y="10.500" width="8" height="3"/></svg>',
    again: '<svg viewBox="0 0 24 24"><path d="M12 4V1L7 5.500 12 10V7a5.500 5.500 0 1 1-5.500 5.500H3.500A8.500 8.500 0 1 0 12 4z"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M12 3 1.500 12.500H5V21h5.500v-6h3v6H19v-8.500h3.500z"/></svg>',
    link: '<svg viewBox="0 0 24 24"><circle cx="5.500" cy="12" r="4"/><circle cx="18.500" cy="12" r="4"/><rect x="8" y="10.500" width="8" height="3"/></svg>',
    pic: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="3" fill="#ffd23f"/><circle cx="8" cy="10" r="2.400" fill="#ff5d8f"/><path d="M3 19l6-6 4 4 3-3 5 5z" fill="#3b8df0"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><path d="M19.400 13a7.500 7.500 0 0 0 0-2l2.100-1.600-2-3.500-2.500 1a7.500 7.500 0 0 0-1.700-1L14.900 3h-4l-.4 2.900a7.500 7.500 0 0 0-1.700 1l-2.500-1-2 3.500L6.400 11a7.500 7.500 0 0 0 0 2l-2.100 1.600 2 3.500 2.500-1a7.500 7.500 0 0 0 1.700 1l.4 2.900h4l.4-2.900a7.500 7.500 0 0 0 1.700-1l2.500 1 2-3.500zM12.900 15.500a3.500 3.500 0 1 1 0-7 3.500 3.500 0 0 1 0 7z"/></svg>',
    solo: '<svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-5 3.500-8 8-8s8 3 8 8z"/></svg>'
  };
  // 設定の絵
  var SETICO = {
    arrows: '<svg viewBox="0 0 48 48"><rect x="16" y="3" width="16" height="16" rx="4" fill="#ffd23f"/><rect x="16" y="29" width="16" height="16" rx="4" fill="#ffd23f"/><rect x="3" y="16" width="16" height="16" rx="4" fill="#ffd23f"/><rect x="29" y="16" width="16" height="16" rx="4" fill="#ffd23f"/><path d="M24 7l5 8h-10zM24 41l5-8h-10zM7 24l8-5v10zM41 24l-8-5v10z" fill="#1f5fd9"/></svg>',
    swipe: '<svg viewBox="0 0 48 48"><path d="M4 24h40M12 15 4 24l8 9M36 15l8 9-8 9" fill="none" stroke="#1f5fd9" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="24" r="7" fill="#ff5d8f" stroke="#fff" stroke-width="3"/></svg>',
    bw: '<svg viewBox="0 0 48 48"><rect x="3" y="6" width="42" height="36" rx="5" fill="#fff" stroke="#1f5fd9" stroke-width="3"/><path d="M24 6h16a5 5 0 0 1 5 5v26a5 5 0 0 1-5 5H24z" fill="#222"/><circle cx="14" cy="18" r="4" fill="#222"/><path d="M8 36l8-8 5 5" fill="none" stroke="#222" stroke-width="3.500" stroke-linecap="round"/></svg>',
    trophy: '<svg viewBox="0 0 48 48"><path d="M14 5h20v14a10 10 0 0 1-20 0z" fill="#ffd23f" stroke="#e59a00" stroke-width="2.500"/><path d="M14 9H6c0 8 3 12 9 13M34 9h8c0 8-3 12-9 13" fill="none" stroke="#e59a00" stroke-width="3"/><rect x="21" y="29" width="6" height="8" fill="#e59a00"/><rect x="14" y="37" width="20" height="6" rx="2" fill="#1f5fd9"/></svg>'
  };
  // 難しさの絵：かめ・うさぎ・ロケット
  var LVPIC = {
    easy: '<svg viewBox="0 0 64 64"><ellipse cx="30" cy="38" rx="20" ry="15" fill="#4cc26b" stroke="#fff" stroke-width="3"/><path d="M18 36h24M30 24v26M22 28l-4 16M38 28l4 16" stroke="#2a8a48" stroke-width="2.500" fill="none"/><circle cx="54" cy="36" r="8" fill="#8ee0a5" stroke="#fff" stroke-width="3"/><circle cx="56" cy="34" r="2" fill="#12327a"/><rect x="16" y="48" width="8" height="8" rx="3" fill="#8ee0a5"/><rect x="36" y="48" width="8" height="8" rx="3" fill="#8ee0a5"/></svg>',
    normal: '<svg viewBox="0 0 64 64"><ellipse cx="26" cy="22" rx="5" ry="14" fill="#fff" stroke="#ff8fb8" stroke-width="3"/><ellipse cx="40" cy="22" rx="5" ry="14" fill="#fff" stroke="#ff8fb8" stroke-width="3"/><circle cx="33" cy="44" r="16" fill="#fff" stroke="#ff8fb8" stroke-width="3"/><circle cx="27" cy="41" r="2.500" fill="#12327a"/><circle cx="39" cy="41" r="2.500" fill="#12327a"/><circle cx="33" cy="47" r="2.500" fill="#ff5d8f"/></svg>',
    hard: '<svg viewBox="0 0 64 64"><path d="M32 4c9 8 12 20 10 36H22C20 24 23 12 32 4z" fill="#fff" stroke="#1f5fd9" stroke-width="3"/><circle cx="32" cy="26" r="6" fill="#7ab8f5" stroke="#1f5fd9" stroke-width="3"/><path d="M22 34 12 46l10-2zM42 34l10 12-10-2z" fill="#ff5d5d" stroke="#fff" stroke-width="2"/><path d="M26 42h12l-6 18z" fill="#ffb703" stroke="#ff6a00" stroke-width="2.500"/></svg>'
  };
  // 見本（イラスト）の小さな絵。名前が分かるものだけ
  var ILLUST = {
    'いえ': '<svg viewBox="0 0 48 48"><path d="M24 6 5 24h6v18h26V24h6z" fill="none" stroke="#222" stroke-width="4" stroke-linejoin="round"/><rect x="20" y="28" width="8" height="14" fill="#222"/></svg>',
    'さかな': '<svg viewBox="0 0 48 48"><path d="M5 24c8-12 22-12 30 0-8 12-22 12-30 0zM35 24l9-9v18z" fill="none" stroke="#222" stroke-width="4" stroke-linejoin="round"/><circle cx="14" cy="22" r="2.500" fill="#222"/></svg>',
    'くるま': '<svg viewBox="0 0 48 48"><path d="M4 32v-8l6-2 6-8h16l6 8 6 2v8z" fill="none" stroke="#222" stroke-width="4" stroke-linejoin="round"/><circle cx="14" cy="34" r="5" fill="#fff" stroke="#222" stroke-width="4"/><circle cx="34" cy="34" r="5" fill="#fff" stroke="#222" stroke-width="4"/></svg>',
    'はな': '<svg viewBox="0 0 48 48"><circle cx="24" cy="14" r="7" fill="none" stroke="#222" stroke-width="3.500"/><circle cx="14" cy="22" r="7" fill="none" stroke="#222" stroke-width="3.500"/><circle cx="34" cy="22" r="7" fill="none" stroke="#222" stroke-width="3.500"/><circle cx="24" cy="24" r="4" fill="#222"/><path d="M24 30v14" stroke="#222" stroke-width="4"/></svg>',
    'ほし': '<svg viewBox="0 0 48 48"><path d="M24 4l6 14 14 1-11 9 4 14-13-8-13 8 4-14L4 19l14-1z" fill="none" stroke="#222" stroke-width="4" stroke-linejoin="round"/></svg>'
  };
  // カメラの絵。戦車の色は自分の色（ゲストは青）
  var LIGHT = { '#e53935': '#ff7a6e', '#1e88e5': '#7ab8f5' };
  function camIcon(m, color) {
    var c = color || PLAYERS[0].color, l = LIGHT[c] || '#ffffff';
    if (m === 0) // め（目）：自分の目で見る
      return '<svg viewBox="0 0 48 48"><path d="M3 24C10 12 38 12 45 24 38 36 10 36 3 24z" fill="#fff" stroke="#1f5fd9" stroke-width="3"/><circle cx="24" cy="24" r="8.500" fill="#1f5fd9"/><circle cx="21" cy="21" r="2.800" fill="#fff"/></svg>';
    if (m === 1) // おいかけ：戦車を後ろから追いかけて見る
      return '<svg viewBox="0 0 48 48"><rect x="12" y="26" width="24" height="9" rx="3" fill="' + c + '"/><rect x="16" y="19" width="16" height="9" rx="3" fill="' + l + '"/><rect x="29" y="13" width="14" height="4" rx="2" fill="#555" transform="rotate(-20 29 15)"/><rect x="9" y="33" width="30" height="7" rx="3.500" fill="#444"/><path d="M4 8h10l-3-4M14 8l-3 4" stroke="#1f5fd9" stroke-width="2.600" fill="none" stroke-linecap="round"/></svg>';
    // そら：真上から地図ぜんぶを見る
    return '<svg viewBox="0 0 48 48"><rect x="4" y="6" width="40" height="36" rx="4" fill="#fff" stroke="#1f5fd9" stroke-width="3"/><path d="M4 18h24v10h14M18 6v12M30 28v14" stroke="#222" stroke-width="3.500" fill="none"/><rect x="9" y="30" width="9" height="9" rx="2" fill="' + c + '"/><path d="M34 11l3 5 3-5-3 1z" fill="#ff4fb0"/><circle cx="37" cy="14" r="3.500" fill="#ff4fb0"/></svg>';
  }
  var SAD = '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#ffd23f" stroke="#fff" stroke-width="4"/><circle cx="22" cy="26" r="3.500" fill="#12327a"/><circle cx="42" cy="26" r="3.500" fill="#12327a"/><path d="M20 46q12-12 24 0" stroke="#12327a" stroke-width="4" fill="none" stroke-linecap="round"/></svg>';
  var HAPPY = '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#8ee0a5" stroke="#fff" stroke-width="4"/><circle cx="22" cy="26" r="3.500" fill="#12327a"/><circle cx="42" cy="26" r="3.500" fill="#12327a"/><path d="M20 38q12 12 24 0" stroke="#12327a" stroke-width="4" fill="none" stroke-linecap="round"/></svg>';

  // ---------------- 状態 ----------------
  var state = 'boot', sub = 'pick';
  var mode = 'solo';              // 'cpu'（CPUと対戦）| 'solo'（ひとりで れんしゅう）| 'net'（つうしん）
  var netRole = '', netOn = false, netTok = 0, netConnected = false, joined = false;
  var code = '';
  var sel = null, loading = false;
  var map = null, myIndex = 0, camMode = 1, running = false, modalOpen = false;
  var pressed = {}, guard = false, hostRetry = 0, recorded = false, modalKind = 'quit', sw = null, tipTimer = 0, flashTimer = 0;
  var navKey = '', noticeTimer = 0, boomTimer = 0;
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
  function hold(el, act) {
    el.addEventListener('pointerdown', function (e) { stopEv(e); unlock(); if (!modalOpen) press(act, true); });
    function up(e) { stopEv(e); press(act, false); }
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('click', stopEv);
    el.addEventListener('contextmenu', stopEv);
  }

  // ---------------- ロゴ ----------------
  function logoHTML() {
    return '<div class="logo"><div class="logo-top">見つめて見つけて</div><div class="logo-main">' +
      '<div class="star"><i class="s1"></i><i class="s2"></i><i class="s3"></i><b>ほ</b></div>' +
      '<div class="logo-name">シーカー</div></div><div class="logo-en">SEE-CAR</div></div>';
  }
  function buildLogos() {
    var list = doc.querySelectorAll('[data-logo]');
    for (var i = 0; i < list.length; i++) {
      list[i].innerHTML = logoHTML();
      list[i].firstChild.style.setProperty('--k', list[i].getAttribute('data-logo'));
    }
  }

  // ---------------- 進行ボタン #nav ----------------
  function navItems() {
    if (state === 'title') return [
      { label: 'はじめる', icon: 'play', kind: 'primary hero', cap: 'コンピューターと たいけつ', fn: startCpu },
      { brk: true },
      { label: 'ひとりで れんしゅう', icon: 'solo', kind: 'secondary sub', fn: startSolo },
      { label: 'つうしんで あそぶ', icon: 'net', kind: 'secondary sub', fn: startOnline },
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
      b.innerHTML = '<i>' + ICON[it.icon] + '</i><span>' + it.label + '</span>' + (it.cap ? '<small>' + it.cap + '</small>' : '');
      b.setAttribute('data-nav', it.label);
      tap(b, it.fn);
      els.nav.appendChild(b);
    });
  }

  // ---------------- 画面遷移 ----------------
  function go(name) {
    var from = state;
    if (from === 'play' && name !== 'play') releaseAll();
    if (name === 'title' || name === 'quit') { stopGame(); closeNet(); mode = 'solo'; sel = null; loading = false; hideNotice(); }
    if (name === 'ending') stopGame();
    state = name;
    doc.body.setAttribute('data-state', name);
    if (name !== 'setting') sub = 'pick';
    if (from === 'play' && name !== 'play') { sw = null; hideTip(); }
    if (name === 'title') renderRecChip();
    if (name === 'ending') fillEnding.apply(null, [].slice.call(arguments, 1));
    renderNav();
  }

  function setSub(s, headText) {
    sub = s;
    els.setting.setAttribute('data-sub', s);
    var heads = { choice: 'どちらに する？', code: 'この ばんごうを ともだちに おしえてね', keypad: 'ばんごうを いれてね', msg: 'ちょっと まってね', error: 'あれれ？', pick: 'ちずを えらんでね', level: 'むずかしさを えらんでね', opts: 'せってい' };
    els.sethead.textContent = headText || heads[s] || '';
    renderNav();
  }
  function enterSetting(s, head) { go('setting'); setSub(s, head); }

  function startCpu() { mode = 'cpu'; sel = null; loading = false; renderLevels(); enterSetting('level'); }
  function startSolo() { mode = 'solo'; sel = null; loading = false; renderCards(); renderPreview(); enterSetting('pick'); }
  function startOnline() { mode = 'net'; sel = null; netRole = ''; enterSetting('choice'); }
  function openSettings() { renderSettings(); enterSetting('opts'); }
  function backFromSetting() {
    if (sub === 'opts') { go('title'); return; }
    if (mode === 'cpu' && sub === 'pick') { sel = null; loading = false; renderLevels(); setSub('level'); return; }
    if (mode === 'net' && sub !== 'choice') { closeNet(); sel = null; loading = false; setSub('choice'); return; }
    go('title');
  }
  // 結果のあと「もういちど」：CPU戦なら おなじ むずかしさで ちずえらびへ。ひとり練習も ちずえらびへ。通信はタイトルへ
  function again() {
    if (mode === 'cpu' || mode === 'solo') { sel = null; loading = false; renderCards(); renderPreview(); enterSetting('pick'); }
    else go('title');
  }

  // ---------------- 難しさえらび ----------------
  function renderLevels() {
    var list = doc.querySelectorAll('.lvcard');
    for (var i = 0; i < list.length; i++) {
      var lv = list[i].getAttribute('data-level');
      list[i].querySelector('.lvpic').innerHTML = LVPIC[lv];
      list[i].querySelector('em').textContent = recText(lv);
      list[i].classList.toggle('on', settings.level === lv);
    }
  }
  function chooseLevel(lv) {
    if (LEVELS.indexOf(lv) < 0) return;
    settings.level = lv; saveSettings(); renderLevels();
    sel = null; loading = false; renderCards(); renderPreview();
    setSub('pick');
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
    h('hint-arrows', settings.arrows ? 'ボタンを ぜんぶ だすよ' : '「まえ」だけ のこるよ');
    h('hint-swipeRev', settings.swipeRev ? 'みぎへ なぞると ひだりを むくよ' : 'みぎへ なぞると みぎを むくよ');
    h('hint-binary', settings.binary ? 'しろと くろの 2いろに するよ' : 'いろの こさで ちずに するよ');
    var t = { win: 0, lose: 0 }; Object.keys(record).forEach(function (k) { t.win += record[k].win; t.lose += record[k].lose; });
    h('hint-record', 'ぜんぶで ' + t.win + 'かち ' + t.lose + 'まけ');
  }
  function setOpt(k, v) {
    settings[k] = v; saveSettings(); applySettings(); renderSettings();
  }
  function renderRecChip() {
    els.recchip.innerHTML = '<span class="rc-ico">' + SETICO.trophy + '</span><b></b><span class="rc-n"></span>';
    els.recchip.querySelector('b').textContent = LEVEL_NAME[settings.level];
    els.recchip.querySelector('.rc-n').textContent = recText(settings.level);
  }
  function addRecord(key, win) {
    if (!record[key]) record[key] = { win: 0, lose: 0 };
    record[key][win ? 'win' : 'lose']++;
    saveRecord();
  }
  function resetRecord() {
    record = defaultRecord(); saveRecord(); renderSettings(); renderRecChip(); renderLevels();
  }

  // ---------------- 地図えらび ----------------
  // 見本の元の絵を小さくして カードに出す（MapGen.presetCanvas があるとき。いちど作ったら使いまわす）
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
  function choosePreset(p) {
    if (loading) return;
    loading = true; sel = null; markCards(); renderPreview(); renderNav();
    setTimeout(function () {
      var m = null;
      try { m = call('MapGen', 'fromPreset', p.id); } catch (e) {}
      loading = false;
      if (m) sel = { id: p.id, map: m };
      markCards(); renderPreview(m ? '' : 'うまく つくれなかったよ'); renderNav();
    }, 40);
  }
  function chooseFile(file) {
    if (loading) return;
    loading = true; sel = null; markCards(); renderPreview(); renderNav();
    // 白黒モード：設定で「する」のとき、明るさ0.5で白（高さ0）と黒（高さ10）の2つに分ける
    var pr = settings.binary ? call('MapGen', 'fromFile', file, { binary: true }) : call('MapGen', 'fromFile', file);
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
    if (mode === 'net') {
      if (!netConnected) return;
      var enc = call('MapGen', 'encode', sel.map);
      call('Net', 'send', { t: 'map', map: enc });
      startGame(sel.map, 0, true);
    } else if (mode === 'cpu') startGame(sel.map, 0, false, { level: settings.level });
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
    netConnected = true; hostRetry = 0; sel = null; loading = false;
    call('Net', 'send', { t: 'hello', color: PLAYERS[0].color });
    renderCards(); renderPreview();
    setSub('pick', 'つながったよ！ ちずを えらんでね');
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
  function onNetData(d) {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'map') {
      if (state === 'setting' && netRole === 'join') {
        var m = call('MapGen', 'decode', d.map);
        if (m) { netTok++; netOn = true; startGame(m, 1, true); }
        else failNet('ちずが うけとれなかったよ');
      }
      return;
    }
    if (state !== 'play') return;
    var other = 1 - myIndex;
    if (d.t === 'st') call('World', 'applyRemoteState', other, d.s);
    else if (d.t === 'boom') {
      // 発射のときに1回だけ届く。弾が山なりに飛んでから壊れる（「ドゴォーン！」は着弾のとき World の boom で出す）
      guard = true; try { call('World', 'applyRemoteBoom', d.cells, d.from); } finally { guard = false; }
    } else if (d.t === 'found') {
      guard = true; try { call('World', 'remoteFound', d.idx); } finally { guard = false; }
      go('ending', d.idx);
    }
  }
  function onNetClose() {
    netConnected = false;
    if (state === 'play' && netOn) {
      netOn = false;
      call('World', 'dropRemote', 1 - myIndex); // 相手の戦車を地図から消す
      showNotice('あいてが いなくなったよ　ひとりで つづけよう', true);
    } else if (state === 'setting' && mode === 'net') {
      failNet('あいてと つながらなくなったよ');
    }
    netOn = false;
  }
  // 'error' は Promise の reject と二重になるので、ここでは何も表示しない

  // ---------------- Play ----------------
  function startGame(m, idx, net, cpu) {
    map = m; myIndex = idx; netOn = !!net; recorded = false; sw = null;
    hideNotice();
    call('World', 'load', m, { myIndex: idx, players: PLAYERS, net: netOn, cpu: cpu || null });
    call('World', 'resetPitch');
    els.ptTitle.textContent = m.title || '';
    els.ptYomi.textContent = m.reading || '';
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
  function showBoom() {
    var b = els.boom;
    b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
    clearTimeout(boomTimer);
    boomTimer = setTimeout(function () { b.classList.remove('on'); }, 800);
  }
  // 知らせ：big なら大きく出して、4.5秒あとに小さくする。プレイが終わるまで出しつづける
  function showNotice(t, big) {
    clearTimeout(noticeTimer);
    els.notice.textContent = t; els.notice.classList.add('on');
    els.notice.classList.toggle('big', !!big);
    if (big) noticeTimer = setTimeout(function () { els.notice.classList.remove('big'); }, 4500);
  }
  function hideNotice() { clearTimeout(noticeTimer); els.notice.classList.remove('on'); els.notice.classList.remove('big'); }

  function onFound(idx) {
    if (state !== 'play' || guard) return;
    if (netOn) call('Net', 'send', { t: 'found', idx: idx });
    go('ending', idx);
  }
  function onBoom(cells, remote) {
    if (cells && cells.length) showBoom(); // 何か壊れたときだけ（自分の弾も、相手の弾も）。通信へは送らない
  }
  function onFire(info) {
    if (guard || !netOn || state !== 'play' || !info) return;
    call('Net', 'send', { t: 'boom', cells: info.cells, from: info.from }); // 発射時の1回だけ
  }
  function onState(s) {
    if (guard || !netOn || state !== 'play') return;
    call('Net', 'send', { t: 'st', s: s });
  }

  // ---------------- Ending ----------------
  // みつけた！の絵：小さい絵（例 32x18）でも枠いっぱいまで拡大する。小さい絵は画素をくっきり（ぼかさない）
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
  function fillEnding(idx) {
    idx = (idx === 1) ? 1 : 0;
    var m = map || {};
    // CPU戦・通信：先に宝を見つけたほうが かち。ひとり練習は勝ち負けなし
    var res = '';
    if (mode === 'cpu') res = (idx === 0) ? 'win' : 'lose';
    else if (mode === 'net') res = (idx === myIndex) ? 'win' : 'lose';
    var key = (mode === 'cpu') ? settings.level : 'net';
    if (res && !recorded) { recorded = true; addRecord(key, res === 'win'); }
    els.ending.setAttribute('data-res', res || 'solo');
    els.endFound.textContent = res === 'win' ? 'かち！' : (res === 'lose' ? 'まけ…' : 'みつけた！');
    els.endDisc.style.background = PLAYERS[idx].color;
    var who = 'きみが みつけたよ！';
    if (mode === 'cpu') who = res === 'win' ? 'きみが さきに みつけたよ！' : 'コンピューターが さきに みつけたよ';
    else if (mode === 'net') who = res === 'win' ? 'きみが さきに みつけたよ！' : 'あいてが さきに みつけたよ';
    els.endWho.textContent = who;
    if (res) {
      els.endRec.style.display = '';
      els.endRec.innerHTML = '<span class="rc-ico">' + SETICO.trophy + '</span><b></b><span class="rc-n"></span>';
      els.endRec.querySelector('b').textContent = LEVEL_NAME[key];
      els.endRec.querySelector('.rc-n').textContent = recText(key);
    } else els.endRec.style.display = 'none';
    els.endTitle.textContent = m.title || '';
    els.endTitle.style.display = m.title ? '' : 'none';
    els.endYomi.textContent = (m.reading && m.reading !== m.title) ? m.reading : '';
    els.endYomi.style.display = els.endYomi.textContent ? '' : 'none';
    if (m.picture) { showEndPic(m.picture); els.endPic.style.display = ''; } else els.endPic.style.display = 'none';
    var c = els.confetti; c.innerHTML = '';
    var cols = ['#ff5d8f', '#ffd23f', '#4d9bff', '#59d27c', '#b388ff', '#ff9f1c'];
    for (var i = 0; i < 26; i++) {
      var s = doc.createElement('i');
      s.style.left = (i * 3.9 + Math.random() * 3) + '%';
      s.style.background = cols[i % cols.length];
      s.style.animationDuration = (3 + Math.random() * 3) + 's';
      s.style.animationDelay = (-Math.random() * 5) + 's';
      c.appendChild(s);
    }
  }

  // ---------------- スワイプ（プレイ中の画面なぞり） ----------------
  // 左右：90度まわる（1回のなぞりで1回）。上下：視点を少し上下。ボタンの上から始めた操作は #swipe に届かない。
  function hasFn(obj, name) { var o = window[obj]; return !!(o && typeof o[name] === 'function'); }
  function turnBy(d) { // d: -1=ひだり +1=みぎ（設定で反対にできる）
    if (settings.swipeRev) d = -d;
    flashTurn(d);
    if (hasFn('World', 'swipeTurn')) { call('World', 'swipeTurn', d); return; }
    var act = d < 0 ? 'left' : 'right'; // World.swipeTurn がまだ無いときは ボタンと同じ動きで代用
    call('World', 'press', act, true);
    setTimeout(function () { call('World', 'press', act, false); }, 40);
  }
  function flashTurn(d) {
    var f = els.flash;
    f.classList.remove('on', 'l', 'r'); void f.offsetWidth;
    f.classList.add('on', d < 0 ? 'l' : 'r');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { f.classList.remove('on'); }, 500);
  }
  function unitPx() { var r = els.stage.getBoundingClientRect(); return Math.max(1, Math.min(r.width, r.height) / 100); }
  function swipeDown(e) {
    stopEv(e); unlock();
    if (state !== 'play' || modalOpen || sw) return;
    sw = { id: e.pointerId, x: e.clientX, y: e.clientY, ly: e.clientY, axis: '', done: false };
    try { els.swipe.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function swipeMove(e) {
    if (!sw || e.pointerId !== sw.id) return;
    stopEv(e);
    var u = unitPx(), dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (!sw.axis) {
      if (Math.hypot(dx, dy) < 2.2 * u) return;
      sw.axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v'; sw.ly = e.clientY;
      if (sw.axis === 'v') return;
    }
    if (sw.axis === 'h') {
      if (!sw.done && Math.abs(dx) >= 7 * u) { sw.done = true; hideTip(); turnBy(dx > 0 ? 1 : -1); }
    } else {
      var d = e.clientY - sw.ly; sw.ly = e.clientY;
      if (d) { hideTip(); call('World', 'nudgePitch', Math.max(-1, Math.min(1, -d / (30 * u)))); } // 指を上へ＝視点が上へ
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
    var portrait = !!(window.matchMedia && window.matchMedia('(orientation: portrait)').matches);
    call('World', 'setPaused', modalOpen || portrait);
  }

  // ---------------- キーボード（確認用） ----------------
  var KEYS = { ArrowUp: 'fwd', w: 'fwd', W: 'fwd', ArrowDown: 'back', s: 'back', S: 'back',
    ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ' ': 'fire' };
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
      'cam', 'notice', 'boom', 'confetti', 'swipe', 'tip', 'flash', 'recchip', 'ending'].forEach(function (id) { els[id] = $(id); });
    els.endFound = $('end-found'); els.endRec = $('end-rec');
    els.ptTitle = $('pt-title'); els.ptYomi = $('pt-yomi');
    els.camIco = $('cam-ico'); els.camLabel = $('cam-label');
    els.endDisc = $('end-disc'); els.endWho = $('end-who'); els.endTitle = $('end-title'); els.endYomi = $('end-yomi'); els.endPic = $('end-pic');

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

    settings = loadSettings(); record = loadRecord(); applySettings();
    buildLogos();
    buildKeypad();
    renderCards(); renderPreview();
    var icos = doc.querySelectorAll('[data-ico]');
    for (var ii = 0; ii < icos.length; ii++) icos[ii].innerHTML = SETICO[icos[ii].getAttribute('data-ico')] || '';
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
    // スワイプ受け口（ボタンより下の層。ボタンの上から始めた操作はここへ来ない）
    ['pointerdown'].forEach(function (n) { els.swipe.addEventListener(n, swipeDown); });
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
    call('World', 'on', 'found', onFound);
    call('World', 'on', 'boom', onBoom);
    call('World', 'on', 'fire', onFire);
    call('World', 'on', 'cam', function (top) { doc.body.classList.toggle('camtop', !!top); });
    call('World', 'on', 'state', onState);
    call('Net', 'on', 'open', onNetOpen);
    call('Net', 'on', 'data', onNetData);
    call('Net', 'on', 'close', onNetClose);

    state = 'boot'; doc.body.setAttribute('data-state', 'boot');
    renderNav();
  }

  window.App = {
    _found: function (idx) { onFound(idx); },
    go: function (name) { if (['boot', 'title', 'setting', 'play', 'ending', 'quit'].indexOf(name) >= 0) go(name); },
    get state() { return state; }
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})();
