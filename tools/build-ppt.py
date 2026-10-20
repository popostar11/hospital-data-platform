# -*- coding: utf-8 -*-
"""
生成《急诊专科中心数据平台 · 急救绿道》项目介绍 PPTX

用法：
    python tools/build-ppt.py

产出：
    docs/ppt/急诊专科中心数据平台-项目介绍.pptx   （16:9，13 页，文字/表格/图片均可编辑）

设计约定：
    - 所有文字用微软雅黑，并同时设置 latin 与 ea 字体，避免中文回退成宋体
    - 颜色统一走下面这组常量，不写字面色值
    - 截图按 16:9 精确摆放，编号圆圈用图片宽高的比例定位，改图不会错位
"""
from pathlib import Path

import sys

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "docs" / "ppt" / "images"
OUT = ROOT / "docs" / "ppt" / "急诊专科中心数据平台-项目介绍.pptx"

# ----------------------------------------------------------------- 设计常量
# 配色与大屏自身的样式令牌对齐（--c-bg / --c-cyan / --c-value 等），
# 因此演示稿与产品是同一套视觉；--light 可切回浅色便于打印。
FONT = "微软雅黑"
DARK = "--light" not in sys.argv

if DARK:
    PAGE_BG = RGBColor(0x04, 0x12, 0x2B)      # 大屏主背景
    COVER_BG = RGBColor(0x02, 0x09, 0x1A)     # 大屏最深背景
    BLUE_DEEP = RGBColor(0xEC, 0xF7, 0xFF)    # 主标题（深色下为近白）
    BLUE = RGBColor(0x5C, 0xC8, 0xFF)         # 强调
    ACCENT = RGBColor(0x7F, 0xE3, 0xFF)       # 高亮 / 编号
    MINT = RGBColor(0x7F, 0xFF, 0xE0)         # 关键数值
    GOOD = RGBColor(0x7F, 0xFF, 0xE0)
    WARN = RGBColor(0xFF, 0xC2, 0x4D)
    TEXT = RGBColor(0xBB, 0xD4, 0xEC)         # 正文
    MUTED = RGBColor(0x7E, 0x9E, 0xC4)        # 次要文字
    LIGHT = RGBColor(0x08, 0x22, 0x4A)        # 卡片底
    LIGHT2 = RGBColor(0x06, 0x1A, 0x38)       # 次级底
    BORDER = RGBColor(0x1A, 0x42, 0x72)       # 描边
    CARD_FILL = RGBColor(0x06, 0x1A, 0x38)
    TBL_HEAD = RGBColor(0x0C, 0x2C, 0x54)
    TBL_HEAD_T = RGBColor(0x7F, 0xE3, 0xFF)
    COVER_CARD = RGBColor(0x0A, 0x24, 0x48)
    SOFT_ON_DARK = RGBColor(0xC7, 0xDC, 0xF2)
    LABEL_ON_DARK = RGBColor(0x7F, 0x9D, 0xC4)
    WHITE = RGBColor(0xFF, 0xFF, 0xFF)
else:
    PAGE_BG = RGBColor(0xFF, 0xFF, 0xFF)
    COVER_BG = RGBColor(0x0A, 0x2A, 0x52)
    BLUE_DEEP = RGBColor(0x0B, 0x3B, 0x72)
    BLUE = RGBColor(0x14, 0x6C, 0xC0)
    ACCENT = RGBColor(0x1E, 0x88, 0xE5)
    MINT = RGBColor(0x0E, 0x8F, 0x7A)
    GOOD = RGBColor(0x2E, 0x9E, 0x5B)
    WARN = RGBColor(0xD9, 0x8B, 0x2B)
    TEXT = RGBColor(0x1F, 0x2D, 0x3D)
    MUTED = RGBColor(0x5A, 0x6B, 0x85)
    LIGHT = RGBColor(0xF2, 0xF6, 0xFC)
    LIGHT2 = RGBColor(0xE8, 0xF1, 0xFB)
    BORDER = RGBColor(0xD6, 0xE2, 0xF0)
    CARD_FILL = RGBColor(0xFF, 0xFF, 0xFF)
    TBL_HEAD = RGBColor(0x14, 0x6C, 0xC0)
    TBL_HEAD_T = RGBColor(0xFF, 0xFF, 0xFF)
    COVER_CARD = RGBColor(0x12, 0x3A, 0x69)
    SOFT_ON_DARK = RGBColor(0xC8, 0xDC, 0xF2)
    LABEL_ON_DARK = RGBColor(0x9F, 0xC2, 0xE6)
    WHITE = RGBColor(0xFF, 0xFF, 0xFF)

