import re, json
raw=open('.tmp-etmoc.html','rb').read().decode('utf-8')
# pagination
pages=[int(x) for x in re.findall(r'\?page=(\d+)',raw)]
print('maxpage',max(pages) if pages else 1,'page_links',len(pages))
# forms
for f in re.findall(r'<form[^>]*>',raw): print('FORM',f)
for inp in re.findall(r'<input[^>]*>',raw)[:20]: print('INPUT',inp)
# parse products
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
            m=re.search(r'(小盒条码|条盒条码|条形码)[：:]\s*(\d{8,14})',re.sub('<[^>]+>','',p))
            if m: codes.append({'type':m.group(1),'code':m.group(2)})
        items.append({'id':pid_m.group(1) if pid_m else None,'name':name,'specs':specs,'codes':codes})
out={'maxpage':max(pages) if pages else 1,'items':items}
open('.tmp-etmoc-page1.json','w',encoding='utf-8').write(json.dumps(out,ensure_ascii=False,indent=1))
print('items',len(items))
