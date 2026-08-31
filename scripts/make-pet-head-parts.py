#!/usr/bin/env python3
"""生成桌宠素材(羽化加强版):
- head.png : 头部 (100,0)-(270,220), 底部羽化 24px, 左右羽化 6px
- body.png : 挖空头部矩形, 挖空边缘羽化 16px
头/身体都用 rotateY 3D 转身, 头幅度大, 身体幅度小。
"""

import os
import numpy as np
from PIL import Image

SRC = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\cells\半身照.png"
OUT = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\parts"
HEAD = (100, 0, 270, 220)

im = Image.open(SRC).convert('RGBA')
W, H = im.size
os.makedirs(OUT, exist_ok=True)

# 1) 头层: 底部 24px 羽化, 左右 6px 羽化
head = im.crop(HEAD).convert('RGBA')
a = np.array(head)
hh = a.shape[0]
for y in range(hh - 24, hh):
    t = (y - (hh - 24)) / 24.0
    a[y, :, 3] = (a[y, :, 3] * (1 - t)).astype(np.uint8)
for x in range(0, 6):
    t = (x + 1) / 6.0
    a[:, x, 3] = (a[:, x, 3] * t).astype(np.uint8)
    a[:, -(x + 1), 3] = (a[:, -(x + 1), 3] * t).astype(np.uint8)
Image.fromarray(a).save(os.path.join(OUT, 'head.png'))

# 2) 身体: 挖空头部矩形, 边缘 16px 羽化
body = im.copy()
a = np.array(body)
x0, y0, x1, y1 = HEAD
pad = 16
for y in range(y0, min(y1 + 1, H)):
    for x in range(x0, min(x1 + 1, W)):
        d = min(x - x0, x1 - x, y - y0, y1 - y)
        if d >= pad:
            a[y, x, 3] = 0
        elif d >= 0:
            a[y, x, 3] = (a[y, x, 3] * (d + 1) / (pad + 1)).astype(np.uint8)
Image.fromarray(a).save(os.path.join(OUT, 'body.png'))
print('head/body regenerated with wider feather')