/* TAXITI — пилот: флот ОН/ОТ-СИТИТРАНС върху реалната пътна мрежа.
   roads.json идва от scripts/build_roads.py (OSM/Overpass, workflow "Pilot v2").
   Колите се движат само по пътища; паркираните стоят по стоянки и пред молове.
   Натискане на кола → долен лист (bottom sheet); "Поръчай" → шофьорът няма публикуван контакт.
   Без roads.json: показват се само паркираните коли (нищо не минава през паркове). */
(function(){
'use strict';

/* ---------- НАСТРОЙКИ (пипа се само тук) ---------- */
var CFG={
  tick:1000, speed:[22,48], maxMarkers:220,
  pOffline:0.50,      // дял от целия флот офлайн (не се чертае)
  pParked:0.75,       // от онлайн частта — дял на стоянка
  pGoOnline:0.0006,   // офлайн → стоянка, на тик
  pGoOffline:0.0008,  // стоянка → офлайн (= pGoOnline/pParked, пази ~50% офлайн)
  pLeave:0.0015,      // стоянка → на пътя
  pPark:0.0045,       // на пътя → стоянка (пази ~75% от онлайн паркирани)
  standRadius:350     // м — паркираните се разпределят по пътни възли около стоянката
};
var TARIFF={start:0.60, km:1.20, kmNight:1.45, cur:'€'};
var STANDS=[ // стоянки, гари, молове, болници, летище
 [42.6953,23.4062],[42.6881,23.3950],[42.7118,23.3212],[42.6853,23.3192],[42.6964,23.3217],
 [42.6906,23.3350],[42.6920,23.3532],[42.6571,23.3142],[42.6628,23.3842],[42.6981,23.3080],
 [42.6640,23.2882],[42.6788,23.3277],[42.6258,23.3740],[42.6873,23.3057],[42.6716,23.3231]
];
var STR={
 bg:{live:'живо',road:'на пътя',park:'на стоянка',off:'офлайн',exp:'стаж',yrs:'г.',tariff:'Тарифа',
     start:'старт',night:'нощна',km:'/км',order:'🚕 Поръчай',away:'мин',
     noContact:'Този шофьор все още не е публикувал данни за контакт в TAXITI, затова поръчката не може да бъде изпратена.',
     seeVerified:'Виж шофьори с публикуван контакт',close:'Затвори'},
 en:{live:'live',road:'on the road',park:'at a stand',off:'offline',exp:'exp.',yrs:'yrs',tariff:'Tariff',
     start:'start',night:'night',km:'/km',order:'🚕 Order',away:'min',
     noContact:'This driver has not published contact details on TAXITI yet, so the order cannot be sent.',
     seeVerified:'See drivers with published contact',close:'Close'}
};
function S(){return STR[window.lang]||STR.en;}

/* ---------- Геометрия ---------- */
function distM(a,b,c,d){var x=(c-a)*111320,y=(d-b)*81900;return Math.sqrt(x*x+y*y);}
function bearing(a,b,c,d){return Math.atan2((d-b)*81900,(c-a)*111320)*180/Math.PI;}
function rand(n){return Math.floor(Math.random()*n);}
function rndSpeed(){return (CFG.speed[0]+Math.random()*(CFG.speed[1]-CFG.speed[0]))/3.6;} // м/с
function isNight(){var h=new Date().getHours();return h>=22||h<6;}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch];});}

