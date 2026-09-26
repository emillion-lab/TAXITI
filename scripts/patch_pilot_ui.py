#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pilot v2 UI за TAXITI index.html. Идемпотентен, с точни котви (index.html не се качва цял).
- тъмна карта в тъмна тема (същият филтър като fish.taxi)
- +/- под банера, картата запълва екрана, долният списък е скрит
- собствените маркери (Емил/Петър) са скрити от картата (window.SHOW_OWN_MARKERS=true ги връща)
- текстово лого вместо липсващия img/header_logo.png"""
import io, sys

PATH = 'index.html'
PILOT_CSS = '''/* PILOT-V2 */
[data-theme="dark"] .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.85) contrast(.9) saturate(.6)}
[data-theme="dark"] .leaflet-container{background:#1c1c1c!important}
[data-theme="dark"] .leaflet-control-zoom a{background:#1a1a1a!important;color:#f0f0f0!important;border-color:#2e2e2e!important}
#map .leaflet-top.leaflet-right{top:62px}
#page-map #map{flex:1 1 auto;height:auto!important;min-height:260px}
#map-list{display:none!important}
'''
R = [
    ('css',
     '.leaflet-popup-tip{background:var(--s2)!important}\n',
     '.leaflet-popup-tip{background:var(--s2)!important}\n' + PILOT_CSS, 1),
    ('logo',
     '<img src="img/header_logo.png" style="height:44px;object-fit:contain;display:block" alt="TAXITI">',
     '<div class="logo" style="font-size:21px;font-weight:900;letter-spacing:1px;color:#f5c518">TAXI<span style="color:#fff">TI</span></div>', 1),
    ('own-markers',
     '  mkrs.forEach(function(m){try{m.remove();}catch(e){}});mkrs=[];\n  DRIVERS.forEach(function(d){\n    var ic=carI(d);',
     '  mkrs.forEach(function(m){try{m.remove();}catch(e){}});mkrs=[];\n'
     '  if(!window.SHOW_OWN_MARKERS)return; // пилот: собствените маркери са скрити от картата\n'
     '  DRIVERS.forEach(function(d){\n    var ic=carI(d);', 1),
    ('center',
     '      DRIVERS.forEach(function(d){if(d.lat&&d.lng)pts.push([d.lat,d.lng]);});\n',
     '      if(window.SHOW_OWN_MARKERS)DRIVERS.forEach(function(d){if(d.lat&&d.lng)pts.push([d.lat,d.lng]);});\n', 1),
    ('version', 'TAXITI v2026.07.13-d', 'TAXITI v2026.09.26-pilot', 1),
    ('version-log', "build v2026.07.13-d", "build v2026.09.26-pilot", 1),
]

h = io.open(PATH, encoding='utf-8').read()
bad = 0
for name, old, new, n in R:
    if new in h:
        print('ok (вече е):', name)
        continue
    c = h.count(old)
    if c != n:
        print('КОТВАТА НЕ Е НАМЕРЕНА:', name, '(съвпадения: %d)' % c)
        bad += 1
        continue
    h = h.replace(old, new)
    print('patched:', name)
if bad:
    sys.exit(1)
io.open(PATH, 'w', encoding='utf-8').write(h)
