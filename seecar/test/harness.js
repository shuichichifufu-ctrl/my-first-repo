// 検査用の共通部品。CDNへの読み込みを手元のファイルに差し替えてブラウザで開く。
// 使い方: const {openPage, startPeerServer} = require('/home/user/my-first-repo/seecar/test/harness.js');
//   const {browser, page, errors} = await openPage('/abs/path/to/file.html', {query:'?peerhost=localhost&peerport=9000&peerpath=/myapp'});
//   ... await page.screenshot({path}) ... await browser.close();
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const LOCAL = {
  'three.min.js': path.join(__dirname, 'node_modules/three/build/three.min.js'),
  'peerjs.min.js': path.join(__dirname, 'node_modules/peerjs/dist/peerjs.min.js'),
};

let server = null, serverPort = 0;
function startStatic() {
  if (server) return Promise.resolve(serverPort);
  return new Promise((res) => {
    server = http.createServer((req, resp) => {
      const p = decodeURIComponent(req.url.split('?')[0]);
      fs.readFile(p, (err, data) => {
        if (err) { resp.writeHead(404); resp.end(); return; }
        const ext = path.extname(p);
        const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css' }[ext] || 'application/octet-stream';
        resp.writeHead(200, { 'Content-Type': type }); resp.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => { serverPort = server.address().port; res(serverPort); });
  });
}

async function openPage(absHtmlPath, opts = {}) {
  const port = await startStatic();
  const browser = opts.browser || await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 720 }, hasTouch: !!opts.touch, isMobile: !!opts.mobile });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.route(/^https:\/\/(cdnjs\.cloudflare\.com|unpkg\.com|cdn\.jsdelivr\.net)\//, (route) => {
    const url = route.request().url();
    const key = Object.keys(LOCAL).find((k) => url.endsWith(k));
    if (key) return route.fulfill({ path: LOCAL[key], contentType: 'text/javascript' });
    errors.push('unrouted CDN request: ' + url);
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}${absHtmlPath}${opts.query || ''}`);
  return { browser, context, page, errors };
}

// 手元用のPeerJS中継サーバー（公開サーバーには作業環境から届かないため）
function startPeerServer(port = 9000) {
  const { ExpressPeerServer } = require('peer');
  const express = require('express');
  const app = express();
  const srv = app.listen(port, '127.0.0.1');
  app.use('/myapp', ExpressPeerServer(srv, { path: '/' }));
  return srv;
}

function stopStatic() { if (server) { server.close(); server = null; } }

module.exports = { openPage, startPeerServer, stopStatic };
