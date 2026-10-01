(() => {
'use strict';
// ====== 設定 ======
const Q = new URLSearchParams(location.search);
const AUTO = Q.get('auto') === '1';          // 1P側もCPUにする（動作確認用）
const SPEED = Math.max(1, +(Q.get('speed') || 1)); // 1描画で進めるフレーム数（動作確認用）
const NORENDER = Q.get('norender') === '1'; // 描画を省略して高速に試合を回す（検証用）
const RING_R = 5.0, BODY_R = 0.38, MIN_SEP = 0.78;
const WIN_ROUNDS = 2, ROUND_TIME = 60;

const MOVES = {
  P:  { name:'パンチ',   h:'high', su:6,  ac:3, rc:11, dmg:6,  hs:15, bs:9,  range:1.45, kb:0.10, pose:'punch' },
  K:  { name:'キック',   h:'mid',  su:11, ac:3, rc:17, dmg:11, hs:21, bs:11, range:1.85, kb:0.16, pose:'kick' },
  LK: { name:'下段キック', h:'low', su:9,  ac:3, rc:19, dmg:8,  hs:15, bs:8,  range:1.70, kb:0.08, pose:'lowkick' },
  EL: { name:'ひじ打ち', h:'mid',  su:13, ac:3, rc:20, dmg:14, hs:24, bs:13, range:1.55, kb:0.26, pose:'elbow', lunge:0.05 },
  TH: { name:'投げ',     h:'throw',su:12, ac:2, rc:34, dmg:20, range:1.20, pose:'throw' },
};

// ====== 入力 ======
const KEYMAP = {
  p1: { left:'KeyA', right:'KeyD', crouch:'KeyS', in:'KeyQ', out:'KeyE', p:'KeyJ', k:'KeyK', g:'KeyL' },
};
const keys = {};
function newInput() { return { fwd:false, back:false, crouch:false, sideIn:false, sideOut:false, p:false, k:false, g:false, pBuf:0, kBuf:0, gBuf:0 }; }

// ====== three.js ======
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0d1226, 18, 60);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
const TOUCH = Q.get('touch') === '1' || (matchMedia('(pointer:coarse)').matches) || ('ontouchstart' in window);
if (TOUCH) document.body.classList.add('touch');
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.fov = camera.aspect < 1 ? 55 : 38; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x30283c, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(4, 9, 6); scene.add(sun);
const rim = new THREE.DirectionalLight(0x7aa2ff, 0.5); rim.position.set(-6, 4, -6); scene.add(rim);

// 背景（グラデーションの球）
(function bg() {
  const c = document.createElement('canvas'); c.width = 8; c.height = 256;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#0a0f2a'); gr.addColorStop(0.55, '#3b2a63'); gr.addColorStop(0.78, '#c4577a'); gr.addColorStop(1, '#f2a65a');
  g.fillStyle = gr; g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.SphereGeometry(90, 24, 16), new THREE.MeshBasicMaterial({ map:t, side:THREE.BackSide, fog:false }));
  scene.add(m);
})();
// 遠景の柱
for (let i = 0; i < 14; i++) {
  const a = (i / 14) * Math.PI * 2, r = 22 + (i % 3) * 3;
  const h = 6 + (i * 7 % 5) * 2;
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, h, 1.6), new THREE.MeshLambertMaterial({ color: 0x1b1d3a }));
  m.position.set(Math.cos(a) * r, h / 2 - 3, Math.sin(a) * r); scene.add(m);
}
// 試合場（八角形の台）
(function ring() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#c9b48a' : '#b79f74'; g.fillRect(x * 64, y * 64, 64, 64); }
  g.strokeStyle = '#6e2a2a'; g.lineWidth = 10; g.beginPath(); g.arc(256, 256, 190, 0, 7); g.stroke();
  g.lineWidth = 4; g.beginPath(); g.moveTo(256, 60); g.lineTo(256, 452); g.moveTo(60, 256); g.lineTo(452, 256); g.stroke();
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
  const geo = new THREE.CylinderGeometry(RING_R, RING_R, 0.5, 8, 1);
  const top = new THREE.Mesh(geo, [new THREE.MeshLambertMaterial({ color:0x3a2c2c }), new THREE.MeshLambertMaterial({ map:tex }), new THREE.MeshLambertMaterial({ color:0x2a2020 })]);
  top.position.y = -0.25; top.rotation.y = Math.PI / 8; scene.add(top);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(RING_R * 1.0, 0.07, 6, 8), new THREE.MeshBasicMaterial({ color:0xff4d4d }));
  edge.rotation.x = Math.PI / 2; edge.rotation.z = Math.PI / 8; edge.position.y = 0.02; scene.add(edge);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(RING_R + 0.4, RING_R + 1.2, 6, 8), new THREE.MeshLambertMaterial({ color:0x141428 }));
  base.position.y = -3.4; base.rotation.y = Math.PI / 8; scene.add(base);
})();

// ====== キャラクターの体 ======
const L = { thigh:0.46, shin:0.46, uarm:0.30, farm:0.30 };
function limb(parent, mat, len, rad) {
  const g = new THREE.Group(); parent.add(g);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(rad, len - rad * 2, 4, 8), mat); m.position.y = -len / 2; g.add(m);
  return g;
}
function buildBody(gi, trim, skin, hair) {
  const mG = new THREE.MeshPhongMaterial({ color:gi, shininess:20 });
  const mT = new THREE.MeshPhongMaterial({ color:trim, shininess:30 });
  const mS = new THREE.MeshPhongMaterial({ color:skin, shininess:10 });
  const mH = new THREE.MeshPhongMaterial({ color:hair, shininess:40 });
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const hips = new THREE.Group(); body.add(hips);
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.2, 0.24), mT); pelvis.position.y = 0.02; hips.add(pelvis);
  const torso = new THREE.Group(); hips.add(torso);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.58, 0.28), mG); chest.position.y = 0.34; torso.add(chest);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.26), mT); belt.position.y = 0.08; torso.add(belt);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), mS); neck.position.y = 0.67; torso.add(neck);
  const head = new THREE.Group(); head.position.y = 0.72; torso.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), mS); skull.position.y = 0.12; head.add(skull);
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mH); hairM.position.y = 0.13; hairM.rotation.x = -0.3; head.add(hairM);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.02, 6, 16), mT); band.position.y = 0.17; band.rotation.x = Math.PI / 2; head.add(band);
  function arm(side) {
    const sh = new THREE.Group(); sh.position.set(side * 0.31, 0.58, 0); torso.add(sh);
    const ua = limb(sh, mG, L.uarm + 0.02, 0.06);
    const el = new THREE.Group(); el.position.y = -L.uarm; sh.add(el);
    const fa = limb(el, mS, L.farm + 0.03, 0.05);
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), mT); fist.position.y = -L.farm - 0.03; el.add(fist);
    return { sh, el };
  }
  function leg(side) {
    const hp = new THREE.Group(); hp.position.set(side * 0.13, -0.04, 0); hips.add(hp);
    limb(hp, mG, L.thigh + 0.02, 0.085);
    const kn = new THREE.Group(); kn.position.y = -L.thigh; hp.add(kn);
    limb(kn, mG, L.shin + 0.02, 0.07);
    const ft = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.07, 0.27), mT); ft.position.set(0, -L.shin - 0.01, 0.07); kn.add(ft);
    return { hp, kn };
  }
  const R = side => side;
  return { root, body, hips, torso, head, rArm:arm(1), lArm:arm(-1), rLeg:leg(1), lLeg:leg(-1), R };
}

