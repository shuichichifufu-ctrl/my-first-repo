const { openPage, stopStatic } = require('/home/user/my-first-repo/seecar/test/harness.js');
(async () => {
  const { browser, page } = await openPage('/home/user/my-first-repo/seecar/ab/s/dist/seecar_v4s.html');
  const r = await page.evaluate(() => MapGen.presets.map(p => { const m = MapGen.fromPreset(p.id); const s = m.starts[0]; 
    // walls visible ahead: count height>=9 in cone ahead up to 14 cells
    const DX=[0,1,0,-1],DZ=[-1,0,1,0]; let firstWall=-1, wallCells=0;
    for (let k=1;k<=16;k++) for (let l=-k;l<=k;l+=1){ const px=s.x+DX[s.dir]*k+(-DZ[s.dir])*l*0.8, pz=s.z+DZ[s.dir]*k+(DX[s.dir])*l*0.8; const x=Math.round(px), z=Math.round(pz); if(x<0||z<0||x>=m.w||z>=m.h) continue; if(m.heights[z*m.w+x]>=9){ wallCells++; if(firstWall<0||k<firstWall)firstWall=k; } }
    return {id:p.id,w:m.w,h:m.h,start:s,t:m.treasure,firstWall,wallCells}; }));
  console.log(JSON.stringify(r,null,0).replace(/},{/g,'},\n{'));
  await browser.close(); stopStatic(); process.exit(0);
})();
