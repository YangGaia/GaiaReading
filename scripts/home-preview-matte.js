'use strict';

// Derive a preview-only silhouette from the homepage JPEG, without repainting it.
// Run with Electron: electron scripts/home-preview-matte.js
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

function makeMatte(source) {
  const { width, height } = source.getSize();
  const pixels = source.toBitmap();
  const outside = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  function visit(index) {
    if (outside[index]) return;
    const offset = index * 4;
    const low = Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    const high = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    // Only neutral, bright pixels connected to an image edge are background.
    // Skin and eye highlights remain enclosed, and therefore fully opaque.
    if (low < 210 || high - low > 45) return;
    outside[index] = 1;
    queue[tail++] = index;
  }
  for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    if (x > 0) visit(index - 1);
    if (x + 1 < width) visit(index + 1);
    if (index >= width) visit(index - width);
    if (index + width < outside.length) visit(index + width);
  }
  const matte = Buffer.alloc(width * height * 4, 255);
  for (let index = 0; index < outside.length; index++) {
    if (outside[index]) matte.fill(0, index * 4, index * 4 + 4);
  }
  return nativeImage.createFromBitmap(matte, { width, height });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) app.whenReady().then(() => {
  const root = path.resolve(__dirname, '..');
  const source = nativeImage.createFromPath(path.join(root, 'src/renderer/images/1.jpg'));
  const target = path.join(root, 'docs/design/home/assets/alice-matte.png');
  if (source.isEmpty()) throw new Error('Homepage illustration could not be decoded');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, makeMatte(source).toPNG());
  console.log(target);
  app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });

module.exports = { makeMatte };
