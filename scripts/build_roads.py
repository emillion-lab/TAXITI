#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Сваля пътната мрежа на София от OSM (Overpass) и пише компактен roads.json за sim-fleet.js.
Само пътища за коли (motorway..tertiary + unclassified) — без residential/service/footway,
така колите не минават през паркове и вътрешноквартални алеи. Спазва oneway.
Пази само най-голямата свързана компонента, за да не засядат коли на острови.
Формат: {"n":[lat*1e5, lng*1e5, ...], "a":[[изходящи съседи], ...]}"""
import json, math, sys, time, urllib.request, urllib.parse

BBOX = (42.615, 23.232, 42.750, 23.442)
HW = ('^(motorway|trunk|primary|secondary|tertiary|unclassified|'
      'motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$')
Q = ('[out:json][timeout:150];way["highway"~"%s"](%s,%s,%s,%s)->.w;'
     '.w out body;node(w.w);out skel qt;') % ((HW,) + BBOX)
MIRRORS = ['https://overpass-api.de/api/interpreter',
           'https://overpass.kumi.systems/api/interpreter',
           'https://overpass.private.coffee/api/interpreter']
STEP_M = 35   # междинни точки по-близо от това се изхвърлят (кръстовищата остават винаги)


def fetch():
    data = urllib.parse.urlencode({'data': Q}).encode()
    for u in MIRRORS:
        for _ in range(2):
            try:
                req = urllib.request.Request(u, data=data, headers={
                    'User-Agent': 'emillion-lab/TAXITI build_roads (GitHub Actions)'})
                with urllib.request.urlopen(req, timeout=200) as r:
                    return json.load(r)
            except Exception as e:
                print('Overpass fail', u, e)
                time.sleep(8)
    sys.exit('Overpass недостъпен от всички огледала')


def dist(a, b):
    return math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 81900)


def build(j):
    nodes = {e['id']: (e['lat'], e['lon']) for e in j['elements'] if e['type'] == 'node'}
    ways = [e for e in j['elements'] if e['type'] == 'way']
    use = {}
    for w in ways:
        last = len(w['nodes']) - 1
        for i, n in enumerate(w['nodes']):
            use[n] = use.get(n, 0) + (2 if i in (0, last) else 1)

    edges = set()
    for w in ways:
        t = w.get('tags', {})
        ow = t.get('oneway', 'no')
        if ow == 'no' and (t.get('junction') in ('roundabout', 'circular') or t.get('highway') == 'motorway'):
            ow = 'yes'
        ns = [n for n in w['nodes'] if n in nodes]
        if len(ns) < 2:
            continue
        if ow == '-1':
            ns, ow = ns[::-1], 'yes'
        one = ow in ('yes', 'true', '1')
        seq, last = [ns[0]], nodes[ns[0]]
        for k, n in enumerate(ns[1:], 1):
            p = nodes[n]
            if use.get(n, 0) > 1 or k == len(ns) - 1 or dist(last, p) >= STEP_M:
                seq.append(n)
                last = p
        for a, b in zip(seq, seq[1:]):
            if a != b:
                edges.add((a, b))
                if not one:
                    edges.add((b, a))

    # най-голяма (слабо) свързана компонента
    par = {}
    def find(x):
        par.setdefault(x, x)
        while par[x] != x:
            par[x] = par[par[x]]
            x = par[x]
        return x
    for a, b in edges:
        ra, rb = find(a), find(b)
        if ra != rb:
            par[ra] = rb
    size = {}
    for n in par:
        r = find(n)
        size[r] = size.get(r, 0) + 1
    big = max(size, key=size.get)
    ids = sorted(n for n in par if find(n) == big)
    idx = {n: i for i, n in enumerate(ids)}
    adj = [[] for _ in ids]
    for a, b in edges:
        if a in idx and b in idx:
            adj[idx[a]].append(idx[b])
    flat = []
    for n in ids:
        la, lo = nodes[n]
        flat += [round(la * 1e5), round(lo * 1e5)]
    return {'v': 1, 'src': 'OpenStreetMap contributors (ODbL)',
            'built': time.strftime('%Y-%m-%d'), 'n': flat, 'a': adj}, len(edges)


if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else None
    j = json.load(open(src)) if src else fetch()
    out, ne = build(j)
    n = len(out['n']) // 2
    if n < 1000 and not src:
        sys.exit('Твърде малко възли (%d) — нещо е счупено, не пиша' % n)
    s = json.dumps(out, separators=(',', ':'))
    open('roads.json', 'w').write(s)
    print('roads.json: %d възела, %d ребра общо, %d KB' % (n, ne, len(s) // 1024))
