#!/usr/bin/env python3
"""按每表情自身脸框生成对齐贴片:
- 检测每个表情格的最大肤色脸框
- 外扩4px裁剪, 放入100x100画布, 脸心对齐(50,50)
- 运行时所有贴片脸心对齐半身照脸心, 切换零错位
"""

import os
import numpy as np
from PIL import Image
from scipy import ndimage

CELLS = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\cells"
OUT = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\faces"
CANVAS = 100
PAD = 4

def face_box(img):
    a = np.array(img)
    rgb = a[:,:,:3].astype(int); alpha = a[:,:,3]
    r,g,b = rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
    skin = (r>170)&(g>110)&(b>70)&(r>=g)&(g>=b)&((r-b)>30)&(alpha>40)
    if not skin.any(): return None
    lab, n = ndimage.label(skin)
    sizes = ndimage.sum(skin, lab, range(1,n+1))
    big = int(np.argmax(sizes))+1
    ys,xs = np.where(lab==big)
    return (xs.min(), ys.min(), xs.max()-xs.min()+1, ys.max()-ys.min()+1)

def make_tile(img):
    box = face_box(img)
    if box is None: return None
    fx, fy, fw, fh = box
    crop = img.crop((fx-PAD, fy-PAD, fx+fw+PAD, fy+fh+PAD))
    cw, ch = crop.size
    canvas = Image.new('RGBA', (CANVAS, CANVAS), (0,0,0,0))
    # 脸心对齐画布中心 (50,50)
    x0 = 50 - cw//2
    y0 = 50 - ch//2
    canvas.paste(crop, (x0, y0), crop)
    # 4px 边缘羽化
    a = np.array(canvas)
    for i in range(3):
        a[i,:,3] = (a[i,:,3]*(i+1)/4).astype(np.uint8)
        a[CANVAS-1-i,:,3] = (a[CANVAS-1-i,:,3]*(i+1)/4).astype(np.uint8)
        a[:,i,3] = (a[:,i,3]*(i+1)/4).astype(np.uint8)
        a[:,CANVAS-1-i,3] = (a[:,CANVAS-1-i,3]*(i+1)/4).astype(np.uint8)
    return Image.fromarray(a)

os.makedirs(OUT, exist_ok=True)
names = [f for f in os.listdir(CELLS) if f.endswith('.png') and f != '半身照.png']
for name in names:
    im = Image.open(os.path.join(CELLS, name)).convert('RGBA')
    t = make_tile(im)
    if t: t.save(os.path.join(OUT, name))
print('aligned tiles saved:', len(names), 'canvas', CANVAS, 'face-center 50,50')