SW, SH = 13.333, 7.5                      # 16:9
M = 0.62                                  # 页边距
CW = SW - 2 * M                           # 内容宽度
BODY_TOP = 1.46

prs = Presentation()
prs.slide_width = Inches(SW)
prs.slide_height = Inches(SH)
BLANK = prs.slide_layouts[6]


# --------------------------------------------------------------------- 基础
def set_font(run, size=14, bold=False, color=TEXT, name=FONT, italic=False):
    """设置字体；中文必须同时写 a:ea，否则 PowerPoint 会回退成宋体"""
    f = run.font
    f.name = name
    f.size = Pt(size)
    f.bold = bold
    f.italic = italic
    f.color.rgb = color
    rPr = run._r.get_or_add_rPr()
    for tag in ("a:ea", "a:cs"):
        el = rPr.find(qn(tag))
        if el is None:
            el = rPr.makeelement(qn(tag), {})
            rPr.append(el)
        el.set("typeface", name)


def tb(slide, x, y, w, h, paras, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, wrap=True):
    """多段落文本框。paras = [ {'runs':[{'t':..,'sz':..,'b':..,'c':..}], 'space_after':6, 'line':1.25} ]"""
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = wrap
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = Emu(0)
    tf.margin_top = tf.margin_bottom = Emu(0)
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = para.get("align", align)
        if para.get("space_after") is not None:
            p.space_after = Pt(para["space_after"])
        if para.get("space_before") is not None:
            p.space_before = Pt(para["space_before"])
        if para.get("line") is not None:
            p.line_spacing = para["line"]
        for r in para["runs"]:
            run = p.add_run()
            run.text = r["t"]
            set_font(run, r.get("sz", 14), r.get("b", False), r.get("c", TEXT), italic=r.get("italic", False))
    return box


def card(slide, x, y, w, h, fill=LIGHT, line=BORDER, radius=0.06, accent_top=None):
    """圆角卡片；accent_top 传色值则在顶部加一条色带（PowerPoint 里就是一条细矩形）"""
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shp.fill.solid()
    shp.fill.fore_color.rgb = fill
    shp.line.color.rgb = line
    shp.line.width = Pt(0.75)
    shp.shadow.inherit = False
    try:
        shp.adjustments[0] = radius
    except Exception:
        pass
    if accent_top is not None:
        bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(0.055))
        bar.fill.solid()
        bar.fill.fore_color.rgb = accent_top
        bar.line.fill.background()
        bar.shadow.inherit = False
    return shp


def header(slide, kicker, title, title_sz=27):
    tb(slide, M, 0.36, CW, 0.3, [{"runs": [{"t": kicker, "sz": 11.5, "b": True, "c": ACCENT}]}])
    tb(slide, M, 0.68, CW, 0.7, [{"runs": [{"t": title, "sz": title_sz, "b": True, "c": BLUE_DEEP}]}])


def footer(slide, n, total=13):
    tb(slide, SW - M - 1.6, SH - 0.52, 1.6, 0.3,
       [{"runs": [{"t": f"急救绿道 · {n} / {total}", "sz": 10, "c": MUTED}], "align": PP_ALIGN.RIGHT}])


def new(kicker, title, n, title_sz=27):
    s = prs.slides.add_slide(BLANK)
    # 页面底色：深色主题必须显式铺一层，否则沿用模板白底
    bg = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    bg.fill.solid()
    bg.fill.fore_color.rgb = PAGE_BG
    bg.line.fill.background()
    bg.shadow.inherit = False
    header(s, kicker, title, title_sz)
    footer(s, n)
    return s


def num_dot(slide, cx, cy, d, text, size=11):
    """编号圆圈（cx/cy 是圆心，单位英寸）"""
    shp = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - d / 2), Inches(cy - d / 2), Inches(d), Inches(d))
    shp.fill.solid()
    shp.fill.fore_color.rgb = ACCENT
    shp.line.color.rgb = WHITE
    shp.line.width = Pt(1.5)
    shp.shadow.inherit = False
    tf = shp.text_frame
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = Emu(0)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    run = p.add_run()
    run.text = text
    set_font(run, size, True, WHITE)
    return shp


def picture_16x9(slide, path, x, y, w):
    """按 16:9 摆放截图"""
    h = w * 9 / 16
    slide.shapes.add_picture(str(path), Inches(x), Inches(y), width=Inches(w), height=Inches(h))
    return h


