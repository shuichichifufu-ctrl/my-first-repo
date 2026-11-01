// ui.js : 6ステート、ボタン、モーダル、操作ボタン、全体の配線。公開するのは window.App だけ。
// World / MapGen / Net / Sfx が無くても落ちないよう、すべて call() 経由で呼ぶ。
(function () {
  'use strict';
  var PLAYERS = [{ color: '#e53935' }, { color: '#1e88e5' }];
  var CAM_LABEL = ['め', 'おいかけ', 'そら']; // 視点の名前
  var CAM_GO = ['めへ', 'おいかけへ', 'そらへ'];  // カメラボタンの文字：おすと つぎに なる視点（絵と同じ） // 移動の「うしろ」とかぶらない名前
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

  var ICON = {
    play: '<svg viewBox="0 0 24 24"><path d="M6 3.500l15 8.500-15 8.500z"/></svg>',
    go: '<svg viewBox="0 0 24 24"><path d="M3 4l9 8-9 8zM12 4l9 8-9 8z"/></svg>',
    net: '<svg viewBox="0 0 24 24"><circle cx="5.500" cy="12" r="4"/><circle cx="18.500" cy="12" r="4"/><rect x="8" y="10.500" width="8" height="3"/></svg>',
    again: '<svg viewBox="0 0 24 24"><path d="M12 4V1L7 5.500 12 10V7a5.500 5.500 0 1 1-5.500 5.500H3.500A8.500 8.500 0 1 0 12 4z"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M12 3 1.500 12.500H5V21h5.500v-6h3v6H19v-8.500h3.500z"/></svg>',
    link: '<svg viewBox="0 0 24 24"><circle cx="5.500" cy="12" r="4"/><circle cx="18.500" cy="12" r="4"/><rect x="8" y="10.500" width="8" height="3"/></svg>',
    pic: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="3" fill="#ffd23f"/><circle cx="8" cy="10" r="2.400" fill="#ff5d8f"/><path d="M3 19l6-6 4 4 3-3 5 5z" fill="#3b8df0"/></svg>'
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
  var mode = 'solo';              // 'solo' | 'net'
  var netRole = '', netOn = false, netTok = 0, netConnected = false, joined = false;
  var code = '';
  var sel = null, loading = false;
  var map = null, myIndex = 0, camMode = 1, running = false, modalOpen = false;
  var pressed = {}, guard = false, hostRetry = 0;
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
      { label: 'はじめる', icon: 'play', kind: 'primary', fn: startSolo },
      { label: 'つうしんであそぶ', icon: 'net', kind: 'secondary', fn: startOnline }];
    if (state === 'setting') {
      if (sub === 'pick' && sel && !loading) return [{ label: 'しゅっぱつ！', icon: 'go', kind: 'primary', fn: depart }];
      if (sub === 'keypad' && code.length === 4) return [{ label: 'つなぐ！', icon: 'link', kind: 'primary', fn: doJoin }];
      if (sub === 'error') return [{ label: 'もういちど', icon: 'again', kind: 'primary', fn: retry }];
      return [];
    }
    if (state === 'ending') return [
      { label: 'もういちど', icon: 'again', kind: 'primary', fn: function () { go('title'); } },
      { label: 'おわる', icon: 'stop', kind: 'secondary', fn: function () { go('quit'); } }];
    if (state === 'quit') return [{ label: 'はじめから', icon: 'home', kind: 'primary', fn: function () { go('title'); } }];
    return [];
  }
  function renderNav() {
    var items = navItems();
    var key = state + '|' + sub + '|' + items.map(function (i) { return i.label; }).join('/');
    if (key === navKey) return;
    navKey = key;
    els.nav.innerHTML = '';
    items.forEach(function (it) {
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
    if (name === 'title' || name === 'quit') { stopGame(); closeNet(); mode = 'solo'; sel = null; loading = false; hideNotice(); }
    if (name === 'ending') stopGame();
    state = name;
    doc.body.setAttribute('data-state', name);
    if (name !== 'setting') sub = 'pick';
    if (name === 'ending') fillEnding.apply(null, [].slice.call(arguments, 1));
    renderNav();
  }

  function setSub(s, headText) {
    sub = s;
    els.setting.setAttribute('data-sub', s);
    var heads = { choice: 'どちらに する？', code: 'この ばんごうを ともだちに おしえてね', keypad: 'ばんごうを いれてね', msg: 'ちょっと まってね', error: 'あれれ？', pick: 'ちずを えらんでね' };
    els.sethead.textContent = headText || heads[s] || '';
    renderNav();
  }
  function enterSetting(s, head) { go('setting'); setSub(s, head); }

  function startSolo() { mode = 'solo'; sel = null; loading = false; renderCards(); renderPreview(); enterSetting('pick'); }
  function startOnline() { mode = 'net'; sel = null; netRole = ''; enterSetting('choice'); }
  function backFromSetting() {
    if (mode === 'net' && sub !== 'choice') { closeNet(); sel = null; loading = false; setSub('choice'); return; }
    go('title');
  }

  // ---------------- 地図えらび ----------------
  function renderCards() {
    var presets = prop('MapGen', 'presets') || [];
    var grid = els.cards;
    grid.innerHTML = '';
    var total = presets.length + 1;
    grid.style.setProperty('--cols', total > 4 ? 3 : 2);
    grid.className = 'pickgrid' + (total > 4 ? ' c3' : '');
    presets.forEach(function (p) {
      var c = doc.createElement('button');
      c.type = 'button'; c.tabIndex = -1; c.className = 'card'; c.setAttribute('data-id', p.id);
      c.innerHTML = '<span class="kan"></span><span class="yomi"></span>';
      c.firstChild.textContent = p.title; c.lastChild.textContent = p.reading || '';
      tap(c, function () { choosePreset(p); });
      grid.appendChild(c);
    });
    var f = doc.createElement('div');
    f.className = 'card file'; f.setAttribute('data-id', 'file');
    f.innerHTML = ICON.pic + '<span class="kan">えを よみこむ</span><input type="file" accept="image/*" aria-label="えを よみこむ">';
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
    var list = els.cards.children;
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
    var pr = call('MapGen', 'fromFile', file);
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
    } else startGame(sel.map, 0, false);
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
  function startGame(m, idx, net) {
    map = m; myIndex = idx; netOn = !!net;
    hideNotice();
    call('World', 'load', m, { myIndex: idx, players: PLAYERS, net: netOn });
    els.ptTitle.textContent = m.title || '';
    els.ptYomi.textContent = m.reading || '';
    camMode = 1; updateCam();
    doc.body.classList.add('camtop'); // 開始演出は真上から
    go('play');
    call('World', 'setCamera', camMode);
    call('World', 'start');
    running = true;
    applyPortraitPause();
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
    showBoom(); // 着弾（自分の弾も、相手の弾も）。通信へは送らない
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
    els.endDisc.style.background = PLAYERS[idx].color;
    els.endWho.textContent = (mode === 'net' && idx !== myIndex) ? 'あいてが みつけたよ！' : 'きみが みつけたよ！';
    els.endTitle.textContent = m.title || '';
    els.endTitle.style.display = m.title ? '' : 'none';
    els.endYomi.textContent = m.reading || '';
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

  // ---------------- ホームとモーダル ----------------
  function openModal() {
    if (modalOpen) return;
    modalOpen = true; els.modal.classList.add('on');
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
      'cam', 'notice', 'boom', 'confetti'].forEach(function (id) { els[id] = $(id); });
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

    buildLogos();
    buildKeypad();
    renderCards(); renderPreview();
    updateCam();

    // Boot：画面のどこでも
    tap($('boot'), leaveBoot);
    tap(els.home, openModal);
    tap($('m-no'), closeModal);
    tap($('m-yes'), quitYes);
    els.modal.addEventListener('pointerdown', stopEv);
    els.modal.addEventListener('pointerup', stopEv);
    els.modal.addEventListener('click', stopEv);
    tap($('back'), backFromSetting);
    tap($('c-host'), startHost);
    tap($('c-join'), startJoin);
    tap(els.cam, cycleCam);
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
    go: function (name) { if (['boot', 'title', 'setting', 'play', 'ending', 'quit'].indexOf(name) >= 0) go(name); },
    get state() { return state; }
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})();
