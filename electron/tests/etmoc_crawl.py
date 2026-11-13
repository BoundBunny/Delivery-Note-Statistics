import requests, re, json, time, sys
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
BASE='http://www.etmoc.com/Firms/Brands'
def hx(s): return ''.join(format(ord(c),'x') for c in s)
def new_session():
    s=requests.Session(); s.headers.update({'User-Agent':UA,'Accept':'text/html,application/xhtml+xml','Accept-Language':'zh-CN,zh;q=0.9'})
    s.get(BASE,timeout=30)
    s.cookies.set('srcurl',hx(BASE),domain='www.etmoc.com',path='/')
    s.get(BASE,params={'security_verify_data':hx('1920,1080')},headers={'Referer':BASE},timeout=30)
    s.cookies.clear(domain='www.etmoc.com',path='/',name='srcurl')
    r=s.get(BASE,headers={'Referer':BASE},timeout=30)
    assert 'col-8' in r.text, 'challenge failed'
    return s
def parse_items(raw):
    items=[]
    for block in re.findall(r'<ul class="detail list-p">(.*?)</ul>',raw,re.S):
        for li in re.findall(r'<li>(.*?)</li>',block,re.S):
            name_m=re.search(r'class="li-p-t">\s*<a[^>]*>(.*?)</a>',li,re.S)
            if not name_m: continue
            name=re.sub('<[^>]+>','',name_m.group(1)).strip()
            pid_m=re.search(r'Product\?Id=(\d+)',li)
            specs=[re.sub(r'\s+',' ',x).strip() for x in re.findall(r'<p>(.*?)</p>',li,re.S)]
            codes=[]
            for p in re.findall(r'<p>(.*?)</p>',li,re.S):
                txt=re.sub('<[^>]+>','',p)
                m=re.search(r'(小盒条码|条盒条码|条形码)[：:]\s*(\d{8,14})',txt)
                if m: codes.append({'type':m.group(1),'code':m.group(2)})
            items.append({'id':pid_m.group(1) if pid_m else None,'name':name,'specs':specs,'codes':codes,'url':'http://www.etmoc.com/Firms/Product?Id='+(pid_m.group(1) if pid_m else '')})
    return items
def search(s,q):
    r=s.get(BASE,params={'q':q,'entry':'1'},headers={'Referer':BASE},timeout=30)
    return parse_items(r.text)
if __name__=='__main__':
    if len(sys.argv)>1:
        names=[l.strip() for l in open(sys.argv[1],encoding='utf-8').read().splitlines() if l.strip()]
    else:
        names=[l.strip() for l in sys.stdin.read().splitlines() if l.strip()]
    s=new_session()
    out={}
    for i,n in enumerate(names):
        q=n
        try: items=search(s,q)
        except Exception as e: items=[]
        out[n]={'query':q,'items':items}
        print(i,n,q,'->',len(items),file=sys.stderr)
        time.sleep(0.4)
    open('.tmp-etmoc-search2.json','w',encoding='utf-8').write(json.dumps(out,ensure_ascii=False,indent=1))
    print('DONE',len(names))
