import json,difflib,re
pools=json.load(open('.tmp-etmoc-brands.json',encoding='utf-8'))
names=[l.strip() for l in open('.tmp-names.txt',encoding='utf-8').read().splitlines() if l.strip()]
def base(n): return re.sub(r'[（(].*?[)）]','',n).strip()
def N(s):
    s=s.replace('（','(').replace('）',')').replace('　','').replace(' ','').replace('香烟','')
    return s.lower()
ALIAS={'中华香烟（软）':'中华（软）','555（金色）':'三五（金）'}
def pool_for(seed):
    b=base(seed); p=pools.get(b,{}).get('items',[])
    if not p and seed=='中华香烟（软）': p=pools.get('中华',{}).get('items',[])
    if not p and b=='555': p=pools.get('三五',{}).get('items',[])
    return p
sel={}; skipped=[]
for seed in names:
    pool=pool_for(seed)
    if seed in ALIAS:
        target=N(ALIAS[seed]); cand=[it for it in pool if N(it['name'])==target]
    else:
        ns=N(seed); cand=[it for it in pool if N(it['name'])==ns]
    if len(cand)==1:
        it=cand[0]
        codes={c['type']:c['code'] for c in it['codes']}
        sel[seed]={'site':it['name'],'id':it['id'],'box':codes.get('小盒条码',''),'carton':codes.get('条盒条码',''),'url':it['url'],'reason':'alias' if seed in ALIAS else 'exact'}
    elif len(cand)>1:
        skipped.append((seed,'AMBIGUOUS '+str([c['name']+'#'+c['id'] for c in cand])))
    else:
        # best score for reference
        best=None;bs=0
        for it in pool:
            sc=difflib.SequenceMatcher(None,N(seed),N(it['name'])).ratio()
            if sc>bs: bs=sc;best=it
        skipped.append((seed,'NO_EXACT best=%.3f %s#%s'%(bs,best['name'],best['id']) if best else 'NO_POOL'))
# dedupe by site id: keep first, skip later
seen={}
for seed in list(sel):
    i=sel[seed]['id']
    if i in seen:
        skipped.append((seed,'DUP_SITE with '+seen[i]+' '+i)); del sel[seed]
    else: seen[i]=seed
json.dump({'selected':sel,'skipped':skipped},open('.tmp-map.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)
print('selected',len(sel),'skipped',len(skipped))
for s,v in sel.items(): print('OK',s,'->',v['site'],v['box'],v['carton'])
print('--- skipped ---')
for s,r in skipped: print('SKIP',s,r)
