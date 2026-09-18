'use strict';

// Generated, uncompressed PalmDB books. No copyrighted books or conversion
// tools are needed to exercise the installed MOBI7/KF8 parser end to end.
const fs = require('fs');
const path = require('path');

function picture(width, height) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#d9e9ef"/><path d="M0 0L${width} ${height}M${width} 0L0 ${height}" stroke="#53879e" stroke-width="8"/><rect width="${width}" height="${height * .12}" fill="#205a9a"/><rect y="${height * .88}" width="${width}" height="${height * .12}" fill="#1ba060"/><text x="${width / 2}" y="${height * .96}" font-size="${width / 8}" fill="white" text-anchor="middle">BOTTOM</text></svg>`);
}

function pdb(records) {
  const header = Buffer.alloc(78 + records.length * 8 + 2);
  header.write('Gaia image regression');
  header.write('BOOKMOBI', 60);
  header.writeUInt16BE(records.length, 76);
  let offset = header.length;
  records.forEach((record, index) => {
    header.writeUInt32BE(offset, 78 + index * 8);
    offset += record.length;
  });
  return Buffer.concat([header, ...records]);
}

function mobiHeader(version, length, resourceStart) {
  const header = Buffer.alloc(320);
  header.writeUInt16BE(1, 0); // uncompressed PalmDoc
  header.writeUInt32BE(length, 4);
  header.writeUInt16BE(1, 8); // one text record
  header.writeUInt16BE(65535, 10);
  header.write('MOBI', 16);
  for (const [offset, value] of [[20, 264], [24, 2], [28, 65001], [36, version], [84, 296], [88, 21], [108, resourceStart], [128, 64], [244, 0xffffffff], [260, 0xffffffff]]) {
    header.writeUInt32BE(value, offset);
  }
  header.write('EXTH', 280);
  header.writeUInt32BE(12, 284);
  header.write('Gaia image regression', 296);
  return header;
}

function variable(number) {
  const bytes = [number & 127 | 128];
  while ((number >>>= 7)) bytes.unshift(number & 127);
  return Buffer.from(bytes);
}

function indexHeader() {
  const header = Buffer.alloc(56);
  header.write('INDX');
  header.writeUInt32BE(56, 4);
  header.writeUInt32BE(65001, 28);
  return header;
}

function skeletonIndex(chapters) {
  const header = indexHeader();
  header.writeUInt32BE(1, 24);
  const tagx = Buffer.alloc(20);
  tagx.write('TAGX');
  tagx.writeUInt32BE(20, 4);
  tagx.writeUInt32BE(1, 8);
  tagx.set([1, 1, 1, 0, 6, 2, 2, 0], 12); // fragment count; skeleton offset/length
  let start = 0;
  const entries = chapters.map((chapter, i) => {
    const name = Buffer.from(String(i));
    const entry = Buffer.concat([Buffer.from([name.length]), name, Buffer.from([3]), variable(0), variable(start), variable(chapter.length)]);
    start += chapter.length;
    return entry;
  });
  const dataHeader = indexHeader();
  const idxt = Buffer.alloc(4 + entries.length * 2);
  idxt.write('IDXT');
  let offset = dataHeader.length;
  entries.forEach((entry, i) => { idxt.writeUInt16BE(offset, 4 + i * 2); offset += entry.length; });
  dataHeader.writeUInt32BE(offset, 20);
  dataHeader.writeUInt32BE(entries.length, 24);
  return [Buffer.concat([header, tagx]), Buffer.concat([dataHeader, ...entries, idxt])];
}

function makeMobi7(directory) {
  const html = Buffer.from('<html><head></head><body><p><img id="long" recindex="1"/></p><mbp:pagebreak/><img id="decimal" recindex="12"/></body></html>');
  const resources = Array.from({ length: 12 }, (_, i) => picture(i === 11 ? 80 : 360, i === 11 ? 40 : 2400));
  const file = path.join(directory, 'images-mobi7.mobi');
  fs.writeFileSync(file, pdb([mobiHeader(6, html.length, 2), html, ...resources]));
  return { path: file, title: 'MOBI7 图片验证', format: 'mobi' };
}

function makeKf8(directory) {
  const embed = (index, mime = 'image/svg+xml') => `kindle:embed:${index.toString(32).toUpperCase().padStart(4, '0')}?mime=${mime}`;
  const paragraphs = Array.from({ length: 60 }, (_, i) => `<p id="text-${i}">第 ${i + 1} 段：阅读位置验证。文字和插图应当保持完整。${'月光落在书页上。'.repeat(12)}</p>`).join('');
  const contents = [
    `<div class="fixed-wrapper"><p><a><img id="long" src="${embed(172)}" width="360" height="2400"/></a></p></div>`,
    `<img id="wide" src="${embed(33)}"/><p>行内图 <img id="small" width="16" src="${embed(12)}"/> 保留小图尺寸。</p>`,
    `<svg id="svg-wrapper" width="360" height="2400" viewBox="0 0 360 2400"><image width="360" height="2400" xlink:href="${embed(172)}"/></svg>`,
    `<p><img id="nested-svg" src="${embed(173)}"/></p>${paragraphs}`,
  ];
  const chapters = contents.map(body => Buffer.from(`<html><head><link href="kindle:flow:000A?mime=text/css" rel="stylesheet"/><link href="kindle:flow:0010?mime=text/css" rel="stylesheet"/></head><body>${body}</body></html>`));
  const flows = Array.from({ length: 33 }, () => Buffer.from('/* unused flow */'));
  flows[0] = Buffer.concat(chapters);
  flows[10] = Buffer.from('.fixed-wrapper { height: 2600px; overflow: hidden; } .probe { background-image: url(' + embed(33) + '); }');
  flows[32] = Buffer.from('p { color: rgb(40, 50, 60); }');
  const fdst = Buffer.alloc(12 + flows.length * 8);
  fdst.write('FDST');
  fdst.writeUInt32BE(fdst.length, 4);
  fdst.writeUInt32BE(flows.length, 8);
  let offset = 0;
  flows.forEach((flow, i) => { fdst.writeUInt32BE(offset, 12 + i * 8); offset += flow.length; fdst.writeUInt32BE(offset, 16 + i * 8); });
  const text = Buffer.concat(flows);
  const header = mobiHeader(8, text.length, 6);
  header.writeUInt32BE(2, 192);
  header.writeUInt32BE(flows.length, 196);
  header.writeUInt32BE(5, 248);
  header.writeUInt32BE(3, 252);
  const emptyTags = Buffer.alloc(12);
  emptyTags.write('TAGX');
  emptyTags.writeUInt32BE(12, 4);
  const resources = Array.from({ length: 193 }, () => Buffer.from('RESC wrong resource sentinel'));
  resources[11] = picture(80, 40);
  resources[32] = picture(2400, 360);
  resources[171] = picture(360, 2400);
  resources[172] = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="360" height="2400" viewBox="0 0 360 2400"><image width="360" height="2400" xlink:href="${embed(172)}"/></svg>`);
  const file = path.join(directory, 'images-kf8.azw3');
  fs.writeFileSync(file, pdb([header, text, fdst, ...skeletonIndex(chapters), Buffer.concat([indexHeader(), emptyTags]), ...resources]));
  return { path: file, title: 'KF8 图片验证', format: 'azw3' };
}

module.exports = { picture, makeMobi7, makeKf8 };
