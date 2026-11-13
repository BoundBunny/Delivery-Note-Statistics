import json, re, unicodedata
names_raw = '''金钗
雨花石
金润发
爱喜
梦都
炫赫门
云龙
长白山777
苏堤春晓
中华
黄鹤楼
云烟
雪莲
红双喜
黄金叶
软包小黄鹤楼
小南海
小泰山
大前门
细烟卷
黄鹤楼1916
软包大中华
黄鹤楼116
云烟云烟100
长白山
黄鹤楼117
软包红南京
软包白南京
泰山
长白山
云烟云烟150
软包黄鹤楼126
软包南京
软包黄鹤楼101
软包云烟101
软包黄鹤楼103
软包云烟105
软包南京
长白山
云烟云烟160
软包中华
黄鹤楼131
软包黄鹤楼127
软包南京107
长白山107
云烟云烟170
软包黄鹤楼129
软包云烟155
泰山
红南京107'''.split('\n')
def norm(s):
    s=unicodedata.normalize('NFKC',s).lower()
    s=re.sub(r'[（）()【】\[\]·\s]', '', s)
    return s
d=json.load(open('.tmp-etmoc-brands.json',encoding='utf-8'))
items=[]
for brand,v in d.items():
    for it in v.get('items',[]):
        items.append(it)
def code(it, kind):
    for c in it.get('codes',[]):
        if kind in c['type']:
            return c['code']
    return ''
out=[]
for raw in names_raw:
    n=norm(raw)
    exact=[it for it in items if norm(it['name'])==n]
    if exact:
        pick=exact
        kind='exact'
    else:
        # 去掉开头的品牌名再做包含匹配（如“小黄鹤楼”“软包红南京”）
        cand=[it for it in items if n and (n in norm(it['name']) or (len(norm(it['name']))>=3 and norm(it['name']) in n))]
        pick=cand
        kind='fuzzy'
    out.append((raw,kind,pick))
with open('.tmp-cust-match.txt','w',encoding='utf-8') as f:
    for raw,kind,pick in out:
        if not pick:
            f.write(f'{raw}\tNO_MATCH\t\t\n'); continue
        for i,it in enumerate(pick[:6]):
            f.write(f'{raw}\t{kind}\t{it["name"]}\t{code(it,"小盒")} | {code(it,"条盒")}\t{it["url"]}\n')
print('done', len(out), 'no_match', sum(1 for _,_,p in out if not p), 'multi', sum(1 for _,_,p in out if len(p)>1))
