// v9 UI 確認用の「足りない関数の仮置き」。本物（第4期の world.js / sfx.js / mapgen.js / seeker.js）に その関数があれば何もしない。
(function () {
  var W = window.World || {}, S = window.Sfx || (window.Sfx = {}), M = window.MapGen || {};
  if (!M.GEMS) M.GEMS = [['diamond','ダイヤモンド','#e9f6ff','#ffffff'],['ruby','ルビー','#e0115f','#ff6f9a'],['sapphire','サファイア','#2456d6','#7aa6ff'],['emerald','エメラルド','#12a65c','#6ff0a8'],['amethyst','アメシスト','#9b59d0','#d9b0ff'],['topaz','トパーズ','#ffae00','#ffe08a'],['aquamarine','アクアマリン','#5fd0e6','#bdf5ff'],['garnet','ガーネット','#8f1c2e','#e3657c'],['peridot','ペリドット','#9acd32','#dcff8f'],['opal','オパール','#f4efe6','#ffd9f2']].map(function (a) { return { id: a[0], name: a[1], color: a[2], glow: a[3] }; });
  ['fromPreset', 'decode'].forEach(function (n) {
    var o = M[n]; if (!o) return;
    M[n] = function () { var m = o.apply(M, arguments); if (m && m.treasures) m.treasures.forEach(function (t, i) { if (typeof t.gem !== 'number') t.gem = (i * 3 + 1) % 10; }); return m; };
  });
  ['bgm', 'jingle', 'stopAll', 'pause', 'engine'].forEach(function (n) { if (!S[n]) S[n] = function () {}; });
  if (!W.go) {
    var H = {}, frozen = true, owners = {}, sc = [0, 0], my = 0, curMap = null;
    var on0 = W.on; W.on = function (e, f) { (H[e] = H[e] || []).push(f); return on0 && on0.call(W, e, f); };
    function emit(e) { var a = [].slice.call(arguments, 1); (H[e] || []).forEach(function (f) { try { f.apply(null, a); } catch (x) { console.error(x); } }); }
    window.__shimEmit = emit;
    var load0 = W.load; W.load = function (m, o) { curMap = m; my = (o && o.myIndex) || 0; owners = {}; sc = [0, 0]; frozen = true; return load0 && load0.apply(W, arguments); };
    var press0 = W.press; W.press = function (a, d) { if (frozen && d) return; return press0 && press0.apply(W, arguments); };
    W.freeze = function (b) { frozen = !!b; };
    W.go = function () { frozen = false; };
    W.speedStage = function () { return 0; };
    W.gemInfo = function (ti) { var t = curMap && curMap.treasures && curMap.treasures[ti]; return { gem: t ? t.gem : 0, x: t ? t.x : 0, z: t ? t.z : 0, owner: owners[ti] === undefined ? null : owners[ti] }; };
    W.award = function (idx, ti) { if (owners[ti] !== undefined) return; owners[ti] = idx; sc[idx === my ? 0 : 1]++; setTimeout(function () { emit('collect', idx, ti, sc.slice()); }, 30); };
    W.scores = function () { return sc.slice(); };
  }
})();
