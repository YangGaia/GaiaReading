#!/usr/bin/env python3
"""从桌宠身体图中拆出左右前臂，并生成修补后的伸展动作底图。"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src" / "renderer" / "images" / "pet" / "parts" / "body.png"
OUTPUT = ROOT / "src" / "renderer" / "images" / "pet" / "parts"
MASK_SCALE = 4

ARM_POLYGONS = {
    "left": [
        (60, 469), (77, 482), (71, 507), (71, 581), (63, 594),
        (49, 590), (38, 575), (37, 548), (42, 516), (45, 490),
    ],
    "right": [
        (244, 454), (267, 471), (258, 492), (264, 518), (266, 546),
        (257, 574), (241, 593), (219, 584), (204, 569), (199, 550),
        (206, 527), (212, 505), (216, 483), (228, 463),
    ],
}

# 修补范围故意略大于手臂提取范围，确保手臂移走后不留下手套或袖口残片。
REPAIR_POLYGONS = {
    "left": [
        (43, 472), (82, 475), (82, 500), (76, 520), (77, 570),
        (70, 596), (48, 600), (34, 580), (33, 548), (38, 520), (39, 490),
    ],
    "right": [
        (225, 455), (264, 458), (274, 478), (263, 500), (272, 530),
        (272, 559), (260, 586), (245, 604), (214, 601), (196, 583),
        (190, 555), (199, 525), (206, 502), (209, 480),
    ],
}


def antialiased_polygon(size, points):
    big_size = (size[0] * MASK_SCALE, size[1] * MASK_SCALE)
    mask = Image.new("L", big_size, 0)
    scaled = [(x * MASK_SCALE, y * MASK_SCALE) for x, y in points]
    ImageDraw.Draw(mask).polygon(scaled, fill=255)
    return mask.resize(size, Image.Resampling.LANCZOS)


body = Image.open(SOURCE).convert("RGBA")
masks = {name: antialiased_polygon(body.size, points) for name, points in ARM_POLYGONS.items()}
repair_masks = {name: antialiased_polygon(body.size, points) for name, points in REPAIR_POLYGONS.items()}
repair_union = Image.fromarray(
    np.maximum(np.asarray(repair_masks["left"]), np.asarray(repair_masks["right"])).astype(np.uint8),
    mode="L",
)

# 从同一高度的干净裙摆区域取样补色；透明轮廓仍参考对称侧身体边缘。
source = np.asarray(body).copy()
target = source.copy()
mirrored_alpha = source[:, ::-1, 3]
for name, repair_mask in repair_masks.items():
    ys, xs = np.nonzero(np.asarray(repair_mask) > 0)
    if name == "left":
        sample_xs = np.clip(xs + 60, 90, 155)
    else:
        sample_xs = np.clip(xs - 90, 100, 190)
    target[ys, xs, :3] = source[ys, sample_xs, :3]
    target[ys, xs, 3] = mirrored_alpha[ys, xs]
stretch_body = Image.composite(Image.fromarray(target, mode="RGBA"), body, repair_union)
stretch_body.save(OUTPUT / "stretch-body.png")

for name, mask in masks.items():
    arm = Image.new("RGBA", body.size)
    arm.paste(body, (0, 0), mask)
    arm.putalpha(ImageChops.multiply(body.getchannel("A"), mask))
    arm.save(OUTPUT / f"stretch-{name}-arm.png")

print("stretch body/arms regenerated")
