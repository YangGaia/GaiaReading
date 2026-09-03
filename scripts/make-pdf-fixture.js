'use strict';

const fs = require('fs');
const path = require('path');

const output = path.join(__dirname, '..', 'tests', 'fixtures', 'sample.pdf');
const pageIds = [3, 5, 7, 9, 11];
const objects = new Map();
objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
objects.set(2, '<< /Type /Pages /Kids [' + pageIds.map((id) => id + ' 0 R').join(' ') + '] /Count 5 >>');
objects.set(13, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

for (let index = 0; index < pageIds.length; index += 1) {
  const pageId = pageIds[index];
  const contentId = pageId + 1;
  const text = 'BT /F1 24 Tf 72 500 Td (PDF TEST PAGE ' + (index + 1) + ') Tj ET';
  objects.set(pageId, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 13 0 R >> >> /Contents ' + contentId + ' 0 R >>');
  objects.set(contentId, '<< /Length ' + Buffer.byteLength(text, 'ascii') + ' >>\nstream\n' + text + '\nendstream');
}

let pdf = '%PDF-1.4\n%Gaia Reading fixture\n';
const offsets = [0];
for (let id = 1; id <= 13; id += 1) {
  offsets[id] = Buffer.byteLength(pdf, 'ascii');
  pdf += id + ' 0 obj\n' + objects.get(id) + '\nendobj\n';
}
const xrefOffset = Buffer.byteLength(pdf, 'ascii');
pdf += 'xref\n0 14\n0000000000 65535 f \n';
for (let id = 1; id <= 13; id += 1) pdf += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
pdf += 'trailer\n<< /Size 14 /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n';

fs.writeFileSync(output, pdf, 'ascii');
console.log(output);
