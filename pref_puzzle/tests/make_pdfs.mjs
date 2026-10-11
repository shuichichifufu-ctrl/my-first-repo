// 使い方: node tests/make_pdfs.mjs <html> <出力フォルダ>
// ヘッドレスChromiumで A4・余白0・倍率100% のPDFを書き出し、各ケースの分割情報(JSON)も保存する
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [, , html, outDir] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const cases = [
  { name: 'ai_300k_a4', mode: 'aichi', denom: 300000, paper: 'A4', orient: 'portrait', smooth: 'normal' },
  { name: 'ai_200k_a3_land', mode: 'aichi', denom: 200000, paper: 'A3', orient: 'landscape', smooth: 'strong' },
  { name: 'ai_500k_a4_land', mode: 'aichi', denom: 500000, paper: 'A4', orient: 'landscape', smooth: 'weak' },
  { name: 'ai_100k_a3_port', mode: 'aichi', denom: 100000, paper: 'A3', orient: 'portrait', smooth: 'normal' },
  { name: 'jp_300k_a4', mode: 'japan', denom: 3000000, paper: 'A4', orient: 'portrait', smooth: 'normal' },
  { name: 'jp_300k_a4_strong', mode: 'japan', denom: 3000000, paper: 'A4', orient: 'portrait', smooth: 'strong' },
  { name: 'jp_200k_a3_land', mode: 'japan', denom: 2000000, paper: 'A3', orient: 'landscape', smooth: 'normal' },
  { name: 'jp_500k_a4_land', mode: 'japan', denom: 5000000, paper: 'A4', orient: 'landscape', smooth: 'weak' },
  { name: 'jp_100k_a3_port', mode: 'japan', denom: 1000000, paper: 'A3', orient: 'portrait', smooth: 'normal' },
  { name: 'a3_aichi_50k', prefId: 23, denom: 50000, paper: 'A3', orient: 'portrait', islands: false },
  { name: 'a3_kagawa_100k_land', prefId: 37, denom: 100000, paper: 'A3', orient: 'landscape', islands: false },
  { name: 'a3_nagano_250k', prefId: 20, denom: 250000, paper: 'A3', orient: 'portrait', islands: false },
  { name: 'a3_hokkaido_1000k_land', prefId: 1, denom: 1000000, paper: 'A3', orient: 'landscape', islands: false },
  { name: 'a3_tokyo_200k', prefId: 13, denom: 200000, paper: 'A3', orient: 'portrait', islands: false },
  { name: 'a3_aichi_300k_land', prefId: 23, denom: 300000, paper: 'A3', orient: 'landscape', islands: false },
  { name: 'a4_aichi_100k', prefId: 23, denom: 100000, paper: 'A4', orient: 'portrait', islands: false },
  { name: 'a4_kagawa_150k_land', prefId: 37, denom: 150000, paper: 'A4', orient: 'landscape', islands: false },
  { name: 'aichi_500k', prefId: 23, denom: 500000, orient: 'portrait', islands: false },
  { name: 'aichi_500k_land', prefId: 23, denom: 500000, orient: 'landscape', islands: false },
  { name: 'hokkaido_1000k', prefId: 1, denom: 1000000, orient: 'portrait', islands: false },
  { name: 'tokyo_500k', prefId: 13, denom: 500000, orient: 'portrait', islands: false },
  { name: 'okinawa_500k', prefId: 47, denom: 500000, orient: 'portrait', islands: false },
  { name: 'kagawa_500k', prefId: 37, denom: 500000, orient: 'portrait', islands: false },
  { name: 'kagawa_250k', prefId: 37, denom: 250000, orient: 'portrait', islands: false },
  { name: 'hokkaido_250k', prefId: 1, denom: 250000, orient: 'portrait', islands: false },
  { name: 'iwate_250k', prefId: 3, denom: 250000, orient: 'portrait', islands: false },
  { name: 'nagano_250k_land', prefId: 20, denom: 250000, orient: 'landscape', islands: false },
];
const b = await chromium.launch();
const pg = await b.newPage();
await pg.goto('file://' + path.resolve(html));
await pg.waitForSelector('body[data-ready="1"]');
for (const c of cases) {
  await pg.evaluate((c) => { Object.assign(window.__state, { mode: c.mode || 'pref', smooth: c.smooth || 'normal', sample: false, paper: c.paper || 'A4', prefId: c.prefId, denom: c.denom, orient: c.orient, islands: c.islands, skipBlank: c.skipBlank !== false }); window.__render(); }, c);
  const meta = await pg.evaluate(() => {
    const m = window.__model;
    if (m.pieces) return { mode: m.mode, colors: m.ds.regionColors, title: m.ds.title, paper: m.paper, orient: m.orient, denom: m.denom, W: m.W, H: m.H, level: m.level, pages: m.pages, unfit: m.unfit, pieces: m.pieces.map((q) => ({ id: q.id, name: q.name, w: q.w, h: q.h, f: q.f })), crossLeft: m.repairLeft, gw: m.gx1 - m.gx0, gh: m.gy1 - m.gy0 };
    return { cols: m.lay.cols, rows: m.lay.rows, W: m.lay.W, H: m.lay.H, G: m.lay.G, printCount: m.printCount, blankCount: m.blankCount,
      pages: m.lay.pages.map((p) => ({ n: p.n, r: p.r, c: p.c, x0: p.x0, y0: p.y0, blank: p.skip, printed: m.printed[p.n - 1] })),
      MW: m.P.MW, MH: m.P.MH, paper: m.paper, name: m.pref.n, denom: m.denom, orient: m.orient };
  });
  const t0 = Date.now();
  await pg.pdf({ path: `${outDir}/${c.name}.pdf`, preferCSSPageSize: true, printBackground: true });
  fs.writeFileSync(`${outDir}/${c.name}.json`, JSON.stringify(meta));
  console.log(c.name, meta.pieces ? `pieces ${meta.pieces.length} pages ${meta.pages.length} unfit ${meta.unfit.length}` : `${meta.rows}x${meta.cols} print ${meta.printCount} blank ${meta.blankCount}`, `pdf ${Date.now() - t0}ms`);
}
await b.close();
