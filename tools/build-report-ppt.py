# -*- coding: utf-8 -*-
"""
生成《医院数据管理平台 · 急救绿道》**领导汇报** PPTX

用法：
    python tools/build-report-ppt.py            # 默认：深色（与大屏同色系）
    python tools/build-report-ppt.py --light    # 浅色（便于打印 / 明亮会议室）

产出：
    docs/ppt/医院数据管理平台-项目汇报.pptx   （16:9，15 页）

配色取自大屏自身的样式令牌，因此汇报稿与产品是同一套视觉：
    --c-bg-deep #02091a · --c-bg #04122b · 面板渐变 rgba(9,42,88,.62)
    --c-line rgba(74,176,255,.55) · --c-cyan #7fe3ff · --c-text #dcefff
    --c-text-dim #8fb4dc · --c-value #7fffe0

版面骨架沿用参考稿《机器视觉检测项目汇总.pptx》：
    左侧 0.16″ 色条 · 版心 x=0.62 宽 12.09
    眉题 `中文 / ENGLISH` 11.5pt → 标题 27pt → 导语 12.5pt → 卡片标题 14.5pt → 卡片正文 11.5pt
    页脚 9.5pt：左项目名 / 右 `页码 ／ 总数`
"""
import sys
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "docs" / "ppt" / "images"
OUT = ROOT / "docs" / "ppt" / "医院数据管理平台-项目汇报.pptx"

DARK = "--light" not in sys.argv

# ------------------------------------------------------------------ 配色令牌
if DARK:
    PAGE_BG = RGBColor(0x04, 0x12, 0x2B)          # --c-bg
    COVER_BG = RGBColor(0x02, 0x09, 0x1A)         # --c-bg-deep
    CARD = RGBColor(0x08, 0x22, 0x4A)             # 面板（等价 rgba(9,42,88,.62) 叠底）
    CARD_SOFT = RGBColor(0x06, 0x1A, 0x38)
    BORDER = RGBColor(0x1A, 0x42, 0x72)           # --c-line 柔和化
    ICONBG = RGBColor(0x0C, 0x2C, 0x54)
    PRIMARY = RGBColor(0x5C, 0xC8, 0xFF)          # 眉题 / 强调
    CYAN = RGBColor(0x7F, 0xE3, 0xFF)             # --c-cyan
    MINT = RGBColor(0x7F, 0xFF, 0xE0)             # --c-value：关键数字
    AMBER = RGBColor(0xFF, 0xC2, 0x4D)
    TITLE_C = RGBColor(0xEC, 0xF7, 0xFF)
    BODY_C = RGBColor(0xBB, 0xD4, 0xEC)
    MUTED_C = RGBColor(0x7E, 0x9E, 0xC4)
    SOFT_ON_DARK = RGBColor(0xC7, 0xDC, 0xF2)
    LABEL_ON_DARK = RGBColor(0x7F, 0x9D, 0xC4)
    COVER_CARD = RGBColor(0x0A, 0x24, 0x48)
    TBL_HEAD = RGBColor(0x0C, 0x2C, 0x54)
    TBL_HEAD_T = RGBColor(0x7F, 0xE3, 0xFF)
    TBL_ROW_A = RGBColor(0x06, 0x18, 0x34)
    TBL_ROW_B = RGBColor(0x09, 0x22, 0x44)
    ARROW = RGBColor(0x2A, 0x5A, 0x8E)
    BAR = RGBColor(0x7F, 0xE3, 0xFF)
    WHITE = RGBColor(0xFF, 0xFF, 0xFF)
else:
    PAGE_BG = RGBColor(0xFF, 0xFF, 0xFF)
    COVER_BG = RGBColor(0x0B, 0x2A, 0x52)
    CARD = RGBColor(0xF2, 0xF6, 0xF8)
    CARD_SOFT = RGBColor(0xF2, 0xF6, 0xF8)
    BORDER = RGBColor(0xD6, 0xE2, 0xF0)
    ICONBG = RGBColor(0xE8, 0xF1, 0xF3)
    PRIMARY = RGBColor(0x14, 0x6C, 0xC0)
    CYAN = RGBColor(0x1E, 0x88, 0xE5)
    MINT = RGBColor(0x0E, 0x8F, 0x7A)
    AMBER = RGBColor(0xD9, 0x8B, 0x2B)
    TITLE_C = RGBColor(0x0B, 0x1F, 0x2A)
    BODY_C = RGBColor(0x3D, 0x4C, 0x55)
    MUTED_C = RGBColor(0x6B, 0x7C, 0x85)
    SOFT_ON_DARK = RGBColor(0xC7, 0xD8, 0xDE)
    LABEL_ON_DARK = RGBColor(0x7E, 0x97, 0xA1)
    COVER_CARD = RGBColor(0x12, 0x3A, 0x69)
    TBL_HEAD = RGBColor(0x14, 0x6C, 0xC0)
    TBL_HEAD_T = RGBColor(0xFF, 0xFF, 0xFF)
    TBL_ROW_A = RGBColor(0xFF, 0xFF, 0xFF)
    TBL_ROW_B = RGBColor(0xF2, 0xF6, 0xF8)
    ARROW = RGBColor(0xD8, 0xE2, 0xE7)
    BAR = RGBColor(0x02, 0xB0, 0x8A)
    WHITE = RGBColor(0xFF, 0xFF, 0xFF)

