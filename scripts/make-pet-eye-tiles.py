#!/usr/bin/env python3
"""把表情格的眼睛区域裁成透明贴片(瞳孔+眼白+眼线, 肤色部分透明), 用于视线跟随鼠标。

瞳孔位置(主人确认): 日常表情 y 110..128。
裁切区域: x 82..170, y 105..131(上下各留余量)。
"""

import os
import numpy as np
from PIL import Image, ImageFilter

CELLS = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\cells"
OUT = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\eyes"

BOX = (82, 105, 170, 131)  # x0, y0, x1, y1

def is_skin(r, g, b):
    return r > 170 and g > 110 and b > 70 and r >= g and g >= b and (r - b) > 30

def eye_tile(img):
    t = img.crop(BOX).convert('RGBA')
    a = np.array(t)
    rgb = a[:, :, :3].astype(int)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    skin = (r > 170) & (g > 110) & (b > 70) & (r >= g) & (g >= b) & ((r - b) > 30)
    out = a.copy()
    # 肤色像素去透明(眼睛周围的皮肤露出来会像补丁)
    out[skin, 3] = 0
    # 半透明肤色混合像素(边缘)也淡化
    partial = ((r > 140) & (g > 90) & (b > 60) & ((r - b) > 15))
    out[partial & ~skin, 3] = (out[partial & ~skin, 3] * 0.35).astype(np.uint8)
    t2 = Image.fromarray(out)
    # alpha 轻微羽化, 边缘柔和
    alpha = t2.split()[3].filter(ImageFilter.GaussianBlur(0.6))
    t2.putalpha(alpha)
    return t2

os.makedirs(OUT, exist_ok=True)
names = [f for f in os.listdir(CELLS) if f.endswith('.png') and f != '半身照.png']
for name in names:
    im = Image.open(os.path.join(CELLS, name)).convert('RGBA')
    t = eye_tile(im)
    t.save(os.path.join(OUT, name))
print('eye tiles:', len(names), 'box:', BOX)