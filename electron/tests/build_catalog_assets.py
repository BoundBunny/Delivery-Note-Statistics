import json,re,os,time
from PIL import Image
ROOT=os.getcwd()
cat=json.load(open('.tmp-catalog.json',encoding='utf-8'))
outdir=os.path.join(ROOT,'webapp','assets','products','em'); os.makedirs(outdir,exist_ok=True)
conv=0; missing=0
for c in cat:
    src=os.path.join(ROOT,'.tmp-catalog-img',c['id']+'.jpg')
    dst=os.path.join(outdir,c['id']+'.webp')
    if c.get('img') and os.path.exists(src):
        try:
            im=Image.open(src).convert('RGB')
            im.thumbnail((200,200))
            im.save(dst,'WEBP',quality=80,method=6)
            c['image']='assets/products/em/'+c['id']+'.webp'; conv+=1
        except Exception as e:
            c['image']=''; missing+=1
    else:
        c['image']=''; missing+=1
print('converted',conv,'missing',missing)
# existing seed
s=open(os.path.join('webapp','js','seed-products.js'),encoding='utf-8').read()
m=re.search(r'=\s*(\[.*\])',s,re.S); old=json.loads(m.group(1))
non_tob=[x for x in old if x.get('category')!='tobacco']
print('old total',len(old),'non-tobacco',len(non_tob))
# new tobacco records
records=[]; names={}
for i,c in enumerate(cat):
    nm=c['name']
    if nm not in names: names[nm]=c
    pt=c.get('price_tiao') or 0
    pb=round(pt/10,2) if pt else 0
    records.append({'barcode':c.get('box') or '','name':nm,'unit':'盒','spec':'盒','category':'tobacco','price':pb,'cost':'','remark':''})
    records.append({'barcode':c.get('cart') or '','name':nm,'unit':'条','spec':'10盒','category':'tobacco','price':pt,'cost':'','remark':''})
print('new tobacco records',len(records),'unique names',len(names))
new_seed=non_tob+records
header='/* 初始商品目录（barcode / name / unit / spec / category） */\n'
open(os.path.join('webapp','js','seed-products.js'),'w',encoding='utf-8').write(header+'window.SEED_PRODUCTS = '+json.dumps(new_seed,ensure_ascii=False,indent=0)+';\n')
# bundled images merge
bs=open(os.path.join('webapp','js','bundled-images.js'),encoding='utf-8').read()
bobj=json.loads(bs[bs.index('{'):bs.rindex('}')+1])
for nm,c in names.items():
    if c.get('image'): bobj[nm]=c['image']
open(os.path.join('webapp','js','bundled-images.js'),'w',encoding='utf-8').write('window.BUNDLED_IMAGES = '+json.dumps(bobj,ensure_ascii=False,separators=(',',':'))+';\n')
print('bundled entries',len(bobj))
# seed barcodes
bc={}
for nm,c in names.items():
    rec={}
    if c.get('box'): rec['盒']=c['box']
    if c.get('cart'): rec['条']=c['cart']
    if rec: bc[nm]=rec
open(os.path.join('webapp','js','seed-barcodes.js'),'w',encoding='utf-8').write('window.SEED_BARCODES = '+json.dumps(bc,ensure_ascii=False,separators=(',',':'))+';\n')
print('barcode names',len(bc))
# patch real data
realp=os.path.join(os.environ['APPDATA'],'songhuodan-desktop','用户数据','sd_v1_products.json')
if os.path.exists(realp):
    real=json.load(open(realp,encoding='utf-8'))
    backup=os.path.join(os.path.dirname(realp),'sd_v1_products.重建香烟目录前-'+time.strftime('%Y%m%d%H%M%S')+'.json')
    json.dump(real,open(backup,'w',encoding='utf-8'),ensure_ascii=False)
    keep=[x for x in real if x.get('category')!='tobacco']
    base=int(time.time()*1000)
    rt=[]
    for i,c in enumerate(cat):
        nm=c['name']; pt=c.get('price_tiao') or 0; pb=round(pt/10,2) if pt else 0
        for unit,spec,price,bc_,suf in [('盒','盒',pb,c.get('box') or '','b'),('条','10盒',pt,c.get('cart') or '','t')]:
            rt.append({'id':'emc'+c['id']+suf,'createdAt':base+i*2+(0 if suf=='b' else 1),'barcode':bc_,'name':nm,'unit':unit,'spec':spec,'category':'tobacco','price':price,'remark':'','image':('bundle:'+c['image']) if c.get('image') else ''})
    newreal=keep+rt
    json.dump(newreal,open(realp,'w',encoding='utf-8'),ensure_ascii=False)
    print('real backup',backup,'old',len(real),'new',len(newreal),'tobacco',len(rt))
else:
    print('real data not found',realp)
