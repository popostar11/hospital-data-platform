# -*- coding: utf-8 -*-
"""
检查 pptx 里是否有形状重叠（排版事故的自动化守卫）

为什么需要它：表格的最终高度由「行高 × 行数」决定，而且 python-pptx 的行高只是
**最小值** —— 文字换行后行会变高，表格会比脚本里写的更高，于是压在下面的文字上。
这类问题肉眼不一定看得出来（我这次就是漏了），必须用几何数据查。

用法：
    python tools/check-ppt-layout.py <文件.pptx> [更多.pptx ...]

判定规则：
    - 只比较文本框 / 表格 / 图片（装饰性矩形不算，它们本来就会互相叠）
    - 两个形状在 X 与 Y 两个方向的重叠都超过阈值才算重叠（默认 0.10 英寸）
    - 页脚左右两段虽然 Y 相同但 X 不相交，因此不会误报
"""
import sys
from pathlib import Path

from pptx import Presentation

EMU = 914400.0
MIN_OVERLAP = 0.10          # 两个方向都超过这个值才算重叠（英寸）
IGNORE_AREA = 0.015         # 交叠面积小于此值忽略（平方英寸）


def kind_of(shape):
    st = str(shape.shape_type)
    if "TABLE" in st:
        return "TABLE"
    if "PICTURE" in st:
        return "PICTURE"
    if shape.has_text_frame and shape.text_frame.text.strip():
        return "TEXT"
    return None


def box_of(shape):
    """返回 (left, top, right, bottom)，单位英寸；表格用真实行高之和"""
    l, t = shape.left / EMU, shape.top / EMU
    if "TABLE" in str(shape.shape_type):
        h = sum(r.height for r in shape.table.rows) / EMU
        w = shape.width / EMU
    else:
        w, h = shape.width / EMU, shape.height / EMU
    return (l, t, l + w, t + h)


def label_of(shape):
    if shape.has_text_frame:
        txt = shape.text_frame.text.replace("\n", " ").strip()
        return txt[:30] or "(空文本)"
    if "TABLE" in str(shape.shape_type):
        return "表格 %d 行" % len(shape.table.rows)
    return str(shape.shape_type)


def is_callout_marker(shape):
    """压在截图上的编号标记（①②③ 那种）：短文本 + 小圆圈，属于有意设计，不算重叠"""
    if not shape.has_text_frame:
        return False
    txt = shape.text_frame.text.strip()
    return len(txt) <= 2 and shape.width / EMU < 0.6 and shape.height / EMU < 0.6


def check(path):
    prs = Presentation(str(path))
    total = 0
    print(f"\n=== {Path(path).name}（{len(prs.slides._sldIdLst)} 页）")
    for idx, slide in enumerate(prs.slides, 1):
        items = []
        markers = []
        for sh in slide.shapes:
            k = kind_of(sh)
            if k is None:
                continue
            items.append((k, box_of(sh), label_of(sh)))
            markers.append(is_callout_marker(sh))
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                (k1, b1, l1), (k2, b2, l2) = items[i], items[j]
                # 压在截图上的编号标记（①②③）属于有意设计，跳过
                if (k1 == "PICTURE" and markers[j]) or (k2 == "PICTURE" and markers[i]):
                    continue
                ox = min(b1[2], b2[2]) - max(b1[0], b2[0])
                oy = min(b1[3], b2[3]) - max(b1[1], b2[1])
                if ox > MIN_OVERLAP and oy > MIN_OVERLAP and ox * oy > IGNORE_AREA:
                    total += 1
                    print(f"  ✗ 第 {idx} 页  重叠 {ox:.2f}\"×{oy:.2f}\"")
                    print(f"      [{k1}] {l1}")
                    print(f"      [{k2}] {l2}")
    if total == 0:
        print("  ✓ 未发现形状重叠")
    else:
        print(f"  共 {total} 处重叠")
    return total


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    bad = 0
    for p in sys.argv[1:]:
        bad += check(p)
    sys.exit(1 if bad else 0)
