// sfx.js : WebAudio の合成効果音（window.Sfx だけ公開）。音声ファイルは使わない。
(function () {
  'use strict';
  var ctx = null, master = null, noiseBuf = null, lastMove = 0;
  var api = { muted: false };

  function unlock() {
    try {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.7;
        var comp = ctx.createDynamicsCompressor();
        master.connect(comp); comp.connect(ctx.destination);
        var len = Math.floor(ctx.sampleRate * 1.2);
        noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); }
    } catch (e) {}
  }

  // 音の高さ f0 → f1、長さ dur、波形 type、音量 vol、開始の遅れ at
  function tone(type, f0, f1, dur, vol, at) {
    var t = ctx.currentTime + (at || 0);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.015, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(dur, vol, fType, f0, f1, at) {
    var t = ctx.currentTime + (at || 0);
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = fType;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.2); s.stop(t + dur + 0.05);
  }

  var sounds = {
    move: function () {   // 小さくやわらかい「ぽ」
      var now = ctx.currentTime;
      if (now - lastMove < 0.12) return;   // 連続でも耳障りにならない
      lastMove = now;
      tone('sine', 220 + Math.random() * 20, 170, 0.09, 0.07);
    },
    turn: function () { tone('triangle', 420, 560, 0.12, 0.12); },
    tap: function () { tone('sine', 660, 880, 0.08, 0.2); tone('sine', 990, 990, 0.06, 0.08, 0.04); },
    bump: function () { tone('square', 140, 90, 0.12, 0.1); noise(0.08, 0.12, 'lowpass', 500); },
    fire: function () {   // ぽんっと打ち上げる
      tone('sine', 300, 90, 0.25, 0.35);
      tone('triangle', 700, 250, 0.15, 0.12);
      noise(0.12, 0.15, 'bandpass', 1500, 500);
    },
    boom: function () {   // 低い爆発音＋破片っぽいノイズ
      tone('sine', 140, 38, 0.7, 0.6);
      tone('sawtooth', 90, 40, 0.45, 0.2);
      noise(0.55, 0.45, 'lowpass', 1800, 120);
      for (var i = 0; i < 6; i++) {
        noise(0.05 + Math.random() * 0.06, 0.12, 'highpass', 2500 + Math.random() * 3000, null, 0.08 + i * 0.07 + Math.random() * 0.04);
      }
    },
    found: function () {  // キラキラ上昇のファンファーレ
      var n = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
      n.forEach(function (f, i) {
        tone('triangle', f, f, 0.28, 0.2, i * 0.09);
        tone('sine', f * 2, f * 2, 0.2, 0.06, i * 0.09 + 0.02);
      });
      var t0 = 0.6;
      [1046.5, 1318.5, 1568].forEach(function (f) { tone('triangle', f, f, 0.7, 0.18, t0); });
      tone('sine', 523.25, 523.25, 0.7, 0.15, t0);
      for (var i = 0; i < 8; i++) tone('sine', 2000 + Math.random() * 2500, null, 0.08, 0.04, 0.45 + i * 0.07);
    }
  };

  api.unlock = unlock;
  api.play = function (name) {
    try {
      if (api.muted || !ctx || !sounds[name]) return;
      if (ctx.state === 'suspended') { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); }
      sounds[name]();
    } catch (e) {}
  };
  window.Sfx = api;
})();
