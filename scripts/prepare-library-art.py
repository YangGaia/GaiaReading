"""Extract the user's robin illustration without changing the original photo.

Run manually with Python, Pillow, NumPy and SciPy:
  python scripts/prepare-library-art.py "<original-photo-path>"

The original photo must be provided explicitly; it is not bundled with the app.
"""
import argparse
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source", type=Path, help="原始照片的文件路径（必填）")
args = parser.parse_args()
source = args.source
if not source.is_file():
    parser.error(f"输入文件不存在: {source}")

# Parse and validate the input before loading optional image dependencies.
import numpy as np
from PIL import Image
from scipy import ndimage

image = Image.open(source).convert("RGB")
pixels = np.asarray(image).astype(float)
border = np.concatenate((pixels[0], pixels[-1], pixels[:, 0], pixels[:, -1]))
background = np.median(border, axis=0)
distance = np.linalg.norm(pixels - background, axis=2)
candidate = distance < 22
seed = np.zeros(candidate.shape, dtype=bool)
seed[0] = seed[-1] = True
seed[:, 0] = seed[:, -1] = True
background_mask = ndimage.binary_propagation(seed & candidate, mask=candidate)
foreground = ~background_mask
labels, count = ndimage.label(foreground)
sizes = np.bincount(labels.ravel())
sizes[0] = 0
foreground = labels == sizes.argmax()
alpha = np.clip(ndimage.distance_transform_edt(foreground) / 1.5, 0, 1)
result = image.convert("RGBA")
result.putalpha(Image.fromarray(np.uint8(alpha * 255)))
result = result.crop(result.getbbox())
result.thumbnail((900, 900), Image.Resampling.LANCZOS)
output = root / "src/renderer/images/library/robin.png"
output.parent.mkdir(parents=True, exist_ok=True)
result.save(output, optimize=True)
print(f"Saved {output.relative_to(root)}: {result.size}")
