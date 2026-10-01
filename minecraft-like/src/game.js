(function(){
'use strict';
// ============================================================
//  ボクセルクラフト  (three.js r160)  -- 1ファイル構成
// ============================================================
const DEBUG=/[?&]debug/.test(location.search);
const errors=[];
window.onerror=function(m,s,l,c){errors.push(String(m)+' @'+String(s||'').split('/').pop()+':'+l+':'+c);return false;};
window.addEventListener('unhandledrejection',function(e){errors.push('promise: '+(e.reason&&e.reason.message||e.reason));});
if(DEBUG)window.__mc={errors:errors};
const $=id=>document.getElementById(id);
const CS=16,CH=64,SEA=22;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};

// ---------- ブロック / アイテム定義 ----------
const B={AIR:0,GRASS:1,DIRT:2,STONE:3,SAND:4,WATER:5,LOG:6,LEAVES:7,PLANKS:8,COBBLE:9,COAL_ORE:10,IRON_ORE:11,TABLE:12,BEDROCK:13,TALLGRASS:14,FLOWER_R:15,FLOWER_Y:16,TORCH:17};
const I={STICK:101,COAL:102,IRON:103,APPLE:104,FLESH:105,PORK:106,COOKED:107,WPICK:110,SPICK:111,IPICK:112,WSWORD:113,SSWORD:114,ISWORD:115,WAXE:116,SAXE:117,IAXE:118};
const SOLID=new Uint8Array(256),OPQ=new Uint8Array(256);
[1,2,3,4,6,7,8,9,10,11,12,13].forEach(i=>{SOLID[i]=1;OPQ[i]=1;});
const isPlant=id=>id===14||id===15||id===16;
const isReplaceable=id=>id===0||id===5||id===14||id===15||id===16;

const TILE_NAMES=['grass_top','grass_side','dirt','stone','cobble','sand','water','log_side','log_top','leaves','planks','coal_ore','iron_ore','bedrock','table_top','table_side','table_front','tallgrass','flower_r','flower_y','torch','stick','coal','iron','apple','flesh','wpick','spick','ipick','wsword','ssword','isword','waxe','saxe','iaxe','pork','cooked'];
const TILE={};TILE_NAMES.forEach((n,i)=>TILE[n]=i);

const BT={};// ブロックの面ごとのタイル [+x,-x,+y,-y,+z,-z]
function bt(id,top,bot,side,front){const f=front===undefined?side:front;BT[id]=[side,side,top,bot,f,f];}
bt(B.GRASS,TILE.grass_top,TILE.dirt,TILE.grass_side);
bt(B.DIRT,TILE.dirt,TILE.dirt,TILE.dirt);
bt(B.STONE,TILE.stone,TILE.stone,TILE.stone);
bt(B.SAND,TILE.sand,TILE.sand,TILE.sand);
bt(B.LOG,TILE.log_top,TILE.log_top,TILE.log_side);
bt(B.LEAVES,TILE.leaves,TILE.leaves,TILE.leaves);
bt(B.PLANKS,TILE.planks,TILE.planks,TILE.planks);
bt(B.COBBLE,TILE.cobble,TILE.cobble,TILE.cobble);
bt(B.COAL_ORE,TILE.coal_ore,TILE.coal_ore,TILE.coal_ore);
bt(B.IRON_ORE,TILE.iron_ore,TILE.iron_ore,TILE.iron_ore);
bt(B.TABLE,TILE.table_top,TILE.planks,TILE.table_side,TILE.table_front);
bt(B.BEDROCK,TILE.bedrock,TILE.bedrock,TILE.bedrock);

const ITEMS={};
function defItem(id,name,tile,o){ITEMS[id]=Object.assign({id,name,tile,max:64},o||{});}
const BI={};
function defBlock(id,name,tile,o){BI[id]=Object.assign({hard:1,tool:null,tier:0,drop:id,snd:'stone'},o||{});defItem(id,name,tile,{block:true});}
defBlock(B.GRASS,'草ブロック',TILE.grass_side,{hard:.6,snd:'grass',drop:B.DIRT});
defBlock(B.DIRT,'土',TILE.dirt,{hard:.5,snd:'dirt'});
defBlock(B.STONE,'石',TILE.stone,{hard:1.5,tool:'pick',tier:1,drop:B.COBBLE});
defBlock(B.SAND,'砂',TILE.sand,{hard:.5,snd:'sand'});
defBlock(B.WATER,'水',TILE.water,{hard:-1});
defBlock(B.LOG,'丸太',TILE.log_side,{hard:2,tool:'axe',snd:'wood'});
defBlock(B.LEAVES,'葉っぱ',TILE.leaves,{hard:.2,snd:'grass',drop:0});
defBlock(B.PLANKS,'板材',TILE.planks,{hard:2,tool:'axe',snd:'wood'});
defBlock(B.COBBLE,'丸石',TILE.cobble,{hard:2,tool:'pick',tier:1});
defBlock(B.COAL_ORE,'石炭鉱石',TILE.coal_ore,{hard:3,tool:'pick',tier:1,drop:I.COAL});
defBlock(B.IRON_ORE,'鉄鉱石',TILE.iron_ore,{hard:3,tool:'pick',tier:2});
defBlock(B.TABLE,'作業台',TILE.table_front,{hard:2.5,tool:'axe',snd:'wood'});
defBlock(B.BEDROCK,'岩盤',TILE.bedrock,{hard:-1});
defBlock(B.TALLGRASS,'草',TILE.tallgrass,{hard:0.02,snd:'grass',drop:0});
defBlock(B.FLOWER_R,'赤い花',TILE.flower_r,{hard:0.02,snd:'grass'});
defBlock(B.FLOWER_Y,'黄色い花',TILE.flower_y,{hard:0.02,snd:'grass'});
defBlock(B.TORCH,'たいまつ',TILE.torch,{hard:0.02,snd:'wood'});
defItem(I.STICK,'棒',TILE.stick);
defItem(I.COAL,'石炭',TILE.coal);
defItem(I.IRON,'鉄インゴット',TILE.iron);
defItem(I.APPLE,'リンゴ',TILE.apple,{food:4});
defItem(I.FLESH,'くさった肉',TILE.flesh,{food:3});
defItem(I.PORK,'生の豚肉',TILE.pork,{food:3});
defItem(I.COOKED,'焼き豚',TILE.cooked,{food:8});
const TIERS=[['木',1,2,60,'w'],['石',2,4,132,'s'],['鉄',3,6,250,'i']];
TIERS.forEach((t,i)=>{
  defItem(110+i,t[0]+'のツルハシ',TILE[t[4]+'pick'],{max:1,tool:{type:'pick',tier:t[1],mult:t[2],dmg:2+i,dur:t[3]}});
  defItem(113+i,t[0]+'の剣',TILE[t[4]+'sword'],{max:1,tool:{type:'sword',tier:t[1],mult:1.5,dmg:5+i*1.5+(i==2?.5:0),dur:t[3]}});
  defItem(116+i,t[0]+'のおの',TILE[t[4]+'axe'],{max:1,tool:{type:'axe',tier:t[1],mult:t[2],dmg:3+i,dur:t[3]}});
});
const RECIPES=[
 {out:B.PLANKS,n:4,ing:[[B.LOG,1]],table:false},
 {out:I.STICK,n:4,ing:[[B.PLANKS,2]],table:false},
 {out:B.TABLE,n:1,ing:[[B.PLANKS,4]],table:false},
 {out:B.TORCH,n:4,ing:[[I.COAL,1],[I.STICK,1]],table:false},
 {out:I.WPICK,n:1,ing:[[B.PLANKS,3],[I.STICK,2]],table:true},
 {out:I.WSWORD,n:1,ing:[[B.PLANKS,2],[I.STICK,1]],table:true},
 {out:I.WAXE,n:1,ing:[[B.PLANKS,3],[I.STICK,2]],table:true},
 {out:I.SPICK,n:1,ing:[[B.COBBLE,3],[I.STICK,2]],table:true},
 {out:I.SSWORD,n:1,ing:[[B.COBBLE,2],[I.STICK,1]],table:true},
 {out:I.SAXE,n:1,ing:[[B.COBBLE,3],[I.STICK,2]],table:true},
 {out:I.IRON,n:1,ing:[[B.IRON_ORE,1],[I.COAL,1]],table:true,note:'かまど代わり'},
 {out:I.COOKED,n:1,ing:[[I.PORK,1],[I.COAL,1]],table:true,note:'かまど代わり'},
 {out:I.IPICK,n:1,ing:[[I.IRON,3],[I.STICK,2]],table:true},
 {out:I.ISWORD,n:1,ing:[[I.IRON,2],[I.STICK,1]],table:true},
 {out:I.IAXE,n:1,ing:[[I.IRON,3],[I.STICK,2]],table:true}
];

// ---------- 乱数・ノイズ ----------
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function hash3(x,y,z,s){let h=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^Math.imul(z|0,1440662683)^Math.imul(s|0,1274126177);h=Math.imul(h^(h>>>13),1274126177);h=Math.imul(h^(h>>>16),2246822519);h^=h>>>15;return(h>>>0)/4294967296;}
function makeNoise(seed){
  const rnd=mulberry32(seed),perm=new Uint8Array(256);
  for(let i=0;i<256;i++)perm[i]=i;
  for(let i=255;i>0;i--){const j=Math.floor(rnd()*(i+1));const t=perm[i];perm[i]=perm[j];perm[j]=t;}
  const p=new Uint8Array(512);for(let i=0;i<512;i++)p[i]=perm[i&255];
  const fade=t=>t*t*t*(t*(t*6-15)+10);
  function g2(h,x,y){switch(h&7){case 0:return x+y;case 1:return -x+y;case 2:return x-y;case 3:return -x-y;case 4:return x;case 5:return -x;case 6:return y;default:return -y;}}
  function n2(x,y){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,X=xi&255,Y=yi&255,u=fade(xf),v=fade(yf);
    const aa=p[p[X]+Y],ab=p[p[X]+Y+1],ba=p[p[X+1]+Y],bb=p[p[X+1]+Y+1];
    const x1=lerp(g2(aa,xf,yf),g2(ba,xf-1,yf),u),x2=lerp(g2(ab,xf,yf-1),g2(bb,xf-1,yf-1),u);return lerp(x1,x2,v);}
  function g3(h,x,y,z){h&=15;const u=h<8?x:y,v=h<4?y:(h===12||h===14)?x:z;return((h&1)?-u:u)+((h&2)?-v:v);}
  function n3(x,y,z){const xi=Math.floor(x),yi=Math.floor(y),zi=Math.floor(z),X=xi&255,Y=yi&255,Z=zi&255;x-=xi;y-=yi;z-=zi;
    const u=fade(x),v=fade(y),w=fade(z);
    const A=p[X]+Y,AA=p[A]+Z,AB=p[A+1]+Z,Bq=p[X+1]+Y,BA=p[Bq]+Z,BB=p[Bq+1]+Z;
    return lerp(lerp(lerp(g3(p[AA],x,y,z),g3(p[BA],x-1,y,z),u),lerp(g3(p[AB],x,y-1,z),g3(p[BB],x-1,y-1,z),u),v),
                lerp(lerp(g3(p[AA+1],x,y,z-1),g3(p[BA+1],x-1,y,z-1),u),lerp(g3(p[AB+1],x,y-1,z-1),g3(p[BB+1],x-1,y-1,z-1),u),v),w);}
  return{n2,n3};
}

// ---------- ピクセルアートのタイルアトラス ----------
let ATLAS_CV=null,ATLAS_PIX=null;
function buildAtlas(){
  const cv=document.createElement('canvas');cv.width=cv.height=128;
  const ctx=cv.getContext('2d',{willReadFrequently:true});
  const R=mulberry32(4242);
  const cl=v=>v<0?0:v>255?255:v|0;
  const vr=(c,a)=>{const d=(R()-.5)*2*a;return[cl(c[0]+d),cl(c[1]+d),cl(c[2]+d)];};
  const mixc=(a,b,t)=>[cl(a[0]+(b[0]-a[0])*t),cl(a[1]+(b[1]-a[1])*t),cl(a[2]+(b[2]-a[2])*t)];
  const tiles={};
  function paint(name,fn){
    const img=ctx.createImageData(16,16),d=img.data;
    const set=(x,y,c,a)=>{if(x<0||y<0||x>15||y>15)return;const i=(y*16+x)*4;d[i]=c[0];d[i+1]=c[1];d[i+2]=c[2];d[i+3]=a===undefined?255:a;};
    const get=(x,y)=>{const i=(y*16+x)*4;return[d[i],d[i+1],d[i+2],d[i+3]];};
    fn(set,get);
    const t=TILE[name];ctx.putImageData(img,(t%8)*16,((t/8)|0)*16);
  }
  const blot=Array.from({length:16},()=>(R()-.5)*20);
  const stonePx=[];
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){const b=blot[(y>>2)*4+(x>>2)];const c=vr([126,126,126],8);stonePx.push([cl(c[0]+b),cl(c[1]+b),cl(c[2]+b)]);}
  const drawStone=set=>{for(let y=0;y<16;y++)for(let x=0;x<16;x++)set(x,y,stonePx[y*16+x]);};
  const spots=(set,list,c1,c2)=>list.forEach((p,i)=>set(p[0],p[1],i%3===0?c2:vr(c1,10)));

  paint('grass_top',set=>{for(let y=0;y<16;y++)for(let x=0;x<16;x++){let c=vr([92,158,52],12);const r=R();if(r<.12)c=vr([116,184,66],8);else if(r<.2)c=vr([70,128,40],8);set(x,y,c);}});
  paint('dirt',set=>{for(let y=0;y<16;y++)for(let x=0;x<16;x++){let c=vr([134,96,66],8);const r=R();if(r<.18)c=vr([108,76,50],8);else if(r<.28)c=vr([154,114,80],8);else if(r<.31)c=vr([120,120,120],10);set(x,y,c);}});
  paint('grass_side',set=>{for(let y=0;y<16;y++)for(let x=0;x<16;x++){let c=vr([134,96,66],8);const r=R();if(r<.18)c=vr([108,76,50],8);else if(r<.28)c=vr([154,114,80],8);set(x,y,c);}
    for(let x=0;x<16;x++){const hh=3+((R()*3)|0);for(let y=0;y<hh;y++){let c=vr([92,158,52],12);if(R()<.15)c=vr([116,184,66],8);set(x,y,c);}if(R()<.5)set(x,hh,vr([70,130,42],8));}});
  paint('stone',drawStone);
  paint('cobble',set=>{
    const seeds=[];for(let i=0;i<9;i++)seeds.push([R()*16,R()*16,90+R()*55]);
    for(let y=0;y<16;y++)for(let x=0;x<16;x++){let d1=99,d2=99,k=0;
      for(let i=0;i<seeds.length;i++){const s=seeds[i];let dx=Math.abs(x+.5-s[0]);dx=Math.min(dx,16-dx);let dy=Math.abs(y+.5-s[1]);dy=Math.min(dy,16-dy);const d=Math.hypot(dx,dy);
        if(d<d1){d2=d1;d1=d;k=i;}else if(d<d2)d2=d;}
      let c;if(d2-d1<1.25)c=vr([62,62,62],6);else{const g=seeds[k][2];c=vr([g,g,g],7);}set(x,y,c);}});
  paint('sand',set=>{for(let y=0;y<16;y++)for(let x=0;x<16;x++){let c=vr([221,208,152],7);const r=R();if(r<.1)c=vr([196,182,128],6);else if(r<.16)c=vr([236,226,176],5);set(x,y,c);}});
  paint('water',set=>{for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    const w=Math.sin((x/16)*Math.PI*2*2+Math.sin((y/16)*Math.PI*2)*1.5)*.5+.5;const w2=Math.sin((y/16)*Math.PI*2*3+(x/16)*Math.PI*2)*.5+.5;
    let c=mixc([38,84,196],[88,140,236],w*.45+w2*.35);c=vr(c,5);set(x,y,c);}});
  paint('log_side',set=>{for(let x=0;x<16;x++){const cv_=(R()-.5)*22;for(let y=0;y<16;y++){let c=vr([104,82,52],6);c=[cl(c[0]+cv_),cl(c[1]+cv_),cl(c[2]+cv_)];if((x%5===2)&&R()<.7)c=vr([72,56,34],6);set(x,y,c);}}});
  paint('log_top',set=>{for(let y=0;y<16;y++)for(let x=0;x<16;x++){const d=Math.hypot(x-7.5,y-7.5),e=Math.max(Math.abs(x-7.5),Math.abs(y-7.5));
    let c;if(e>6.2)c=vr([98,76,48],6);else c=((Math.floor(d*.95))%2===0)?vr([186,150,96],6):vr([156,120,72],6);set(x,y,c);}});
  paint('leaves',set=>{for(let y=0;y<16;y++)for(let x=0;x<16;x++){let c=vr([52,126,38],8);const r=R();if(r<.3)c=vr([32,92,28],6);else if(r<.5)c=vr([78,156,52],8);else if(r<.55)c=vr([22,70,22],4);set(x,y,c);}});
  paint('planks',set=>{for(let y=0;y<16;y++)for(let x=0;x<16;x++){let c=vr([170,134,82],6);const row=y>>2;
    if(y%4===3)c=vr([118,88,50],4);
    else if(x===((row%2)?5:12)&&y%4!==3)c=vr([128,96,56],4);
    else if(R()<.12)c=vr([150,116,68],5);set(x,y,c);}});
  paint('coal_ore',set=>{drawStone(set);spots(set,[[3,3],[4,3],[3,4],[10,2],[11,2],[11,3],[6,8],[7,8],[6,9],[7,9],[2,11],[3,11],[3,12],[11,10],[12,10],[12,11],[11,11],[8,13],[9,13],[14,6],[14,7]],[34,34,38],[84,84,92]);});
  paint('iron_ore',set=>{drawStone(set);spots(set,[[4,4],[5,4],[4,5],[10,3],[11,4],[11,3],[8,9],[9,9],[8,10],[9,10],[3,11],[4,11],[12,11],[12,12],[7,13],[13,6],[2,7]],[214,170,140],[240,205,180]);});
  paint('bedrock',set=>{for(let y=0;y<16;y++)for(let x=0;x<16;x++){let c=vr([66,66,66],22);if(R()<.2)c=vr([30,30,30],10);set(x,y,c);}});
  const plank=(set,bright)=>{for(let y=0;y<16;y++)for(let x=0;x<16;x++){let c=vr([170,134,82],6);if(y%4===3)c=vr([118,88,50],4);set(x,y,c);}};
  paint('table_top',set=>{plank(set);for(let i=0;i<16;i++){[0,15].forEach(k=>{set(i,k,vr([88,58,30],4));set(k,i,vr([88,58,30],4));});}
    for(let i=1;i<15;i++){set(i,5,vr([96,66,34],4));set(i,10,vr([96,66,34],4));set(5,i,vr([96,66,34],4));set(10,i,vr([96,66,34],4));}});
  paint('table_side',set=>{plank(set);for(let i=0;i<16;i++){set(i,0,[88,58,30]);set(i,1,[88,58,30]);set(0,i,[88,58,30]);set(15,i,[88,58,30]);}
    for(let y=4;y<12;y++){set(3,y,[170,170,176]);set(4,y,[130,130,138]);}for(let x=7;x<13;x++){set(x,5,[100,70,36]);set(x,6,[100,70,36]);}set(12,4,[150,150,158]);set(11,4,[150,150,158]);set(10,9,[90,90,96]);set(11,9,[90,90,96]);set(11,10,[90,90,96]);});
  paint('table_front',set=>{plank(set);for(let i=0;i<16;i++){set(i,0,[88,58,30]);set(i,1,[88,58,30]);set(0,i,[88,58,30]);set(15,i,[88,58,30]);}
    for(let x=3;x<8;x++){set(x,5,[190,190,196]);set(x,6,[140,140,148]);}for(let y=7;y<12;y++){set(4,y,[100,70,36]);set(5,y,[100,70,36]);}for(let x=9;x<13;x++)for(let y=4;y<7;y++)set(x,y,[96,96,104]);for(let y=7;y<13;y++)set(11,y,[100,70,36]);});
  paint('tallgrass',set=>{[[2,11],[4,13],[6,9],[7,12],[9,10],[10,13],[12,8],[13,11]].forEach(p=>{for(let y=p[1];y<16;y++){const lean=Math.floor((16-y)/6)*((p[0]>7)?1:-1)*0;set(p[0]+lean,y,vr(y===p[1]?[140,200,80]:[84,156,50],12));}
      set(p[0]+1,p[1]+1,vr([96,170,58],8));});});
  const flower=(head,cen)=>set=>{for(let y=7;y<16;y++){set(8,y,vr([60,130,40],8));}set(7,12,[70,150,46]);set(6,11,[70,150,46]);set(9,10,[70,150,46]);set(10,9,[70,150,46]);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)set(8+dx,5+dy,vr(head,10));set(8,5,cen);set(8,3,vr(head,10));set(8,7,vr(head,10));set(6,5,vr(head,10));set(10,5,vr(head,10));};
  paint('flower_r',flower([214,32,44],[250,220,60]));
  paint('flower_y',flower([248,214,40],[210,120,20]));
  paint('torch',set=>{for(let y=6;y<16;y++){set(7,y,y<8?[255,200,70]:[132,94,48]);set(8,y,y<8?[255,140,30]:[96,66,32]);}set(7,6,[255,240,150]);set(8,6,[255,210,90]);set(7,5,[255,160,40],200);set(8,4,[255,120,20],150);});
  paint('stick',set=>{for(let i=0;i<10;i++){set(3+i,12-i,[150,108,54]);set(4+i,12-i,[112,78,38]);}set(2,13,[112,78,38]);});
  paint('coal',set=>{const pts=[[6,4],[7,4],[8,4],[5,5],[6,5],[7,5],[8,5],[9,5],[4,6],[5,6],[6,6],[7,6],[8,6],[9,6],[10,6],[4,7],[5,7],[6,7],[7,7],[8,7],[9,7],[10,7],[11,7],[4,8],[5,8],[6,8],[7,8],[8,8],[9,8],[10,8],[11,8],[5,9],[6,9],[7,9],[8,9],[9,9],[10,9],[11,9],[5,10],[6,10],[7,10],[8,10],[9,10],[10,10],[6,11],[7,11],[8,11],[9,11]];
    pts.forEach(p=>set(p[0],p[1],vr([40,40,46],6)));[[6,5],[7,5],[5,6],[6,6],[9,8],[8,7]].forEach(p=>set(p[0],p[1],[96,96,108]));pts.filter(p=>p[0]+p[1]>=19).forEach(p=>set(p[0],p[1],vr([22,22,26],4)));});
  paint('iron',set=>{for(let y=0;y<6;y++)for(let x=0;x<11;x++){const px=3+x+(5-y)*0.0+ (y<3?0:0);const X=Math.floor(3+x*1+ (y*0.5)),Y=5+y+2;
      set(X,Y,y===0?[246,246,250]:y>=4?[150,150,160]:[212,212,220]);}
    for(let x=0;x<11;x++){set(3+x+1,6,[238,238,244]);}});
  paint('apple',set=>{for(let y=0;y<16;y++)for(let x=0;x<16;x++){const d=Math.hypot(x-7.5,y-9.2);if(d<5.2){let c=vr([204,36,36],8);if(d>4.2)c=[150,20,24];set(x,y,c);}}
    set(5,7,[246,120,110]);set(6,6,[246,120,110]);set(5,8,[236,90,84]);set(8,3,[90,60,30]);set(8,4,[90,60,30]);set(9,3,[70,160,50]);set(10,3,[70,160,50]);set(10,4,[56,130,40]);});
  paint('flesh',set=>{for(let y=0;y<16;y++)for(let x=0;x<16;x++){const d=Math.hypot((x-7.5)*.9,(y-8)*1.1)+Math.sin(x*1.7+y)*.7;if(d<5.8){let c=vr([150,74,60],10);if(R()<.25)c=vr([100,128,64],8);if(d>4.8)c=vr([108,52,42],6);set(x,y,c);}}
    set(12,4,[230,225,215]);set(13,3,[230,225,215]);set(12,5,[200,195,185]);});
  paint('pork',set=>{for(let y=0;y<16;y++)for(let x=0;x<16;x++){const d=Math.hypot((x-7.5)*.85,(y-8)*1.05)+Math.sin(x*1.3+y*.8)*.6;if(d<5.8){let c=vr([232,120,128],8);if(d>4.7)c=vr([190,86,98],6);else if(R()<.2)c=vr([248,170,170],6);set(x,y,c);}}set(5,6,[255,215,215]);set(6,5,[255,215,215]);});
  paint('cooked',set=>{for(let y=0;y<16;y++)for(let x=0;x<16;x++){const d=Math.hypot((x-7.5)*.85,(y-8)*1.05)+Math.sin(x*1.3+y*.8)*.6;if(d<5.8){let c=vr([172,98,52],8);if(d>4.7)c=vr([110,56,28],6);else if(R()<.2)c=vr([206,138,78],6);set(x,y,c);}}set(5,6,[230,180,120]);set(6,5,[230,180,120]);set(11,11,[238,232,220]);set(12,12,[238,232,220]);});
  const TC={w:[[164,124,64],[130,96,46]],s:[[142,142,146],[100,100,106]],i:[[232,232,238],[170,172,182]]};
  const handle=(set,x0,y0,len)=>{for(let i=0;i<len;i++){set(x0+i,y0-i,[132,92,44]);if(i>0)set(x0+i-1,y0-i,[96,66,30]);}};
  ['w','s','i'].forEach(k=>{
    const c1=TC[k][0],c2=TC[k][1];
    paint(k+'pick',set=>{handle(set,2,14,9);
      [[4,3],[5,2],[6,2],[7,2],[8,2],[9,2],[10,3],[11,4],[12,5],[12,6],[13,7]].forEach(p=>set(p[0],p[1],c1));
      [[4,4],[5,3],[6,3],[7,3],[8,3],[9,3],[10,4],[11,5],[11,6],[12,7]].forEach(p=>set(p[0],p[1],c2));});
    paint(k+'sword',set=>{for(let i=0;i<9;i++){set(5+i,10-i,c1);set(4+i,10-i,c2);set(5+i,11-i,c2);}set(13,2,c1);set(14,1,c1);
      for(let i=0;i<4;i++){set(3+i,9+i-i*0,[0,0,0],0);}
      [[4,9],[5,10],[6,11],[3,10],[4,11],[5,12]].forEach((p,i)=>set(p[0],p[1],[120,84,40]));set(2,13,[96,66,30]);set(3,12,[96,66,30]);set(2,14,[96,66,30]);});
    paint(k+'axe',set=>{handle(set,2,14,10);
      [[8,2],[9,2],[10,2],[11,3],[8,3],[9,3],[10,3],[11,4],[12,4],[9,4],[10,4],[11,5],[12,5],[10,5],[11,6]].forEach(p=>set(p[0],p[1],c1));
      [[8,4],[9,5],[10,6],[11,7],[12,6]].forEach(p=>set(p[0],p[1],c2));});
  });
  ATLAS_CV=cv;ATLAS_PIX=ctx.getImageData(0,0,128,128).data;
  return cv;
}
const EPS_UV=0.004;
function tuv(tile,tu,tv){const col=tile%8,row=(tile/8)|0;const a=EPS_UV+tu*(1-2*EPS_UV),b=EPS_UV+tv*(1-2*EPS_UV);return[(col+a)/8,1-(row+(1-b))/8];}
function tilePixel(tile,rnd){const col=tile%8,row=(tile/8)|0;for(let k=0;k<12;k++){const x=col*16+((rnd()*16)|0),y=row*16+((rnd()*16)|0);const i=(y*128+x)*4;if(ATLAS_PIX[i+3]>128)return[ATLAS_PIX[i]/255,ATLAS_PIX[i+1]/255,ATLAS_PIX[i+2]/255];}return[.5,.5,.5];}
function makeWaterCanvas(){const cv=document.createElement('canvas');cv.width=cv.height=16;const g=cv.getContext('2d');
  g.drawImage(ATLAS_CV,TILE.water%8*16,((TILE.water/8)|0)*16,16,16,0,0,16,16);return cv;}
