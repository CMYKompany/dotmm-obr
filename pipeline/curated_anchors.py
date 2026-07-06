"""Final curated cluster -> label table. All ambiguities resolved:
C#1=18 (8/3 confusion), C#6=20, D#4=27 demiplane interior, D#8=27 alcove,
E#8=35, E#14=28b, E#15=28c, rotated-S glyphs = secret doors."""
import json

clusters = {L: {c['idx']: c for c in v}
            for L, v in json.load(open('packs/clusters.json')).items()}

# idx -> (label, kind[, variant]) ; kind: room | secret | conn | skip
CURATION = {
'A': {1:('B','conn'),2:(None,'skip'),3:('6c','room'),4:('6a','room'),5:('6d','room'),
      6:('5','room'),7:('6b','room+secret'),8:('S','secret'),9:('4','room'),10:('1','room'),
      11:('22','room'),12:('S','secret'),13:('2a','room'),14:('2b','room'),15:('21','room'),
      16:('S','secret'),17:('23a','room'),18:('23b','room'),19:('3','room'),
      20:('D','conn'),21:('D','conn'),22:('23c','room')},
'B': {1:(None,'skip'),2:('expanded','conn'),3:('14c','room'),4:('S','secret'),5:('9b','room'),
      6:('14a','room'),7:('14b','room'),8:('9a','room'),9:('12','room'),10:('C','conn'),
      11:('8c','room'),12:('15','room'),13:('8a','room'),14:('8b','room'),15:('13','room'),
      16:('S','secret'),17:('10','room'),18:('S','secret'),19:('7a','room'),20:('11','room'),
      21:('S','secret'),22:('7b','room'),23:('A','conn')},
'C': {1:('18','room'),2:(None,'skip'),3:('B','conn'),4:('16','room'),5:('expanded','conn'),
      6:('20','room'),7:('17a','room'),8:('19a','room'),9:('17b','room'),10:('19b','room'),
      11:('19c','room')},
'D': {1:('A','conn'),2:('A','conn'),3:(None,'skip'),4:('27','room','demiplane'),5:('25a','room'),
      6:('24a','room'),7:('expanded','conn'),8:('27','room','alcove'),9:('24b','room'),10:('E','conn'),
      11:('25b','room'),12:('26b','room'),13:('26d','room'),14:('26a','room'),15:('26c','room')},
'E': {1:('32b','room'),2:('32a','room'),3:('30a','room'),4:('33','room'),5:('29','room'),
      6:('S','secret'),7:('30b','room'),8:('35','room'),9:('S','secret'),10:('34','room'),
      11:('31','room'),12:('S','secret'),13:('S','secret'),14:('28b','room'),15:('28c','room'),
      16:('28a','room'),17:('36b','room'),18:('36a','room'),19:('S','secret'),20:('36c','room'),
      21:('28d','room'),22:(None,'skip'),23:('D','conn'),24:('F','conn'),25:('F','conn')},
'F': {1:('E','conn'),2:('E','conn'),3:('39d','room'),4:('37','room'),5:('39c','room'),
      6:(None,'skip'),7:('S','secret'),8:('40','room'),9:('38','room'),10:('39b','room'),
      11:('S','secret'),12:('39a','room'),13:('41','room'),14:('level2','conn'),15:('expanded','conn')},
}

out = {}
for L, cur in CURATION.items():
    rooms, secrets, conns = [], [], []
    for idx, entry in cur.items():
        label, kind = entry[0], entry[1]
        variant = entry[2] if len(entry) > 2 else None
        c = clusters[L][idx]
        if kind == 'skip':
            continue
        if kind.startswith('room'):
            r = {'label': label, 'grid': c['grid']}
            if variant:
                r['variant'] = variant
            rooms.append(r)
            if kind == 'room+secret':
                secrets.append([round(c['grid'][0]-1.4, 2), c['grid'][1]])
        elif kind == 'secret':
            secrets.append(c['grid'])
        elif kind == 'conn':
            conns.append({'to': label, 'grid': c['grid']})
    out[L] = {'rooms': rooms, 'secret_doors': secrets, 'connectors': conns}
    print(L, [r['label'] + (f"({r['variant'][0]})" if 'variant' in r else '')
              for r in rooms])

json.dump(out, open('packs/anchors_curated.json', 'w'), indent=1)

# Inventory check
expected = (['1','2a','2b','3','4','5'] + [f'6{s}' for s in 'abcd'] + ['7a','7b'] +
            [f'8{s}' for s in 'abc'] + ['9a','9b'] + [str(n) for n in range(10,14)] +
            ['14a','14b','14c','15','16','17a','17b','18','19a','19b','19c','20','21','22'] +
            ['23a','23b','23c','24a','24b','25a','25b'] + [f'26{s}' for s in 'abcd'] +
            ['27'] + [f'28{s}' for s in 'abcd'] + ['29','30a','30b','31','32a','32b','33','34','35'] +
            ['36a','36b','36c','37','38'] + [f'39{s}' for s in 'abcd'] + ['40','41'])
have = set()
for L in out:
    have |= {r['label'] for r in out[L]['rooms']}
missing = [r for r in expected if r not in have]
extra = sorted(have - set(expected))
print('MISSING:', missing, '| EXTRA:', extra)
