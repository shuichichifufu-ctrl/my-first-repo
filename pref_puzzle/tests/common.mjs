import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
export const d3 = require('../vendor/d3-7.9.0.min.js');
export const Core = require('../src/core.js');
const code = fs.readFileSync(new URL('../src/pref_data.js', import.meta.url), 'utf8').replace('const PREF_DATA', 'globalThis.PREF_DATA');
(0, eval)(code);
export const PREFS = globalThis.PREF_DATA;
export const R = 6371008.8;
export function pass(name, ok, detail = '') { console.log((ok ? 'OK   ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) process.exitCode = 1; }
