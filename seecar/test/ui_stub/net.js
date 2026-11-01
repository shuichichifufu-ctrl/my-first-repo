// 仮のNet: 同じブラウザの別タブ同士を BroadcastChannel でつなぐ
(function(){
  var bc=new BroadcastChannel('seecar-stub'),id=Math.random().toString(36).slice(2),H={open:[],data:[],close:[],error:[]},role=null,code=null,peer=null;
  function emit(n,a){H[n].forEach(function(f){f(a)});}
  var N={isHost:false,connected:false,makeCode:function(){return '4821'},
    host:function(c){role='host';code=c;N.isHost=true;return Promise.resolve();},
    join:function(c){role='join';code=c;return new Promise(function(res,rej){
      var t=setTimeout(function(){var e=new Error('その ばんごうの へやが みつからないよ。ばんごうを たしかめてね');e.code='peer-unavailable';rej(e);},1500);
      bc.postMessage({k:'join',code:c,from:id});
      N._ok=function(){clearTimeout(t);N.connected=true;res();emit('open');};});},
    send:function(o){if(!N.connected)return false;bc.postMessage({k:'d',to:peer,from:id,o:JSON.parse(JSON.stringify(o))});return true;},
    on:function(n,f){H[n].push(f)},close:function(){if(N.connected)bc.postMessage({k:'bye',to:peer,from:id});N.connected=false;role=null;}};
  bc.onmessage=function(ev){var m=ev.data;if(m.from===id)return;
    if(m.k==='join'&&role==='host'&&m.code===code&&!N.connected){peer=m.from;N.connected=true;bc.postMessage({k:'ok',to:m.from,from:id});emit('open');}
    else if(m.k==='ok'&&m.to===id){peer=m.from;N._ok&&N._ok();}
    else if(m.k==='d'&&m.to===id)emit('data',m.o);
    else if(m.k==='bye'&&m.to===id){N.connected=false;emit('close');}};
  window.Net=N;
})();