function makeCrackCanvas(){const cv=document.createElement('canvas');cv.width=160;cv.height=16;const g=cv.getContext('2d');
  const R=mulberry32(99);const pts=[];
  for(let k=0;k<7;k++){let x=R()<.5?(R()*16|0):(R()<.5?0:15),y=R()*16|0;if(k<2){x=7+((R()*3)|0);y=7+((R()*3)|0);}let dx=R()<.5?-1:1,dy=R()<.5?-1:1;
    for(let s=0;s<14;s++){pts.push([x,y]);const r=R();if(r<.35)x+=dx;else if(r<.7)y+=dy;else{x+=dx;y+=dy;}if(R()<.2)dx=-dx;if(R()<.2)dy=-dy;if(x<0||y<0||x>15||y>15)break;}}
  for(let st=0;st<10;st++){const n=Math.floor(pts.length*((st+1)/10));g.fillStyle='rgba(0,0,0,.72)';for(let i=0;i<n;i++){g.fillRect(st*16+pts[i][0],pts[i][1],1,1);}}
  return cv;}

// ---------- アイコン生成 ----------
const iconCache={};
const CUBE_IDS={1:1,2:1,3:1,4:1,6:1,7:1,8:1,9:1,10:1,11:1,12:1,13:1};
function itemIcon(id){
  if(iconCache[id])return iconCache[id];
  const cv=document.createElement('canvas');cv.width=cv.height=40;const g=cv.getContext('2d');g.imageSmoothingEnabled=false;
  const it=ITEMS[id];
  if(CUBE_IDS[id]){
    const tiles=BT[id];const draw=(tile,m,dark)=>{g.save();g.setTransform(m[0],m[1],m[2],m[3],m[4],m[5]);g.beginPath();g.rect(0,0,16,16);g.clip();
      g.drawImage(ATLAS_CV,(tile%8)*16,((tile/8)|0)*16,16,16,0,0,16,16);if(dark){g.fillStyle='rgba(0,0,0,'+dark+')';g.fillRect(0,0,16,16);}g.restore();};
    draw(tiles[2],[1,.5,-1,.5,20,2],0);
    draw(tiles[4],[1,.5,0,1,4,10],.28);
    draw(tiles[0],[1,-.5,0,1,20,18],.5);
  }else{
    g.drawImage(ATLAS_CV,(it.tile%8)*16,((it.tile/8)|0)*16,16,16,4,4,32,32);
  }
  return iconCache[id]=cv.toDataURL();
}
function pixelIcon(rows,fills,scale){
  const h=rows.length,w=rows[0].length;const cv=document.createElement('canvas');cv.width=w;cv.height=h;const g=cv.getContext('2d');
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const ch=rows[y][x];if(fills[ch]){g.fillStyle=fills[ch];g.fillRect(x,y,1,1);}}return cv.toDataURL();}
function heartIcon(kind){
  const P=['.XX...XX.','XXXX.XXXX','XXXXXXXXX','XXXXXXXXX','XXXXXXXXX','.XXXXXXX.','..XXXXX..','...XXX...','....X....'];
  const cv=document.createElement('canvas');cv.width=cv.height=9;const g=cv.getContext('2d');
  const on=(x,y)=>y>=0&&y<9&&x>=0&&x<9&&P[y][x]==='X';
  for(let y=0;y<9;y++)for(let x=0;x<9;x++){if(!on(x,y))continue;
    const edge=!on(x-1,y)||!on(x+1,y)||!on(x,y-1)||!on(x,y+1);
    let col;if(edge)col='#2a0508';else{const full=kind==='f'||(kind==='h'&&x<=4);col=full?'#e0262c':'#4a2a2a';if(full&&(x===1||x===2)&&y===1)col='#ff9a9a';if(full&&y>=5)col='#b81c22';}
    g.fillStyle=col;g.fillRect(x,y,1,1);}
  return cv.toDataURL();}
function hungerIcon(kind){
  const cv=document.createElement('canvas');cv.width=cv.height=9;const g=cv.getContext('2d');
  const meat=[];for(let y=0;y<9;y++)for(let x=0;x<9;x++){if(Math.hypot(x-5.2,y-3.2)<3.4)meat.push([x,y]);}
  const on=(x,y)=>meat.some(p=>p[0]===x&&p[1]===y);
  const bone=[[3,5],[2,6],[1,7],[0,7],[1,8],[0,6]];
  const full=kind==='f'||kind==='h';
  meat.forEach(p=>{const x=p[0],y=p[1];const edge=!on(x-1,y)||!on(x+1,y)||!on(x,y-1)||!on(x,y+1);
    let col=edge?'#3a1c08':(kind==='e'?'#4a3a2a':'#c9702a');if(!edge&&kind!=='e'&&y<=2&&x>=4)col='#e89a48';
    if(kind==='h'&&x>5)col=edge?'#3a1c08':'#4a3a2a';g.fillStyle=col;g.fillRect(x,y,1,1);});
  bone.forEach(p=>{g.fillStyle=kind==='e'?'#6a6258':'#f0e6d0';g.fillRect(p[0],p[1],1,1);});
  return cv.toDataURL();}
function bubbleIcon(){const cv=document.createElement('canvas');cv.width=cv.height=9;const g=cv.getContext('2d');
  for(let y=0;y<9;y++)for(let x=0;x<9;x++){const d=Math.hypot(x-4,y-4);if(d<4.2){g.fillStyle=d>3.2?'#1d4f9a':'rgba(150,200,255,.75)';g.fillRect(x,y,1,1);}}g.fillStyle='#fff';g.fillRect(2,2,1,1);return cv.toDataURL();}

// ---------- 音（WebAudio合成） ----------
const Sfx=(function(){
  let ctx=null,master=null,nbuf=null,muted=false;
  const MAT={stone:900,dirt:380,grass:620,sand:1300,wood:520,leaf:700};
  function init(){if(ctx)return;try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;ctx=new AC();master=ctx.createGain();master.gain.value=muted?0:.8;master.connect(ctx.destination);
    nbuf=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);const d=nbuf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;}catch(e){ctx=null;}}
  function resume(){if(ctx&&ctx.state==='suspended'){try{ctx.resume();}catch(e){}}}
  function nz(dur,type,f0,f1,vol,q){if(!ctx||muted)return;try{const t=ctx.currentTime,s=ctx.createBufferSource();s.buffer=nbuf;s.loop=true;
    const f=ctx.createBiquadFilter();f.type=type;f.frequency.setValueAtTime(f0,t);f.frequency.exponentialRampToValueAtTime(Math.max(30,f1),t+dur);f.Q.value=q||1;
    const g=ctx.createGain();g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.0008,t+dur);s.connect(f);f.connect(g);g.connect(master);s.start(t,Math.random()*.5);s.stop(t+dur+.02);}catch(e){}}
  function tone(type,f0,f1,dur,vol,vib,lp){if(!ctx||muted)return;try{const t=ctx.currentTime,o=ctx.createOscillator();o.type=type;o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(Math.max(20,f1),t+dur);
    const g=ctx.createGain();g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(vol,t+Math.min(.04,dur*.2));g.gain.exponentialRampToValueAtTime(.0008,t+dur);
    let out=g;if(lp){const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=lp;o.connect(f);f.connect(g);}else o.connect(g);
    if(vib){const l=ctx.createOscillator(),lg=ctx.createGain();l.frequency.value=vib;lg.gain.value=f0*.08;l.connect(lg);lg.connect(o.frequency);l.start(t);l.stop(t+dur+.02);}
    g.connect(master);o.start(t);o.stop(t+dur+.02);}catch(e){}}
  const S={
    dig(m){const f=MAT[m]||800;nz(.09,'bandpass',f*1.1,f*.8,.28,1.2);},
    brk(m){const f=MAT[m]||800;nz(.24,'lowpass',f*1.8,f*.35,.7,.8);tone('square',130,55,.12,.12);},
    place(m){const f=MAT[m]||800;nz(.11,'lowpass',f*1.2,f*.5,.45,.8);tone('sine',200,90,.09,.22);},
    step(m,v){const f=MAT[m]||800;nz(.07,'lowpass',f*.9,f*.4,.2*(v||1),.7);},
    hurt(){tone('sawtooth',300,110,.28,.32,0,1800);nz(.14,'lowpass',1400,300,.3);},
    zombie(v){const b=75+Math.random()*30;tone('sawtooth',b*1.2,b*.7,.9,.22*(v===undefined?1:v),5.5,520);},
    zhurt(v){tone('sawtooth',190,70,.28,.3*(v===undefined?1:v),0,700);nz(.1,'lowpass',900,200,.2);},
    pig(v){const b=260+Math.random()*80;tone('square',b,b*.62,.22,.12*(v===undefined?1:v),0,900);setTimeout(()=>tone('square',b*.9,b*.55,.16,.09*(v===undefined?1:v),0,900),180);},
    zdie(v){tone('sawtooth',160,40,.7,.3*(v===undefined?1:v),7,500);},
    pickup(){tone('sine',520,1150,.1,.16);},
    splash(){nz(.38,'lowpass',2600,350,.5);},
    eat(){for(let i=0;i<3;i++)setTimeout(()=>nz(.05,'bandpass',1000+Math.random()*500,600,.35,2),i*110);},
    click(){tone('square',900,600,.045,.1);},
    craft(){tone('square',700,900,.05,.1);setTimeout(()=>tone('square',900,1300,.07,.1),70);},
    tool(){tone('triangle',500,120,.25,.25);nz(.2,'highpass',2000,1000,.3);},
    death(){tone('sawtooth',320,35,1.1,.35,0,900);},
    swing(){nz(.12,'bandpass',900,2200,.07,.8);},
    hit(){nz(.1,'lowpass',1500,400,.5);tone('square',200,90,.08,.15);}
  };
  return{init,resume,play(n,a,b){if(S[n])S[n](a,b);},setMuted(m){muted=m;if(master)master.gain.value=m?0:.8;},isMuted(){return muted;}};
})();

// ============================================================
//  three.js 準備
// ============================================================
THREE.ColorManagement.enabled=false;
const canvas=$('c');
let renderer;
try{
  renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});
}catch(e){
  document.body.insertAdjacentHTML('beforeend','<div style="position:fixed;inset:0;z-index:99;background:#222;color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px">WebGLが使えないため、このゲームは動きません。</div>');
  throw e;
}
renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
renderer.autoClear=false;
renderer.info.autoReset=false;
renderer.setClearColor(0x8ab4f8,1);
const scene=new THREE.Scene();
scene.fog=new THREE.Fog(0xb4d0f4,40,90);
const camera=new THREE.PerspectiveCamera(72,1,0.08,900);
camera.rotation.order='YXZ';
const handScene=new THREE.Scene();
const handCam=new THREE.PerspectiveCamera(58,1,0.01,10);

const atlasCanvas=buildAtlas();
const atlasTex=new THREE.CanvasTexture(atlasCanvas);
atlasTex.magFilter=THREE.NearestFilter;atlasTex.minFilter=THREE.NearestFilter;atlasTex.generateMipmaps=false;
const waterTex=new THREE.CanvasTexture(makeWaterCanvas());
waterTex.magFilter=THREE.NearestFilter;waterTex.minFilter=THREE.NearestFilter;waterTex.generateMipmaps=false;
waterTex.wrapS=waterTex.wrapT=THREE.RepeatWrapping;

// 世界用シェーダ（空光・ブロック光・AO・フォグ）
const U={
  uDay:{value:1},uSkyTint:{value:new THREE.Color(1,1,1)},uFogColor:{value:new THREE.Color(0xb4d0f4)},
  uFogNear:{value:40},uFogFar:{value:90},uMinLight:{value:.08}
};
const VS='attribute vec3 aL;varying vec2 vUv;varying vec3 vL;varying float vDist;uniform vec2 uOff;'+
 'void main(){vUv=uv+uOff;vL=aL;vec4 mv=modelViewMatrix*vec4(position,1.0);vDist=length(mv.xyz);gl_Position=projectionMatrix*mv;}';
const FS='uniform sampler2D uMap;uniform float uDay,uAlpha,uMinLight,uFogNear,uFogFar;uniform vec3 uSkyTint,uFogColor;'+
 'varying vec2 vUv;varying vec3 vL;varying float vDist;'+
 'void main(){vec4 t=texture2D(uMap,vUv);if(t.a<0.5)discard;'+
 'vec3 sk=uSkyTint*(vL.x*uDay);vec3 bl=vec3(1.0,0.8,0.55)*vL.y;vec3 l=max(max(sk,bl),vec3(uMinLight));'+
 'vec3 c=t.rgb*l*vL.z;float f=clamp((vDist-uFogNear)/(uFogFar-uFogNear),0.0,1.0);c=mix(c,uFogColor,f);gl_FragColor=vec4(c,uAlpha);}';
function makeWorldMat(map,alpha,transparent,side){
  return new THREE.ShaderMaterial({uniforms:{uMap:{value:map},uAlpha:{value:alpha},uOff:{value:new THREE.Vector2(0,0)},
    uDay:U.uDay,uSkyTint:U.uSkyTint,uFogColor:U.uFogColor,uFogNear:U.uFogNear,uFogFar:U.uFogFar,uMinLight:U.uMinLight},
    vertexShader:VS,fragmentShader:FS,transparent:!!transparent,depthWrite:!transparent,side:side||THREE.FrontSide});
}
const solidMat=makeWorldMat(atlasTex,1,false);
const waterMat=makeWorldMat(waterTex,0.72,true,THREE.DoubleSide);

