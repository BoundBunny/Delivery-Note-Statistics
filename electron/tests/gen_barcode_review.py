import json, re
src=open('webapp/js/seed-products.js',encoding='utf-8').read()
arr=json.loads(src[src.index('['):src.rindex(']')+1])
price={}
for p in arr:
    if p.get('category')=='tobacco': price.setdefault(p['name'],p.get('price'))
mp=json.load(open('.tmp-map.json',encoding='utf-8'))
sel=mp['selected']; skipped=[s for s,_ in mp['skipped']]
rows=[l.rstrip('\n').split('\t') for l in open('.tmp-exact.txt',encoding='utf-8') if l.strip()]
best={}
for r in rows[1:]:
    if len(r)>=5:
        best.setdefault(r[0],[]).append(r)
lines=[]
lines.append('# 香烟条码补全结果\n')
lines.append('数据来源：烟草市场 etmoc.com 商品目录（`http://www.etmoc.com/Firms/Brands`），逐条按商品页核对的「小盒条码 / 条盒条码」。\n')
lines.append('## 已自动填写（%d 个商品名，共 %d 条记录）\n' % (len(sel), sum(2 if v['box'] and v['carton'] else 1 for v in sel.values())))
lines.append('| 商品 | 小盒条码 | 条盒条码 | 来源 |')
lines.append('|---|---|---|---|')
for name,v in sel.items():
    lines.append('| %s | %s | %s | [商品页](%s) |'%(name,v['box'],v['carton'],v['url']))
lines.append('\n> 已同步写入初始商品表（新装/清空后自动带条码）和当前商品数据（46 条空缺已补，原有条码未覆盖）。\n')
lines.append('## 需要你确认的品牌/款式（%d 项，暂未填写）\n'%len(skipped))
lines.append('这些商品名在网站上没有唯一完全同名项，或存在多个同名/近似款。请确认后我再补；下表中「参考候选」仅供参考（**不要直接照抄，请按你店里实物包装核对**）。\n')
lines.append('| 商品（种子名） | 参考候选 | 条码（小盒 / 条盒） | 链接 |')
lines.append('|---|---|---|---|')
generic={'芙蓉王','利群','玉溪','云烟','金圣'}
def clean_code(s):
    s=(s or '').strip()
    s=s.replace('小盒条码=','').replace('条盒条码=','').replace('；',' / ').replace(';',' / ')
    s=re.sub(r'\s*/\s*',' / ',s)
    return s.strip()
for name in skipped:
    if name in generic:
        lines.append('| %s | 与同品牌具体款重复，请先确认保留哪一款 | — | — |'%name)
        continue
    cands=best.get(name,[])
    if not cands:
        lines.append('| %s | — | — | — |'%name); continue
    first=cands[0]
    lines.append('| %s | %s | %s | [商品页](%s) |'%(name,first[1],clean_code(first[2]),first[3]))
    for extra in cands[1:3]:
        lines.append('|  | 备选：%s | %s | [商品页](%s) |'%(extra[1],clean_code(extra[2]),extra[3]))
lines.append('\n## 说明\n')
lines.append('- 香烟条码按「盒 / 条」区分，盒装与整条条码不同；同品牌不同版本（软/硬/细支/中支/新版）也都不同。')
lines.append('- 品牌通用名（如 `芙蓉王`、`利群`、`玉溪`、`云烟`、`金圣`）与同品牌具体款在商品表里是重复的两个条目，建议先确认保留哪一个，否则两个条目不能填同一个条码。')
open('.shots/design/tobacco-barcodes-review.md','w',encoding='utf-8').write('\n'.join(lines)+'\n')
print('written',len(sel),len(skipped))