FONT = "微软雅黑"
SW, SH = 13.333, 7.5
M = 0.62
CW = SW - 2 * M
Y_KICKER, Y_TITLE, Y_LEDE = 0.40, 0.68, 1.22
Y_FOOT = 7.04
TOTAL = 15
PROJECT = "医院数据管理平台 · 急救绿道"

prs = Presentation()
prs.slide_width = Inches(SW)
prs.slide_height = Inches(SH)
BLANK = prs.slide_layouts[6]


# --------------------------------------------------------------------- 基础
def set_font(run, size=12, bold=False, color=None, name=FONT):
    f = run.font
    f.name = name
    f.size = Pt(size)
    f.bold = bold
    f.color.rgb = color if color is not None else BODY_C
    rPr = run._r.get_or_add_rPr()
    for tag in ("a:ea", "a:cs"):
        el = rPr.find(qn(tag))
        if el is None:
            el = rPr.makeelement(qn(tag), {})
            rPr.append(el)
        el.set("typeface", name)


def tb(slide, x, y, w, h, paras, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, wrap=True):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = wrap
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = Emu(0)
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
            set_font(run, r.get("sz", 12), r.get("b", False), r.get("c"))
    return box


def rect(slide, x, y, w, h, fill, radius=None, line=None, line_w=0.75):
    shape = MSO_SHAPE.ROUNDED_RECTANGLE if radius is not None else MSO_SHAPE.RECTANGLE
    shp = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    shp.fill.solid()
    shp.fill.fore_color.rgb = fill
    if line is None:
        shp.line.fill.background()
    else:
        shp.line.color.rgb = line
        shp.line.width = Pt(line_w)
    shp.shadow.inherit = False
    if radius is not None:
        try:
            shp.adjustments[0] = radius
        except Exception:
            pass
    return shp


def circle(slide, cx, cy, d, text, fill=None, tcolor=None, size=12):
    shp = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - d / 2), Inches(cy - d / 2), Inches(d), Inches(d))
    shp.fill.solid()
    shp.fill.fore_color.rgb = fill if fill is not None else CYAN
    shp.line.fill.background()
    shp.shadow.inherit = False
    tf = shp.text_frame
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = Emu(0)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    run = p.add_run()
    run.text = text
    set_font(run, size, True, tcolor if tcolor is not None else COVER_BG)
    return shp


def card(slide, x, y, w, h, fill=None, radius=0.06, border=True):
    return rect(slide, x, y, w, h, fill if fill is not None else CARD, radius=radius,
                line=(BORDER if border else None))


def icon_circle(slide, x, y, d, glyph):
    return circle(slide, x + d / 2, y + d / 2, d, glyph, ICONBG, PRIMARY, 12)


def header(slide, kicker_cn, kicker_en, title, lede=None, title_sz=27):
    tb(slide, M, Y_KICKER, CW, 0.28,
       [{"runs": [{"t": f"{kicker_cn} / {kicker_en}", "sz": 11.5, "b": True, "c": PRIMARY}]}])
    tb(slide, M, Y_TITLE, CW, 0.56, [{"runs": [{"t": title, "sz": title_sz, "b": True, "c": TITLE_C}]}])
    if lede:
        tb(slide, M, Y_LEDE, CW, 0.44, [{"runs": [{"t": lede, "sz": 12.5, "c": BODY_C}], "line": 1.25}])


def footer(slide, n):
    tb(slide, M, Y_FOOT, 8.0, 0.28, [{"runs": [{"t": PROJECT, "sz": 9.5, "c": MUTED_C}]}])
    tb(slide, SW - M - 2.0, Y_FOOT, 2.0, 0.28,
       [{"runs": [{"t": f"{n:02d} / {TOTAL}", "sz": 9.5, "c": MUTED_C}], "align": PP_ALIGN.RIGHT}])


def new(kicker_cn, kicker_en, title, lede, n):
    s = prs.slides.add_slide(BLANK)
    rect(s, 0, 0, SW, SH, PAGE_BG)
    rect(s, 0, 0, 0.16, SH, BAR)
    header(s, kicker_cn, kicker_en, title, lede)
    footer(s, n)
    return s


def style_table(tbl, widths, header_sz=11, body_sz=11, row_h=0.8, header_h=0.42):
    for i, w in enumerate(widths):
        tbl.columns[i].width = Inches(w)
    for r, row in enumerate(tbl.rows):
        row.height = Inches(header_h if r == 0 else row_h)
        for cell in row.cells:
            cell.margin_left = cell.margin_right = Inches(0.12)
            cell.margin_top = cell.margin_bottom = Inches(0.05)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.fill.solid()
            cell.fill.fore_color.rgb = TBL_HEAD if r == 0 else (TBL_ROW_A if r % 2 else TBL_ROW_B)
            for p in cell.text_frame.paragraphs:
                p.line_spacing = 1.15
                for run in p.runs:
                    if r == 0:
                        set_font(run, header_sz, True, TBL_HEAD_T)
                    else:
                        set_font(run, body_sz, False, BODY_C)