// ====== ポーズ ======
const POSES = {
  idle:   { tx:0.12, ty:0.45, hx:0,    ra:1.05, rz:0.10, re:1.6, la:0.95, lz:0.10, le:1.8, rl:0.30, rk:0.55, ll:-0.22, lk:0.40, lie:0 },
  guard:  { tx:0.22, ty:0.45, hx:0.1,  ra:1.55, rz:0.15, re:2.1, la:1.45, lz:0.15, le:2.2, rl:0.30, rk:0.55, ll:-0.22, lk:0.40, lie:0 },
  crouch: { tx:0.55, ty:0.45, hx:-0.3, ra:1.05, rz:0.10, re:1.7, la:0.95, lz:0.10, le:1.9, rl:1.30, rk:2.10, ll:1.00, lk:1.95, lie:0 },
  cguard: { tx:0.60, ty:0.45, hx:-0.3, ra:1.60, rz:0.15, re:2.1, la:1.45, lz:0.15, le:2.3, rl:1.30, rk:2.10, ll:1.00, lk:1.95, lie:0 },
  punch:  { tx:0.20, ty:-0.35,hx:0,    ra:1.57, rz:0.05, re:0.05, la:0.8, lz:0.10, le:2.2, rl:0.35, rk:0.55, ll:-0.30, lk:0.45, lie:0 },
  kick:   { tx:-0.30,ty:0.30, hx:0.1,  ra:0.5,  rz:0.60, re:0.9, la:0.4, lz:0.60, le:1.0, rl:1.60, rk:0.12, ll:-0.12, lk:0.25, lie:0 },
  lowkick:{ tx:0.45, ty:0.20, hx:-0.2, ra:0.8,  rz:0.40, re:1.0, la:0.9, lz:0.20, le:1.7, rl:1.00, rk:0.00, ll:1.30, lk:2.20, lie:0 },
  elbow:  { tx:0.55, ty:-0.50,hx:-0.1, ra:0.95, rz:0.0,  re:2.7, la:1.0, lz:0.10, le:1.9, rl:0.55, rk:0.80, ll:-0.30, lk:0.50, lie:0 },
  throw:  { tx:0.30, ty:0.0,  hx:0,    ra:1.45, rz:0.25, re:0.30, la:1.45, lz:0.25, le:0.30, rl:0.45, rk:0.60, ll:-0.15, lk:0.45, lie:0 },
  grabbed:{ tx:0.55, ty:0.3,  hx:0.2,  ra:0.6,  rz:0.7,  re:0.6, la:0.6, lz:0.7, le:0.6, rl:0.20, rk:0.40, ll:-0.10, lk:0.30, lie:0 },
  hit:    { tx:-0.45,ty:0.30, hx:-0.5, ra:0.3,  rz:0.60, re:0.5, la:0.2, lz:0.60, le:0.6, rl:0.10, rk:0.30, ll:-0.30, lk:0.30, lie:0 },
  hitlow: { tx:0.65, ty:0.30, hx:0.2,  ra:0.6,  rz:0.40, re:0.8, la:0.6, lz:0.40, le:0.9, rl:0.40, rk:0.90, ll:-0.10, lk:0.60, lie:0 },
  fly:    { tx:-0.2, ty:0.0,  hx:-0.4, ra:-0.4, rz:1.0,  re:0.4, la:-0.4, lz:1.0, le:0.4, rl:0.3, rk:0.8, ll:0.1, lk:0.8, lie:0.55 },
  down:   { tx:0.0,  ty:0.0,  hx:0.1,  ra:0.2,  rz:0.45, re:0.2, la:0.2, lz:0.45, le:0.2, rl:0.15, rk:0.3, ll:0.05, lk:0.3, lie:1 },
  getup:  { tx:0.7,  ty:0.3,  hx:0,    ra:0.9,  rz:0.3,  re:1.5, la:0.9, lz:0.3, le:1.5, rl:1.1, rk:2.0, ll:0.8, lk:1.8, lie:0.2 },
  win:    { tx:-0.15,ty:0.0,  hx:-0.2, ra:2.9,  rz:0.1,  re:0.25, la:0.5, lz:0.5, le:0.7, rl:0.15, rk:0.3, ll:-0.10, lk:0.2, lie:0 },
  lose:   { tx:0.6,  ty:0.0,  hx:0.5,  ra:0.3,  rz:0.3,  re:0.6, la:0.3, lz:0.3, le:0.6, rl:1.35, rk:2.4, ll:1.25, lk:2.3, lie:0 },
};
const PKEYS = Object.keys(POSES.idle);
function lerpPose(a, b, k) { const o = {}; for (const key of PKEYS) o[key] = a[key] + (b[key] - a[key]) * k; return o; }
const ease = x => x * x * (3 - 2 * x);
function legDrop(a, k) { return L.thigh * Math.cos(a) + L.shin * Math.cos(a - k); }

