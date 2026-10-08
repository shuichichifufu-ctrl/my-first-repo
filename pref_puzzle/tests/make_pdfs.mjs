// 使い方: node tests/make_pdfs.mjs <html> <出力フォルダ>
// ヘッドレスChromiumで A4・余白0・倍率100% のPDFを書き出し、各ケースの分割情報(JSON)も保存する
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
const [, , html, outDir] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const cases = [
  { name: 'aichi_500k', prefId: 23, denom: 500000, orient: 'portrait', islands: false },
  { name: 'aichi_500k_land', prefId: 23, denom: 500000, orient: 'landscape', islands: false },
  { name: 'hokkaido_1000k', prefId: 1, denom: 1000000, orient: 'portrait', islands: false },
  { name: 'tokyo_500k', prefId: 13, denom: 500000, orient: 'portrait', islands: false },
  { name: 'okinawa_500k', prefId: 47, denom: 500000, orient: 'portrait', islands: false },
  { name: 'kagawa_500k', prefId: 37, denom: 500000, orient: 'portrait', islands: false },
  { name: 'kagawa_250k', prefId: 37, denom: 250000, orient: 'portrait', islands: false },
  { name: 'nagano_250k_land', prefId: 20, denom: 250000, orient: 'landscape', islands: false },
];
const b = await chromium.launch();
const pg = await b.newPage();
await pg.goto('file://' + path.resolve(html));
await pg.waitForSelector('body[data-ready="1"]');
for (const c of cases) {
  await pg.evaluate((c) => { Object.assign(window.__state, { sample: false, prefId: c.prefId, denom: c.denom, orient: c.orient, islands: c.islands, skipBlank: c.skipBlank !== false }); window.__render(); }, c);
  const meta = await pg.evaluate(() => {
    const m = window.__model;
    return { cols: m.lay.cols, rows: m.lay.rows, W: m.lay.W, H: m.lay.H, G: m.lay.G, printCount: m.printCount, blankCount: m.blankCount,
      pages: m.lay.pages.map((p) => ({ n: p.n, r: p.r, c: p.c, x0: p.x0, y0: p.y0, blank: p.blank, printed: m.printed[p.n - 1] })),
      MW: m.P.MW, MH: m.P.MH, name: m.pref.n, denom: m.denom, orient: m.orient };
  });
  const t0 = Date.now();
  await pg.pdf({ path: `${outDir}/${c.name}.pdf`, preferCSSPageSize: true, printBackground: true });
  fs.writeFileSync(`${outDir}/${c.name}.json`, JSON.stringify(meta));
  console.log(c.name, `${meta.rows}x${meta.cols}`, 'print', meta.printCount, 'blank', meta.blankCount, `pdf ${Date.now() - t0}ms`);
}
await b.close();