def table(slide, x, y, w, rows, widths, row_h=0.8, header_h=0.42, body_sz=11):
    """画表格并返回**表格底边所在的 y**（英寸）。

    返回底边而不是表格对象：行高只是最小值，文字换行后实际更高，
    调用方必须按真实底边放后续内容，否则下面的文字会压到表格上。
    """
    n_rows, n_cols = len(rows), len(rows[0])
    gf = slide.shapes.add_table(n_rows, n_cols, Inches(x), Inches(y), Inches(w),
                                Inches(header_h + row_h * (n_rows - 1)))
    tbl = gf.table
    for r, row in enumerate(rows):
        for c, val in enumerate(row):
            tbl.cell(r, c).text = val
    style_table(tbl, widths, row_h=row_h, header_h=header_h, body_sz=body_sz)
    return y + sum(r.height for r in tbl.rows) / 914400


def band(slide, y, h, text_runs):
    rect(slide, M, y, CW, h, CARD_SOFT, radius=0.1, line=BORDER)
    tb(slide, M + 0.32, y + 0.20, CW - 0.64, h - 0.34, [{"runs": text_runs, "line": 1.3}])


def caption(slide, y, text):
    tb(slide, M, y, CW, 0.34, [{"runs": [{"t": text, "sz": 12, "c": BODY_C}]}])


# =========================================================== 1 · 封面
s = prs.slides.add_slide(BLANK)
rect(s, 0, 0, SW, SH, COVER_BG)
rect(s, 0, 0, 0.16, SH, BAR)
s.shapes.add_picture(str(IMG / "screen.png"), Inches(8.66), Inches(0.55), width=Inches(4.63), height=Inches(2.6))
s.shapes.add_picture(str(IMG / "admin.png"), Inches(8.66), Inches(3.42), width=Inches(4.63), height=Inches(2.6))

tb(s, M, 1.02, 7.3, 0.30, [{"runs": [{"t": "项目汇报 / PROJECT REPORT", "sz": 12.5, "b": True, "c": PRIMARY}]}])
tb(s, M, 1.45, 7.6, 1.75,
   [{"runs": [{"t": "医院数据管理平台", "sz": 40, "b": True, "c": WHITE}], "space_after": 2},
    {"runs": [{"t": "急救绿道", "sz": 40, "b": True, "c": CYAN}]}])
tb(s, M, 3.42, 7.5, 0.70,
   [{"runs": [{"t": "一块大屏看全局，一个后台管细节。", "sz": 13.5, "c": SOFT_ON_DARK}], "space_after": 3},
    {"runs": [{"t": "把「急救快不快」从翻表格，变成抬头看屏幕。", "sz": 13.5, "c": SOFT_ON_DARK}]}])
for i, (label, value) in enumerate([("形态", "大屏终端 + 管理后台"),
                                    ("技术栈", "Vue3 + NestJS + SQLite"),
                                    ("交付", "三种可运行形态 + 71 项验收")]):
    x = M + i * 2.45
    tb(s, x, 4.62, 2.35, 0.26, [{"runs": [{"t": label, "sz": 10.5, "c": LABEL_ON_DARK}]}])
    tb(s, x, 4.87, 2.45, 0.34, [{"runs": [{"t": value, "sz": 12.5, "b": True, "c": WHITE}]}])
tb(s, M, 5.72, 7.6, 0.34,
   [{"runs": [{"t": "汇报要点：形态 · 技术栈 · 交付内容 · 方案选择 · 开箱即跑", "sz": 12.5, "b": True, "c": MINT}]}])
tb(s, M, Y_FOOT, 8.0, 0.28, [{"runs": [{"t": PROJECT + " · 封面", "sz": 9.5, "c": MUTED_C}]}])
tb(s, SW - M - 2.0, Y_FOOT, 2.0, 0.28,
   [{"runs": [{"t": f"01 / {TOTAL}", "sz": 9.5, "c": MUTED_C}], "align": PP_ALIGN.RIGHT}])

# =========================================================== 2 · 结论先行
s = new("结论先行", "SUMMARY", "五件事，先看结论",
        "这套系统已经开发完成、通过验收并发布公网，院内双击即用；下面五页各说一件事。", 2)
pts = [("形态", "FORM", "三种打开方式", "大屏常驻看全局、后台管录入、公网发链接即可演示"),
       ("技术栈", "STACK", "前端照搬主流", "Vue3 + Element Plus + ECharts；后端按单机场景精简"),
       ("交付内容", "DELIVERABLES", "源码 + 文档 + 可运行系统", "公开仓库、部署手册、4 套自动化验收"),
       ("方案选择", "RATIONALE", "按场景匹配，不做堆料", "省掉 4 个需运维的组件，换来双击即用"),
       ("开箱即跑", "ZERO-SETUP", "零配置，30 秒可用", "自动装依赖建库、崩了自愈、开机自启")]
cw5 = (CW - 4 * 0.12) / 5
for i, (cn, en, head, desc) in enumerate(pts):
    x = M + i * (cw5 + 0.12)
    card(s, x, 1.78, cw5, 3.15, CARD_SOFT)
    circle(s, x + 0.42, 2.14, 0.34, str(i + 1), CYAN, COVER_BG, 11)
    tb(s, x + 0.24, 2.46, cw5 - 0.48, 0.26,
       [{"runs": [{"t": f"{cn} {en}", "sz": 10, "b": True, "c": PRIMARY}]}])
    tb(s, x + 0.24, 2.78, cw5 - 0.48, 0.9,
       [{"runs": [{"t": head, "sz": 14.5, "b": True, "c": TITLE_C}], "line": 1.2}])
    tb(s, x + 0.24, 3.78, cw5 - 0.48, 1.0,
       [{"runs": [{"t": desc, "sz": 10.5, "c": BODY_C}], "line": 1.3}])
