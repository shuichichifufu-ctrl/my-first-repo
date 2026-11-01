const { openPage, startPeerServer } = require('/home/user/my-first-repo/seecar/test/harness.js');
const Q = '?peerhost=127.0.0.1&peerport=9000&peerpath=/myapp&peersecure=0';
const P = '/home/user/my-first-repo/seecar/test/net_test.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const srv = startPeerServer(9000);
  const a = await openPage(P, { query: Q });
  const b = await openPage(P, { browser: a.browser, query: Q });
  const c = await openPage(P, { browser: a.browser, query: Q });
  const code = '4321';
  await a.page.evaluate(c => Net.host(c), code);
  await b.page.evaluate(c => Net.join(c), code);
  await sleep(500);
  const ev = p => p.evaluate(() => LOG.map(x => x[0]));
  ok((await ev(a.page)).includes('open') && (await ev(b.page)).includes('open'), 'host/guest 両方 open');
  await a.page.evaluate(() => Net.send({ t: 'hello', color: '#e53935' }));
  await b.page.evaluate(() => Net.send({ t: 'st', s: { x: 1.5, z: 2, dir: 1, color: '#1e88e5', anim: 'move' } }));
  const big = 'x'.repeat(200000);
  await a.page.evaluate(s => Net.send({ t: 'big', s }), big);
  await sleep(800);
  const la = await a.page.evaluate(() => LOG), lb = await b.page.evaluate(() => LOG);
  ok(lb.some(x => x[0] === 'data' && x[1].t === 'hello'), 'host→guest hello');
  ok(la.some(x => x[0] === 'data' && x[1].t === 'st' && x[1].s.x === 1.5), 'guest→host st');
  ok(lb.some(x => x[0] === 'data' && x[1].t === 'big' && x[1].len === 200000), '200KB が届く');
  ok(!lb.concat(la).some(x => x[0] === 'data' && /^_/.test(x[1].t || '')), '内部メッセージが漏れない');
  // 3人目
  const t0 = Date.now();
  const r3 = await c.page.evaluate(() => Net.join('4321').then(() => 'resolved', e => 'rejected:' + e.message));
  console.log('3人目:', r3, Date.now() - t0, 'ms');
  ok(r3.startsWith('rejected'), '3人目は断られる');
  ok((await ev(a.page)).filter(x => x === 'close').length === 0, '3人目でホストは影響を受けない');
  await a.page.evaluate(() => Net.send({ t: 'ping2' })); await sleep(300);
  ok((await b.page.evaluate(() => LOG)).some(x => x[1] && x[1].t === 'ping2'), '3人目後も通信できる');
  // 存在しない番号
  const t1 = Date.now();
  const r4 = await c.page.evaluate(() => Net.join('9999').then(() => 'resolved', e => 'rejected:' + e.message + '|' + e.code));
  const dt = Date.now() - t1;
  const lc = await c.page.evaluate(() => LOG.filter(x => x[0] === 'error'));
  console.log('存在しない番号:', r4, dt, 'ms', JSON.stringify(lc));
  ok(r4.startsWith('rejected') && dt < 5000 && lc.length >= 1, '存在しない番号は数秒以内に error');
  // ID使用中
  const d = await openPage(P, { browser: a.browser, query: Q });
  const r5 = await d.page.evaluate(() => Net.host('4321').then(() => 'resolved', e => 'rejected:' + e.code + '|' + e.message));
  console.log('ID使用中:', r5);
  ok(r5.includes('unavailable-id'), 'unavailable-id');
  // ゲストを閉じる → ホストに close
  const t2 = Date.now();
  await b.page.close();
  let closed = false;
  for (let i = 0; i < 100 && !closed; i++) { await sleep(100); closed = (await ev(a.page)).includes('close'); }
  console.log('close まで', Date.now() - t2, 'ms');
  ok(closed && Date.now() - t2 < 10000, 'ゲストを閉じるとホストに close');
  // Sfx
  const sf = await a.page.evaluate(() => { const r = []; try { ['move','turn','fire','boom','found','tap','bump','xxx'].forEach(n => Sfx.play(n)); Sfx.unlock(); ['move','turn','fire','boom','found','tap','bump'].forEach(n => Sfx.play(n)); Sfx.muted = true; Sfx.play('boom'); r.push('noexc'); } catch (e) { r.push('EXC ' + e); } return r; });
  ok(sf[0] === 'noexc', 'Sfx 全name 例外なし');
  // close の複数回
  const cc = await a.page.evaluate(() => { try { Net.close(); Net.close(); Net.close(); return 'ok'; } catch (e) { return 'EXC' + e; } });
  ok(cc === 'ok', 'close 多重呼び出し安全');
  for (const x of [a, c, d]) console.log('errors:', JSON.stringify(x.errors));
  console.log('errors(b):', JSON.stringify(b.errors));
  await a.browser.close(); srv.close(); process.exit();
})().catch(e => { console.error(e); process.exit(1); });
