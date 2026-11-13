import json, difflib, re
d=json.load(open('.tmp-etmoc-search.json',encoding='utf-8'))
def N(s):
    s=s.replace('（','(').replace('）',')').replace('　','').replace(' ','')
    s=s.replace('香烟','')
    return s
lines=[]
for seed,info in d.items():
    items=info['items']
    cand=[]
    for it in items:
        score=difflib.SequenceMatcher(None,N(seed).lower(),N(it['name']).lower()).ratio()
        # bonus if normalized equal
        if N(seed).lower()==N(it['name']).lower(): score=1.0
        cand.append((score,it))
    cand.sort(key=lambda x:-x[0])
    lines.append('### '+seed+'   (query='+info['query']+', hits='+str(len(items))+')')
    for score,it in cand[:3]:
        codes='; '.join(c['type']+'='+c['code'] for c in it['codes']) or '无条码'
        lines.append('  %.2f | %s | %s | %s'%(score,it['name'],codes,it['url']))
    if not items: lines.append('  (no hits)')
open('.tmp-match.txt','w',encoding='utf-8').write('\n'.join(lines))
print('written',len(lines))