tb(s, M, 5.30, CW, 0.9,
   [{"runs": [{"t": "一句话：", "sz": 13, "b": True, "c": PRIMARY},
              {"t": "在没有专职运维、没有独立机房的前提下，用最小的组件数交付了一套", "sz": 13, "c": BODY_C},
              {"t": "完整可用、可公开演示、可长期免维护运行", "sz": 13, "b": True, "c": MINT},
              {"t": "的系统。", "sz": 13, "c": BODY_C}], "line": 1.35}])

# =========================================================== 3 · 形态
s = new("形态", "FORM", "三种形态，对应三种使用场景",
        "同一套系统，按「谁在用、在哪用」提供三种打开方式，数据和口径完全一致。", 3)
forms = [("场景一 · 常驻", "大屏终端", "急诊 / 医务科 / 指挥中心",
          ["只读展示，7×24 常驻", "五个区域：总量、趋势、24 小时清单、未闭环提醒",
           "超一屏自动无缝滚动，姓名已脱敏"],
          "打开 http://127.0.0.1:3000/screen/", PRIMARY),
         ("场景二 · 日常", "管理后台", "医生 / 护士 / 管理员 / 质控",
          ["13 个页面：病例、患者、字典、组织、报表、审计",
           "7 种角色，越权由系统强制拦截",
           "报表一键导出 Excel"],
          "打开 http://127.0.0.1:3000/admin/", CYAN),
         ("场景三 · 对外", "公网演示", "同行 / 外出演示 / 领导查看",
          ["一个链接，任何设备打开即看",
           "数据为导出的静态快照，只读",
           "不需要服务器、账号，也不产生费用"],
          "打开 popostar11.github.io/hospital-data-platform", MINT)]
fw = (CW - 2 * 0.26) / 3
for i, (tag, name, who, bullets, how, color) in enumerate(forms):
    x = M + i * (fw + 0.26)
    card(s, x, 1.78, fw, 4.15, CARD_SOFT)
    rect(s, x, 1.78, fw, 0.075, color, radius=0.5)
    tb(s, x + 0.28, 2.02, fw - 0.56, 0.28, [{"runs": [{"t": tag, "sz": 10.5, "b": True, "c": color}]}])
    tb(s, x + 0.28, 2.34, fw - 0.56, 0.42, [{"runs": [{"t": name, "sz": 19, "b": True, "c": TITLE_C}]}])
    tb(s, x + 0.28, 2.84, fw - 0.56, 0.3, [{"runs": [{"t": who, "sz": 11.5, "c": MUTED_C}]}])
    tb(s, x + 0.28, 3.26, fw - 0.56, 1.75,
       [{"runs": [{"t": "· " + b, "sz": 11, "c": BODY_C}], "line": 1.3, "space_after": 7} for b in bullets])
    rect(s, x + 0.28, 5.12, fw - 0.56, 0.62, PAGE_BG, radius=0.1, line=BORDER)
    tb(s, x + 0.42, 5.26, fw - 0.84, 0.36,
       [{"runs": [{"t": how, "sz": 10, "c": PRIMARY}], "line": 1.2}])

# =========================================================== 4 · 技术栈全景
s = new("技术栈", "STACK", "技术栈全景：三层，九件",
        "前端四件照搬主流方案，后端与交付层按院内单机场景选型，每一件都在解决具体问题。", 4)
tiers = [("表现层", [("Vue 3", "页面框架与响应式"), ("TypeScript", "类型契约，联调不返工"),
                     ("Element Plus", "中后台组件库"), ("ECharts", "大屏图表与趋势")], PRIMARY),
         ("服务层", [("NestJS 11", "分层架构 + 鉴权/拦截器/异常收口"),
                     ("SQLite（Node 内置）", "单文件数据库，零安装零运维")], CYAN),
         ("交付层", [("零依赖启动器", "自动装依赖、建库、灌数据、开浏览器"),
                     ("后台守护进程", "无窗口、崩了自愈、开机自启"),
                     ("Cloudflare Workers + D1", "公网版后端，免费额度足够")], MINT)]
y = 1.72
for tname, items, color in tiers:
    th = 1.32
    rect(s, M, y, 1.24, th, ICONBG, radius=0.06, line=BORDER)
    tb(s, M, y + th / 2 - 0.17, 1.24, 0.34,
       [{"runs": [{"t": tname, "sz": 12.5, "b": True, "c": TITLE_C}], "align": PP_ALIGN.CENTER}])
    x0 = M + 1.24 + 0.18
    avail = CW - 1.24 - 0.18
    iw = (avail - (len(items) - 1) * 0.15) / len(items)
    for i, (name, desc) in enumerate(items):
        x = x0 + i * (iw + 0.15)
        card(s, x, y, iw, th, CARD_SOFT)
        rect(s, x, y, iw, 0.06, color)
        tb(s, x + 0.18, y + 0.24, iw - 0.36, 0.36, [{"runs": [{"t": name, "sz": 12.5, "b": True, "c": TITLE_C}]}])
        tb(s, x + 0.18, y + 0.66, iw - 0.36, 0.56, [{"runs": [{"t": desc, "sz": 10, "c": BODY_C}], "line": 1.25}])
    y += th + 0.14
