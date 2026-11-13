import json,re,os,time,hashlib
from PIL import Image,ImageDraw,ImageFont
ROOT=os.getcwd()
cat=json.load(open('.tmp-catalog-keep.json',encoding='utf-8'))
# existing seed
s=open('webapp/js/seed-products.js',encoding='utf-8').read(); old=json.loads(re.search(r'=\s*(\[.*\])',s,re.S).group(1))
non_tob=[x for x in old if x.get('category')!='tobacco']
outdir='webapp/assets/products/em'; os.makedirs(outdir,exist_ok=True)
# brand placeholder
brands=sorted({c['brand'] for c in cat})
def slug(b): return hashlib.md5(b.encode('utf-8')).hexdigest()[:8]
font_path=r'C:\Windows\Fonts\msyh.ttc'
placeholder={}
for b in brands:
    p=os.path.join(outdir,'brand_%s.webp'%slug(b))
    if not os.path.exists(p):
        im=Image.new('RGB',(240,240),(31,49,72)); d=ImageDraw.Draw(im)
        d.rectangle([0,0,240,8],fill=(176,138,62))
        try: f1=ImageFont.truetype(font_path,44); f2=ImageFont.truetype(font_path,18)
        except: f1=ImageFont.load_default(); f2=f1
        t=b[:4]
        bb=d.textbbox((0,0),t,font=f1); d.text(((240-(bb[2]-bb[0]))/2,84),t,font=f1,fill=(255,255,255))
        t2='香烟'; bb2=d.textbbox((0,0),t2,font=f2); d.text(((240-(bb2[2]-bb2[0]))/2,150),t2,font=f2,fill=(214,183,120))
        im.save(p,'WEBP',quality=82,method=6)
    placeholder[b]='assets/products/em/brand_%s.webp'%slug(b)
# images & records
names={}; records=[]; conv=0
for c in cat:
    nm=c['name']
    if nm in names: continue
    src='.tmp-catalog-img/%s.jpg'%c['id']; dst=os.path.join(outdir,c['id']+'.webp')
    img=''
    if c.get('img') and os.path.exists(src):
        try:
            im=Image.open(src).convert('RGB'); im.thumbnail((240,240)); im.save(dst,'WEBP',quality=82,method=6)
            img='assets/products/em/'+c['id']+'.webp'; conv+=1
        except Exception: img=''
    if not img: img=placeholder[c['brand']]
    names[nm]=img
    pb=c.get('price_box'); pt=c.get('price_tiao')
    records.append({'barcode':c.get('box') or '','name':nm,'unit':'盒','spec':'盒','category':'tobacco','price':pb if pb is not None else 0,'cost':'','remark':''})
    if c.get('cart'): records.append({'barcode':c['cart'],'name':nm,'unit':'条','spec':'10盒','category':'tobacco','price':pt if pt is not None else 0,'cost':'','remark':''})
print('unique names',len(names),'records',len(records),'converted',conv,'placeholders',len(placeholder))
# write seed
new_seed=non_tob+records
open('webapp/js/seed-products.js','w',encoding='utf-8').write('/* 初始商品目录（barcode / name / unit / spec / category） */\nwindow.SEED_PRODUCTS = '+json.dumps(new_seed,ensure_ascii=False,indent=0)+';\n')
# bundled images
bs=open('webapp/js/bundled-images.js',encoding='utf-8').read(); bobj=json.loads(bs[bs.index('{'):bs.rindex('}')+1])
bobj.update(names)
open('webapp/js/bundled-images.js','w',encoding='utf-8').write('window.BUNDLED_IMAGES = '+json.dumps(bobj,ensure_ascii=False,separators=(',',':'))+';\n')
print('bundled',len(bobj))
# seed barcodes
bc={}
for c in cat:
    nm=c['name']
    if nm in bc: continue
    rec={}
    if c.get('box'): rec['盒']=c['box']
    if c.get('cart'): rec['条']=c['cart']
    if rec: bc[nm]=rec
open('webapp/js/seed-barcodes.js','w',encoding='utf-8').write('window.SEED_BARCODES = '+json.dumps(bc,ensure_ascii=False,separators=(',',':'))+';\n')
print('barcodes',len(bc))
# real data
realp=os.path.join(os.environ['APPDATA'],'songhuodan-desktop','用户数据','sd_v1_products.json')
if os.path.exists(realp):
    real=json.load(open(realp,encoding='utf-8'))
    backup=os.path.join(os.path.dirname(realp),'sd_v1_products.重建香烟目录前-'+time.strftime('%Y%m%d%H%M%S')+'.json')
    json.dump(real,open(backup,'w',encoding='utf-8'),ensure_ascii=False)
    keep=[x for x in real if x.get('category')!='tobacco']
    base=int(time.time()*1000); rt=[]
    for i,c in enumerate(cat):
        nm=c['name']; img=names.get(nm,'')
        pb=c.get('price_box'); pt=c.get('price_tiao')
        for unit,spec,price,bcv,suf in [('盒','盒',pb if pb is not None else 0,c.get('box') or '','b'),('条','10盒',pt if pt is not None else 0,c.get('cart') or '','t')]:
            if unit=='条' and not c.get('cart'): continue
            rt.append({'id':'emc'+c['id']+suf,'createdAt':base+i*2+(0 if suf=='b' else 1),'barcode':bcv,'name':nm,'unit':unit,'spec':spec,'category':'tobacco','price':price,'remark':'','image':('bundle:'+img) if img else ''})
    newreal=keep+rt
    json.dump(newreal,open(realp,'w',encoding='utf-8'),ensure_ascii=False)
    print('real backup',backup,'old',len(real),'new',len(newreal),'tobacco',len(rt))
else: print('no real')
