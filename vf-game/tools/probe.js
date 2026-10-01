// 1つのボットに対するCPUの行動を集計する。使い方: node tools/probe.js versions/v4.html ボット名 [試合数]
const { chromium } = require('playwright');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/bots.js', 'utf8');
const BOTS = src.match(/const BOTS = `([\s\S]*?)`;\n\(async/)[1];
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 400, height: 300 } });
  await p.goto('file://' + require('path').resolve(process.argv[2]) + '?start=1&norender=1&speed=30');
  await p.evaluate(`(() => { ${BOTS}; const inner = mk['${process.argv[3]}'](); const S = window.__S = { cpuStart:{}, cpuHit:{}, botHit:{}, cpuGuardedByBot:0, botBlocked:0, cpuBlocked:0, matches:0, ends:{} };
    let prevHp=[100,100], prevSt=['',''];
    window.__vf.bot = (a,b) => { inner(a,b); { const g=window.__vf.game; if(g.phase==='roundEnd'&&g.pt===1){ const k=(g.roundWinner?('win'+g.roundWinner.idx):'draw')+':'+document.getElementById('msg').textContent+':hp'+window.__vf.F.map(f=>Math.round(f.hp)>=50?'hi':'lo').join('/'); S.ends[k]=(S.ends[k]||0)+1; } }
      const F = window.__vf.F;
      for (let k=0;k<2;k++){ const f=F[k]; if (f.state==='attack' && prevSt[k]!=='attack' && f.move) { if(k===1) S.cpuStart[f.move.pose]=(S.cpuStart[f.move.pose]||0)+1; }
        if (f.hp < prevHp[k] && window.__vf.game.phase==='fight') { const o=F[1-k]; const key = o.move?o.move.pose:(o.state==='throwhold'||o.state==='attack'?'throw':o.state); if(k===0) S.cpuHit[key]=(S.cpuHit[key]||0)+prevHp[k]-f.hp; else S.botHit[key]=(S.botHit[key]||0)+prevHp[k]-f.hp; }
        if (f.state==='blockstun' && prevSt[k]!=='blockstun') { if(k===0) S.botBlocked++; else S.cpuBlocked++; }
        prevHp[k]=f.hp; prevSt[k]=f.state; if (window.__vf.game.phase==='intro') prevHp[k]=100; }
    };
    window.__n=0; window.__last=null; let lastRe=0; setInterval(()=>{ const g=window.__vf.game; if(g.phase==='roundEnd'&&g.pt===1&&lastRe!==g.round+'_'+window.__vf.F[0].wins+window.__vf.F[1].wins){ lastRe=g.round+'_'+window.__vf.F[0].wins+window.__vf.F[1].wins; const k=(g.roundWinner?('win'+g.roundWinner.idx):'draw')+':'+document.getElementById('msg').textContent; S.ends[k]=(S.ends[k]||0)+1; } if(g.phase!=='matchEnd') window.__last=null; if(g.phase==='matchEnd'&&!window.__last){ window.__last=1; S.matches++; setTimeout(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'Enter'})),50);} },30); })()`);
  await p.waitForTimeout(+(process.argv[4] || 20) * 1000);
  console.log(JSON.stringify(await p.evaluate('window.__S'), null, 1));
  await b.close();
})();