tb(s, M, y + 0.06, CW, 0.4,
   [{"runs": [{"t": "未采用：", "sz": 11.5, "b": True, "c": AMBER},
              {"t": "Prisma · MySQL 8 · Redis · Docker · Nginx —— 不是不会用，是按当前场景没必要，理由见第 6 页。", "sz": 11.5, "c": BODY_C}]}])

# =========================================================== 5 · 技术栈 · 前端
s = new("技术栈", "STACK", "前端：四件各司其职，一件都不能省",
        "前端组件的运行成本由浏览器承担，不需要运维，所以直接采用最成熟的组合。", 5)
fe = [("Vue 3", "页面框架", ["组合式 API + TypeScript 推导好", "中文生态最厚，新人接手快", "中后台页面多、人员流动大，团队成本最低"]),
      ("TypeScript", "类型契约", ["前后端共享类型定义", "接口字段改名时编译期就报错", "把「联调返工」提前到开发阶段发现"]),
      ("Element Plus", "组件库", ["表格、分页、表单校验、树、上传全现成", "中后台 80% 的页面是增删改查", "组件库直接决定交付速度"]),
      ("ECharts", "数据可视化", ["柱状/饼/折线/地图全覆盖", "canvas 渲染，数据量大也流畅", "适配「数据变了就重画」的实时场景"])]
cw4 = (CW - 3 * 0.14) / 4
for i, (name, role, bullets) in enumerate(fe):
    x = M + i * (cw4 + 0.14)
    card(s, x, 1.78, cw4, 4.15, CARD_SOFT)
    icon_circle(s, x + 0.26, 2.04, 0.46, "◆")
    tb(s, x + 0.26, 2.66, cw4 - 0.52, 0.34, [{"runs": [{"t": name, "sz": 16, "b": True, "c": TITLE_C}]}])
    tb(s, x + 0.26, 3.02, cw4 - 0.52, 0.28, [{"runs": [{"t": role, "sz": 10.5, "b": True, "c": PRIMARY}]}])
    tb(s, x + 0.26, 3.44, cw4 - 0.52, 2.3,
       [{"runs": [{"t": "· " + b, "sz": 10.5, "c": BODY_C}], "line": 1.3, "space_after": 8} for b in bullets])

# =========================================================== 6 · 技术栈 · 后端减法
s = new("技术栈", "STACK", "后端与数据层：为什么减掉这 4 个组件",
        "每一个被省掉的组件，都是一个需要部署、监控、备份、排障的独立进程。", 6)
table(s, M, 1.78, CW, [
    ["主流组件", "本项目", "省掉的理由"],
    ["Prisma ORM", "Node 内置 node:sqlite", "Prisma 需要下载与平台绑定的查询引擎二进制，安装被包管理器直接阻断；改用 Node 内置能力后零原生依赖、零构建步骤"],
    ["MySQL 8", "SQLite 单文件库", "数据量是 5000 级病例、3 万级时间节点，单文件库完全够用；拷走一个文件就是完整备份，不需要独立运维"],
    ["Redis", "进程内缓存 + 内存事件总线", "单实例部署，Redis 的四类用途（缓存 / 会话 / 分布式锁 / 跨实例广播）都不成立，反而多出缓存一致性问题"],
    ["Docker + Nginx", "零依赖启动器 + Nest 直接托管静态资源", "交付场景是院内电脑，要求先装 Docker 反而抬高门槛；后端直接托管两个前端，顺带省掉跨域配置"],
], widths=[2.35, 3.15, 6.593], row_h=0.98, header_h=0.46)

# =========================================================== 7 · 交付内容
s = new("交付内容", "DELIVERABLES", "交付了什么：源码、文档、三种可运行形态",
        "拿到之后不需要二次开发即可运行；所有内容已归档到公开仓库，可随时查阅与交接。", 7)
table(s, M, 1.78, CW, [
    ["交付项", "内容", "位置 / 说明"],
    ["可运行系统", "① 本地完整版（大屏 + 后台 + 全部功能）② 公网演示版 ③ 静态大屏演示", "双击启动即可；公网版已发布可访问"],
    ["源代码", "前端 2 个 + 后端 1 个 + 公网版 1 个 + 共享类型包 1 个", "公开 GitHub 仓库，含完整提交历史"],
    ["文档", "总体方案、部署手册（本地 / 云）、3 份架构决策记录、使用说明", "docs/ 目录，含故障排查与配额说明"],
    ["自动化验收", "4 套共 71 项：接口 37 · 大屏 7 · 后台 18 · 公网版 33（另有 8 项批处理检查）", "一条命令跑完，改坏了立刻知道"],
    ["演示数据", "5089 条病例、30689 个时间节点，覆盖 12 个月", "全部为合成数据，机构名与姓名已脱敏"],
], widths=[1.85, 5.6, 4.643], row_h=0.86, header_h=0.44, body_sz=10.5)

# =========================================================== 8 · 开箱即跑 · 流程
s = new("开箱即跑", "ZERO-SETUP", "打开就能跑：使用者只需要会「双击」",
        "从一台什么都没装的电脑，到浏览器里看到大屏，中间不需要任何人做配置。", 8)
