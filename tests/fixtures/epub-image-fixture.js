'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const JSZip = require('jszip');

function makePng(width, height, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const crcTable = (() => {
    const table = new Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = (() => {
      const combined = Buffer.concat([t, data]);
      let c = 0xffffffff;
      for (let i = 0; i < combined.length; i += 1) c = crcTable[(c ^ combined[i]) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    })();
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([len, t, data, crcBuf]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const rowBytes = width * 3 + 1;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * rowBytes] = 0;
    for (let x = 0; x < width; x += 1) {
      const i = y * rowBytes + 1 + x * 3;
      raw[i] = rgb[0];
      raw[i + 1] = rgb[1];
      raw[i + 2] = rgb[2];
    }
  }
  const idatData = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idatData), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = async function makeImageFixture(directory) {
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(__dirname, 'sample.epub')));
  const chapterName = 'OEBPS/c1.xhtml';
  const body = [
    '<h1>第一章 图片位置验证</h1>',
    '<p>本章的正文段落,用来确认页内文字布局仍然正常,不会因为图片样式调整而错位。</p>',
    // 1) 段落包裹的内联图片
    '<p><img src="images/portrait.png" alt="肖像图" width="320" height="480"/></p>',
    '<p>第一张图片后的文字段落,介绍插图的背景。</p>',
    // 2) div 包裹
    '<div class="image-wrapper"><img src="images/landscape.png" alt="风景图" width="800" height="450"/></div>',
    '<p>第二张图片后的文字段落,介绍地点与人物。</p>',
    // 3) figure + figcaption
    '<figure><img src="images/wide.png" alt="宽幅图" width="1200" height="600"/><figcaption>第三张图的说明文字,验证 figcaption 的居中与字号。</figcaption></figure>',
    '<p>第三张图片后的文字段落,继续叙事。</p>',
    // 4) 段落里 a 包裹的图片
    '<p><a href="c2.x"><img src="images/thumb.png" alt="跳转缩略图" width="240" height="160"/></a></p>',
    '<p>第四章开始前的最后一段文字。</p>',
    // 5) 一段非常长的文本,确保多列布局中图片不再越过列边界
    ...Array.from({ length: 10 }, (_, i) => `<p>填充段落 ${i + 1}:月光照在书页上,窗外的夜色渐渐深了。</p>`)
  ].join('');
  zip.file(chapterName, '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body>' + body + '</body></html>');
  let opf = await zip.file('OEBPS/content.opf').async('string');
  if (!opf.includes('images/portrait.png')) {
    opf = opf.replace(
      '</manifest>',
      [
        '<item id="img-portrait" href="images/portrait.png" media-type="image/png"/>',
        '<item id="img-landscape" href="images/landscape.png" media-type="image/png"/>',
        '<item id="img-wide" href="images/wide.png" media-type="image/png"/>',
        '<item id="img-thumb" href="images/thumb.png" media-type="image/png"/>'
      ].join('') + '</manifest>'
    );
    zip.file('OEBPS/content.opf', opf);
  }
  zip.file('OEBPS/images/portrait.png', makePng(320, 480, [120, 90, 160]));
  zip.file('OEBPS/images/landscape.png', makePng(800, 450, [80, 140, 100]));
  zip.file('OEBPS/images/wide.png', makePng(1200, 600, [180, 120, 80]));
  zip.file('OEBPS/images/thumb.png', makePng(240, 160, [90, 100, 140]));
  const target = path.join(directory, 'epub-image.epub');
  fs.writeFileSync(target, await zip.generateAsync({ type: 'nodebuffer' }));
  return { path: target, format: 'epub', title: 'EPUB 图片位置验证' };
};
