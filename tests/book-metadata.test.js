'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { metaFor, MAX_COMPRESSED_BOOK_BYTES } = require('../src/shared/book-metadata');
const { readMobiMetadata, detectKind } = require('../src/shared/mobi');

const COVER = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function temporaryDirectory(t) {
  const root = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(root, 'gaia-metadata-test-'));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(directory)), root);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function number(value) { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; }
function exthRecord(id, value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return Buffer.concat([number(id), number(data.length + 8), data]);
}

function mobiHeader({ version = 6, title = '头部书名', authors = ['张三 &amp; 李四', '王五'], resourceStart = 2, boundary, encoding = 65001, coverOffset = 0 } = {}) {
  const records = [...authors.map((author) => exthRecord(100, author)), exthRecord(503, title), exthRecord(201, number(coverOffset))];
  if (boundary != null) records.push(exthRecord(121, number(boundary)));
  const values = Buffer.concat(records);
  const exth = Buffer.concat([Buffer.from('EXTH'), number(values.length + 12), number(records.length), values]);
  const titleBytes = Buffer.isBuffer(title) ? title : Buffer.from(title, 'utf8');
  const header = Buffer.alloc(248);
  header.writeUInt16BE(17480, 0); // HUFF/CDIC 正文故意不提供字典，元数据路径不得解压它。
  header.write('MOBI', 16, 'ascii');
  header.writeUInt32BE(232, 20);
  header.writeUInt32BE(encoding, 28);
  header.writeUInt32BE(version, 36);
  header.writeUInt32BE(header.length + exth.length, 84);
  header.writeUInt32BE(titleBytes.length, 88);
  header.writeUInt32BE(resourceStart, 108);
  header.writeUInt32BE(0x40, 128);
  return Buffer.concat([header, exth, titleBytes]);
}

function mobiFile(records) {
  const header = Buffer.alloc(78 + records.length * 8 + 2);
  header.write('BOOKMOBI', 60, 'ascii');
  header.writeUInt16BE(records.length, 76);
  let offset = header.length;
  records.forEach((record, index) => { header.writeUInt32BE(offset, 78 + index * 8); offset += record.length; });
  return Buffer.concat([header, ...records]);
}

async function epubFile({ cover = COVER, largeBody = false } = {}) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', '<package><metadata><dc:title>恢复与导入</dc:title><dc:creator>测试作者</dc:creator></metadata><manifest><item id="cover" href="cover.gif" properties="cover-image"/></manifest></package>');
  zip.file('OEBPS/cover.gif', cover);
  zip.file('OEBPS/good.xhtml', '<html><body>正常正文</body></html>');
  zip.file('OEBPS/bad.xhtml', '<html><body>将被损坏的正文</body></html>');
  if (largeBody) zip.file('OEBPS/large.xhtml', 'x'.repeat(33 * 1024 * 1024));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function damageOffset(buffer, name) {
  const data = Buffer.from(buffer);
  for (let offset = 0; offset <= data.length - 46; offset += 1) {
    if (data.readUInt32LE(offset) !== 0x02014b50) continue;
    const length = data.readUInt16LE(offset + 28);
    if (data.toString('utf8', offset + 46, offset + 46 + length) === name) {
      data.writeUInt32LE(data.readUInt32LE(offset + 42) + 2, offset + 42);
      return data;
    }
  }
  throw new Error('没有待损坏的 ZIP 条目');
}

test('TXT/PDF 及超过 512 MiB 的压缩书籍只取文件名，不读取内容或生成临时文件', async (t) => {
  const directory = temporaryDirectory(t);
  const extensions = ['txt', 'pdf', 'EPUB', 'mobi', 'azw3'];
  for (const extension of extensions) fs.writeFileSync(path.join(directory, '文件名.' + extension), 'unused');
  const stat = fs.promises.stat.bind(fs.promises);
  t.mock.method(fs.promises, 'stat', async (file) => {
    const info = await stat(file);
    info.size = MAX_COMPRESSED_BOOK_BYTES + 1;
    return info;
  });
  t.mock.method(fs.promises, 'readFile', async () => { throw new Error('不应该读取全书'); });
  t.mock.method(fs.promises, 'open', async () => { throw new Error('不应该打开正文'); });
  for (const extension of extensions) {
    const file = path.join(directory, '文件名.' + extension);
    assert.deepEqual(await metaFor(file, { temporaryRoot: directory }), {
      path: file, format: extension.toLowerCase(), title: '文件名', author: '', cover: null, recovered: false, recoveredEntries: [],
    });
  }
  assert.equal(fs.readdirSync(directory).length, extensions.length);
});