// ============================================================
//  ワールド生成
// ============================================================
let SEED=1;
let nCont,nHill,nDet,nMtn,nRough,nForest,nCA,nCB,nCC,nEnt;
function setSeed(s){SEED=s|0;nCont=makeNoise(s+1);nHill=makeNoise(s+2);nDet=makeNoise(s+3);nMtn=makeNoise(s+4);nRough=makeNoise(s+5);nForest=makeNoise(s+6);nCA=makeNoise(s+7);nCB=makeNoise(s+8);nCC=makeNoise(s+9);nEnt=makeNoise(s+10);}
function fbm2(n,x,z,o){let s=0,a=1,f=1,t=0;for(let i=0;i<o;i++){s+=a*n.n2(x*f,z*f);t+=a;a*=.5;f*=2;}return s/t;}
function heightAt(x,z){
  const cont=fbm2(nCont,x*.0042,z*.0042,3);
  const rough=.28+.72*smooth(-.2,.35,fbm2(nRough,x*.007,z*.007,2));
  const hills=fbm2(nHill,x*.018,z*.018,4);
  const det=nDet.n2(x*.09,z*.09);
  const mt=Math.max(0,fbm2(nMtn,x*.0055,z*.0055,3)-.03);
  const h=SEA+4+cont*34+hills*15*rough+det*1.1+mt*mt*250;
  const hh=h>42?42+(h-42)*.55:h;
  return clamp(Math.floor(hh),3,CH-6);
}
function caveAt(x,y,z){
  const a=nCA.n3(x*.05,y*.075,z*.05),b=nCB.n3(x*.05+31.7,y*.075+11.3,z*.05+7.1);
  if(a*a+b*b<.0075)return true;
  if(y<34){const c=nCC.n3(x*.032,y*.055,z*.032);if(c>.5)return true;}
  return false;
}
function caveMax(wx,wz,h){
  if(h<SEA)return h-4;
  if(h>=SEA+3&&nEnt.n2(wx*.03,wz*.03)>.52)return h;
  return h-2;
}

const chunks=new Map();
const mods=new Map();// ckey -> {cx,cz,m:Map(idx->id)}
const ckey=(cx,cz)=>cx*65536+cz;
const getChunk=(cx,cz)=>chunks.get(cx*65536+cz);
const cidx=(x,y,z)=>((y*16+(z&15))<<4)+(x&15);

function genChunk(cx,cz){
  const c={cx,cz,blocks:new Uint8Array(CS*CS*CH),sky:new Uint8Array(CS*CS*CH),blk:new Uint8Array(CS*CS*CH),lightOK:false,needMesh:true,mesh:null,wmesh:null,tris:0,hasGeo:false};
  const b=c.blocks,ox=cx*CS,oz=cz*CS,GP=3,GW=CS+2*GP;
  const hm=new Int16Array(GW*GW);
  for(let z=0;z<GW;z++)for(let x=0;x<GW;x++)hm[z*GW+x]=heightAt(ox+x-GP,oz+z-GP);
  for(let z=0;z<CS;z++)for(let x=0;x<CS;x++){
    const wx=ox+x,wz=oz+z,h=hm[(z+GP)*GW+x+GP];
    const hi=(z+GP)*GW+x+GP;const slope=h-Math.min(hm[hi-1],hm[hi+1],hm[hi-GW],hm[hi+GW]);
    const rocky=h>SEA+2&&(slope>=4||h>=SEA+22+((hash3(wx,3,wz,SEED)*3)|0));
    const sandy=h<=SEA+1&&h>=SEA-4;
    const dirtD=3+((hash3(wx,0,wz,SEED)*2)|0);
    const cm=caveMax(wx,wz,h);
    for(let y=0;y<=h;y++){
      let id;
      if(y===0)id=B.BEDROCK;
      else if(y===1&&hash3(wx,1,wz,SEED)<.5)id=B.BEDROCK;
      else if(y===h)id=rocky?B.STONE:sandy?B.SAND:(h<SEA-4?B.DIRT:B.GRASS);
      else if(y>h-dirtD&&!rocky)id=sandy?B.SAND:B.DIRT;
      else{
        id=B.STONE;
        if(y<48&&hash3(Math.floor(wx/3),Math.floor(y/3),Math.floor(wz/3),SEED+11)<.035&&hash3(wx,y,wz,SEED+12)<.5)id=B.COAL_ORE;
        else if(y<30&&hash3(Math.floor(wx/3),Math.floor(y/3),Math.floor(wz/3),SEED+21)<.018&&hash3(wx,y,wz,SEED+22)<.5)id=B.IRON_ORE;
      }
      if(y>=3&&y<=cm&&id!==B.BEDROCK&&caveAt(wx,y,wz))id=0;
      b[cidx(x,y,z)]=id;
    }
    for(let y=h+1;y<=SEA;y++)b[cidx(x,y,z)]=B.WATER;
  }
  // 木
  for(let z=-2;z<CS+2;z++)for(let x=-2;x<CS+2;x++){
    const wx=ox+x,wz=oz+z,h=hm[(z+GP)*GW+x+GP];
    if(h<=SEA+1||h>SEA+20)continue;
    {const hi=(z+GP)*GW+x+GP;if(h-Math.min(hm[hi-1],hm[hi+1],hm[hi-GW],hm[hi+GW])>=4)continue;if(h>=SEA+22)continue;}
    const f=nForest.n2(wx*.013,wz*.013);
    const chance=.0018+Math.max(0,f-.02)*.045;
    if(hash3(wx,7,wz,SEED)>=chance)continue;
    if(h<=caveMax(wx,wz,h)&&caveAt(wx,h,wz))continue;
    const th=4+((hash3(wx,8,wz,SEED)*3)|0);
    const put=(lx,y,lz,id,onlyAir)=>{if(lx<0||lz<0||lx>=CS||lz>=CS||y<0||y>=CH)return;const i=cidx(lx,y,lz);const cur=b[i];if(onlyAir&&cur!==0&&!isPlant(cur))return;b[i]=id;};
    for(let ty=1;ty<=th;ty++)put(x,h+ty,z,B.LOG,false);
    for(let dy=th-2;dy<=th+1;dy++){
      const r=dy>=th?1:2;
      for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++){
        if(dx===0&&dz===0&&dy<=th)continue;
        if(r===2&&Math.abs(dx)===2&&Math.abs(dz)===2&&hash3(wx+dx,dy,wz+dz,SEED+5)<.55)continue;
        if(dy===th+1&&Math.abs(dx)+Math.abs(dz)>1)continue;
        put(x+dx,h+dy,z+dz,B.LEAVES,true);
      }
    }
  }
  // 草花
  for(let z=0;z<CS;z++)for(let x=0;x<CS;x++){
    const wx=ox+x,wz=oz+z,h=hm[(z+GP)*GW+x+GP];
    if(h<=SEA+1||h>=CH-2)continue;
    if(b[cidx(x,h,z)]!==B.GRASS||b[cidx(x,h+1,z)]!==0)continue;
    const r=hash3(wx,9,wz,SEED);
    if(r<.14)b[cidx(x,h+1,z)]=B.TALLGRASS;else if(r<.153)b[cidx(x,h+1,z)]=B.FLOWER_R;else if(r<.166)b[cidx(x,h+1,z)]=B.FLOWER_Y;
  }
  const m=mods.get(ckey(cx,cz));
  if(m)m.m.forEach((id,i)=>{b[i]=id;});
  chunks.set(ckey(cx,cz),c);
  return c;
}
function recordMod(x,y,z,id){
  const cx=x>>4,cz=z>>4,k=ckey(cx,cz);let e=mods.get(k);if(!e){e={cx,cz,m:new Map()};mods.set(k,e);}
  e.m.set(cidx(x,y,z),id);
}
function getBlock(x,y,z){
  if(y<0)return B.BEDROCK;if(y>=CH)return 0;
  const c=chunks.get((x>>4)*65536+(z>>4));if(!c)return 0;
  return c.blocks[((y*16+(z&15))<<4)+(x&15)];
}
function solidAt(x,y,z){// 物理用: 未ロードは固体
  if(y<0)return true;if(y>=CH)return false;
  const c=chunks.get((x>>4)*65536+(z>>4));if(!c)return true;
  return SOLID[c.blocks[((y*16+(z&15))<<4)+(x&15)]]===1;
}
function lightAt(x,y,z){
  if(y>=CH)return[15,0];if(y<0)return[0,0];
  const c=chunks.get((x>>4)*65536+(z>>4));if(!c)return[15,0];
  const i=((y*16+(z&15))<<4)+(x&15);return[c.sky[i],c.blk[i]];
}
function setBlock(x,y,z,id,silent){
  if(y<0||y>=CH)return false;
  const cx=x>>4,cz=z>>4,c=getChunk(cx,cz);if(!c)return false;
  const i=cidx(x,y,z);if(c.blocks[i]===id)return false;
  c.blocks[i]=id;recordMod(x,y,z,id);
  c.needMesh=true;c.lightOK=false;
  const lx=x&15,lz=z&15;
  const mark=(dx,dz)=>{const n=getChunk(cx+dx,cz+dz);if(n){n.needMesh=true;n.lightOK=false;if(!silent)needSync.add(n);}};
  if(lx<=1)mark(-1,0);if(lx>=14)mark(1,0);if(lz<=1)mark(0,-1);if(lz>=14)mark(0,1);
  if(lx<=1&&lz<=1)mark(-1,-1);if(lx>=14&&lz<=1)mark(1,-1);if(lx<=1&&lz>=14)mark(-1,1);if(lx>=14&&lz>=14)mark(1,1);
  if(!silent)needSync.add(c);
  return true;
}
const needSync=new Set();

// ---------- 光 ----------
const LOPQ=new Uint8Array(256);for(let i=0;i<256;i++)LOPQ[i]=(OPQ[i]&&i!==B.LEAVES)?1:0;
const lq=new Int32Array(CS*CS*CH*5);
const tops=new Int16Array(256);
function bfs(L,b,qt){
  let qh=0;const q=lq,lim=q.length-8;
  while(qh<qt){const i=q[qh++];const v=L[i]-1;if(v<=0)continue;const x=i&15,z=(i>>4)&15,y=i>>8;
    if(qt>lim)break;
    if(x>0){const n=i-1;if(!LOPQ[b[n]]&&L[n]<v){L[n]=v;q[qt++]=n;}}
    if(x<15){const n=i+1;if(!LOPQ[b[n]]&&L[n]<v){L[n]=v;q[qt++]=n;}}
    if(z>0){const n=i-16;if(!LOPQ[b[n]]&&L[n]<v){L[n]=v;q[qt++]=n;}}
    if(z<15){const n=i+16;if(!LOPQ[b[n]]&&L[n]<v){L[n]=v;q[qt++]=n;}}
    if(y>0){const n=i-256;if(!LOPQ[b[n]]&&L[n]<v){L[n]=v;q[qt++]=n;}}
    if(y<CH-1){const n=i+256;if(!LOPQ[b[n]]&&L[n]<v){L[n]=v;q[qt++]=n;}}
  }
}
function seedEdges(c,which,qt){
  const b=c.blocks,L=which?c.sky:c.blk,q=lq;
  const dirs=[[-1,0],[1,0],[0,-1],[0,1]];
  for(let d=0;d<4;d++){const n=getChunk(c.cx+dirs[d][0],c.cz+dirs[d][1]);if(!n||!n.lightOK)continue;const NL=which?n.sky:n.blk;
    for(let y=0;y<CH;y++)for(let t=0;t<16;t++){
      let mx,mz,nx,nz;
      if(d===0){mx=0;mz=t;nx=15;nz=t;}else if(d===1){mx=15;mz=t;nx=0;nz=t;}else if(d===2){mx=t;mz=0;nx=t;nz=15;}else{mx=t;mz=15;nx=t;nz=0;}
      const mi=(y<<8)+(mz<<4)+mx;if(LOPQ[b[mi]])continue;const v=NL[(y<<8)+(nz<<4)+nx]-1;
      if(v>L[mi]){L[mi]=v;q[qt++]=mi;}
    }}
  return qt;
}
function computeLight(c){
  const b=c.blocks,S=c.sky,K=c.blk,q=lq;S.fill(0);K.fill(0);let qt=0;
  for(let z=0;z<16;z++)for(let x=0;x<16;x++){const col=(z<<4)+x;let y=CH-1,lv=15;while(y>=0){const bb=b[(y<<8)+col];if(LOPQ[bb])break;if(bb===B.LEAVES)lv=Math.max(1,lv-1);S[(y<<8)+col]=lv;if(lv<15)q[qt++]=(y<<8)+col;y--;}tops[col]=y;}
  
  for(let z=0;z<16;z++)for(let x=0;x<16;x++){const col=(z<<4)+x;let m=tops[col];
    if(x>0)m=Math.max(m,tops[col-1]);if(x<15)m=Math.max(m,tops[col+1]);if(z>0)m=Math.max(m,tops[col-16]);if(z<15)m=Math.max(m,tops[col+16]);
    for(let y=tops[col]+1;y<=m&&y<CH;y++)q[qt++]=(y<<8)+col;}
  qt=seedEdges(c,true,qt);bfs(S,b,qt);
  qt=0;
  for(let i=0;i<b.length;i++){if(b[i]===B.TORCH){K[i]=14;q[qt++]=i;}}
  qt=seedEdges(c,false,qt);bfs(K,b,qt);
  c.lightOK=true;
}
function ensureLight(c){
  if(c.lightOK)return;
  const dirs=[[-1,0],[1,0],[0,-1],[0,1]];
  for(const d of dirs){const n=getChunk(c.cx+d[0],c.cz+d[1]);if(n&&!n.lightOK)computeLight(n);}
  computeLight(c);
}

// ---------- メッシュ生成 ----------
const PW=18,PH=CH+2,PSY=PW*PW;
const PB=new Uint8Array(PW*PW*PH),PS=new Uint8Array(PW*PW*PH),PL=new Uint8Array(PW*PW*PH);
const pI=(x,y,z)=>(((y+1)*PW)+(z+1))*PW+(x+1);
const LUT=new Float32Array(31);for(let i=0;i<31;i++)LUT[i]=Math.pow(.8,15-i/2);
const brLight=a=>LUT[Math.round(a*2)];
const AOF=[.5,.7,.85,1];
// 面定義: 法線, 4頂点(x,y,z,u,v) 反時計回り, 影
const FACES=[
 {n:[1,0,0],a:0,sh:.66,c:[[1,0,0,1,0],[1,1,0,1,1],[1,1,1,0,1],[1,0,1,0,0]]},
 {n:[-1,0,0],a:0,sh:.66,c:[[0,0,1,1,0],[0,1,1,1,1],[0,1,0,0,1],[0,0,0,0,0]]},
 {n:[0,1,0],a:1,sh:1,c:[[0,1,1,0,0],[1,1,1,1,0],[1,1,0,1,1],[0,1,0,0,1]]},
 {n:[0,-1,0],a:1,sh:.5,c:[[0,0,0,0,0],[1,0,0,1,0],[1,0,1,1,1],[0,0,1,0,1]]},
 {n:[0,0,1],a:2,sh:.82,c:[[0,0,1,0,0],[1,0,1,1,0],[1,1,1,1,1],[0,1,1,0,1]]},
 {n:[0,0,-1],a:2,sh:.82,c:[[1,0,0,0,0],[0,0,0,1,0],[0,1,0,1,1],[1,1,0,0,1]]}
];
const STR=[1,PSY,PW];// x,y,z のパディング配列上の歩幅
FACES.forEach(F=>{F.off=F.n[0]*STR[0]+F.n[1]*STR[1]+F.n[2]*STR[2];const ax=[0,1,2].filter(a=>a!==F.a);F.t1=ax[0];F.t2=ax[1];F.s1=STR[ax[0]];F.s2=STR[ax[1]];});

function neighborsReady(c){
  for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)if((dx||dz)&&!getChunk(c.cx+dx,c.cz+dz))return false;
  return true;
}
function buildChunkMesh(c){
  ensureLight(c);
  const nb=[];for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)nb.push(getChunk(c.cx+dx,c.cz+dz));
  for(let pz=-1;pz<=16;pz++){const dz=pz<0?0:pz>15?2:1,lz=pz<0?15:pz>15?0:pz;
    for(let px=-1;px<=16;px++){const dx=px<0?0:px>15?2:1,lx=px<0?15:px>15?0:px;const n=nb[dz*3+dx];
      let pi=(pz+1)*PW+(px+1);
      PB[pi]=B.BEDROCK;PS[pi]=0;PL[pi]=0;pi+=PSY;
      if(!n){for(let y=0;y<CH;y++){PB[pi]=0;PS[pi]=15;PL[pi]=0;pi+=PSY;}}
      else{let si=(lz<<4)+lx;const nbk=n.blocks,ns=n.sky,nl=n.blk;for(let y=0;y<CH;y++){PB[pi]=nbk[si];PS[pi]=ns[si];PL[pi]=nl[si];pi+=PSY;si+=256;}}
      PB[pi]=0;PS[pi]=15;PL[pi]=0;
    }}
  const pos=[],uvs=[],als=[],idx=[];let vc=0;
  const wpos=[],wuv=[],wal=[],widx=[];let wvc=0;
  const quad=(P,UV,l0,l1,l2,flip)=>{// 汎用の四角形(植物・たいまつ)
    for(let k=0;k<4;k++){pos.push(P[k*3],P[k*3+1],P[k*3+2]);uvs.push(UV[k*2],UV[k*2+1]);als.push(l0,l1,l2);}
    idx.push(vc,vc+1,vc+2,vc,vc+2,vc+3);vc+=4;};
  for(let y=0;y<CH;y++)for(let z=0;z<16;z++)for(let x=0;x<16;x++){
    const p=pI(x,y,z),id=PB[p];if(id===0)continue;
    if(id===B.WATER){
      const up=PB[p+PSY];const topH=(up===B.WATER)?1:.875;
      for(let f=0;f<6;f++){const F=FACES[f];const q=p+F.off;const nid=PB[q];if(OPQ[nid]||nid===B.WATER)continue;
        if(f===3&&y===0)continue;
        const sky=brLight(PS[q]),bl=brLight(PL[q]);
        for(let k=0;k<4;k++){const cr=F.c[k];wpos.push(x+cr[0],y+(cr[1]?topH:0),z+cr[2]);wuv.push(cr[3],cr[4]);wal.push(sky,bl,F.sh);}
        widx.push(wvc,wvc+1,wvc+2,wvc,wvc+2,wvc+3);wvc+=4;
      }
      continue;
    }
    if(isPlant(id)){
      const t=BI[id]&&ITEMS[id].tile;const s=brLight(PS[p]),l=brLight(PL[p]);
      const a=tuv(t,0,0),bb=tuv(t,1,0),cc=tuv(t,1,1),dd=tuv(t,0,1);
      const UV=[a[0],a[1],bb[0],bb[1],cc[0],cc[1],dd[0],dd[1]];const UVr=[a[0],a[1],dd[0],dd[1],cc[0],cc[1],bb[0],bb[1]];
      const lo=.12,hi=.88;
      quad([x+lo,y,z+lo,x+hi,y,z+hi,x+hi,y+1,z+hi,x+lo,y+1,z+lo],UV,s,l,.95);
      quad([x+lo,y,z+lo,x+lo,y+1,z+lo,x+hi,y+1,z+hi,x+hi,y,z+hi],UVr,s,l,.95);
      quad([x+hi,y,z+lo,x+lo,y,z+hi,x+lo,y+1,z+hi,x+hi,y+1,z+lo],UV,s,l,.95);
      quad([x+hi,y,z+lo,x+hi,y+1,z+lo,x+lo,y+1,z+hi,x+lo,y,z+hi],UVr,s,l,.95);
      continue;
    }
    if(id===B.TORCH){
      const t=TILE.torch,s=brLight(PS[p]),x0=x+.4375,x1=x+.5625,z0=z+.4375,z1=z+.5625,h=y+.625;
      const sideUV=(ua,ub)=>{const A=tuv(t,ua,0),Bq=tuv(t,ub,0),C=tuv(t,ub,.625),D=tuv(t,ua,.625);return[A,Bq,C,D];};
      const mk=(P,ua,ub,sh)=>{const u=sideUV(ua,ub);quad(P,[u[0][0],u[0][1],u[1][0],u[1][1],u[2][0],u[2][1],u[3][0],u[3][1]],s,1,sh);};
      mk([x1,y,z0,x1,h,z0,x1,h,z1,x1,y,z1],.4375,.5625,.8);
      mk([x0,y,z1,x0,h,z1,x0,h,z0,x0,y,z0],.4375,.5625,.8);
      mk([x0,y,z1,x1,y,z1,x1,h,z1,x0,h,z1],.4375,.5625,.9);
      mk([x1,y,z0,x0,y,z0,x0,h,z0,x1,h,z0],.4375,.5625,.9);
      const T0=tuv(t,.4375,.625),T1=tuv(t,.5625,.625),T2=tuv(t,.5625,.5),T3=tuv(t,.4375,.5);
      quad([x0,h,z1,x1,h,z1,x1,h,z0,x0,h,z0],[T0[0],T0[1],T1[0],T1[1],T2[0],T2[1],T3[0],T3[1]],s,1,1);
      continue;
    }
    const tiles=BT[id];
    for(let f=0;f<6;f++){
      const F=FACES[f],q=p+F.off;if(OPQ[PB[q]])continue;if(f===3&&y===0)continue;
      const tile=tiles[f];
      const ao=[0,0,0,0],sk=[0,0,0,0],bk=[0,0,0,0];
      for(let k=0;k<4;k++){
        const cr=F.c[k];const g1=cr[F.t1]?1:-1,g2=cr[F.t2]?1:-1;
        const o1=q+g1*F.s1,o2=q+g2*F.s2,oc=o1+g2*F.s2;
        const s1=OPQ[PB[o1]],s2=OPQ[PB[o2]],sc=OPQ[PB[oc]];
        ao[k]=(s1&&s2)?0:3-(s1+s2+sc);
        let ss=PS[q],bb=PL[q],cn=1;
        if(!s1){ss+=PS[o1];bb+=PL[o1];cn++;}
        if(!s2){ss+=PS[o2];bb+=PL[o2];cn++;}
        if(!sc&&!(s1&&s2)){ss+=PS[oc];bb+=PL[oc];cn++;}
        sk[k]=brLight(ss/cn);bk[k]=brLight(bb/cn);
      }
      for(let k=0;k<4;k++){const cr=F.c[k];const uv=tuv(tile,cr[3],cr[4]);
        pos.push(x+cr[0],y+cr[1],z+cr[2]);uvs.push(uv[0],uv[1]);als.push(sk[k],bk[k],F.sh*AOF[ao[k]]);}
      if(ao[0]+ao[2]>ao[1]+ao[3])idx.push(vc+1,vc+2,vc+3,vc+1,vc+3,vc);else idx.push(vc,vc+1,vc+2,vc,vc+2,vc+3);
      vc+=4;
    }
  }
  const scene_=scene;
  const disposeMesh=m=>{if(m){scene_.remove(m);m.geometry.dispose();}};
  disposeMesh(c.mesh);disposeMesh(c.wmesh);c.mesh=c.wmesh=null;
  const bs=new THREE.Sphere(new THREE.Vector3(8,CH/2,8),38);
  const mk=(P,UV,A,IX,mat,ro)=>{const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(P),3));
    g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(UV),2));
    g.setAttribute('aL',new THREE.BufferAttribute(new Float32Array(A),3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(IX),1));g.boundingSphere=bs.clone();
    const m=new THREE.Mesh(g,mat);m.position.set(c.cx*CS,0,c.cz*CS);m.matrixAutoUpdate=false;m.updateMatrix();m.renderOrder=ro;scene_.add(m);return m;};
  if(idx.length)c.mesh=mk(pos,uvs,als,idx,solidMat,0);
  if(widx.length)c.wmesh=mk(wpos,wuv,wal,widx,waterMat,2);
  c.tris=(idx.length+widx.length)/3;c.needMesh=false;
}
function disposeChunk(c){
  [c.mesh,c.wmesh].forEach(m=>{if(m){scene.remove(m);m.geometry.dispose();}});
  chunks.delete(ckey(c.cx,c.cz));
}

