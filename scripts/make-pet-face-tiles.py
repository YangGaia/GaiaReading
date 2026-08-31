#!/usr/bin/env python3
"""重新生成表情贴片: 只取脸框(89x79), 边缘仅3px羽化, 消除大面积半透明叠加阴影。
脸框: x82..170, y103..181(与半身照脸框 89x78 完全贴合)。
"""

import os
import numpy as np
from PIL import Image, ImageFilter

CELLS = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\cells"
OUT = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\faces"
BOX = (82, 103, 171, 182)  # 89x79

def make(img):
    t = img.crop(BOX).convert('RGBA')
    # 3px 边缘羽化
    a = np.array(t)
    h, w = a.shape[:2]
    mask = np.ones((h, w), dtype=float)
    for i in range(3):
        mask[i, :] = (i + 1) / 4.0
        mask[h - 1 - i, :] = (i + 1) / 4.0
        mask[:, i] = np.minimum(mask[:, i], (i + 1) / 4.0)
        mask[:, w - 1 - i] = np.minimum(mask[:, w - 1 - i], (i + 1) / 4.0)
    a[:, :, 3] = (a[:, :, 3] * mask).astype(np.uint8)
    return Image.fromarray(a)

os.makedirs(OUT, exist_ok=True)
names = [f for f in os.listdir(CELLS) if f.endswith('.png') and f != '半身照.png']
for name in names:
    im = Image.open(os.path.join(CELLS, name)).convert('RGBA')
    make(im).save(os.path.join(OUT, name))
print('faces regenerated:', len(names), 'size 89x79')