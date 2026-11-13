import json,difflib,re
pools=json.load(open('.tmp-etmoc-brands.json',encoding='utf-8'))
names=[l.strip() for l in open('.tmp-names.txt',encoding='utf-8').read().splitlines() if l.strip()]
def base(n): return re.sub(r'[（(].*?[)）]','',n).strip()
def N(s):
    s=s.replace('（','(').replace('）',')').replace('　','').replace(' ','').replace('香烟','')
    return s.lower()
rows=[]
for seed in names:
    b=base(seed); pool=pools.get(b,{}).get('items',[])
    if not pool and b=='555': pool=pools.get('三五',{}).get('items',[])
    cand=[]
    for it in pool:
        ns,nn=N(seed),N(it['name'])
        sc=1.0 if ns==nn else difflib.SequenceMatcher(None,ns,nn).ratio()
        if ns!=nn and (ns in nn or nn in ns): sc=max(sc,.9)
        cand.append((sc,it))
    cand.sort(key=lambda x:-x[0])
    exacts=[it for sc,it in cand if sc>=0.999]
    if exacts:
        for it in exacts:
            rows.append([seed,it['name'],'; '.join(c['type']+'='+c['code'] for c in it['codes']),it['url'],'EXACT' if len(exacts)==1 else 'EXACT_MULTI'])
    else:
        top=cand[0] if cand else None
        rows.append([seed,top[1]['name'] if top else '',('; '.join(c['type']+'='+c['code'] for c in top[1]['codes'])) if top else '',top[1]['url'] if top else '',('%.3f'%top[0]) if top else 'NONE'])
import csv
with open('.tmp-exact.txt','w',encoding='utf-8',newline='') as f:
    f.write('seed\tsite_name\tcodes\turl\tstatus\n')
    for r in rows: f.write('\t'.join(r)+'\n')
print(len(rows),'rows')
