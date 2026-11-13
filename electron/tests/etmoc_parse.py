import re
raw=open('.tmp-etmoc.html','rb').read()
for enc in ['utf-8','gbk','gb18030']:
    try:
        t=raw.decode(enc)
        print('DECODED',enc,'len',len(t),'title',re.search(r'<title>(.*?)</title>',t,re.S).group(1).strip()[:80])
        break
    except Exception as e:
        print('fail',enc,e)
print('---')
m=re.search(r'<div class="col-8">(.*?)</div>\s*</div>',t,re.S)
print('col8 found',bool(m))
seg=m.group(1) if m else ''
print(seg[:3000])
print('--- whole body text sample ---')
# show all 13 digit sequences
codes=re.findall(r'\b69\d{11}\b',t)
print('codes',len(codes),codes[:20])
print('links sample')
for href,label in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>',t,re.S)[:40]:
    lab=re.sub('<[^>]+>','',label).strip()
    if lab: print(href,'|',lab[:40])
