# -*- coding: utf-8 -*-
"""
生成仅用于「视觉检查」的预览副本。

背景：libreoffice-kit 的 render 会把页面内容固定放大 1.5 倍（与 --dpi 无关），
直接渲染会把右侧和下方裁掉，无法用来判断排版是否溢出。

做法：复制一份 pptx，把幻灯片尺寸放大 1.5 倍，内容坐标一律不动。
渲染时内容同样被放大 1.5 倍，于是正好铺满放大的画布 ——
相对布局与正式文件完全一致，可以真实反映「有没有溢出、有没有压字」。

正式交付文件不受影响。
"""
import shutil
import sys
from pathlib import Path

from pptx import Presentation

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "ppt" / "医院数据管理平台-项目介绍.pptx"
DST = ROOT / "docs" / "ppt" / "_preview.pptx"
K = 1.5

prs = Presentation(str(SRC))
prs.slide_width = int(prs.slide_width * K)
prs.slide_height = int(prs.slide_height * K)
prs.save(str(DST))

print(f"预览副本已生成：{DST}")
print(f"  画布 {prs.slide_width / 914400:.3f} x {prs.slide_height / 914400:.3f} 英寸（内容坐标未改动）")
