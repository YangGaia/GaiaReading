'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const vendorDir = path.join(root, 'src', 'renderer', 'vendor');
const files = [
  ['epubjs/dist/epub.min.js', 'epub.min.js'],
  ['pdfjs-dist/build/pdf.min.js', 'pdf.min.js'],
  ['pdfjs-dist/build/pdf.worker.min.js', 'pdf.worker.min.js'],
];

fs.mkdirSync(vendorDir, { recursive: true });
for (const [from, to] of files) {
  const src = path.join(root, 'node_modules', from);
  if (!fs.existsSync(src)) {
    console.error('缺少前端库文件: ' + src);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(vendorDir, to));
  console.log('已复制 ' + to);
}