def legend_row(slide, x, y, w, items, row_h=0.66, gap=0.1, dot=0.3):
    """图例：左侧圆圈编号 + 右侧标题与说明"""
    cy = y
    for mark, head, desc in items:
        card(slide, x, cy, w, row_h, LIGHT, BORDER)
        num_dot(slide, x + 0.36, cy + row_h / 2, dot, mark, 10)
        tb(slide, x + 0.62, cy + 0.075, w - 0.8, row_h - 0.14,
           [{"runs": [{"t": head, "sz": 11.5, "b": True, "c": TEXT}], "space_after": 1},
            {"runs": [{"t": desc, "sz": 9.5, "c": MUTED}], "line": 1.15}])
        cy += row_h + gap
    return cy


def style_table(tbl, widths, header_sz=11, body_sz=11, row_h=0.42):
    for i, w in enumerate(widths):
        tbl.columns[i].width = Inches(w)
    for r, row in enumerate(tbl.rows):
        row.height = Inches(row_h if r else row_h * 0.92)
        for c, cell in enumerate(row.cells):
            cell.margin_left = cell.margin_right = Inches(0.11)
            cell.margin_top = cell.margin_bottom = Inches(0.045)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.fill.solid()
            cell.fill.fore_color.rgb = TBL_HEAD if r == 0 else (CARD_FILL if r % 2 else LIGHT)
            for p in cell.text_frame.paragraphs:
                for run in p.runs:
                    set_font(run, header_sz if r == 0 else body_sz, r == 0, TBL_HEAD_T if r == 0 else TEXT)


def put_table(slide, x, y, w, rows_data, widths, row_h=0.42):
    """画表格并返回**表格底边所在的 y**（英寸）。

    返回底边而不是表格对象：行高只是最小值，文字换行后实际更高，
    调用方必须按真实底边放后续内容，否则下面的文字会压到表格上。
    """
    n_rows, n_cols = len(rows_data), len(rows_data[0])
    gf = slide.shapes.add_table(n_rows, n_cols, Inches(x), Inches(y), Inches(w), Inches(row_h * n_rows))
    tbl = gf.table
    for r, row in enumerate(rows_data):
        for c, val in enumerate(row):
            tbl.cell(r, c).text = val
    style_table(tbl, widths, row_h=row_h)
    return y + sum(r.height for r in tbl.rows) / 914400


# ============================================================== 1 · 封面
s = prs.slides.add_slide(BLANK)
bg = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
bg.fill.solid()
bg.fill.fore_color.rgb = COVER_BG
bg.line.fill.background()
bg.shadow.inherit = False

tb(s, 1.0, 1.55, 11.3, 0.4, [{"runs": [{"t": "项目介绍 · 2026", "sz": 14, "b": True, "c": ACCENT}]}])
tb(s, 1.0, 2.05, 11.3, 1.5,
   [{"runs": [{"t": "急诊专科中心数据平台", "sz": 44, "b": True, "c": WHITE}], "space_after": 4},
    {"runs": [{"t": "急救绿道", "sz": 44, "b": True, "c": ACCENT}]}])
tb(s, 1.0, 3.85, 10.4, 0.8,
   [{"runs": [{"t": "一块大屏看全局，一个后台管细节。", "sz": 17, "c": SOFT_ON_DARK}], "space_after": 4},
    {"runs": [{"t": "这份 PPT 用大白话讲清楚：它是什么、怎么做的、怎么用。", "sz": 17, "c": SOFT_ON_DARK}]}])
for i, (head, desc) in enumerate([("全自动", "双击启动，之后开机即用、崩了自愈"),
                                  ("有验收", "71 项自动化检查，改坏了立刻知道"),
                                  ("已脱敏", "示例机构名与合成数据，可安全公开")]):
    x = 1.0 + i * 3.75
    card(s, x, 5.0, 3.45, 0.92, COVER_CARD, BORDER)
    num_dot(s, x + 0.42, 5.46, 0.34, str(i + 1), 11)
    tb(s, x + 0.72, 5.16, 2.6, 0.66,
       [{"runs": [{"t": head, "sz": 13, "b": True, "c": WHITE}], "space_after": 1},
        {"runs": [{"t": desc, "sz": 9.5, "c": LABEL_ON_DARK}], "line": 1.15}])

# ============================================================== 2 · 目录
s = new("目录", "今天只讲三个问题", 2)
items = [("01 · 它是什么", "谁在用、解决什么问题、长什么样。", "第 3 ~ 6 页"),
         ("02 · 怎么做的", "数据怎么流、系统分几层、为什么这么选。", "第 7 ~ 11 页"),
         ("03 · 怎么用", "两个入口、怎么打开、怎么验收到位。", "第 12 ~ 13 页")]
