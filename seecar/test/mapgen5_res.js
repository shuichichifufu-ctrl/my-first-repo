// 第5期 3d：「絵を よみこむ」の細かさ。v9（長い辺64画素）と v10（面積 64x64 画素まで・長い辺96まで）を比べる。
// 1) 変換そのものの時間（3000x2000 の写真のような絵） 2) 地図のマス数・ブロック数 3) World の1コマの描画時間（GPU まで待つ）
// node mapgen5_res.js
const { openPage, stopStatic } = require('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/harness.js');
(async () => {
  const { browser, page, errors } = await openPage('C:/Users/s9h0u/.claude/my-first-repo/seecar/test/world4_test.html', { viewport: { width: 1280, height: 720 } });
  await new Promise(r => setTimeout(r, 1200));
  // 描画1回の時間を測る（readPixels で GPU の終わりまで待つ）
  await page.evaluate(() => {
    // r128 の render は各インスタンスの関数なので、requestAnimationFrame の1回分（更新＋描画）を測る
    const raf = window.requestAnimationFrame.bind(window); window.rt = [];
    window.requestAnimationFrame = function (cb) { return raf(function (ts) { const t = performance.now(); cb(ts); if (window.rtOn) { const cv = document.querySelector('#wrap canvas'); const gl = cv && (cv.getContext('webgl2') || cv.getContext('webgl')); if (gl) { const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } window.rt.push(performance.now() - t); } }); };
    // 写真のような絵（グラデーション・色の丸や四角・細い線・ざらざら）
    window.photo = function (W, H) {
      const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
      let a = 12345; const rnd = () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; };
      const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#9bc4e8'); gr.addColorStop(0.5, '#e8d9b0'); gr.addColorStop(1, '#5a7d3a'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 160; i++) { g.fillStyle = `hsl(${rnd() * 360},${40 + rnd() * 50}%,${15 + rnd() * 70}%)`; g.beginPath(); if (rnd() < 0.5) g.arc(rnd() * W, rnd() * H, 20 + rnd() * W / 10, 0, 7); else g.rect(rnd() * W, rnd() * H, 30 + rnd() * W / 8, 30 + rnd() * H / 8); g.fill(); }
      g.strokeStyle = '#111'; for (let i = 0; i < 40; i++) { g.lineWidth = 2 + rnd() * 10; g.beginPath(); g.moveTo(rnd() * W, rnd() * H); g.lineTo(rnd() * W, rnd() * H); g.stroke(); }
      const d = g.getImageData(0, 0, W, H); for (let i = 0; i < d.data.length; i += 4) { const n = (rnd() - 0.5) * 40; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; } g.putImageData(d, 0, 0);
      return c;
    };
  });
  const out = [];
  for (const [W, H] of [[3000, 2000], [4032, 3024], [1920, 1080], [2000, 2000]]) {
    for (const lim of ['v9', 'v10']) for (const binary of [false, true]) {
      const r = await page.evaluate(async ([W, H, lim, binary]) => {
        const c = photo(W, H);
        MapGen._limits = lim === 'v9' ? { area: 1e9, side: 64 } : undefined;
        const ts = [];
        let m;
        for (let k = 0; k < 3; k++) { const t = performance.now(); m = MapGen.fromCanvas(c, 'x', 'x', { binary, treasureCount: 10 }); ts.push(performance.now() - t); }
        MapGen._limits = undefined;
        let blocks = 0; for (let i = 0; i < m.w * m.h; i++) if (m.heights[i] > 1) blocks++;
        const t0 = performance.now(); loadMap(m, { mode: 'solo', search: 'light' }); const loadMs = performance.now() - t0;
        const cams = {};
        for (const cam of [1, 3]) {
          try { World.setCamera(cam); } catch (e) {}
          await new Promise(r => setTimeout(r, 600));
          window.rt = []; window.rtOn = true; await new Promise(r => setTimeout(r, 2000)); window.rtOn = false;
          const a = window.rt.slice().sort((x, y) => x - y);
          cams[cam] = { n: a.length, med: +a[Math.floor(a.length / 2)].toFixed(2), p90: +a[Math.floor(a.length * 0.9)].toFixed(2) };
        }
        return { size: m.w + 'x' + m.h, cells: m.w * m.h, blocks, convMs: Math.min(...ts).toFixed(0), loadMs: loadMs.toFixed(0), cams };
      }, [W, H, lim, binary]);
      out.push({ img: W + 'x' + H, lim, binary, ...r });
      console.log(JSON.stringify(out[out.length - 1]));
    }
  }
  // 見本（基準）：いちばん壁の多い見本と、ことわざの見本
  for (const id of ['onko', 'sukikoso', 'apple']) {
    const r = await page.evaluate(async (id) => {
      const m = MapGen.fromPreset(id, { treasureCount: 10 }); let blocks = 0; for (let i = 0; i < m.w * m.h; i++) if (m.heights[i] > 1) blocks++;
      const t0 = performance.now(); loadMap(m, { mode: 'solo', search: 'light' }); const loadMs = performance.now() - t0; const cams = {};
      for (const cam of [1, 3]) { try { World.setCamera(cam); } catch (e) {} await new Promise(r => setTimeout(r, 600)); window.rt = []; window.rtOn = true; await new Promise(r => setTimeout(r, 2000)); window.rtOn = false; const a = window.rt.slice().sort((x, y) => x - y); cams[cam] = { n: a.length, med: +a[Math.floor(a.length / 2)].toFixed(2), p90: +a[Math.floor(a.length * 0.9)].toFixed(2) }; }
      return { size: m.w + 'x' + m.h, cells: m.w * m.h, blocks, loadMs: loadMs.toFixed(0), cams };
    }, id);
    console.log(JSON.stringify({ preset: id, ...r }));
  }
  console.log('errors', JSON.stringify(errors.filter(e => !/404/.test(e))));
  await browser.close(); stopStatic(); process.exit(0);
})();
