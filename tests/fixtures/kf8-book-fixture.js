'use strict';

// 原创合成样书：生成真正的 PalmDB/KF8 文件，不替换解析器的任何读取方法。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function variableInteger(value) {
  const bytes = [value & 0x7f];
  while ((value = Math.floor(value / 128)) > 0) bytes.unshift(value & 0x7f);
  bytes[bytes.length - 1] |= 0x80;
  return Buffer.from(bytes);
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
  header[9] = 2; // RGB, 8 bits per channel.
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
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(pixels, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function stringTable(strings) {
  const offsets = [];
  const records = [];
  let length = 0;
  for (const value of strings) {
    const text = Buffer.from(value);
    const record = Buffer.concat([variableInteger(text.length), text]);
    offsets.push(length);
    records.push(record);
    length += record.length;
  }
  return { offsets, buffer: Buffer.concat(records) };
}

/** INDX 主记录 + TAGX、INDX 数据记录 + IDXT，以及可选 CNCX 字符串记录。 */
function indexRecords(tags, entries, strings) {
  const headerSize = 192;
  const main = Buffer.alloc(headerSize);
  main.write('INDX');
  main.writeUInt32BE(headerSize, 4);
  main.writeUInt32BE(1, 24);
  main.writeUInt32BE(65001, 28);
  main.writeUInt32BE(entries.length, 36);
  main.writeUInt32BE(strings ? 1 : 0, 52);
  const tagx = Buffer.alloc(12 + (tags.length + 1) * 4);
  tagx.write('TAGX');
  tagx.writeUInt32BE(tagx.length, 4);
  tagx.writeUInt32BE(1, 8);
  tags.forEach(([tag, count], index) => {
    tagx.set([tag, count, 1 << index, 0], 12 + index * 4);
  });
  tagx.set([0, 0, 0, 1], 12 + tags.length * 4);

  const offsets = [];
  const payloads = [];
  let length = headerSize;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    if (name.length > 255) throw new Error('Synthetic INDX entry name is too long');
    const values = tags.flatMap(([tag]) => entry.values[tag].map(variableInteger));
    const payload = Buffer.concat([Buffer.from([name.length]), name, Buffer.from([(1 << tags.length) - 1]), ...values]);
    offsets.push(length);
    payloads.push(payload);
    length += payload.length;
  }
  const padding = Buffer.alloc((4 - length % 4) % 4);
  const data = Buffer.alloc(headerSize);
  data.write('INDX');
  data.writeUInt32BE(headerSize, 4);
  data.writeUInt32BE(length + padding.length, 20);
  data.writeUInt32BE(entries.length, 24);
  data.writeUInt32BE(65001, 28);
  const idxt = Buffer.alloc(4 + offsets.length * 2);
  idxt.write('IDXT');
  offsets.forEach((offset, index) => idxt.writeUInt16BE(offset, 4 + index * 2));
  const records = [Buffer.concat([main, tagx]), Buffer.concat([data, ...payloads, padding, idxt])];
  if (strings) records.push(strings);
  return records;
}

function positionUri(fid, offset) {
  return 'kindle:pos:fid:' + fid.toString(32).toUpperCase().padStart(4, '0')
    + ':off:' + offset.toString(32).toUpperCase().padStart(10, '0');
}

