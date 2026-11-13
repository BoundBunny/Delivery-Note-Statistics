import json, re, os, time
ROOT = os.getcwd()
cat = json.load(open('.tmp-catalog-keep.json', encoding='utf-8'))
bs = open('webapp/js/bundled-images.js', encoding='utf-8').read()
old = json.loads(bs[bs.index('{'):bs.rindex('}') + 1])
orig = {k: v for k, v in old.items() if v.startswith('assets/products/p_') and os.path.exists('webapp/' + v)}

def norm(s):
    return re.sub(r'[（）()\s]', '', s.replace('香烟', ''))

oldn = {norm(k): v for k, v in orig.items()}
dl = {}
for c in json.load(open('.tmp-catalog.json', encoding='utf-8')):
    p = 'webapp/assets/products/em/%s.webp' % c['id']
    if c.get('img') and os.path.exists(p) and c['name'] not in dl:
        dl[c['name']] = 'assets/products/em/%s.webp' % c['id']
rep = {}
for b in {c['brand'] for c in cat}:
    cands = [(k, v) for k, v in orig.items() if k.startswith(b)]
    if not cands and b == '三五':
        cands = [(k, v) for k, v in orig.items() if k.startswith('555')]
    if cands:
        rep[b] = sorted(cands, key=lambda kv: len(kv[0]))[0][1]

mapping = {}
for c in cat:
    nm = c['name']
    if nm in mapping:
        continue
    p = 'webapp/assets/products/em/%s.webp' % c['id']
    if nm in dl:
        mapping[nm] = dl[nm]
    elif c.get('img') and os.path.exists(p):
        mapping[nm] = 'assets/products/em/%s.webp' % c['id']
    elif norm(nm) in oldn:
        mapping[nm] = oldn[norm(nm)]
    else:
        mapping[nm] = rep[c['brand']]

# merge into bundled images
old.update(mapping)
open('webapp/js/bundled-images.js', 'w', encoding='utf-8').write(
    'window.BUNDLED_IMAGES = ' + json.dumps(old, ensure_ascii=False, separators=(',', ':')) + ';\n')

# patch real product image fields
realp = os.path.join(os.environ['APPDATA'], 'songhuodan-desktop', '用户数据', 'sd_v1_products.json')
if os.path.exists(realp):
    real = json.load(open(realp, encoding='utf-8'))
    n = 0
    for x in real:
        if x.get('category') == 'tobacco' and x.get('name') in mapping:
            x['image'] = 'bundle:' + mapping[x['name']]
            n += 1
    json.dump(real, open(realp, 'w', encoding='utf-8'), ensure_ascii=False)

exact = sum(1 for v in mapping.values() if '/em/' in v)
print('mapped names', len(mapping), 'exact/downloaded', exact, 'brand-rep', len(mapping) - exact)
print('real patched', n if os.path.exists(realp) else 'no real')
