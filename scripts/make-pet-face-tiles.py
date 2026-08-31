#!/usr/bin/env python3
"""把表情格裁成带羽化边缘的脸部贴片, 用于贴到半身照上。

脸框以"日常表情"肤色检测为准: (82, 103, 89, 79), 中心 (126.5, 142.5)。
裁剪区域外扩 25%, 用椭圆羽化蒙版让边缘柔和融入半身照。
"""

import os
import numpy as np
from PIL import Image

CELLS = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\cells"
OUT = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\faces"

# 脸框(表情格内) 与 裁剪区域
EX = (82, 103, 89, 79)  # x, y, w, h
PAD = 0.25
crop = (
    int(EX[0] - EX[2] * PAD),
    int(EX[1] - EX[3] * PAD),
    int(EX[0] + EX[2] * (1 + PAD)),
    int(EX[1] + EX[3] * (1 + PAD)),
)
cw, ch = crop[2] - crop[0], crop[3] - crop[1]
cx = (EX[0] + EX[2] / 2) - crop[0]
cy = (EX[1] + EX[3] / 2) - crop[1]
rx = EX[2] / 2 * 1.12
ry = EX[3] / 2 * 1.22
FADE = 0.25  # 椭圆外 25% 渐变到 0

# 羽化蒙版
yy, xx = np.mgrid[0:ch, 0:cw].astype(float)
nd = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
alpha = np.where(nd <= 1.0, 1.0, np.clip((1.0 + FADE - nd) / FADE, 0.0, 1.0))
mask = (alpha * 255).astype(np.uint8)

def tile(img):
    t = img.crop(crop)
    a = np.array(t)[:, :, 3]
    a = (a.astype(float) * (alpha)) 
    t = t.convert('RGBA')
    out = np.array(t)
    out[:, :, 3] = a.astype(np.uint8)
    return Image.fromarray(out)

os.makedirs(OUT, exist_ok=True)
names = [f for f in os.listdir(CELLS) if f.endswith('.png')]
for name in names:
    im = Image.open(os.path.join(CELLS, name)).convert('RGBA')
    t = tile(im)
    t.save(os.path.join(OUT, name))
print('tiles:', len(names), 'crop box:', crop, 'tile size:', (cw, ch), 'face center in tile:', (cx, cy))

# 合成预览: 半身照 + 日常表情贴片
hb = Image.open(os.path.join(CELLS, '半身照.png')).convert('RGBA')
HB = (134, 137, 89, 78)
scale = HB[2] / EX[2]
sim = Image.new('RGBA', hb.size, (0, 0, 0, 0))
sim.paste(hb, (0, 0), hb)
tile_img = Image.open(os.path.join(OUT, '日常表情.png')).convert('RGBA')
tw = round(cw * scale); th = round(ch * scale)
tile_img = tile_img.resize((tw, th))
left = round(HB[0] + HB[2]/2 - cx * scale)
top = round(HB[1] + HB[3]/2 - cy * scale)
sim.paste(tile_img, (left, top), tile_img)
sim.save(r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\face-sim2.png")
print('preview saved, scale=', scale, 'left=', left, 'top=', top)