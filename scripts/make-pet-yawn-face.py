#!/usr/bin/env python3
"""用现有闭眼表情与圆口嘴型合成打哈欠专用脸部贴片。"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
FACES = ROOT / "src" / "renderer" / "images" / "pet" / "faces"

closed_eyes = Image.open(FACES / "叹气.png").convert("RGBA")
open_mouth = Image.open(FACES / "严肃说话.png").convert("RGBA")

# 只替换嘴及紧邻皮肤，保留闭眼、头发、脸型和围巾不变。
mask = Image.new("L", closed_eyes.size, 0)
ImageDraw.Draw(mask).ellipse((55, 70, 79, 99), fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(1.4))

yawn = Image.composite(open_mouth, closed_eyes, mask)
yawn.save(FACES / "打哈欠.png")
print("yawn face regenerated")