/* ---------- Пътен граф ---------- */
var G=null, CELL=0.004, standNodes=[];
function cellKey(i,j){return i+':'+j;}
function loadRoads(){
  return fetch('roads.json',{cache:'no-cache'}).then(function(r){if(!r.ok)throw new Error(r.status);return r.json();})
  .then(function(j){
    var n=j.n.length/2, lat=new Float64Array(n), lng=new Float64Array(n), grid={}, live=[], i;
    for(i=0;i<n;i++){lat[i]=j.n[2*i]/1e5;lng[i]=j.n[2*i+1]/1e5;}
    for(i=0;i<n;i++){
      var k=cellKey(Math.floor(lat[i]/CELL),Math.floor(lng[i]/CELL));
      (grid[k]||(grid[k]=[])).push(i);
      if(j.a[i].length)live.push(i);
    }
    G={lat:lat,lng:lng,adj:j.a,grid:grid,live:live};
    console.log('[sim-fleet] пътна мрежа:',n,'възела');
  }).catch(function(e){G=null;console.warn('[sim-fleet] няма roads.json — само паркирани коли',e);});
}
function nodesNear(lat,lng,r){
  var out=[],k=Math.ceil(r/300),ci=Math.floor(lat/CELL),cj=Math.floor(lng/CELL);
  for(var di=-k;di<=k;di++)for(var dj=-k;dj<=k;dj++){
    var arr=G.grid[cellKey(ci+di,cj+dj)]; if(!arr)continue;
    for(var q=0;q<arr.length;q++){var i=arr[q];
      if(G.adj[i].length&&distM(lat,lng,G.lat[i],G.lng[i])<r)out.push(i);}
  }
  return out;
}
function nearestNode(lat,lng){
  for(var r=300;r<=2400;r*=2){
    var c=nodesNear(lat,lng,r); if(!c.length)continue;
    var best=c[0],bd=1e12;
    for(var q=0;q<c.length;q++){var d=distM(lat,lng,G.lat[c[q]],G.lng[c[q]]);if(d<bd){bd=d;best=c[q];}}
    return best;
  }
  return G.live[rand(G.live.length)];
}
function segLen(a,b){return distM(G.lat[a],G.lng[a],G.lat[b],G.lng[b]);}
function segBrg(a,b){return bearing(G.lat[a],G.lng[a],G.lat[b],G.lng[b]);}
function pickNext(b,prev){           // предпочита да продължи напред, рядко обръща
  var o=G.adj[b]; if(!o||!o.length)return -1;
  if(o.length===1)return o[0];
  var hin=prev>=0?segBrg(prev,b):null, ws=[], tot=0, k;
  for(k=0;k<o.length;k++){
    var w;
    if(o[k]===prev)w=0.05;
    else if(hin===null)w=1;
    else{var d=Math.abs(((segBrg(b,o[k])-hin)+540)%360-180);w=1+3*Math.max(0,Math.cos(d*Math.PI/180));}
    ws.push(w);tot+=w;
  }
  var r=Math.random()*tot;
  for(k=0;k<o.length;k++){r-=ws[k];if(r<=0)return o[k];}
  return o[o.length-1];
}

/* ---------- Коли ---------- */
var cars=[], layer=null, hud=null;