// ====== ファイター ======
function makeFighter(idx, look) {
  const mesh = buildBody(look.gi, look.trim, look.skin, look.hair);
  scene.add(mesh.root);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color:0x000000, transparent:true, opacity:0.35 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.012; scene.add(shadow);
  return {
    idx, mesh, shadow, name: look.name,
    x:0, z:0, fx:1, fz:0, vx:0, vz:0, y:0, vy:0,
    hp:100, state:'idle', t:0, stun:0, move:null, hit:false, freeze:0,
    ax:1, az:0, sideStepping:0, dodgeShown:false, crouching:false, guarding:false, walkPhase:0, walkMode:0,
    pose:{ ...POSES.idle }, input:newInput(), ai:null, wins:0, lieAmt:0,
    invuln:false, grabBy:null, lastHitCounter:false, thrownT:0, dead:false, ringOut:false
  };
}
const F = [
  makeFighter(0, { name:'AKIRA', gi:0xe9edf5, trim:0x1a4fd1, skin:0xe0b48f, hair:0x1a1a1a }),
  makeFighter(1, { name:'JACKY', gi:0x2a2a30, trim:0xd12a2a, skin:0xc99a74, hair:0xe3c04a }),
];

// ====== 効果音 ======
let actx = null;
function audio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (actx && actx.state === 'suspended') actx.resume(); return actx; }
function noise(dur, freq, gain, type) {
  const a = audio(); if (!a) return;
  const n = a.sampleRate * dur, buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = a.createBufferSource(); s.buffer = buf;
  const f = a.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq;
  const g = a.createGain(); g.gain.value = gain;
  s.connect(f); f.connect(g); g.connect(a.destination); s.start();
}
function tone(freq, dur, gain, endFreq) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.frequency.setValueAtTime(freq, a.currentTime); if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, a.currentTime + dur);
  g.gain.setValueAtTime(gain, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + dur);
}
const SFX = {
  whoosh:() => noise(0.12, 2500, 0.08, 'bandpass'),
  hit:() => { noise(0.14, 1800, 0.35, 'lowpass'); tone(160, 0.12, 0.3, 60); },
  heavy:() => { noise(0.25, 1200, 0.5, 'lowpass'); tone(110, 0.25, 0.45, 40); },
  block:() => { noise(0.08, 700, 0.25, 'lowpass'); tone(260, 0.06, 0.12, 200); },
  grab:() => tone(300, 0.1, 0.2, 500),
  gong:() => tone(520, 0.8, 0.25, 500),
  ko:() => { tone(220, 0.9, 0.35, 55); noise(0.5, 600, 0.3, 'lowpass'); },
};

// ====== 画面のメッセージ ======
const $ = id => document.getElementById(id);
function say(text, cls, ms) {
  const el = $('msg'); el.textContent = text; el.className = 'show ' + (cls || '');
  clearTimeout(say.t); if (ms) say.t = setTimeout(() => { el.className = ''; }, ms);
}
function sub(text, ms) { const el = $('sub'); el.textContent = text; el.className = 'show'; clearTimeout(sub.t); sub.t = setTimeout(() => { el.className = ''; }, ms || 700); }
function updateHud() {
  for (let i = 0; i < 2; i++) {
    const f = F[i];
    $('hp' + i).style.width = Math.max(0, f.hp) + '%';
    $('hpd' + i).style.width = Math.max(0, f.dispHp) + '%';
    for (let w = 0; w < WIN_ROUNDS; w++) $('pip' + i + w).className = 'pip' + (f.wins > w ? ' on' : '');
  }
  $('timer').textContent = Math.max(0, Math.ceil(game.timer / 60));
}
F[0].dispHp = F[1].dispHp = 100;

// ====== 効果エフェクト ======
const sparks = [];
function spark(x, y, z, color, size, shape) {
  const geo = shape === 'ring' ? new THREE.TorusGeometry(1, 0.16, 6, 20) : shape === 'star' ? new THREE.OctahedronGeometry(1.1) : new THREE.SphereGeometry(1, 10, 8);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent:true, opacity:0.95 }));
  m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  m.position.set(x, y, z); m.scale.setScalar(size * 0.3); scene.add(m);
  sparks.push({ m, life:0, max:14, size });
}
function updateSparks() {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]; s.life++;
    const k = s.life / s.max; s.m.scale.setScalar(s.size * (0.3 + k * 1.2)); s.m.material.opacity = 1 - k;
    if (s.life >= s.max) { scene.remove(s.m); s.m.geometry.dispose(); s.m.material.dispose(); sparks.splice(i, 1); }
  }
}

// ====== ゲーム状態 ======
const game = { phase:'title', timer:ROUND_TIME * 60, round:1, pt:0, shake:0, slow:0, flash:0, matchWinner:null, lastCamD:7 };
window.__vf = { game, F, MOVES, keys, bot:null, get fighters() { return F; } };

function resetRound() {
  F[0].x = -1.8; F[0].z = 0; F[1].x = 1.8; F[1].z = 0;
  for (const f of F) {
    f.hp = 100; f.dispHp = 100; f.state = 'idle'; f.t = 0; f.stun = 0; f.move = null; f.hit = false; f.freeze = 0;
    f.vx = f.vz = 0; f.y = 0; f.vy = 0; f.dead = false; f.ringOut = false; f.invuln = false; f.grabBy = null; f.crouching = false; f.guarding = false;
    f.input = newInput(); f.pose = { ...POSES.idle }; f.lieAmt = 0;
    if (f.ai) f.ai.reset();
  }
  game.timer = ROUND_TIME * 60; game.pt = 0; game.phase = 'intro'; game.slow = 0;
  say('ROUND ' + game.round, 'big');
  setTimeout(() => { if (game.phase === 'intro') SFX.gong(); }, 900);
  updateHud();
}
function startMatch() {
  F[0].wins = F[1].wins = 0; game.round = 1; game.matchWinner = null;
  $('title').className = 'hide'; $('result').className = '';
  resetRound();
}

// ====== ヘルパー ======
function faceOpp(f, o) {
  let dx = o.x - f.x, dz = o.z - f.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
  f.fx = dx; f.fz = dz; return d;
}
function isFree(f) { return f.state === 'idle' || f.state === 'walk'; }
function bodyHeightHit(m, d) { return true; }
function press(f, key) { f.input[key + 'Buf'] = 8; }

// ====== 攻撃開始 ======
function startMove(f, o, id) {
  const m = MOVES[id];
  f.state = 'attack'; f.move = m; f.t = 0; f.hit = false; f.dodgeShown = false; f.ax = f.fx; f.az = f.fz;
  f.input.pBuf = f.input.kBuf = f.input.gBuf = 0;
  f.guarding = false;
  SFX.whoosh();
}

