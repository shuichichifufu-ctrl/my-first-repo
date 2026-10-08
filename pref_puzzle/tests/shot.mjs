// 使い方: NODE_PATH=/opt/node-tools/node_modules node tests/shot.mjs <html> <outdir>
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
import path from 'node:path';
const [, , html, outDir] = process.argv;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
pg.on('pageerror', (e) => errs.push(String(e)));
await pg.goto('file://' + path.resolve(html));
await pg.waitForSelector('body[data-ready="1"]');
await pg.screenshot({ path: outDir + '/screen_aichi.png', fullPage: false });
// ページ1枚を実寸に近い解像度で撮る
const el = await pg.$('.sheet');
await pg.addStyleTag({ content: '.sheet{zoom:1.2 !important}' });
await el.screenshot({ path: outDir + '/page1_aichi.png' });
console.log('errors:', errs);
await b.close();
