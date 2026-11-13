import requests
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
url='http://www.etmoc.com/Firms/Brands'
def hx(s): return ''.join(format(ord(c),'x') for c in s)
s=requests.Session(); s.headers.update({'User-Agent':UA})
r=s.get(url,timeout=30)
print('R1',r.status_code,len(r.content)); print(r.text[:800])
print('cookies1',s.cookies.get_dict())
s.cookies.set('srcurl',hx(url),domain='www.etmoc.com',path='/')
print('cookies2',s.cookies.get_dict())
r2=s.get(url,params={'security_verify_data':hx('1920,1080')},headers={'Referer':url},timeout=30)
print('R2',r2.status_code,len(r2.content)); print(r2.text[:800]); print('cookies3',s.cookies.get_dict())
print('requrl',r2.url)
