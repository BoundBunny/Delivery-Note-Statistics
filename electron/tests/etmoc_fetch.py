import requests, sys
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
url='http://www.etmoc.com/Firms/Brands'
def hx(s): return ''.join(format(ord(c),'x') for c in s)
for screen in ['1920,1080','1440,900','1536,864','1280,720','800,600']:
    s=requests.Session()
    s.headers.update({'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'zh-CN,zh;q=0.9'})
    r=s.get(url,timeout=30)
    s.cookies.set('srcurl',hx(url),domain='www.etmoc.com',path='/')
    r2=s.get(url,params={'security_verify_data':hx(screen)},headers={'Referer':url},timeout=30)
    print(screen,r2.status_code,len(r2.content),'col-8' in r2.text)
    if 'col-8' in r2.text:
        open('.tmp-etmoc.html','wb').write(r2.content)
        print('SAVED')
        break