steps = [("01", "双击启动", ["运行 启动.bat", "自动识别 Node 环境", "自动生成包管理器转发脚本"], "0 秒"),
         ("02", "自动补齐环境", ["缺依赖就安装", "缺构建产物就构建", "全程无需人工介入"], "约 20 秒"),
         ("03", "自动准备数据", ["建表 → 灌入演示数据", "数据过期会按当天自动重算", "保证大屏不出现空表格"], "约 1 秒"),
         ("04", "自动打开浏览器", ["启动服务并给出访问入口", "后台 / 大屏 / 导航页三个地址", "端口被占用时直接复用"], "约 2 秒")]
sw_ = (CW - 3 * 0.30) / 4
for i, (num, name, details, cost) in enumerate(steps):
    x = M + i * (sw_ + 0.30)
    card(s, x, 1.86, sw_, 3.42, CARD_SOFT)
    circle(s, x + 0.50, 2.26, 0.44, num, CYAN, COVER_BG, 12)
    tb(s, x + 0.26, 2.72, sw_ - 0.52, 0.4, [{"runs": [{"t": name, "sz": 15, "b": True, "c": TITLE_C}]}])
    tb(s, x + 0.26, 3.22, sw_ - 0.52, 1.5,
       [{"runs": [{"t": "· " + d, "sz": 10.5, "c": BODY_C}], "line": 1.3, "space_after": 8} for d in details])
    rect(s, x + 0.26, 4.72, sw_ - 0.52, 0.34, ICONBG, radius=0.3, line=BORDER)
    tb(s, x + 0.26, 4.78, sw_ - 0.52, 0.24, [{"runs": [{"t": cost, "sz": 10, "b": True, "c": MINT}],
                                              "align": PP_ALIGN.CENTER}])
    if i < 3:
        tb(s, x + sw_, 3.35, 0.30, 0.4, [{"runs": [{"t": "›", "sz": 20, "b": True, "c": ARROW}],
                                          "align": PP_ALIGN.CENTER}])
band(s, 5.56, 0.72,
     [{"t": "实测：", "sz": 12.5, "b": True, "c": PRIMARY},
      {"t": "在完全干净的机器上（无依赖、无数据库、无构建产物），从双击到浏览器打开大屏，", "sz": 12.5, "c": BODY_C},
      {"t": "30 秒内完成", "sz": 12.5, "b": True, "c": MINT},
      {"t": "；连包管理器都不需要预先安装。", "sz": 12.5, "c": BODY_C}])

# =========================================================== 9 · 开箱即跑 · 稳定性
s = new("开箱即跑", "ZERO-SETUP", "打开就能跑：出了问题也不会「打不开」",
        "这一节来自一次真实故障——服务跑在前台窗口里，有人想复制窗口里的文字按了 Ctrl+C，把服务关掉了。", 9)
res = [("没有窗口", ["服务在后台运行，不占用控制台", "Ctrl+C、误关窗口都影响不到它", "从根上消除这类事故"]),
       ("崩了自动拉起", ["进程退出后 3 秒内自动重启", "同时保证只有一个实例", "不会出现端口冲突"]),
       ("开机自动运行", ["登录 Windows 后自动启动", "大屏终端断电恢复即可用", "不需要专人去点一下"]),
       ("数据自动保鲜", ["演示数据锚定生成日期", "隔几天再开，24 小时表格会空", "启动时自动按当天重算"])]
for i, (name, details) in enumerate(res):
    x = M + i * (sw_ + 0.30)
    card(s, x, 1.86, sw_, 2.92, CARD_SOFT)
    rect(s, x, 1.86, sw_, 0.075, CYAN if i % 2 == 0 else PRIMARY, radius=0.5)
    tb(s, x + 0.26, 2.12, sw_ - 0.52, 0.4, [{"runs": [{"t": name, "sz": 15, "b": True, "c": TITLE_C}]}])
    tb(s, x + 0.26, 2.62, sw_ - 0.52, 1.9,
       [{"runs": [{"t": "· " + d, "sz": 10.5, "c": BODY_C}], "line": 1.3, "space_after": 8} for d in details])
rect(s, M, 5.06, CW, 1.22, CARD_SOFT, radius=0.1, line=BORDER)
tb(s, M + 0.32, 5.22, CW - 0.64, 0.95,
   [{"runs": [{"t": "怎么验证的：", "sz": 12, "b": True, "c": PRIMARY},
              {"t": "直接在运行中强杀服务进程，观察它是否自己回来 —— 实测", "sz": 12, "c": BODY_C},
              {"t": "12 秒内自动恢复，接口重新可用", "sz": 12, "b": True, "c": MINT},
              {"t": "。", "sz": 12, "c": BODY_C}], "line": 1.3, "space_after": 6},
    {"runs": [{"t": "同时补了一条保障：", "sz": 12, "b": True, "c": PRIMARY},
              {"t": "启动时检查演示数据是否过期，过期就按当天重算，避免「打开是空的」被误判为系统故障。", "sz": 12, "c": BODY_C}], "line": 1.3}])

# =========================================================== 10 · 方案选择 · 成本模型
s = new("方案选择", "RATIONALE", "为什么这样选：一条成本规律",
        "技术选型不是「用得越多越专业」，而是看每个组件要谁来维护。", 10)
rect(s, M, 1.76, CW, 1.30, CARD, radius=0.08, line=BORDER)
tb(s, M + 0.40, 1.98, (CW - 0.8) / 2 - 0.2, 0.9,
   [{"runs": [{"t": "前端组件", "sz": 12, "b": True, "c": PRIMARY}], "space_after": 4},
    {"runs": [{"t": "边际成本 ≈ 0", "sz": 24, "b": True, "c": CYAN}], "space_after": 2},
    {"runs": [{"t": "跑在用户浏览器里，不需要有人运维它", "sz": 11, "c": BODY_C}]}])