// ---------- チャンクのストリーミング ----------
let RD=6;
let OFFS=[];
function buildOffsets(){OFFS=[];const R=RD+2;for(let dz=-R;dz<=R;dz++)for(let dx=-R;dx<=R;dx++){const d2=dx*dx+dz*dz;if(d2<=(RD+1.5)*(RD+1.5))OFFS.push({dx,dz,d2});}OFFS.sort((a,b)=>a.d2-b.d2);}
buildOffsets();
function streamChunks(px,pz,genMs,meshMs){
  const cx=Math.floor(px/CS),cz=Math.floor(pz/CS);
  let t0=performance.now();
  const rg=(RD+1.5)*(RD+1.5),rm=(RD+.5)*(RD+.5);
  for(let i=0;i<OFFS.length;i++){const o=OFFS[i];if(o.d2>rg)break;
    if(!getChunk(cx+o.dx,cz+o.dz)){genChunk(cx+o.dx,cz+o.dz);if(performance.now()-t0>genMs)break;}}
  t0=performance.now();
  for(let i=0;i<OFFS.length;i++){const o=OFFS[i];if(o.d2>rm)break;
    const c=getChunk(cx+o.dx,cz+o.dz);if(c&&c.needMesh&&neighborsReady(c)){buildChunkMesh(c);if(performance.now()-t0>meshMs)break;}}
}
function unloadFar(px,pz){
  const cx=Math.floor(px/CS),cz=Math.floor(pz/CS),R=RD+3;
  const del=[];chunks.forEach(c=>{if(Math.abs(c.cx-cx)>R||Math.abs(c.cz-cz)>R)del.push(c);});
  del.forEach(disposeChunk);
}
function flushSync(){
  needSync.forEach(c=>{if(chunks.get(ckey(c.cx,c.cz))===c&&neighborsReady(c))buildChunkMesh(c);});needSync.clear();
}
function loadAroundSync(px,pz,r){
  const cx=Math.floor(px/CS),cz=Math.floor(pz/CS);
  for(let dz=-r-1;dz<=r+1;dz++)for(let dx=-r-1;dx<=r+1;dx++)if(!getChunk(cx+dx,cz+dz))genChunk(cx+dx,cz+dz);
  for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++){const c=getChunk(cx+dx,cz+dz);if(c&&c.needMesh)buildChunkMesh(c);}
}
function clearWorld(){const all=[];chunks.forEach(c=>all.push(c));all.forEach(disposeChunk);mods.clear();needSync.clear();}

// ---------- レイキャスト (DDA) ----------
function raycast(ox,oy,oz,dx,dy,dz,maxD){
  let x=Math.floor(ox),y=Math.floor(oy),z=Math.floor(oz);
  const sx=dx>0?1:-1,sy=dy>0?1:-1,sz=dz>0?1:-1;
  const tdx=dx!==0?Math.abs(1/dx):1e30,tdy=dy!==0?Math.abs(1/dy):1e30,tdz=dz!==0?Math.abs(1/dz):1e30;
  let tmx=dx!==0?((dx>0?x+1-ox:ox-x)*tdx):1e30,tmy=dy!==0?((dy>0?y+1-oy:oy-y)*tdy):1e30,tmz=dz!==0?((dz>0?z+1-oz:oz-z)*tdz):1e30;
  let nx=0,ny=0,nz=0,t=0;
  for(let i=0;i<64;i++){
    const id=getBlock(x,y,z);
    if(id!==0&&id!==B.WATER){return{x,y,z,id,nx,ny,nz,dist:t};}
    if(tmx<tmy&&tmx<tmz){t=tmx;if(t>maxD)return null;x+=sx;tmx+=tdx;nx=-sx;ny=0;nz=0;}
    else if(tmy<tmz){t=tmy;if(t>maxD)return null;y+=sy;tmy+=tdy;nx=0;ny=-sy;nz=0;}
    else{t=tmz;if(t>maxD)return null;z+=sz;tmz+=tdz;nx=0;ny=0;nz=-sz;}
  }
  return null;
}

// ============================================================
//  空・太陽・月・星・雲
// ============================================================
const skyU={uTop:{value:new THREE.Color()},uHor:{value:new THREE.Color()},uGlow:{value:new THREE.Color()},uSun:{value:new THREE.Vector3(1,0,0)}};
const skyMesh=new THREE.Mesh(new THREE.SphereGeometry(450,24,16),new THREE.ShaderMaterial({uniforms:skyU,
  vertexShader:'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:'uniform vec3 uTop,uHor,uGlow,uSun;varying vec3 vP;void main(){vec3 d=normalize(vP);float h=clamp(d.y,0.0,1.0);vec3 c=mix(uHor,uTop,pow(h,0.55));float s=max(dot(d,uSun),0.0);c+=uGlow*(pow(s,5.0)*0.55+pow(s,48.0)*0.7);gl_FragColor=vec4(c,1.0);}',
  side:THREE.BackSide,depthWrite:false,depthTest:false,fog:false}));
skyMesh.renderOrder=-10;skyMesh.frustumCulled=false;scene.add(skyMesh);
function celestialTex(kind){
  const cv=document.createElement('canvas');cv.width=cv.height=16;const g=cv.getContext('2d');
  if(kind==='sun'){g.fillStyle='#ffd84a';g.fillRect(0,0,16,16);g.fillStyle='#fff3a0';g.fillRect(2,2,12,12);g.fillStyle='#ffffff';g.fillRect(4,4,8,8);}
  else{g.fillStyle='#cfd6e6';g.fillRect(0,0,16,16);g.fillStyle='#e8edf8';g.fillRect(1,1,14,14);g.fillStyle='#a9b2c8';[[3,3,3,3],[9,2,4,3],[5,9,4,4],[11,10,3,3],[2,11,2,2]].forEach(r=>g.fillRect(r[0],r[1],r[2],r[3]));}
  const t=new THREE.CanvasTexture(cv);t.magFilter=THREE.NearestFilter;t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;return t;
}
const sunMesh=new THREE.Mesh(new THREE.PlaneGeometry(64,64),new THREE.MeshBasicMaterial({map:celestialTex('sun'),fog:false,depthWrite:false}));
const moonMesh=new THREE.Mesh(new THREE.PlaneGeometry(52,52),new THREE.MeshBasicMaterial({map:celestialTex('moon'),fog:false,depthWrite:false}));
sunMesh.renderOrder=-9;moonMesh.renderOrder=-9;sunMesh.frustumCulled=false;moonMesh.frustumCulled=false;scene.add(sunMesh);scene.add(moonMesh);
const starGeo=new THREE.BufferGeometry();
{const arr=[];const R=mulberry32(5);for(let i=0;i<700;i++){const u=R()*2-1,a=R()*Math.PI*2,r=Math.sqrt(1-u*u);arr.push(r*Math.cos(a)*420,u*420,r*Math.sin(a)*420);}
 starGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(arr),3));}
const starMat=new THREE.PointsMaterial({size:2.4,sizeAttenuation:false,color:0xffffff,transparent:true,opacity:0,fog:false,depthWrite:false});
const stars=new THREE.Points(starGeo,starMat);stars.frustumCulled=false;stars.renderOrder=-9;scene.add(stars);
// 雲
const CLOUD_Y=78,CLOUD_W=1000,CLOUD_CELL=240;
const cloudTex=(function(){const cv=document.createElement('canvas');cv.width=cv.height=32;const g=cv.getContext('2d');const nz=makeNoise(31);
  for(let y=0;y<32;y++)for(let x=0;x<32;x++){const v=nz.n2(x*.16,y*.16)+nz.n2(x*.32+9,y*.32)*.5;if(v>.2){g.fillStyle='rgba(255,255,255,1)';g.fillRect(x,y,1,1);}}
  const t=new THREE.CanvasTexture(cv);t.magFilter=THREE.NearestFilter;t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(CLOUD_W/CLOUD_CELL,CLOUD_W/CLOUD_CELL);return t;})();
const cloudGeo=new THREE.PlaneGeometry(CLOUD_W,CLOUD_W,24,24);cloudGeo.rotateX(-Math.PI/2);
{const pa=cloudGeo.attributes.position,col=new Float32Array(pa.count*4);for(let i=0;i<pa.count;i++){const r=Math.hypot(pa.getX(i),pa.getZ(i))/(CLOUD_W/2);const a=clamp(1.15-r,0,1);col[i*4]=col[i*4+1]=col[i*4+2]=1;col[i*4+3]=Math.pow(a,1.2)*.9;}
 cloudGeo.setAttribute('color',new THREE.BufferAttribute(col,4));}
const cloudMat=new THREE.MeshBasicMaterial({map:cloudTex,vertexColors:true,transparent:true,depthWrite:false,fog:false,side:THREE.DoubleSide});
const cloudMesh=new THREE.Mesh(cloudGeo,cloudMat);cloudMesh.renderOrder=-5;cloudMesh.frustumCulled=false;scene.add(cloudMesh);

let timeOfDay=.3,dayCount=1,sunH=1,dayAmt=1;
const C_NT=new THREE.Color(.02,.03,.09),C_NH=new THREE.Color(.06,.08,.17),C_DT=new THREE.Color(.33,.55,.96),C_DH=new THREE.Color(.72,.84,.97),C_SS=new THREE.Color(1,.52,.26);
const tmpC=new THREE.Color(),tmpC2=new THREE.Color(),_sdir=new THREE.Vector3();
function updateSky(){
  const a=(timeOfDay-.25)*Math.PI*2;
  sunH=Math.sin(a);dayAmt=smooth(-.14,.2,sunH);
  const sdir=_sdir.set(Math.cos(a),Math.sin(a),.25).normalize();
  skyU.uSun.value.copy(sdir);
  tmpC.copy(C_NT).lerp(C_DT,dayAmt);skyU.uTop.value.copy(tmpC);
  tmpC2.copy(C_NH).lerp(C_DH,dayAmt);
  const ss=clamp(1-Math.abs(sunH)/.32,0,1)*(.25+.75*smooth(-.3,.1,sunH+.1));
  tmpC2.lerp(C_SS,ss*.62);skyU.uHor.value.copy(tmpC2);
  skyU.uGlow.value.copy(C_SS).multiplyScalar(ss*.9);
  const cp=camera.position;
  skyMesh.position.copy(cp);stars.position.copy(cp);
  sunMesh.position.copy(cp).addScaledVector(sdir,380);sunMesh.lookAt(cp);
  moonMesh.position.copy(cp).addScaledVector(sdir,-380);moonMesh.lookAt(cp);
  stars.rotation.z=a;starMat.opacity=clamp(1-dayAmt*1.6,0,1)*.9;
  U.uDay.value=.2+.8*dayAmt;
  U.uSkyTint.value.setRGB(lerp(.55,1,dayAmt)+ss*.0,lerp(.64,1,dayAmt)-ss*.08,lerp(1,1,dayAmt)-ss*.2);
  const under=player.headInWater&&state!=='menu';
  if(under){scene.fog.color.setRGB(.1,.25,.55).multiplyScalar(.35+.65*dayAmt);scene.fog.near=.5;scene.fog.far=24;}
  else{scene.fog.color.copy(tmpC2);scene.fog.near=Math.max(14,RD*16*.45);scene.fog.far=RD*16-6;}
  U.uFogColor.value.copy(scene.fog.color);U.uFogNear.value=scene.fog.near;U.uFogFar.value=scene.fog.far;
  renderer.setClearColor(scene.fog.color,1);
  const cl=.28+.72*dayAmt;cloudMat.color.setRGB(cl*(1-ss*.1),cl*(1-ss*.28),cl*(1-ss*.4));
  cloudMesh.position.set(cp.x,CLOUD_Y,cp.z);
  cloudTex.offset.set(cp.x/CLOUD_CELL+performance.now()*.000004,-cp.z/CLOUD_CELL);
}

// ============================================================
//  パーティクル
// ============================================================
const PMAX=320;
const pMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:0xffffff}),PMAX);
pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);pMesh.frustumCulled=false;pMesh.setColorAt(0,new THREE.Color(1,1,1));pMesh.count=0;scene.add(pMesh);
const parts=[];
const pM4=new THREE.Matrix4(),pQ=new THREE.Quaternion(),pS=new THREE.Vector3(),pP=new THREE.Vector3(),pCol=new THREE.Color();
function spawnParticle(x,y,z,vx,vy,vz,col,life,size,grav){
  if(parts.length>=PMAX)parts.shift();
  parts.push({x,y,z,vx,vy,vz,r:col[0],g:col[1],b:col[2],life,max:life,size,grav:grav===undefined?18:grav});
}
const pRnd=Math.random;
function blockBreakParticles(x,y,z,id,n){
  const tiles=BT[id]||[ITEMS[id]?ITEMS[id].tile:0];const f=.35+.65*Math.max(U.uDay.value,.3);
  for(let i=0;i<n;i++){const c=tilePixel(tiles[(pRnd()*tiles.length)|0],pRnd);
    spawnParticle(x+.15+pRnd()*.7,y+.15+pRnd()*.7,z+.15+pRnd()*.7,(pRnd()-.5)*4.2,pRnd()*3.5+.8,(pRnd()-.5)*4.2,[c[0]*f,c[1]*f,c[2]*f],.55+pRnd()*.55,.07+pRnd()*.07);}
}
function updateParticles(dt){
  let n=0;
  for(let i=parts.length-1;i>=0;i--){
    const p=parts[i];p.life-=dt;if(p.life<=0){parts.splice(i,1);continue;}
    p.vy-=p.grav*dt;
    let nx=p.x+p.vx*dt,ny=p.y+p.vy*dt,nz=p.z+p.vz*dt;
    if(solidAt(Math.floor(nx),Math.floor(p.y),Math.floor(p.z))){p.vx*=-.3;nx=p.x;}
    if(solidAt(Math.floor(p.x),Math.floor(p.y),Math.floor(nz))){p.vz*=-.3;nz=p.z;}
    if(solidAt(Math.floor(p.x),Math.floor(ny),Math.floor(p.z))){if(p.vy<0){p.vx*=.6;p.vz*=.6;}p.vy*=-.25;ny=p.y;}
    p.x=nx;p.y=ny;p.z=nz;
  }
  for(let i=0;i<parts.length&&i<PMAX;i++){const p=parts[i];const s=p.size*Math.min(1,p.life/(p.max*.4));
    pP.set(p.x,p.y,p.z);pS.set(s,s,s);pM4.compose(pP,pQ,pS);pMesh.setMatrixAt(i,pM4);pCol.setRGB(p.r,p.g,p.b);pMesh.setColorAt(i,pCol);n++;}
  pMesh.count=n;pMesh.instanceMatrix.needsUpdate=true;if(pMesh.instanceColor)pMesh.instanceColor.needsUpdate=true;
}

// ============================================================
//  アイテムのモデル（ブロック=立方体、道具=ドット絵を押し出し）
// ============================================================
const itemGeoCache={};
function cubeItemGeo(id){
  const pos=[],uvs=[],col=[],idx=[];let vc=0;const tiles=BT[id];
  FACES.forEach((F,f)=>{for(let k=0;k<4;k++){const c=F.c[k];pos.push(c[0]-.5,c[1]-.5,c[2]-.5);const uv=tuv(tiles[f],c[3],c[4]);uvs.push(uv[0],uv[1]);const s=F.sh;col.push(s,s,s);}
    idx.push(vc,vc+1,vc+2,vc,vc+2,vc+3);vc+=4;});
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setIndex(idx);return g;
}
function flatItemGeo(tile){
  const col=(tile%8)*16,row=((tile/8)|0)*16;const px=(x,y)=>{if(x<0||y<0||x>15||y>15)return null;const i=((row+y)*128+col+x)*4;return ATLAS_PIX[i+3]>128?[ATLAS_PIX[i]/255,ATLAS_PIX[i+1]/255,ATLAS_PIX[i+2]/255]:null;};
  const pos=[],cl=[],idx=[];let vc=0;const T=1/16;const z0=-T/2,z1=T/2;
  const add=(P,c,s)=>{for(let k=0;k<4;k++){pos.push(P[k*3],P[k*3+1],P[k*3+2]);cl.push(c[0]*s,c[1]*s,c[2]*s);}idx.push(vc,vc+1,vc+2,vc,vc+2,vc+3);vc+=4;};
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){const c=px(x,y);if(!c)continue;
    const x0=(x-8)/16,x1=x0+T,y1=(8-y)/16,y0=y1-T;
    add([x0,y0,z1,x1,y0,z1,x1,y1,z1,x0,y1,z1],c,1);
    add([x1,y0,z0,x0,y0,z0,x0,y1,z0,x1,y1,z0],c,.8);
    if(!px(x+1,y))add([x1,y0,z1,x1,y0,z0,x1,y1,z0,x1,y1,z1],c,.7);
    if(!px(x-1,y))add([x0,y0,z0,x0,y0,z1,x0,y1,z1,x0,y1,z0],c,.7);
    if(!px(x,y-1))add([x0,y1,z1,x1,y1,z1,x1,y1,z0,x0,y1,z0],c,.9);
    if(!px(x,y+1))add([x0,y0,z0,x1,y0,z0,x1,y0,z1,x0,y0,z1],c,.6);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(cl,3));g.setIndex(idx);return g;
}
function itemGeometry(id){if(itemGeoCache[id])return itemGeoCache[id];return itemGeoCache[id]=CUBE_IDS[id]?cubeItemGeo(id):flatItemGeo(ITEMS[id].tile);}
const dropBlockMat=new THREE.MeshBasicMaterial({map:atlasTex,vertexColors:true});
const dropFlatMat=new THREE.MeshBasicMaterial({vertexColors:true});
const handBlockMat=new THREE.MeshBasicMaterial({map:atlasTex,vertexColors:true});
const handFlatMat=new THREE.MeshBasicMaterial({vertexColors:true});
const handSkinMats=[.8,.7,1,.6,.9,.75].map(f=>{const m=new THREE.MeshBasicMaterial({color:0xc98a66});m.userData.f=f;return m;});
const handSleeveMat=new THREE.MeshBasicMaterial({color:0x3a8fa0});