// ====== 当たり判定 ======
function relative(a, b) { // aの攻撃方向に対するbの位置（前方 along, 横ずれ lat）
  const dx = b.x - a.x, dz = b.z - a.z;
  return { along: dx * a.ax + dz * a.az, lat: dx * (-a.az) + dz * a.ax };
}
function canBeHit(d) { return !(d.invuln || d.dead || d.ringOut || ['down', 'getup', 'thrown', 'grabbed', 'win', 'lose', 'falling'].includes(d.state)); }
function tryHit(a, d) {
  const m = a.move; const r = relative(a, d);
  if (m.h === 'throw') {
    if (r.along < 0 || r.along > m.range || Math.abs(r.lat) > 0.6) return false;
    if (!canBeHit(d)) return false;
    // つかみ成立
    a.hit = true; a.state = 'throwhold'; a.t = 0; a.grabTarget = d;
    d.state = 'grabbed'; d.t = 0; d.grabBy = a; d.input.pBuf = d.input.gBuf = 0; d.crouching = false;
    a.freeze = d.freeze = 4; SFX.grab(); sub('つかまれた！ すぐ J+L で投げ抜け！', 900); tone(700, 0.15, 0.25, 400); tone(900, 0.15, 0.2, 500);
    return true;
  }
  if (r.along < 0 || r.along > m.range) return false;
  if (Math.abs(r.lat) > 0.36) { if (!a.dodgeShown && d.sideStepping > 0) { a.dodgeShown = true; sub('サイドステップでかわした！', 700); spark(d.x, 1.0, d.z, 0x7dffb0, 0.3); SFX.whoosh(); } return false; }
  if (!canBeHit(d)) return false;
  // しゃがみで上段をかわす
  if (m.h === 'high' && d.crouching && (d.state === 'idle' || d.state === 'walk')) { a.hit = true; sub('かわされた', 500); return true; }
  const wasAttacking = d.state === 'attack';
  // ガード判定
  const canGuard = (d.state === 'idle' || d.state === 'walk' || (d.state === 'blockstun')) && d.input.g;
  let blocked = false;
  if (canGuard) {
    if (m.h === 'low') blocked = d.crouching; else if (m.h === 'mid') blocked = !d.crouching; else blocked = true;
  }
  const midX = (a.x + d.x) / 2, midZ = (a.z + d.z) / 2;
  const hitY = m.h === 'low' ? 0.35 : m.h === 'mid' ? 1.0 : 1.4;
  a.hit = true;
  if (blocked) {
    d.state = 'blockstun'; d.t = 0; d.stun = m.bs; d.move = null;
    d.vx = a.ax * m.kb * 0.9; d.vz = a.az * m.kb * 0.9;
    a.vx = -a.ax * m.kb * 0.35; a.vz = -a.az * m.kb * 0.35;
    a.freeze = d.freeze = 3; game.shake = 2;
    spark(midX, hitY, midZ, 0x9ad0ff, 0.3, 'ring'); SFX.block(); sub('ガード', 400);
  } else {
    let dmg = m.dmg, hs = m.hs, kb = m.kb, counter = false;
    if (wasAttacking && d.t < d.move.su) { counter = true; dmg = Math.round(dmg * 1.3); hs += 6; kb *= 1.4; }
    d.hp -= dmg; d.state = 'hitstun'; d.t = 0; d.stun = hs; d.move = null; d.hit = false;
    d.hitLow = m.h === 'low' || m.pose === 'elbow';
    d.vx = a.ax * kb; d.vz = a.az * kb;
    a.freeze = d.freeze = counter ? 8 : 6; game.shake = counter ? 6 : 4;
    { const col = counter ? 0xffe14d : m.pose === 'kick' ? 0xff9a3d : m.pose === 'lowkick' ? 0x7dffb0 : m.pose === 'elbow' ? 0xff4d4d : 0xffffff; const sz = (counter ? 0.7 : 0.45) * (m.pose === 'kick' ? 1.25 : m.pose === 'elbow' ? 1.4 : m.pose === 'punch' ? 0.85 : 1); spark(midX, hitY, midZ, col, sz, 'star'); spark(midX, hitY, midZ, 0xffffff, sz * 0.5, 'star'); }
    (counter || m.pose === 'elbow' ? SFX.heavy : SFX.hit)();
    if (counter) sub('カウンター！', 700);
    game.flash = counter ? 6 : 3;
    if (d.hp <= 0) koFighter(d, a);
  }
  return true;
}
function koFighter(d, a) {
  d.hp = 0; d.dead = true; d.state = 'thrown'; d.t = 0; d.thrownT = 0; d.vx = a.fx * 0.25; d.vz = a.fz * 0.25;
  endRound(a, 'KO');
}
function endRound(winner, why) {
  if (game.phase !== 'fight') return;
  game.phase = 'roundEnd'; game.pt = 0;
  if (why === 'KO' || why === 'RING OUT') { game.slow = 80; SFX.ko(); }
  if (winner) {
    winner.wins++; winner.roundWinner = true;
    say(why === 'RING OUT' ? 'RING OUT!' : why === 'KO' ? 'K.O.!' : 'TIME UP', 'big ko');
  } else say('DRAW', 'big');
  game.roundWinner = winner;
  updateHud();
}