function placeAtStand(c){
  var si=rand(STANDS.length), s=STANDS[si], cand=standNodes[si];
  if(G&&cand&&cand.length){
    var i=cand[rand(cand.length)];
    c.lat=G.lat[i]+(Math.random()-.5)*0.00012; c.lng=G.lng[i]+(Math.random()-.5)*0.00016;
    c.hdg=segBrg(i,G.adj[i][0]);
  } else {
    c.lat=s[0]+(Math.random()-.5)*0.0010; c.lng=s[1]+(Math.random()-.5)*0.0014;
  }
  c.jump=true;
}
function park(c){c.state='parked';placeAtStand(c);}
function startDriving(c,node){
  if(!G)return park(c);
  var nx=pickNext(node,-1);
  if(nx<0){node=G.live[rand(G.live.length)];nx=pickNext(node,-1);}
  c.state='road'; c.a=node; c.b=nx; c.t=0; c.len=segLen(node,nx)||1; c.spd=rndSpeed();
  c.lat=G.lat[node]; c.lng=G.lng[node]; c.hdg=segBrg(node,nx);
}
function makeCar(src){
  var c={n:src.n,m:src.m,p:src.p,f:src.f,av:src.av,r:src.r,y:src.y,
         lat:0,lng:0,hdg:Math.random()*360,rot:0,state:'offline',a:-1,b:-1,t:0,len:1,spd:rndSpeed(),mk:null,jump:false};
  var u=Math.random();
  if(u<CFG.pOffline){c.state='offline';placeAtStand(c);}
  else if(!G||Math.random()<CFG.pParked)park(c);
  else{startDriving(c,G.live[rand(G.live.length)]);c.t=Math.random()*c.len;}
  c.rot=c.hdg; return c;
}
function step(c,dt){
  if(c.state==='offline'){if(Math.random()<CFG.pGoOnline)park(c);return;}
  if(c.state==='parked'){
    if(Math.random()<CFG.pGoOffline){c.state='offline';return;}
    if(G&&Math.random()<CFG.pLeave){startDriving(c,nearestNode(c.lat,c.lng));c.jump=true;}
    return;
  }
  if(Math.random()<CFG.pPark){park(c);return;}
  if(Math.random()<0.06)return;                    // светофар / задръстване
  c.t+=c.spd*dt;
  var guard=0;
  while(c.t>=c.len&&guard++<25){
    c.t-=c.len;
    var nx=pickNext(c.b,c.a);
    if(nx<0){startDriving(c,G.live[rand(G.live.length)]);c.jump=true;return;}  // задънена еднопосочна
    c.a=c.b; c.b=nx; c.len=segLen(c.a,c.b)||1;
  }
  var f=Math.min(1,c.t/c.len);
  c.lat=G.lat[c.a]+(G.lat[c.b]-G.lat[c.a])*f;
  c.lng=G.lng[c.a]+(G.lng[c.b]-G.lng[c.a])*f;
  c.hdg=segBrg(c.a,c.b);
}

/* ---------- Стил ---------- */
var CSS=
'.tcar{transition:transform 1s linear;will-change:transform}'+
'.tz-noanim .tcar{transition:none!important}'+
'.tcar .tc-rot{width:14px;height:24px;transition:transform .6s ease-out;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.55))}'+
'.tcar svg{display:block}.tcar.parked .tc-rot{opacity:.82}'+
'#thud{position:absolute;left:10px;top:10px;z-index:650;max-width:calc(100% - 20px);background:rgba(10,10,10,.86);'+
'-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);color:#eee;border:1px solid rgba(245,197,24,.35);border-radius:12px;'+
'padding:7px 11px;font:600 12px/1.45 system-ui,-apple-system,sans-serif;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.35)}'+
'#thud b{color:#f5c518;font-size:13px}#thud .mu{color:#9a9a9a}'+
'#tsh-bg{position:fixed;inset:0;z-index:1400;display:none}#tsh-bg.on{display:block}'+
'#tsheet{position:fixed;left:0;right:0;bottom:0;z-index:1401;max-width:560px;margin:0 auto;background:var(--s1,#fff);color:var(--tx,#111);'+
'border-radius:20px 20px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.35);padding:8px 16px calc(16px + env(safe-area-inset-bottom,0px));'+
'transform:translateY(105%);transition:transform .28s cubic-bezier(.2,.8,.2,1);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}'+
'#tsheet.on{transform:none}'+
'.tsh-grab{width:40px;height:5px;border-radius:3px;background:var(--brd,#ccc);margin:2px auto 12px}'+
'.tsh-head{display:flex;align-items:center;gap:12px}'+
'.tsh-av{width:52px;height:52px;border-radius:50%;background:var(--s2,#eee);display:flex;align-items:center;justify-content:center;font-size:30px;flex-shrink:0}'+
'.tsh-id{flex:1;min-width:0}.tsh-name{font-size:17px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
'.tsh-sub{font-size:13px;color:var(--mu,#666);margin-top:2px}'+
'.tsh-eta{font-size:13px;font-weight:800;background:#f5c518;color:#111;border-radius:10px;padding:6px 9px;white-space:nowrap}'+
'.tsh-chips{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 8px}'+
'.tsh-chips span{font-size:12px;font-weight:700;padding:4px 9px;border-radius:999px;background:var(--s2,#eee);border:1px solid var(--brd,#ddd)}'+
'.tsh-tariff{font-size:13px;color:var(--mu,#666);margin-bottom:12px}'+
'.tsh-order{width:100%;border:none;border-radius:12px;padding:14px;font-size:16px;font-weight:900;background:#f5c518;color:#111;cursor:pointer}'+
'.tsh-note{background:var(--s2,#f5f5f5);border:1px solid var(--brd,#ddd);border-left:4px solid #f5c518;border-radius:10px;padding:11px 12px;font-size:14px;line-height:1.45;margin-bottom:10px}'+
'.tsh-sec{width:100%;border:none;border-radius:12px;padding:12px;font-size:15px;font-weight:800;background:var(--tx,#111);color:var(--s1,#fff);cursor:pointer;margin-bottom:8px}'+
'.tsh-close{width:100%;border:1px solid var(--brd,#ddd);border-radius:12px;padding:11px;font-size:14px;font-weight:700;background:transparent;color:var(--tx,#111);cursor:pointer}';
var st=document.createElement('style'); st.textContent=CSS; document.head.appendChild(st);