// ============================================================
//  物理
// ============================================================
const GRAV=30;
function overlapsSolid(b){
  const p=b.position,hw=b.w/2;
  for(let y=Math.floor(p.y);y<=Math.floor(p.y+b.h-1e-6);y++)for(let z=Math.floor(p.z-hw);z<=Math.floor(p.z+hw-1e-6);z++)for(let x=Math.floor(p.x-hw);x<=Math.floor(p.x+hw-1e-6);x++)if(solidAt(x,y,z))return true;
  return false;
}
function moveAxis(b,ax,d){
  const p=b.position,v=b.velocity,hw=b.w/2,h=b.h;
  if(ax===0)p.x+=d;else if(ax===1)p.y+=d;else p.z+=d;
  const x0=Math.floor(p.x-hw),x1=Math.floor(p.x+hw-1e-6),y0=Math.floor(p.y),y1=Math.floor(p.y+h-1e-6),z0=Math.floor(p.z-hw),z1=Math.floor(p.z+hw-1e-6);
  for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
    if(!solidAt(x,y,z))continue;
    if(ax===0){if(d>0)p.x=Math.min(p.x,x-hw-1e-4);else p.x=Math.max(p.x,x+1+hw+1e-4);v.x=0;b.hitX=true;}
    else if(ax===2){if(d>0)p.z=Math.min(p.z,z-hw-1e-4);else p.z=Math.max(p.z,z+1+hw+1e-4);v.z=0;b.hitZ=true;}
    else{if(d>0){p.y=Math.min(p.y,y-h-1e-4);if(v.y>0)v.y=0;}else{p.y=Math.max(p.y,y+1+1e-4);if(v.y<0)v.y=0;b.onGround=true;}}
  }
}
function moveBody(b,dt){
  const p=b.position,v=b.velocity;
  b.hitX=b.hitZ=false;
  for(let k=0;k<8&&overlapsSolid(b);k++)p.y=Math.floor(p.y)+1+1e-3;
  v.y=Math.max(v.y,-55);
  const sp=Math.max(Math.abs(v.x),Math.abs(v.y),Math.abs(v.z));
  const steps=Math.max(1,Math.ceil(sp*dt/.25)),sdt=dt/steps;
  b.onGround=false;
  for(let s=0;s<steps;s++){moveAxis(b,0,v.x*sdt);moveAxis(b,2,v.z*sdt);moveAxis(b,1,v.y*sdt);}
  if(p.y<-20){p.y=CH+5;v.y=0;}
}
const bf=(x,y,z)=>getBlock(Math.floor(x),Math.floor(y),Math.floor(z));
function aabbHitsBlock(b,bx,by,bz){const p=b.position,hw=b.w/2;return p.x+hw>bx&&p.x-hw<bx+1&&p.z+hw>bz&&p.z-hw<bz+1&&p.y+b.h>by&&p.y<by+1;}

// ============================================================
//  プレイヤー
// ============================================================
const player={position:{x:0,y:40,z:0},velocity:{x:0,y:0,z:0},w:.6,h:1.8,yaw:0,pitch:0,health:20,hunger:20,onGround:false,inWater:false,headInWater:false,sprinting:false,dead:false,invuln:0,fallY:40,wasGround:false,air:10,exh:0,regenT:0,starveT:0,hitX:false,hitZ:false,walkPhase:0,stepDist:0,drownT:0};
const spawnPoint={x:8.5,y:40,z:8.5};
let state='menu';// menu / playing / paused / inventory / dead

// ============================================================
//  ゾンビ
// ============================================================
const zombies=[];
const ZS=1/16;
function texFromFn(w,h,fn){const cv=document.createElement('canvas');cv.width=w;cv.height=h;const g=cv.getContext('2d');fn(g);const t=new THREE.CanvasTexture(cv);t.magFilter=THREE.NearestFilter;t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;return t;}
const zr=mulberry32(77);
function noiseFill(g,w,h,base,a){for(let y=0;y<h;y++)for(let x=0;x<w;x++){const d=(zr()-.5)*a;g.fillStyle='rgb('+Math.max(0,Math.min(255,base[0]+d))+','+Math.max(0,Math.min(255,base[1]+d))+','+Math.max(0,Math.min(255,base[2]+d))+')';g.fillRect(x,y,1,1);}}
const ZTEX={
  skin:texFromFn(8,8,g=>noiseFill(g,8,8,[96,148,78],26)),
  shirt:texFromFn(8,8,g=>{noiseFill(g,8,8,[44,150,160],22);}),
  pants:texFromFn(8,8,g=>noiseFill(g,8,8,[52,56,140],20)),
  face:texFromFn(8,8,g=>{noiseFill(g,8,8,[96,148,78],22);g.fillStyle='#142a14';g.fillRect(1,3,2,1);g.fillRect(5,3,2,1);g.fillStyle='#d03020';g.fillRect(2,3,1,1);g.fillRect(5,3,1,1);g.fillStyle='#365a2a';g.fillRect(3,4,2,1);g.fillStyle='#1a1a12';g.fillRect(2,6,4,1);g.fillRect(1,5,1,1);g.fillRect(6,5,1,1);}),
  armskin:texFromFn(8,8,g=>noiseFill(g,8,8,[88,138,70],24))
};
function zMat(t){return new THREE.MeshBasicMaterial({map:t});}
function makeZombieModel(){
  const root=new THREE.Group();const mats=[];
  const M=t=>{const m=zMat(t);mats.push(m);return m;};
  const mSkin=M(ZTEX.skin),mFace=M(ZTEX.face),mShirt=M(ZTEX.shirt),mPants=M(ZTEX.pants),mArm=M(ZTEX.armskin),mSleeve=M(ZTEX.shirt);
  const box=(w,h,d,mat,x,y,z)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w*ZS,h*ZS,d*ZS),mat);m.position.set(x*ZS,y*ZS,z*ZS);return m;};
  const head=new THREE.Group();head.position.set(0,24*ZS,0);head.add(box(8,8,8,[mSkin,mSkin,mSkin,mSkin,mFace,mSkin],0,4,0));root.add(head);
  root.add(box(8,12,4,mShirt,0,18,0));
  const mkLimb=(x,y,mat,m2)=>{const gp=new THREE.Group();gp.position.set(x*ZS,y*ZS,0);gp.add(box(4,12,4,mat,0,-6,0));return gp;};
  const armL=mkLimb(-6,22,mArm),armR=mkLimb(6,22,mArm);root.add(armL);root.add(armR);
  const legL=mkLimb(-2,12,mPants),legR=mkLimb(2,12,mPants);root.add(legL);root.add(legR);
  root.userData={head,armL,armR,legL,legR,mats};
  return root;
}
function spawnZombieAt(x,y,z,persist){
  const model=makeZombieModel();scene.add(model);
  const zb={position:{x,y,z},velocity:{x:0,y:0,z:0},w:.6,h:1.95,onGround:false,hitX:false,hitZ:false,model,hp:20,yaw:Math.random()*6.28,anim:0,hurtT:0,dead:false,deadT:0,atkCD:1,moanT:2+Math.random()*4,persist:!!persist,wander:0,wanderYaw:0,burnT:0,kbT:0,inWater:false};
  zombies.push(zb);return zb;
}
function removeZombie(z){scene.remove(z.model);z.model.userData.mats.forEach(m=>m.dispose());z.model.traverse(o=>{if(o.geometry)o.geometry.dispose();});const i=zombies.indexOf(z);if(i>=0)zombies.splice(i,1);}
function groundYAt(x,z,fromY){
  const ix=Math.floor(x),iz=Math.floor(z);
  for(let y=Math.min(CH-2,Math.floor(fromY));y>0;y--){const id=getBlock(ix,y,iz);if(SOLID[id])return id!==B.LEAVES&&(getBlock(ix,y+1,iz)===0||isPlant(getBlock(ix,y+1,iz)))&&!SOLID[getBlock(ix,y+2,iz)]?y+1:-1;if(id===B.WATER)return-1;}
  return-1;
}

// ============================================================
//  どうぶつ（ぶた）
// ============================================================
const animals=[];
const PTEX={
  body:texFromFn(8,8,g=>noiseFill(g,8,8,[236,150,160],18)),
  face:texFromFn(8,8,g=>{noiseFill(g,8,8,[236,150,160],14);g.fillStyle='#2a1418';g.fillRect(1,2,1,2);g.fillRect(6,2,1,2);g.fillStyle='#f6b4bc';g.fillRect(2,4,4,3);g.fillStyle='#b86a74';g.fillRect(3,5,1,1);g.fillRect(4,5,1,1);}),
  leg:texFromFn(8,8,g=>noiseFill(g,8,8,[216,130,142],16))
};
function makePigModel(){
  const root=new THREE.Group();const mats=[];const M=t=>{const m=zMat(t);mats.push(m);return m;};
  const mB=M(PTEX.body),mF=M(PTEX.face),mL=M(PTEX.leg);
  const box=(w,h,d,mat,x,y,z)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w*ZS,h*ZS,d*ZS),mat);m.position.set(x*ZS,y*ZS,z*ZS);return m;};
  root.add(box(10,8,16,mB,0,10,0));
  const head=new THREE.Group();head.position.set(0,11*ZS,8*ZS);head.add(box(8,8,8,[mB,mB,mB,mB,mF,mB],0,0,4));root.add(head);
  const legs=[];[[-3,-5],[3,-5],[-3,5],[3,5]].forEach(p=>{const g=new THREE.Group();g.position.set(p[0]*ZS,6*ZS,p[1]*ZS);g.add(box(4,6,4,mL,0,-3,0));root.add(g);legs.push(g);});
  root.userData={head,legs,mats};return root;
}
function spawnPigAt(x,y,z){
  const model=makePigModel();scene.add(model);
  const a={type:'pig',label:'ぶた',position:{x,y,z},velocity:{x:0,y:0,z:0},w:.8,h:.9,onGround:false,hitX:false,hitZ:false,model,hp:10,yaw:Math.random()*6.28,anim:0,hurtT:0,kbT:0,fleeT:0,wander:0,moving:false,wanderYaw:0,dead:false,deadT:0,oinkT:3+Math.random()*8,inWater:false};
  animals.push(a);return a;
}
function removeAnimal(a){scene.remove(a.model);a.model.userData.mats.forEach(m=>m.dispose());a.model.traverse(o=>{if(o.geometry)o.geometry.dispose();});const i=animals.indexOf(a);if(i>=0)animals.splice(i,1);}

// ============================================================
//  設定・インベントリ・目標
// ============================================================
const SAVE_KEY='voxelcraft_save_v1',SET_KEY='voxelcraft_settings_v1';
const settings={mute:false,rd:6,sens:5};
try{const s=JSON.parse(localStorage.getItem(SET_KEY)||'null');if(s){settings.mute=!!s.mute;settings.rd=[4,6,8].includes(s.rd)?s.rd:6;settings.sens=clamp(+s.sens||5,1,10);}}catch(e){}
function saveSettings(){try{localStorage.setItem(SET_KEY,JSON.stringify(settings));}catch(e){}}
RD=settings.rd;buildOffsets();Sfx.setMuted(settings.mute);

const inv=new Array(36).fill(null);let sel=0;
const flags={};const stats={kills:0};
let invDirty=true;
const markInv=()=>{invDirty=true;};
function canAdd(id,n){const it=ITEMS[id];if(it.tool)return inv.some(s=>!s);let room=0;for(let i=0;i<36;i++){const s=inv[i];if(!s)room+=it.max;else if(s.id===id)room+=it.max-s.n;}return room>=n;}
function addItem(id,n,d){
  const it=ITEMS[id];
  if(it.tool){for(;n>0;n--){const e=inv.findIndex(s=>!s);if(e<0)return n;inv[e]={id,n:1,d:d!==undefined?d:it.tool.dur};}markInv();return 0;}
  for(let i=0;i<36&&n>0;i++){const s=inv[i];if(s&&s.id===id&&s.n<it.max){const a=Math.min(n,it.max-s.n);s.n+=a;n-=a;}}
  for(let i=0;i<36&&n>0;i++){if(!inv[i]){const a=Math.min(n,it.max);inv[i]={id,n:a};n-=a;}}
  markInv();return n;
}
function countItem(id){let c=0;for(const s of inv)if(s&&s.id===id)c+=s.n;return c;}
function removeItems(id,n){for(let i=0;i<36&&n>0;i++){const s=inv[i];if(s&&s.id===id){const a=Math.min(n,s.n);s.n-=a;n-=a;if(s.n<=0)inv[i]=null;}}markInv();}
function flag(name){if(!flags[name]){flags[name]=1;if(OBJ.some(o=>o.f===name))toast('もくひょう達成！');}}
const OBJ=[
 {f:'log',t:'左クリックを長押しして、木（丸太）をこわして集めよう'},
 {f:'planks',t:'Eキーで画面を開いて、丸太を「板材」にクラフトしよう'},
 {f:'table',t:'板材4つで「作業台」を作ろう'},
 {f:'wpick',t:'作業台を地面に置いて（右クリック）、そのそばで「木のツルハシ」を作ろう（板材と棒）'},
 {f:'cobble',t:'ツルハシで石をこわして「丸石」を集めよう'},
 {f:'spick',t:'丸石と棒で「石のツルハシ」を作ろう'},
 {f:'sword',t:'「剣」を作って、夜のゾンビにそなえよう'},
 {f:'kill',t:'夜に出てくるゾンビをたおそう（青い服の緑の敵）'},
 {f:'ironingot',t:'鉄鉱石（オレンジの点）を掘って、石炭と作業台で「鉄インゴット」にしよう'},
 {f:'ipick',t:'鉄のツルハシを作ろう'}
];
function currentObjective(){for(const o of OBJ)if(!flags[o.f])return o.t;return'ぜんぶ達成！ 自由に冒険・建築しよう';}

// ============================================================
//  UI 部品
// ============================================================
const ICON_H={f:heartIcon('f'),h:heartIcon('h'),e:heartIcon('e')},ICON_F={f:hungerIcon('f'),h:hungerIcon('h'),e:hungerIcon('e')},ICON_B=bubbleIcon();
const heartsEl=$('hearts'),hungerEl=$('hunger'),airEl=$('air'),hotbarEl=$('hotbar');
const heartEls=[],hungerEls=[],airEls=[],slotEls=[];
for(let i=0;i<10;i++){const a=document.createElement('div');a.className='ic';heartsEl.appendChild(a);heartEls.push(a);const b=document.createElement('div');b.className='ic';hungerEl.appendChild(b);hungerEls.push(b);const c=document.createElement('div');c.className='ic';c.style.backgroundImage='url('+ICON_B+')';airEl.appendChild(c);airEls.push(c);}
for(let i=0;i<9;i++){const d=document.createElement('div');d.className='slot';d.innerHTML='<span class="num">'+(i+1)+'</span><img class="px" alt=""><span class="cnt"></span><div class="dur"><i></i></div>';hotbarEl.appendChild(d);slotEls.push(d);}
function fillSlot(el,s){
  const img=el.querySelector('img'),cnt=el.querySelector('.cnt'),dur=el.querySelector('.dur');
  if(!s){img.style.visibility='hidden';cnt.textContent='';dur.style.display='none';return;}
  const it=ITEMS[s.id];img.style.visibility='visible';const u=itemIcon(s.id);if(img.getAttribute('src')!==u)img.src=u;
  cnt.textContent=s.n>1?s.n:'';
  if(it.tool){dur.style.display='block';const f=clamp(s.d/it.tool.dur,0,1);const i=dur.firstChild;i.style.width=(f*100)+'%';i.style.background=f>.5?'#6fe04a':f>.2?'#e0c030':'#e04a30';}else dur.style.display='none';
}
let lastHP=-1,lastHunger=-1,lastAir=-1,nameT=0;
function refreshHotbar(){for(let i=0;i<9;i++){fillSlot(slotEls[i],inv[i]);slotEls[i].classList.toggle('sel',i===sel);}}
function updateBars(){
  const hp=Math.ceil(player.health),hu=Math.ceil(player.hunger);
  if(hp!==lastHP){lastHP=hp;for(let i=0;i<10;i++){const k=hp>=2*i+2?'f':hp===2*i+1?'h':'e';heartEls[i].style.backgroundImage='url('+ICON_H[k]+')';}}
  heartEls.forEach(e=>e.classList.toggle('shake',player.health<=6&&state==='playing'));
  if(hu!==lastHunger){lastHunger=hu;for(let i=0;i<10;i++){const k=hu>=2*i+2?'f':hu===2*i+1?'h':'e';hungerEls[i].style.backgroundImage='url('+ICON_F[k]+')';}}
  const showAir=player.air<9.95;const an=Math.ceil(player.air);
  if(showAir){if(an!==lastAir){lastAir=an;airEls.forEach((e,i)=>e.style.visibility=i<an?'visible':'hidden');}airEl.style.visibility='visible';}else airEl.style.visibility='hidden';
}
let toastLast='',toastLastT=0;
function toast(text,bad){
  const now=performance.now();if(text===toastLast&&now-toastLastT<900)return;toastLast=text;toastLastT=now;
  const c=$('toasts'),d=document.createElement('div');d.className='toast'+(bad?' bad':'');d.textContent=text;c.appendChild(d);
  while(c.children.length>4)c.removeChild(c.firstChild);setTimeout(()=>{if(d.parentNode)d.parentNode.removeChild(d);},3300);
}
function showItemName(){const s=inv[sel];const el=$('itemname');if(!s){el.style.opacity=0;return;}el.textContent=ITEMS[s.id].name;el.style.opacity=1;nameT=1.8;}
function selectSlot(i){sel=(i+9)%9;refreshHotbar();showItemName();}

// ---------- クラフト・持ち物画面 ----------
let invTable=false,cursorItem=null;
const invGrid=$('invgrid'),invSlotEls=[];
(function(){
  const order=[];for(let r=0;r<3;r++)for(let c=0;c<9;c++)order.push(9+r*9+c);order.push('gap');for(let c=0;c<9;c++)order.push(c);
  order.forEach(o=>{if(o==='gap'){const g=document.createElement('div');g.className='gap';invGrid.appendChild(g);return;}
    const d=document.createElement('div');d.className='slot';d.innerHTML='<img class="px" alt=""><span class="cnt"></span><div class="dur"><i></i></div>';
    d.dataset.i=o;invSlotEls[o]=d;invGrid.appendChild(d);
    d.addEventListener('mousedown',e=>{e.preventDefault();invClick(o,e.button,e.shiftKey);});
    d.addEventListener('contextmenu',e=>e.preventDefault());
    d.addEventListener('mouseenter',e=>{hoverSlot=o;showTip(e);});d.addEventListener('mouseleave',()=>{hoverSlot=-1;$('tip').style.display='none';});
  });
})();
let hoverSlot=-1;
function showTip(e){const s=inv[hoverSlot];const t=$('tip');if(!s||cursorItem){t.style.display='none';return;}
  let txt=ITEMS[s.id].name;if(ITEMS[s.id].tool)txt+='（耐久 '+s.d+'/'+ITEMS[s.id].tool.dur+'）';
  t.textContent=txt;t.style.display='block';t.style.left=(e.clientX+14)+'px';t.style.top=(e.clientY+14)+'px';}
function invClick(i,btn,shift){
  Sfx.init();Sfx.resume();
  let s=inv[i];
  if(shift&&s&&!cursorItem){const from=i<9?0:9,to=i<9?9:0,len=27;const moved=s;inv[i]=null;
    // 同じ種類に重ねる→空きへ
    let rest=moved.n;const it=ITEMS[moved.id];
    if(!it.tool){for(let k=0;k<(i<9?27:9)&&rest>0;k++){const j=to+k;const t=inv[j];if(t&&t.id===moved.id&&t.n<it.max){const a=Math.min(rest,it.max-t.n);t.n+=a;rest-=a;}}}
    for(let k=0;k<(i<9?27:9)&&rest>0;k++){const j=to+k;if(!inv[j]){inv[j]={id:moved.id,n:rest,d:moved.d};rest=0;}}
    if(rest>0){moved.n=rest;inv[i]=moved;}
    Sfx.play('click');markInv();return;}
  if(btn===0){
    if(!cursorItem){cursorItem=s;inv[i]=null;}
    else if(!s){inv[i]=cursorItem;cursorItem=null;}
    else if(s.id===cursorItem.id&&ITEMS[s.id].max>1){const a=Math.min(cursorItem.n,ITEMS[s.id].max-s.n);s.n+=a;cursorItem.n-=a;if(cursorItem.n<=0)cursorItem=null;}
    else{inv[i]=cursorItem;cursorItem=s;}
  }else if(btn===2){
    if(!cursorItem&&s){const h=Math.ceil(s.n/2);cursorItem={id:s.id,n:h,d:s.d};s.n-=h;if(s.n<=0)inv[i]=null;}
    else if(cursorItem){const mx=ITEMS[cursorItem.id].max;
      if(!s){inv[i]={id:cursorItem.id,n:1,d:cursorItem.d};cursorItem.n--;}
      else if(s.id===cursorItem.id&&s.n<mx){s.n++;cursorItem.n--;}
      if(cursorItem&&cursorItem.n<=0)cursorItem=null;}
  }
  Sfx.play('click');markInv();
}
function nearTable(){const p=player.position;const cx=Math.floor(p.x),cy=Math.floor(p.y),cz=Math.floor(p.z);
  for(let y=cy-2;y<=cy+3;y++)for(let z=cz-4;z<=cz+4;z++)for(let x=cx-4;x<=cx+4;x++)if(getBlock(x,y,z)===B.TABLE)return true;return false;}