// ====== ファイター更新 ======
function updateFighter(f, o) {
  if (f.freeze > 0) { f.freeze--; return; }
  const inp = f.input;
  const d = faceOpp(f, o);
  f.crouching = false; f.guarding = false;
  if (f.sideStepping > 0) f.sideStepping--;
  switch (f.state) {
    case 'idle': case 'walk': {
      f.t++;
      if (game.phase !== 'fight') { f.state = 'idle'; break; }
      f.crouching = inp.crouch && !(inp.fwd || inp.back);
      f.guarding = inp.g;
      const throwIn = (inp.pBuf > 0 && inp.g) || (inp.gBuf > 0 && inp.p);
      if (throwIn) { startMove(f, o, 'TH'); break; }
      if (inp.pBuf > 0 && inp.fwd) { startMove(f, o, 'EL'); break; }
      if (inp.kBuf > 0 && inp.crouch) { startMove(f, o, 'LK'); break; }
      if (inp.kBuf > 0) { startMove(f, o, 'K'); break; }
      if (inp.pBuf > 0) { startMove(f, o, 'P'); break; }
      // 移動
      let mx = 0, mz = 0, moved = false;
      if (!f.crouching) {
        const sp = inp.fwd ? 0.050 : inp.back ? 0.036 : 0;
        if (inp.fwd) { mx += f.fx * sp; mz += f.fz * sp; moved = true; }
        if (inp.back) { mx -= f.fx * sp; mz -= f.fz * sp; moved = true; }
        // 横移動（相手を中心に回る）
        let side = 0; if (inp.sideIn) side -= 1; if (inp.sideOut) side += 1;
        if (side) {
          // 画面の奥(-n)方向へ回る：nはカメラ側。1Pから見て右へ向かう単位ベクトルdir、n=(-dz,dx)
          const nx = -f.fz * (f.idx === 0 ? 1 : -1), nz = f.fx * (f.idx === 0 ? 1 : -1);
          mx += nx * side * 0.090; mz += nz * side * 0.090; moved = true; f.sideStepping = 6;
        }
      }
      f.state = moved ? 'walk' : 'idle';
      f.walkMode = inp.fwd ? 1 : inp.back ? -1 : 0;
      if (moved) f.walkPhase += 0.2;
      f.x += mx; f.z += mz;
      if (f.sideStepping > 0 && !inp.fwd && !inp.back) { const nd = Math.hypot(f.x - o.x, f.z - o.z) || 1; f.x = o.x + (f.x - o.x) / nd * d; f.z = o.z + (f.z - o.z) / nd * d; }
      break;
    }
    case 'attack': {
      f.t++;
      const m = f.move;
      if (f.t <= Math.floor(m.su / 2)) { f.ax = f.fx; f.az = f.fz; }
      if (m.lunge && f.t > m.su - 3 && f.t < m.su + 2) { f.vx = f.ax * m.lunge; f.vz = f.az * m.lunge; }
      if (!f.hit && f.t >= m.su && f.t < m.su + m.ac) tryHit(f, o);
      if (f.t >= m.su + m.ac + m.rc) { f.state = 'idle'; f.move = null; f.t = 0; }
      break;
    }
    case 'throwhold': {
      f.t++;
      const v = f.grabTarget;
      // つかみ中は相手を目の前に保つ
      const gx = f.x + f.fx * 0.85, gz = f.z + f.fz * 0.85;
      v.x += (gx - v.x) * 0.5; v.z += (gz - v.z) * 0.5;
      v.y = Math.min(0.35, f.t * 0.02);
      if (f.t >= 20 && v.state === 'grabbed') {
        // 投げ成立
        v.y = 0; v.hp -= MOVES.TH.dmg; v.state = 'thrown'; v.t = 0; v.thrownT = 0; v.grabBy = null;
        v.vx = f.fx * 0.34; v.vz = f.fz * 0.34;
        f.state = 'attack'; f.move = { ...MOVES.TH, su:0, ac:0, rc:22, h:'none' }; f.t = 0; f.hit = true;
        game.shake = 9; game.flash = 6; SFX.heavy(); sub('投げ！', 700);
        if (v.hp <= 0) koFighter(v, f);
      }
      break;
    }
    case 'grabbed': {
      f.t++;
      // 投げ抜け
      const esc = (inp.pBuf > 0 && inp.g) || (inp.gBuf > 0 && inp.p);
      if (esc && f.t <= 18 && f.grabBy) {
        const a = f.grabBy;
        a.state = 'hitstun'; a.t = 0; a.stun = 16; a.move = null; a.vx = -a.fx * 0.2; a.vz = -a.fz * 0.2;
        f.state = 'hitstun'; f.t = 0; f.stun = 16; f.vx = -f.fx * 0.2; f.vz = -f.fz * 0.2; f.grabBy = null;
        a.freeze = f.freeze = 3; sub('投げ抜け！', 800); SFX.block();
      }
      break;
    }
    case 'hitstun': case 'blockstun': {
      f.t++;
      f.crouching = f.state === 'blockstun' && inp.crouch;
      if (f.state === 'blockstun' && !inp.g && f.t > 2 && false) { }
      if (f.t >= f.stun) { f.state = 'idle'; f.t = 0; }
      break;
    }
    case 'thrown': {
      f.t++; f.thrownT++;
      f.y = Math.max(0, Math.sin(Math.min(1, f.thrownT / 24) * Math.PI) * 0.7);
      if (f.thrownT >= 24) {
        f.y = 0;
        if (f.dead) { f.state = 'down'; f.t = 0; break; }
        f.state = 'down'; f.t = 0; game.shake = Math.max(game.shake, 5);
      }
      break;
    }
    case 'down': {
      f.t++;
      if (f.dead) break;
      if (f.t >= 46) { f.state = 'getup'; f.t = 0; f.invuln = true; }
      break;
    }
    case 'getup': {
      f.t++;
      if (f.t >= 18) { f.state = 'idle'; f.t = 0; f.invuln = false; }
      break;
    }
    case 'falling': {
      f.vy -= 0.012; f.y += f.vy; f.t++;
      break;
    }
    case 'win': case 'lose': f.t++; break;
  }
  // バッファの減衰
  if (inp.pBuf > 0) inp.pBuf--; if (inp.kBuf > 0) inp.kBuf--; if (inp.gBuf > 0) inp.gBuf--;
  // 速度（ノックバック）
  const knockStates = ['hitstun', 'blockstun', 'thrown', 'attack', 'down'];
  if (f.vx || f.vz) {
    f.x += f.vx; f.z += f.vz; f.vx *= 0.85; f.vz *= 0.85;
    if (Math.hypot(f.vx, f.vz) < 0.002) f.vx = f.vz = 0;
  }
  // 場外判定
  const rr = Math.hypot(f.x, f.z);
  if (rr > RING_R - 0.05) {
    const pushed = ['hitstun', 'blockstun', 'thrown', 'down'].includes(f.state) && game.phase === 'fight';
    if (pushed && rr > RING_R + 0.15 && !f.dead && (f.state === 'thrown' || Math.hypot(f.vx, f.vz) > 0.06)) {
      f.state = 'falling'; f.vy = 0.02; f.ringOut = true; f.t = 0; f.vx *= 1.0; f.vz *= 1.0;
      endRound(o, 'RING OUT');
      if (!f.dead) { f.hp = Math.max(f.hp, 1); }
    } else if (f.state !== 'falling') {
      f.x *= (RING_R - 0.05) / rr; f.z *= (RING_R - 0.05) / rr;
    }
  }
}

