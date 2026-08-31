#!/usr/bin/env python3
"""把半身照切成 头/身体/脖子垫片 三层, 用于"转头+身体跟随"纸娃娃结构。

分界: 头层 y 110..440(含头+脖子), 身体层 y 430..647, 脖子垫片 y 350..470。
转轴: 头层底部中心 (178, 440) 对应半身照坐标。
"""

import os
import numpy as np
from PIL import Image

SRC = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\cells\半身照.png"
OUT = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\parts"

im = Image.open(SRC).convert('RGBA')
W, H = im.size
os.makedirs(OUT, exist_ok=True)

head = im.crop((0, 110, W, 440))
body = im.crop((0, 430, W, H))
neck = im.crop((0, 350, W, 470))
head.save(os.path.join(OUT, 'head.png'))
body.save(os.path.join(OUT, 'body.png'))
neck.save(os.path.join(OUT, 'neck.png'))
print('head', head.size, 'body', body.size, 'neck', neck.size)

# 合成预览: 头层旋转 -6 度 + 身体 + 脖子垫片 + 脸贴片
canvas = Image.new('RGBA', (W, H), (240, 240, 245, 255))
canvas.paste(body, (0, 430), body)
head_rot = head.rotate(6, resample=Image.BICUBIC, center=(178, 330), expand=False)
canvas.paste(head_rot, (0, 110), head_rot)
canvas.paste(neck, (0, 350), neck)
# 脸贴片(日常表情)按 FACE 定位到 head 内
face = Image.open(r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\faces\日常表情.png").convert('RGBA')
hbCx, hbCy = 178.5, 176.0
fx = round(hbCx - 67.5)
fy = round(hbCy - 59.5)
canvas.paste(face, (fx, fy), face)
canvas.save(r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\head-turn-sim.png")
print('preview saved')