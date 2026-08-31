#!/usr/bin/env python3
"""重新生成桌宠纸娃娃素材(羽化融合版, 不硬切):
- full.png   : 完整半身照(底层, 不动)
- head.png   : 脖子以上透明头层(顶层, 旋转), 底部 40px 羽化融合
头层从 y0 开始, 保留完整头顶; 转轴位于脖子底部(y~440)。
"""

import os
import numpy as np
from PIL import Image, ImageFilter

SRC = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\cells\半身照.png"
OUT = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\parts"

im = Image.open(SRC).convert('RGBA')
W, H = im.size
os.makedirs(OUT, exist_ok=True)

# 1) 完整底图
im.save(os.path.join(OUT, 'full.png'))

# 2) 头层: y 0..450, 底部羽化(400..450 alpha 渐变到 0)
head = im.crop((0, 0, W, 450)).convert('RGBA')
a = np.array(head)
h = a.shape[0]
fade0, fade1 = 400, 449
for y in range(fade0, fade1 + 1):
    t = (y - fade0) / (fade1 - fade0)
    a[y, :, 3] = (a[y, :, 3] * (1 - t)).astype(np.uint8)
head = Image.fromarray(a)
head.save(os.path.join(OUT, 'head.png'))
print('full saved', im.size)
print('head saved', head.size)

# 3) 合成预览: 完整底 + 头层旋转 6 度
canvas = Image.new('RGBA', (W, H), (240, 240, 245, 255))
canvas.paste(im, (0, 0), im)
rot = head.rotate(6, resample=Image.BICUBIC, center=(178, 440), expand=False)
canvas.paste(rot, (0, 0), rot)
face = Image.open(r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\faces\日常表情.png").convert('RGBA')
canvas.paste(face, (111, 116), face)
canvas.save(r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\head-turn-sim.png")
print('preview saved')