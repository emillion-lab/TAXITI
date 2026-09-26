#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Боядисва снимките на моделите като таксита: жълто, а EV/хибриди — зелено.
Колата се изрязва от фона с U2-Net (rembg); боядисва се само ламарината —
стъкла, гуми, решетки (тъмните пиксели) и фонът остават непокътнати.
Яркостта се нормализира спрямо медианата на каросерията, така че и синя,
и бяла кола излизат в един и същи тон, а сенките и отблясъците се пазят.

Избор на кадър: за всеки модел се търсят до ~12 снимки в Commons ("<модел> taxi", "<модел>")
плюс водещата от Wikipedia. Предпочита се кадър, в който колата вече е цветна (ако е жълта/зелена —
още по-добре): там боядисването по нюанс на ламарината е чисто. Бели/сиви коли — само ако няма друго.

Изключение: за модели в FORCE_LOCAL това търсене исторически е връщало грешно поколение на модела
(винтидж, ръждиво, чужд пазар) вместо реалната кола — за тях пропускаме Commons търсенето и
боядисваме директно локалния кадър, който build_car_photos.py вече е взел коректно от Wikipedia.
Изход: img/cars/taxi/<slug>.jpg + index.json полета t, eco, by, lic, url (кредитът е на избрания кадър)."""
import html, io, json, os, re, sys, time, urllib.parse, urllib.request
import numpy as np
from PIL import Image, ImageFilter
from rembg import remove, new_session

SRC = 'img/cars'
DST = 'img/cars/taxi'
YELLOW = (245, 197, 24)   # такси жълто, както на картата
GREEN = (38, 176, 92)     # еко такси
ECO = ('tesla', 'ioniq', 'prius')   # по име на файла

# Модели, за които Commons "<модел> taxi" / "<модел>" търсенето подбира грешно поколение
# (Шкода Октавия -> класиката от 1959-71; Опел Астра -> старо ръждиво западноафр. такси) —
# проверено визуално 26.09.2026. Не пипа опашка на пресни грешки, само тези две.
FORCE_LOCAL = {'skoda-octavia.jpg', 'opel-astra.jpg'}


def _blur(x, r):
    im = Image.fromarray((np.clip(x, 0, 1) * 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255.0


def analyse(img, session):
    """Маска + признаци за избор на кадър."""
    im = img.convert('RGB')
    a = np.asarray(im).astype(np.float32) / 255.0
    H, W = a.shape[:2]
    mask = np.asarray(remove(im, session=session, only_mask=True, post_process_mask=True)).astype(np.float32) / 255.0
    car = mask > 0.5
    n = int(car.sum())
    if n < 800:
        return None
    ys, xs = np.nonzero(car)
    bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    o1 = a[..., 0] - a[..., 1]; o2 = (a[..., 0] + a[..., 1]) / 2 - a[..., 2]
    chroma = np.sqrt(o1 ** 2 + o2 ** 2); hue = np.arctan2(o2, o1)
    sel = car & (a.max(-1) > 0.08)
    ch = float(np.median(chroma[sel]))
    hs = hue[sel & (chroma > 0.10)]
    ref = float(np.arctan2(np.median(np.sin(hs)), np.median(np.cos(hs)))) if hs.size else 0.0
    dh = np.abs(np.angle(np.exp(1j * (hue - ref))))
    coh = float(((dh < 0.5) & (chroma > 0.10) & car).sum()) / n      # дял „боядисана" ламарина
    return {'im': im, 'mask': mask, 'area': n / float(H * W), 'aspect': bw / float(bh),
            'cropped': (xs.min() <= 1 and xs.max() >= W - 2), 'chroma': ch, 'hue': ref, 'coh': coh}


def hue_of(rgb):
    r, g, b = [c / 255.0 for c in rgb]
    return float(np.arctan2((r + g) / 2 - b, r - g))


def score(f, rgb):
    if f is None or f['cropped'] or not (0.12 <= f['area'] <= 0.85) or not (1.1 <= f['aspect'] <= 3.4):
        return -1
    sc = f['area']
    if f['chroma'] > 0.12 and f['coh'] > 0.30:
        sc += 3 + f['coh']
        if abs(np.angle(np.exp(1j * (f['hue'] - hue_of(rgb))))) < 0.35:
            sc += 2                                   # вече е жълта/зелена
    return sc


def paint(img, rgb, session, feat=None):
    im = img.convert('RGB')
    a = np.asarray(im).astype(np.float32) / 255.0
    H, W = a.shape[:2]
    mask = feat['mask'] if feat else np.asarray(remove(im, session=session, only_mask=True, post_process_mask=True)).astype(np.float32) / 255.0
    car = mask > 0.5
    if car.sum() < 800:
        return None
    ys, xs = np.nonzero(car)
    y0, y1 = ys.min(), ys.max()
    L = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    # цветност (chroma) и нюанс в опростено противоцветно пространство
    o1 = a[..., 0] - a[..., 1]
    o2 = (a[..., 0] + a[..., 1]) / 2 - a[..., 2]
    chroma = np.sqrt(o1 ** 2 + o2 ** 2)
    hue = np.arctan2(o2, o1)
    # текстура: локално стандартно отклонение (джанти, решетки, отражения в стъкла)
    m1 = _blur(L, 2.0); m2 = _blur(L * L, 2.0)
    tex = np.sqrt(np.maximum(m2 - m1 * m1, 0))
    smooth = np.clip(1 - (tex - 0.035) / 0.05, 0, 1)

    sel = car & (L > 0.08)
    colored = np.median(chroma[sel]) > 0.12
    if colored:
        # цветна кола: боядисваме само пикселите в цвета на ламарината
        hs = hue[sel & (chroma > 0.10)]
        ref = np.arctan2(np.median(np.sin(hs)), np.median(np.cos(hs)))
        dh = np.abs(np.angle(np.exp(1j * (hue - ref))))
        w = np.clip(1 - (dh - 0.35) / 0.3, 0, 1) * np.clip((chroma - 0.05) / 0.06, 0, 1)
        bodyL = L[car & (w > 0.5)]
        med = np.median(bodyL) if bodyL.size else np.median(L[sel])
    else:
        # бяла/сива/черна кола: стъклата са по-тъмни от ламарината и стоят горе;
        # джантите и решетките са текстурирани
        tex3 = np.sqrt(np.maximum(_blur(L * L, 3.0) - _blur(L, 3.0) ** 2, 0))
        smooth = np.clip(1 - (tex3 - 0.05) / 0.06, 0, 1)
        base = sel & (smooth > 0.6)
        med = np.median(L[base]) if base.any() else np.median(L[sel])
        rel0 = L / max(med, 1e-3)
        w = np.clip((rel0 - 0.50) / 0.2, 0, 1) * smooth * np.clip(1 - (chroma - 0.10) / 0.08, 0, 1)
        yy = np.arange(H)[:, None] * np.ones((1, W))
        upper = np.clip((y0 + 0.45 * (y1 - y0) - yy) / (0.05 * (y1 - y0) + 1), 0, 1)
        glass = upper * np.clip((0.92 - rel0) / 0.12, 0, 1)      # горе И по-тъмно = стъкло
        w *= 1 - glass
        # плътни области: запълваме дупките, махаме петната
        w = np.clip((_blur(w * mask, 4.0) - 0.35) / 0.3, 0, 1)
    w = _blur(w * mask, 1.0) * mask
    rel = L / max(med, 1e-3)
    target = np.array(rgb, np.float32) / 255.0
    col = np.clip(target * np.clip(rel, 0, 1.6)[..., None] ** 0.85, 0, 1)
    hl = np.clip((rel - 1.25) / 0.4, 0, 1)[..., None]           # отблясъците остават светли
    col = col * (1 - hl) + np.maximum(col, a) * hl
    out = a * (1 - w[..., None]) + col * w[..., None]
    return Image.fromarray((out * 255).astype(np.uint8))


UA = 'TAXITI-pilot/1.0 (https://github.com/emillion-lab/TAXITI) python-urllib'


def get(url, raw=False):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        b = r.read()
    return b if raw else json.loads(b)


def commons(**q):
    q.update(format='json')
    return get('https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(q))


def strip_html(x):
    return html.unescape(re.sub(r'<[^>]+>', '', x or '')).strip()


def local_attribution(url0):
    """Дърпа Artist/License за вече свалената локална снимка (url0), за да не изгубим атрибуцията
    когато боядисваме локалния кадър вместо да търсим нов в Commons (виж FORCE_LOCAL)."""
    name = urllib.parse.unquote(url0.rsplit('File:', 1)[-1]).replace('_', ' ')
    m = commons(action='query', prop='imageinfo', iiprop='extmetadata', titles='File:' + name)
    cp = next(iter(m.get('query', {}).get('pages', {}).values()), {})
    md = (cp.get('imageinfo') or [{}])[0].get('extmetadata', {})
    return (strip_html(md.get('Artist', {}).get('value'))[:60] or 'Wikimedia Commons',
            strip_html(md.get('LicenseShortName', {}).get('value')))


def candidates(title, lead_url):
    short = re.sub(r'\s+(\d{4}|t\d+)$', '', re.sub(r'\s*\(.*\)', '', title), flags=re.I)
    names = []
    if lead_url:
        names.append(urllib.parse.unquote(lead_url.rsplit('File:', 1)[-1]).replace('_', ' '))
    for q in ('"%s" taxi' % short, '"%s"' % short):
        try:
            r = commons(action='query', list='search', srnamespace=6, srlimit=8, srsearch=q + ' filetype:bitmap')
            names += [x['title'].split(':', 1)[1] for x in r.get('query', {}).get('search', [])]
        except Exception as e:
            print('  search fail', q, e)
        time.sleep(0.5)
    seen, out = set(), []
    for n in names:
        if n not in seen and re.search(r'\.(jpe?g|png)$', n, re.I):
            seen.add(n); out.append(n)
    out = out[:12]
    if not out:
        return []
    r = commons(action='query', prop='imageinfo', iiprop='url|extmetadata|size', iiurlwidth=500,
                titles='|'.join('File:' + n for n in out))
    res = []
    for p in r.get('query', {}).get('pages', {}).values():
        ii = (p.get('imageinfo') or [{}])[0]
        md = ii.get('extmetadata', {})
        lic = strip_html(md.get('LicenseShortName', {}).get('value'))
        if not ii.get('thumburl') or not lic or re.search(r'fair use|non-free', lic, re.I) or ii.get('width', 0) < 640:
            continue
        name = p['title'].split(':', 1)[1]
        res.append({'name': name, 'thumb': ii['thumburl'], 'lic': lic, 'lead': bool(names) and name == names[0],
                    'by': strip_html(md.get('Artist', {}).get('value'))[:60] or 'Wikimedia Commons',
                    'url': 'https://commons.wikimedia.org/wiki/File:' + urllib.parse.quote(name.replace(' ', '_'))})
    return res


def main(only=None):
    os.makedirs(DST, exist_ok=True)
    idx = json.load(io.open(os.path.join(SRC, 'index.json'), encoding='utf-8'))
    by_file = {}
    for raw, v in idx.items():
        by_file.setdefault(v.get('f0') or v['f'], []).append(raw)
    session = new_session('u2net')
    ok = clean = 0
    for f, raws in sorted(by_file.items()):
        if only and f not in only:
            continue
        v0 = idx[raws[0]]
        title = v0.get('title') or os.path.splitext(f)[0].replace('-', ' ')
        rgb = GREEN if any(k in f for k in ECO) else YELLOW
        best, bs, bf = None, -9, None
        if f in FORCE_LOCAL:
            url0 = v0.get('url0') or v0.get('url')
            try:
                img = Image.open(os.path.join(SRC, f))
                bf = analyse(img, session)
                by, lic = local_attribution(url0)
                best, bs = {'name': f, 'by': by, 'lic': lic, 'url': url0}, 0
            except Exception as e:
                print('  локален кадър fail', f, e)
        else:
            try:
                cands = candidates(title, v0.get('url0') or v0.get('url'))
            except Exception as e:
                print('  candidates fail', e); cands = []
            for c in cands:
                try:
                    img = Image.open(io.BytesIO(get(c['thumb'], raw=True)))
                    ft = analyse(img, session)
                except Exception as e:
                    print('  skip', c['name'], e); continue
                sc = score(ft, rgb) + (0.3 if c['lead'] else 0)
                if sc > bs:
                    best, bs, bf = c, sc, ft
                time.sleep(0.3)
        if best is None or bs < 0:
            print('%-34s без подходящ кадър — оставям оригинала' % f); continue
        out = paint(bf['im'], rgb, session, bf)
        name = os.path.splitext(f)[0] + '.jpg'
        out.save(os.path.join(DST, name), 'JPEG', quality=84, optimize=True)
        colored = bs >= 3
        clean += colored
        for r in raws:
            v = idx[r]
            v.setdefault('f0', v['f']); v.setdefault('url0', v['url'])
            v.update({'t': 'taxi/' + name, 'eco': rgb == GREEN, 'by': best['by'], 'lic': best['lic'], 'url': best['url']})
        ok += 1
        print('%-34s %s  score %.2f  %s' % (f, 'цветна' if colored else 'бяла/сива', bs, best['name'][:50]))
    io.open(os.path.join(SRC, 'index.json'), 'w', encoding='utf-8').write(
        json.dumps(idx, ensure_ascii=False, separators=(',', ':')))
    print('таксита: %d, от цветен кадър: %d' % (ok, clean))


if __name__ == '__main__':
    main(set(sys.argv[1:]) or None)
