#!/usr/bin/env python3
"""切分久远寺有珠表情图集(spritesheet)为独立 PNG。

用法:
    python scripts/slice-expression-sheet.py <输入.webp> [输出目录]

网格规则(针对 jp-caster-kuonji-alice-expression-sheet-v0-*.webp):
    - 上部中央: 半身大图 (x 258..767, y 120..767)
    - 下部: 4 列 x 5 行 表情格, 每格 256x256
      列 x: 0/256/512/768   行 y: 768/1024/1280/1536/1792
"""

import os
import sys
from PIL import Image, ImageDraw


SRC = r"D:\Codex_project\Gaia_Reading\jp-caster-kuonji-alice-expression-sheet-v0-bd3kq1en8sxc1.webp"
OUT = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet"

CELL = 256
COLS = [0, 256, 512, 768]
ROWS = [768, 1024, 1280, 1536, 1792]
HALF_BODY = (258, 120, 767, 767)  # 半身大图区域 (x0, y0, x1, y1)


def trim_alpha(img, threshold=8):
    """按 alpha 阈值裁剪透明边, 返回 (裁剪后的图, 包围盒)。"""
    alpha = img.split()[-1]
    bbox = alpha.point(lambda v: 255 if v > threshold else 0).getbbox()
    if bbox is None:
        return img, None
    return img.crop(bbox), bbox


def load_rgba(path):
    im = Image.open(path)
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    return im


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else SRC
    out = sys.argv[2] if len(sys.argv) > 2 else OUT
    if not os.path.exists(src):
        sys.exit(f"输入文件不存在: {src}")
    os.makedirs(os.path.join(out, "cells"), exist_ok=True)

    sheet = load_rgba(src)
    w, h = sheet.size
    print(f"图集: {w}x{h}")

    cells = []

    # 半身图
    hb = sheet.crop(HALF_BODY)
    hb_trim, bbox = trim_alpha(hb)
    name = "halfbody.png"
    hb_trim.save(os.path.join(out, "cells", name))
    cells.append((name, HALF_BODY, bbox))
    print(f"半身图 -> {name}  裁后 {hb_trim.size}")

    # 20 个表情格 (行主序编号 01..20)
    idx = 0
    for r in ROWS:
        for c in COLS:
            idx += 1
            box = (c, r, c + CELL, r + CELL)
            cell = sheet.crop(box)
            cell_trim, bbox = trim_alpha(cell)
            name = f"{idx:02d}.png"
            cell_trim.save(os.path.join(out, "cells", name))
            cells.append((name, box, bbox))
            print(f"表情 {idx:02d} -> {name}  格=({c},{r}) 裁后 {cell_trim.size}")

    # 生成带编号的标注预览图
    annotated = sheet.copy()
    draw = ImageDraw.Draw(annotated)
    for name, box, _ in cells:
        x0, y0, x1, y1 = box
        draw.rectangle([x0, y0, x1, y1], outline=(255, 64, 128, 255), width=2)
        label = name.replace(".png", "")
        tw = draw.textlength(label)
        tx, ty = x0 + 8, y0 + 8
        draw.rectangle([tx - 4, ty - 2, tx + tw + 4, ty + 14], fill=(20, 20, 60, 255))
        draw.text((tx, ty), label, fill=(255, 255, 255, 255))

    anno_path = os.path.join(out, "sheet-annotated.png")
    annotated.save(anno_path)
    print(f"标注预览图 -> {anno_path}")


if __name__ == "__main__":
    main()