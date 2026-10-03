'use strict';

// Original, generated test text only. All output lives in the caller's sandbox.
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');
const { createKf8Fixture } = require('./kf8-book-fixture');
const marker = (kind, page) => 'PAGE_' + kind + '_' + String(page).padStart(2, '0') + '_END';

function writePdf(file) {
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const children = Array.from({ length: 20 }, (_, page) => (4 + page * 2) + ' 0 R').join(' ');
  objects[2] = '<< /Type /Pages /Count 20 /Kids [' + children + '] >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  for (let page = 0; page < 20; page++) {
    const index = 4 + page * 2;
    const stream = 'BT /F1 16 Tf 30 350 Td (' + marker('PDF', page) + ') Tj ET\n';
    objects[index] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (index + 1) + ' 0 R >>';
    objects[index + 1] = '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + 'endstream';
  }
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 1; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(body));
    body += index + ' 0 obj\n' + objects[index] + '\nendobj\n';
  }
  const start = Buffer.byteLength(body);
  body += 'xref\n0 ' + objects.length + '\n0000000000 65535 f \n';
  body += offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
  body += 'trailer\n<< /Size ' + objects.length + ' /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n';
  fs.writeFileSync(file, body);
}

function writeMobi(file) {
  const title = 'Continuous synthetic text';
  const paragraphs = Array.from({ length: 24 }, (_, page) => '<p style="break-after:' + (page === 23 ? 'auto' : 'column') + '">' + marker('MOBI', page) + ' Traditional text 繁體閱讀。</p>').join('');
  const source = Buffer.from('<html><head><title>' + title + '</title></head><body>' + paragraphs + '</body></html>');
  const records = [];
  for (let offset = 0; offset < source.length; offset += 4096) records.push(source.subarray(offset, offset + 4096));
  const header = Buffer.alloc(248);
  const exth = Buffer.alloc(12);
  exth.write('EXTH');
  exth.writeUInt32BE(12, 4);
  header.writeUInt16BE(1, 0);
  header.writeUInt32BE(source.length, 4);
  header.writeUInt16BE(records.length, 8);
  header.writeUInt16BE(4096, 10);
  header.write('MOBI', 16);
  header.writeUInt32BE(232, 20);
  header.writeUInt32BE(2, 24);
  header.writeUInt32BE(65001, 28);
  header.writeUInt32BE(0x47414941, 32);
  header.writeUInt32BE(6, 36);
  header.writeUInt32BE(header.length + exth.length, 84);
  header.writeUInt32BE(Buffer.byteLength(title), 88);
  header[95] = 9;
  header.writeUInt32BE(records.length + 1, 108);
  header.writeUInt32BE(0x40, 128);
  header.writeUInt32BE(0xffffffff, 244);
  records.unshift(Buffer.concat([header, exth, Buffer.from(title)]));
  const palm = Buffer.alloc(78 + records.length * 8 + 2);
  palm.write('Gaia AI page window fixture');
  palm.write('BOOKMOBI', 60);
  palm.writeUInt16BE(records.length, 76);
  let offset = palm.length;
  records.forEach((record, index) => {
    palm.writeUInt32BE(offset, 78 + index * 8);
    palm.writeUInt32BE(index + 1, 82 + index * 8);
    offset += record.length;
  });
  fs.writeFileSync(file, Buffer.concat([palm, ...records]));
}

async function createAiPageWindowFixtures(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const books = {};
  const makeBook = (format, name) => ({ path: path.join(directory, name + '.' + format), format, title: name });
  books.txt = makeBook('txt', 'continuous-pages');
  fs.writeFileSync(books.txt.path, Array.from({ length: 320 }, (_, index) => '记录' + index + '：' + '月光落在書頁上，繁體閱讀保持文字與位置，不應把整本小說都送出去。'.repeat(8)).join('\n\n'));
  books.epub = makeBook('epub', 'continuous-spine-pages');
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">gaia-ai-window</dc:identifier><dc:title>Continuous text without chapters</dc:title><dc:language>zh-CN</dc:language></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' + Array.from({ length: 4 }, (_, index) => '<item id="s' + index + '" href="s' + index + '.xhtml" media-type="application/xhtml+xml"/>').join('') + '</manifest><spine toc="ncx">' + Array.from({ length: 4 }, (_, index) => '<itemref idref="s' + index + '"/>').join('') + '</spine></package>');
  zip.file('OEBPS/toc.ncx', '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>Continuous text</text></docTitle><navMap/></ncx>');
  for (let section = 0; section < 4; section++) {
    const paragraphs = Array.from({ length: 6 }, (_, offset) => {
      const page = section * 6 + offset;
      return '<p id="page' + page + '" style="break-after:' + (offset === 5 ? 'auto' : 'column') + '">' + marker('EPUB', page) + ' 繁體閱讀連續正文。</p>';
    }).join('');
    zip.file('OEBPS/s' + section + '.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Continuous text</title></head><body>' + paragraphs + '</body></html>');
  }
  fs.writeFileSync(books.epub.path, await zip.generateAsync({ type: 'nodebuffer' }));
  books.pdf = makeBook('pdf', 'twenty-text-pages');
  writePdf(books.pdf.path);
  books.mobi = makeBook('mobi', 'continuous-mobi-pages');
  writeMobi(books.mobi.path);
  books.azw3 = createKf8Fixture(directory);
  return books;
}

module.exports = { createAiPageWindowFixtures, marker };