var CAR_SVG='<svg width="14" height="24" viewBox="0 0 20 34">'+
  '<rect x="2" y="2" width="16" height="30" rx="6" fill="#f5c518" stroke="#111" stroke-width="1.6"/>'+
  '<rect x="4.5" y="8.5" width="11" height="6" rx="2" fill="#1f1f1f"/>'+
  '<rect x="4.5" y="22.5" width="11" height="4" rx="1.5" fill="#1f1f1f"/></svg>';

/* ---------- Рисуване ---------- */
function draw(){
  var map=window.map, b=map.getBounds().pad(0.1), shown=0;
  for(var i=0;i<cars.length;i++){
    var c=cars[i];
    var vis=c.state!=='offline'&&shown<CFG.maxMarkers&&b.contains([c.lat,c.lng]);
    if(vis&&c.jump&&c.mk){layer.removeLayer(c.mk);c.mk=null;}   // телепорт → без плъзгане през картата
    c.jump=false;
    if(!vis){if(c.mk){layer.removeLayer(c.mk);c.mk=null;}continue;}
    shown++;
    c.rot+=((c.hdg-c.rot+540)%360)-180;                           // най-късото завъртане
    if(!c.mk){
      c.mk=L.marker([c.lat,c.lng],{icon:L.divIcon({className:'tcar',iconSize:[14,24],iconAnchor:[7,12],
        html:'<div class="tc-rot" style="transform:rotate('+c.rot.toFixed(0)+'deg)">'+CAR_SVG+'</div>'})});
      (function(cc){cc.mk.on('click',function(){openSheet(cc);});})(c);
      layer.addLayer(c.mk);
    } else {
      c.mk.setLatLng([c.lat,c.lng]);
    }
    var el=c.mk.getElement();
    if(el){
      el.classList.toggle('parked',c.state==='parked');
      var r=el.firstChild; if(r)r.style.transform='rotate('+c.rot.toFixed(0)+'deg)';
    }
  }
}
function drawHud(){
  var road=0,park=0,off=0;
  for(var i=0;i<cars.length;i++){var s=cars[i].state;if(s==='road')road++;else if(s==='parked')park++;else off++;}
  var t=S();
  hud.innerHTML='<b>СИТИТРАНС</b> <span class="mu">· '+t.live+'</span><br>'+
    '🚕 '+road+' '+t.road+' · 🅿️ '+park+' '+t.park+' <span class="mu">· '+t.off+' '+off+'</span>';
}