for i, (head, desc, pages) in enumerate(items):
    x = M + i * (CW / 3 + 0.001)
    w = CW / 3 - 0.3
    card(s, x, BODY_TOP + 0.7, w, 2.5, CARD_FILL, BORDER, accent_top=ACCENT)
    tb(s, x + 0.34, BODY_TOP + 1.02, w - 0.68, 1.9,
       [{"runs": [{"t": head, "sz": 19, "b": True, "c": BLUE_DEEP}], "space_after": 10},
        {"runs": [{"t": desc, "sz": 13, "c": TEXT}], "line": 1.35, "space_after": 14},
        {"runs": [{"t": pages, "sz": 11, "c": MUTED}]}])

# ============================================================== 3 · 它是什么
s = new("01 · 它是什么", "一句话：把「急救快不快」变成看得见的数字", 3)
tb(s, M, BODY_TOP - 0.14, CW, 0.4,
   [{"runs": [{"t": "过去要翻表格、打电话问；现在抬头看屏幕就知道。", "sz": 14.5, "c": MUTED}]}])
for i, (icon, head, desc) in enumerate([
        ("🖥", "一块大屏", "挂在急诊、医务科或指挥中心。患者从呼救到进入绿道，实时滚动，谁都能看。"),
        ("🗂", "一个后台", "医生护士录病例、补齐时间节点、维护疾病字典；管理员管账号和权限。"),
        ("📈", "一套报表", "按月、按科室、按病种统计数量与响应时长，还能一键导出成 Excel。")]):
    x = M + i * (CW / 3 + 0.001)
    w = CW / 3 - 0.3
    card(s, x, BODY_TOP + 0.62, w, 3.0, CARD_FILL, BORDER)
    tb(s, x + 0.34, BODY_TOP + 0.86, w - 0.68, 2.6,
       [{"runs": [{"t": icon, "sz": 26}], "space_after": 6},
        {"runs": [{"t": head, "sz": 18, "b": True, "c": BLUE_DEEP}], "space_after": 8},
        {"runs": [{"t": desc, "sz": 12.5, "c": TEXT}], "line": 1.4}])

# ============================================================== 4 · 大屏（图例）
s = new("01 · 它是什么", "大屏长这样：五个区域，各有分工", 4)
IMG_W = 7.35
IMG_H = picture_16x9(s, IMG / "screen.png", M, BODY_TOP + 0.06, IMG_W)
tb(s, M, BODY_TOP + 0.06 + IMG_H + 0.06, IMG_W, 0.3,
   [{"runs": [{"t": "图 1 · 1920×1080 实机渲染（数据为合成演示数据）", "sz": 9.5, "c": MUTED}],
     "align": PP_ALIGN.CENTER}])
# 编号按图片宽高的比例定位，与 HTML 版一致
for mark, fx, fy in [("1", 0.86, 0.045), ("2", 0.16, 0.31), ("3", 0.66, 0.30), ("4", 0.12, 0.60), ("5", 0.50, 0.92)]:
    num_dot(s, M + fx * IMG_W, BODY_TOP + 0.06 + fy * IMG_H, 0.27, mark, 10)
legend_row(s, M + IMG_W + 0.28, BODY_TOP + 0.06, CW - IMG_W - 0.28, [
    ("1", "顶部标题栏", "机构名称 + 实时时钟，一眼确认「这屏是活的」"),
    ("2", "累计患者饼图", "绿道总人数，点一下可切到别的病种"),
    ("3", "近 12 个月柱状图", "看趋势；末月标注「本月至今」，不会显得掉量"),
    ("4", "24 小时内患者表", "姓名（脱敏）、病种、推送方式、距离、状态；超一屏自动无缝滚动"),
    ("5", "底部统计条", "各病种未闭环数量，提醒还有谁没走完流程"),
], row_h=0.88, gap=0.11)

# ============================================================== 5 · 后台（图例）
s = new("01 · 它是什么", "后台管细节：谁都能上手，但谁都不能越权", 5)
IMG_W2 = 7.6
IMG_H2 = picture_16x9(s, IMG / "admin.png", M, BODY_TOP + 0.2, IMG_W2)
tb(s, M, BODY_TOP + 0.2 + IMG_H2 + 0.06, IMG_W2, 0.3,
   [{"runs": [{"t": "图 2 · 后台工作台：今日新增、在绿道中、超时提醒、7 日趋势", "sz": 9.5, "c": MUTED}],
     "align": PP_ALIGN.CENTER}])