function craft(r){
  if(r.table&&!invTable){toast('作業台のそばでクラフトできます',true);return false;}
  if(!r.ing.every(a=>countItem(a[0])>=a[1]))return false;
  const it=ITEMS[r.out];if(!it.tool&&!canAdd(r.out,r.n)){toast('持ち物がいっぱいです',true);return false;}
  if(it.tool&&!canAdd(r.out,1)){toast('持ち物がいっぱいです',true);return false;}
  r.ing.forEach(a=>removeItems(a[0],a[1]));addItem(r.out,r.n);
  Sfx.play('craft');toast('作った: '+it.name+(r.n>1?' ×'+r.n:''));
  if(r.out===B.PLANKS)flag('planks');if(r.out===B.TABLE)flag('table');if(r.out===I.WPICK)flag('wpick');if(r.out===I.SPICK)flag('spick');
  if(r.out===I.WSWORD||r.out===I.SSWORD||r.out===I.ISWORD)flag('sword');if(r.out===I.IRON)flag('ironingot');if(r.out===I.IPICK)flag('ipick');
  return true;
}
function renderInv(){
  for(let i=0;i<36;i++){fillSlot(invSlotEls[i],inv[i]);invSlotEls[i].classList.toggle('sel',i===sel);}
  const cur=$('cursor');if(cursorItem){cur.style.display='block';cur.querySelector('img').src=itemIcon(cursorItem.id);cur.querySelector('span').textContent=cursorItem.n>1?cursorItem.n:'';}else cur.style.display='none';
  $('craftTitle').textContent=invTable?'クラフト（作業台）':'クラフト（作業台なし）';
  const list=$('craftlist');list.innerHTML='';
  const rows=RECIPES.map((r,i)=>{const have=r.ing.every(a=>countItem(a[0])>=a[1]);return{r,i,ok:have&&(!r.table||invTable),have};});
  rows.sort((a,b)=>(b.ok-a.ok)||(a.i-b.i));
  rows.forEach(o=>{const r=o.r,it=ITEMS[r.out];const d=document.createElement('div');d.className='rec'+(o.ok?' ok':'')+((r.table&&!invTable)?' lock':'');
    const ing=r.ing.map(a=>{const c=countItem(a[0]);return(c>=a[1]?'<b>':'<u>')+ITEMS[a[0]].name+' '+Math.min(c,99)+'/'+a[1]+(c>=a[1]?'</b>':'</u>');}).join('　');
    d.innerHTML='<img class="px" src="'+itemIcon(r.out)+'" alt=""><div><div class="rn">'+it.name+(r.n>1?' ×'+r.n:'')+'</div><div class="ri">'+ing+'</div>'+(r.table?'<div class="tb">'+(invTable?'':'作業台のそばが必要')+(r.note?(invTable?'':'・')+r.note:'')+'</div>':'')+'</div>';
    d.addEventListener('mousedown',e=>{e.preventDefault();Sfx.init();craft(r);markInv();});
    list.appendChild(d);});
}

// ============================================================
//  アイテム(落ちているもの)
// ============================================================
const drops=[];
function spawnDrop(id,n,x,y,z,vx,vy,vz,d){
  const cube=!!CUBE_IDS[id];const mesh=new THREE.Mesh(itemGeometry(id),cube?dropBlockMat:dropFlatMat);const s=cube?.26:.5;mesh.scale.setScalar(s);scene.add(mesh);
  drops.push({id,n,d,x,y,z,vx:vx||0,vy:vy===undefined?3:vy,vz:vz||0,age:0,mesh,hs:s*.5});
  if(drops.length>110)removeDrop(drops[0]);
}
function removeDrop(dr){scene.remove(dr.mesh);const i=drops.indexOf(dr);if(i>=0)drops.splice(i,1);}
function updateDrops(dt){
  const p=player.position;
  for(let i=drops.length-1;i>=0;i--){const d=drops[i];d.age+=dt;
    if(d.age>300){removeDrop(d);continue;}
    const dx=p.x-d.x,dy=(p.y+.8)-d.y,dz=p.z-d.z,dist=Math.hypot(dx,dy,dz);
    if(!player.dead&&d.age>.55&&dist<2.8&&canAdd(d.id,d.n)){
      if(dist<.75){const left=addItem(d.id,d.n,d.d);if(left<=0){Sfx.play('pickup');onPickup(d.id);removeDrop(d);continue;}d.n=left;}
      else{const sp=8;d.vx=dx/dist*sp;d.vy=dy/dist*sp;d.vz=dz/dist*sp;d.x+=d.vx*dt;d.y+=d.vy*dt;d.z+=d.vz*dt;
        d.mesh.position.set(d.x,d.y,d.z);d.mesh.rotation.y+=dt*3;continue;}
    }
    const wet=getBlock(Math.floor(d.x),Math.floor(d.y),Math.floor(d.z))===B.WATER;
    d.vy-=(wet?5:22)*dt;if(wet){d.vy*=1-Math.min(1,3*dt);d.vx*=1-Math.min(1,3*dt);d.vz*=1-Math.min(1,3*dt);}
    let nx=d.x+d.vx*dt,ny=d.y+d.vy*dt,nz=d.z+d.vz*dt;
    if(solidAt(Math.floor(nx),Math.floor(d.y),Math.floor(d.z))){d.vx*=-.3;nx=d.x;}
    if(solidAt(Math.floor(d.x),Math.floor(d.y),Math.floor(nz))){d.vz*=-.3;nz=d.z;}
    if(d.vy<=0&&solidAt(Math.floor(nx),Math.floor(ny-d.hs),Math.floor(nz))){ny=Math.floor(ny-d.hs)+1+d.hs;d.vy=0;const f=Math.pow(.02,dt);d.vx*=f;d.vz*=f;}
    else if(solidAt(Math.floor(nx),Math.floor(ny),Math.floor(nz))){ny+=dt*6;d.vy=0;}
    d.x=nx;d.y=ny;d.z=nz;
    if(d.y<-10){removeDrop(d);continue;}
    d.mesh.position.set(d.x,d.y+.12+Math.sin(d.age*3)*.03,d.z);d.mesh.rotation.y=d.age*1.6;
  }
}
function onPickup(id){
  if(id===B.LOG)flag('log');if(id===B.COBBLE)flag('cobble');
  if(selectedEmpty()||true){invDirty=true;}
}
function selectedEmpty(){return!inv[sel];}

// ============================================================
//  ブロックを壊す・置く
// ============================================================
const mouse={l:false,r:false,lP:false,rP:false};
const keys={},tapKeys={};
let hit=null,zHit=null,attackCD=0,placeCD=0,hurtFlash=0,swingT=0,swingLoop=false,equipDip=0,eatCD=0;
const mine={key:'',prog:0,sndT:0,partT:0};
const crackTex=new THREE.CanvasTexture(makeCrackCanvas());crackTex.magFilter=THREE.NearestFilter;crackTex.minFilter=THREE.NearestFilter;crackTex.generateMipmaps=false;crackTex.repeat.set(.1,1);
const crackMesh=new THREE.Mesh(new THREE.BoxGeometry(1.006,1.006,1.006),new THREE.MeshBasicMaterial({map:crackTex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
crackMesh.visible=false;crackMesh.renderOrder=3;scene.add(crackMesh);
const selGroup=new THREE.Group();
selGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004,1.004,1.004)),new THREE.LineBasicMaterial({color:0x000000,transparent:true,opacity:.85})));
selGroup.add(new THREE.Mesh(new THREE.BoxGeometry(1.003,1.003,1.003),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.1,depthWrite:false})));
selGroup.visible=false;selGroup.renderOrder=4;scene.add(selGroup);

function heldTool(){const s=inv[sel];return s&&ITEMS[s.id].tool?ITEMS[s.id].tool:null;}
function breakInfo(id){
  const bi=BI[id];if(!bi||bi.hard<0)return{t:Infinity,harvest:false};
  const tool=heldTool();let mult=1,harvest=true;
  if(bi.tool){if(tool&&tool.type===bi.tool){if(tool.tier>=bi.tier)mult=tool.mult;else harvest=false;}else if(bi.tier>0)harvest=false;}
  else if(tool&&tool.type==='sword'&&id===B.LEAVES)mult=3;
  if(!harvest)return{t:Math.max(.05,bi.hard*5),harvest:false};
  return{t:Math.max(.04,bi.hard*1.5/mult),harvest:true};
}
function damageHeld(n){
  const s=inv[sel];if(!s)return;const it=ITEMS[s.id];if(!it.tool)return;s.d-=n;
  if(s.d<=0){inv[sel]=null;Sfx.play('tool');toast(it.name+'がこわれた！',true);}markInv();
}
function addExhaust(a){player.exh+=a;}
function breakBlockAt(x,y,z){
  const id=getBlock(x,y,z);if(!id||id===B.WATER||id===B.BEDROCK)return;
  const bi=BI[id],info=breakInfo(id);
  let fill=0;if(getBlock(x,y+1,z)===B.WATER||getBlock(x+1,y,z)===B.WATER||getBlock(x-1,y,z)===B.WATER||getBlock(x,y,z+1)===B.WATER||getBlock(x,y,z-1)===B.WATER)fill=B.WATER;
  setBlock(x,y,z,fill);
  const above=getBlock(x,y+1,z);if(isPlant(above)){setBlock(x,y+1,z,0);if(above!==B.TALLGRASS)spawnDrop(above,1,x+.5,y+1.5,z+.5);}
  if(info.harvest){
    let dropId=bi.drop;
    if(id===B.LEAVES){const r=Math.random();dropId=r<.075?I.APPLE:r<.19?I.STICK:0;}
    if(dropId)spawnDrop(dropId,1,x+.5,y+.5,z+.5,(Math.random()-.5)*2,3,(Math.random()-.5)*2);
  }
  blockBreakParticles(x,y,z,id,14);
  Sfx.play('brk',bi.snd);
  if(bi.hard>.1)damageHeld(1);
  addExhaust(.03);
}
function playerOverlapsCell(x,y,z){return aabbHitsBlock(player,x,y,z);}
function tryPlace(){
  if(!hit)return false;const s=inv[sel];if(!s)return false;const it=ITEMS[s.id];if(!it.block||s.id===B.WATER)return false;
  let px=hit.x+hit.nx,py=hit.y+hit.ny,pz=hit.z+hit.nz;
  if(isPlant(hit.id)){px=hit.x;py=hit.y;pz=hit.z;}
  if(py<0||py>=CH)return false;
  if(!isReplaceable(getBlock(px,py,pz)))return false;
  if(SOLID[s.id]){if(playerOverlapsCell(px,py,pz))return false;for(const z of zombies.concat(animals)){if(!z.dead&&aabbHitsBlock(z,px,py,pz))return false;}}
  if(isPlant(s.id)||s.id===B.TORCH){}
  if(!setBlock(px,py,pz,s.id))return false;
  s.n--;if(s.n<=0)inv[sel]=null;markInv();
  Sfx.play('place',BI[s.id].snd);swingT=.0001;swingLoop=false;
  return true;
}
function tryEat(){
  const s=inv[sel];if(!s)return false;const it=ITEMS[s.id];if(!it.food)return false;
  if(player.hunger>=20){return false;}
  player.hunger=Math.min(20,player.hunger+it.food);s.n--;if(s.n<=0)inv[sel]=null;markInv();Sfx.play('eat');eatCD=.5;return true;
}
function rightClick(){
  if(state!=='playing')return;
  if(hit&&hit.id===B.TABLE){openInventory(true);return;}
  if(tryEat())return;
  tryPlace();
}
function targetZombie(maxD){
  const ox=player.position.x,oy=player.position.y+1.62,oz=player.position.z;
  const cp=Math.cos(player.pitch),dx=-Math.sin(player.yaw)*cp,dy=Math.sin(player.pitch),dz=-Math.cos(player.yaw)*cp;
  let best=null;
  for(const z of zombies.concat(animals)){if(z.dead)continue;const hw=z.w*.58,p=z.position;
    let t0=0,t1=maxD;const lo=[p.x-hw,p.y,p.z-hw],hi=[p.x+hw,p.y+z.h,p.z+hw],o=[ox,oy,oz],d=[dx,dy,dz];let ok=true;
    for(let k=0;k<3;k++){if(Math.abs(d[k])<1e-9){if(o[k]<lo[k]||o[k]>hi[k]){ok=false;break;}}else{let a=(lo[k]-o[k])/d[k],b=(hi[k]-o[k])/d[k];if(a>b){const t=a;a=b;b=t;}t0=Math.max(t0,a);t1=Math.min(t1,b);if(t0>t1){ok=false;break;}}}
    if(ok&&(!best||t0<best.dist))best={z,dist:t0};}
  return best;
}
function attackZombie(z){
  const tool=heldTool();const dmg=tool?tool.dmg:2;
  const dx=z.position.x-player.position.x,dz=z.position.z-player.position.z,l=Math.hypot(dx,dz)||1;
  if(z.type==='pig')hurtAnimal(z,dmg,dx/l,dz/l);else hurtZombie(z,dmg,dx/l,dz/l);
  if(tool)damageHeld(1);
  swingT=.0001;swingLoop=false;addExhaust(.02);
}
function hurtZombie(z,dmg,kx,kz){
  if(z.dead)return;z.hp-=dmg;z.hurtT=.35;z.kbT=.3;z.velocity.x=kx*7;z.velocity.z=kz*7;z.velocity.y=Math.max(z.velocity.y,5);
  const d=Math.hypot(z.position.x-player.position.x,z.position.z-player.position.z);
  Sfx.play('hit');Sfx.play('zhurt',clamp(1-d/30,.2,1));
  for(let i=0;i<8;i++)spawnParticle(z.position.x,z.position.y+1.1,z.position.z,(Math.random()-.5)*4,Math.random()*3+1,(Math.random()-.5)*4,[.55,.08,.08],.5,.08);
  if(z.hp<=0)killZombie(z,true);
}
function hurtAnimal(a,dmg,kx,kz){
  if(a.dead)return;a.hp-=dmg;a.hurtT=.35;a.kbT=.25;a.fleeT=4;a.velocity.x=kx*6;a.velocity.z=kz*6;a.velocity.y=Math.max(a.velocity.y,4.5);
  Sfx.play('hit');Sfx.play('pig',1);
  for(let i=0;i<6;i++)spawnParticle(a.position.x,a.position.y+.5,a.position.z,(Math.random()-.5)*3,Math.random()*2+1,(Math.random()-.5)*3,[.7,.1,.1],.45,.07);
  if(a.hp<=0){a.dead=true;a.deadT=0;Sfx.play('zdie',.5);const n=1+((Math.random()*2)|0);spawnDrop(I.PORK,n,a.position.x,a.position.y+.5,a.position.z,0,3,0);}
}
function killZombie(z,byPlayer){
  z.dead=true;z.deadT=0;Sfx.play('zdie',clamp(1-Math.hypot(z.position.x-player.position.x,z.position.z-player.position.z)/30,.2,1));
  if(byPlayer){stats.kills++;flag('kill');if(Math.random()<.6)spawnDrop(I.FLESH,1,z.position.x,z.position.y+.6,z.position.z,0,3,0);toast('ゾンビをたおした！');}
}

function updateTarget(){
  const p=player.position,cp=Math.cos(player.pitch);
  const ox=p.x,oy=p.y+1.62,oz=p.z,dx=-Math.sin(player.yaw)*cp,dy=Math.sin(player.pitch),dz=-Math.cos(player.yaw)*cp;
  hit=raycast(ox,oy,oz,dx,dy,dz,5.2);
  zHit=(zombies.length||animals.length)?targetZombie(3.6):null;
  if(hit&&hit.id===B.BEDROCK)hit.unbreakable=true;
}
function updateMining(dt){
  attackCD-=dt;placeCD-=dt;eatCD-=dt;
  if(state!=='playing'){crackMesh.visible=false;mine.prog=0;mine.key='';return;}
  if((mouse.r||mouse.rP)&&placeCD<=0&&eatCD<=0){placeCD=.22;rightClick();}
  mouse.rP=false;
  const lDown=mouse.l||mouse.lP;mouse.lP=false;
  if(lDown){
    if(zHit&&(!hit||zHit.dist<=hit.dist)){
      mine.prog=0;mine.key='';crackMesh.visible=false;
      if(attackCD<=0){attackCD=.5;attackZombie(zHit.z);}
      return;
    }
    if(hit&&BI[hit.id]&&BI[hit.id].hard>=0){
      const key=hit.x+','+hit.y+','+hit.z+','+hit.id;
      if(mine.key!==key){mine.key=key;mine.prog=0;mine.sndT=0;}
      const info=breakInfo(hit.id);
      mine.prog+=dt/info.t;swingLoop=true;if(swingT===0)swingT=.0001;
      mine.sndT-=dt;mine.partT-=dt;
      if(mine.sndT<=0){mine.sndT=.24;Sfx.play('dig',BI[hit.id].snd);}
      if(mine.partT<=0){mine.partT=.12;const c=tilePixel(BT[hit.id]?BT[hit.id][4]:ITEMS[hit.id].tile,Math.random);const f=.4+.6*Math.max(U.uDay.value,.3);
        spawnParticle(hit.x+.5+hit.nx*.55+(Math.random()-.5)*.8*(1-Math.abs(hit.nx)),hit.y+.5+hit.ny*.55+(Math.random()-.5)*.8*(1-Math.abs(hit.ny)),hit.z+.5+hit.nz*.55+(Math.random()-.5)*.8*(1-Math.abs(hit.nz)),hit.nx*1.5+(Math.random()-.5)*1.5,Math.random()*1.5+.5,hit.nz*1.5+(Math.random()-.5)*1.5,[c[0]*f,c[1]*f,c[2]*f],.5,.06);}
      if(mine.prog>=1){const x=hit.x,y=hit.y,z=hit.z;mine.prog=0;mine.key='';breakBlockAt(x,y,z);flag('_b');}
      else{crackMesh.visible=true;crackMesh.position.set(hit.x+.5,hit.y+.5,hit.z+.5);crackTex.offset.x=Math.min(9,Math.floor(mine.prog*10))*.1;}
      return;
    }
  }
  mine.prog=0;mine.key='';crackMesh.visible=false;swingLoop=false;
}

