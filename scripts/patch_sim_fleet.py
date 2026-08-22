#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Превключва index.html от статичния demo-fleet.js към живия sim-fleet.js.
Идемпотентен. index.html е 154 KB и не се качва цял — само този един ред се сменя."""
import io, sys

PATH = 'index.html'
OLD = '<script src="demo-fleet.js"></script>'
NEW = '<script src="sim-fleet.js"></script>'

h = io.open(PATH, encoding='utf-8').read()

if NEW in h:
    print('already applied')
    sys.exit(0)

if h.count(OLD) != 1:
    print('ANCHOR NOT FOUND (matches: %d)' % h.count(OLD))
    sys.exit(1)

io.open(PATH, 'w', encoding='utf-8').write(h.replace(OLD, NEW))
print('patched: index.html вече зарежда sim-fleet.js')
