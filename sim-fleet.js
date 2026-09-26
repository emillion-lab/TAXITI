/* TAXITI — жив флот на ОН/ОТ-СИТИТРАНС.
   Заменя статичния demo-fleet.js. Колите се движат в границите на града,
   вземат клиенти, изчезват докато возят и се връщат свободни.
   Данни за самоличност: demo-fleet.json (имена, номера, модели, рейтинг).
   Позициите от JSON-а НЕ се ползват — те бяха rand в правоъгълник.

   Състояния: offline (не се чертае) → parked (на стоянка/мол, неподвижна) →
   free/toclient/busy (движеща се "стрелка"). Преходите са вероятностни на тик,
   за да остане флотът "жив" около целевото разпределение. */
(function(){
'use strict';

/* ---------- НАСТРОЙКИ (пипа се само тук) ---------- */
var TARIFF={start:0.60, km:1.20, kmNight:1.45, waitMin:0.15, min:3.00, cur:'€'};
  // km/kmNight към горната граница на Наредбата на СОС за 2026 (макс. 1.24 дневна / 1.52 нощна)
var TICK=1000;            // ms между стъпките
var SPEED=[18,46];        // km/h диапазон
var P_GETS_RIDE=0.010;    // шанс свободна кола да поеме курс на тик
var RIDE_MIN=90, RIDE_MAX=600; // секунди курс
var TO_CLIENT=[20,90];    // секунди път до клиента
var MAX_MARKERS=260;      // рисуваме само видимите, за да не тежи на телефон

/* ---------- Разпределение на флота ---------- */
var P_OFFLINE=0.50;       // дял от ЦЕЛИЯ флот, който е офлайн (не се чертае изобщо)
var P_PARKED_OF_ONLINE=0.75; // от онлайн частта — дял, който стои по стоянки/молове
var P_GO_ONLINE=0.0006;   // офлайн → на стоянка (на тик)
var P_GO_OFFLINE=0.0006;  // на стоянка → офлайн (на тик)
var P_LEAVE_STAND=0.0018; // на стоянка → тръгва да обикаля (на тик)
var P_GO_PARK=0.0030;     // обикаля свободна → се прибира на най-близката стоянка (на тик)

/* ---------- Стоянки и молове в София (за паркираните коли) ---------- */
var STANDS=[
 [42.6953,23.4062],  // Летище София, Терминал 2
 [42.7021,23.3376],  // Централна гара
 [42.6853,23.3192],  // НДК
 [42.6975,23.3219],  // пл. Света Неделя / центъра
 [42.7196,23.3325],  // Сердика Център
 [42.6524,23.3090],  // Парадайс Център
 [42.6547,23.3169],  // The Mall София
 [42.6786,23.3013],  // Мол на София, Овча купел
 [42.6890,23.3350],  // Орлов мост
 [42.6402,23.3535],  // Ринг Мол
 [42.7105,23.3568],  // Дружба, Ботевградско шосе
 [42.6699,23.3898]   // Мега Мол, Цариградско шосе
];
function nearestStand(lat,lng){
  var best=STANDS[0], bd=1e9;
  for(var i=0;i<STANDS.length;i++){
    var d=distKm(lat,lng,STANDS[i][0],STANDS[i][1]);
    if(d<bd){bd=d; best=STANDS[i];}
  }
  return best;
}

/* ---------- Границите на София (приблизителен контур на града) ---------- */
var CITY=[
 [42.7480,23.3050],[42.7450,23.3600],[42.7200,23.4150],[42.6900,23.4400],
 [42.6600,23.4300],[42.6380,23.4000],[42.6180,23.3720],[42.6220,23.3250],
 [42.6420,23.2820],[42.6550,23.2520],[42.6800,23.2350],[42.7150,23.2400]
];
var CENTER=[42.6977,23.3219];

function inCity(lat,lng){
  var ins=false;
  for(var i=0,j=CITY.length-1;i<CITY.length;j=i++){
    var yi=CITY[i][0],xi=CITY[i][1],yj=CITY[j][0],xj=CITY[j][1];
    if(((yi>lat)!==(yj>lat))&&(lng<(xj-xi)*(lat-yi)/(yj-yi)+xi)) ins=!ins;
  }
  return ins;
}
function randInCity(){
  for(var t=0;t<200;t++){
    var lat=42.615+Math.random()*0.135, lng=23.232+Math.random()*0.210;
    if(inCity(lat,lng)) return [lat,lng];
  }
  return CENTER.slice();
}
function bearingTo(lat,lng,tlat,tlng){
  return Math.atan2(tlng-lng,tlat-lat)*180/Math.PI;
}
function distKm(a,b,c,d){
  var x=(c-a)*111.32, y=(d-b)*82.0; // 82 km/° на ширина 42.7°
  return Math.sqrt(x*x+y*y);
}
function isNight(){ var h=new Date().getHours(); return h>=22||h<6; }
function price(km,waitSec){
  var p=TARIFF.start+km*(isNight()?TARIFF.kmNight:TARIFF.km)+(waitSec/60)*TARIFF.waitMin;
  return Math.max(p,TARIFF.min);
}

/* ---------- Стил ---------- */
var CSS=
'.tcar{transition:transform .95s linear;will-change:transform}'+
'.tcar svg{display:block}'+
'.tcar.free .body{fill:#f5c518}'+
'.tcar.toclient .body{fill:#ff9f1c}'+
'.tcar.toclient{animation:tpulse 1.1s ease-in-out infinite}'+
'.tcar.parked .body{fill:#c9a227}'+
'.tcar.parked{opacity:.85}'+
'@keyframes tpulse{0%,100%{opacity:1}50%{opacity:.55}}'+
'.tpop{font-family:system-ui,sans-serif;min-width:210px;color:#111}'+
'.tpop .av{font-size:28px;float:left;margin-right:8px}'+
'.tpop b{font-size:14px}.tpop .sub{color:#555;font-size:12px;margin-top:2px}'+
'.tpop .row{clear:both;padding-top:5px;font-size:12.5px}'+
'.tpop .st{font-weight:800;letter-spacing:.3px}'+
'.tpop .st.free{color:#a07800}.tpop .st.toclient{color:#c25e00}.tpop .st.parked{color:#8a7000}'+
'#thud{position:absolute;left:10px;top:10px;z-index:650;background:#0a0a0aee;color:#f5c518;'+
'border:1px solid #f5c51855;border-radius:10px;padding:8px 11px;font:600 11.5px/1.5 system-ui,sans-serif;'+
'box-shadow:0 4px 14px #0007;pointer-events:none;letter-spacing:.2px}'+
'#thud b{color:#fff;font-size:13px}'+
'#thud .dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;vertical-align:1px}'+
'#thud .d1{background:#f5c518}#thud .d2{background:#ff9f1c}#thud .d3{background:#666}#thud .d4{background:#c9a227}';
var st=document.createElement('style'); st.textContent=CSS; document.head.appendChild(st);

function carSvg(){
  return '<svg width="18" height="18" viewBox="0 0 24 24">'+
    '<path class="body" d="M12 2 L18 21 L12 17.5 L6 21 Z" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/>'+
    '</svg>';
}

/* ---------- Състояние ---------- */
var cars=[], layer=null, hud=null, done=0, revenue=0;

function makeCar(src){
  var p=randInCity();
  var lat=p[0], lng=p[1], state;
  if(Math.random()<P_OFFLINE){
    state='offline';
  } else if(Math.random()<P_PARKED_OF_ONLINE){
    var s=STANDS[Math.floor(Math.random()*STANDS.length)];
    lat=s[0]; lng=s[1]; state='parked';
  } else {
    state=(Math.random()<0.30)?'busy':'free';
  }
  return {
    n:src.n, m:src.m, p:src.p, f:src.f, av:src.av, r:src.r, y:src.y,
    lat:lat, lng:lng,
    hdg:Math.random()*360,
    spd:SPEED[0]+Math.random()*(SPEED[1]-SPEED[0]),
    state:state,
    timer:Math.random()*120,
    km:0, fare:0, wait:0,
    mk:null
  };
}

function step(c){
  if(c.state==='offline'){
    if(Math.random()<P_GO_ONLINE){
      var s=STANDS[Math.floor(Math.random()*STANDS.length)];
      c.lat=s[0]; c.lng=s[1]; c.state='parked';
    }
    return;
  }
  if(c.state==='parked'){
    if(Math.random()<P_GO_OFFLINE){ c.state='offline'; return; }
    if(Math.random()<P_LEAVE_STAND){
      c.state='free';
      c.hdg=Math.random()*360;
      c.spd=SPEED[0]+Math.random()*(SPEED[1]-SPEED[0]);
    }
    return;
  }
  if(c.state==='free'&&Math.random()<P_GO_PARK){
    var s2=nearestStand(c.lat,c.lng);
    c.lat=s2[0]; c.lng=s2[1]; c.state='parked';
    return;
  }

  if(c.state==='busy'){
    c.timer-=TICK/1000;
    if(c.timer<=0){                       // остави клиента, връща се свободна
      var p=randInCity(); c.lat=p[0]; c.lng=p[1];
      done++; revenue+=c.fare;
      c.state='free'; c.fare=0; c.km=0; c.wait=0;
      c.spd=SPEED[0]+Math.random()*(SPEED[1]-SPEED[0]);
    }
    return;
  }

  // светофар / задръстване
  if(Math.random()<0.05){ c.wait+=TICK/1000; return; }

  var dist=c.spd*(TICK/1000)/3600;        // km за тик
  var rad=c.hdg*Math.PI/180;
  var nlat=c.lat+(dist/111.32)*Math.cos(rad);
  var nlng=c.lng+(dist/82.0)*Math.sin(rad);

  if(!inCity(nlat,nlng)){                 // стигна края на града — завива навътре
    c.hdg=bearingTo(c.lat,c.lng,CENTER[0],CENTER[1])+(Math.random()*70-35);
    return;
  }
  c.km+=dist; c.lat=nlat; c.lng=nlng;
  c.hdg+=(Math.random()*24-12);           // леко лъкатушене вместо права линия

  if(c.state==='toclient'){
    c.timer-=TICK/1000;
    if(c.timer<=0){                       // взе клиента → изчезва от картата
      c.state='busy';
      c.timer=RIDE_MIN+Math.random()*(RIDE_MAX-RIDE_MIN);
      c.fare=price(c.km+c.timer/3600*28, c.wait);
    }
  } else if(Math.random()<P_GETS_RIDE){   // приема поръчка
    c.state='toclient';
    c.timer=TO_CLIENT[0]+Math.random()*(TO_CLIENT[1]-TO_CLIENT[0]);
    c.km=0; c.wait=0;
  }
}

function popup(c){
  var firm=(c.f==='ON')?'ОН-СИТИТРАНС':'ОТ-СИТИТРАНС';
  var stTxt=(c.state==='toclient')?'● Пътува към клиент':(c.state==='parked'?'● На стоянка':'● Свободна');
  return '<div class="tpop"><span class="av">'+c.av+'</span><b>'+c.n+'</b>'+
    '<div class="sub">'+c.m+' • '+c.p+'</div>'+
    '<div class="row">Фирма: '+firm+'</div>'+
    '<div class="row">⭐ '+c.r+' • стаж '+c.y+' г.</div>'+
    '<div class="row">Тарифа: '+TARIFF.cur+TARIFF.start.toFixed(2)+' + '+
      TARIFF.cur+(isNight()?TARIFF.kmNight:TARIFF.km).toFixed(2)+'/км'+(isNight()?' (нощна)':'')+'</div>'+
    '<div class="row st '+c.state+'">'+stTxt+'</div></div>';
}

function draw(){
  var b=window.map.getBounds(), shown=0;
  for(var i=0;i<cars.length;i++){
    var c=cars[i];
    var vis=(c.state!=='busy')&&(c.state!=='offline')&&b.contains([c.lat,c.lng])&&shown<MAX_MARKERS;
    if(vis){
      shown++;
      var rot=(c.state==='parked')?0:c.hdg;
      if(!c.mk){
        c.mk=L.marker([c.lat,c.lng],{icon:L.divIcon({className:'tcar '+c.state,html:carSvg(),iconSize:[18,18],iconAnchor:[9,9]})});
        c.mk.bindPopup(popup(c)); layer.addLayer(c.mk);
      } else {
        c.mk.setLatLng([c.lat,c.lng]);
        var el=c.mk.getElement();
        if(el){
          el.className='tcar '+c.state+' leaflet-marker-icon leaflet-zoom-animated leaflet-interactive';
          var svg=el.querySelector('svg');
          if(svg) svg.style.transform='rotate('+rot.toFixed(0)+'deg)';
        }
        if(c.mk.isPopupOpen&&c.mk.isPopupOpen()) c.mk.setPopupContent(popup(c));
      }
    } else if(c.mk){
      layer.removeLayer(c.mk); c.mk=null;   // зает/офлайн = няма го на картата
    }
  }
}

function drawHud(){
  var free=0,toc=0,busy=0,parked=0,offline=0;
  for(var i=0;i<cars.length;i++){
    var s=cars[i].state;
    if(s==='free')free++; else if(s==='toclient')toc++; else if(s==='busy')busy++;
    else if(s==='parked')parked++; else offline++;
  }
  var avg=done?(revenue/done):0;
  hud.innerHTML='<b>СИТИТРАНС</b> • живо<br>'+
    '<span class="dot d1"></span>свободни '+free+
    ' <span class="dot d2"></span>към клиент '+toc+
    ' <span class="dot d3"></span>заети '+busy+
    ' <span class="dot d4"></span>на стоянка '+parked+'<br>'+
    'офлайн '+offline+' • курсове: '+done+' • средно '+TARIFF.cur+avg.toFixed(2)+(isNight()?' • нощна тарифа':'');
}

function ready(cb){
  var t=setInterval(function(){
    if(window.map&&window.map.addLayer&&window.L){clearInterval(t);cb();}
  },400);
  setTimeout(function(){clearInterval(t)},30000);
}

ready(function(){
  fetch('demo-fleet.json').then(function(r){return r.json()}).then(function(fleet){
    cars=fleet.map(makeCar);
    layer=L.layerGroup().addTo(window.map);
    hud=document.createElement('div'); hud.id='thud';
    (document.getElementById('map')||document.body).appendChild(hud);
    setInterval(function(){
      for(var i=0;i<cars.length;i++) step(cars[i]);
      draw(); drawHud();
    },TICK);
    draw(); drawHud();
    console.log('[sim-fleet]',cars.length,'коли, живи');
  }).catch(function(e){console.warn('[sim-fleet]',e)});
});
})();
