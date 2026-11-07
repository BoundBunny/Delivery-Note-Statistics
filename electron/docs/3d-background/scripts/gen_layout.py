# -*- coding: utf-8 -*-
"""生成《送货单统计 · 3D 背景板》分区布局示意图（纯 Pillow 绘制，无外部素材）。
运行：python gen_layout.py
输出：../layout.png
"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 2000, 1480
BG = "#FFFFFF"
INK = "#18181B"
MUTED = "#71717A"
FAINT = "#A1A1AA"
LINE = "#E4E4E7"
PANEL = "#FBFCFE"

# 品牌基因（取自项目 styles.css :root）
INDIGO = "#4F46E5"
INDIGO_L = "#EEF2FF"
VIOLET = "#7C3AED"
VIOLET_L = "#F5F3FF"
FUCHSIA = "#D946EF"
GREEN = "#059669"
GREEN_L = "#ECFDF5"
AMBER = "#D97706"
AMBER_L = "#FEF3C7"
ROAD = "#DDE3EC"
ROAD_D = "#C3CCDA"
BOXY = "#E7D3B3"
BOX_D = "#D2B98F"
RACK = "#C7D2FE"
RACK_D = "#A5B4FC"
TRUCK = "#FFFFFF"
TRUCK_D = "#DCE3EE"
CITY = "#CBD5E1"

FONT = "C:/Windows/Fonts/msyh.ttc"
FONTB = "C:/Windows/Fonts/msyhbd.ttc"


def f(size, bold=False):
    return ImageFont.truetype(FONTB if bold else FONT, size)


img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)


def rr(box, r, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def txt(xy, s, size=14, color=INK, bold=False, anchor="la"):
    d.text(xy, s, font=f(size, bold), fill=color, anchor=anchor)


def arrow(x1, y1, x2, y2, color=MUTED, w=2, head=9):
    d.line([(x1, y1), (x2, y2)], fill=color, width=w)
    ang = math.atan2(y2 - y1, x2 - x1)
    for s in (+1, -1):
        a = ang + s * math.radians(24)
        d.line([(x2, y2), (x2 - head * math.cos(a), y2 - head * math.sin(a))],
               fill=color, width=w)


# ---------------------------------------------------------------- 标题
txt((60, 40), "送货单统计 · 3D 背景板  分区布局与镜头构图", 30, INK, True)
txt((60, 84), "Direction 2 · 微缩送货沙盘   |   整页铺底   |   v0.1 设计稿（未改动现有代码）", 15, MUTED)
rr((1640, 40, 1940, 86), 12, INDIGO_L)
txt((1790, 63), "1 unit = 1 m · Y-up", 15, INDIGO, True, "mm")

# ================================================================ Panel A 顶视平面
AX, AY = 60, 120
rr((AX, AY, 1100, 1000), 18, PANEL, LINE)
txt((AX + 24, AY + 20), "A · 顶视分区平面（44 × 30 m，相机锁死等距）", 18, INK, True)
txt((AX + 24, AY + 50), "前 = 靠近观者 (+Z)，后 = 远景 (-Z)", 13, MUTED)

PX0, PY0, S = AX + 70, AY + 100, 21.0  # 平面原点与像素比例


def plan(x, z):
    return PX0 + x * S, PY0 + z * S


# 场景占地
x0, y0 = plan(0, 0)
x1, y1 = plan(44, 30)
rr((x0, y0, x1, y1), 14, "#F3F5FA", "#D9DFEA", 2)

# 网格 5m
for gx in range(0, 45, 5):
    px, _ = plan(gx, 0)
    d.line([(px, y0), (px, y1)], fill="#E8ECF3", width=1)
for gz in range(0, 31, 5):
    _, py = plan(0, gz)
    d.line([(x0, py), (x1, py)], fill="#E8ECF3", width=1)


def zone(zx0, zz0, zx1, zz1, fill, outline, label, sub, color=INK, label_pos=None):
    a = plan(zx0, zz0)
    b = plan(zx1, zz1)
    rr((a[0], a[1], b[0], b[1]), 10, fill, outline, 2)
    if label_pos:
        cx, cy = plan(*label_pos)
    else:
        cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    txt((cx, cy - 12), label, 16, color, True, "mm")
    if sub:
        txt((cx, cy + 12), sub, 11.5, MUTED, False, "mm")


# Z 分区
zone(0, 0, 44, 4.5, "#EAF6EF", "#B7E1C6", "Z5 环境绿化 / 远景", "行道树 · 围栏 · 城市剪影", "#166534")
zone(2, 5, 16.5, 23.5, INDIGO_L, RACK_D, "Z1 集货 · 仓储区", "6 分类货架 · 纸箱 · 打包台", "#3730A3", (9.25, 21.0))
zone(16.5, 5, 29.5, 13.5, VIOLET_L, "#C4B5FD", "Z2 月台 · 装车区", "卷帘门 01/02 · 待装托盘", "#5B21B6")
zone(16.5, 13.5, 40, 23.5, "#EDF1F7", ROAD_D, "Z3 场内道路", "装车 → 出口 单行", "#334155", (34.5, 21.2))
zone(36, 4.5, 44, 11, "#FEF5E7", "#F3D19B", "Z4 客户门店", "送达 · 招牌亮灯（可选）", "#92400E")
zone(40, 11, 44, 23.5, "#EDF1F7", ROAD_D, "出口", "坡道 → 配送", "#334155")
# 前景
zone(2, 25, 42, 30, "#F6F7FB", "#E3E7EF", "Z6 前景带（低密度留白）", "灌木 · 路灯 · 视觉暗角", FAINT)

# 6 个商品分类货架 + 货车小示意
CATS_PLAN = [
    ("零食", "#FEF3C7", "#D97706"), ("饮料", "#DBEAFE", "#2563EB"), ("糖果", "#FCE7F3", "#DB2777"),
    ("粮油", "#D1FAE5", "#059669"), ("日用", "#E0E7FF", "#4F46E5"), ("烟草", "#EDE9FE", "#7C3AED")
]
for row, zz in enumerate([8.3, 14.6]):
    for col, xx in enumerate([4.55, 9.25, 13.95]):
        name, light, accent = CATS_PLAN[row * 3 + col]
        a = plan(xx - 1.95, zz - 0.95)
        b = plan(xx + 1.95, zz + 0.95)
        d.rounded_rectangle((a[0], a[1], b[0], b[1]), radius=4, fill=light, outline=accent, width=2)
        txt(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), name, 10.5, accent, True, "mm")
for i, xx in enumerate([18.2, 23.6]):
    a = plan(xx, 14.6)
    b = plan(xx + 4.6, 19.4)
    d.rounded_rectangle((a[0], a[1], b[0], b[1]), radius=6, fill="#FFFFFF", outline=INDIGO, width=2)
    txt(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), "货车", 12, INDIGO, True, "mm")

# 尺寸标注 44m / 30m
dim_y = y1 + 26
d.line([(x0, dim_y), (x1, dim_y)], fill=MUTED, width=1)
for xx in (x0, x1):
    d.line([(xx, dim_y - 6), (xx, dim_y + 6)], fill=MUTED, width=1)
txt(((x0 + x1) / 2, dim_y + 4), "44 m", 12, MUTED, False, "ma")
dim_x = x0 - 28
d.line([(dim_x, y0), (dim_x, y1)], fill=MUTED, width=1)
for yy in (y0, y1):
    d.line([(dim_x - 6, yy), (dim_x + 6, yy)], fill=MUTED, width=1)
txt((dim_x - 8, (y0 + y1) / 2), "30 m", 12, MUTED, False, "rm")

# 北向
txt((x1 + 18, y0 + 8), "N ↑", 12, MUTED, True)
txt((AX + 24, AY + 72), "相机：正交 OrthographicCamera · 方位 45° · 俯角 35.26° · 目标 (22, 2, 15)", 12, INDIGO, True)

# 图例
lg_y = 940
items = [(INDIGO_L, "仓储"), (VIOLET_L, "月台"), ("#EDF1F7", "道路"), ("#EAF6EF", "环境"), ("#FEF5E7", "门店")]
lx = AX + 24
for c, t in items:
    rr((lx, lg_y, lx + 16, lg_y + 16), 4, c, LINE, 1)
    txt((lx + 22, lg_y + 8), t, 12, MUTED, False, "lm")
    lx += 92
txt((AX + 24, lg_y + 26), "密度：高密度集中在 Z1/Z2，Z6 与四周留白，保证 UI 卡片压在低对比区域。", 11.5, FAINT)

# ================================================================ Panel B 等距块面
BX, BY = 1120, 120
rr((BX, BY, 1940, 1000), 18, PANEL, LINE)
txt((BX + 24, BY + 20), "B · 等距块面构图（Low-Poly Blockout）", 18, INK, True)
txt((BX + 24, BY + 50), "先验证分区/尺度/遮挡，再替换精模；此图仅为体块关系示意", 13, MUTED)

# 等距投影
IS = 8.6
OX, OY = BX + 330, BY + 360


def iso(x, y, z):
    px = OX + (x - z) * 0.866 * IS
    py = OY + (x + z) * 0.5 * IS - y * IS
    return px, py


def iso_box(x, z, w, dep, h, top, left, right, outline=None):
    """(x,z) 为底面近角，w 沿 +x，dep 沿 +z，h 向上。"""
    p = {}
    for kx, xx in (("a", x), ("b", x + w)):
        for kz, zz in (("0", z), ("1", z + dep)):
            p[kx + kz + "0"] = iso(xx, 0, zz)
            p[kx + kz + "1"] = iso(xx, h, zz)
    top_f = [p["a01"], p["b01"], p["b11"], p["a11"]]
    # 面 +x (右侧) 与 +z (前左)
    right_f = [p["b00"], p["b10"], p["b11"], p["b01"]]
    left_f = [p["a10"], p["b10"], p["b11"], p["a11"]]
    d.polygon(left_f, fill=left, outline=outline)
    d.polygon(right_f, fill=right, outline=outline)
    d.polygon(top_f, fill=top, outline=outline)


def shade(hexc, k):
    hexc = hexc.lstrip("#")
    r, g, b = (int(hexc[i:i + 2], 16) for i in (0, 2, 4))
    r, g, b = (max(0, min(255, int(v * k))) for v in (r, g, b))
    return f"#{r:02x}{g:02x}{b:02x}"


# 远景城市（屏幕空间剪影，置于面板上方）
skyline = []
base_y = BY + 250
xs = BX + 60
heights = [40, 68, 52, 90, 60, 110, 74, 56, 96, 70, 44, 84, 58]
for i, hh in enumerate(heights):
    skyline.append((xs, base_y - hh, xs + 44, base_y))
    xs += 44
for bx in skyline:
    d.rectangle(bx, fill=shade(CITY, 1.0))
d.rectangle((BX + 60, base_y, xs, base_y + 6), fill=shade(CITY, 0.92))
txt((BX + 60, base_y + 12), "远景城市剪影（雾化、单色）", 10.5, FAINT)

# 地面分区（低薄块）
iso_box(0, 0, 44, 30, 0.4, shade("#EDF0F7", 1.0), shade("#EDF0F7", 0.9), shade("#EDF0F7", 0.8))
iso_box(2, 5, 14.5, 18.5, 0.45, "#E7EBFA", "#E7EBFA", "#DCE2F7")
iso_box(16.5, 5, 13, 8.5, 0.45, "#F0ECFD", "#F0ECFD", "#E8E2FA")
iso_box(16.5, 13.5, 23.5, 10, 0.45, "#E3E9F2", "#E3E9F2", "#D6DEEA")
iso_box(36, 4.5, 8, 6.5, 0.45, "#FDF2E2", "#FDF2E2", "#F7E6CC")
iso_box(2, 25, 40, 5, 0.42, "#F1F3F8", "#F1F3F8", "#E7EAF1")

# 物体集合（按 x+z 由远及近绘制）
objs = []


def add_box(x, z, w, dep, h, color, outline=None):
    objs.append(("box", x + z, x, z, w, dep, h, color, outline))


# 6 个商品分类货架（3×2）
for row, zz in enumerate([8.3, 14.6]):
    for col, xx in enumerate([4.55, 9.25, 13.95]):
        light = CATS_PLAN[row * 3 + col][1]
        accent = CATS_PLAN[row * 3 + col][2]
        add_box(xx - 1.9, zz - 0.8, 3.8, 1.6, 2.7, light, accent)
# 货架上的箱
for row, zz in enumerate([8.3, 14.6]):
    for col, xx in enumerate([4.55, 9.25, 13.95]):
        add_box(xx - 1.0, zz - 0.25, 0.9, 0.8, 0.75, BOXY, "#C9AE83")
        add_box(xx + 0.05, zz - 0.25, 0.9, 0.8, 0.95, BOXY, "#C9AE83")
# 打包台
add_box(5.0, 21.2, 3.2, 1.6, 1.0, "#F3F5FA", "#C9D2E2")
# 月台建筑
add_box(16.6, 4.6, 12.6, 2.0, 3.0, "#F4F6FB", "#C9D2E2")
# 卷帘门（贴面薄块）
add_box(18.2, 4.4, 4.2, 0.5, 2.2, "#DCE4F2", "#B9C6DC")
add_box(23.6, 4.4, 4.2, 0.5, 2.2, "#DCE4F2", "#B9C6DC")
# 两辆货车（车身 + 车头）
for xx in (18.2, 23.6):
    add_box(xx, 13.8, 4.4, 2.3, 2.6, "#FFFFFF", "#C9D2E2")
    add_box(xx, 12.6, 4.4, 1.2, 1.9, INDIGO, "#4338CA")
# 叉车
add_box(15.2, 12.4, 1.1, 2.0, 1.7, AMBER, "#B45309")
# 门店
add_box(36.4, 4.8, 7.2, 5.6, 3.2, "#FDF7EE", "#D9BE93")
add_box(36.4, 4.6, 7.2, 2.2, 0.35, VIOLET, None)
# 前景三级展台（呼应销量排行）
for i, (xx, hh) in enumerate([(8.0, 0.9), (10.6, 1.4), (13.2, 1.1)]):
    add_box(xx, 26.0, 2.2, 2.2, hh, "#A5B4FC", "#818CF8")
# 树
for tx, tz in [(1.2, 1.8), (7.0, 1.6), (20.0, 1.8), (31.0, 1.6), (42.0, 27.5), (1.4, 27.0)]:
    add_box(tx - 0.18, tz - 0.18, 0.36, 0.36, 2.2, "#8A6D4B", None)
    objs.append(("tree", tx + tz, tx, tz, 1.6))
# 路灯
for lx2, lz2 in [(2.0, 24.0), (14.0, 24.0), (28.0, 24.0), (39.5, 24.0)]:
    add_box(lx2 - 0.12, lz2 - 0.12, 0.24, 0.24, 3.4, "#94A3B8", None)
    objs.append(("lamp", lx2 + lz2, lx2, lz2))

objs.sort(key=lambda o: o[1])
for o in objs:
    if o[0] == "box":
        _, _, x, z, w, dep, h, color, outline = o
        iso_box(x, z, w, dep, h, shade(color, 1.06), shade(color, 0.86), shade(color, 0.72), outline)
    elif o[0] == "tree":
        _, _, tx, tz, rr2 = o
        px, py = iso(tx, 2.2, tz)
        d.ellipse((px - rr2 * IS * 0.55, py - rr2 * IS * 0.5,
                   px + rr2 * IS * 0.55, py + rr2 * IS * 0.5), fill="#6FBF8B", outline="#4E9E6C")
    else:
        _, _, lx2, lz2 = o
        px, py = iso(lx2, 3.4, lz2)
        d.ellipse((px - 5, py - 5, px + 5, py + 5), fill="#FDE68A", outline="#F59E0B")

# 道路箭头
def road_arrow(x, z, dx, dz):
    ax, ay = iso(x, 0.5, z)
    bx, by = iso(x + dx, 0.5, z + dz)
    d.line([(ax, ay), (bx, by)], fill="#64748B", width=3)
    arrow(ax, ay, bx, by, "#64748B", 3, 9)


road_arrow(18, 18, 4, 0)
road_arrow(26, 18, 4, 0)
road_arrow(34, 18, 3, 0)
# 出口坡道箭头
road_arrow(40.5, 20, 0, -4)

# 浮动标签
def tag(x, z, s, color=INDIGO):
    px, py = iso(x, 3.6, z)
    tw = d.textlength(s, font=f(11, True))
    rr((px - tw / 2 - 9, py - 30, px + tw / 2 + 9, py - 8), 9, "#FFFFFF", color, 1)
    txt((px, py - 19), s, 11, color, True, "mm")
    d.line([(px, py - 8), (px, py + 4)], fill=color, width=1)


tag(9, 7, "6 分类货架")
tag(22, 10, "装车 01/02")
tag(39, 7, "客户门店")
tag(11, 27, "销量展台")

# 说明
txt((BX + 24, BY + 700), "构图要点", 14, INK, True)
lines = [
    "① 高体块（货架/月台/货车）压在右中，形成视觉重心；左侧与前景留低体块。",
    "② 道路箭头把视线从月台牵向右下出口，形成一条“送货出去”的动线。",
    "③ 所有倒角 2–4 cm、纯色材质，无写实贴图；阴影用贴地假阴影。",
    "④ 3 个展台对应首页销量排行，是场景与真实 UI 的唯一“强呼应”点。",
]
for i, s in enumerate(lines):
    txt((BX + 24, BY + 728 + i * 22), s, 12, MUTED)

# ================================================================ Panel C 屏幕安全区
CX, CY = 60, 1010
rr((CX, CY, 1940, 1460), 18, PANEL, LINE)
txt((CX + 24, CY + 18), "C · 屏幕构图与 UI 安全区（背景在卡片之下）", 18, INK, True)


def screen(x, y, w, h, title, content_ratio, note):
    txt((x, y - 22), title, 12.5, INK, True)
    # 视口
    d.rounded_rectangle((x, y, x + w, y + h), radius=10, fill="#F4F7FD", outline="#D3DBE8", width=2)
    # 侧栏
    sw = int(w * 0.18)
    d.rounded_rectangle((x, y, x + sw, y + h), radius=10, fill="#FFFFFF", outline="#E2E8F1", width=1)
    d.rectangle((x + sw - 2, y, x + sw + 2, y + h), fill="#E2E8F1")
    txt((x + sw / 2, y + h / 2), "侧\n栏\n228", 10, FAINT, True, "mm")
    # 顶栏
    th = int(h * 0.11)
    d.rectangle((x + sw, y, x + w, y + th), fill="#FFFFFF", outline="#EDF1F7")
    txt((x + sw + 14, y + th / 2), "顶栏 72px", 9.5, FAINT, False, "lm")
    # 内容卡（半透明白，示意 UI 覆盖）
    cx0 = x + sw + int(w * 0.03)
    cw = int(w * content_ratio)
    cw = min(cw, w - sw - int(w * 0.04))
    gap = int(h * 0.045)
    ch = int(h * 0.16)
    yy = y + th + 18
    for i in range(2):
        cols = 3 if i == 0 else 1
        bw = (cw - (cols - 1) * gap) // cols
        for c in range(cols):
            bx = cx0 + c * (bw + gap)
            d.rounded_rectangle((bx, yy, bx + bw, yy + ch), radius=8, fill="#FFFFFF", outline="#E7EBF2", width=1)
        yy += ch + gap
    d.rounded_rectangle((cx0, yy, cx0 + cw, yy + int(h * 0.2)), radius=8, fill="#FFFFFF", outline="#E7EBF2", width=1)
    txt((cx0 + cw / 2, yy + h * 0.1), "宽内容列（商品排行 / 最近单据）", 10, FAINT, False, "mm")
    # 露出区标注
    txt((x + w * 0.9, y + h - 12), note, 10, MUTED, False, "rs")


screen(CX + 40, CY + 70, 560, 235, "C1 · 现版式 1264×821（内容 980 居中）", 0.86,
       "可露出 ≈ 两侧 8%\n场景仅作氛围")
screen(CX + 660, CY + 70, 560, 235, "C2 · 建议改版 1440×900（内容 max 980 → 三栏）", 0.62,
       "可露出 ≈ 30–35%\n场景可承载叙事")
screen(CX + 1280, CY + 70, 560, 235, "C3 · 宽屏 1920×1080（场景作为右侧主舞台）", 0.54,
       "可露出 ≈ 40%\n焦点带 58–90%")

txt((CX + 40, CY + 322), "安全区规则", 14, INK, True)
rules = [
    "• 左 0–18%：侧栏不透明，场景可穿过但不可承载信息。  • 上 0–9%：顶栏/标题区，场景保持低对比（≤8% 明度差）。",
    "• 中 16–36%：侧栏/内容卡片区，背景只放低体块（地面/远景），不放高模型。  • 中右 37–75%、下 40–82%：唯一高密度焦点带（月台+货车+门店）。",
    "• 四周 0–6%：加暗角（vignette）与雾，避免模型边缘“切”在屏幕边。  • 所有文字/标识不落在 UI 卡片正中，避让遮挡。",
]
for i, s in enumerate(rules):
    txt((CX + 40, CY + 350 + i * 21), s, 11.5, MUTED)

img.save(os.path.join(os.path.dirname(__file__), "..", "layout.png"))
print("saved layout.png", img.size)
