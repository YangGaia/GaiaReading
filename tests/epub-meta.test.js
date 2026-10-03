'use strict';

const test = require('node:test');
const assert = require('node:assert');
const JSZip = require('jszip');
const { parseEpub } = require('../src/shared/epub-meta');

const COVER = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

async function makeEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n</container>');
  zip.file('OEBPS/content.opf', '<?xml version="1.0"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:title>测试图书</dc:title>\n    <dc:creator>张三</dc:creator>\n    <meta name="cover" content="cover-img"/>\n  </metadata>\n  <manifest>\n    <item id="cover-img" href="images/cover.gif" media-type="image/gif" properties="cover-image"/>\n    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>\n  </manifest>\n  <spine><itemref idref="c1"/></spine>\n</package>');
  zip.file('OEBPS/images/cover.gif', COVER);
  zip.file('OEBPS/c1.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>hello</p></body></html>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('解析 EPUB 元数据与封面', async () => {
  const meta = await parseEpub(await makeEpub());
  assert.strictEqual(meta.title, '测试图书');
  assert.strictEqual(meta.author, '张三');
  assert.ok(meta.cover, '应解析出封面');
  assert.strictEqual(meta.cover.mime, 'image/gif');
  assert.ok(meta.cover.base64.length > 0);
});

test('无 OPF 的 zip 返回空元数据', async () => {
  const zip = new JSZip();
  zip.file('foo.txt', 'hi');
  const meta = await parseEpub(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.strictEqual(meta.title, '');
  assert.strictEqual(meta.cover, null);
});

test('非法数据应抛出异常', async () => {
  await assert.rejects(() => parseEpub(Buffer.from('not a zip')));
});

test('EPUB 省略超过 8 MiB 的压缩封面，同时保留标题作者', async () => {
  const zip = await JSZip.loadAsync(await makeEpub());
  zip.file('OEBPS/images/cover.gif', Buffer.alloc(8 * 1024 * 1024 + 1, 0x61));
  const meta = await parseEpub(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  assert.strictEqual(meta.title, '测试图书');
  assert.strictEqual(meta.author, '张三');
  assert.strictEqual(meta.cover, null);
});

test('EPUB 对容器和 OPF 元数据均限制解压大小', async () => {
  for (const file of ['META-INF/container.xml', 'OEBPS/content.opf']) {
    const zip = await JSZip.loadAsync(await makeEpub());
    zip.file(file, 'x'.repeat(1024 * 1024 + 1));
    const source = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await assert.rejects(parseEpub(source), /超过读取上限/);
  }
});

test('EPUB 无法解码的封面内容可省略', async () => {
  const zip = await JSZip.loadAsync(await makeEpub());
  zip.file('OEBPS/images/cover.gif', 'not an image');
  const meta = await parseEpub(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.strictEqual(meta.title, '测试图书');
  assert.strictEqual(meta.cover, null);
});

test('EPUB 封面支持相对路径及 URL 编码', async () => {
  const zip = await JSZip.loadAsync(await makeEpub());
  const opf = await zip.file('OEBPS/content.opf').async('string');
  zip.file('OEBPS/content.opf', opf.replace('images/cover.gif', '../Images/%E5%B0%81%E9%9D%A2.gif'));
  zip.file('Images/封面.gif', COVER);
  const meta = await parseEpub(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.ok(meta.cover);
  assert.strictEqual(meta.cover.base64, COVER.toString('base64'));
});

test('EPUB 存储封面 CRC 损坏可省略，不把任意 bytes 当作有效图片', async () => {
  const zip = await JSZip.loadAsync(await makeEpub());
  const source = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  const content = source.indexOf(COVER);
  assert.ok(content >= 0);
  source[content + 20] ^= 0xff;
  const meta = await parseEpub(source);
  assert.strictEqual(meta.title, '测试图书');
  assert.strictEqual(meta.cover, null);
});

test('EPUB 自定义 XML 实体不能放大元数据内存', async () => {
  const zip = await JSZip.loadAsync(await makeEpub());
  zip.file('OEBPS/content.opf', '<!DOCTYPE package [<!ENTITY x "big">]><package><metadata><dc:title>&x;</dc:title></metadata></package>');
  await assert.rejects(parseEpub(await zip.generateAsync({ type: 'nodebuffer' })), /自定义 XML 实体/);
});

test('EPUB 坏封面声明尺寸不会使整个 ZIP 元数据索引失败', async () => {
  const zip = await JSZip.loadAsync(await makeEpub());
  const source = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  for (let offset = 0; offset <= source.length - 46; offset += 1) {
    if (source.readUInt32LE(offset) !== 0x02014b50) continue;
    const length = source.readUInt16LE(offset + 28);
    if (source.toString('utf8', offset + 46, offset + 46 + length) === 'OEBPS/images/cover.gif') {
      source.writeUInt32LE(1, offset + 24);
      break;
    }
  }
  const meta = await parseEpub(source);
  assert.strictEqual(meta.title, '测试图书');
  assert.strictEqual(meta.cover, null);
});

test('EPUB 伪造较小解压尺寸的封面仍受实际流量上限约束', async () => {
  const zip = await JSZip.loadAsync(await makeEpub());
  zip.file('OEBPS/images/cover.gif', Buffer.alloc(8 * 1024 * 1024 + 1, 0x61));
  const source = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  for (let offset = 0; offset <= source.length - 46; offset += 1) {
    if (source.readUInt32LE(offset) !== 0x02014b50) continue;
    const length = source.readUInt16LE(offset + 28);
    if (source.toString('utf8', offset + 46, offset + 46 + length) === 'OEBPS/images/cover.gif') {
      source.writeUInt32LE(1, offset + 24);
      break;
    }
  }
  const meta = await parseEpub(source);
  assert.strictEqual(meta.title, '测试图书');
  assert.strictEqual(meta.cover, null);
});

test('EPUB 兼容不包含内部实体的旧版 OPF 文档类型声明', async () => {
  const zip = await JSZip.loadAsync(await makeEpub());
  zip.file('OEBPS/content.opf', '<!DOCTYPE package PUBLIC "+//ISBN 0-9673008-1-9//DTD OEB 1.2 Package//EN" "http://openebook.org/dtds/oeb-1.2/oebpkg12.dtd"><package><metadata><dc:title>旧版 &amp; 图书</dc:title></metadata></package>');
  const meta = await parseEpub(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.strictEqual(meta.title, '旧版 & 图书');
});