function palmDatabase(records) {
  const header = Buffer.alloc(78 + records.length * 8 + 2);
  header.write('Gaia KF8 regression fixture');
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

function createKf8Fixture(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const title = 'Synthetic KF8 image regression';
  const author = 'GaiaReading test fixture';
  const labels = ['Introduction', 'Image Gallery', 'Notes and Final Image'];
  const anchors = ['kf8-chapter-1', 'kf8-chapter-2', 'kf8-chapter-3'];
  const sourcePrefix = '<h1 id="' + anchors[0] + '">' + labels[0] + '</h1>'
    + '<p>This original synthetic book checks KF8 records, images, styles and navigation.</p>';
  const notePrefix = '<h1 id="' + anchors[2] + '">' + labels[2] + '</h1>';
  const footnoteHref = positionUri(2, Buffer.byteLength(notePrefix));
  const returnHref = positionUri(0, Buffer.byteLength(sourcePrefix));
  const paragraph = '<p>Original fixture text keeps paragraph pagination observable when the window, font size, margins or page gap change. No published book content is used.</p>';
  const fragments = [
    sourcePrefix + '<p id="kf8-footnote-source">A cross-chapter footnote <a id="kf8-footnote-link" href="' + footnoteHref + '">[1]</a>.</p>' + paragraph.repeat(16),
    '<h1 id="' + anchors[1] + '">' + labels[1] + '</h1>'
      + '<div class="plate-frame"><img id="kf8-long-image" src="kindle:embed:0010?mime=image/jpeg" alt="Synthetic tall color chart"/></div>'
      + '<div id="kf8-background" class="plate-background kf8-imported"></div>'
      + '<svg id="kf8-inline-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="80" height="80" viewBox="0 0 80 80">'
      + '<image id="kf8-svg-image" xlink:href="kindle:embed:001G?mime=image/png" width="80" height="80"/></svg>'
      + '<img id="kf8-svg-resource" src="kindle:flow:0012?mime=image/svg+xml" width="80" height="80" alt="SVG with embedded synthetic image"/>',
    notePrefix + '<p id="kf8-footnote-target">[1] This is the real note in the final chapter. '
      + '<a id="kf8-return-link" href="' + returnHref + '">Return to reference</a>.</p>'
      + paragraph.repeat(3) + '<img id="kf8-late-image" src="kindle:embed:001G?mime=image/jpeg" alt="Final chapter image"/>',
  ].map((text) => Buffer.from(text));

  const skeletons = labels.map((label) => Buffer.from('<html><head><title>' + label + '</title>'
    + '<link rel="stylesheet" href="kindle:flow:0010?mime=text/css"/>'
    + '<style>.kf8-head-style { background-image: url("kindle:embed:001G?mime=image/png"); }</style>'
    + '</head><body></body></html>'));
  const chapterOffsets = [];
  let chapterLength = 0;
  const chapterParts = skeletons.flatMap((skeleton, index) => {
    chapterOffsets.push(chapterLength);
    chapterLength += skeleton.length + fragments[index].length;
    return [skeleton, fragments[index]];
  });
  const flows = [Buffer.concat(chapterParts)];
  for (let index = 1; index < 32; index += 1) flows.push(Buffer.from(index === 10
    ? '.wrong-radix-flow { display: none; }' : '/* unused synthetic flow ' + index + ' */'));
  flows.push(Buffer.from('@import url("kindle:flow:0011?mime=text/css") screen;'
    + '.plate-frame { height: 1600px; width: 900px; text-indent: 2em; line-height: 2; margin: 18px 0; }'
    + '.plate-background { width: 80px; height: 80px; background-image: url("kindle:embed:001G?mime=image/png"); background-size: 100% 100%; }'));
  flows.push(Buffer.from('.kf8-imported { border: 0; background-repeat: no-repeat; color: rgb(30, 170, 85); }'));
  flows.push(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">'
    + '<image href="kindle:embed:001G?mime=image/jpeg" width="80" height="80"/></svg>'));
  const rawText = Buffer.concat(flows);
  const textRecords = [];
  for (let offset = 0; offset < rawText.length; offset += 4096) textRecords.push(rawText.subarray(offset, offset + 4096));
  const fdst = Buffer.alloc(12 + flows.length * 8);
  fdst.write('FDST');
  fdst.writeUInt32BE(12, 4);
  fdst.writeUInt32BE(flows.length, 8);
  let flowOffset = 0;
  flows.forEach((flow, index) => {
    fdst.writeUInt32BE(flowOffset, 12 + index * 8);
    flowOffset += flow.length;
    fdst.writeUInt32BE(flowOffset, 16 + index * 8);
  });

  const selectors = stringTable(anchors.map((anchor) => '[id="' + anchor + '"]'));
  const skelRecords = indexRecords([[1, 1], [6, 2]], skeletons.map((skeleton, index) => ({
    name: 'chapter-' + index, values: { 1: [1], 6: [chapterOffsets[index], skeleton.length] },
  })));
  const fragRecords = indexRecords([[2, 1], [4, 1], [6, 2]], fragments.map((fragment, index) => ({
    name: String(chapterOffsets[index] + skeletons[index].indexOf('</body>')),
    values: { 2: [selectors.offsets[index]], 4: [index], 6: [0, fragment.length] },
  })), selectors.buffer);
  const tocStrings = stringTable(labels);
  const ncxRecords = indexRecords([[1, 1], [2, 1], [3, 1], [4, 1], [6, 2]], labels.map((label, index) => ({
    name: String(index),
    values: { 1: [chapterOffsets[index]], 2: [skeletons[index].length + fragments[index].length], 3: [tocStrings.offsets[index]], 4: [0], 6: [index, 0] },
  })), tocStrings.buffer);
  const fdstIndex = 1 + textRecords.length;
  const skelIndex = fdstIndex + 1;
  const fragIndex = skelIndex + skelRecords.length;
  const ncxIndex = fragIndex + fragRecords.length;
  const resourceStart = ncxIndex + ncxRecords.length;

  const tall = imagePng(120, 1200, (row) => row < 80 ? [45, 80, 180] : row >= 1120 ? [235, 96, 50] : row % 160 < 80 ? [80, 190, 210] : [235, 235, 220]);
  const green = imagePng(80, 80, () => [30, 170, 85]);
  const resources = Array.from({ length: 52 }, (_, index) => Buffer.from('UNUSED synthetic resource ' + index));
  resources[31] = tall;
  resources[47] = green;
  // base36 会把 0010/001G 错读成 36/52，落到实际索引 35/51 的 INDX 上。
  resources[35] = Buffer.concat([Buffer.from('INDX'), Buffer.alloc(188)]);
  resources[51] = Buffer.concat([Buffer.from('INDX'), Buffer.alloc(188)]);

  const exthEntries = [[100, Buffer.from(author)], [503, Buffer.from(title)], [201, uint32(31)], [202, uint32(47)]]
    .map(([id, data]) => Buffer.concat([uint32(id), uint32(8 + data.length), data]));
  const exth = Buffer.concat([Buffer.from('EXTH'), uint32(12 + exthEntries.reduce((sum, entry) => sum + entry.length, 0)), uint32(exthEntries.length), ...exthEntries]);
  const header = Buffer.alloc(280);
  header.writeUInt16BE(1, 0); // PalmDOC: uncompressed text.
  header.writeUInt32BE(rawText.length, 4);
  header.writeUInt16BE(textRecords.length, 8);
  header.writeUInt16BE(4096, 10);
  header.write('MOBI', 16);
  header.writeUInt32BE(264, 20);
  header.writeUInt32BE(2, 24);
  header.writeUInt32BE(65001, 28);
  header.writeUInt32BE(0x47414941, 32);
  header.writeUInt32BE(8, 36);
  header.writeUInt32BE(header.length + exth.length, 84);
  header.writeUInt32BE(Buffer.byteLength(title), 88);
  header[95] = 9; // English.
  header.writeUInt32BE(resourceStart, 108);
  header.writeUInt32BE(0x40, 128);
  header.writeUInt32BE(fdstIndex, 192);
  header.writeUInt32BE(flows.length, 196);
  header.writeUInt32BE(ncxIndex, 244);
  header.writeUInt32BE(fragIndex, 248);
  header.writeUInt32BE(skelIndex, 252);
  header.writeUInt32BE(0xffffffff, 260);
  const records = [Buffer.concat([header, exth, Buffer.from(title)]), ...textRecords, fdst, ...skelRecords, ...fragRecords, ...ncxRecords, ...resources];
  const filePath = path.join(directory, 'synthetic-kf8-images.azw3');
  fs.writeFileSync(filePath, palmDatabase(records));
  return {
    path: filePath, format: 'azw3', title, author,
    expected: {
      kind: 'kf8', galleryChapter: 1, longImageId: 'kf8-long-image', backgroundId: 'kf8-background',
      svgId: 'kf8-inline-svg', svgImageId: 'kf8-svg-image', svgResourceId: 'kf8-svg-resource', lateImageId: 'kf8-late-image',
      footnoteLinkId: 'kf8-footnote-link', returnLinkId: 'kf8-return-link',
      chapters: labels.map((label, index) => ({ index, label, anchor: anchors[index], selector: '[id="' + anchors[index] + '"]' })),
      footnote: { fromChapter: 0, targetIndex: 2, href: footnoteHref, selector: '[id="kf8-footnote-target"]' },
      returnLink: { fromChapter: 2, targetIndex: 0, href: returnHref, selector: '[id="kf8-footnote-source"]' },
      images: {
        tall: { resourceIndex: 31, embed: '0010', width: 120, height: 1200, mime: 'image/png', bottomColor: [235, 96, 50], dataUrl: 'data:image/png;base64,' + tall.toString('base64') },
        green: { resourceIndex: 47, embed: '001G', width: 80, height: 80, mime: 'image/png', color: [30, 170, 85], dataUrl: 'data:image/png;base64,' + green.toString('base64') },
      },
      cssMarkers: ['.plate-frame', '.plate-background', '.kf8-imported', '.kf8-head-style'],
      forbiddenCssMarkers: ['.wrong-radix-flow'],
      resourceStart, resourceDecoys: [35, 51], stylesheetFlow: 32, textRecordCount: textRecords.length,
    },
  };
}

module.exports = { createKf8Fixture };