tb(s, M + CW / 2 + 0.20, 1.98, (CW - 0.8) / 2 - 0.2, 0.9,
   [{"runs": [{"t": "后端组件", "sz": 12, "b": True, "c": AMBER}], "space_after": 4},
    {"runs": [{"t": "边际成本 = 一个进程", "sz": 24, "b": True, "c": AMBER}], "space_after": 2},
    {"runs": [{"t": "每个都要部署、监控、备份、升级、排障", "sz": 11, "c": BODY_C}]}])
cols = [("所以前端照搬主流", PRIMARY,
         ["成熟组合经过大量项目验证，没必要自创",
          "成本由浏览器承担，功能越全越好",
          "生态厚、招人容易、接手快",
          "结论：Vue3 + TS + Element Plus + ECharts 直接采用"]),
        ("所以后端按需精简", AMBER,
         ["每多一个组件，就多一份长期维护责任",
          "院内单机场景下，这些组件的价值不成立",
          "省下来的不是钱，是「以后要人伺候」的风险",
          "结论：只保留 NestJS + 内置 SQLite"])]
for i, (head, color, bullets) in enumerate(cols):
    x = M + i * (CW / 2 + 0.10)
    card(s, x, 3.26, CW / 2 - 0.10, 2.85, CARD_SOFT)
    rect(s, x, 3.26, CW / 2 - 0.10, 0.075, color, radius=0.5)
    tb(s, x + 0.30, 3.52, CW / 2 - 0.70, 0.4, [{"runs": [{"t": head, "sz": 16, "b": True, "c": TITLE_C}]}])
    tb(s, x + 0.30, 4.02, CW / 2 - 0.70, 1.9,
       [{"runs": [{"t": "· " + b, "sz": 11.5, "c": BODY_C}], "line": 1.32, "space_after": 9} for b in bullets])

# =========================================================== 11 · 方案选择 · 对照
s = new("方案选择", "RATIONALE", "和主流「全套」方案对照：我们用了它的哪个子集",
        "同一张表横向看：前端一字未改，取舍全部发生在后端与交付层。", 11)
table(s, M, 1.78, CW, [
    ["层", "主流标配", "本项目", "取舍理由"],
    ["前端", "Vue3 + TS + Element Plus + ECharts", "完全相同", "成本由浏览器承担，没有必要改"],
    ["框架", "NestJS", "相同", "分层、鉴权、统一响应、异常收口正是需要的"],
    ["数据访问", "Prisma", "Node 内置 SQLite 驱动", "避免引擎二进制与平台绑定带来的安装约束"],
    ["数据库", "MySQL 8", "SQLite 单文件", "数据规模在万级，单文件更省事、备份更简单"],
    ["缓存与实时", "Redis", "进程内缓存 + 事件总线", "单实例部署，Redis 的四类用途都不成立"],
    ["交付与网关", "Docker + Nginx", "零依赖启动器，后端直接托管", "交付目标是双击即用，不引入额外前置条件"],
], widths=[1.35, 3.5, 3.05, 4.193], row_h=0.72, header_h=0.44, body_sz=10.5)

# =========================================================== 12 · 质量保证
s = new("质量保证", "QUALITY", "怎么保证「改不坏」：71 项自动化验收",
        "这些检查会把大屏上的每个数字、每个页面的每个入口都核对一遍，改代码后跑一次即可。", 12)
tbl_bottom = table(s, M, 1.78, CW, [
    ["验收套件", "项数", "检查什么"],
    ["接口验收", "37 项", "把大屏上的每个数字钉死成断言：累计人数、12 个月序列、24 小时表格内容、筛选排序、权限拦截"],
    ["大屏验收", "7 项", "用真实浏览器打开：标题、8 列表头、姓名脱敏、无缝滚动，并输出 1920×1080 截图留档"],
    ["后台验收", "18 项", "真实登录后逐页巡检 13 个页面，并验证越权访问会被拦截"],
    ["公网版验收", "33 项", "除功能外，额外确认「响应里不出现真实机构名」与「不提供患者明文」"],
    ["批处理编码检查", "8 项", "防止中文写进 .bat 导致命令解析错乱——这是踩过的坑，固化成回归守卫"],
], widths=[2.1, 1.1, 8.893], row_h=0.74, header_h=0.44)
caption(s, tbl_bottom + 0.16,
        "全部只依赖系统自带的 Node 与 Chrome，不需要安装任何测试框架，因此在任何一台电脑上都能跑起来。")

# =========================================================== 13 · 安全合规
s = new("安全合规", "COMPLIANCE", "可以公开演示，因为里面没有敏感信息",
        "公开可见的前提是把数据脱敏做在前面，而不是事后打码。", 13)
sec = [("数据脱敏", PRIMARY, ["机构名称统一使用占位名", "患者姓名以脱敏形式存储与展示",
                              "公开仓库全量检索：真实机构名与患者明文 0 命中"]),
       ("权限管控", CYAN, ["7 种角色，按岗位授予最小权限", "越权访问由系统强制拦截，不依赖人工自觉",
                           "明文查看需要单独授权，且每一次都留痕"]),
       ("可追溯", MINT, ["关键操作全部写入审计日志", "记录操作人、时间、对象与变更内容",
                         "登录记录单独留存，便于回溯"])]
