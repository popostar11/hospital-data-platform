# -*- coding: utf-8 -*-
"""
生成仅用于「视觉检查」的预览副本。

背景：「libreoffice-kit render」会把页面内容固定放大 1.5 倍（与 --dpi 无关），
直接渲染会把右侧和下方裁掉，无法用来判断排版是否溢出。

做法：复制一份 pptx，把幻灯片尺寸放大 1.5 倍，内容坐标一律不动。
渲染时内容同样被放大 1.5 倍，正好铺满放大的画布 —— 相对布局与正式文件完全一致。

用法：
    python tools/make-preview-pptx.py <源.pptx> [目标.pptx]
"""
import sys
from pathlib import Path

from pptx import Presentation

K = 1.5

if len(sys.argv) < 2:
    print(__doc__)
    sys.exit(2)

src = Path(sys.argv[1])
dst = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_name(src.stem + "-preview.pptx")

prs = Presentation(str(src))
prs.slide_width = int(prs.slide_width * K)
prs.slide_height = int(prs.slide_height * K)
prs.save(str(dst))

print(f"预览副本：{dst}")
print(f"  画布 {prs.slide_width / 914400:.3f} x {prs.slide_height / 914400:.3f} 英寸（内容坐标未改动）")