mods = [("A", "病例管理", "新建、修改、闭环"), ("B", "患者管理", "姓名自动脱敏"),
        ("C", "字典维护", "病种与状态可改"), ("D", "组织人员", "科室 + 账号 + 角色"),
        ("E", "报表统计", "月报、KPI、导出"), ("F", "审计日志", "谁改了什么全留底")]
bx = M + IMG_W2 + 0.26
bw = CW - IMG_W2 - 0.26
for i, (mk, head, desc) in enumerate(mods):
    col, row = i % 2, i // 2
    x = bx + col * (bw / 2 + 0.02)
    y = BODY_TOP + 0.2 + row * 0.98
    cw = bw / 2 - 0.1
    card(s, x, y, cw, 0.88, LIGHT, BORDER)
    num_dot(s, x + 0.34, y + 0.44, 0.3, mk, 10)
    tb(s, x + 0.58, y + 0.13, cw - 0.72, 0.66,
       [{"runs": [{"t": head, "sz": 11.5, "b": True, "c": TEXT}], "space_after": 1},
        {"runs": [{"t": desc, "sz": 9.5, "c": MUTED}]}])
tb(s, bx, BODY_TOP + 0.2 + 3 * 0.98 + 0.05, bw, 1.0,
   [{"runs": [{"t": "七种角色：", "sz": 11.5, "b": True, "c": TEXT},
              {"t": "管理员、急诊管理员、医生、护士、质控、院领导、大屏终端。", "sz": 11.5, "c": TEXT}], "line": 1.35, "space_after": 5},
    {"runs": [{"t": "院领导看不到患者明文，护士进不了审计页", "sz": 11.5, "b": True, "c": BLUE},
              {"t": "——这是系统自己拦的，不靠人自觉。", "sz": 11.5, "c": TEXT}], "line": 1.35}])

# ============================================================== 6 · 关键数字
s = new("01 · 它是什么", "用数字感受一下这套系统", 6)
kpis = [("示例病例", "5089", "含 12 个月历史，够看出趋势"),
        ("时间节点", "30689", "每个病例 6 个环节，用来算时长"),
        ("自动化验收", "71", "改代码后自动跑，坏了立刻知道"),
        ("页面", "14", "大屏 1 页 + 后台 13 页")]
for i, (label, value, desc) in enumerate(kpis):
    x = M + i * (CW / 4 + 0.001)
    w = CW / 4 - 0.26
    card(s, x, BODY_TOP + 0.55, w, 2.35, CARD_FILL, BORDER, accent_top=ACCENT)
    tb(s, x + 0.32, BODY_TOP + 0.82, w - 0.64, 1.9,
       [{"runs": [{"t": label, "sz": 11, "b": True, "c": MUTED}], "space_after": 6},
        {"runs": [{"t": value, "sz": 40, "b": True, "c": BLUE_DEEP}], "space_after": 8},
        {"runs": [{"t": desc, "sz": 11, "c": TEXT}], "line": 1.3}])
tb(s, M, BODY_TOP + 3.2, CW, 0.7,
   [{"runs": [{"t": "冷启动（全新电脑、什么都没装）：", "sz": 15, "c": TEXT},
              {"t": "双击一个文件，30 秒内自动装好依赖、建库、灌数据、打开浏览器。", "sz": 15, "b": True, "c": BLUE_DEEP}],
     "line": 1.35}])

# ============================================================== 7 · 数据流（图例）
s = new("02 · 怎么做的", "一条数据从产生到上屏，走五步", 7)
steps = [("① 产生", "120 送来 / 院内接诊\n或 HIS 系统推送", False),
         ("② 录入", "后台填病例\n或接口自动创建", False),
         ("③ 存储", "一个 SQLite 数据库文件\n时间统一存本地时区", True),
         ("④ 聚合", "服务端算好饼图 / 柱状图\n大屏不用自己算", True),
         ("⑤ 展示", "大屏 + 后台 + 报表\n同时拿到同一份数据", False)]
