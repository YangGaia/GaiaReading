#!/usr/bin/env python3
"""按主人标定的头部坐标生成桌宠素材:
头层: (100, 0)..(270, 220), 底部羽化
身体: 挖空该矩形区域, 挖空边缘羽化
转轴: 下巴 y=220, 头层 transform-origin 50% 100%
"""

import os
import numpy as np
from PIL import Image

SRC = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\cells\半身照.png"
OUT = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\parts"

HEAD = (100, 0, 270, 220)  # x0, y0, x1, y1

im = Image.open(SRC).convert('RGBA')
W, H = im.size
os.makedirs(OUT, exist_ok=True)

# 1) 头层: 只裁头部矩形, 底部 15px 羽化(下巴过渡)
head = im.crop(HEAD).convert('RGBA')
a = np.array(head)
h = a.shape[0]
fade0, fade1 = h - 15, h - 1
for y in range(fade0, fade1 + 1):
    t = (y - fade0) / (fade1 - fade0 + 1)
    a[y, :, 3] = (a[y, :, 3] * (1 - t)).astype(np.uint8)
head = Image.fromarray(a)
head.save(os.path.join(OUT, 'head.png'))
print('head saved', head.size)

# 2) 身体: 挖空头部矩形, 边缘羽化(内缩8px渐变)
body = im.copy()
a = np.array(body)
x0, y0, x1, y1 = HEAD
pad = 8
for y in range(y0, y1 + 1):
    for x in range(x0, x1 + 1):
        # 边缘羽化: 靠近矩形边界的像素保留部分alpha
        d = min(x - x0, x1 - x, y - y0, y1 - y)
        if d >= pad:
            a[y, x, 3] = 0
        elif d >= 0:
            a[y, x, 3] = (a[y, x, 3] * (d + 1) / (pad + 1)).astype(np.uint8)
body = Image.fromarray(a)
body.save(os.path.join(OUT, 'body.png'))
print('body saved', body.size)

# 3) 向左看预览: 身体 + 头层 rotate -9 度
canvas = Image.new('RGBA', (W, H), (240, 240, 245, 255))
canvas.paste(body, (0, 0), body)
rot = head.rotate(-9, resample=Image.BICUBIC, center=(85, 220), expand=False)
canvas.paste(rot, (x0, y0), rot)
face = Image.open(r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\faces\日常表情.png").convert('RGBA')
# 脸在头层内: 头层起点 (100,0), 脸中心半身照(178.5,176)
face_left = round(178.5 - 67.5 - x0)
face_top = round(176 - 59.5 - y0)
canvas.paste(face, (face_left + x0, face_top + y0), face)
canvas.save(r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\head-look-sim.png")
print('preview saved, face at head-local', (face_left, face_top))