function separate() {
  const a = F[0], b = F[1];
  if (a.state === 'grabbed' || b.state === 'grabbed' || a.state === 'throwhold' || b.state === 'throwhold') return;
  if (a.state === 'falling' || b.state === 'falling') return;
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 0.001;
  if (d < MIN_SEP) {
    const push = (MIN_SEP - d) / 2, nx = dx / d, nz = dz / d;
    a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
  }
}

// ====== CPU ======
function makeAI(f, o, level) {
  const ai = {
    fr: 0, defT: 0, atk: [], hist: [], thr: [], rAt: 99, cd: 20, hold: 0, holdKeys: {}, react: null, lastOppState: '', plan: null, planT: 0, think: 0,
    reset() { this.defT = 0; this.atk = []; this.hist = []; this.thr = []; this.rAt = 99; this.cd = 40; this.hold = 0; this.holdKeys = {}; this.react = null; this.plan = null; this.think = 0; },
    set(k, frames) { this.holdKeys[k] = frames; },
    update() {
      const inp = f.input;
      // 長押しの管理
      for (const k of ['fwd', 'back', 'crouch', 'sideIn', 'sideOut', 'g']) {
        if (this.holdKeys[k] > 0) { this.holdKeys[k]--; inp[k] = true; } else inp[k] = false;
      }
      inp.p = inp.k = false;
      if (game.phase !== 'fight') return;
      const d = Math.hypot(o.x - f.x, o.z - f.z);
      // 投げ抜け
      if (f.state === 'grabbed' && f.t < 12 && Math.random() < 0.10 * level) { inp.pBuf = inp.gBuf = 5; inp.p = inp.g = true; return; }
      // 相手の攻撃に反応（攻撃を頻繁に出す相手ほど、ガードで受ける確率が上がる）
      this.fr++;
      if (o.state === 'attack' && o.move && o.t === 1) {
        this.atk.push(this.fr); if (o.move.h === 'throw') this.thr.push(this.fr); else { this.hist.push(o.move.h); if (this.hist.length > 6) this.hist.shift(); }
        this.rAt = 9 + (Math.random() * 7 | 0); // 人間並みの反応の遅れ（9〜15フレーム）
      }
      const aggr = this.atk.filter(x => this.fr - x < 150).length;
      const thrN = this.thr.filter(x => this.fr - x < 200).length;
      const lowRate = this.hist.length ? this.hist.filter(h => h === 'low').length / this.hist.length : 0;
      const gp = Math.min(0.85, 0.50 + 0.1 * aggr);
      if (o.state === 'attack' && o.move && o.t === this.rAt && o.t <= o.move.su + o.move.ac && d < 2.4 && o.move.h !== 'throw') {
        const r = Math.random();
        if (r < gp * level) { this.react = { h:o.move.h }; }
        else if (r < Math.min(0.97, gp + 0.25) * level) this.set(Math.random() < 0.5 ? 'sideIn' : 'sideOut', 14);
        if (this.react) {
          if (o.move.h === 'low') this.set('crouch', 24);
          this.set('g', 24); this.react = null; this.cd = 14;
        }
      }
      if (!isFree(f)) return;
      const oFree = isFree(o);
      o.guardT = (oFree && o.input.g) ? (o.guardT || 0) + 1 : 0;
      const oRecover = o.state === 'attack' && o.move && o.t > o.move.su + o.move.ac;
      const oStun0 = o.state === 'blockstun' || o.state === 'hitstun';
      // 隙を突く（待ち時間を無視して即反撃）
      if (oRecover && Math.random() < 0.6 * level) {
        if (d < 1.5) { this.useMove('P'); this.cd = 14; return; }
        if (d < 1.85) { this.useMove('K'); this.cd = 16; return; }
        if (d < 2.6) { this.set('fwd', 7); this.cd = 4; return; }
      }
      if (thrN >= 2 && d < 1.45 && Math.random() < 0.05 * level) { this.useMove('P'); this.cd = 16; return; }
      if (oStun0 && d < 1.7 && Math.random() < 0.5 * level) { this.useMove(Math.random() < 0.6 ? 'P' : 'K'); this.cd = 10; return; }
      // 構えている間は技を出さない
      if (this.defT > 0) { this.defT--; this.set('g', 2); return; }
      // ガード固め対策：立ちガードには下段か投げ、しゃがみガードには中段
      if (o.guardT > 10 && d >= 1.25 && d < 2.6 && Math.random() < 0.5 * level) { this.set('fwd', 5); this.cd = 3; return; }
      if (o.guardT > 10 && d < 1.3 && Math.random() < 0.6 * level) { this.useMove(o.crouching ? (Math.random() < 0.5 ? 'K' : 'EL') : (Math.random() < 0.5 ? 'TH' : 'LK')); this.cd = 14; return; }
      // 縁に近いときは、中央側へ横移動で回り込む
      const rr0 = Math.hypot(f.x, f.z);
      if (rr0 > RING_R - 1.3 && Math.random() < 0.35) {
        const sg = f.idx === 0 ? 1 : -1, nx = -f.fz * sg, nz = f.fx * sg;
        const rIn = Math.hypot(f.x - nx * 0.5, f.z - nz * 0.5), rOut = Math.hypot(f.x + nx * 0.5, f.z + nz * 0.5);
        this.set(rIn < rOut ? 'sideIn' : 'sideOut', 12); this.cd = Math.min(this.cd, 4); if (d > 1.4) { this.set('fwd', 6); }
      }
      if (this.cd > 0) { this.cd--; return; }
      // 相手が攻撃を出し続けているときは、まとまった時間構えて受け、技の出終わりを突く（遅い技は潰されるので控える）
      if (aggr >= 1 && d < 2.3 && Math.random() < (aggr >= 2 ? 0.8 : 0.5)) {
        this.defT = 18; this.set('g', 20); if (Math.random() < lowRate) this.set('crouch', 20);
        return;
      }
      // 行動の決定
      const guardingOpp = o.input.g && oFree;
      const oppStunned = oStun0;
      if (d > 2.7) {
        const r = Math.random();
        if (r < 0.70) this.set('fwd', 14 + (Math.random() * 12 | 0));
        else if (r < 0.85) this.set(Math.random() < 0.5 ? 'sideIn' : 'sideOut', 16);
        else this.cd = 12;
        this.cd = Math.max(this.cd, 6); return;
      }
      if (d > 1.7) {
        const r = Math.random();
        if (r < 0.28) this.set('fwd', 8);
        else if (r < 0.46) { this.useMove('K'); }
        else if (r < 0.60) { this.useMove('EL'); }
        else if (r < 0.74) this.set('back', 10);
        else if (r < 0.84) this.set('g', 18);
        else this.set(Math.random() < 0.5 ? 'sideIn' : 'sideOut', 12);
        this.cd = 10 + (Math.random() * 14 | 0) + (level < 1 ? 8 : 0); return;
      }
      // 近距離
      const r = Math.random();
      const wThrow = guardingOpp ? 0.55 : 0.12;
      if (oppStunned && r < 0.7) this.useMove(Math.random() < 0.5 ? 'P' : 'K');
      else if (r < wThrow) this.useMove('TH');
      else if (r < wThrow + 0.26) this.useMove('P');
      else if (r < wThrow + 0.42) this.useMove('K');
      else if (r < wThrow + 0.54) this.useMove('LK');
      else if (r < wThrow + 0.62) this.useMove('EL');
      else if (r < wThrow + 0.78) { this.set('g', 18); if (Math.random() < 0.3) this.set('crouch', 18); }
      else this.set('back', 12);
      this.cd = 12 + (Math.random() * 18 | 0) + (level < 1 ? 10 : 0);
    },
    useMove(id) {
      const inp = f.input;
      if (id === 'P') { press(f, 'p'); }
      else if (id === 'K') { press(f, 'k'); }
      else if (id === 'LK') { this.set('crouch', 6); inp.crouch = true; press(f, 'k'); }
      else if (id === 'EL') { this.set('fwd', 6); inp.fwd = true; press(f, 'p'); }
      else if (id === 'TH') { press(f, 'p'); inp.g = true; this.set('g', 3); press(f, 'g'); }
    }
  };
  return ai;
}
F[1].ai = makeAI(F[1], F[0], 1.0);
if (AUTO) F[0].ai = makeAI(F[0], F[1], 1.0);

