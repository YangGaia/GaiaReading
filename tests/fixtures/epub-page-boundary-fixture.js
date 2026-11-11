'use strict';

const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

module.exports = async function makePageBoundaryFixture(directory) {
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(__dirname, 'sample.epub')));
  // Adjacent text nodes share a book-wide offset at the column boundary.
  const paragraphs = Array.from({ length: 9 }, (_, index) => {
    const text = `第 ${index + 1} 页｜沿着原来的段落继续读。`;
    return `<p id="page-${index + 1}"${index ? ' style="break-before:column"' : ''}>${text.repeat(4)}</p>`;
  }).join('');
  zip.file('OEBPS/c1.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>翻页位置验证</title></head><body>${paragraphs}</body></html>`);
  const file = path.join(directory, 'epub-page-boundaries.epub');
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
  return { path: file, title: '翻页位置验证', format: 'epub' };
};
