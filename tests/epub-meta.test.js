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
