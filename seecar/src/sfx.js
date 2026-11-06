// sfx.js : 見つけて！PixSee の音。効果音・キャタピラ/ドリルのループ・BGM・ジングルを Web Audio API だけで合成する。
// 音声ファイルも外部ライブラリも使わない。公開するのは window.Sfx だけ。
// 使い方の約束は CONTRACT.md「第4期の追加 → Sfx（sfx.js）」。
// unlock() の前や AudioContext が無い環境では、どの関数を呼んでも何もしない（落ちない）。
(function () {
  'use strict';

  /* ===== S01. 音量のつりあいと時間の設定（ここを変えると全体の聞こえ方が変わる） ===== */
  var MIX = {
    master: 0.9,      // 全体
    sfx: 1.3,         // 効果音（BGM よりはっきり聞こえるように大きめ）
    loop: 0.42,       // キャタピラ・ドリルのループ
    music: 0.11,      // BGM（小さめ。効果音より 8dB 以上小さく）
    jingle: 0.4,      // 結果のジングル
    reverb: 0.5,      // 響きの戻りの量
    sendMusic: 0.35,  // BGM を響きへ送る量
    sendSfx: 0.08,    // 効果音を響きへ送る量
    sendJingle: 0.3,  // ジングルを響きへ送る量
    duck: 0.35        // ファンファーレの間、BGM をこの割合まで下げる
  };
  var LOOKAHEAD = 0.3;  // BGM の音符を何秒先まで予約しておくか（画面が重くても途切れないように）
  var TICK_MS = 50;     // 予約を見回る間隔（ミリ秒）
  // 効果音ごとの音量の調整（1=そのまま）。長くきらきらした音は少し下げ、短い音は上げて、聞こえ方をそろえる
  var SFX_VOL = { fanfare: 0.6, go: 0.65, notice: 0.6, gemRise: 0.65, count: 0.85, found: 0.6, collect: 0.65, 'break': 1.5, drillHit: 1.3, boom: 1.2 };
  var MIN_GAP = { move: 0.12, step: 0.07, land: 0.08, drillHit: 0.07, 'break': 0.05, bump: 0.15, tap: 0.03, count: 0.05, turn: 0.1, pinpin: 1.0 }; // 同じ音を続けて鳴らす最短の間隔（秒）

  var api = { muted: false };

  /* ===== S02. 状態 ===== */
  var G = null;          // 音の部品一式（AudioContext ごとに1つ）
  var broken = false;    // AudioContext が使えない
  var song = null;       // いま鳴っている BGM
  var wantBgm = null;    // 鳴らしたい BGM の名前（unlock 前に頼まれた分も覚えておく）
  var jing = null;       // いま鳴っているジングルの持ち主
  var paused = false;    // モーダルで一時停止中
  var timer = null;      // BGM の予約を見回るタイマー
  var lastAt = {};       // 効果音ごとの最後に鳴らした時刻
  var fading = [];       // 切り替えで消えかけている前の曲（すばやく何度も切り替えたら、まとめて早く消す）
  var pv = null;         // 試し聴き { timer, back: 試し聴きが終わったら戻す曲の名前 }
  var eng = newEng();    // 走る音のループの状態
  function newEng() { return { state: 'idle', stage: 0, applied: false, tread: null, drill: null }; }

  /* ===== S03. 小さな道具 ===== */
  function ready() { return !!G && !broken; }
  function now() { return G.ctx.currentTime; }
  function noop() {}
  // 作り置きの音（キャタピラ・響き）用の決まった乱数。毎回同じ音になる
  var seed = 20261104;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  // 値をなめらかに目標へ近づける（ぷつっという音を出さない）
  function glide(param, v, tc) {
    var t = now();
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t); else param.cancelScheduledValues(t);
    param.setTargetAtTime(v, t, Math.max(0.005, tc));
  }
  function resume() {
    try {
      if (G && G.ctx.state !== 'running' && G.ctx.resume) { var p = G.ctx.resume(); if (p && p.catch) p.catch(noop); }
    } catch (e) {}
  }
  function syncMute() {
    if (!G) return;
    var want = api.muted ? 0 : MIX.master;
    if (G.mute !== want) { G.mute = want; glide(G.master.gain, want, 0.03); }
  }

  /* ===== S04. 音の通り道（ミキサー）と作り置きの音 ===== */
  // 楽器 → 持ち主 → バス（効果音／ループ／BGM／ジングル）→ ゆるいコンプ → リミッター → スピーカー
  function gainNode(c, v, dest) { var g = c.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }
  function buildGraph(c) {
    var g = { ctx: c, owners: [], mute: api.muted ? 0 : MIX.master };
    g.master = gainNode(c, g.mute);
    var comp = c.createDynamicsCompressor();    // 全体をまとめるゆるいコンプ
    comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 2.5; comp.attack.value = 0.008; comp.release.value = 0.25;
    var lim = c.createDynamicsCompressor();     // 音割れを防ぐリミッター
    lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
    g.master.connect(comp); comp.connect(lim); lim.connect(c.destination);
    // 響き（ノイズから作る小さな部屋の響き）
    g.rev = c.createConvolver(); g.rev.buffer = makeIR(c);
    g.rev.connect(gainNode(c, MIX.reverb, g.master));
    // 効果音
    g.sfx = gainNode(c, MIX.sfx, g.master); g.sfx.connect(gainNode(c, MIX.sendSfx, g.rev));
    // 走る音のループ（一時停止用の音量つまみ付き）
    g.loopPause = gainNode(c, 1, g.master); g.loop = gainNode(c, MIX.loop, g.loopPause);
    // BGM（ファンファーレで下げるつまみ、一時停止のつまみ付き）
    g.musicPause = gainNode(c, 1, g.master); g.duck = gainNode(c, 1, g.musicPause);
    g.duck.connect(gainNode(c, MIX.sendMusic, g.rev));
    g.music = gainNode(c, MIX.music, g.duck);
    // ジングル
    g.jingle = gainNode(c, MIX.jingle, g.master); g.jingle.connect(gainNode(c, MIX.sendJingle, g.rev));
    // 作り置き
    var sr = c.sampleRate, n = Math.floor(sr * 2);
    g.noise = c.createBuffer(1, n, sr);
    var d = g.noise.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    g.tread = makeTread(c);
    g.drill = makeDrill(c);
    return g;
  }
  // 響きのもと：だんだん暗く小さくなるノイズ（左右で別の乱数＝広がり）
  function makeIR(c) {
    var sr = c.sampleRate, len = Math.floor(sr * 1.7), pre = Math.floor(sr * 0.012), b = c.createBuffer(2, len, sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch), lp = 0;
      for (var i = pre; i < len; i++) {
        var x = i / len, k = 0.5 - 0.42 * x;   // 後ろほど高い音を減らす
        lp += (rnd() * 2 - 1 - lp) * k;
        d[i] = lp * Math.pow(1 - x, 2.4);
      }
    }
    return b;
  }
  // 周期的な音を書き込む（はみ出した分は先頭へ回す＝ループのつなぎ目が出ない）
  function addWrap(d, at, v) { var L = d.length; d[((at % L) + L) % L] += v; }
  function normalize(d, peak) {
    var m = 0, i;
    for (i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
    if (m > 0) for (i = 0; i < d.length; i++) d[i] *= peak / m;
  }
  // キャタピラ1周期：カタッ・タ・カタッ・タ（強弱つき4回）＋小さなモーター音。速さはループの再生速度で変える
  function makeTread(c) {
    var sr = c.sampleRate, L = Math.round(sr * 0.56), b = c.createBuffer(1, L, sr), d = b.getChannelData(0);
    var acc = [1, 0.55, 0.8, 0.5];
    for (var k = 0; k < 4; k++) {
      var at = Math.round(L * k / 4 + sr * 0.004 * (k % 2));
      clack(d, at, acc[k], sr, 1150 + 90 * k, 2700 - 120 * k);
      clack(d, at + Math.round(sr * 0.034), acc[k] * 0.32, sr, 1700, 3300);   // カタッの「タ」（板がおさまる音）
    }
    var k1 = Math.round(108 * L / sr), k2 = k1 * 2;   // 周期にちょうど収まる回数にする
    for (var i = 0; i < L; i++) {
      var ph = i / L;
      d[i] += 0.05 * Math.sin(2 * Math.PI * k1 * ph) + 0.025 * Math.sin(2 * Math.PI * k2 * ph);
    }
    normalize(d, 0.9);
    return b;
  }
  // 1回の「カッ」：短いノイズで2つの共鳴（木と金属の間くらい）をたたく＋低い「トッ」
  function clack(d, at, a, sr, fa, fb) {
    var n = Math.round(sr * 0.05), ex = Math.round(sr * 0.003);
    var ra = Math.exp(-Math.PI * 160 / sr), rb = Math.exp(-Math.PI * 380 / sr);
    var ca = 2 * ra * Math.cos(2 * Math.PI * fa / sr), cb = 2 * rb * Math.cos(2 * Math.PI * fb / sr);
    var a1 = 0, a2 = 0, b1 = 0, b2 = 0;
    for (var i = 0; i < n; i++) {
      var x = i < ex ? (rnd() * 2 - 1) * (1 - i / ex) : 0;
      var ya = x + ca * a1 - ra * ra * a2; a2 = a1; a1 = ya;
      var yb = x + cb * b1 - rb * rb * b2; b2 = b1; b1 = yb;
      var tock = Math.sin(2 * Math.PI * 300 * i / sr) * Math.exp(-i / (sr * 0.011));
      addWrap(d, at + i, a * (ya * (1 - ra) * 0.9 + yb * (1 - rb) * 0.45 + tock * 0.35));
    }
  }
  // ドリル1周期（0.5秒）：低いうなり（倍音を足したのこぎり波）を回転で「ゴゴゴ」とゆらす＋ざらざらした土の音
  function makeDrill(c) {
    var sr = c.sampleRate, L = Math.round(sr * 0.5), b = c.createBuffer(1, L, sr), d = b.getChannelData(0);
    var grit = new Float32Array(L), lp = 0, i, pass;
    for (i = 0; i < L; i++) grit[i] = rnd() * 2 - 1;
    for (pass = 0; pass < 2; pass++) {            // 2周まわして、つなぎ目でも途切れない低いざらざらにする
      for (i = 0; i < L; i++) { lp += (grit[i] - lp) * 0.07; if (pass) grit[i] = lp; }
    }
    for (i = 0; i < L; i++) {
      var ph = i / L, s = 0;
      for (var h = 1; h <= 10; h++) s += Math.sin(2 * Math.PI * 22 * h * ph) / h;   // 44Hz（0.5秒に22回）
      var rot = 0.5 + 0.5 * Math.cos(2 * Math.PI * 7 * ph);                        // 14Hz の回転
      var am = 0.5 + 0.5 * rot * rot, am2 = 0.25 + 0.75 * Math.pow(rot, 4);
      d[i] = s * 0.45 * am + grit[i] * 2.2 * am2 + 0.22 * Math.sin(2 * Math.PI * 33 * ph) + 0.12 * Math.sin(2 * Math.PI * 59 * ph);
    }
    normalize(d, 0.9);
    return b;
  }

  /* ===== S05. 鳴っている音の持ち主（まとめて止めるため） ===== */
  // 1回の効果音・1曲・1つのループごとに「持ち主」を作り、そこから始めた音源をすべて覚えておく。
  function newOwner(dest, vol) {
    var g = G.ctx.createGain(); g.gain.value = vol == null ? 1 : vol; g.connect(dest);
    var o = { g: g, srcs: [], done: false, list: G.owners };
    G.owners.push(o);
    return o;
  }
  function dropOwner(o) {
    var i = o.list.indexOf(o); if (i >= 0) o.list.splice(i, 1);
    try { o.g.disconnect(); } catch (e) {}
  }
  function finish(o) { o.done = true; if (!o.srcs.length) dropOwner(o); }
  function run(o, src, t0, t1, off) {
    if (off) src.start(t0, off); else src.start(t0);
    if (t1) { src.stop(t1); src._end = t1; }
    o.srcs.push(src);
    src.onended = function () {
      var i = o.srcs.indexOf(src); if (i >= 0) o.srcs.splice(i, 1);
      try { src.disconnect(); } catch (e) {}
      if (o.done && !o.srcs.length) dropOwner(o);
    };
  }
  // 音源を止める（予定より遅らせはしない）
  function hush(o, when) {
    o.srcs.slice().forEach(function (s) { try { s.stop(Math.min(s._end || 1e9, when)); } catch (e) {} });
  }
  // 持ち主ごと、fade 秒で消して止める
  function kill(o, fade) {
    fade = fade || 0.05;
    glide(o.g.gain, 0, fade / 4);
    hush(o, now() + fade);
    finish(o);
  }

  /* ===== S06. 楽器（o=持ち主, d=つなぐ先, f=周波数, t=開始, dur=長さ(秒), v=強さ0〜1） ===== */
  function vca(d) { var g = G.ctx.createGain(); g.gain.value = 0; g.connect(d); return g; }
  function osc(o, type, f, t, end, d) {
    var n = G.ctx.createOscillator(); n.type = type; n.frequency.setValueAtTime(f, t); n.connect(d); run(o, n, t, end); return n;
  }
  function filt(type, f, q, d) { var n = G.ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; if (d) n.connect(d); return n; }
  function nsrc(o, t, end, d) {
    var s = G.ctx.createBufferSource(); s.buffer = G.noise; s.loop = true; s.connect(d); run(o, s, t, end, 0.01 + Math.random() * 1.5); return s;
  }
  // たたく音の形：すぐ立ち上がり、tc の速さで消える。戻り値は音を止めてよい時刻
  function strike(g, t, peak, atk, tc) {
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + atk); g.gain.setTargetAtTime(0, t + atk, tc);
    return t + atk + tc * 7;
  }
  // 伸ばす音の形：立ち上がり →（decayTo があれば少しずつ下がる）→ dur で離す
  function sustain(g, t, peak, atk, dur, rel, decayTo, decayTc) {
    var d = Math.max(dur, atk + 0.02);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + atk);
    if (decayTo != null) g.gain.setTargetAtTime(peak * decayTo, t + atk, decayTc || 0.3);
    g.gain.setTargetAtTime(0, t + d, rel);
    return t + d + rel * 7;
  }
  // FM（周波数をゆらして倍音を作る）。idx は最初の明るさ、tc でまろやかになる
  function fm(o, car, ratio, f, t, end, idx, tc, floor) {
    var m = G.ctx.createGain();
    m.gain.setValueAtTime(f * idx, t); m.gain.setTargetAtTime(f * (floor || 0), t, tc);
    m.connect(car.frequency);
    osc(o, 'sine', f * ratio, t, end, m);
  }
  var INST = {
    // オルゴール：澄んだ鈴の音が長く残る
    box: function (o, d, f, t, dur, v) {
      var g = vca(d), end = strike(g, t, 0.4 * v, 0.003, 0.4);
      fm(o, osc(o, 'sine', f, t, end, g), 3, f, t, end, 1.5, 0.04);
      var g2 = vca(d), e2 = strike(g2, t, 0.08 * v, 0.002, 0.15);
      osc(o, 'sine', f * 2, t, e2, g2);
    },
    // マリンバ：木をたたく、まるくて短い音
    marimba: function (o, d, f, t, dur, v) {
      var g = vca(d), end = strike(g, t, 0.5 * v, 0.002, Math.min(0.32, 0.12 + 25 / f));
      fm(o, osc(o, 'sine', f, t, end, g), 4, f, t, end, 1.1, 0.018);
    },
    // ピチカート：弦をはじく、はずむ音
    pluck: function (o, d, f, t, dur, v) {
      var g = vca(d), end = strike(g, t, 0.42 * v, 0.003, 0.11);
      var fl = filt('lowpass', Math.min(f * 10, 9000), 0.8, g);
      fl.frequency.setTargetAtTime(f * 2, t, 0.05);
      osc(o, 'triangle', f, t, end, fl);
      var sg = G.ctx.createGain(); sg.gain.value = 0.35; sg.connect(fl);
      osc(o, 'sawtooth', f, t, end, sg);
    },
    // エレピの鈴（ローファイ用）：やわらかい立ち上がりで、押さえている間ゆっくり減る
    bell: function (o, d, f, t, dur, v) {
      var g = vca(d), end = sustain(g, t, 0.3 * v, 0.006, dur * 0.92, 0.16, 0.35, 0.8);
      fm(o, osc(o, 'sine', f, t, end, g), 1, f, t, end, 1.0, 0.3, 0.08);
      var g2 = vca(d), e2 = strike(g2, t, 0.05 * v, 0.002, 0.12);
      osc(o, 'sine', f * 3, t, e2, g2);
    },
    // グロッケン：きらきらした金属の板
    glock: function (o, d, f, t, dur, v) {
      var g = vca(d), end = strike(g, t, 0.32 * v, 0.002, 0.3);
      osc(o, 'sine', f, t, end, g);
      var g2 = vca(d); osc(o, 'sine', f * 2.76, t, strike(g2, t, 0.08 * v, 0.001, 0.06), g2);
      var g3 = vca(d); osc(o, 'sine', f * 5.4, t, strike(g3, t, 0.035 * v, 0.001, 0.03), g3);
    },
    // ハープ：やわらかくはじく、長めに残る
    harp: function (o, d, f, t, dur, v) {
      var g = vca(d), end = strike(g, t, 0.36 * v, 0.003, 0.32);
      osc(o, 'triangle', f, t, end, filt('lowpass', Math.min(f * 5, 8000), 0.5, g));
      var g2 = vca(d); osc(o, 'sine', f * 2, t, strike(g2, t, 0.07 * v, 0.002, 0.14), g2);
    },
    // 口笛：やさしい息の音にゆっくりビブラート
    whistle: function (o, d, f, t, dur, v) {
      var g = vca(d), end = sustain(g, t, 0.24 * v, 0.045, dur * 0.92, 0.07);
      var c1 = osc(o, 'sine', f, t, end, g);
      var tg = G.ctx.createGain(); tg.gain.value = 0.18; tg.connect(g);
      var c2 = osc(o, 'triangle', f, t, end, tg);
      var lg = G.ctx.createGain();
      lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.007, t + Math.min(0.3, dur));
      lg.connect(c1.frequency); lg.connect(c2.frequency);
      osc(o, 'sine', 5.2, t, end, lg);
    },
    // パッド：あたたかい和音の背景（ゆっくり出てゆっくり消える）
    pad: function (o, d, f, t, dur, v) {
      var g = vca(d), end = sustain(g, t, 0.09 * v, 0.35, dur, 0.45);
      var fl = filt('lowpass', 1100, 0.4, g);
      osc(o, 'sawtooth', f * 0.997, t, end, fl);
      osc(o, 'sawtooth', f * 1.003, t, end, fl);
    },
    // ホルン：ジングル用のやわらかい金管
    horn: function (o, d, f, t, dur, v) {
      var g = vca(d), end = sustain(g, t, 0.17 * v, 0.025, dur * 0.95, 0.09);
      var fl = filt('lowpass', f * 1.2, 1.1, g);
      fl.frequency.setValueAtTime(f * 1.2, t); fl.frequency.linearRampToValueAtTime(f * 4.5, t + 0.07);
      fl.frequency.setTargetAtTime(f * 3, t + 0.07, 0.2);
      osc(o, 'sawtooth', f, t, end, fl);
      osc(o, 'sawtooth', f * 1.004, t, end, fl);
    },
    // ベース：まるい低音（iPad の小さなスピーカーでも分かるよう倍音を少し足す）
    bass: function (o, d, f, t, dur, v) {
      var g = vca(d), end = sustain(g, t, 0.42 * v, 0.008, dur * 0.9, 0.06, 0.6, 0.35);
      var fl = filt('lowpass', f * 5, 0.7, g);
      osc(o, 'triangle', f, t, end, fl);
      var sg = G.ctx.createGain(); sg.gain.value = 0.28; sg.connect(fl);
      osc(o, 'sawtooth', f, t, end, sg);
      var sub = G.ctx.createGain(); sub.gain.value = 0.6; sub.connect(g);
      osc(o, 'sine', f, t, end, sub);
    }
  };
  // 打楽器（名前1文字）：k=キック, s=スネア(ブラシ), h=シェイカー, t=タム, r=リム（木のカチッ）
  var DRUM = {
    k: function (o, d, t, v) {
      var g = vca(d), end = strike(g, t, 0.55 * v, 0.002, 0.09), n = osc(o, 'sine', 140, t, end, g);
      n.frequency.exponentialRampToValueAtTime(46, t + 0.1);
    },
    s: function (o, d, t, v) {
      var g = vca(d); nsrc(o, t, strike(g, t, 0.2 * v, 0.002, 0.05), filt('bandpass', 1900, 0.7, g));
      var g2 = vca(d); osc(o, 'sine', 200, t, strike(g2, t, 0.1 * v, 0.001, 0.03), g2);
    },
    h: function (o, d, t, v) {
      var g = vca(d); nsrc(o, t, strike(g, t, 0.1 * v, 0.006, 0.022), filt('highpass', 7000, 0.6, g));
    },
    t: function (o, d, t, v) {
      var g = vca(d), end = strike(g, t, 0.36 * v, 0.003, 0.12), n = osc(o, 'sine', 150, t, end, g);
      n.frequency.exponentialRampToValueAtTime(95, t + 0.18);
      var g2 = vca(d); nsrc(o, t, strike(g2, t, 0.06 * v, 0.001, 0.02), filt('lowpass', 700, 0.6, g2));
    },
    r: function (o, d, t, v) {
      var g = vca(d); osc(o, 'sine', 1250, t, strike(g, t, 0.12 * v, 0.001, 0.018), g);
      var g2 = vca(d); osc(o, 'sine', 1880, t, strike(g2, t, 0.06 * v, 0.001, 0.012), g2);
    }
  };

  /* ===== S07. 曲のデータ（Sfx.TRACKS。曲を足すときはここに1つ足す） ===== */
  // 書き方：
  //   name: 'play1' など。bgm(name) / jingle(name) で呼ぶ名前
  //   loop: true=BGM（くり返す）／false=ジングル（1回）
  //   tempo: 1分間の拍の数。stepsPerBeat: 1拍をいくつに分けるか（2=8分音符が1マス）。beatsPerBar: 1小節の拍数（読みやすさのため）
  //   swing: 0〜0.3（裏のマスを少し遅らせて、はねる感じにする）。tone: 曲全体の明るさ（高い音を切る周波数。省略で切らない）
  //   vol: 曲全体の音量。parts: 楽器ごとの譜面
  //     inst: 楽器名（box, marimba, pluck, bell, glock, harp, whistle, pad, horn, bass, drum）
  //     vol: 楽器の音量、pan: 左右(-1〜1)
  //     notes: 1小節ずつの文字列の配列。1語が1マス
  //       'C5' 音（# と b も使える：'F#4' 'Bb3'）、'C4+E4+G4' 和音、'-' 前の音をのばす、'.' 休み、
  //       'A5:0.6' のように :数字 で強さ。drum は k/s/h/t/r を '+' で重ねる（例 'k+h'）。
  //     楽器ごとに小節数がちがってもよい（短い譜面はくり返す）。
  // 和音の名前の並びから、1小節ずつの譜面を作る（伴奏を書きやすくするため）
  function byChord(chords, map) { return chords.map(function (c) { return map[c]; }); }
  // げんき：A(8) B(8) A'(8)
  var GENKI_CH = ['G', 'G', 'D', 'D', 'C', 'G', 'D', 'G',  'C', 'C', 'G', 'G', 'Am', 'D', 'G', 'D',  'G', 'G', 'D', 'D', 'C', 'G', 'D', 'G'];
  var GENKI_MEL = [
    'G5 . G5 A5 B5 . G5 .', 'D6 . B5 . G5 - - .', 'A5 . A5 B5 C6 . A5 .', 'F#5 . A5 . D6 - - .',
    'E6 . D6 . C6 . E6 .', 'D6 . B5 . G5 . B5 .', 'A5 . B5 . A5 . F#5 .', 'G5 . D5 . G5 - - .',
    'E5 . G5 . C6 - - .', 'B5 . A5 . G5 . E5 .', 'D5 . G5 . B5 - - .', 'A5 . G5 . F#5 . D5 .',
    'C5 . E5 . A5 . C6 .', 'B5 . A5 . F#5 . A5 .', 'G5 . B5 . D6 . B5 .', 'A5 - - . D5 . . .',
    'G5 . G5 A5 B5 . G5 .', 'D6 . B5 . G5 - - .', 'A5 . A5 B5 C6 . A5 .', 'F#5 . A5 . D6 - - .',
    'E6 . E6 . D6 . C6 .', 'B5 . D6 . G6 - D6 .', 'C6 . B5 . A5 . F#5 .', 'G5 . D6 . G5 . . .'];
  // ゆかい：A(8) B(8) A'(8)
  var YUKAI_CH = ['F', 'F', 'C', 'C', 'F', 'Bb', 'C', 'F',  'Bb', 'Bb', 'F', 'F', 'G7', 'G7', 'C', 'C7',  'F', 'F', 'C', 'C', 'F', 'Bb', 'C', 'F'];
  var YUKAI_A = [
    'A5 . . A5 G5 . F5 .', 'C5 . F5 . A5 . C6 .', 'Bb5 . . Bb5 A5 . G5 .', 'E5 . G5 . C6 . . .',
    'A5 . C6 . A5 . F5 .', 'D6 . Bb5 . F5 . D5 .'];
  var YUKAI_MEL = YUKAI_A.concat([
    'E5 . G5 . Bb5 . E5 .', 'F5 . C5 . F5 . . .',
    'D5 . F5 . Bb5 . . .', 'A5 . Bb5 . C6 . D6 .', 'C6 . . A5 C6 . . A5', 'F5 . G5 . A5 . . .',
    'B5 . . B5 D6 . B5 .', 'G5 . F5 . D5 . B4 .', 'C5 . E5 . G5 . C6 .', 'Bb5 . G5 . E5 . C5 .'],
    YUKAI_A, ['E5 . G5 . C6 . E6 .', 'F6 . C6 . F5 . . .']);
  // いやし：A(8) B(8)
  var IYASHI_CH = ['C', 'Am', 'F', 'G', 'C', 'Em', 'F', 'G',  'Am', 'Em', 'F', 'C', 'Dm', 'Em', 'F', 'G'];
  var TRACKS = [
    { // タイトル：オルゴールとマリンバのやさしいワルツ（ヘ長調・3拍子）
      name: 'title', loop: true, tempo: 100, beatsPerBar: 3, stepsPerBeat: 2, vol: 1.4,
      parts: [
        { inst: 'box', vol: 0.55, pan: 0.1, notes: [
          'A5 - G5 - F5 -', 'G5 - - - C5 -', 'D5 - F5 - A5 -', 'F5 - - - D5 -',
          'A5 - G5 - F5 -', 'D6 - C6 - Bb5 -', 'C6 - Bb5 - G5 -', 'F5 - - - - .',
          'F5 - Bb5 - D6 -', 'C6 - - - A5 -', 'Bb5 - A5 - G5 -', 'E5 - - - G5 -',
          'A5 - C6 - E6 -', 'D6 - - - A5 -', 'G5 - Bb5 - D6 -', 'E6 - D6 - Bb5 -'] },
        { inst: 'marimba', vol: 0.3, pan: -0.15, notes: [
          'F3 C4 F4 A4 F4 C4', 'C3 G3 C4 E4 C4 G3', 'D3 A3 D4 F4 D4 A3', 'Bb2 F3 Bb3 D4 Bb3 F3',
          'F3 C4 F4 A4 F4 C4', 'Bb2 F3 Bb3 D4 Bb3 F3', 'C3 G3 Bb3 E4 Bb3 G3', 'F3 C4 F4 A4 F4 C4',
          'Bb2 F3 Bb3 D4 Bb3 F3', 'F3 C4 F4 A4 F4 C4', 'G2 D3 G3 Bb3 G3 D3', 'C3 G3 C4 E4 C4 G3',
          'A2 E3 A3 C4 A3 E3', 'D3 A3 D4 F4 D4 A3', 'G2 D3 G3 Bb3 G3 D3', 'C3 G3 Bb3 E4 Bb3 G3'] },
        { inst: 'pad', vol: 0.5, notes: [
          'F3+A3+C4 - - - - -', 'E3+G3+C4 - - - - -', 'D3+F3+A3 - - - - -', 'D3+F3+Bb3 - - - - -',
          'F3+A3+C4 - - - - -', 'D3+F3+Bb3 - - - - -', 'E3+G3+Bb3 - - - - -', 'F3+A3+C4 - - - - -',
          'D3+F3+Bb3 - - - - -', 'F3+A3+C4 - - - - -', 'D3+G3+Bb3 - - - - -', 'E3+G3+C4 - - - - -',
          'E3+A3+C4 - - - - -', 'D3+F3+A3 - - - - -', 'D3+G3+Bb3 - - - - -', 'E3+G3+Bb3 - - - - -'] }
      ] },
    { // プレイ1：ピチカートでてくてく歩く（ハ長調・ズン・チャッのはずむ伴奏）
      name: 'play1', loop: true, tempo: 116, beatsPerBar: 4, stepsPerBeat: 2, vol: 0.9,
      parts: [
        { inst: 'pluck', vol: 0.55, pan: 0.1, notes: [
          'E5 . G5 . C6 . G5 .', 'A5 . E5 . C5 . E5 .', 'F5 . A5 . C6 . A5 .', 'G5 . B5 . D6 . B5 .',
          'E5 . G5 . C6 . E6 .', 'C6 . A5 . E5 . A5 .', 'D5 . F5 . G5 . B5 .', 'C6 . G5 . C5 . . .',
          'A5 . . C6 A5 . F5 .', 'G5 . . E5 G5 . C5 .', 'F5 . E5 . D5 . F5 .', 'G5 . A5 . B5 . D6 .',
          'C6 . A5 . F5 . A5 .', 'G5 . E5 . C5 . E5 .', 'D5 . F5 . A5 . F5 .', 'G5 . B5 . D6 . B5 .'] },
        { inst: 'bass', vol: 0.55, notes: [
          'C3 . . . G2 . . .', 'A2 . . . E3 . . .', 'F2 . . . C3 . . .', 'G2 . . . D3 . . .',
          'C3 . . . G2 . . .', 'A2 . . . E3 . . .', 'D3 . . . G2 . . .', 'C3 . . . G2 . . .',
          'F2 . . . C3 . . .', 'C3 . . . G2 . . .', 'D3 . . . A2 . . .', 'G2 . . . D3 . . .',
          'F2 . . . C3 . . .', 'C3 . . . G2 . . .', 'D3 . . . A2 . . .', 'G2 . . . D3 . . .'] },
        { inst: 'pluck', vol: 0.26, pan: -0.25, notes: [
          '. . E4+G4 . . . E4+G4 .', '. . E4+A4 . . . E4+A4 .', '. . F4+A4 . . . F4+A4 .', '. . D4+G4 . . . D4+G4 .',
          '. . E4+G4 . . . E4+G4 .', '. . E4+A4 . . . E4+A4 .', '. . D4+F4 . . . D4+G4 .', '. . E4+G4 . . . E4+G4 .',
          '. . F4+A4 . . . F4+A4 .', '. . E4+G4 . . . E4+G4 .', '. . D4+F4 . . . D4+F4 .', '. . D4+G4 . . . D4+G4 .',
          '. . F4+A4 . . . F4+A4 .', '. . E4+G4 . . . E4+G4 .', '. . D4+F4 . . . D4+F4 .', '. . D4+G4 . . . D4+G4 .'] },
        { inst: 'drum', vol: 0.5, notes: ['k h:0.4 h h:0.4 k h:0.4 h h:0.4'] }
      ] },
    { // のんびり（第4期の play2 をそのまま使う。play2 の名前でも呼べる）：ゆったりしたオルゴール調の鈴（ニ長調・メジャー7の和音・軽いスイング）
      name: 'nonbiri', loop: true, tempo: 82, beatsPerBar: 4, stepsPerBeat: 2, swing: 0.1, tone: 3400, vol: 0.7,
      parts: [
        { inst: 'bell', vol: 0.5, pan: 0.15, notes: [
          '. . B5 - A5 - F#5 -', 'E5 - - - . . C#5 -', '. . D5 - E5 - G5 -', 'F#5 - - - E5 - - -',
          '. . B5 - A5 - G5 -', 'A5 - - - E5 - C#5 -', '. . D5 - F#5 - A5 -', 'G5 - - - E5 - . .',
          '. . . . D6 - B5 -', 'C#6 - - - A5 - . .', '. . . . G5 - B5 -', 'C#6 - - - A5 - . .',
          '. . . . B5 - D6 -', 'E6 - - - C#6 - . .', '. . F#5 - A5 - D6 -', 'C#6 - - - - - . .'] },
        { inst: 'bell', vol: 0.32, pan: -0.2, notes: [
          'B3+D4+F#4 - - B3+D4+F#4 - - - .', 'A3+C#4+E4 - - A3+C#4+E4 - - - .',
          'G3+B3+D4 - - G3+B3+D4 - - - .', 'G3+C#4+E4 - - G3+C#4+E4 - - - .',
          'G3+B3+D4 - - G3+B3+D4 - - - .', 'A3+C#4+E4 - - A3+C#4+E4 - - - .',
          'B3+D4+F#4 - - B3+D4+F#4 - - - .', 'G3+C#4+E4 - - G3+C#4+E4 - - - .'] },
        { inst: 'bass', vol: 0.55, notes: [
          'G2 - - - - . G2 -', 'F#2 - - - - . F#2 -', 'E2 - - - - . E2 -', 'A2 - - - - . A2 -',
          'E2 - - - - . E2 -', 'F#2 - - - - . F#2 -', 'G2 - - - - . G2 -', 'A2 - - - - . A2 -'] },
        { inst: 'drum', vol: 0.45, notes: ['k . h . s . h .', 'k . h k s . h h:0.6'] }
      ] },
    { // プレイ3：軽やかな冒険（ニ長調・ハープのアルペジオと口笛、トコトンと進むタム）
      name: 'play3', loop: true, tempo: 124, beatsPerBar: 4, stepsPerBeat: 2, vol: 0.75,
      parts: [
        { inst: 'whistle', vol: 0.5, pan: 0.15, notes: [
          'F#5 - - - A5 - - -', 'G5 - - - E5 - - -', 'D5 - - - B4 - D5 -', 'A4 - - - - - . .',
          'F#5 - - - A5 - D6 -', 'E6 - - - C6 - G5 -', 'B5 - - - D6 - B5 -', 'C#6 - - - - - . .',
          'D6 - - - B5 - F#5 -', 'G5 - - - B5 - D6 -', 'A5 - - - F#5 - D5 -', 'E5 - - - C#5 - E5 -',
          'F#5 - - - B5 - D6 -', 'D6 - - - B5 - G5 -', 'B5 - - - G5 - E5 -', 'C#5 - - - E5 - A5 -'] },
        { inst: 'harp', vol: 0.32, pan: -0.25, notes: [
          'D4 A4 D5 A4 F#5 A4 D5 A4', 'C4 G4 C5 G4 E5 G4 C5 G4', 'G3 D4 G4 D4 B4 D4 G4 D4', 'D4 A4 D5 A4 F#5 A4 D5 A4',
          'D4 A4 D5 A4 F#5 A4 D5 A4', 'C4 G4 C5 G4 E5 G4 C5 G4', 'G3 D4 G4 D4 B4 D4 G4 D4', 'A3 E4 A4 E4 C#5 E4 A4 E4',
          'B3 F#4 B4 F#4 D5 F#4 B4 F#4', 'G3 D4 G4 D4 B4 D4 G4 D4', 'D4 A4 D5 A4 F#5 A4 D5 A4', 'A3 E4 A4 E4 C#5 E4 A4 E4',
          'B3 F#4 B4 F#4 D5 F#4 B4 F#4', 'G3 D4 G4 D4 B4 D4 G4 D4', 'E4 B4 E5 B4 G5 B4 E5 B4', 'A3 E4 A4 E4 C#5 E4 A4 E4'] },
        { inst: 'bass', vol: 0.5, notes: [
          'D3 - - . A2 - - .', 'C3 - - . G2 - - .', 'G2 - - . D3 - - .', 'D3 - - . A2 - - .',
          'D3 - - . A2 - - .', 'C3 - - . G2 - - .', 'G2 - - . D3 - - .', 'A2 - - . E3 - - .',
          'B2 - - . F#2 - - .', 'G2 - - . D3 - - .', 'D3 - - . A2 - - .', 'A2 - - . E3 - - .',
          'B2 - - . F#2 - - .', 'G2 - - . D3 - - .', 'E3 - - . B2 - - .', 'A2 - - . E3 - - .'] },
        { inst: 'drum', vol: 0.45, notes: ['t . h t . h t h:0.5'] }
      ] },

    { // げんき（プレイの既定）：運動会・パーティーの明るい行進（ト長調・138・ズン・チャッの伴奏・軽い小太鼓）。A(8) B(8) A'(8)
      name: 'genki', loop: true, tempo: 138, beatsPerBar: 4, stepsPerBeat: 2, vol: 1.4,
      parts: [
        { inst: 'whistle', vol: 0.42, pan: 0.1, notes: GENKI_MEL },
        { inst: 'glock', vol: 0.16, pan: 0.25, notes: GENKI_MEL },
        { inst: 'pluck', vol: 0.24, pan: -0.25, notes: byChord(GENKI_CH, {
          G: '. . D4+G4+B4 . . . D4+G4+B4 .', D: '. . D4+F#4+A4 . . . D4+F#4+C5 .',
          C: '. . E4+G4+C5 . . . E4+G4+C5 .', Am: '. . E4+A4+C5 . . . E4+A4+C5 .' }) },
        { inst: 'bass', vol: 0.3, notes: byChord(GENKI_CH, {
          G: 'G2 . . . D3 . . .', D: 'D3 . . . A2 . . .', C: 'C3 . . . G2 . . .', Am: 'A2 . . . E3 . . .' }) },
        { inst: 'drum', vol: 0.4, notes: [
          'k h:0.35 s:0.5 h:0.35 k h:0.35 s:0.5 h:0.35', 'k h:0.35 s:0.5 h:0.35 k h:0.35 s:0.5 h:0.35',
          'k h:0.35 s:0.5 h:0.35 k h:0.35 s:0.5 h:0.35', 'k h:0.35 s:0.5 h:0.35 k h:0.35 s:0.5 s:0.35',
          'k h:0.35 s:0.5 h:0.35 k h:0.35 s:0.5 h:0.35', 'k h:0.35 s:0.5 h:0.35 k h:0.35 s:0.5 h:0.35',
          'k h:0.35 s:0.5 h:0.35 k h:0.35 s:0.5 h:0.35', 'k . s:0.35 s:0.4 s:0.45 s:0.5 s:0.6 .'] }
      ] },
    { // ゆかい：ぴょこぴょこ はずむ おどけた曲（ヘ長調・120・スタッカートのマリンバと木のカチカチ）。A(8) B(8) A'(8)
      name: 'yukai', loop: true, tempo: 120, beatsPerBar: 4, stepsPerBeat: 2, swing: 0.14, vol: 1.6,
      parts: [
        { inst: 'marimba', vol: 0.6, pan: 0.15, notes: YUKAI_MEL },
        { inst: 'pluck', vol: 0.22, pan: -0.3, notes: byChord(YUKAI_CH, {
          F: '. . A4+C5 . . . A4+C5 .', C: '. . G4+C5 . . . G4+Bb4 .', Bb: '. . F4+Bb4+D5 . . . F4+Bb4 .',
          G7: '. . F4+B4 . . . F4+B4+D5 .', C7: '. . E4+Bb4 . . . E4+G4+Bb4 .' }) },
        { inst: 'pluck', vol: 0.4, notes: byChord(YUKAI_CH, {   // ぽこぽこ歩くベース（ピチカート）
          F: 'F2 . . . C3 . A2 .', C: 'C3 . . . G2 . E2 .', Bb: 'Bb2 . . . F2 . D3 .',
          G7: 'G2 . . . D3 . B2 .', C7: 'C3 . . . G2 . Bb2 .' }) },
        { inst: 'drum', vol: 0.42, notes: [
          'k r:0.7 . r k r:0.7 r:0.5 .', 'k r:0.7 . r k . r:0.6 r:0.8',
          'k r:0.7 . r k r:0.7 r:0.5 .', 'k r:0.7 . r k r:0.6 r:0.7 r:0.9'] }
      ] },
    { // いやし：やわらかいパッドとハープのアルペジオ、ゆっくりした笛（ハ長調・72・打楽器なし）。A(8) B(8)
      name: 'iyashi', loop: true, tempo: 72, beatsPerBar: 4, stepsPerBeat: 2, tone: 3200, vol: 1.16,
      parts: [
        { inst: 'whistle', vol: 0.34, pan: 0.15, notes: [
          'E5 - - - G5 - - -', 'C6 - - - - - B5 -', 'A5 - - - G5 - E5 -', 'D5 - - - - - . .',
          'E5 - - - G5 - C6 -', 'B5 - - - - - G5 -', 'A5 - - - C6 - E6 -', 'D6 - - - - - . .',
          'C6 - - - B5 - A5 -', 'G5 - - - - - E5 -', 'F5 - - - A5 - C6 -', 'B5 - - - - - G5 -',
          'A5 - - - F5 - A5 -', 'G5 - - - E5 - G5 -', 'A5 - - - G5 - F5 -', 'D5 - - - - - . .'] },
        { inst: 'harp', vol: 0.4, pan: -0.2, notes: byChord(IYASHI_CH, {
          C: 'C4 G4 B4 E5 G5 E5 B4 G4', Am: 'A3 E4 G4 C5 E5 C5 G4 E4', F: 'F3 C4 E4 A4 C5 A4 E4 C4',
          G: 'G3 D4 G4 B4 D5 B4 G4 D4', Em: 'E3 B3 D4 G4 B4 G4 D4 B3', Dm: 'D3 A3 C4 F4 A4 F4 C4 A3' }) },
        { inst: 'pad', vol: 0.55, notes: byChord(IYASHI_CH, {
          C: 'E3+G3+B3+C4 - - - - - - -', Am: 'E3+G3+A3+C4 - - - - - - -', F: 'F3+A3+C4+E4 - - - - - - -',
          G: 'D3+G3+B3+D4 - - - - - - -', Em: 'E3+G3+B3+D4 - - - - - - -', Dm: 'D3+F3+A3+C4 - - - - - - -' }) },
        { inst: 'bass', vol: 0.22, notes: byChord(IYASHI_CH, {
          C: 'C3 - - - - - - -', Am: 'A2 - - - - - - -', F: 'F2 - - - - - - -',
          G: 'G2 - - - - - - -', Em: 'E2 - - - - - - -', Dm: 'D2 - - - - - - -' }) }
      ] },

    // ---- ジングル（1回だけ鳴る）----
    { // かち：明るく短いファンファーレ（ハ長調）
      name: 'win', loop: false, tempo: 150, beatsPerBar: 4, stepsPerBeat: 2, vol: 1,
      parts: [
        { inst: 'horn', vol: 0.8, notes: ['G4 C5 E5 G5 - E5 G5 -', 'C6 - - - - - - -'] },
        { inst: 'horn', vol: 0.45, notes: ['. . . . . . . .', 'C4+E4+G4 - - - - - - -'] },
        { inst: 'glock', vol: 0.45, notes: ['. . . . . . . .', 'C6+E6+G6 . E6 . G6 . C7 .'] },
        { inst: 'bass', vol: 0.5, notes: ['C3 . . . G2 . . .', 'C3 - - - - - - -'] },
        { inst: 'drum', vol: 0.5, notes: ['k . . . k . s .', 'k+s . . . . . . .'] }
      ] },
    { // まけ：やさしく「つぎは きっと できるよ」（ヘ長調・上へ向かって終わる。悲しくしない）
      name: 'lose', loop: false, tempo: 132, beatsPerBar: 4, stepsPerBeat: 2, vol: 1,
      parts: [
        { inst: 'marimba', vol: 0.6, notes: ['F5 - D5 - F5 - - -', 'E5 - G5 - C6 - - -', 'A5 - - -'] },
        { inst: 'pad', vol: 0.6, notes: ['Bb3+D4+F4 - - - - - - -', 'C4+E4+G4 - - - - - - -', 'F3+A3+C4+D4 - - -'] },
        { inst: 'bass', vol: 0.45, notes: ['Bb2 - - - - - - -', 'C3 - - - - - - -', 'F2 - - -'] },
        { inst: 'glock', vol: 0.3, notes: ['. . . . . . . .', '. . . . . . . .', '. . C6 F6'] }
      ] },
    { // れんしゅう：「よく できました」の元気な合図（ハ長調）
      name: 'practice', loop: false, tempo: 140, beatsPerBar: 4, stepsPerBeat: 2, vol: 1,
      parts: [
        { inst: 'pluck', vol: 0.6, notes: ['E5 . G5 . C6 . . .', 'A5 . C6 . B5 . D6 .', 'C6 - - -'] },
        { inst: 'pluck', vol: 0.28, notes: ['. . E4+G4 . . . E4+G4 .', '. . F4+A4 . . . D4+G4 .', 'E4+G4+C5 - - -'] },
        { inst: 'glock', vol: 0.35, notes: ['. . . . . . . .', '. . . . . . . .', 'C6+E6+G6 - - -'] },
        { inst: 'bass', vol: 0.5, notes: ['C3 . . . G2 . . .', 'F2 . . . G2 . . .', 'C3 - - -'] },
        { inst: 'drum', vol: 0.45, notes: ['k . h . k . h .', 'k . h . k . h h', 'k+s . . .'] }
      ] },
    { // へいわの しょうり：あたたかく、みんなが うれしい（ヘ長調・メジャー7）
      name: 'peace', loop: false, tempo: 112, beatsPerBar: 4, stepsPerBeat: 2, vol: 1,
      parts: [
        { inst: 'box', vol: 0.5, notes: ['F4 A4 C5 E5 A5 E5 C5 A4', 'Bb4 D5 F5 A5 D6 A5 F5 D5', 'G4 C5 E5 G5 F5+A5+C6 - - -', '- - - -'] },
        { inst: 'pad', vol: 0.7, notes: ['F3+A3+C4+E4 - - - - - - -', 'Bb3+D4+F4+A4 - - - - - - -', 'C4+E4+G4 - - - F3+A3+C4+G4 - - -', '- - - -'] },
        { inst: 'bass', vol: 0.4, notes: ['F2 - - - - - - -', 'Bb2 - - - - - - -', 'C3 - - - F2 - - -', '- - - -'] },
        { inst: 'glock', vol: 0.3, notes: ['. . . . . . . .', '. . . . . . . .', '. . . . C6 . F6 .', 'A6 . C7 .'] }
      ] }
  ];
  // 古い名前 play2 は のんびり と同じ曲（第4期の名前のまま呼べるように、同じ譜面を別の名前でも置く）
  (function () {
    var src = null, cp = {}, k;
    for (var i = 0; i < TRACKS.length; i++) if (TRACKS[i].name === 'nonbiri') src = TRACKS[i];
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) cp[k] = src[k];
    cp.name = 'play2';
    TRACKS.push(cp);
  })();
  // 設定画面で選べるプレイ中の曲（先頭が既定）
  var PLAY_TRACKS = [{ name: 'genki', label: 'げんき' }, { name: 'yukai', label: 'ゆかい' }, { name: 'nonbiri', label: 'のんびり' }, { name: 'iyashi', label: 'いやし' }];

  /* ===== S08. 譜面を読んで予約する（BGM はタイマーで少し先まで予約、ジングルは一度に全部予約） ===== */
  var NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function noteFreq(s) {
    var m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
    if (!m) return 0;
    var midi = (parseInt(m[3], 10) + 1) * 12 + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
  function parseNotes(notes, drum) {
    var text = (typeof notes === 'string' ? notes : notes.join(' | ')).replace(/\|/g, ' ');
    var toks = text.trim().split(/\s+/), ev = [], last = null;
    for (var i = 0; i < toks.length; i++) {
      var tok = toks[i];
      if (tok === '.') { ev.push(null); last = null; continue; }
      if (tok === '-') { ev.push(null); if (last) last.len++; continue; }
      var vel = 1, k = tok.indexOf(':');
      if (k > 0) { vel = parseFloat(tok.slice(k + 1)); if (!(vel >= 0)) vel = 1; tok = tok.slice(0, k); }
      var list = tok.split('+'), n = [];
      for (var j = 0; j < list.length; j++) {
        if (drum) { if (DRUM[list[j]]) n.push(list[j]); } else { var f = noteFreq(list[j]); if (f) n.push(f); }
      }
      last = { n: n, len: 1, vel: vel };
      ev.push(last);
    }
    return ev;
  }
  function compile(tr) {
    var parts = [], len = 0;
    (tr.parts || []).forEach(function (p) {
      var drum = p.inst === 'drum';
      if (!drum && !INST[p.inst]) return;
      var ev = parseNotes(p.notes || '', drum);
      if (!ev.length) return;
      parts.push({ inst: p.inst, drum: drum, ev: ev, vol: p.vol == null ? 1 : p.vol, pan: p.pan || 0 });
      len = Math.max(len, ev.length);
    });
    return { parts: parts, len: len };
  }
  function findTrack(name) {
    for (var i = 0; i < TRACKS.length; i++) if (TRACKS[i] && TRACKS[i].name === name) return TRACKS[i];
    return null;
  }
  function startSong(tr, bus, t0, fadeIn) {
    var c = compile(tr), o = newOwner(bus, 0), head = o.g, vol = tr.vol == null ? 1 : tr.vol;
    if (tr.tone) head = filt('lowpass', tr.tone, 0.5, o.g);
    if (fadeIn > 0) { o.g.gain.setValueAtTime(0, t0); o.g.gain.setTargetAtTime(vol, t0, fadeIn / 3); }
    else o.g.gain.setValueAtTime(vol, t0);
    var nodes = c.parts.map(function (p) {
      var pg = gainNode(G.ctx, p.vol);
      if (p.pan && G.ctx.createStereoPanner) { var pn = G.ctx.createStereoPanner(); pn.pan.value = p.pan; pg.connect(pn); pn.connect(head); }
      else pg.connect(head);
      return pg;
    });
    return { tr: tr, c: c, o: o, nodes: nodes, step: 0, t0: t0, next: t0, sd: 60 / tr.tempo / (tr.stepsPerBeat || 2), ended: false };
  }
  function scheduleSong(s, until) {
    var sw = (s.tr.swing || 0) * s.sd;
    while (s.next < until && !s.ended) {
      for (var i = 0; i < s.c.parts.length; i++) {
        var p = s.c.parts[i], e = p.ev[s.step % p.ev.length];
        if (!e) continue;
        var t = s.next + (s.step % 2 ? sw : 0), dur = e.len * s.sd;
        for (var j = 0; j < e.n.length; j++) {
          if (p.drum) DRUM[e.n[j]](s.o, s.nodes[i], t, e.vel);
          else INST[p.inst](s.o, s.nodes[i], e.n[j], t, dur, e.vel);
        }
      }
      s.step++; s.next += s.sd;
      if (!s.tr.loop && s.step >= s.c.len) s.ended = true;
    }
  }
  function tick() {
    try {
      if (!ready()) return;
      syncMute();
      if (!song) { stopTimer(); return; }
      if (paused) return;
      var t = now();
      if (song.next < t - 0.05) song.next = t + 0.05;   // 画面が裏にいて遅れたときは、追いつこうとせず今から続ける
      scheduleSong(song, t + LOOKAHEAD);
    } catch (e) {}
  }
  function startTimer() { if (!timer) timer = setInterval(tick, TICK_MS); }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function duck(sec) {
    glide(G.duck.gain, MIX.duck, 0.05);
    G.duck.gain.setTargetAtTime(1, now() + sec, 0.4);
  }

  /* ===== S09. 効果音（1回鳴らす音） ===== */
  // 高さが f0 → f1 に変わる音
  function tn(o, type, f0, f1, t, glideT, peak, atk, tc, d) {
    var g = vca(d || o.g), end = strike(g, t, peak, atk, tc), n = osc(o, type, f0, t, end, g);
    if (f1 && f1 !== f0) n.frequency.exponentialRampToValueAtTime(f1, t + glideT);
    return n;
  }
  // フィルターを通したノイズ
  function nz(o, ftype, f0, f1, q, t, glideT, peak, atk, tc, d) {
    var g = vca(d || o.g), end = strike(g, t, peak, atk, tc), fl = filt(ftype, f0, q, g);
    if (f1 && f1 !== f0) fl.frequency.exponentialRampToValueAtTime(f1, t + glideT);
    nsrc(o, t, end, fl);
  }
  function rr(a, b) { return a + Math.random() * (b - a); }
  var SFX = {
    // ボタン：小さく丸い「ポッ」
    tap: function (o, t) {
      tn(o, 'sine', 520, 780, t, 0.04, 0.24, 0.004, 0.035);
      tn(o, 'sine', 1560, 0, t + 0.025, 0, 0.05, 0.002, 0.02);
    },
    // カウントダウンの「ピッ」
    count: function (o, t) {
      var g = vca(o.g), end = sustain(g, t, 0.26, 0.004, 0.1, 0.02);
      osc(o, 'sine', 880, t, end, g);
      var g2 = vca(o.g); osc(o, 'triangle', 1760, t, sustain(g2, t, 0.05, 0.004, 0.1, 0.02), g2);
    },
    // GO!：明るいイ長調の和音をすばやく鳴らして、高い音をのばす
    go: function (o, t) {
      [880, 1108.73, 1318.51].forEach(function (f, i) { INST.glock(o, o.g, f, t + i * 0.035, 0.5, 0.9); });
      var g = vca(o.g); osc(o, 'sine', 1760, t, sustain(g, t, 0.13, 0.01, 0.38, 0.1), g);
      var g2 = vca(o.g); osc(o, 'triangle', 880, t, sustain(g2, t, 0.12, 0.01, 0.38, 0.1), g2);
    },
    // ジャンプ「ビョーン」：上がりながらばねのようにゆれる
    jump: function (o, t) {
      var g = vca(o.g), end = sustain(g, t, 0.3, 0.012, 0.2, 0.07);
      var c = osc(o, 'sine', 230, t, end, g);
      c.frequency.exponentialRampToValueAtTime(700, t + 0.26);
      var lg = G.ctx.createGain(); lg.connect(c.frequency);
      lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(70, t + 0.06); lg.gain.setTargetAtTime(0, t + 0.1, 0.08);
      osc(o, 'sine', 17, t, end, lg);
      var g2 = vca(o.g), e2 = sustain(g2, t, 0.06, 0.012, 0.16, 0.05);
      osc(o, 'triangle', 460, t, e2, g2).frequency.exponentialRampToValueAtTime(1400, t + 0.26);
    },
    // 着地「トン」
    land: function (o, t) {
      tn(o, 'sine', 170, 55, t, 0.12, 0.36, 0.003, 0.06);
      nz(o, 'lowpass', 600, 0, 0.7, t, 0, 0.18, 0.002, 0.03);
    },
    // 段差「ガタン」：高めの「ガ」と低めの「タン」
    step: function (o, t) {
      nz(o, 'bandpass', 1500, 0, 1.2, t, 0, 0.28, 0.002, 0.018);
      tn(o, 'triangle', 260, 170, t, 0.05, 0.18, 0.002, 0.03);
      nz(o, 'bandpass', 650, 0, 1.0, t + 0.075, 0, 0.3, 0.002, 0.03);
      tn(o, 'sine', 160, 95, t + 0.075, 0.07, 0.32, 0.003, 0.045);
    },
    // 壁に衝突「ガツッ」：短く、耳に痛くない
    bump: function (o, t) {
      nz(o, 'bandpass', 1100, 500, 0.9, t, 0.06, 0.45, 0.001, 0.03);
      tn(o, 'sine', 190, 75, t, 0.08, 0.45, 0.002, 0.045);
      tn(o, 'triangle', 740, 0, t, 0, 0.06, 0.001, 0.05);
      tn(o, 'sine', 1170, 0, t, 0, 0.04, 0.001, 0.04);
    },
    // ブロックが壊れる「ガラッ」：低い音のあとに小石がころころ
    'break': function (o, t) {
      nz(o, 'lowpass', 900, 300, 0.7, t, 0.2, 0.32, 0.002, 0.06);
      tn(o, 'sine', 130, 55, t, 0.12, 0.28, 0.002, 0.05);
      var tt = t + 0.015;
      for (var i = 0; i < 9; i++) {
        tt += rr(0.022, 0.05);
        nz(o, 'bandpass', rr(900, 3300), 0, 2.5, tt, 0, 0.26 * (1 - i / 10), 0.001, rr(0.01, 0.025));
        if (i % 3 === 1) tn(o, 'sine', rr(1500, 2700), 0, tt, 0, 0.04, 0.001, 0.012);
      }
    },
    // ドリルが当たる：ざくざく削る音
    drillHit: function (o, t) {
      tn(o, 'sine', 110, 60, t, 0.08, 0.36, 0.002, 0.05);
      for (var i = 0; i < 4; i++) nz(o, 'bandpass', rr(550, 1300), 0, 1.4, t + i * 0.028, 0, 0.26 * (1 - i * 0.18), 0.001, 0.016);
    },
    // 宝石が浮き上がる：上へのぼるきらめき（ハ長調ペンタトニック）
    gemRise: function (o, t) {
      [1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093].forEach(function (f, i) { INST.glock(o, o.g, f, t + i * 0.07, 0.3, 0.5); });
      var g = vca(o.g), end = sustain(g, t, 0.05, 0.3, 0.45, 0.15);
      osc(o, 'sine', 523.25, t, end, g).frequency.exponentialRampToValueAtTime(1568, t + 0.7);
      var g2 = vca(o.g); nsrc(o, t, sustain(g2, t, 0.04, 0.4, 0.5, 0.15), filt('highpass', 3000, 0.5, g2));
    },
    // 獲得のファンファーレ（約2.6秒。宣言の3.5秒に収まる）：のぼるきらめき → やわらかい金管の和音 → 星がふる
    fanfare: function (o, t) {
      duck(2.9);
      [783.99, 1046.5, 1318.51, 1567.98].forEach(function (f, i) { INST.glock(o, o.g, f, t + i * 0.07, 0.3, 0.85); });
      var t1 = t + 0.3;
      [261.63, 523.25, 659.25, 783.99].forEach(function (f, i) { INST.horn(o, o.g, f, t1, 1.3, i ? 0.75 : 0.55); });
      [1046.5, 1318.51, 1567.98, 2093].forEach(function (f, i) { INST.box(o, o.g, f, t1 + i * 0.03, 1, 0.55); });
      var tw = [2093, 2349.32, 2637.02, 3135.96, 3520];
      for (var i = 0; i < 12; i++) INST.glock(o, o.g, tw[Math.floor(Math.random() * 5)], t1 + 0.12 + i * 0.13 + Math.random() * 0.04, 0.2, 0.45 * (1 - i / 14));
      var g = vca(o.g); nsrc(o, t1, strike(g, t1, 0.04, 0.25, 0.35), filt('highpass', 6000, 0.5, g));
    },
    // お知らせ：「ポロン」と2つの音
    notice: function (o, t) {
      INST.box(o, o.g, 783.99, t, 0.4, 0.85);
      INST.box(o, o.g, 1046.5, t + 0.14, 0.6, 0.85);
    },
    // ソナーの正解「ピン・ピン・ピン」：明るく高い澄んだ音を3回（約0.6秒）。高すぎる倍音は入れず、耳に痛くしない
    pinpin: function (o, t) {
      [1318.51, 1567.98, 2093].forEach(function (f, i) {
        var tt = t + i * 0.15, tc = i < 2 ? 0.055 : 0.085;
        var g = vca(o.g), end = strike(g, tt, 0.3, 0.003, tc);
        fm(o, osc(o, 'sine', f, tt, end, g), 2, f, tt, end, 0.4, 0.02);   // 立ち上がりだけ少し明るい「ピ」
        var g2 = vca(o.g); osc(o, 'sine', f * 2, tt, strike(g2, tt, 0.04, 0.002, tc * 0.5), g2);
      });
    },
    // ---- 前の版の名前（互換）----
    move: function (o, t) { tn(o, 'sine', 230, 170, t, 0.09, 0.08, 0.004, 0.025); },
    turn: function (o, t) { nz(o, 'bandpass', 1300, 600, 1.0, t, 0.12, 0.09, 0.03, 0.04); },
    fire: function (o, t) {
      tn(o, 'sine', 300, 90, t, 0.25, 0.32, 0.003, 0.07);
      nz(o, 'bandpass', 1500, 500, 1.0, t, 0.12, 0.14, 0.002, 0.04);
    },
    boom: function (o, t) {
      tn(o, 'sine', 140, 40, t, 0.5, 0.45, 0.003, 0.14);
      SFX['break'](o, t);
    },
    found: function (o, t) { SFX.fanfare(o, t); },
    collect: function (o, t) { SFX.gemRise(o, t); },
    dig: function (o, t) { SFX.drillHit(o, t); }
  };

  /* ===== S10. 走る音のループ（キャタピラ／ドリル） ===== */
  // 状態ごとの目標：tread=キャタピラの音量, rate=速さと高さ, cut=明るさ, drill=ドリルの音量, out=消えるときの速さ
  function engTarget(s, st) {
    if (s === 'run') return { tread: 0.5 + 0.03 * st, rate: 1 + 0.1 * st, cut: 2200 + 500 * st, drill: 0, out: 0.12 };
    if (s === 'turn') return { tread: 0.36, rate: 0.72, cut: 1200, drill: 0, out: 0.12 };
    if (s === 'drill') return { tread: 0, rate: 1, cut: 2200, drill: 0.5, out: 0.08 };
    return { tread: 0, rate: 1, cut: 2200, drill: 0, out: s === 'air' ? 0.05 : 0.12 };
  }
  function makeLoop(buf, cut) {
    var c = G.ctx, o = newOwner(G.loop, 1);
    var src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    var fl = filt('lowpass', cut, 0.6, null), g = gainNode(c, 0, o.g);
    src.connect(fl); fl.connect(g);
    run(o, src, now(), 0, 0);
    return { o: o, src: src, fl: fl, g: g, timer: null };
  }
  function applyEngine() {
    if (!ready() || paused) return;
    var P = engTarget(eng.state, eng.stage), L;
    if (P.tread > 0 && !eng.tread) { eng.tread = makeLoop(G.tread, P.cut); eng.tread.src.playbackRate.value = P.rate; }
    if (P.drill > 0 && !eng.drill) eng.drill = makeLoop(G.drill, 1300);
    if ((L = eng.tread)) {
      glide(L.g.gain, P.tread, P.tread ? 0.04 : P.out);
      if (P.tread) { glide(L.src.playbackRate, P.rate, 0.12); glide(L.fl.frequency, P.cut, 0.12); }
      retire('tread', !P.tread);
    }
    if ((L = eng.drill)) { glide(L.g.gain, P.drill, P.drill ? 0.05 : P.out); retire('drill', !P.drill); }
  }
  // 鳴らさなくなったループは、消えきってから止める（すぐまた鳴らすなら使い回す）
  function retire(key, off) {
    var L = eng[key]; if (!L) return;
    if (L.timer) { clearTimeout(L.timer); L.timer = null; }
    if (!off) return;
    L.timer = setTimeout(function () { if (eng[key] === L) { eng[key] = null; kill(L.o, 0.05); } }, 900);
  }
  function killLoops(fade) {
    ['tread', 'drill'].forEach(function (k) {
      var L = eng[k]; if (!L) return;
      if (L.timer) clearTimeout(L.timer);
      kill(L.o, fade); eng[k] = null;
    });
  }

  /* ===== S11. 公開する関数 ===== */
  api.TRACKS = TRACKS;
  api.PLAY_TRACKS = PLAY_TRACKS;

  api.unlock = function () {
    try {
      if (!G && !broken) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { broken = true; return; }
        G = buildGraph(new AC());
        // iOS：最初のタッチの中で無音を1つ鳴らすと、そのあと音が出せるようになる
        var s = G.ctx.createBufferSource(); s.buffer = G.ctx.createBuffer(1, 1, G.ctx.sampleRate); s.connect(G.ctx.destination); s.start(0);
      }
      resume();
      if (ready() && wantBgm && !song) setBgm(wantBgm);
    } catch (e) { if (!G) broken = true; }
  };

  api.play = function (name) {
    try {
      if (!ready() || api.muted || !SFX[name]) return;
      resume(); syncMute();
      var t = now(), gap = MIN_GAP[name];
      if (gap && lastAt[name] != null && t - lastAt[name] < gap && t >= lastAt[name]) return;
      lastAt[name] = t;
      var o = newOwner(G.sfx, SFX_VOL[name] || 1);
      SFX[name](o, t + 0.005);
      finish(o);
    } catch (e) {}
  };

  api.engine = function (state, stage) {
    try {
      if (state !== 'run' && state !== 'turn' && state !== 'drill' && state !== 'air') state = 'idle';
      stage = Math.max(0, Math.min(5, Math.round(+stage || 0)));
      if (G) syncMute();
      if (eng.applied && state === eng.state && stage === eng.stage) return;   // 同じなら何もしない（毎フレーム呼んでよい）
      eng.state = state; eng.stage = stage;
      if (!ready()) { eng.applied = false; return; }
      eng.applied = true;
      applyEngine();
    } catch (e) {}
  };

  // 曲を替える本体。前の曲はやわらかく消す。すばやく何度も替えたときは、消えかけの曲を早く消して、重なるのは2曲までにする
  function setBgm(name) {
    wantBgm = name || null;
    if (!ready()) return;
    resume(); syncMute();
    if (name && song && song.tr.name === name) return;          // 同じ曲なら続ける
    fading = fading.filter(function (o) { return G.owners.indexOf(o) >= 0; });
    fading.forEach(function (o) { kill(o, 0.12); });
    fading = [];
    if (song) {                                                  // 前の曲はゆっくり消す（クロスフェード）。鳴り始めてすぐなら早めに
      kill(song.o, now() - song.t0 < 1.5 ? 0.3 : 0.9);
      fading.push(song.o); song = null;
    }
    if (!name) { stopTimer(); return; }
    var tr = findTrack(name); if (!tr || !tr.loop) return;
    if (jing) { kill(jing, 0.4); jing = null; }
    song = startSong(tr, G.music, now() + 0.05, 1.0);
    startTimer(); tick();
  }
  function cancelPreview() { if (pv) { clearTimeout(pv.timer); pv = null; } }

  api.bgm = function (name) {
    try { cancelPreview(); setBgm(name); } catch (e) {}
  };

  // 試し聴き：name の曲を secs 秒（既定4秒）だけ鳴らし、そのあと前に頼まれていた曲へ戻す。
  // 試し聴き中に bgm / jingle / stopAll が呼ばれたら、そちらを優先して試し聴きは終わる。続けて呼ぶと最後の曲だけが鳴る。
  api.preview = function (name, secs) {
    try {
      if (!ready()) return;
      var tr = findTrack(name); if (!tr || !tr.loop) return;
      var back = pv ? pv.back : wantBgm;
      cancelPreview();
      setBgm(name);
      var me = pv = { back: back, timer: 0 };
      me.timer = setTimeout(function () {
        if (pv !== me) return;
        pv = null;
        try { setBgm(me.back); } catch (e) {}
      }, Math.max(0.5, +secs || 4) * 1000);
    } catch (e) {}
  };

  api.jingle = function (name) {
    try {
      cancelPreview(); wantBgm = null;
      if (!ready()) return;
      resume(); syncMute();
      if (song) { kill(song.o, 0.5); song = null; }               // BGM は止める
      stopTimer();
      killLoops(0.15); eng.applied = false;
      if (jing) { kill(jing, 0.15); jing = null; }
      var tr = findTrack(name); if (!tr || api.muted) return;
      var s = startSong(tr, G.jingle, now() + 0.25, 0);
      scheduleSong(s, 1e9);
      jing = s.o; finish(s.o);
    } catch (e) {}
  };

  api.stopAll = function () {
    try {
      cancelPreview(); wantBgm = null; song = null; jing = null; fading = []; stopTimer();
      if (ready()) {
        killLoops(0.05);
        G.owners.slice().forEach(function (o) { kill(o, 0.05); });
        glide(G.duck.gain, 1, 0.05);
      }
      var keepPause = paused; eng = newEng(); paused = keepPause;
    } catch (e) {}
  };

  api.pause = function (on) {
    try {
      on = !!on;
      if (on === paused) return;
      paused = on;
      if (!ready()) return;
      if (on) {
        glide(G.musicPause.gain, 0, 0.05); glide(G.loopPause.gain, 0, 0.05);
        if (song) hush(song.o, now() + 0.3);       // 予約ずみの音も消えたあと止める（曲の位置は覚えておく）
        killLoops(0.3); eng.applied = false;
      } else {
        resume();
        glide(G.musicPause.gain, 1, 0.12); glide(G.loopPause.gain, 1, 0.05);
        if (song) { song.next = now() + 0.08; tick(); }
        eng.applied = true; applyEngine();
      }
    } catch (e) {}
  };

  /* ===== S12. 検査用（ゲームでは使わない） ===== */
  // いまの様子
  api._debug = function () {
    if (!G) return { ready: false };
    var n = 0; G.owners.forEach(function (o) { n += o.srcs.length; });
    return { ready: ready(), state: G.ctx.state, song: song ? song.tr.name : null, want: wantBgm, preview: !!pv,
      fading: fading.filter(function (o) { return G.owners.indexOf(o) >= 0; }).length, paused: paused, owners: G.owners.length, sources: n,
      engine: eng.state + ':' + eng.stage, tread: !!eng.tread, drill: !!eng.drill, timer: !!timer };
  };
  // OfflineAudioContext で1つの音を書き出す（kind: 'sfx'|'bgm'|'jingle'|'engine'|'mix'。engine の name は 'run:3' の形）
  api._render = function (kind, name, secs, rate) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    rate = rate || 44100;
    var oc = new OAC(2, Math.round(rate * secs), rate);
    var keep = [G, song, jing, eng, paused, api.muted, lastAt];
    api.muted = false; paused = false; eng = newEng(); lastAt = {};
    G = buildGraph(oc);
    try {
      var t0 = 0.05, s;
      if (kind === 'sfx') { var o = newOwner(G.sfx, SFX_VOL[name] || 1); SFX[name](o, t0); finish(o); }
      else if (kind === 'bgm') { s = startSong(findTrack(name), G.music, t0, 0.01); scheduleSong(s, secs); }
      else if (kind === 'jingle') { s = startSong(findTrack(name), G.jingle, t0, 0); scheduleSong(s, 1e9); }
      else if (kind === 'engine') { var a = name.split(':'); eng.state = a[0]; eng.stage = +a[1] || 0; applyEngine(); }
      else if (kind === 'mix') {   // BGM の上に効果音を重ねた確認用
        s = startSong(findTrack(name), G.music, t0, 0.01); scheduleSong(s, secs);
        ['bump', 'break', 'jump', 'step', 'drillHit', 'fanfare'].forEach(function (n, i) { var o2 = newOwner(G.sfx, SFX_VOL[n] || 1); SFX[n](o2, 1 + i * 1.2); finish(o2); });
      }
    } finally {
      G = keep[0]; song = keep[1]; jing = keep[2]; eng = keep[3]; paused = keep[4]; api.muted = keep[5]; lastAt = keep[6];
    }
    return oc.startRendering();
  };

  window.Sfx = api;
})();
