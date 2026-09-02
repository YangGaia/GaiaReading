'use strict';

const test = require('node:test');
const assert = require('node:assert');
const JSZip = require('jszip');
const { repairEpubBuffer } = require('../src/shared/epub-repair');

function damageEntryOffset(buffer, targetName) {
  const damaged = Buffer.from(buffer);
  for (let offset = 0; offset <= damaged.length - 46; offset += 1) {
    if (damaged.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = damaged.readUInt16LE(offset + 28);
    const extraLength = damaged.readUInt16LE(offset + 30);
    const commentLength = damaged.readUInt16LE(offset + 32);
    const name = damaged.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name === targetName) {
      damaged.writeUInt32LE(damaged.readUInt32LE(offset + 42) + 2, offset + 42);
      return damaged;
    }
    offset += 45 + nameLength + extraLength + commentLength;
  }
  throw new Error('未找到待损坏的 ZIP 条目');
}

async function makeDamagedEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<container/>');
  zip.file('OEBPS/content.opf', '<package/>');
  zip.file('OEBPS/Styles/fonts.css', '@font-face { font-family: old; src: url(res:///system/fonts/old.ttf); }');
  zip.file('OEBPS/Text/good.xhtml', '<html><body><svg viewBox="0 0 10 10"><img src="cover.jpg" /></svg><p>中文正文</p></body></html>');
  zip.file('OEBPS/Text/bad.xhtml', '<html><body>损坏正文</body></html>');
  const valid = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return damageEntryOffset(valid, 'OEBPS/Text/bad.xhtml');
}

test('损坏单个正文记录时恢复其余 EPUB 内容并生成占位页', async () => {
  const damaged = await makeDamagedEpub();
  await assert.rejects(() => JSZip.loadAsync(damaged));
  const repaired = await repairEpubBuffer(damaged);
  assert.deepStrictEqual(repaired.failures.map((item) => item.fileName), ['OEBPS/Text/bad.xhtml']);
  const zip = await JSZip.loadAsync(repaired.buffer);
  const goodPage = await zip.file('OEBPS/Text/good.xhtml').async('string');
  assert.match(goodPage, /中文正文/);
  assert.doesNotMatch(goodPage, /<svg[^>]*>\s*<img/i, '恢复时应纠正 SVG 中的非法 img 封面结构');
  assert.doesNotMatch(await zip.file('OEBPS/Styles/fonts.css').async('string'), /res:\/\//, '恢复时应移除设备专用字体地址');
  assert.match(await zip.file('OEBPS/Text/bad.xhtml').async('string'), /源 EPUB 中已经损坏/);
});

test('关键 OPF 记录损坏时拒绝伪恢复', async () => {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<container/>');
  zip.file('OEBPS/content.opf', '<package/>');
  const valid = await zip.generateAsync({ type: 'nodebuffer' });
  const damaged = damageEntryOffset(valid, 'OEBPS/content.opf');
  await assert.rejects(() => repairEpubBuffer(damaged), /关键 EPUB 文件损坏/);
});
