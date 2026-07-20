/* TAXITI demo fleet — ОН/ОТ-СИТИТРАНС визуализация. Данни: demo-fleet.json (генерира се при import). */
(function(){
  var CSS='.dmk{border-radius:50%;border:2px solid #111;box-shadow:0 1px 4px rgba(0,0,0,.4)}'+
  '.dmk.on{background:#f5c518}.dmk.off{background:#9aa0a6;opacity:.75}'+
  '.dpop{font-family:sans-serif;min-width:190px}.dpop .av{font-size:30px;float:left;margin-right:8px}'+
  '.dpop b{font-size:14px}.dpop .sub{color:#555;font-size:12px;margin-top:2px}'+
  '.dpop .row{clear:both;padding-top:6px;font-size:12.5px}.dpop .st{font-weight:bold}'+
  '.dpop .st.on{color:#b8860b}.dpop .st.off{color:#777}';
  var st=document.createElement('style');st.textContent=CSS;document.head.appendChild(st);

  function ready(cb){
    var t=setInterval(function(){
      if(window.map&&window.map.addLayer&&window.L){clearInterval(t);cb();}
    },400);
    setTimeout(function(){clearInterval(t)},30000);
  }

  ready(function(){
    fetch('demo-fleet.json').then(function(r){return r.json()}).then(function(fleet){
      var layer=L.layerGroup();
      fleet.forEach(function(c){
        var cls='dmk '+(c.on?'on':'off');
        var mk=L.marker([c.lat,c.lng],{icon:L.divIcon({className:cls,iconSize:[12,12]}),
          zIndexOffset:c.on?0:-100});
        var html='<div class="dpop"><span class="av">'+c.av+'</span><b>'+c.n+'</b>'+
          '<div class="sub">'+c.m+' • '+c.p+'</div>'+
          '<div class="row">Фирма: '+(c.f==='ON'?'ОН-СИТИТРАНС':'ОТ-СИТИТРАНС')+'</div>'+
          '<div class="row">⭐ '+c.r+' • стаж '+c.y+' г.</div>'+
          '<div class="row">📞 нерегистриран</div>'+
          '<div class="row st '+(c.on?'on':'off')+'">'+(c.on?'● Онлайн':'○ Офлайн')+'</div></div>';
        mk.bindPopup(html);
        layer.addLayer(mk);
      });
      layer.addTo(window.map);
      console.log('[demo-fleet]',fleet.length,'cars');
    }).catch(function(e){console.warn('[demo-fleet]',e)});
  });
})();
