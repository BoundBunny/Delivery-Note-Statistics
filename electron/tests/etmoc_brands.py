import sys, re, json, time
sys.path.insert(0,'tests')
from etmoc_crawl import new_session, parse_items, BASE
BRANDS=['中华','芙蓉王','利群','黄鹤楼','玉溪','云烟','金圣','双喜','红塔山','七匹狼','南京','苏烟','泰山','红双喜','娇子','白沙','长白山','中南海','黄金叶','兰州','红梅','红河','大前门','三五']
s=new_session()
out={}
for b in BRANDS:
    allitems=[]
    try:
        r=s.get(BASE,params={'q':b,'entry':'1'},headers={'Referer':BASE},timeout=30)
        items=parse_items(r.text); allitems+=items
        pages=[int(x) for x in re.findall(r'\?page=(\d+)',r.text)]
        maxp=max(pages) if pages else 1
        for p in range(2,min(maxp,40)+1):
            time.sleep(0.25)
            rp=s.get(BASE,params={'q':b,'entry':'1','page':p},headers={'Referer':BASE},timeout=30)
            pi=parse_items(rp.text)
            if not pi: break
            allitems+=pi
    except Exception as e:
        print('ERR',b,e,file=sys.stderr)
    # dedupe by id
    seen={}; 
    for it in allitems: seen[it['id']]=it
    out[b]={'maxpage':maxp if 'maxp' in dir() else 1,'items':list(seen.values())}
    print(b,'pages',out[b]['maxpage'],'items',len(out[b]['items']),file=sys.stderr)
    time.sleep(0.3)
open('.tmp-etmoc-brands.json','w',encoding='utf-8').write(json.dumps(out,ensure_ascii=False,indent=1))
print('DONE',len(out))