// ====== ポーズ適用 ======
function targetPose(f) {
  const t = f.t; let base;
  switch (f.state) {
    case 'idle': case 'walk': {
      const g = f.guarding;
      if (f.crouching) base = g ? POSES.cguard : POSES.crouch;
      else base = g ? POSES.guard : POSES.idle;
      base = { ...base };
      if (f.state === 'walk') {
        const s = Math.sin(f.walkPhase), c = Math.cos(f.walkPhase), dir = f.walkMode;
        base.rl += s * 0.55 * (dir || 1); base.ll -= s * 0.55 * (dir || 1);
        base.rk += Math.max(0, c) * 0.5; base.lk += Math.max(0, -c) * 0.5;
      } else { const b = Math.sin(performance.now() / 280 + f.idx) * 0.04; base.tx += b; base.re += b; base.le -= b; }
      return base;
    }
    case 'attack': {
      const m = f.move; if (!POSES[m.pose]) return POSES.idle;
      if (m.h === 'none') return lerpPose(POSES.throw, POSES.idle, Math.min(1, f.t / 20));
      const total = m.su + m.ac + m.rc;
      let k;
      if (f.t < m.su) k = ease(f.t / m.su); else if (f.t < m.su + m.ac) k = 1; else k = 1 - ease((f.t - m.su - m.ac) / m.rc);
      return lerpPose(POSES.idle, POSES[m.pose], k);
    }
    case 'throwhold': return POSES.throw;
    case 'grabbed': return POSES.grabbed;
    case 'hitstun': return f.hitLow ? POSES.hitlow : POSES.hit;
    case 'blockstun': return f.crouching ? POSES.cguard : POSES.guard;
    case 'thrown': return POSES.fly;
    case 'down': return POSES.down;
    case 'getup': return lerpPose(POSES.down, POSES.getup, Math.min(1, f.t / 14));
    case 'falling': return POSES.fly;
    case 'win': return POSES.win;
    case 'lose': return POSES.lose;
  }
  return POSES.idle;
}
function applyPose(f) {
  const tgt = targetPose(f);
  const k = (f.state === 'attack' || f.state === 'thrown') ? 0.6 : 0.38;
  for (const key of PKEYS) f.pose[key] += (tgt[key] - f.pose[key]) * k;
  const p = f.pose, m = f.mesh;
  m.torso.rotation.x = -p.tx; m.torso.rotation.y = -p.ty; m.head.rotation.x = -p.hx;
  m.rArm.sh.rotation.x = -p.ra; m.rArm.sh.rotation.z = -p.rz; m.rArm.el.rotation.x = -p.re;
  m.lArm.sh.rotation.x = -p.la; m.lArm.sh.rotation.z = p.lz; m.lArm.el.rotation.x = -p.le;
  m.rLeg.hp.rotation.x = -p.rl; m.rLeg.kn.rotation.x = p.rk;
  m.lLeg.hp.rotation.x = -p.ll; m.lLeg.kn.rotation.x = p.lk;
  const drop = Math.max(legDrop(p.rl, p.rk), legDrop(p.ll, p.lk)) + 0.04;
  const lieDrop = 0.17;
  m.hips.position.y = drop * (1 - p.lie) + lieDrop * p.lie + 0.04;
  m.body.rotation.x = -p.lie * Math.PI / 2;
  m.body.position.set(0, 0, 0);
  m.root.position.set(f.x, f.y, f.z);
  m.root.rotation.y = Math.atan2(f.fx, f.fz);
  f.shadow.position.set(f.x, 0.015, f.z);
  const sh = Math.max(0.2, 1 - f.y * 0.8); f.shadow.scale.setScalar(sh);
  if (f.state === 'falling') { m.root.rotation.x = Math.min(1.2, f.t * 0.05); f.shadow.visible = false; } else { m.root.rotation.x = 0; f.shadow.visible = true; }
}

// ====== カメラ ======
function updateCamera() {
  const a = F[0], b = F[1];
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  let dx = b.x - a.x, dz = b.z - a.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
  const nx = -dz, nz = dx;
  let target = Math.min(9, Math.max(5.2, 4.3 + d * 1.0));
  { const tanH = Math.tan(camera.fov * Math.PI / 360) * camera.aspect; target = Math.max(target, (d + 2.4) / (2 * tanH)); }
  game.lastCamD += (target - game.lastCamD) * 0.08;
  const shake = game.shake > 0 ? (Math.random() - 0.5) * 0.02 * game.shake : 0;
  const cx = mx + nx * game.lastCamD + shake, cz = mz + nz * game.lastCamD + shake, cy = 1.7 + game.lastCamD * 0.1;
  camera.position.x += (cx - camera.position.x) * 0.2;
  camera.position.y += (cy - camera.position.y) * 0.2;
  camera.position.z += (cz - camera.position.z) * 0.2;
  const fall = Math.min(0, F[0].y, F[1].y); camera.lookAt(mx, 1.0 + fall * 0.6, mz);
}

