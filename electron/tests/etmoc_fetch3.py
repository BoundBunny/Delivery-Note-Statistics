import requests
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
url='http://www.etmoc.com/Firms/Brands'
def hx(s): return ''.join(format(ord(c),'x') for c in s)
s=requests.Session(); s.headers.update({'User-Agent':UA,'Accept':'text/html,application/xhtml+xml','Accept-Language':'zh-CN,zh;q=0.9'})
r=s.get(url,timeout=30)
s.cookies.set('srcurl',hx(url),domain='www.etmoc.com',path='/')
r2=s.get(url,params={'security_verify_data':hx('1920,1080')},headers={'Referer':url},timeout=30)
# emulate removeItem('srcurl') then reload base
s.cookies.clear(domain='www.etmoc.com',path='/',name='srcurl')
r3=s.get(url,headers={'Referer':url},timeout=30)
print('R3',r3.status_code,len(r3.content),'col-8' in r3.text)
print(r3.text[:400])
if 'col-8' in r3.text:
    open('.tmp-etmoc.html','wb').write(r3.content); print('SAVED')
