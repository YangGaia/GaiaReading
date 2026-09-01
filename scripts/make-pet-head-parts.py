#!/usr/bin/env python3
"""生成桌宠头身分层素材。

头部裁切覆盖帽子、头发与颈部；身体层只在颈部旋转轴附近保留窄幅重叠，
其余头部活动区域完全透明，避免歪头时露出原位置的旧头部像素。
"""

import os
import numpy as np
from PIL import Image

SRC = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\cells\半身照.png"
OUT = r"D:\Codex_project\Gaia_Reading\src\renderer\images\pet\parts"
HEAD = (88, 0, 268, 235)
BOTTOM_OVERLAP = 12

im = Image.open(SRC).convert('RGBA')
W, H = im.size
os.makedirs(OUT, exist_ok=True)

# 1) 头层：底部只在颈部旋转轴附近羽化，裁切左右已包含透明留白。
head = im.crop(HEAD).convert('RGBA')
a = np.array(head)
hh = a.shape[0]
for y in range(hh - BOTTOM_OVERLAP, hh):
    t = (y - (hh - BOTTOM_OVERLAP)) / BOTTOM_OVERLAP
    a[y, :, 3] = (a[y, :, 3].astype(np.float32) * (1 - t)).astype(np.uint8)
Image.fromarray(a).save(os.path.join(OUT, 'head.png'))

# 2) 身体层：活动区彻底透明；仅保留最底部 12px 作为颈部接缝衬底。
body = im.copy()
a = np.array(body)
x0, y0, x1, y1 = HEAD
a[y0:min(y1 - BOTTOM_OVERLAP, H), x0:min(x1, W), 3] = 0
Image.fromarray(a).save(os.path.join(OUT, 'body.png'))
print('head/body regenerated with clean head cutout')
