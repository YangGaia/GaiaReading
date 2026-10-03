#!/usr/bin/env python3
"""切分桌宠表情图集，使用项目映射表中的正式素材名。

用法:
    python scripts/slice-expression-sheet.py [输入.webp] [输出目录]
    python scripts/slice-expression-sheet.py --preview <标注预览.png>

默认读取 assets/pet/expression-sheet.webp，输出到 images/pet/cells。
标注预览仅在显式指定 --preview 时生成。
"""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "pet" / "expression-sheet.webp"
OUT = ROOT / "src" / "renderer" / "images" / "pet"
MAPPING = OUT / "pet-expressions.json"

CELL = 256
COLS = [0, 256, 512, 768]
ROWS = [768, 1024, 1280, 1536, 1792]
HALF_BODY = (258, 120, 767, 767)


def trim_alpha(img, threshold=8):
    """按 alpha 阈值裁剪透明边，返回裁剪图和包围盒。"""
    alpha = img.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > threshold else 0).getbbox()
    return (img.crop(bbox), bbox) if bbox is not None else (img, None)


def require_f_output(target):
    """解析现有链接后检查输出，避免 F 盘目录经链接写入其他盘。"""
    resolved = target.resolve()
    if resolved.drive.lower() != "f:":
        raise ValueError(f"输出必须位于 F 盘: {resolved}")
    return resolved


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", type=Path, default=SRC)
    parser.add_argument("output", nargs="?", type=Path, default=OUT)
    parser.add_argument("--preview", type=Path, help="另存带编号的标注预览")
    args = parser.parse_args()
    if not args.source.is_file():
        parser.error(f"输入文件不存在: {args.source}")

    names = json.loads(MAPPING.read_text(encoding="utf-8"))["cells"]
    regions = [("halfbody.png", HALF_BODY)]
    for number, (row, col) in enumerate(((r, c) for r in ROWS for c in COLS), 1):
        regions.append((f"{number:02d}.png", (col, row, col + CELL, row + CELL)))
    for source_name, _ in regions:
        if source_name not in names or Path(names[source_name]).name != names[source_name]:
            parser.error(f"素材映射缺失或文件名无效: {source_name}")

    # Check every destination before the first write, including existing file
    # links and an optional preview that may live outside the cells directory.
    try:
        cells_dir = require_f_output(args.output / "cells")
        targets = {name: require_f_output(cells_dir / names[name]) for name, _ in regions}
        preview = require_f_output(args.preview) if args.preview else None
    except (OSError, ValueError) as error:
        parser.error(str(error))

    with Image.open(args.source) as image:
        sheet = image.convert("RGBA")
    cells_dir.mkdir(parents=True, exist_ok=True)
    for source_name, box in regions:
        cell, _ = trim_alpha(sheet.crop(box))
        target = targets[source_name]
        cell.save(target)
        print(f"表情 -> {target.name} {cell.size}")

    if args.preview:
        annotated = sheet.copy()
        draw = ImageDraw.Draw(annotated)
        for source_name, box in regions:
            x0, y0, _, _ = box
            draw.rectangle(box, outline=(255, 64, 128, 255), width=2)
            label = Path(source_name).stem
            width = draw.textlength(label)
            tx, ty = x0 + 8, y0 + 8
            draw.rectangle([tx - 4, ty - 2, tx + width + 4, ty + 14], fill=(20, 20, 60, 255))
            draw.text((tx, ty), label, fill=(255, 255, 255, 255))
        preview.parent.mkdir(parents=True, exist_ok=True)
        annotated.save(preview)
        print(f"标注预览图 -> {preview}")


if __name__ == "__main__":
    main()