// ============================================================
//  プレイヤー更新
// ============================================================
function hurtPlayer(amount,kx,kz,noInv){
  if(player.dead||state==='menu')return;if(player.invuln>0&&!noInv)return;
  player.health-=amount;player.invuln=noInv?.2:.6;hurtFlash=1;Sfx.play('hurt');
  if(kx!==undefined){player.velocity.x+=kx*6;player.velocity.z+=kz*6;player.velocity.y=Math.max(player.velocity.y,4.5);}
  if(player.health<=0){player.health=0;die();}
}
function die(){
  if(player.dead)return;player.dead=true;Sfx.play('death');
  mouse.l=mouse.r=false;
  $('deathmsg').textContent='たおしたゾンビ '+stats.kills+' 体 ／ '+dayCount+' 日目まで生きのびた（持ち物はそのまま）';
  setState('dead');
}
function respawn(){
  const p=player;
  loadAroundSync(spawnPoint.x,spawnPoint.z,2);
  p.position.x=spawnPoint.x;p.position.y=spawnPoint.y;p.position.z=spawnPoint.z;p.velocity.x=p.velocity.y=p.velocity.z=0;
  p.health=20;p.hunger=20;p.air=10;p.dead=false;p.invuln=2;p.fallY=p.position.y;hurtFlash=0;
  for(let i=zombies.length-1;i>=0;i--)if(Math.hypot(zombies[i].position.x-p.position.x,zombies[i].position.z-p.position.z)<24)removeZombie(zombies[i]);
  if(sunH<0)timeOfDay=.27;
  setState('playing');lockPointer();
}
let camBob=0,fovCur=72;
function updatePlayer(dt){
  const p=player,v=p.velocity,pos=p.position;const K=state==='playing'?keys:NOKEYS,T=state==='playing'?tapKeys:NOKEYS;const dn=c=>!!(K[c]||T[c]);
  p.invuln=Math.max(0,p.invuln-dt);
  const wasWater=p.inWater;
  p.inWater=bf(pos.x,pos.y+.4,pos.z)===B.WATER;p.headInWater=bf(pos.x,pos.y+1.62,pos.z)===B.WATER;
  if(p.inWater&&!wasWater&&v.y<-3){Sfx.play('splash');for(let i=0;i<14;i++)spawnParticle(pos.x,pos.y+.3,pos.z,(Math.random()-.5)*4,Math.random()*4+1,(Math.random()-.5)*4,[.55,.7,1],.6,.08);}
  const fw=((dn('KeyW')||dn('ArrowUp'))?1:0)-((dn('KeyS')||dn('ArrowDown'))?1:0),st=((dn('KeyD')||dn('ArrowRight'))?1:0)-((dn('KeyA')||dn('ArrowLeft'))?1:0);
  const space=dn('Space');
  const moving=fw!==0||st!==0;
  p.sprinting=moving&&fw>=0&&(dn('ShiftLeft')||dn('ShiftRight'))&&p.hunger>5&&!p.inWater;
  let speed=p.sprinting?7.1:4.5;if(p.inWater)speed*=.55;
  const sy=Math.sin(p.yaw),cy=Math.cos(p.yaw);
  let wx=-sy*fw+cy*st,wz=-cy*fw-sy*st;const wl=Math.hypot(wx,wz);if(wl>0){wx/=wl;wz/=wl;}
  const acc=p.onGround?16:(p.inWater?6:3.5);const k=Math.min(1,acc*dt);
  v.x+=(wx*speed-v.x)*k;v.z+=(wz*speed-v.z)*k;
  if(p.fly){v.y=(space?10:0)-(dn('KeyC')?10:0);v.x=wx*speed*1.6;v.z=wz*speed*1.6;}
  else if(p.inWater){
    v.y-=9*dt;v.y*=1-Math.min(1,2.4*dt);
    if(space){v.y=Math.min(4.2,v.y+26*dt);if((p.hitX||p.hitZ)&&!p.headInWater)v.y=Math.max(v.y,7.3);}
  }else{
    v.y-=GRAV*dt;
    if(space&&p.onGround){v.y=8.6;addExhaust(p.sprinting?.2:.05);}
  }
  // 1ブロックの段差は自動でのぼる（引っかかり防止）
  if(p.onGround&&moving&&(p.hitX||p.hitZ)&&!p.inWater&&v.y<=0){
    const ax=Math.floor(pos.x+wx*.55),az=Math.floor(pos.z+wz*.55),ay=Math.floor(pos.y+.05);
    if(solidAt(ax,ay,az)&&!solidAt(ax,ay+1,az)&&!solidAt(ax,ay+2,az)&&!solidAt(Math.floor(pos.x),ay+3,Math.floor(pos.z)))v.y=8.4;
  }
  moveBody(p,dt);
  // 落下ダメージ
  if(p.onGround){if(!p.wasGround){const fall=p.fallY-pos.y;if(fall>3.3&&!p.inWater){hurtPlayer(Math.ceil(fall-3),undefined,undefined,true);}else if(fall>1.5)Sfx.play('step',BI[getBlock(Math.floor(pos.x),Math.floor(pos.y-.2),Math.floor(pos.z))]?BI[getBlock(Math.floor(pos.x),Math.floor(pos.y-.2),Math.floor(pos.z))].snd:'stone',1.6);}p.fallY=pos.y;}
  else{if(p.wasGround)p.fallY=pos.y;if(pos.y>p.fallY)p.fallY=pos.y;if(p.inWater)p.fallY=pos.y;}
  if(p.fly)p.fallY=pos.y;
  p.wasGround=p.onGround;
  // 足音とカメラの揺れ
  const hs=Math.hypot(v.x,v.z);
  if(p.onGround&&hs>1.2&&!p.inWater){p.stepDist+=hs*dt;p.walkPhase+=hs*dt*1.7;
    if(p.stepDist>(p.sprinting?2.1:1.75)){p.stepDist=0;const bid=getBlock(Math.floor(pos.x),Math.floor(pos.y-.2),Math.floor(pos.z));Sfx.play('step',BI[bid]?BI[bid].snd:'stone');}}
  else if(p.inWater&&hs>.8){p.stepDist+=hs*dt;if(p.stepDist>2.2){p.stepDist=0;Sfx.play('splash');}}
  // 空腹・回復・おぼれ
  p.exh+=dt*(p.sprinting?.12:moving?.03:.012);
  if(p.exh>=1){p.exh-=1;p.hunger=Math.max(0,p.hunger-1);}
  if(p.hunger>=18&&p.health<20){p.regenT+=dt;if(p.regenT>=3){p.regenT=0;p.health=Math.min(20,p.health+1);p.exh+=.25;}}else p.regenT=0;
  if(p.hunger<=0){p.starveT+=dt;if(p.starveT>=4){p.starveT=0;if(p.health>2)hurtPlayer(1,undefined,undefined,true);}}else p.starveT=0;
  if(p.headInWater){p.air-=dt;if(p.air<=0){p.air=0;p.drownT+=dt;if(p.drownT>=1){p.drownT=0;hurtPlayer(2,undefined,undefined,true);}}}else{p.air=Math.min(10,p.air+dt*5);p.drownT=0;}
}

// ============================================================
//  ゾンビ更新・出現
// ============================================================
let spawnT=4;
function lightFactor(x,y,z){const l=lightAt(Math.floor(x),Math.floor(y),Math.floor(z));return Math.max(LUT[l[0]*2]*U.uDay.value,LUT[l[1]*2]*.95,.1);}
function updateZombies(dt){
  const P=player.position;
  for(let i=zombies.length-1;i>=0;i--){
    const z=zombies[i],p=z.position,v=z.velocity,ud=z.model.userData;
    if(z.dead){z.deadT+=dt;z.model.rotation.z=Math.min(1,z.deadT/.35)*Math.PI/2;z.model.position.set(p.x,p.y,p.z);
      const f=Math.max(.2,1-z.deadT);z.model.userData.mats.forEach(m=>m.color.setRGB(1*f,.3*f,.3*f));if(z.deadT>.9)removeZombie(z);continue;}
    const dx=P.x-p.x,dz=P.z-p.z,dy=P.y-p.y,d2=Math.hypot(dx,dz);
    z.hurtT=Math.max(0,z.hurtT-dt);z.kbT=Math.max(0,z.kbT-dt);
    z.inWater=bf(p.x,p.y+.4,p.z)===B.WATER;
    if(!z.persist&&d2>76){removeZombie(z);continue;}
    const chase=!player.dead&&d2<28&&Math.abs(dy)<14;
    let speed=0;
    if(chase){z.yaw=Math.atan2(dx,dz);speed=d2>.9?2.7:0;}
    else{z.wander-=dt;if(z.wander<=0){z.wander=2+Math.random()*3;z.moving=Math.random()<.5;z.wanderYaw=Math.random()*6.283;}if(z.moving){z.yaw=z.wanderYaw;speed=1;}}
    if(z.kbT<=0){const k=Math.min(1,10*dt);v.x+=(Math.sin(z.yaw)*speed-v.x)*k;v.z+=(Math.cos(z.yaw)*speed-v.z)*k;}
    if(z.inWater){v.y-=8*dt;v.y*=1-Math.min(1,2*dt);v.y=Math.max(v.y,1.2*0+v.y);if(chase||z.hitX||z.hitZ)v.y=Math.min(3,v.y+22*dt);}
    else v.y-=GRAV*dt;
    if(speed>0&&(z.hitX||z.hitZ)&&z.onGround&&z.kbT<=0)v.y=8.8;
    moveBody(z,dt);
    z.anim+=Math.hypot(v.x,v.z)*dt*2.6;
    // 攻撃
    if(chase&&d2<1.25&&Math.abs(dy)<1.6){z.atkCD-=dt;if(z.atkCD<=0){z.atkCD=1.1;const l=d2||1;hurtPlayer(3,dx/l,dz/l);}}else z.atkCD=Math.min(z.atkCD+dt,.7);
    z.moanT-=dt;if(z.moanT<=0){z.moanT=4+Math.random()*6;const dd=Math.hypot(dx,dz,dy);if(dd<26)Sfx.play('zombie',clamp(1-dd/26,.12,1));}
    // 日光で燃える
    let burning=false;
    if(!z.persist&&dayAmt>.7){const l=lightAt(Math.floor(p.x),Math.floor(p.y+1.8),Math.floor(p.z));if(l[0]>=15&&!z.inWater){burning=true;z.burnT+=dt;z.hp-=dt*1.6;if(Math.random()<dt*14)spawnParticle(p.x+(Math.random()-.5)*.5,p.y+1+Math.random(),p.z+(Math.random()-.5)*.5,0,1.5,0,[1,.5,.1],.5,.08,-2);if(z.hp<=0)killZombie(z,false);}}
    // モデル更新
    const m=z.model;m.position.set(p.x,p.y,p.z);m.rotation.y=z.yaw;
    const sw=Math.sin(z.anim)*.9*Math.min(1,Math.hypot(v.x,v.z));
    ud.legL.rotation.x=sw;ud.legR.rotation.x=-sw;ud.armL.rotation.x=-Math.PI/2+sw*.12+Math.sin(performance.now()*.004+i)*.05;ud.armR.rotation.x=-Math.PI/2-sw*.12-Math.sin(performance.now()*.004+i)*.05;
    ud.head.rotation.y=chase?clamp(Math.sin(z.anim*.5)*.1,-.2,.2):Math.sin(performance.now()*.001+i)*.3;
    const lf=lightFactor(p.x,p.y+1,p.z);const hf=z.hurtT>0?1:0;
    ud.mats.forEach(mm=>mm.color.setRGB(lf*(1+hf*.8)*(burning?1.1:1),lf*(1-hf*.65)*(burning?.8:1),lf*(1-hf*.65)*(burning?.65:1)));
  }
  // 出現
  spawnT-=dt;
  if(spawnT<=0){
    spawnT=2.5+Math.random()*3.5;
    const night=sunH<.04;let alive=0;for(const z of zombies)if(!z.dead&&!z.persist)alive++;
    const underground=lightAt(Math.floor(P.x),Math.floor(P.y+1),Math.floor(P.z))[0]<3&&P.y<SEA+1;
    const cap=night?6:(underground?3:0);
    if(alive<cap&&!player.dead)trySpawnZombie(underground&&!night);
  }
}
let pigSpawnT=3;
function updateAnimals(dt){
  const P=player.position;
  for(let i=animals.length-1;i>=0;i--){
    const a=animals[i],p=a.position,v=a.velocity,ud=a.model.userData;
    if(a.dead){a.deadT+=dt;a.model.rotation.z=Math.min(1,a.deadT/.3)*Math.PI/2;a.model.position.set(p.x,p.y,p.z);const f=Math.max(.2,1-a.deadT);ud.mats.forEach(m=>m.color.setRGB(f,.3*f,.3*f));if(a.deadT>.8)removeAnimal(a);continue;}
    const dx=P.x-p.x,dz=P.z-p.z,d2=Math.hypot(dx,dz);
    a.hurtT=Math.max(0,a.hurtT-dt);a.kbT=Math.max(0,a.kbT-dt);a.fleeT=Math.max(0,a.fleeT-dt);
    a.inWater=bf(p.x,p.y+.3,p.z)===B.WATER;
    if(d2>84){removeAnimal(a);continue;}
    let speed=0;
    if(a.fleeT>0){a.yaw=Math.atan2(-dx,-dz);speed=3.4;}
    else{a.wander-=dt;if(a.wander<=0){a.wander=2+Math.random()*4;a.moving=Math.random()<.55;a.wanderYaw=Math.random()*6.283;}if(a.moving){a.yaw=a.wanderYaw;speed=1.1;}}
    if(a.kbT<=0){const k=Math.min(1,8*dt);v.x+=(Math.sin(a.yaw)*speed-v.x)*k;v.z+=(Math.cos(a.yaw)*speed-v.z)*k;}
    if(a.inWater){v.y-=8*dt;v.y*=1-Math.min(1,2*dt);v.y=Math.min(3,v.y+14*dt);}else v.y-=GRAV*dt;
    if(speed>0&&(a.hitX||a.hitZ)&&a.onGround&&a.kbT<=0)v.y=8.4;
    moveBody(a,dt);
    a.anim+=Math.hypot(v.x,v.z)*dt*3;
    a.oinkT-=dt;if(a.oinkT<=0){a.oinkT=6+Math.random()*10;if(d2<20)Sfx.play('pig',clamp(1-d2/20,.1,.7));}
    const m=a.model;m.position.set(p.x,p.y,p.z);m.rotation.y=a.yaw;
    const sw=Math.sin(a.anim)*.7*Math.min(1,Math.hypot(v.x,v.z));
    ud.legs[0].rotation.x=sw;ud.legs[3].rotation.x=sw;ud.legs[1].rotation.x=-sw;ud.legs[2].rotation.x=-sw;
    ud.head.rotation.x=Math.sin(performance.now()*.002+i)*.08;
    const lf=lightFactor(p.x,p.y+.6,p.z),hf=a.hurtT>0?1:0;
    ud.mats.forEach(mm=>mm.color.setRGB(lf*(1+hf*.7),lf*(1-hf*.6),lf*(1-hf*.6)));
  }
  pigSpawnT-=dt;
  if(pigSpawnT<=0){
    pigSpawnT=5+Math.random()*6;
    let n=0;for(const a of animals)if(!a.dead)n++;
    if(n<6&&sunH>.05&&!player.dead)trySpawnPig();
  }
}
function trySpawnPig(){
  const P=player.position;
  for(let k=0;k<8;k++){
    const a=Math.random()*6.283,r=14+Math.random()*24,x=P.x+Math.cos(a)*r,z=P.z+Math.sin(a)*r;
    if(!getChunk(Math.floor(x/CS),Math.floor(z/CS)))continue;
    const y=groundYAt(x,z,P.y+14);if(y<0)continue;
    if(getBlock(Math.floor(x),y-1,Math.floor(z))!==B.GRASS)continue;
    const g=1+((Math.random()*2)|0);
    for(let j=0;j<g;j++){const px=Math.floor(x)+.5+j*1.2,pz=Math.floor(z)+.5;const yy=groundYAt(px,pz,y+3);if(yy>=0&&getBlock(Math.floor(px),yy-1,Math.floor(pz))===B.GRASS)spawnPigAt(px,yy+.01,pz);}
    return true;
  }
  return false;
}
function trySpawnZombie(cave){
  const P=player.position;
  for(let k=0;k<10;k++){
    const a=Math.random()*6.283,r=cave?9+Math.random()*10:17+Math.random()*14;
    const x=P.x+Math.cos(a)*r,z=P.z+Math.sin(a)*r;
    if(!getChunk(Math.floor(x/CS),Math.floor(z/CS)))continue;
    let y=-1;
    if(cave){for(let yy=Math.floor(P.y)+5;yy>=Math.max(2,Math.floor(P.y)-6);yy--){if(!solidAt(Math.floor(x),yy,Math.floor(z))&&!solidAt(Math.floor(x),yy+1,Math.floor(z))&&solidAt(Math.floor(x),yy-1,Math.floor(z))&&getBlock(Math.floor(x),yy,Math.floor(z))!==B.WATER){const l=lightAt(Math.floor(x),yy,Math.floor(z));if(l[0]<3&&l[1]<3){y=yy;break;}}}}
    else{y=groundYAt(x,z,P.y+14);if(y<0)continue;const l=lightAt(Math.floor(x),y,Math.floor(z));if(l[1]>8)continue;}
    if(y<0)continue;
    spawnZombieAt(Math.floor(x)+.5,y+.01,Math.floor(z)+.5,false);return true;
  }
  return false;
}

// ============================================================
//  手に持つアイテム(一人称)
// ============================================================
const handGroup=new THREE.Group();handScene.add(handGroup);
let handItemId=-2,handObj=null;
function buildHandObj(id){
  const g=new THREE.Group();
  if(!id){const arm=new THREE.Mesh(new THREE.BoxGeometry(.13,.13,.7),handSkinMats);arm.position.set(.02,-.02,-.05);arm.rotation.set(.3,.35,0);g.add(arm);
    const sl=new THREE.Mesh(new THREE.BoxGeometry(.15,.15,.3),handSleeveMat);sl.position.set(.08,-.1,.22);sl.rotation.set(.3,.35,0);g.add(sl);return g;}
  const cube=!!CUBE_IDS[id];
  const m=new THREE.Mesh(itemGeometry(id),cube?handBlockMat:handFlatMat);
  if(cube){m.scale.setScalar(.42);m.rotation.set(.15,-.7,0);}
  else{m.scale.setScalar(.62);m.rotation.set(.1,-.9,.45);m.position.set(-.02,.1,0);}
  g.add(m);return g;
}
function updateHand(dt){
  const s=inv[sel],id=s?s.id:0;
  if(id!==handItemId){handItemId=id;if(handObj)handGroup.remove(handObj);handObj=buildHandObj(id);handGroup.add(handObj);equipDip=1;}
  equipDip=Math.max(0,equipDip-dt*4.5);
  if(swingT>0){swingT+=dt/.3;if(swingT>=1)swingT=swingLoop?.0001:0;}
  const sw=Math.sin(Math.min(swingT,1)*Math.PI);
  const bob=Math.sin(player.walkPhase)*.012,bobx=Math.cos(player.walkPhase*.5)*.01;
  handGroup.position.set(.46-sw*.1+bobx,-.4-sw*.12-equipDip*.5+bob,-.85-sw*.18);
  handGroup.rotation.set(-sw*.95,sw*.25,-sw*.2);
  const lf=Math.max(.45,lightFactor(player.position.x,player.position.y+1.5,player.position.z)*1.1);
  handBlockMat.color.setScalar(Math.min(1,lf));handFlatMat.color.setScalar(Math.min(1,lf));{const q=Math.min(1,lf);handSkinMats.forEach(m=>m.color.setRGB(.79*q*m.userData.f,.54*q*m.userData.f,.4*q*m.userData.f));}handSleeveMat.color.setScalar(Math.min(1,lf));
}