test('MOBI7 和 KF8 的书架元数据跳过正文、目录和资源落盘，封面索引零有效', async (t) => {
  const directory = temporaryDirectory(t);
  const files = [
    ['mobi7.mobi', mobiHeader()],
    ['kindle.azw3', mobiHeader({ version: 8 })],
  ];
  const text = Buffer.alloc(2 * 1024 * 1024, 0xff);
  const reads = [];
  const open = fs.promises.open.bind(fs.promises);
  t.mock.method(fs.promises, 'open', async (...args) => {
    const handle = await open(...args);
    return { stat: () => handle.stat(), close: () => handle.close(), read: (...values) => {
      reads.push({ length: values[2], offset: values[3] });
      return handle.read(...values);
    } };
  });
  for (const [name, header] of files) {
    const file = path.join(directory, name);
    const data = mobiFile([header, text, COVER]);
    fs.writeFileSync(file, data);
    reads.length = 0;
    const result = await metaFor(file, { temporaryRoot: directory });
    assert.equal(result.title, '头部书名');
    assert.equal(result.author, '张三 & 李四、王五');
    assert.equal(result.cover, 'data:image/gif;base64,' + COVER.toString('base64'));
    assert.equal(result.recovered, false);
    const bodyStart = data.readUInt32BE(86);
    const bodyEnd = bodyStart + text.length;
    assert.ok(reads.every(({ offset, length }) => offset + length <= bodyStart || offset >= bodyEnd), '任何读取都不能接触正文记录');
    assert.ok(reads.reduce((sum, read) => sum + read.length, 0) < 4096);
  }
  assert.equal(fs.readdirSync(directory).length, files.length);
});

test('MOBI/KF8 组合书采用 KF8 元数据和 MOBI7 共用封面资源表', async (t) => {
  const directory = temporaryDirectory(t);
  const file = path.join(directory, 'combined.mobi');
  fs.writeFileSync(file, mobiFile([
    mobiHeader({ title: '旧标题', boundary: 3 }), Buffer.from('invalid-body'), COVER,
    mobiHeader({ version: 8, title: '新版组合合集', authors: ['新作者'], resourceStart: 0xffffffff }),
  ]));
  assert.deepEqual(await readMobiMetadata(file), { title: '新版组合合集', author: '新作者', cover: 'data:image/gif;base64,' + COVER.toString('base64') });
});

test('MOBI Windows-1252 书名作者正常解码，损坏封面不影响导入', async (t) => {
  const directory = temporaryDirectory(t);
  const file = path.join(directory, 'legacy.mobi');
  fs.writeFileSync(file, mobiFile([
    mobiHeader({ title: Buffer.from([0x43, 0x61, 0x66, 0xe9]), authors: [Buffer.from([0x41, 0x6e, 0x64, 0x72, 0xe9])], encoding: 1252 }),
    Buffer.from('invalid-body'), Buffer.from('broken-cover'),
  ]));
  assert.deepEqual(await readMobiMetadata(file), { title: 'Café', author: 'André', cover: null });
});

test('MOBI 超大封面不读取，EXTH 零长度条目不会死循环', async (t) => {
  const directory = temporaryDirectory(t);
  const file = path.join(directory, 'large.mobi');
  const record = mobiHeader();
  fs.writeFileSync(file, mobiFile([record, Buffer.from('body'), Buffer.alloc(8 * 1024 * 1024 + 1)]));
  assert.equal((await readMobiMetadata(file)).cover, null);
  const invalid = Buffer.from(record);
  invalid.writeUInt32BE(0, 248 + 12 + 4);
  const broken = mobiFile([invalid, Buffer.from('body'), COVER]);
  fs.writeFileSync(file, broken);
  await assert.rejects(readMobiMetadata(file), /EXTH 条目长度无效/);
  assert.equal(detectKind(broken), 'mobi7');
  assert.equal((await metaFor(file)).title, 'large');
});

test('EPUB 正常元数据和坏正文恢复保留统一结果结构', async (t) => {
  const directory = temporaryDirectory(t);
  const file = path.join(directory, 'recover.epub');
  const original = await epubFile();
  fs.writeFileSync(file, original);
  assert.equal((await metaFor(file)).recovered, false);
  const damaged = damageOffset(original, 'OEBPS/bad.xhtml');
  fs.writeFileSync(file, damaged);
  const result = await metaFor(file);
  assert.equal(result.title, '恢复与导入');
  assert.equal(result.author, '测试作者');
  assert.equal(result.recovered, true);
  assert.deepEqual(result.recoveredEntries, ['OEBPS/bad.xhtml']);
  assert.deepEqual(fs.readFileSync(file), damaged, '恢复不能改写源书');
});

test('EPUB 坏封面省略且不展开损坏正文进行全书修复', async (t) => {
  const directory = temporaryDirectory(t);
  const file = path.join(directory, 'cover.epub');
  const original = await epubFile();
  const damaged = damageOffset(damageOffset(original, 'OEBPS/cover.gif'), 'OEBPS/bad.xhtml');
  fs.writeFileSync(file, damaged);
  t.mock.method(fs.promises, 'readFile', async () => { throw new Error('坏封面不得触发读入全书'); });
  const result = await metaFor(file);
  assert.equal(result.title, '恢复与导入');
  assert.equal(result.cover, null);
  assert.equal(result.recovered, false);
});

test('EPUB 自动修复先限制解压预算，拒绝展开过大条目', async (t) => {
  const directory = temporaryDirectory(t);
  const file = path.join(directory, 'budget.epub');
  fs.writeFileSync(file, damageOffset(await epubFile({ largeBody: true }), 'OEBPS/bad.xhtml'));
  await assert.rejects(metaFor(file), /超过自动修复上限/);
});

test('不存在的文件及文件夹不能被伪装成成功导入', async (t) => {
  const directory = temporaryDirectory(t);
  await assert.rejects(metaFor(path.join(directory, 'missing.txt')), /ENOENT/);
  const folder = path.join(directory, 'folder.epub');
  fs.mkdirSync(folder);
  await assert.rejects(metaFor(folder), /不是文件/);
});
