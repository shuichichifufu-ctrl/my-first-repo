// net.js : PeerJS 通信（window.Net だけ公開）。CONTRACT.md の window.Net を参照。
// 補足: host/join の失敗は「Promiseのreject」と「'error'イベント」の両方で知らせる（UIはどちらか一方で扱えばよい）。
//       reject する Error には .code（'unavailable-id' など）と、子ども向けの .message が付く。
(function () {
  'use strict';
  var PING_MS = 1000;       // 生存確認を送る間隔
  var DEAD_MS = 5000;       // これだけ何も届かなければ切れたとみなす
  var JOIN_TIMEOUT_MS = 10000;
  var CHUNK_AT = 30000;     // これより長いJSON文字列は分割して送る
  var CHUNK_SIZE = 16000;

  var MSG = {
    unavailable: 'この ばんごうは つかわれているよ。ほかの ばんごうで やってみてね',
    cantConnect: 'つながらなかったよ。ばんごうを たしかめてね',
    noRoom: 'その ばんごうの へやが みつからないよ。ばんごうを たしかめてね',
    server: 'つうしんの じゅんびが できなかったよ。すこし まってから もういちど やってみてね',
    lost: 'あいてと つながらなくなったよ',
    full: 'この へやは もう いっぱいだよ'
  };

  var handlers = { open: [], data: [], close: [], error: [] };
  var S = null;             // 現在のセッション
  var seq = 0;
  var api = { isHost: false, connected: false };

  function emit(name, arg) {
    var list = handlers[name].slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i](arg); } catch (e) { try { console.error(e); } catch (_) {} }
    }
  }

  function makeCode() {
    var n = Math.floor(Math.random() * 10000);
    return ('0000' + n).slice(-4);
  }

  function peerOptions() {
    var o = { debug: 0 };
    try {
      var q = new URLSearchParams(location.search);
      if (q.get('peerhost')) {
        o.host = q.get('peerhost');
        if (q.get('peerport')) o.port = parseInt(q.get('peerport'), 10);
        if (q.get('peerpath')) o.path = q.get('peerpath');
        o.secure = q.get('peersecure') === '0' ? false : (q.get('peersecure') === '1' ? true : location.protocol === 'https:');
      }
    } catch (e) {}
    return o;
  }

  function newSession(isHost) {
    teardown(false);
    S = { id: ++seq, isHost: isHost, peer: null, conn: null, timers: [], chunks: {}, lastRx: 0,
          finished: false, settled: false, resolve: null, reject: null, closing: false };
    api.isHost = isHost;
    api.connected = false;
    return S;
  }

  // セッションを片付ける（イベントは出さない）
  function teardown(sayBye) {
    var s = S;
    if (!s) return;
    S = null;
    s.finished = true;
    api.connected = false;
    s.timers.forEach(function (t) { clearInterval(t); clearTimeout(t); });
    s.timers = [];
    var conn = s.conn, peer = s.peer;
    if (sayBye && conn && conn.open) { try { conn.send({ t: 'bye' }); } catch (e) {} }
    setTimeout(function () {
      try { if (conn) conn.close(); } catch (e) {}
      try { if (peer && !peer.destroyed) peer.destroy(); } catch (e) {}
    }, sayBye ? 80 : 0);
  }

  // 相手側の事情・通信の事情で終わるとき
  function fail(s, kind, code, message) {
    if (s.finished || S !== s) return;
    var wasConnected = api.connected;
    var err = new Error(message);
    err.code = code;
    teardown(false);
    if (!s.settled) { s.settled = true; s.reject(err); }
    if (kind === 'close' && wasConnected) emit('close');
    else emit('error', message);
  }

  function startAlive(s) {
    s.lastRx = Date.now();
    s.timers.push(setInterval(function () {
      if (s.finished || S !== s) return;
      if (Date.now() - s.lastRx > DEAD_MS) { fail(s, 'close', 'timeout', MSG.lost); return; }
      try { if (s.conn && s.conn.open) s.conn.send({ t: '_p' }); } catch (e) {}
    }, PING_MS));
  }

  function attachConn(s, conn) {
    s.conn = conn;
    conn.on('data', function (d) {
      if (s.finished || S !== s) return;
      s.lastRx = Date.now();
      if (!d || typeof d !== 'object') return;
      if (d.t === '_p') return;
      if (d.t === 'bye') { fail(s, 'close', 'bye', MSG.lost); return; }   // 相手が自分から終わった（dataには出さず close を出す）
      if (d.t === '_w') { onOpened(s); return; }   // ホストに受け入れられた
      if (d.t === 'full') { fail(s, 'error', 'full', MSG.full); return; }
      if (d.t === '_c') {   // 分割されたデータ
        var c = s.chunks[d.id] || (s.chunks[d.id] = { parts: [], n: d.n, got: 0 });
        if (!c.parts[d.i]) { c.parts[d.i] = d.d; c.got++; }
        if (c.got === c.n) {
          delete s.chunks[d.id];
          var obj = null;
          try { obj = JSON.parse(c.parts.join('')); } catch (e) { return; }
          emit('data', obj);
        }
        return;
      }
      emit('data', d);
    });
    conn.on('close', function () { fail(s, 'close', 'closed', MSG.lost); });
    conn.on('error', function () { fail(s, 'close', 'conn-error', MSG.lost); });
  }

  function onOpened(s) {
    if (s.finished || S !== s) return;
    api.connected = true;
    startAlive(s);
    if (!s.settled) { s.settled = true; s.resolve(); }
    emit('open');
  }

  function peerErrorMessage(err) {
    var type = err && err.type;
    if (type === 'unavailable-id') return [type, MSG.unavailable];
    if (type === 'peer-unavailable') return [type, MSG.noRoom];
    if (type === 'server-error' || type === 'socket-error' || type === 'socket-closed' || type === 'network') return [type, MSG.server];
    return [type || 'error', MSG.cantConnect];
  }

  function makePeer(s, code) {
    var peer;
    try {
      peer = new Peer('seecar-hoshi-' + code, peerOptions());
    } catch (e) {
      setTimeout(function () { fail(s, 'error', 'no-peerjs', MSG.server); }, 0);
      return null;
    }
    s.peer = peer;
    peer.on('error', function (err) {
      var m = peerErrorMessage(err);
      // つながったあとに出る小さなエラーは接続の close で扱う
      if (api.connected && m[0] !== 'unavailable-id') return;
      fail(s, 'error', m[0], m[1]);
    });
    peer.on('disconnected', function () {
      // 部屋づくり中に中継サーバーから切れたら失敗。つながったあとは生存確認に任せる
      if (!api.connected && !s.finished) fail(s, 'error', 'disconnected', MSG.server);
    });
    return peer;
  }

  function host(code) {
    var s = newSession(true);
    return new Promise(function (resolve, reject) {
      s.resolve = resolve; s.reject = reject;
      var peer = makePeer(s, String(code));
      if (!peer) return;
      peer.on('open', function () { if (!s.settled && !s.finished) { s.settled = true; s.resolve(); } });  // 部屋ができた
      peer.on('disconnected', function () {   // ゲストが来る前に中継サーバーから切れたら つなぎ直す
        if (!s.conn && !s.finished && peer.open === false && !peer.destroyed) { try { peer.reconnect(); } catch (e) {} }
      });
      peer.on('connection', function (conn) {
        if (s.finished || S !== s) { try { conn.close(); } catch (e) {} return; }
        if (s.conn) {   // 2人目は断る
          conn.on('open', function () {
            try { conn.send({ t: 'full', message: MSG.full }); } catch (e) {}
            setTimeout(function () { try { conn.close(); } catch (e) {} }, 100);
          });
          return;
        }
        attachConn(s, conn);
        var accept = function () { try { conn.send({ t: '_w' }); } catch (e) {} onOpened(s); };
        if (conn.open) accept(); else conn.on('open', accept);
      });
    });
  }

  function join(code) {
    var s = newSession(false);
    return new Promise(function (resolve, reject) {
      s.resolve = resolve; s.reject = reject;
      var p;
      try { p = new Peer(peerOptions()); } catch (e) { fail(s, 'error', 'no-peerjs', MSG.server); return; }
      s.peer = p;
      p.on('error', function (err) {
        var m = peerErrorMessage(err);
        if (api.connected) return;
        fail(s, 'error', m[0], m[1]);
      });
      p.on('disconnected', function () { if (!api.connected && !s.finished) fail(s, 'error', 'disconnected', MSG.server); });
      // 部屋に入れたあと（settled）は時間切れにしない
      s.timers.push(setTimeout(function () { if (!s.settled) fail(s, 'error', 'timeout', MSG.cantConnect); }, JOIN_TIMEOUT_MS));
      p.on('open', function () {
        if (s.finished || S !== s) return;
        var conn = p.connect('seecar-hoshi-' + code, { serialization: 'json', reliable: true });
        attachConn(s, conn);
      });
    });
  }

  var chunkId = 0;
  function send(obj) {
    var s = S;
    if (!s || !api.connected || !s.conn || !s.conn.open) return false;
    try {
      var str = JSON.stringify(obj);
      if (str.length <= CHUNK_AT) { s.conn.send(obj); return true; }
      var id = ++chunkId, n = Math.ceil(str.length / CHUNK_SIZE);
      for (var i = 0; i < n; i++) {
        s.conn.send({ t: '_c', id: id, i: i, n: n, d: str.substr(i * CHUNK_SIZE, CHUNK_SIZE) });
      }
      return true;
    } catch (e) { return false; }
  }

  function close() {
    teardown(true);
  }

  function on(name, fn) {
    if (handlers[name] && typeof fn === 'function') handlers[name].push(fn);
  }

  api.makeCode = makeCode;
  api.host = host;
  api.join = join;
  api.send = send;
  api.on = on;
  api.close = function () { close(); };
  try { window.addEventListener('pagehide', function () { teardown(true); }); } catch (e) {}
  window.Net = api;
})();