bw2 = (CW - 4 * 0.42) / 5
for i, (head, desc, hl) in enumerate(steps):
    x = M + i * (bw2 + 0.42)
    card(s, x, BODY_TOP + 0.75, bw2, 1.95, CARD_FILL, BORDER, accent_top=ACCENT if hl else None)
    tb(s, x + 0.16, BODY_TOP + 1.02, bw2 - 0.32, 1.5,
       [{"runs": [{"t": head, "sz": 15, "b": True, "c": BLUE_DEEP}], "align": PP_ALIGN.CENTER, "space_after": 8},
        {"runs": [{"t": desc, "sz": 10.5, "c": TEXT}], "align": PP_ALIGN.CENTER, "line": 1.3}])
    if i < 4:
        tb(s, x + bw2, BODY_TOP + 1.55, 0.42, 0.4,
           [{"runs": [{"t": "→", "sz": 20, "b": True, "c": ACCENT}], "align": PP_ALIGN.CENTER}])
lg = [("▌", "蓝边 = 服务端在做的事", "③④两步是关键：算在服务端，屏幕只负责画"),
      ("↻", "实时刷新", "有新数据就推送信号，大屏 1~3 秒内更新"),
      ("⏱", "兜底轮询", "推送断了也不会卡死，按周期自己拉一次"),
      ("📅", "月度归集", "柱状图按「年-月」分组，跨年也不会乱")]
for i, (mk, head, desc) in enumerate(lg):
    x = M + i * (CW / 4 + 0.001)
    w = CW / 4 - 0.24
    y = BODY_TOP + 3.15
    card(s, x, y, w, 1.0, LIGHT, BORDER)
    tb(s, x + 0.26, y + 0.16, w - 0.5, 0.75,
       [{"runs": [{"t": head, "sz": 11, "b": True, "c": TEXT}], "space_after": 2},
        {"runs": [{"t": desc, "sz": 9.5, "c": MUTED}], "line": 1.15}])

# ============================================================== 8 · 架构（图例）
s = new("02 · 怎么做的", "系统分四层，各管各的", 8)
tiers = [("使用者", [("👩‍⚕️", "医生 / 护士", "录入与跟进"), ("📋", "质控 / 领导", "看报表与指标"), ("📺", "大屏终端", "只读展示")], False),
         ("前端", [("🖥️", "大屏端", "Vue 3 + ECharts，手写 HUD 界面"), ("🗂️", "后台端", "Vue 3 + Element Plus，13 个页面")], True),
         ("后端", [("登录与权限", "7 种角色、登录令牌、操作留痕"), ("业务接口", "病例 / 患者 / 字典 / 组织 / 审计"), ("统计与推送", "报表聚合、质控指标、实时信号")], True),
         ("数据", [("SQLite 数据库", "15 张表，单文件，随项目走"), ("D1 云数据库", "公网版用同一套表结构")], False)]
y = BODY_TOP + 0.06
for tname, cells, core in tiers:
    th = 1.02 if len(cells) == 3 else 0.82
    card(s, M, y, 1.15, th, LIGHT2, BORDER)
    tb(s, M, y + th / 2 - 0.16, 1.15, 0.34,
       [{"runs": [{"t": tname, "sz": 12, "b": True, "c": BLUE_DEEP}], "align": PP_ALIGN.CENTER}])
    cx0 = M + 1.15 + 0.18
    cwid = (CW - 1.15 - 0.18 - (len(cells) - 1) * 0.16) / len(cells)
    for i, cell in enumerate(cells):
        cx = cx0 + i * (cwid + 0.16)
        card(s, cx, y, cwid, th, CARD_FILL, BORDER, accent_top=ACCENT if core else None)
        if len(cell) == 3:
            icon, head, desc = cell
            paras = [{"runs": [{"t": icon, "sz": 15}], "align": PP_ALIGN.CENTER, "space_after": 2},
                     {"runs": [{"t": head, "sz": 12.5, "b": True, "c": TEXT}], "align": PP_ALIGN.CENTER, "space_after": 2},
                     {"runs": [{"t": desc, "sz": 9.5, "c": MUTED}], "align": PP_ALIGN.CENTER, "line": 1.15}]
        else:
            head, desc = cell
            paras = [{"runs": [{"t": head, "sz": 12.5, "b": True, "c": TEXT}], "align": PP_ALIGN.CENTER, "space_after": 3},
                     {"runs": [{"t": desc, "sz": 9.5, "c": MUTED}], "align": PP_ALIGN.CENTER, "line": 1.15}]
        tb(s, cx + 0.14, y + 0.16, cwid - 0.28, th - 0.3, paras)
    y += th + 0.13
