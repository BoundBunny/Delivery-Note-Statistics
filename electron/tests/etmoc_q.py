import sys,re
sys.path.insert(0,'tests')
from etmoc_crawl import new_session, parse_items, BASE
s=new_session()
for q in ['三五','555','希尔顿','万宝路']:
    r=s.get(BASE,params={'q':q,'entry':'1'},headers={'Referer':BASE},timeout=30)
    its=parse_items(r.text)
    print('Q',q,'max',max([int(x) for x in re.findall(r'\?page=(\d+)',r.text)] or [1]),'items',len(its))
    for it in its[:5]: print('   ',it['name'],'; '.join(c['code'] for c in it['codes']))
