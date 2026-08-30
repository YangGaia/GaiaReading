'use strict';

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const COVER = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

async function makeFixture() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n</container>');
  zip.file('OEBPS/content.opf', '<?xml version="1.0"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">\n    <dc:identifier id="uid">urn:uuid:test-0001</dc:identifier>\n    <dc:title>测试图书</dc:title>\n    <dc:creator>测试作者</dc:creator>\n    <dc:language>zh-CN</dc:language>\n    <meta name="cover" content="cover-img"/>\n  </metadata>\n  <manifest>\n    <item id="cover-img" href="images/cover.gif" media-type="image/gif" properties="cover-image"/>\n    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>\n    <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>\n  </manifest>\n  <spine>\n    <itemref idref="c1"/>\n    <itemref idref="c2"/>\n  </spine>\n</package>');
  zip.file('OEBPS/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><h1>目录</h1><ol><li><a href="c1.xhtml">第一章</a></li><li><a href="c2.xhtml">第二章</a></li></ol></nav></body></html>');
  zip.file('OEBPS/c1.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body><h1>第一章</h1><p>这是第一段测试内容，用于验证 EPUB 能否正常打开和翻页。</p><p>电子书阅读器 Demo 版本。</p></body></html>');
  zip.file('OEBPS/c2.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head><body><h1>第二章</h1><p>这是第二段测试内容，用于验证翻页和进度记录。</p></body></html>');
  zip.file('OEBPS/images/cover.gif', COVER);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const out = path.join(__dirname, '..', 'tests', 'fixtures', 'sample.epub');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log('已生成 ' + out + ' (' + buf.length + ' bytes)');
}

makeFixture().catch((err) => {
  console.error(err);
  process.exit(1);
});
