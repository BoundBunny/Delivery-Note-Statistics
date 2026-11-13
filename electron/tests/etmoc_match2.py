import json, difflib, re
pools=json.load(open('.tmp-etmoc-brands.json',encoding='utf-8'))
names=[l.strip() for l in open('.tmp-names.txt',encoding='utf-8').read().splitlines() if l.strip()]
def base(n):
    b=re.sub(r'[（(].*?[)）]','',n).strip()
    return b
def N(s):
    s=s.replace('（','(').replace('）',')').replace('　','').replace(' ','')
    s=s.replace('香烟','')
    return s.lower()
lines=[]; exact=[]; ambiguous=[]; none=[]
for seed in names:
    b=base(seed)
    pool=pools.get(b,{}).get('items',[])
    if not pool and b=='555': pool=pools.get('三五',{}).get('items',[])
    if not pool:
        # try find brand containing b or contained
        for k,v in pools.items():
            if b in k or k in b: pool=v['items']; break
    cand=[]
    for it in pool:
        ns,nn=N(seed),N(it['name'])
        score=1.0 if ns==nn else difflib.SequenceMatcher(None,ns,nn).ratio()
        # containment bonus
        if ns!=nn and (ns in nn or nn in ns): score=max(score,0.9)
        cand.append((score,it))
    cand.sort(key=lambda x:-x[0])
    lines.append('### %s  (brand=%s, pool=%d)'%(seed,b,len(pool)))
    for score,it in cand[:3]:
        codes='; '.join(c['type']+'='+c['code'] for c in it['codes']) or '无条码'
        lines.append('  %.3f | %s | %s | %s'%(score,it['name'],codes,it['url']))
    if not cand: lines.append('  (no pool)'); none.append(seed); continue
    top=cand[0]
    if top[0]>=0.999: exact.append((seed,top[1]))
    elif top[0]<0.85: none.append(seed)
open('.tmp-match2.txt','w',encoding='utf-8').write('\n'.join(lines))
print('exact',len(exact),'none/low',len(none),'total',len(names))
for seed,it in exact: print('EXACT',seed,'=>',it['name'])