// ============================================================
//  状態・画面・保存
// ============================================================
let locked=false,gameStarted=false,menuCenter={x:8.5,y:40,z:8.5},menuAngle=0;
function setState(s){
  state=s;
  $('title').classList.toggle('hidden',s!=='menu');
  $('pause').classList.toggle('hidden',s!=='paused');
  $('inv').classList.toggle('hidden',s!=='inventory');
  $('death').classList.toggle('hidden',s!=='dead');
  $('hud').classList.toggle('hidden',s==='menu');
  if(s!=='inventory'){$('cursor').style.display='none';$('tip').style.display='none';}
  for(const k in tapKeys)delete tapKeys[k];
  if(s!=='playing')unlockPointer();
  if(s!=='playing'){mouse.l=mouse.r=mouse.lP=mouse.rP=false;}
}
function lockPointer(){try{const r=canvas.requestPointerLock();if(r&&r.catch)r.catch(()=>{});}catch(e){}}
function unlockPointer(){try{if(document.pointerLockElement)document.exitPointerLock();}catch(e){}}
document.addEventListener('pointerlockchange',()=>{const was=locked;locked=document.pointerLockElement===canvas;if(locked&&state!=='playing'){unlockPointer();return;}if(was&&!locked&&state==='playing')pauseGame();});
function pauseGame(){if(state!=='playing')return;clearInput();setState('paused');saveGame();}
function resumeGame(){if(state!=='paused')return;setState('playing');lockPointer();}
function clearInput(){for(const k in keys)keys[k]=false;for(const k in tapKeys)delete tapKeys[k];mouse.l=mouse.r=false;}
function openInventory(table){
  if(state!=='playing')return;invTable=!!table||nearTable();cursorItem=null;clearInput();setState('inventory');unlockPointer();markInv();renderInv();
}
function closeInventory(){
  if(state!=='inventory')return;
  if(cursorItem){const left=addItem(cursorItem.id,cursorItem.n,cursorItem.d);if(left>0){const p=player.position;spawnDrop(cursorItem.id,left,p.x,p.y+1.2,p.z,-Math.sin(player.yaw)*3,2,-Math.cos(player.yaw)*3,cursorItem.d);}cursorItem=null;}
  setState('playing');lockPointer();
}
function dropHeld(){
  const s=inv[sel];if(!s||state!=='playing')return;const p=player.position;
  spawnDrop(s.id,1,p.x-Math.sin(player.yaw)*.5,p.y+1.4,p.z-Math.cos(player.yaw)*.5,-Math.sin(player.yaw)*4,2,-Math.cos(player.yaw)*4,s.d);
  const d=drops[drops.length-1];if(d)d.age=-1;
  s.n--;if(s.n<=0)inv[sel]=null;markInv();
}
function readSave(){try{const s=localStorage.getItem(SAVE_KEY);if(!s)return null;const o=JSON.parse(s);if(!o||o.v!==1||!o.player)return null;return o;}catch(e){return null;}}
function saveGame(){
  if(!gameStarted||player.dead)return;
  try{
    const m=[];mods.forEach(e=>{e.m.forEach((id,idx)=>{m.push(e.cx*16+(idx&15),idx>>8,e.cz*16+((idx>>4)&15),id);});});
    const p=player;
    const o={v:1,seed:SEED,t:timeOfDay,day:dayCount,flags:flags,stats:stats,sel:sel,
      player:{x:p.position.x,y:p.position.y,z:p.position.z,yaw:p.yaw,pitch:p.pitch,health:p.health,hunger:p.hunger},
      spawn:{x:spawnPoint.x,y:spawnPoint.y,z:spawnPoint.z},
      inv:inv.map(s=>s?[s.id,s.n,s.d===undefined?0:s.d]:0),mods:m,saved:Date.now()};
    localStorage.setItem(SAVE_KEY,JSON.stringify(o));
  }catch(e){}
}
function clearEntities(){
  for(let i=zombies.length-1;i>=0;i--)removeZombie(zombies[i]);
  for(let i=animals.length-1;i>=0;i--)removeAnimal(animals[i]);
  for(let i=drops.length-1;i>=0;i--)removeDrop(drops[i]);
  parts.length=0;crackMesh.visible=false;selGroup.visible=false;
}
function findSpawn(){
  let fb=null;
  const ensure=(cx,cz)=>{if(!getChunk(cx,cz))genChunk(cx,cz);};
  for(let r=0;r<520;r+=8){
    const n=r===0?1:Math.max(6,Math.floor(r/4));
    for(let k=0;k<n;k++){
      const a=k/n*6.2832+r*.7,x=Math.floor(8+Math.cos(a)*r),z=Math.floor(8+Math.sin(a)*r);
      const h=heightAt(x,z);if(h<SEA+2||h>SEA+9)continue;
      const cx=x>>4,cz=z>>4;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)ensure(cx+dx,cz+dz);
      if(getBlock(x,h,z)!==B.GRASS)continue;
      const u=getBlock(x,h+1,z);if(u&&!isPlant(u))continue;
      if(SOLID[getBlock(x,h+2,z)]||SOLID[getBlock(x,h+3,z)])continue;
      let clear=true;for(let dz=-2;dz<=2&&clear;dz++)for(let dx=-2;dx<=2;dx++){const hh=heightAt(x+dx,z+dz);if(hh>h+2||hh<h-3||SOLID[getBlock(x+dx,h+1,z+dz)]||SOLID[getBlock(x+dx,h+2,z+dz)]){clear=false;break;}}
      if(!clear)continue;
      const res={x:x+.5,y:h+1,z:z+.5};if(!fb)fb=res;
      let trees=0;for(let dz=-9;dz<=9;dz++)for(let dx=-9;dx<=9;dx++){if(getBlock(x+dx,heightAt(x+dx,z+dz)+2,z+dz)===B.LOG)trees++;}
      if(trees>=4)return res;
    }
  }
  return fb||{x:8.5,y:heightAt(8,8)+1,z:8.5};
}
function newGame(seed){
  clearEntities();clearWorld();setSeed(seed);
  const sp=findSpawn();spawnPoint.x=sp.x;spawnPoint.y=sp.y;spawnPoint.z=sp.z;
  const p=player;p.position.x=sp.x;p.position.y=sp.y;p.position.z=sp.z;p.velocity.x=p.velocity.y=p.velocity.z=0;
  p.yaw=Math.random()*6.28;p.pitch=-.1;p.health=20;p.hunger=20;p.air=10;p.dead=false;p.invuln=1;p.fallY=sp.y;p.wasGround=false;p.exh=0;
  for(let i=0;i<36;i++)inv[i]=null;cursorItem=null;for(const k in flags)delete flags[k];stats.kills=0;sel=0;
  timeOfDay=.3;dayCount=1;spawnT=8;hurtFlash=0;
  loadAroundSync(sp.x,sp.z,2);
  gameStarted=true;lastHP=-1;lastHunger=-1;markInv();refreshHotbar();
  setState('playing');showKeyHint();
}
function loadSave(){
  const o=readSave();if(!o)return false;
  clearEntities();clearWorld();setSeed(o.seed);
  const m=o.mods||[];for(let i=0;i+3<m.length;i+=4)recordMod(m[i],m[i+1],m[i+2],m[i+3]);
  const p=player,q=o.player;
  p.position.x=q.x;p.position.y=q.y;p.position.z=q.z;p.velocity.x=p.velocity.y=p.velocity.z=0;p.yaw=q.yaw||0;p.pitch=q.pitch||0;p.health=clamp(q.health||20,1,20);p.hunger=clamp(q.hunger===undefined?20:q.hunger,0,20);p.air=10;p.dead=false;p.invuln=1.5;p.fallY=q.y;p.wasGround=false;p.exh=0;
  if(o.spawn){spawnPoint.x=o.spawn.x;spawnPoint.y=o.spawn.y;spawnPoint.z=o.spawn.z;}
  for(let i=0;i<36;i++){const s=o.inv&&o.inv[i];inv[i]=s&&ITEMS[s[0]]?{id:s[0],n:s[1],d:s[2]||undefined}:null;if(inv[i]&&!ITEMS[inv[i].id].tool)delete inv[i].d;}
  cursorItem=null;for(const k in flags)delete flags[k];Object.assign(flags,o.flags||{});stats.kills=(o.stats&&o.stats.kills)||0;sel=clamp(o.sel|0,0,8);
  timeOfDay=o.t===undefined?.3:o.t;dayCount=o.day||1;spawnT=8;hurtFlash=0;
  loadAroundSync(q.x,q.z,2);
  // 足元が埋まっていないか
  for(let k=0;k<40&&overlapsSolid(p);k++)p.position.y+=1;
  gameStarted=true;lastHP=-1;lastHunger=-1;markInv();refreshHotbar();
  setState('playing');return true;
}
function showKeyHint(){const k=$('keyhint');k.classList.remove('show');void k.offsetWidth;k.classList.add('show');}
function goTitle(){
  saveGame();clearInput();clearEntities();unlockPointer();
  menuCenter={x:player.position.x,y:player.position.y,z:player.position.z};gameStarted=false;
  updateTitleMeta();setState('menu');
}
function showLoading(on){$('loading').classList.toggle('hidden',!on);}
function updateTitleMeta(){
  const o=readSave();$('btnCont').disabled=!o;
  if(o){const h=Math.floor(o.t*24),mi=Math.floor((o.t*24%1)*60);$('savemeta').textContent='保存データ：'+(o.day||1)+'日目 '+h+':'+(mi<10?'0':'')+mi+' ／ 「あそぶ」だと保存が上書きされます';}
  else $('savemeta').textContent='保存データはまだありません';
}
function updateSettingsUI(){
  $('snd').textContent=settings.mute?'音OFF':'音ON';
  ['btnMute','btnMuteT'].forEach(id=>{const b=$(id);b.textContent=settings.mute?'OFF（ミュート）':'ON';b.classList.toggle('on',!settings.mute);});
  document.querySelectorAll('.rdb').forEach(b=>b.classList.toggle('on',+b.dataset.rd===settings.rd));
  $('sens').value=settings.sens;
}
function setRD(r){settings.rd=r;RD=r;buildOffsets();saveSettings();updateSettingsUI();}
['rdBtns','rdBtnsT'].forEach(id=>{[[4,'近い'],[6,'ふつう'],[8,'遠い']].forEach(a=>{const b=document.createElement('button');b.className='btn sm rdb';b.dataset.rd=a[0];b.textContent=a[1];b.addEventListener('click',()=>{Sfx.init();setRD(a[0]);});$(id).appendChild(b);});});
function toggleMute(){settings.mute=!settings.mute;$('snd').textContent=settings.mute?'音OFF':'音ON';Sfx.init();Sfx.setMuted(settings.mute);saveSettings();updateSettingsUI();}
$('btnMute').addEventListener('click',toggleMute);$('btnMuteT').addEventListener('click',toggleMute);
$('sens').addEventListener('input',e=>{settings.sens=+e.target.value;saveSettings();});
$('btnNew').addEventListener('click',()=>{Sfx.init();Sfx.resume();Sfx.play('click');showLoading(true);setTimeout(()=>{newGame((Math.random()*1e9)|0);showLoading(false);lockPointer();},40);});
$('btnCont').addEventListener('click',()=>{Sfx.init();Sfx.resume();Sfx.play('click');showLoading(true);setTimeout(()=>{let ok=false;try{ok=loadSave();}catch(e){ok=false;errors.push('loadSave: '+e.message);}if(!ok){try{localStorage.removeItem(SAVE_KEY);}catch(e){}newGame((Math.random()*1e9)|0);}showLoading(false);lockPointer();},40);});
$('btnResume').addEventListener('click',()=>{Sfx.init();resumeGame();});
$('btnTitle').addEventListener('click',()=>{goTitle();});
$('btnRespawn').addEventListener('click',()=>{Sfx.init();respawn();});

// ============================================================
//  入力
// ============================================================
const NOKEYS={};
window.addEventListener('keydown',e=>{
  const c=e.code;
  if(state==='playing'&&(c==='Space'||c==='Tab'||c.startsWith('Arrow')))e.preventDefault();
  if(e.repeat&&c!=='KeyQ')return;
  keys[c]=true;tapKeys[c]=true;
  Sfx.init();Sfx.resume();
  if(c==='KeyM'){toggleMute();return;}
  if(c==='F3'){e.preventDefault();$('dbg').classList.toggle('hidden');return;}
  if(c==='Escape'){
    if(state==='playing')pauseGame();else if(state==='inventory')closeInventory();else if(state==='paused')resumeGame();return;}
  if(state==='playing'){
    if(c.startsWith('Digit')){const n=+c.slice(5);if(n>=1&&n<=9)selectSlot(n-1);}
    else if(c==='KeyE')openInventory(false);
    else if(c==='KeyQ')dropHeld();
  }else if(state==='inventory'){
    if(c==='KeyE')closeInventory();
    else if(c.startsWith('Digit')){const n=+c.slice(5);if(n>=1&&n<=9&&hoverSlot>=0){/* ホバー中のスロットとホットバーを入れ替え */const a=inv[hoverSlot];inv[hoverSlot]=inv[n-1];inv[n-1]=a;markInv();Sfx.play('click');}}
  }else if(state==='dead'){if(c==='Enter')respawn();}
});
window.addEventListener('keyup',e=>{keys[e.code]=false;});
window.addEventListener('blur',clearInput);
canvas.addEventListener('mousedown',e=>{
  Sfx.init();Sfx.resume();
  if(state!=='playing')return;
  e.preventDefault();
  if(!locked)lockPointer();
  if(e.button===0){mouse.l=true;mouse.lP=true;}else if(e.button===2){mouse.r=true;mouse.rP=true;placeCD=0;}
});
window.addEventListener('mouseup',e=>{if(e.button===0)mouse.l=false;else if(e.button===2)mouse.r=false;});
document.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('mousemove',e=>{
  if(state==='inventory'){const cur=$('cursor');cur.style.left=(e.clientX-22)+'px';cur.style.top=(e.clientY-22)+'px';if(hoverSlot>=0)showTip(e);return;}
  if(state==='playing'&&locked){
    const s=.0022*(settings.sens/5);const mx=clamp(e.movementX||0,-250,250),my=clamp(e.movementY||0,-250,250);
    player.yaw-=mx*s;player.pitch=clamp(player.pitch-my*s,-1.5533,1.5533);
  }
});
window.addEventListener('wheel',e=>{if(state==='playing'){selectSlot(sel+(e.deltaY>0?1:-1));}},{passive:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();if(state==='playing')pauseGame();else saveGame();}else{lastT=performance.now();}});
window.addEventListener('beforeunload',saveGame);
function onResize(){
  const w=window.innerWidth,h=window.innerHeight;renderer.setSize(w,h,false);
  camera.aspect=w/h;camera.updateProjectionMatrix();handCam.aspect=w/h;handCam.updateProjectionMatrix();
}
window.addEventListener('resize',onResize);

// ============================================================
//  メインループ
// ============================================================
const perfUp=[];
let lastT=performance.now(),fpsN=0,fpsT=0,fps=0,frameNo=0,autosaveT=0,hudT=0,lastClock='',lastObj='';
function advanceTime(dt){
  const rate=sunH>0?1/840:1/420;
  timeOfDay+=dt*rate;if(timeOfDay>=1){timeOfDay-=1;dayCount++;}
}
function applyCamera(x,y,z,yaw,pitch,roll){camera.position.set(x,y,z);camera.rotation.set(pitch,yaw,roll||0,'YXZ');}
function update(dt){
  const P=player.position;
  if(state==='menu'){
    menuAngle+=dt*.07;const c=menuCenter,rad=22;
    const cx=c.x+Math.cos(menuAngle)*rad,cz=c.z+Math.sin(menuAngle)*rad,cy=c.y+12;
    const dx=c.x-cx,dz=c.z-cz,dy=(c.y+2)-cy;
    applyCamera(cx,cy,cz,Math.atan2(-dx,-dz),Math.atan2(dy,Math.hypot(dx,dz)),0);
    timeOfDay=.4;updateSky();streamChunks(c.x,c.z,5,8);updateParticles(dt);
    return;
  }
  const sim=state==='playing'||state==='inventory';
  if(sim){
    advanceTime(dt);
    updatePlayer(dt);for(const k in tapKeys)delete tapKeys[k];
    updateTarget();updateMining(dt);updateZombies(dt);updateAnimals(dt);updateDrops(dt);updateParticles(dt);
    streamChunks(P.x,P.z,4,6);if((frameNo&63)===0)unloadFar(P.x,P.z);
    flushSync();
    autosaveT+=dt;if(autosaveT>20){autosaveT=0;saveGame();}
    nameT-=dt;if(nameT<0)$('itemname').style.opacity=0;
  }else if(state==='paused'){
    updateTarget();
  }
  if(player.dead){updateParticles(dt);}
  hurtFlash=Math.max(0,hurtFlash-dt*1.6);
  // カメラ
  const p=player;let eye=p.position.y+1.62;
  const moving=p.onGround&&Math.hypot(p.velocity.x,p.velocity.z)>1.2;
  if(moving&&state==='playing')eye+=Math.sin(p.walkPhase*2)*.035;
  let roll=hurtFlash*.07*Math.sin(performance.now()*.04);
  if(p.dead){eye-=.9;roll=.9;}
  const fovT=72+(p.sprinting?8:0)+(p.headInWater?-4:0);fovCur+=(fovT-fovCur)*Math.min(1,dt*8);
  if(Math.abs(camera.fov-fovCur)>.02){camera.fov=fovCur;camera.updateProjectionMatrix();}
  applyCamera(p.position.x,eye,p.position.z,p.yaw,p.pitch,roll);
  if(state!=='paused')updateHand(dt);
  updateSky();
  // 落ちているアイテムの明るさ
  const lf=lightFactor(p.position.x,p.position.y+1,p.position.z);dropBlockMat.color.setScalar(lf);dropFlatMat.color.setScalar(lf);
  pMesh.material.color.setScalar(1);
  // 選択枠
  if(hit&&state==='playing'){selGroup.visible=true;selGroup.position.set(hit.x+.5,hit.y+.5,hit.z+.5);}else selGroup.visible=false;
  waterMat.uniforms.uOff.value.set((performance.now()*.00004)%1,(performance.now()*.00007)%1);
}
function updateHud(dt){
  if(state==='menu')return;
  if(invDirty){refreshHotbar();if(state==='inventory')renderInv();invDirty=false;}
  updateBars();
  $('vig').style.opacity=Math.max(hurtFlash*.9,player.health<=4&&state==='playing'?.35:0);
  $('wet').style.opacity=player.headInWater?1:0;
  $('clickhint').classList.toggle('hidden',!(state==='playing'&&!locked&&!DEBUG));
  hudT-=dt;if(hudT>0)return;hudT=.15;
  const h=Math.floor(timeOfDay*24),mi=Math.floor((timeOfDay*24%1)*60);
  const lab=sunH>.12?'昼':sunH>-.1?(timeOfDay<.5?'朝':'夕方'):'夜';
  const ct=lab+' '+h+':'+(mi<10?'0':'')+mi+'　'+dayCount+'日目';
  if(ct!==lastClock){lastClock=ct;$('clocktext').textContent=ct;$('clockicon').classList.toggle('night',sunH<-.05);}
  const ob=currentObjective();if(ob!==lastObj){lastObj=ob;$('objtext').textContent=ob;}
  let tt='';
  if(zHit&&state==='playing'&&(!hit||zHit.dist<=hit.dist))tt=zHit.z.label||'ゾンビ';
  else if(hit&&state==='playing'){const bi=BI[hit.id];tt=ITEMS[hit.id].name;
    if(bi&&bi.hard>=0){const info=breakInfo(hit.id);if(!info.harvest)tt+='　※'+(bi.tool==='pick'?(bi.tier>=2?'石のツルハシ以上':'ツルハシ'):'道具')+'が必要';}
    else if(bi&&bi.hard<0)tt+='（こわせない）';
    if(hit.id===B.TABLE)tt+='　右クリックでクラフト';}
  
  if($('target').textContent!==tt)$('target').textContent=tt;
  if(!$('dbg').classList.contains('hidden')){
    let nm=0;chunks.forEach(c=>{if(c.mesh)nm++;});
    $('dbg').textContent='FPS '+fps+'  チャンク '+chunks.size+' (描画 '+nm+')  三角形 '+renderer.info.render.triangles+'\n座標 '+player.position.x.toFixed(1)+', '+player.position.y.toFixed(1)+', '+player.position.z.toFixed(1)+'  t='+timeOfDay.toFixed(3)+'  敵 '+zombies.length;
  }
}
function render(){
  renderer.clear();renderer.render(scene,camera);
  if(state==='playing'||state==='inventory'||state==='paused'){renderer.clearDepth();renderer.render(handScene,handCam);}
}
function frame(now){
  requestAnimationFrame(frame);
  let dt=(now-lastT)/1000;lastT=now;if(!(dt>0))dt=1/60;dt=Math.min(dt,.05);
  frameNo++;fpsN++;fpsT+=dt;if(fpsT>=.5){fps=Math.round(fpsN/fpsT);fpsN=0;fpsT=0;}
  renderer.info.reset();
  const t0=performance.now();
  update(dt);updateHud(dt);
  const t1=performance.now();render();
  perfUp.push(t1-t0);if(perfUp.length>180)perfUp.shift();
}

// ============================================================
//  デバッグ用フック (?debug)
// ============================================================
function ensureChunkAt(x,z){const cx=x>>4,cz=z>>4;if(!getChunk(cx,cz))genChunk(cx,cz);}
if(DEBUG){
  const mc=window.__mc;
  Object.assign(mc,{
    player,BLOCK:B,ITEM:I,inventory:inv,zombies,flags,
    getBlock:(x,y,z)=>getBlock(Math.floor(x),Math.floor(y),Math.floor(z)),
    setBlock:(x,y,z,id)=>{x=Math.floor(x);y=Math.floor(y);z=Math.floor(z);ensureChunkAt(x,z);const r=setBlock(x,y,z,id);flushSync();return r;},
    teleport:(x,y,z)=>{player.position.x=x;player.position.y=y;player.position.z=z;player.velocity.x=player.velocity.y=player.velocity.z=0;player.fallY=y;player.wasGround=false;loadAroundSync(x,z,2);return true;},
    setTime:t=>{timeOfDay=((t%1)+1)%1;updateSky();return timeOfDay;},
    getTime:()=>timeOfDay,
    setLook:(yaw,pitch)=>{player.yaw=yaw;player.pitch=clamp(pitch,-1.5533,1.5533);},
    startGame:(seed)=>{showLoading(false);newGame(seed===undefined?12345:seed);return true;},
    loadGame:()=>{showLoading(false);return loadSave();},
    saveGame:()=>{saveGame();return true;},
    spawnPig:(dist)=>{const p=player.position,d=dist||4;const x=p.x-Math.sin(player.yaw)*d,z=p.z-Math.cos(player.yaw)*d;ensureChunkAt(Math.floor(x),Math.floor(z));let y=groundYAt(x,z,p.y+6);if(y<0)y=p.y;return spawnPigAt(x,y+.01,z);},
    animals,
    spawnZombie:(dist)=>{const p=player.position,d=dist||5;const x=p.x-Math.sin(player.yaw)*d,z=p.z-Math.cos(player.yaw)*d;ensureChunkAt(Math.floor(x),Math.floor(z));let y=groundYAt(x,z,p.y+6);if(y<0)y=p.y;return spawnZombieAt(x,y+.01,z,true);},
    giveItem:(id,n)=>addItem(id,n||1),
    stats:()=>{let nm=0;chunks.forEach(c=>{if(c.mesh)nm++;});return{fps,chunks:chunks.size,meshed:nm,triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,updateMsAvg:+(perfUp.reduce((a,b)=>a+b,0)/Math.max(1,perfUp.length)).toFixed(2),updateMsMax:+Math.max(0,...perfUp).toFixed(1),zombies:zombies.length,animals:animals.length,drops:drops.length,particles:parts.length,time:timeOfDay,state,day:dayCount,rd:RD};},
    state:()=>state,
    target:()=>hit&&{x:hit.x,y:hit.y,z:hit.z,id:hit.id,nx:hit.nx,ny:hit.ny,nz:hit.nz,dist:hit.dist},
    breakBlock:(x,y,z)=>{breakBlockAt(Math.floor(x),Math.floor(y),Math.floor(z));flushSync();},
    key:(code,down)=>{keys[code]=!!down;},
    mouseDown:(b,down)=>{if(b===0)mouse.l=!!down;else mouse.r=!!down;},
    selectSlot:selectSlot,
    craft:(i)=>craft(RECIPES[i]),
    openInventory:(t)=>openInventory(!!t),closeInventory,pauseGame,resumeGame,
    heightAt,raycast,chunksMap:chunks,
    setFly:(on)=>{player.fly=!!on;return player.fly;},
    hurt:(n)=>hurtPlayer(n,undefined,undefined,true),
    input:()=>({l:mouse.l,r:mouse.r,locked,state,prog:mine.prog,key:mine.key,zHit:!!zHit,hit:!!hit}),
    timeInfo:'0=真夜中 0.25=日の出 0.5=正午 0.75=日没'
  });
}

// ============================================================
//  起動
// ============================================================
(function boot(){
  const save=readSave();
  setSeed(save?save.seed:20240915);
  const sp=findSpawn();menuCenter={x:sp.x,y:sp.y,z:sp.z};
  updateSettingsUI();updateTitleMeta();
  onResize();
  loadAroundSync(menuCenter.x,menuCenter.z,2);
  timeOfDay=.4;state='menu';setState('menu');
  update(.016);render();
  showLoading(false);
  requestAnimationFrame(frame);
})();
})();
