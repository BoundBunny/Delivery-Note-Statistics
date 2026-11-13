import json
m=json.load(open('.tmp-map.json',encoding='utf-8'))['selected']
out={}
for name,v in m.items():
    rec={}
    if v['box']: rec['盒']=v['box']
    if v['carton']: rec['条']=v['carton']
    rec['src']=v['url']
    out[name]=rec
lines=['/* 烟草类内置商品条码表（数据来源：烟草市场 etmoc.com 商品目录，按商品页逐条核对） */',
       '/* 键为商品名称，值为「盒/条」条码；仅用于内置商品首次灌入及旧数据补全，不覆盖用户已填条码。 */',
       'window.SEED_BARCODES = '+json.dumps(out,ensure_ascii=False,indent=2)+';']
open('webapp/js/seed-barcodes.js','w',encoding='utf-8').write('\n'.join(lines)+'\n')
print('entries',len(out))