// ====== メインループ ======
function logicStep() {
  const [a, b] = F;
  // 入力の読み取り
  const K1 = KEYMAP.p1;
  if (!a.ai && window.__vf.bot) window.__vf.bot(a, b);
  else if (!a.ai) {
    const i = a.input;
    i.fwd = !!(keys[K1.right] || keys.ArrowRight); i.back = !!(keys[K1.left] || keys.ArrowLeft);
    i.crouch = !!(keys[K1.crouch] || keys.ArrowDown);
    i.sideIn = !!(keys[K1.in] || keys.ArrowUp); i.sideOut = !!keys[K1.out];
    i.p = !!keys[K1.p]; i.k = !!keys[K1.k]; i.g = !!keys[K1.g];
  } else a.ai.update();
  if (b.ai) b.ai.update();

  if (game.phase === 'intro') {
    game.pt++;
    if (game.pt === 60) { say('FIGHT!', 'big go', 700); }
    if (game.pt >= 90) { game.phase = 'fight'; game.pt = 0; }
  } else if (game.phase === 'fight') {
    game.timer--;
    if (game.timer <= 0) {
      game.timer = 0;
      const w = a.hp > b.hp ? a : b.hp > a.hp ? b : null;
      endRound(w, 'TIME');
      if (w) { /* 勝敗の姿勢は下で設定 */ }
    }
  } else if (game.phase === 'roundEnd') {
    game.pt++;
    const w = game.roundWinner;
    if (game.pt === 40) {
      for (const f of F) {
        if (f.state === 'idle' || f.state === 'walk' || f.state === 'attack' || f.state === 'hitstun' || f.state === 'blockstun') {
          f.state = (w && f !== w) ? 'lose' : (w ? 'win' : 'idle'); f.t = 0; f.move = null;
        } else if ((f.state === 'down' || f.state === 'getup') && !f.dead && w && f === w) { f.state = 'win'; f.t = 0; }
        else if (f.state === 'down' && !f.dead && w && f !== w) { /* 倒れたまま */ }
      }
    }
    if (game.pt >= 170) {
      if (a.wins >= WIN_ROUNDS || b.wins >= WIN_ROUNDS) {
        game.phase = 'matchEnd'; game.matchWinner = a.wins >= WIN_ROUNDS ? a : b;
        say(game.matchWinner.name + ' WINS', 'big go');
        $('result').textContent = TOUCH ? '画面をタップでもう一度' : 'Enter キーでもう一度'; $('result').className = 'show';
        if (AUTO) setTimeout(() => { if (game.phase === 'matchEnd') startMatch(); }, 1200);
      } else { game.round++; resetRound(); }
    }
  }

  if (game.phase === 'fight' || game.phase === 'roundEnd' || game.phase === 'intro') {
    updateFighter(a, b); updateFighter(b, a); separate();
  }
  if (game.shake > 0) game.shake--;
  if (game.flash > 0) game.flash--;
  // ゲージのなめらかな減少
  for (const f of F) { if (f.dispHp > f.hp) f.dispHp = Math.max(f.hp, f.dispHp - 0.6); else f.dispHp = f.hp; }
}

let acc = 0, last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000); last = now;
  const rate = game.slow > 0 ? 0.35 : 1;
  acc += dt * 60 * rate * SPEED;
  let guard = 0;
  while (acc >= 1 && guard++ < 12 * SPEED) {
    if (game.phase !== 'title') logicStep();
    acc -= 1;
  }
  if (game.slow > 0) game.slow--;
  if (NORENDER) { for (const f of F) { if (f.dispHp > f.hp) f.dispHp = f.hp; } return; }
  for (const f of F) applyPose(f);
  updateSparks(); updateCamera(); updateHud();
  $('flash').style.opacity = game.flash > 0 ? 0.25 : 0;
  renderer.render(scene, camera);
}

// ====== 入力イベント ======
function keyDown(code) {
  audio();
  keys[code] = true;
  const a = F[0];
  if (code === 'KeyJ') press(a, 'p');
  if (code === 'KeyK') press(a, 'k');
  if (code === 'KeyL') press(a, 'g');
  if (code === 'Enter') {
    if (game.phase === 'title' || game.phase === 'matchEnd') startMatch();
  }
  if (code === 'Escape') { game.phase = 'title'; $('title').className = ''; $('msg').className = ''; $('result').className = ''; }
}
function keyUp(code) { keys[code] = false; }
addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keyDown(e.code);
});
addEventListener('keyup', e => keyUp(e.code));
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// ====== タッチ操作（スマホ・タブレット用） ======
document.querySelectorAll('#pad [data-k]').forEach(btn => {
  const codes = btn.dataset.k.split('+');
  const on = e => { e.preventDefault(); try { btn.setPointerCapture(e.pointerId); } catch (_) {} btn.classList.add('on'); codes.forEach(keyDown); };
  const off = e => { e.preventDefault(); btn.classList.remove('on'); codes.forEach(keyUp); };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointercancel', off);
  btn.addEventListener('lostpointercapture', off);
  btn.addEventListener('contextmenu', e => e.preventDefault());
});
// 画面タップで開始・再戦
addEventListener('pointerdown', e => {
  if ((game.phase === 'title' || game.phase === 'matchEnd') && !(e.target.closest && e.target.closest('#pad'))) { audio(); startMatch(); }
});
if (TOUCH) {
  document.querySelector('#title .go').textContent = '画面をタップでスタート';
  const hint = document.getElementById('rot'); if (hint) hint.style.display = 'block';
}
addEventListener('touchmove', e => e.preventDefault(), { passive: false });

// 初期配置
F[0].x = -1.8; F[1].x = 1.8; F[0].fx = 1; F[1].fx = -1;
camera.position.set(0, 2.2, 9);
if (Q.get('start') === '1' || AUTO) startMatch();
requestAnimationFrame(frame);
})();
