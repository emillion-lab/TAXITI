#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Реални снимки на моделите от флота (demo-fleet.json) — от Wikipedia/Wikimedia Commons.
Взима водещата снимка на статията за модела, само ако файлът е в Commons (свободен лиценз);
локални non-free файлове от en.wikipedia се пропускат. Пази 400px миниатюри в img/cars/
и img/cars/index.json: {"<модел както е в регистъра>": {"f","by","lic","url"}}.
Моделите в регистъра са с правописни грешки — нормализират се по ключови думи (RULES)."""
import html, io, json, os, re, sys, time, unicodedata, urllib.parse, urllib.request

UA = 'TAXITI-pilot/1.0 (https://github.com/emillion-lab/TAXITI) python-urllib'
OUT = 'img/cars'
RULES = [  # подредбата има значение: по-специфичните първи
    ('хсийд', 'Kia XCeed'), ('киасеед', 'Kia Ceed'), ('киасиид', 'Kia Ceed'),
    ('авео', 'Chevrolet Aveo'), ('кубо', 'Fiat Fiorino'), ('фиорино', 'Fiat Fiorino'),
    ('фабия', 'Škoda Fabia'), ('логан', 'Dacia Logan'), ('сандеро', 'Dacia Sandero'),
    ('кадди', 'Volkswagen Caddy'), ('кади', 'Volkswagen Caddy'), ('черато', 'Kia Cerato'),
    ('атос', 'Hyundai Atos'), ('дъстер', 'Dacia Duster'), ('рапид', 'Škoda Rapid (2012)'),
    ('и30', 'Hyundai i30'), ('типо', 'Fiat Tipo (2015)'), ('астра', 'Opel Astra'),
    ('елантра', 'Hyundai Elantra'), ('лантра', 'Hyundai Elantra'), ('аванте', 'Hyundai Elantra'),
    ('туран', 'Volkswagen Touran'), ('и10', 'Hyundai i10'), ('к5', 'Kia K5'),
    ('матиз', 'Daewoo Matiz'), ('октавия', 'Škoda Octavia'), ('зафира', 'Opel Zafira'),
    ('соната', 'Hyundai Sonata'), ('соника', 'Hyundai Sonata'), ('акцент', 'Hyundai Accent'),
    ('и20', 'Hyundai i20'), ('корса', 'Opel Corsa'), ('лоджи', 'Dacia Lodgy'),
    ('сценик', 'Renault Scénic'), ('меган', 'Renault Mégane'), ('панда', 'Fiat Panda'),
    ('докер', 'Dacia Dokker'), ('пасат', 'Volkswagen Passat'), ('круз', 'Chevrolet Cruze'),
    ('калос', 'Chevrolet Aveo (T200)'), ('кона', 'Hyundai Kona'), ('207', 'Peugeot 207'),
    ('206', 'Peugeot 206'), ('308', 'Peugeot 308'), ('леон', 'SEAT León'),
    ('ксара', 'Citroën Xsara Picasso'), ('ц3пикасо', 'Citroën C3 Picasso'), ('ц4', 'Citroën C4'),
    ('моделс', 'Tesla Model S'), ('модел3', 'Tesla Model 3'), ('такума', 'Daewoo Tacuma'),
    ('рио', 'Kia Rio'), ('браво', 'Fiat Bravo (2007)'), ('голф', 'Volkswagen Golf'),
    ('гранта', 'Lada Granta'), ('айоник', 'Hyundai Ioniq'), ('спарк', 'Chevrolet Spark'),
    ('клио', 'Renault Clio'), ('пиканто', 'Kia Picanto'), ('лачети', 'Chevrolet Lacetti'),
    ('мажентис', 'Kia Optima'), ('флуанс', 'Renault Fluence'), ('артеон', 'Volkswagen Arteon'),
    ('мерцедесе', 'Mercedes-Benz E-Class'), ('мерцедесб', 'Mercedes-Benz B-Class'),
    ('корола', 'Toyota Corolla'), ('ярис', 'Toyota Yaris'), ('приус', 'Toyota Prius'),
    ('суифт', 'Suzuki Swift'), ('алто', 'Suzuki Alto'), ('вагонр', 'Suzuki Wagon R'),
    ('лансер', 'Mitsubishi Lancer'), ('смакс', 'Ford S-Max'), ('бмакс', 'Ford B-Max'),
    ('каплюс', 'Ford Ka'), ('к7', 'Kia Cadenza'), ('стоник', 'Kia Stonic'),
    ('импреза', 'Subaru Impreza'), ('румстър', 'Škoda Roomster'), ('практик', 'Škoda Roomster'),
    ('мока', 'Opel Mokka'), ('поло', 'Volkswagen Polo'), ('ибиза', 'SEAT Ibiza'),
    ('гетц', 'Hyundai Getz'), ('соул', 'Kia Soul'), ('крома', 'Fiat Croma'),
    ('пунто', 'Fiat Punto'), ('орландо', 'Chevrolet Orlando'),
]


def norm(s):
    s = s.lower().replace('щ', 'ш').replace('мати3', 'матиз').replace('3афира', 'зафира')
    s = s.replace(' ', '').replace('фоллкс', 'фолкс').replace('хондай', 'хюндай')
    return s.replace('аксент', 'акцент').replace('клйо', 'клио')


def title_for(model):
    n = norm(model)
    for key, title in RULES:
        if key in n:
            return title
    return None


def slug(t):
    t = unicodedata.normalize('NFKD', t).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', t.lower()).strip('-')


def get(url, raw=False):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        b = r.read()
    return b if raw else json.loads(b)


def api(host, **q):
    q.update(format='json')
    return get('https://%s/w/api.php?%s' % (host, urllib.parse.urlencode(q)))


def strip_html(s):
    return html.unescape(re.sub(r'<[^>]+>', '', s or '')).strip()


def photo(title):
    j = api('en.wikipedia.org', action='query', redirects=1, prop='pageimages',
            piprop='thumbnail|name', pithumbsize=400, titles=title)
    page = next(iter(j.get('query', {}).get('pages', {}).values()), {})
    name, thumb = page.get('pageimage'), page.get('thumbnail', {}).get('source')
    if not name or not thumb:
        return None, 'няма водеща снимка'
    m = api('commons.wikimedia.org', action='query', prop='imageinfo',
            iiprop='extmetadata', titles='File:' + name)
    cp = next(iter(m.get('query', {}).get('pages', {}).values()), {})
    if 'missing' in cp or not cp.get('imageinfo'):
        return None, 'файлът не е в Commons (вероятно non-free) — пропуснат'
    md = cp['imageinfo'][0].get('extmetadata', {})
    lic = strip_html(md.get('LicenseShortName', {}).get('value'))
    if not lic or re.search(r'fair use|non-free', lic, re.I):
        return None, 'несвободен лиценз: %s' % lic
    by = strip_html(md.get('Artist', {}).get('value'))[:60] or 'Wikimedia Commons'
    ext = os.path.splitext(urllib.parse.urlparse(thumb).path)[1].lower() or '.jpg'
    f = slug(title) + ext
    open(os.path.join(OUT, f), 'wb').write(get(thumb, raw=True))
    return {'f': f, 'by': by, 'lic': lic,
            'url': 'https://commons.wikimedia.org/wiki/File:' + urllib.parse.quote(name.replace(' ', '_'))}, 'ok'


def main():
    os.makedirs(OUT, exist_ok=True)
    fleet = json.load(io.open('demo-fleet.json', encoding='utf-8'))
    models = sorted({(c.get('m') or '').strip() for c in fleet if c.get('m')})
    titles, unmapped = {}, []
    for m in models:
        t = title_for(m)
        if t: titles.setdefault(t, []).append(m)
        else: unmapped.append(m)
    idx = {}
    for t, raws in sorted(titles.items()):
        try:
            rec, why = photo(t)
        except Exception as e:
            rec, why = None, 'грешка: %s' % e
        print('%-28s %s' % (t, why))
        if rec:
            for r in raws: idx[r] = rec
        time.sleep(1)
    io.open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8').write(
        json.dumps(idx, ensure_ascii=False, separators=(',', ':')))
    print('модели: %d, със снимка: %d, без правило: %s' % (len(models), len(idx), unmapped))
    if len(idx) < 20:
        sys.exit('твърде малко снимки — нещо е счупено')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--dry':
        fleet = json.load(io.open('demo-fleet.json', encoding='utf-8'))
        ms = sorted({(c.get('m') or '').strip() for c in fleet if c.get('m')})
        miss = [m for m in ms if not title_for(m)]
        cars = sum(1 for c in fleet if title_for((c.get('m') or '').strip()))
        print('модели:', len(ms), 'без правило:', miss, '| коли с правило: %d/%d' % (cars, len(fleet)))
        print('заглавия:', len({title_for(m) for m in ms if title_for(m)}))
    else:
        main()
