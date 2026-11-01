// 細い線(2px)の大きな塗り絵で壁が途切れず、最小の囲みに宝が来るか
const {openPage,stopStatic}=require('./harness.js');
(async()=>{const {browser,page,errors}=await openPage(__dirname+'/mapgen_test.html');await page.waitForFunction(()=>window.MapGen);
const r=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=2000;c.height=1500;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,2000,1500);g.strokeStyle='#000';g.lineWidth=2;
g.strokeRect(200,200,1600,1100);g.strokeRect(300,300,500,500);g.strokeRect(1300,900,160,160);g.beginPath();g.arc(1200,500,200,0,7);g.stroke();
const m=MapGen.fromCanvas(c);let walls=0;for(const v of m.heights)if(v>=10)walls++;return {w:m.w,h:m.h,walls,t:m.treasure,tH:m.heights[m.treasure.z*m.w+m.treasure.x]};});
console.log(JSON.stringify(r),errors);await browser.close();stopStatic();})();
