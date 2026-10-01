// src/ の index.html・three.min.js・game.js を1つの index.html にまとめる（オフラインで動くように）
const fs = require('fs'), path = require('path');
const src = p => fs.readFileSync(path.join(__dirname, 'src', p), 'utf8');
let html = src('index.html');
html = html.replace('<script src="three.min.js"></script>', () => '<script>' + src('three.min.js') + '</script>');
html = html.replace('<script src="game.js"></script>', () => '<script>' + src('game.js') + '</script>');
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('built index.html', (html.length / 1024).toFixed(0) + 'KB');
