(function(){
  var P=[{id:'nissin',title:'日進月歩',reading:'にっしんげっぽ'},{id:'isseki',title:'一石二鳥',reading:'いっせきにちょう'},{id:'shiku',title:'四苦八苦',reading:'しくはっく'}];
  function pic(t){var c=document.createElement('canvas');c.width=512;c.height=320;var g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,512,320);
    g.fillStyle='#ffe9a8';g.fillRect(20,230,200,70);g.fillStyle='#bfe3ff';g.fillRect(300,20,180,60);
    g.fillStyle='#000';g.font='900 110px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(t,256,160,480);return c.toDataURL('image/jpeg',.8);}
  function mk(t,r){return {w:8,h:8,heights:new Uint8Array(64),colors:new Uint8Array(192),treasure:{x:4,z:4},starts:[{x:0,z:0,dir:2},{x:7,z:7,dir:0}],title:t,reading:r,picture:pic(t)};}
  window.MapGen={presets:P,fromPreset:function(id){var p=P.filter(function(x){return x.id===id})[0];return mk(p.title,p.reading);},
    fromFile:function(f){return new Promise(function(res){setTimeout(function(){res(mk('えのなまえ','よみこんだ え'));},500);});},
    fromCanvas:function(c,t,r){return mk(t,r);},
    encode:function(m){return {w:m.w,h:m.h,title:m.title,reading:m.reading,picture:m.picture,treasure:m.treasure,starts:m.starts,heights:Array.from(m.heights),colors:Array.from(m.colors)};},
    decode:function(o){o.heights=new Uint8Array(o.heights);o.colors=new Uint8Array(o.colors);return o;}};
})();
