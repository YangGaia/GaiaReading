#!/usr/bin/env python3
"""烘焙桌宠九方向注视试验帧。

这不是把整张立绘平移、旋转或压扁，而是在原始像素上分别处理脸部透视、
眼神、内侧头发、颈肩线与披风上半部。所有位移在区域边缘平滑归零，帽子
外轮廓、腰部和下摆保持不动。
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import map_coordinates


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src" / "renderer" / "images" / "pet" / "parts" / "full.png"
OUTPUT = ROOT / "docs" / "pet-direction-pilot"
DIRECTIONS = {
    "up-left": (-0.82, -0.82),
    "up": (0.0, -1.0),
    "up-right": (0.82, -0.82),
    "left": (-1.0, 0.0),
    "center": (0.0, 0.0),
    "right": (1.0, 0.0),
    "down-left": (-0.82, 0.82),
    "down": (0.0, 1.0),
    "down-right": (0.82, 0.82),
}


def soft_ellipse(xx, yy, cx, cy, rx, ry, power=2.0):
    """返回边缘为零且一阶连续的椭圆权重。"""
    radius2 = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
    t = np.clip(1.0 - radius2, 0.0, 1.0)
    return (t * t * (3.0 - 2.0 * t)) ** power


def add_shift(dx, dy, xx, yy, region, move_x=0.0, move_y=0.0):
    """把目标内容移动 move_x/move_y；逆向采样场取相反方向。"""
    dx -= move_x * region
    dy -= move_y * region


def add_face_yaw(dx, xx, yy, horizontal):
    """以近侧脸为视觉支点，收拢远侧脸形成左右偏转透视。"""
    if horizontal == 0:
        return
    cx, cy = 178.0, 169.0
    region = soft_ellipse(xx, yy, cx, cy, 55.0, 77.0, 1.15)
    desired_shift = 4.6 * horizontal
    horizontal_scale = 1.0 - 0.045 * abs(horizontal)
    inverse_offset = (xx - cx - desired_shift) / horizontal_scale - (xx - cx)
    dx += inverse_offset * region


def add_face_pitch(dy, xx, yy, vertical):
    """在头部轮廓内改变五官纵向透视，形成抬头或低头。"""
    if vertical == 0:
        return
    cx, cy = 178.0, 169.0
    region = soft_ellipse(xx, yy, cx, cy, 55.0, 77.0, 1.15)
    desired_shift = 6.6 * vertical
    vertical_scale = 1.0 - 0.05 * abs(vertical)
    inverse_offset = (yy - cy - desired_shift) / vertical_scale - (yy - cy)
    dy += inverse_offset * region


def add_body_yaw(dx, xx, yy, horizontal):
    """让披风上半部绕竖轴微转，而不是让两侧肩膀一高一低。"""
    if horizontal == 0:
        return
    cx, cy = 178.0, 316.0
    region = soft_ellipse(xx, yy, cx, cy, 174.0, 142.0, 1.1)
    desired_shift = 1.55 * horizontal
    horizontal_scale = 1.0 - 0.018 * abs(horizontal)
    inverse_offset = (xx - cx - desired_shift) / horizontal_scale - (xx - cx)
    dx += inverse_offset * region


def add_body_pitch(dy, xx, yy, vertical):
    """只让衣领附近顺着上下视线轻微收放，下摆保持固定。"""
    if vertical == 0:
        return
    cx, cy = 178.0, 300.0
    region = soft_ellipse(xx, yy, cx, cy, 150.0, 112.0, 1.35)
    desired_shift = 0.9 * vertical
    vertical_scale = 1.0 - 0.012 * abs(vertical)
    inverse_offset = (yy - cy - desired_shift) / vertical_scale - (yy - cy)
    dy += inverse_offset * region


def warp_rgba_premultiplied(image, dx, dy):
    """用预乘 Alpha 进行三次插值，避免透明边缘出现黑线。"""
    rgba = np.asarray(image.convert("RGBA"), dtype=np.float32) / 255.0
    alpha = rgba[:, :, 3:4]
    premultiplied = np.concatenate((rgba[:, :, :3] * alpha, alpha), axis=2)

    height, width = rgba.shape[:2]
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    sample_y = np.clip(yy + dy, 0, height - 1)
    sample_x = np.clip(xx + dx, 0, width - 1)
    coords = np.array([sample_y, sample_x])

    warped = np.empty_like(premultiplied)
    for channel in range(4):
        warped[:, :, channel] = map_coordinates(
            premultiplied[:, :, channel], coords, order=3, mode="nearest", prefilter=True
        )

    warped = np.clip(warped, 0.0, 1.0)
    out_alpha = warped[:, :, 3:4]
    out_rgb = np.divide(
        warped[:, :, :3], out_alpha, out=np.zeros_like(warped[:, :, :3]), where=out_alpha > 1e-5
    )
    out = np.concatenate((np.clip(out_rgb, 0.0, 1.0), out_alpha), axis=2)
    quantized = np.rint(out * 255.0).astype(np.uint8)
    quantized[quantized[:, :, 3] == 0, :3] = 0
    return Image.fromarray(quantized, "RGBA")


def make_look(source, horizontal, vertical):
    width, height = source.size
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    dx = np.zeros((height, width), dtype=np.float32)
    dy = np.zeros((height, width), dtype=np.float32)

    # 脸型先产生偏转和俯仰透视；帽子轮廓与外侧长发不参与。
    add_face_yaw(dx, xx, yy, horizontal)
    add_face_pitch(dy, xx, yy, vertical)

    # 眼神比脸先多走一点，鼻尖和嘴只跟随半步，避免五官像贴纸般一起滑动。
    for eye_x in (151.0, 204.0):
        eye = soft_ellipse(xx, yy, eye_x, 153.0, 14.0, 10.0, 1.4)
        add_shift(dx, dy, xx, yy, eye, move_x=1.75 * horizontal, move_y=2.6 * vertical)
    nose_mouth = soft_ellipse(xx, yy, 178.0, 184.0, 24.0, 28.0, 1.3)
    add_shift(dx, dy, xx, yy, nose_mouth, move_x=0.85 * horizontal, move_y=1.25 * vertical)

    # 刘海内层产生小于一像素的视差，外轮廓保持稳定。
    inner_hair = soft_ellipse(xx, yy, 178.0, 125.0, 50.0, 36.0, 1.7)
    add_shift(dx, dy, xx, yy, inner_hair, move_x=1.0 * horizontal, move_y=0.9 * vertical)

    # 颈部、衣领与披风上半部跟随左转；位移在腰部前完全衰减。
    neck = soft_ellipse(xx, yy, 178.0, 238.0, 48.0, 42.0, 1.2)
    add_shift(dx, dy, xx, yy, neck, move_x=2.1 * horizontal, move_y=2.0 * vertical)
    collar_and_pendants = soft_ellipse(xx, yy, 178.0, 272.0, 92.0, 70.0, 1.3)
    add_shift(dx, dy, xx, yy, collar_and_pendants, move_x=1.35 * horizontal, move_y=1.15 * vertical)
    add_body_yaw(dx, xx, yy, horizontal)
    add_body_pitch(dy, xx, yy, vertical)

    # 远侧肩膀向内收，近侧肩膀只跟随半步；不再制造高低肩。
    left_shoulder = soft_ellipse(xx, yy, 91.0, 278.0, 73.0, 52.0, 1.45)
    right_shoulder = soft_ellipse(xx, yy, 263.0, 278.0, 73.0, 52.0, 1.45)
    left_move = 0.9 * horizontal + 0.55 * abs(horizontal)
    right_move = 0.9 * horizontal - 0.55 * abs(horizontal)
    add_shift(dx, dy, xx, yy, left_shoulder, move_x=left_move)
    add_shift(dx, dy, xx, yy, right_shoulder, move_x=right_move)

    return warp_rgba_premultiplied(source, dx, dy)


def checkerboard(size, cell=12):
    width, height = size
    yy, xx = np.mgrid[0:height, 0:width]
    checks = ((xx // cell + yy // cell) % 2).astype(np.uint8)
    colors = np.array([[32, 35, 43], [43, 47, 57]], dtype=np.uint8)
    rgb = colors[checks]
    return Image.fromarray(rgb, "RGB").convert("RGBA")


def make_comparison(center, left):
    margin, gap, label_height = 24, 24, 38
    width = margin * 2 + center.width * 2 + gap
    height = margin * 2 + label_height + center.height
    canvas = checkerboard((width, height))
    draw = ImageDraw.Draw(canvas)
    x1 = margin
    x2 = margin + center.width + gap
    y = margin + label_height
    canvas.alpha_composite(center, (x1, y))
    canvas.alpha_composite(left, (x2, y))
    draw.text((x1, margin + 7), "CENTER / original", fill=(224, 228, 238, 255))
    draw.text((x2, margin + 7), "LOOK LEFT / baked pilot", fill=(224, 228, 238, 255))
    return canvas


def make_detail_comparison(center, left):
    """放大脸、颈部和肩线，便于检查五官与接缝。"""
    crop_box = (92, 92, 264, 330)
    scale = 3
    center_crop = center.crop(crop_box).resize(
        ((crop_box[2] - crop_box[0]) * scale, (crop_box[3] - crop_box[1]) * scale),
        Image.Resampling.NEAREST,
    )
    left_crop = left.crop(crop_box).resize(center_crop.size, Image.Resampling.NEAREST)
    return make_comparison(center_crop, left_crop)


def make_direction_grid(frames, detail=False):
    """生成九宫格总览；detail 模式放大脸、颈部和肩线。"""
    order = (
        ("up-left", "up", "up-right"),
        ("left", "center", "right"),
        ("down-left", "down", "down-right"),
    )
    margin, gap, label_height = 20, 18, 28
    if detail:
        crop_box = (92, 92, 264, 330)
        cell_frames = {
            name: frame.crop(crop_box).resize((344, 476), Image.Resampling.NEAREST)
            for name, frame in frames.items()
        }
    else:
        cell_frames = frames
    cell_width, cell_height = next(iter(cell_frames.values())).size
    width = margin * 2 + cell_width * 3 + gap * 2
    height = margin * 2 + (cell_height + label_height) * 3 + gap * 2
    canvas = checkerboard((width, height))
    draw = ImageDraw.Draw(canvas)
    for row, names in enumerate(order):
        for column, name in enumerate(names):
            x = margin + column * (cell_width + gap)
            y = margin + row * (cell_height + label_height + gap)
            draw.text((x, y + 6), name.upper(), fill=(224, 228, 238, 255))
            canvas.alpha_composite(cell_frames[name], (x, y + label_height))
    return canvas


def main():
    source = Image.open(SOURCE).convert("RGBA")
    frames = {
        name: source.copy() if name == "center" else make_look(source, horizontal, vertical)
        for name, (horizontal, vertical) in DIRECTIONS.items()
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, frame in frames.items():
        filename = "pilot-center.png" if name == "center" else f"pilot-look-{name}.png"
        frame.save(OUTPUT / filename)
    make_comparison(source, frames["left"]).save(OUTPUT / "pilot-comparison.png")
    make_detail_comparison(source, frames["left"]).save(OUTPUT / "pilot-detail-3x.png")
    make_direction_grid(frames).save(OUTPUT / "pilot-directions-grid.png")
    make_direction_grid(frames, detail=True).save(OUTPUT / "pilot-directions-detail.png")
    print(f"saved {len(frames)} direction frames to {OUTPUT}")


if __name__ == "__main__":
    main()
