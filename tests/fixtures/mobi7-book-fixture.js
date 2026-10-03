'use strict';

// 原创合成 MOBI7：真实 PalmDB、分段文本、十进制图片资源和绝对字节 filepos。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const contents = Buffer.concat([Buffer.from(type), data]);
  return Buffer.concat([uint32(data.length), contents, uint32(crc32(contents))]);
}

function imagePng(width, height, colorAtRow) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const color = colorAtRow(y);
    for (let x = 0; x < width; x += 1) {
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header), pngChunk('IDAT', zlib.deflateSync(pixels, { level: 9 })), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function palmDatabase(records) {
  const header = Buffer.alloc(78 + records.length * 8 + 2);
  header.write('Gaia MOBI7 regression fixture');
  header.write('BOOKMOBI', 60);
  header.writeUInt16BE(records.length, 76);
  let offset = header.length;
  records.forEach((record, index) => {
    header.writeUInt32BE(offset, 78 + index * 8);
    header.writeUInt32BE(index + 1, 82 + index * 8);
    offset += record.length;
  });
  return Buffer.concat([header, ...records]);
}

function createMobi7Fixture(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const title = 'Synthetic MOBI7 image regression';
  const author = 'GaiaReading test fixture';
  const labels = ['Contents', 'Text and Footnote', 'Image Gallery', 'Final Chapter Notes'];
  const anchors = labels.map((label, index) => 'mobi7-chapter-' + index);
  const positions = labels.map((label, index) => 'C00000000' + index);
  const paragraph = '<p>Original legacy-reader fixture text keeps paragraph positions observable across multiple Palm text records. It is written only for automated regression checks.</p>';
  const footnoteText = '[1] The note in the final chapter belongs to the synthetic reference.';
  const referenceText = 'A cross-chapter note reference';
  const chapters = [
    '<h1 id="' + anchors[0] + '">' + labels[0] + '</h1>'
      + labels.map((label, index) => '<p><a filepos="' + positions[index] + '">' + label + '</a></p>').join(''),
    '<h1 id="' + anchors[1] + '">' + labels[1] + '</h1>'
      + '<p>这是原创测试正文，用于确认 UTF-8 字节位置在传统 MOBI 中保持正确。</p>'
      + '<p id="reference-target">' + referenceText + ' <a id="note-link" filepos="N000000000">[1]</a> appears in this paragraph.</p>'
      + paragraph.repeat(28),
    '<div id="' + anchors[2] + '" style="height:1600px;width:900px;text-indent:2em;line-height:2;margin:18px 0">'
      + '<img id="long-image" recindex="0010" alt="Synthetic long image with green footer"/></div>'
      + '<div><img id="secondary-image" recindex="32" alt="Synthetic orange image"/></div>',
    '<h1 id="' + anchors[3] + '">' + labels[3] + '</h1>'
      + '<p id="note-target">' + footnoteText + ' <a id="return-link" filepos="R000000000">[1] Return to reference</a></p>'
      + paragraph.repeat(3),
  ];
  let source = '<html><head><title>' + title + '</title><guide><reference type="toc" filepos=T000000000/></guide></head><body>'
    + chapters.join('<mbp:pagebreak/>') + '</body></html>';
  const byteOffsetOf = (tag) => {
    const index = source.indexOf(tag);
    if (index < 0) throw new Error('Synthetic MOBI7 target is missing: ' + tag);
    return Buffer.byteLength(source.slice(0, index));
  };
  const chapterOffsets = anchors.map((anchor, index) => byteOffsetOf('<' + (index === 2 ? 'div' : 'h1') + ' id="' + anchor + '"'));
  const noteOffset = byteOffsetOf('<p id="note-target"');
  const referenceOffset = byteOffsetOf('<p id="reference-target"');
  const fixedPosition = (offset) => String(offset).padStart(10, '0');
  const replacements = new Map(positions.map((marker, index) => [marker, chapterOffsets[index]]));
  replacements.set('T000000000', chapterOffsets[0]);
  replacements.set('N000000000', noteOffset);
  replacements.set('R000000000', referenceOffset);
  // 等长替换：所有 filepos 仍指向最终 UTF-8 文本中的真实字节，不补偿解析器的章节剪切。
  for (const [marker, offset] of replacements) source = source.replaceAll(marker, fixedPosition(offset));
  const rawText = Buffer.from(source);
  const textRecords = [];
  for (let offset = 0; offset < rawText.length; offset += 4096) textRecords.push(rawText.subarray(offset, offset + 4096));
  const resourceStart = 1 + textRecords.length;
  const tall = imagePng(120, 1200, (row) => row >= 1120 ? [30, 170, 85] : row < 80 ? [45, 80, 180] : row % 160 < 80 ? [240, 220, 160] : [100, 180, 215]);
  const orange = imagePng(80, 80, () => [235, 96, 50]);
  const resources = Array.from({ length: 36 }, (_, index) => Buffer.from('UNUSED synthetic legacy resource ' + index));
  resources[9] = tall;
  resources[31] = orange;
  resources[35] = Buffer.concat([Buffer.from('INDX'), Buffer.alloc(188)]);

  const exthEntries = [[100, Buffer.from(author)], [503, Buffer.from(title)], [201, uint32(9)], [202, uint32(31)]]
    .map(([id, data]) => Buffer.concat([uint32(id), uint32(8 + data.length), data]));
  const exth = Buffer.concat([Buffer.from('EXTH'), uint32(12 + exthEntries.reduce((sum, entry) => sum + entry.length, 0)), uint32(exthEntries.length), ...exthEntries]);
  const header = Buffer.alloc(248);
  header.writeUInt16BE(1, 0);
  header.writeUInt32BE(rawText.length, 4);
  header.writeUInt16BE(textRecords.length, 8);
  header.writeUInt16BE(4096, 10);
  header.write('MOBI', 16);
  header.writeUInt32BE(232, 20);
  header.writeUInt32BE(2, 24);
  header.writeUInt32BE(65001, 28);
  header.writeUInt32BE(0x47414937, 32);
  header.writeUInt32BE(6, 36);
  header.writeUInt32BE(header.length + exth.length, 84);
  header.writeUInt32BE(Buffer.byteLength(title), 88);
  header[95] = 9;
  header.writeUInt32BE(resourceStart, 108);
  header.writeUInt32BE(0x40, 128);
  header.writeUInt32BE(0xffffffff, 244);
  const filePath = path.join(directory, 'synthetic-mobi7-images.mobi');
  fs.writeFileSync(filePath, palmDatabase([Buffer.concat([header, exth, Buffer.from(title)]), ...textRecords, ...resources]));
  return {
    path: filePath, format: 'mobi', title, author,
    expected: {
      kind: 'mobi7', galleryChapter: 2, longImageId: 'long-image', lateImageId: 'secondary-image',
      footnoteLinkId: 'note-link', returnLinkId: 'return-link',
      chapters: labels.map((label, index) => ({ index, label, anchor: anchors[index], selector: '[id="' + anchors[index] + '"]', filepos: chapterOffsets[index] })),
      footnote: { fromChapter: 1, targetIndex: 3, href: 'filepos:' + fixedPosition(noteOffset), selector: '[id="note-target"]', textHint: footnoteText },
      returnLink: { fromChapter: 3, targetIndex: 1, href: 'filepos:' + fixedPosition(referenceOffset), selector: '[id="reference-target"]', textHint: referenceText },
      images: {
        tall: { resourceIndex: 9, recindex: '0010', width: 120, height: 1200, mime: 'image/png', bottomColor: [30, 170, 85], dataUrl: 'data:image/png;base64,' + tall.toString('base64') },
        orange: { resourceIndex: 31, recindex: '32', width: 80, height: 80, mime: 'image/png', color: [235, 96, 50], dataUrl: 'data:image/png;base64,' + orange.toString('base64') },
      },
      resourceStart, textRecordCount: textRecords.length, sourceByteLength: rawText.length,
    },
  };
}

module.exports = { createMobi7Fixture };