secw = (CW - 2 * 0.26) / 3
for i, (name, color, bullets) in enumerate(sec):
    x = M + i * (secw + 0.26)
    card(s, x, 1.78, secw, 3.5, CARD_SOFT)
    rect(s, x, 1.78, secw, 0.075, color, radius=0.5)
    icon_circle(s, x + 0.28, 2.06, 0.48, "◆")
    tb(s, x + 0.28, 2.72, secw - 0.56, 0.4, [{"runs": [{"t": name, "sz": 17, "b": True, "c": TITLE_C}]}])
    tb(s, x + 0.28, 3.24, secw - 0.56, 1.9,
       [{"runs": [{"t": "· " + b, "sz": 11, "c": BODY_C}], "line": 1.32, "space_after": 9} for b in bullets])
band(s, 5.52, 0.78,
     [{"t": "一句话：", "sz": 12.5, "b": True, "c": PRIMARY},
      {"t": "仓库里所有机构名称（示例市第二人民医院）、患者姓名（王*涛 等）与统计数值", "sz": 12.5, "c": BODY_C},
      {"t": "均为合成的演示数据", "sz": 12.5, "b": True, "c": MINT},
      {"t": "，不代表任何真实机构或真实统计结果。", "sz": 12.5, "c": BODY_C}])

# =========================================================== 14 · 下一步
s = new("下一步", "NEXT", "演进路线：什么时候该升级",
        "现在的精简方案是有前提的；下面这些条件一旦出现，就该按对应动作换栈，不用推倒重来。", 14)
table(s, M, 1.78, CW, [
    ["触发条件", "建议动作"],
    ["多科室 / 多院区并发写入，出现写等待", "SQLite → MySQL 8（或 PostgreSQL），数据访问层可整体替换"],
    ["病例量到百万级，报表查询开始变慢", "换关系型数据库 + 物化统计表（现有统计表结构可直接沿用）"],
    ["需要 7×24 高可用、要跑多实例", "引入 Redis（会话 / 缓存 / 跨实例广播）+ Nginx 负载均衡 + 容器化"],
    ["需要对第三方开放接口", "Nginx 统一入口 + 限流 + 接口密钥管理"],
    ["有等保 / 审计要求", "独立数据库实例 + 备份策略 + 审计日志集中留存"],
    ["开发人员超过 3 人并行", "引入 Prisma 迁移管理 + 容器统一开发环境，避免各自为政"],
], widths=[4.2, 7.893], row_h=0.68, header_h=0.44, body_sz=11)

# =========================================================== 15 · 结语
s = prs.slides.add_slide(BLANK)
rect(s, 0, 0, SW, SH, COVER_BG)
rect(s, 0, 0, 0.16, SH, BAR)
tb(s, M + 0.23, 1.62, 11.4, 0.4,
   [{"runs": [{"t": "一句话收尾", "sz": 12.5, "b": True, "c": PRIMARY}]}])
tb(s, M + 0.23, 2.10, 11.4, 1.5,
   [{"runs": [{"t": "用最小的组件数，交付一套", "sz": 26, "b": True, "c": WHITE}], "space_after": 2},
    {"runs": [{"t": "打开就能跑、放着也坏不了", "sz": 26, "b": True, "c": MINT}], "space_after": 2},
    {"runs": [{"t": "的急救绿道数据系统。", "sz": 26, "b": True, "c": WHITE}]}])
for i, (head, desc) in enumerate([("现在就能用", "双击「启动.bat」，浏览器自动打开，无需任何配置"),
                                  ("随时能演示", "公网链接发给任何人即可查看大屏"),
                                  ("后续可演进", "业务量上来后按第 14 页的触发表换栈")]):
    x = M + 0.23 + i * 3.85
    rect(s, x, 4.10, 3.60, 1.35, COVER_CARD, radius=0.08, line=BORDER)
    tb(s, x + 0.28, 4.32, 3.05, 0.95,
       [{"runs": [{"t": head, "sz": 13.5, "b": True, "c": CYAN}], "space_after": 4},
        {"runs": [{"t": desc, "sz": 10.5, "c": SOFT_ON_DARK}], "line": 1.25}])
tb(s, M + 0.23, 5.80, 11.4, 0.5,
   [{"runs": [{"t": "演示账号 admin / Hospital@123　·　大屏 http://127.0.0.1:3000/screen/　·　公网 popostar11.github.io/hospital-data-platform",
               "sz": 11, "c": LABEL_ON_DARK}]}])
tb(s, M, Y_FOOT, 8.0, 0.28, [{"runs": [{"t": PROJECT, "sz": 9.5, "c": MUTED_C}]}])
tb(s, SW - M - 2.0, Y_FOOT, 2.0, 0.28,
   [{"runs": [{"t": f"{TOTAL:02d} / {TOTAL}", "sz": 9.5, "c": MUTED_C}], "align": PP_ALIGN.RIGHT}])

OUT.parent.mkdir(parents=True, exist_ok=True)
prs.save(str(OUT))
print(f"已生成：{OUT}")
print(f"主题：{'深色（与大屏同色系）' if DARK else '浅色'}  页数：{len(prs.slides._sldIdLst)}  画布：{SW}×{SH}")
