(function(){
  var h={},box,cv,paused=false,cam=1,info='';
  window.__world=[];
  function draw(){if(!cv)return;var w=box.clientWidth||300,hh=box.clientHeight||150;cv.width=w;cv.height=hh;var g=cv.getContext('2d');
    var gr=g.createLinearGradient(0,0,0,hh);gr.addColorStop(0,'#7fc8ff');gr.addColorStop(1,'#9bd88a');g.fillStyle=gr;g.fillRect(0,0,w,hh);
    g.fillStyle='#222';g.font=(hh/12)+'px sans-serif';g.fillText('(仮の3D) '+info+' cam='+cam+(paused?' PAUSED':''),w*0.3,hh*0.5);}
  window.World={isPaused:false,
    init:function(el){box=el;cv=document.createElement('canvas');el.appendChild(cv);draw();},
    load:function(m,o){info=m.title+' my='+o.myIndex+' net='+o.net;window.__world.push('load');},
    start:function(){window.__world.push('start');draw();},stop:function(){window.__world.push('stop');},
    setPaused:function(b){paused=b;World.isPaused=b;window.__world.push('paused:'+b);draw();},
    press:function(a,d){window.__world.push('press:'+a+':'+d);},
    setCamera:function(m){cam=m;draw();},cycleCamera:function(){cam=(cam+1)%3;draw();return cam;},
    on:function(e,f){h[e]=f;},__emit:function(e,a){h[e]&&h[e](a);},
    applyRemoteState:function(i,s){window.__world.push('rs');},applyRemoteBoom:function(c){window.__world.push('rb');},remoteFound:function(i){window.__world.push('rf:'+i);}};
})();
