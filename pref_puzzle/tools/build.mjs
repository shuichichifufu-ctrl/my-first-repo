// 使い方: node tools/build.mjs <出力HTML>
// テンプレートにD3・地図データ・計算部分・画面部分を埋め込んで、単一HTMLを作る
import fs from 'node:fs';
const out = process.argv[2];
const rd = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
let html = rd('src/template.html');
const parts = { D3: rd('vendor/d3-7.9.0.min.js'), DATA: rd('src/pref_data.js'), CORE: rd('src/core.js'), APP: rd('src/app.js') };
for (const [k, v] of Object.entries(parts)) html = html.replace(`/*__${k}__*/`, () => safe(v));
fs.writeFileSync(out, html);
console.log('wrote', out, (html.length / 1e6).toFixed(2) + 'MB');
