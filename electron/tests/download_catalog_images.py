import json,re,os,sys,time,html,threading
import requests
sys.path.insert(0,'tests')
from etmoc_crawl import UA,BASE,new_session
from concurrent.futures import ThreadPoolExecutor, as_completed
OUT='.tmp-catalog-img'; os.makedirs(OUT,exist_ok=True)
raw=json.load(open('.tmp-etmoc-brands.json',encoding='utf-8'))
items=[]; seen=set()
for brand,obj in raw.items():
    for it in obj['items']:
        if it['id'] in seen: continue
        seen.add(it['id'])
        it['brand']=brand; items.append(it)
print('unique items',len(items))
tls=threading.local()
def sess():
    if not hasattr(tls,'s'): tls.s=new_session()
    return tls.s
def work(it):
    iid=it['id']; path=os.path.join(OUT,iid+'.jpg')
    if os.path.exists(path) and os.path.getsize(path)>1000: return (iid,'cached')
    s=sess()
    try:
        r=s.get(it['url'],headers={'Referer':BASE},timeout=30)
        m=re.search(r'<img[^>]+src="([^"]+)"',r.text)
        if not m: return (iid,'noimg')
        src=m.group(1)
        if src.startswith('/'): src='http://www.etmoc.com'+src
        im=s.get(src,headers={'Referer':it['url'],'Accept':'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'},timeout=30)
        if im.status_code!=200 or 'image' not in (im.headers.get('Content-Type') or ''):
            return (iid,'bad%s'%im.status_code)
        open(path,'wb').write(im.content)
        return (iid,'ok')
    except Exception as e:
        return (iid,'err:'+type(e).__name__)
ok=0; fails=[]
with ThreadPoolExecutor(max_workers=6) as ex:
    futs=[ex.submit(work,it) for it in items]
    for n,f in enumerate(as_completed(futs),1):
        iid,st=f.result()
        if st in ('ok','cached'): ok+=1
        else: fails.append((iid,st))
        if n%100==0: print('progress',n,'ok',ok,'fail',len(fails),flush=True)
# enrich catalog with parsed meta
def parse_meta(it):
    codes={c['type']:c['code'] for c in it.get('codes',[])}
    box=codes.get('小盒条码') or codes.get('条形码') or ''
    cart=codes.get('条盒条码') or ''
    specs=[re.sub(r'\s+',' ',html.unescape(x)).strip() for x in it.get('specs',[])]
    price=None
    for sp in specs:
        m=re.search(r'(\d+(?:\.\d+)?)\s*元/条',sp)
        if m: price=float(m.group(1)); break
    spec=''
    for sp in specs:
        if '条码' in sp: continue
        if '元/' in sp: continue
        spec=sp; break
    return {'id':it['id'],'brand':it['brand'],'name':html.unescape(it['name']),'box':box,'cart':cart,'price_tiao':price,'spec':spec,'url':it['url'],'img':os.path.exists(os.path.join(OUT,it['id']+'.jpg'))}
cat=[parse_meta(it) for it in items]
json.dump(cat,open('.tmp-catalog.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)
print('DONE',len(cat),'ok',ok,'fails',len(fails))
print('first',json.dumps(cat[0],ensure_ascii=False))
print('no price',sum(1 for c in cat if not c['price_tiao']))