for i, (head, desc) in enumerate([("蓝边 = 核心", "前端、后端这两层是项目主体"),
                                  ("无蓝边 = 配套", "使用者与数据层，改动少"),
                                  ("上下依赖单向", "每层只调用下一层，不反向依赖")]):
    x = M + i * (CW / 3 + 0.001)
    w = CW / 3 - 0.26
    card(s, x, y + 0.06, w, 0.72, LIGHT, BORDER)
    tb(s, x + 0.24, y + 0.18, w - 0.48, 0.5,
       [{"runs": [{"t": head, "sz": 11, "b": True, "c": BLUE}], "space_after": 1},
        {"runs": [{"t": desc, "sz": 9.5, "c": MUTED}]}])

# ============================================================== 9 · 随时能用
s = new("02 · 怎么做的", "「随时能打开」是怎么做到的", 9)
tb(s, M, BODY_TOP - 0.12, CW, 0.4,
   [{"runs": [{"t": "起因是一个真实的坑：服务跑在前台窗口里，", "sz": 14, "c": TEXT},
              {"t": "按 Ctrl+C 想复制文字，结果把服务关了", "sz": 14, "b": True, "c": BLUE},
              {"t": "。", "sz": 14, "c": TEXT}]}])
for i, (head, desc) in enumerate([("双击启动", "自动装依赖、建库、灌数据、打开浏览器，缺哪步补哪步。"),
                                  ("交给守护进程", "服务在后台跑，没有窗口，Ctrl+C 和误关窗口都影响不到它。"),
                                  ("崩了自动拉起", "进程一退出 3 秒内自动重启。实测强杀后 12 秒恢复正常。"),
                                  ("开机自己起来", "装一次自启，之后重启电脑也不用管，大屏终端断电恢复即可用。")]):
    x = M + i * (CW / 4 + 0.001)
    w = CW / 4 - 0.26
    card(s, x, BODY_TOP + 0.78, w, 2.4, CARD_FILL, BORDER, accent_top=ACCENT)
    num_dot(s, x + 0.5, BODY_TOP + 1.1, 0.42, str(i + 1), 14)
    tb(s, x + 0.3, BODY_TOP + 1.55, w - 0.6, 1.5,
       [{"runs": [{"t": head, "sz": 15, "b": True, "c": BLUE_DEEP}], "space_after": 8},
        {"runs": [{"t": desc, "sz": 11, "c": TEXT}], "line": 1.4}])
tb(s, M, BODY_TOP + 3.45, CW, 0.5,
   [{"runs": [{"t": "另外：演示数据会随日期自动「保鲜」，隔几天再打开，大屏", "sz": 13.5, "c": TEXT},
              {"t": "不会出现空白表格", "sz": 13.5, "b": True, "c": BLUE_DEEP},
              {"t": "。", "sz": 13.5, "c": TEXT}]}])

# ============================================================== 10 · 两个入口
s = new("03 · 怎么用", "两个入口，按需要选", 10)
blocks = [(True, "本地完整版", "功能齐全，装在电脑上跑", "http://127.0.0.1:3000/admin/",
           ["登录、增删改、报表导出全都能用", "数据存在本机，不外传",
            "双击「启动.bat」即可，无需装环境", "适合：院内日常使用、演示汇报"]),
          (False, "公网演示版", "发个链接就能看，装了就能用", "popostar11.github.io/hospital-data-platform",
           ["任何人、任何设备打开即看大屏", "数据是导出的静态快照，只读",
            "不需要服务器、不需要账号、不花钱", "适合：分享给同行、外出演示"])]
for i, (good, tag, head, url, bullets) in enumerate(blocks):
    x = M + i * (CW / 2 + 0.2)
    w = CW / 2 - 0.2
    card(s, x, BODY_TOP + 0.3, w, 4.05, CARD_FILL, BORDER, accent_top=GOOD if good else ACCENT)
    tb(s, x + 0.36, BODY_TOP + 0.6, w - 0.72, 3.5,
       [{"runs": [{"t": tag, "sz": 11.5, "b": True, "c": MUTED}], "space_after": 5},
        {"runs": [{"t": head, "sz": 18, "b": True, "c": BLUE_DEEP}], "space_after": 10},
        {"runs": [{"t": url, "sz": 11, "c": BLUE, "italic": False}], "space_after": 12}] + [
        {"runs": [{"t": "· " + b, "sz": 12.5, "c": TEXT}], "line": 1.3, "space_after": 6} for b in bullets])