/* ---------- Долен лист ---------- */
var sheet=null, sheetBg=null;
function buildSheet(){
  sheetBg=document.createElement('div'); sheetBg.id='tsh-bg';
  sheet=document.createElement('div'); sheet.id='tsheet';
  sheetBg.addEventListener('click',closeSheet);
  document.body.appendChild(sheetBg); document.body.appendChild(sheet);
}
function closeSheet(){sheet.classList.remove('on');sheetBg.classList.remove('on');}
function openSheet(c){
  var t=S(), night=isNight(), rate=night?TARIFF.kmNight:TARIFF.km;
  var firm=c.f==='ON'?'ОН-СИТИТРАНС':'ОТ-СИТИТРАНС', eta='';
  if(window.userLat&&window.userLng){
    var km=distM(c.lat,c.lng,window.userLat,window.userLng)/1000*1.35;
    if(km<30)eta='<div class="tsh-eta">~'+Math.max(2,Math.round(km/25*60+1))+' '+t.away+'</div>';
  }
  sheet.innerHTML='<div class="tsh-grab"></div>'+
    '<div class="tsh-head"><div class="tsh-av">'+esc(c.av)+'</div>'+
    '<div class="tsh-id"><div class="tsh-name">'+esc(c.n)+'</div><div class="tsh-sub">'+esc(c.m)+' · '+esc(c.p)+'</div></div>'+eta+'</div>'+
    '<div class="tsh-chips"><span>'+firm+'</span><span>⭐ '+esc(c.r)+'</span><span>'+t.exp+' '+esc(c.y)+' '+t.yrs+'</span></div>'+
    '<div class="tsh-tariff">'+t.tariff+': '+TARIFF.cur+TARIFF.start.toFixed(2)+' '+t.start+' + '+TARIFF.cur+rate.toFixed(2)+t.km+(night?' ('+t.night+')':'')+'</div>'+
    '<div id="tsh-act"><button class="tsh-order" type="button">'+t.order+'</button></div>';
  sheet.querySelector('.tsh-order').addEventListener('click',function(){orderBlocked();});
  sheetBg.classList.add('on'); sheet.classList.add('on');
  if(window.track)window.track('pilot_sheet');
}
function orderBlocked(){
  var t=S(), act=document.getElementById('tsh-act');
  act.innerHTML='<div class="tsh-note">ℹ️ '+t.noContact+'</div>'+
    '<button class="tsh-sec" type="button">'+t.seeVerified+'</button>'+
    '<button class="tsh-close" type="button">'+t.close+'</button>';
  act.querySelector('.tsh-sec').addEventListener('click',function(){closeSheet();if(window.showTab)window.showTab('list');});
  act.querySelector('.tsh-close').addEventListener('click',closeSheet);
  if(window.track)window.track('pilot_order_blocked');   // мерим търсенето по време на пилота
}

/* ---------- Старт ---------- */
function ready(cb){
  var t=setInterval(function(){if(window.map&&window.map.addLayer&&window.L){clearInterval(t);cb();}},400);
  setTimeout(function(){clearInterval(t);},30000);
}
ready(function(){
  var map=window.map;
  Promise.all([fetch('demo-fleet.json').then(function(r){return r.json();}),loadRoads()]).then(function(res){
    if(G)standNodes=STANDS.map(function(s){return nodesNear(s[0],s[1],CFG.standRadius);});
    cars=res[0].map(makeCar);
    layer=L.layerGroup().addTo(map);
    hud=document.createElement('div'); hud.id='thud';
    (document.getElementById('map')||document.body).appendChild(hud);
    buildSheet();
    var box=map.getContainer();
    map.on('zoomstart',function(){box.classList.add('tz-noanim');});
    map.on('zoomend',function(){setTimeout(function(){box.classList.remove('tz-noanim');},50);});
    setInterval(function(){
      if(document.hidden)return;
      for(var i=0;i<cars.length;i++)step(cars[i],CFG.tick/1000);
      draw(); drawHud();
    },CFG.tick);
    draw(); drawHud();
    console.log('[sim-fleet] pilot v2:',cars.length,'коли',G?'по пътна мрежа':'(без пътна мрежа)');
  }).catch(function(e){console.warn('[sim-fleet]',e);});
});
})();
