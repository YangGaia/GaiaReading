#!/usr/bin/env python3
"""生成桌宠素材(头身分离但羽化融合):
- body.png : 半身照去掉头部区域(挖空 y 100..435), 保留肩以下身体, 挖空边缘羽化
- head.png : 脖子以上透明头层(完整头顶到脖子), 底部羽化
转头: 头层 rotateY(左右看) / rotateX(上下看) + 位移, 身体不动。
"""

import os
import numpy as np
from PIL import Image

SRC = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\cells\半身照.png"
OUT = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\parts"

im = Image.open(SRC).convert('RGBA')
W, H = im.size
os.makedirs(OUT, exist_ok=True)

# 1) 身体: 挖空头部 y 100..435, 420..440 羽化过渡
body = im.copy()
a = np.array(body)
fade0, fade1 = 420, 439
for y in range(100, fade0):
    a[y, :, 3] = 0
for y in range(fade0, fade1 + 1):
    t = (y - fade0) / (fade1 - fade0 + 1)
    a[y, :, 3] = (a[y, :, 3] * t).astype(np.uint8)
body = Image.fromarray(a)
body.save(os.path.join(OUT, 'body.png'))

# 2) 头层: y 0..450, 底部 400..449 羽化
head = im.crop((0, 0, W, 450)).convert('RGBA')
a = np.array(head)
fade0, fade1 = 400, 449
for y in range(fade0, fade1 + 1):
    t = (y - fade0) / (fade1 - fade0 + 1)
    a[y, :, 3] = (a[y, :, 3] * (1 - t)).astype(np.uint8)
head = Image.fromarray(a)
head.save(os.path.join(OUT, 'head.png'))
print('body saved', body.size)
print('head saved', head.size)

# 3) 向左看预览: body + head.rotateY(-9) 近似(2D 旋转示意) + 脸
canvas = Image.new('RGBA', (W, H), (240, 240, 245, 255))
canvas.paste(body, (0, 0), body)
rot = head.rotate(-9, resample=Image.BICUBIC, center=(178, 430), expand=False)
canvas.paste(rot, (0, 0), rot)
face = Image.open(r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\faces\日常表情.png").convert('RGBA')
canvas.paste(face, (111, 116), face)
canvas.save(r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\head-look-sim.png")
print('preview saved')