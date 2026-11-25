# -*- coding: utf-8 -*-
"""生成小红书宣传图（3:4，1080x1440）：封面 + 桌面端 + 手机端 + 功能亮点。"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = r"E:\github\delivery-note\electron"
SHOT = os.path.join(ROOT, ".shots", "xhs")
OUT = os.path.join(ROOT, ".shots", "xhs", "pub")
os.makedirs(OUT, exist_ok=True)

CREAM = (247, 245, 239)
NAVY = (34, 54, 75)
NAVY_SOFT = (58, 78, 100)
AMBER = (217, 154, 43)
AMBER_DK = (188, 128, 26)
MUTED = (126, 133, 142)
LINE = (228, 223, 210)
WHITE = (255, 255, 255)

FBD = r"C:\Windows\Fonts\msyhbd.ttc"
FRG = r"C:\Windows\Fonts\msyh.ttc"

def font(bold, size):
    return ImageFont.truetype(FBD if bold else FRG, size)

def tw(d, text, f, ls=0):
    if not text:
        return 0
    return sum(d.textlength(ch, font=f) for ch in text) + ls * (len(text) - 1)

def draw_text(d, xy, text, f, fill, ls=0, anchor="la"):
    x, y = xy
    if anchor[0] == "m":
        x -= tw(d, text, f, ls) / 2
    elif anchor[0] == "r":
        x -= tw(d, text, f, ls)
    for ch in text:
        d.text((x, y), ch, font=f, fill=fill)
        x += d.textlength(ch, font=f) + ls

def rrect(size, radius, fill):
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=fill)
    return im

def shadow_layer(size, radius, blur=26, opacity=90):
    s = 80
    im = Image.new("RGBA", (size[0] + s * 2, size[1] + s * 2), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle([s, s, s + size[0], s + size[1]], radius=radius, fill=(20, 32, 48, opacity))
    return im.filter(ImageFilter.GaussianBlur(blur)), s

def card_with_image(base, box_xy, wh, img, radius=22, pad=14, bg=WHITE, sh_blur=30, sh_op=95):
    """白卡片 + 内嵌圆角图片 + 投影。"""
    w, h = wh
    sh, off = shadow_layer((w, h), radius, sh_blur, sh_op)
    base.alpha_composite(sh, (box_xy[0] - off, box_xy[1] - off + 16))
    card = rrect((w, h), radius, bg)
    base.alpha_composite(card, box_xy)
    iw, ih = w - pad * 2, h - pad * 2
    im = img.convert("RGB").resize((iw, ih), Image.LANCZOS).convert("RGBA")
    mask = rrect((iw, ih), max(6, radius - pad // 2), (255, 255, 255, 255))
    base.paste(im, (box_xy[0] + pad, box_xy[1] + pad), mask)

def bg_canvas(w=1080, h=1440):
    im = Image.new("RGBA", (w, h), CREAM + (255,))
    d = ImageDraw.Draw(im)
    # 顶部柔光
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-260, -420, 700, 300], fill=(217, 154, 43, 26))
    gd.ellipse([w - 520, h - 380, w + 320, h + 260], fill=(34, 54, 75, 18))
    im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(90)))
    # 细点阵
    dots = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dots)
    for yy in range(0, h, 34):
        for xx in range(0, w, 34):
            dd.ellipse([xx, yy, xx + 2, yy + 2], fill=(34, 54, 75, 16))
    im.alpha_composite(dots)
    return im

ICON = Image.open(r"E:\github\delivery-note\android\design\dns-logo-v1\dns-icon-1024.png").convert("RGBA")

def brand_row(im, y=64, x=72, right_text="桌面端 · 手机端 · 双端同步"):
    d = ImageDraw.Draw(im)
    ic = ICON.resize((72, 72), Image.LANCZOS)
    mask = rrect((72, 72), 18, (255, 255, 255, 255))
    im.paste(ic, (x, y), mask if ic.mode == "RGBA" else None)
    draw_text(d, (x + 88, y + 6), "DNS 送货单统计", font(True, 30), NAVY, ls=1)
    draw_text(d, (x + 88, y + 44), "送货宝 · Delivery Note", font(False, 20), MUTED, ls=1)
    draw_text(d, (1080 - 72, y + 24), right_text, font(False, 21), MUTED, ls=1, anchor="ra")

def chip(im, xy, text, fg=NAVY, bg=(255, 255, 255, 235), border=(226, 220, 205, 255), size=24, padx=22, pady=12, bold=True):
    d = ImageDraw.Draw(im)
    f = font(bold, size)
    w = tw(d, text, f, 1) + padx * 2
    h = size + pady * 2
    layer = rrect((int(w), int(h)), h // 2, bg)
    im.alpha_composite(layer, (int(xy[0]), int(xy[1])))
    dl = ImageDraw.Draw(im)
    dl.rounded_rectangle([xy[0], xy[1], xy[0] + w - 1, xy[1] + h - 1], radius=h // 2, outline=border, width=2)
    draw_text(dl, (xy[0] + padx, xy[1] + pady - 2), text, f, fg, ls=1)
    return w

def page_title(im, title, sub, size=76, y=188):
    d = ImageDraw.Draw(im)
    f = font(True, size)
    draw_text(d, (72, y), title, f, NAVY, ls=2)
    draw_text(d, (72 + tw(d, title, f, 2) + 30, y + size - 46), sub, font(False, 30), MUTED, ls=1)

# ---------------- 封面 ----------------
def make_cover():
    im = bg_canvas()
    d = ImageDraw.Draw(im)
    brand_row(im, 64)

    # eyebrow chip
    chip(im, (72, 196), "独立开发 · 一个人写的开单软件", fg=AMBER_DK, bg=(255, 249, 236, 255), border=(240, 222, 178, 255), size=25)

    draw_text(d, (72, 286), "小店送货开单", font(True, 104), NAVY, ls=2)
    draw_text(d, (72, 408), "一个软件全搞定", font(True, 104), AMBER, ls=2)
    draw_text(d, (74, 536), "开单 · 扫码 · 统计 · 打印 · 对账，桌面手机两端同步", font(False, 30), NAVY_SOFT, ls=1)

    # 桌面主图
    home = Image.open(os.path.join(SHOT, "01-home.png"))
    card_with_image(im, (66, 640), (948, 592), home, radius=26, pad=12, sh_blur=34, sh_op=105)

    # 手机小图叠右下
    mob = Image.open(os.path.join(SHOT, "m2-detail.png"))
    mw, mh = 232, 482
    px, py = 806, 946
    sh, off = shadow_layer((mw, mh), 32, 30, 120)
    im.alpha_composite(sh, (px - off, py - off + 14))
    body = rrect((mw, mh), 32, (255, 255, 255, 255))
    im.alpha_composite(body, (px, py))
    inner = mob.convert("RGB").resize((mw - 20, mh - 20), Image.LANCZOS).convert("RGBA")
    mask = rrect((mw - 20, mh - 20), 22, (255, 255, 255, 255))
    im.paste(inner, (px + 10, py + 10), mask)

    # 底部胶囊（左侧，避免与手机重叠）
    y = 1258
    x = 72
    for t in ["Electron 桌面应用", "Android 手机 App", "本地离线存储"]:
        w = chip(im, (x, y), t, size=22, padx=18, pady=11)
        x += w + 12

    im.convert("RGB").save(os.path.join(OUT, "01-cover.png"), quality=95)
    print("WROTE 01-cover.png")

# ---------------- 桌面端拼图 ----------------
def make_desktop():
    im = bg_canvas()
    page_title(im, "桌面端", "3D 仓库工作台 · 大屏开单")

    home = Image.open(os.path.join(SHOT, "01-home.png"))
    card_with_image(im, (72, 300), (936, 585), home, radius=22, pad=11, sh_blur=26, sh_op=80)
    bd = ImageDraw.Draw(im)
    bd.ellipse([72, 300 + 585 + 18, 92, 300 + 585 + 38], fill=AMBER)
    draw_text(bd, (104, 300 + 585 + 12), "3D 仓库工作台", font(True, 27), NAVY, ls=1)
    draw_text(bd, (1080 - 72, 300 + 585 + 15), "01 / 03", font(False, 22), MUTED, anchor="ra")

    subs = [("02-order-new.png", "开送货单"), ("04-stats.png", "销售统计 / 对账")]
    w, h = 456, 285
    for i, (fn, cap) in enumerate(subs):
        x = 72 + i * (w + 24)
        y = 985
        img = Image.open(os.path.join(SHOT, fn))
        card_with_image(im, (x, y), (w, h), img, radius=18, pad=9, sh_blur=22, sh_op=72)
        bd = ImageDraw.Draw(im)
        bd.ellipse([x, y + h + 16, x + 18, y + h + 34], fill=AMBER)
        draw_text(bd, (x + 30, y + h + 11), cap, font(True, 26), NAVY, ls=1)
        draw_text(bd, (x + w, y + h + 14), f"0{i+2} / 03", font(False, 21), MUTED, anchor="ra")

    draw_text(ImageDraw.Draw(im), (72, 1368), "Electron 构建 · Windows 一键安装 · 支持应用内自动更新", font(False, 26), MUTED, ls=1)
    im.convert("RGB").save(os.path.join(OUT, "02-desktop.png"), quality=95)
    print("WROTE 02-desktop.png")

# ---------------- 手机端拼图 ----------------
def phone_card(im, xy, img, w=300, h=624, radius=40):
    sh, off = shadow_layer((w, h), radius, 28, 110)
    im.alpha_composite(sh, (xy[0] - off, xy[1] - off + 16))
    body = rrect((w, h), radius, (26, 34, 44, 255))
    im.alpha_composite(body, xy)
    inner = img.convert("RGB").resize((w - 18, h - 18), Image.LANCZOS).convert("RGBA")
    mask = rrect((w - 18, h - 18), 30, (255, 255, 255, 255))
    im.paste(inner, (xy[0] + 9, xy[1] + 9), mask)
    # 顶部刘海
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([xy[0] + w // 2 - 34, xy[1] + 14, xy[0] + w // 2 + 34, xy[1] + 30], radius=8, fill=(26, 34, 44, 255))

def make_mobile():
    im = bg_canvas()
    d = ImageDraw.Draw(im)
    brand_row(im, 64, right_text="MOBILE · 手机端")
    page_title(im, "手机端", "扫码接单 · 随身开单")

    items = [("m6-order-new.png", "开送货单"), ("m2-detail.png", "单据详情"), ("m3-stats.png", "数据统计")]
    w, h = 300, 624
    gap = 40
    total = w * 3 + gap * 2
    x = (1080 - total) // 2
    y = 322
    for fn, cap in items:
        img = Image.open(os.path.join(SHOT, fn))
        phone_card(im, (x, y), img, w, h)
        dd = ImageDraw.Draw(im)
        draw_text(dd, (x + w / 2, y + h + 34), cap, font(True, 28), NAVY, ls=1, anchor="ma")
        x += w + gap

    # 说明卡
    yy = 1076
    box = rrect((936, 190), 26, (255, 255, 255, 240))
    im.alpha_composite(box, (72, yy))
    dd = ImageDraw.Draw(im)
    dd.rounded_rectangle([72, yy, 72 + 936 - 1, yy + 190 - 1], radius=26, outline=LINE, width=2)
    draw_text(dd, (110, yy + 30), "同一套数据，手机电脑实时同步", font(True, 34), NAVY, ls=1)
    for i, t in enumerate(["外出送货用手机扫码，回到店里电脑继续开单、打印",
                           "Android 与桌面端共用一套界面与本地数据，离线也能用",
                           "大屏看趋势对账，手机随手录一单，两不耽误"]):
        dd.ellipse([116, yy + 92 + i * 32, 124, yy + 100 + i * 32], fill=AMBER)
        draw_text(dd, (138, yy + 82 + i * 32), t, font(False, 23), NAVY_SOFT, ls=0.5)

    draw_text(ImageDraw.Draw(im), (72, 1332), "Android 手机 App · 与桌面端共用同一套数据", font(False, 25), MUTED, ls=1)
    im.convert("RGB").save(os.path.join(OUT, "03-mobile.png"), quality=95)
    print("WROTE 03-mobile.png")

# ---------------- 功能亮点 ----------------
def make_features():
    im = bg_canvas()
    d = ImageDraw.Draw(im)
    brand_row(im, 64, right_text="FEATURES · 功能")
    draw_text(d, (72, 186), "一个小软件", font(True, 72), NAVY, ls=2)
    draw_text(d, (72, 272), "把送货的事都管了", font(True, 72), AMBER, ls=2)

    feats = [
        ("开送货单", "客户、货品、价格自动带出，几十秒出一单"),
        ("扫码接单", "扫商品条码自动累加数量，边送边记"),
        ("销售统计", "日/周/月趋势与排行，谁欠多少一目了然"),
        ("打印导出", "送货单打印预览，Excel / CSV 一键导出"),
        ("客户商品", "客户价、历史价、商品图，全都记得住"),
        ("本地离线", "数据存在本机，断网也能开单，隐私更安心"),
    ]
    x0, y0 = 72, 400
    cw, ch = 456, 268
    gx, gy = 24, 24
    for i, (t, desc) in enumerate(feats):
        col, row = i % 2, i // 2
        x = x0 + col * (cw + gx)
        y = y0 + row * (ch + gy)
        card = rrect((cw, ch), 26, (255, 255, 255, 245))
        im.alpha_composite(card, (x, y))
        dd = ImageDraw.Draw(im)
        dd.rounded_rectangle([x, y, x + cw - 1, y + ch - 1], radius=26, outline=LINE, width=2)
        # 序号徽标
        dd.rounded_rectangle([x + 30, y + 30, x + 30 + 54, y + 30 + 54], radius=16, fill=(255, 247, 231, 255))
        draw_text(dd, (x + 30 + 27, y + 30 + 12), f"{i+1:02d}", font(True, 26), AMBER_DK, anchor="ma")
        draw_text(dd, (x + 104, y + 34), t, font(True, 34), NAVY, ls=1)
        # 描述换行
        f = font(False, 23)
        line = ""
        ly = y + 122
        for chx in desc:
            if tw(dd, line + chx, f) > cw - 62:
                draw_text(dd, (x + 32, ly), line, f, MUTED, ls=0.5)
                line = ""
                ly += 34
            line += chx
        if line:
            draw_text(dd, (x + 32, ly), line, f, MUTED, ls=0.5)

    # 底部 slogan
    yy = 1252
    bar = rrect((936, 118), 24, NAVY + (255,))
    im.alpha_composite(bar, (72, yy))
    dd = ImageDraw.Draw(im)
    draw_text(dd, (108, yy + 26), "送货有单，统计有数", font(True, 40), (255, 255, 255), ls=2)
    draw_text(dd, (108, yy + 80), "单机离线 · 无需注册 · 数据留在自己电脑里", font(False, 22), (214, 205, 188), ls=1)

    im.convert("RGB").save(os.path.join(OUT, "04-features.png"), quality=95)
    print("WROTE 04-features.png")

def wrap_text(d, text, f, maxw, ls=0.5):
    lines, line = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(line); line = ""; continue
        if tw(d, line + ch, f, ls) > maxw and line:
            lines.append(line); line = ch
        else:
            line += ch
    if line:
        lines.append(line)
    return lines

# ---------------- 获客版封面（承接定制 app） ----------------
def make_hire_cover():
    im = bg_canvas()
    d = ImageDraw.Draw(im)
    brand_row(im, 64, right_text="独立程序员 · 承接定制")

    chip(im, (72, 190), "独立程序员 · 一对一接单", fg=AMBER_DK, bg=(255, 249, 236, 255), border=(240, 222, 178, 255), size=25)

    draw_text(d, (72, 280), "老板想做 App", font(True, 100), NAVY, ls=2)
    draw_text(d, (72, 398), "不用懂技术", font(True, 100), AMBER, ls=2)
    draw_text(d, (74, 526), "把生意里的麻烦说清楚，设计和代码我来搞定", font(False, 30), NAVY_SOFT, ls=1)

    home = Image.open(os.path.join(SHOT, "01-home.png"))
    card_with_image(im, (72, 606), (936, 520), home, radius=26, pad=11, sh_blur=32, sh_op=100)

    mob = Image.open(os.path.join(SHOT, "m3-stats.png"))
    mw, mh = 206, 430
    px, py = 622, 934
    sh, off = shadow_layer((mw, mh), 30, 28, 118)
    im.alpha_composite(sh, (px - off, py - off + 12))
    im.alpha_composite(rrect((mw, mh), 30, (255, 255, 255, 255)), (px, py))
    inner = mob.convert("RGB").resize((mw - 18, mh - 18), Image.LANCZOS).convert("RGBA")
    im.paste(inner, (px + 9, py + 9), rrect((mw - 18, mh - 18), 20, (255, 255, 255, 255)))

    # 流程条
    dd = ImageDraw.Draw(im)
    steps = ["聊需求", "出方案", "做设计", "写代码", "上线维护"]
    x = 72
    f = font(True, 24)
    for i, s in enumerate(steps):
        draw_text(dd, (x, 1180), s, f, NAVY, ls=1)
        x += tw(dd, s, f, 1)
        if i < len(steps) - 1:
            draw_text(dd, (x + 12, 1180), "→", font(True, 24), AMBER)
            x += 12 + tw(dd, "→", font(True, 24)) + 12

    # 底部小字
    draw_text(dd, (72, 1240), "做过的成品：送货宝 · 桌面 + 手机双端开单软件（见后图）", font(False, 25), MUTED, ls=1)

    # 结尾胶囊
    y = 1300
    x = 72
    for t in ["按你的生意定制", "不套模板", "一个人负责到底"]:
        w = chip(im, (x, y), t, size=22, padx=18, pady=11)
        x += w + 12

    im.convert("RGB").save(os.path.join(OUT, "05-cover-hire.png"), quality=95)
    print("WROTE 05-cover-hire.png")

# ---------------- 合作流程 / 为什么找我 ----------------
def make_process():
    im = bg_canvas()
    d = ImageDraw.Draw(im)
    brand_row(im, 64, right_text="WORKFLOW · 合作方式")
    page_title(im, "怎么合作", "不用懂技术，五步交付")

    steps = [
        ("聊需求", "你说清楚生意怎么做的，我帮你理成一份功能清单，免费"),
        ("出方案报价", "给界面原型和报价，确认清楚再动手，中途不加价"),
        ("做设计", "界面先给你看，满意了才开始写代码"),
        ("开发联调", "桌面端 / 手机端按需开发，边做边给你看进度"),
        ("上线维护", "打包安装包、教你上手，后续改功能加需求都找我"),
    ]
    x0, y0 = 72, 300
    cw, ch = 936, 620
    im.alpha_composite(rrect((cw, ch), 28, (255, 255, 255, 246)), (x0, y0))
    dd = ImageDraw.Draw(im)
    dd.rounded_rectangle([x0, y0, x0 + cw - 1, y0 + ch - 1], radius=28, outline=LINE, width=2)

    ry = y0 + 34
    row_h = (ch - 68) // len(steps)
    for i, (t, desc) in enumerate(steps):
        cy = ry + i * row_h
        dd.ellipse([x0 + 40, cy + 6, x0 + 40 + 44, cy + 50], fill=(255, 246, 228, 255))
        draw_text(dd, (x0 + 62, cy + 14), f"{i+1}", font(True, 26), AMBER_DK, anchor="ma")
        draw_text(dd, (x0 + 104, cy + 12), t, font(True, 32), NAVY, ls=1)
        fdesc = font(False, 22)
        lines = wrap_text(dd, desc, fdesc, cw - 150)
        ly = cy + 58
        for ln in lines:
            draw_text(dd, (x0 + 104, ly), ln, fdesc, MUTED, ls=0.5)
            ly += 30
        if i < len(steps) - 1:
            dd.line([x0 + 104, cy + row_h - 6, x0 + cw - 44, cy + row_h - 6], fill=(238, 233, 222, 255), width=2)

    # 适合谁
    draw_text(d, (72, 960), "适合这些老板", font(True, 30), NAVY, ls=1)
    x, y = 72, 1010
    for t in ["小店主", "批发配送", "工作室", "个体老板", "传统企业"]:
        w = chip(im, (x, y), t, size=23, padx=20, pady=12)
        x += w + 14

    # 为什么找我
    draw_text(d, (72, 1112), "为什么找我", font(True, 30), NAVY, ls=1)
    why = [
        ("一个人负责到底", "从聊需求到上线维护，全程同一个人，不转包不甩锅"),
        ("按你的生意定制", "不套模板，流程怎么走、表单怎么填，按你实际来"),
        ("能长期改", "做完不是结束，后面加功能、改界面都能继续找我"),
    ]
    yy = 1166
    for t, desc in why:
        dd.ellipse([72, yy + 8, 86, yy + 22], fill=AMBER)
        draw_text(dd, (100, yy), t, font(True, 25), NAVY, ls=1)
        draw_text(dd, (100 + tw(dd, t, font(True, 25), 1) + 18, yy + 4), desc, font(False, 21), MUTED, ls=0.5)
        yy += 56

    im.convert("RGB").save(os.path.join(OUT, "06-process.png"), quality=95)
    print("WROTE 06-process.png")

def load_cover_crop(path, w, h, focus_y=0.34):
    im = Image.open(path).convert("RGB")
    iw, ih = im.size
    scale = max(w / iw, h / ih)
    nw, nh = int(iw * scale + 0.5), int(ih * scale + 0.5)
    im = im.resize((nw, nh), Image.LANCZOS)
    left = (nw - w) // 2
    top = int((nh - h) * focus_y)
    top = max(0, min(top, nh - h))
    return im.crop((left, top, left + w, top + h))

def dashed_rect(im, box, radius=30, color=(200, 188, 165, 255), width=3, dash=16, gap=12):
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(box, radius=radius, outline=color, width=width)
    # 用 mask 做虚线化：沿边缘遮罩太复杂，简化为四边虚线
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = box
    def hline(xa, xb, y):
        x = xa
        while x < xb:
            d.line([x, y, min(x + dash, xb), y], fill=color, width=width)
            x += dash + gap
    def vline(ya, yb, x):
        y = ya
        while y < yb:
            d.line([x, y, x, min(y + dash, yb)], fill=color, width=width)
            y += dash + gap
    hline(x0 + radius, x1 - radius, y0); hline(x0 + radius, x1 - radius, y1)
    vline(y0 + radius, y1 - radius, x0); vline(y0 + radius, y1 - radius, x1)
    # 圆角
    d.arc([x0, y0, x0 + 2 * radius, y0 + 2 * radius], 180, 270, fill=color, width=width)
    d.arc([x1 - 2 * radius, y0, x1, y0 + 2 * radius], 270, 360, fill=color, width=width)
    d.arc([x0, y1 - 2 * radius, x0 + 2 * radius, y1], 90, 180, fill=color, width=width)
    d.arc([x1 - 2 * radius, y1 - 2 * radius, x1, y1], 0, 90, fill=color, width=width)
    im.alpha_composite(layer)

# ---------------- 真人出镜版封面 ----------------
def make_cover_person(photo_path=None):
    W, H = 1080, 1440
    im = Image.new("RGBA", (W, H), CREAM + (255,))
    # 暖色背景
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-300, -360, 760, 520], fill=(217, 154, 43, 30))
    gd.ellipse([420, 700, 1200, 1500], fill=(34, 54, 75, 16))
    im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(90)))

    # 右侧照片区
    px0, py0, px1, py1 = 486, 0, W, H
    pw, ph = px1 - px0, py1 - py0
    if photo_path and os.path.exists(photo_path):
        photo = load_cover_crop(photo_path, pw, ph, 0.32).convert("RGBA")
        im.paste(photo, (px0, py0))
        # 左侧渐隐融进米白
        gw = 170
        grad = Image.new("L", (gw, 1))
        for i in range(gw):
            grad.putpixel((i, 0), int(255 * (1 - i / (gw - 1)) ** 1.6))
        grad = grad.resize((gw, ph))
        cream = Image.new("RGBA", (gw, ph), CREAM + (255,))
        im.paste(cream, (px0, py0), grad)
        # 底部渐隐
        gh = 200
        grad2 = Image.new("L", (1, gh))
        for i in range(gh):
            grad2.putpixel((0, i), int(255 * (i / (gh - 1)) ** 1.8))
        grad2 = grad2.resize((pw, gh))
        cream2 = Image.new("RGBA", (pw, gh), CREAM + (255,))
        im.paste(cream2, (px0, py1 - gh), grad2)
    else:
        # 占位框
        box = [px0 + 24, 40, px1 - 24, H - 40]
        dashed_rect(im, box, 34)
        d = ImageDraw.Draw(im)
        cx = (box[0] + box[2]) // 2
        cy = (box[1] + box[3]) // 2
        # 人像图标
        d.ellipse([cx - 46, cy - 96, cx + 46, cy - 4], outline=(198, 184, 158, 255), width=4)
        d.arc([cx - 78, cy + 6, cx + 78, cy + 170], 200, 340, fill=(198, 184, 158, 255), width=4)
        draw_text(d, (cx, cy + 196), "在此放入你的出镜照", font(True, 30), (176, 162, 136), anchor="ma")
        draw_text(d, (cx, cy + 240), "建议 3:4 竖图 · 半身或工作台实拍", font(False, 22), (188, 175, 150), anchor="ma")

    d = ImageDraw.Draw(im)
    # 左上品牌
    ic = ICON.resize((64, 64), Image.LANCZOS)
    im.paste(ic, (64, 56), rrect((64, 64), 16, (255, 255, 255, 255)))
    draw_text(d, (142, 60), "DNS 送货单统计", font(True, 27), NAVY, ls=1)
    draw_text(d, (142, 94), "独立开发 · 送货宝作者", font(False, 19), MUTED, ls=1)

    # 主文案
    tw_max = 400
    draw_text(d, (64, 210), "老板想做 App", font(True, 78), NAVY, ls=1)
    draw_text(d, (64, 306), "不用懂技术", font(True, 78), AMBER, ls=1)
    sub = "把生意里的麻烦说清楚，设计和代码我来搞定"
    f = font(False, 27)
    ly = 424
    for ln in wrap_text(d, sub, f, tw_max + 20, 0.5):
        draw_text(d, (66, ly), ln, f, NAVY_SOFT, ls=0.5)
        ly += 38

    # 我给自己贴的标签
    y = 560
    for t in ["一个人接单", "不套模板", "能长期维护"]:
        w = chip(im, (64, y), t, size=21, padx=16, pady=10)
        y += 58

    # 底部五步
    dd = ImageDraw.Draw(im)
    steps = ["聊需求", "出方案", "做设计", "写代码", "上线维护"]
    yy = 1110
    for i, s in enumerate(steps):
        dd.ellipse([64, yy + 9, 76, yy + 21], fill=AMBER)
        draw_text(dd, (92, yy), f"{i+1}. {s}", font(True, 24), NAVY, ls=1)
        yy += 46

    draw_text(dd, (64, 1358), "案例：送货宝 · 桌面+手机双端开单软件", font(False, 21), MUTED, ls=0.5)

    im.convert("RGB").save(os.path.join(OUT, "07-cover-person.png"), quality=95)
    print("WROTE 07-cover-person.png (photo=%s)" % bool(photo_path and os.path.exists(photo_path)))

if __name__ == "__main__":
    make_cover()
    make_desktop()
    make_mobile()
    make_features()
    make_hire_cover()
    make_process()
    make_cover_person(os.environ.get("XHS_PHOTO"))