# ============================================================== 11 · 技术选型
s = new("02 · 怎么做的", "几个关键选择，以及为什么", 11)
put_table(s, M, BODY_TOP + 0.35, CW, [
    ["选择", "决定了什么", "为什么这么定"],
    ["SQLite 单文件数据库", "不用装 MySQL", "院内一台电脑就能跑，拷走一个文件就是完整备份；数据量到几十万条都够用"],
    ["大屏与后台分成两个前端", "互不影响", "大屏要 7×24 常驻、不能被后台改崩；分开后各自升级，大屏可以只读锁定"],
    ["计算放在服务端", "屏幕只管画", "换屏幕、加屏幕不用改逻辑，弱配置的终端也能流畅"],
    ["公网版重写一层后端", "能上 Cloudflare 免费额度", "云函数跑不了本地数据库和 NestJS；重写的是「壳」，接口与算法口径和本地版保持一致"],
    ["机构名与数据全部脱敏", "可以安全公开", "示例机构名 + 合成数据，真实素材不进仓库；公开仓库里搜不到任何真实名称"],
], widths=[3.2, 2.7, 6.193], row_h=0.82)

# ============================================================== 12 · 验收
s = new("03 · 怎么用", "改完代码，用 71 项检查确认没坏", 12)
tbl_bottom = put_table(s, M, BODY_TOP + 0.35, CW, [
    ["验收套件", "项数", "检查什么"],
    ["接口验收", "37 项", "把大屏上的每个数字都钉死成断言：累计人数、12 个月序列、24 小时表格内容、筛选排序、权限拦截"],
    ["大屏验收", "7 项", "真浏览器打开：标题、8 列表头、姓名脱敏、无缝滚动，并输出 1920×1080 截图"],
    ["后台验收", "18 项", "真实登录后逐页巡检 13 个页面，并验证越权会被拦"],
    ["公网版验收", "33 项", "额外确认「响应里不出现真实机构名」和「不提供患者明文」"],
    ["批处理编码检查", "1 项", "防止中文写进 .bat 导致命令解析错乱——这是踩过的坑，做成回归守卫"],
], widths=[2.6, 1.2, 8.293], row_h=0.70)
tb(s, M, tbl_bottom + 0.16, CW, 0.5,
   [{"runs": [{"t": "全部只依赖系统自带的 Node 和 Chrome，", "sz": 13.5, "c": TEXT},
              {"t": "不需要装 Playwright 之类的测试框架", "sz": 13.5, "b": True, "c": BLUE_DEEP},
              {"t": "。", "sz": 13.5, "c": TEXT}]}])

# ============================================================== 13 · 结尾
s = prs.slides.add_slide(BLANK)
bg = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
bg.fill.solid()
bg.fill.fore_color.rgb = COVER_BG
bg.line.fill.background()
bg.shadow.inherit = False
tb(s, 0.9, 1.35, 11.5, 1.9,
   [{"runs": [{"t": "现在就能用", "sz": 40, "b": True, "c": WHITE}], "align": PP_ALIGN.CENTER, "space_after": 12},
    {"runs": [{"t": "三步：双击启动 → 浏览器打开 → 用 admin / Hospital@123 登录。", "sz": 16, "c": SOFT_ON_DARK}],
     "align": PP_ALIGN.CENTER}])
for i, (head, desc) in enumerate([("启动", "双击项目根目录的「启动.bat」"),
                                  ("打开", "后台 /admin/ ｜ 大屏 /screen/"),
                                  ("停止", "双击「停止.bat」；取消自启用「取消开机自启.bat」")]):
    x = 0.9 + i * 3.95
    card(s, x, 3.5, 3.7, 1.15, COVER_CARD, BORDER)
    num_dot(s, x + 0.46, 4.08, 0.36, str(i + 1), 11)
    tb(s, x + 0.78, 3.72, 2.75, 0.85,
       [{"runs": [{"t": head, "sz": 13, "b": True, "c": WHITE}], "space_after": 3},
        {"runs": [{"t": desc, "sz": 9.5, "c": LABEL_ON_DARK}], "line": 1.15}])
tb(s, 0.9, 5.15, 11.5, 1.0,
   [{"runs": [{"t": "公网大屏：popostar11.github.io/hospital-data-platform", "sz": 14, "c": WHITE}],
     "align": PP_ALIGN.CENTER, "space_after": 8},
    {"runs": [{"t": "全部数据为合成的示例数据，不代表任何真实机构或真实统计结果", "sz": 11.5, "c": LABEL_ON_DARK}],
     "align": PP_ALIGN.CENTER}])

OUT.parent.mkdir(parents=True, exist_ok=True)
prs.save(str(OUT))
print(f"已生成：{OUT}")
print(f"页数：{len(prs.slides.__iter__.__self__._sldIdLst)}  尺寸：{SW}×{SH} 英寸（16:9）")
