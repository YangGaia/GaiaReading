'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeHybrid, makeMobi7 } = require('./fixtures/mobi-image-fixture');
const { openMobi, loadChapter, cleanupMobi, detectKind, sampleMobiText } = require('../src/shared/mobi');
const { fixKf8RawCache } = require('../src/shared/mobi-kf8');

function directoryFor(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-mobi-reading-test-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('混合 MOBI 直接打开 KF8 正文，不提示改扩展名且不改动原书', async context => {
  const directory = directoryFor(context);
  const fixture = makeHybrid(directory);
  const before = fs.readFileSync(fixture.path);
  const warnings = [];
  context.mock.method(console, 'warn', message => warnings.push(message));
  const opened = await openMobi(fixture.path, path.join(directory, 'resources'));
  context.after(() => cleanupMobi(opened));
  assert.equal(detectKind(before), 'kf8');
  assert.equal(opened.kind, 'kf8');
  assert.equal(opened.chapters.length, 4);
  assert.match((await loadChapter(opened, 3, path.join(directory, 'resources'))).html, /阅读位置验证/);
  assert.deepEqual(warnings, []);
  assert.deepEqual(fs.readFileSync(fixture.path), before);
});

test('MOBI7 错标 azw3 时仍按内容解析，EXTH 无效哨兵不判为 KF8', async context => {
  const directory = directoryFor(context);
  const fixture = makeHybrid(directory, { boundary: 0xffffffff });
  assert.equal(detectKind(fs.readFileSync(fixture.path)), 'mobi7');
  const mobi = makeMobi7(directory, '<p>固定字号测试</p>');
  const renamed = path.join(directory, 'legacy.azw3');
  fs.copyFileSync(mobi.path, renamed);
  const opened = await openMobi(renamed, path.join(directory, 'resources'));
  context.after(() => cleanupMobi(opened));
  assert.equal(opened.kind, 'mobi7');
  assert.match((await loadChapter(opened, 0, path.join(directory, 'resources'))).html, /固定字号测试/);
});

test('损坏 EXTH 长度、记录表及 KF8 边界快速拒绝，不进入上游死循环', async context => {
  const directory = directoryFor(context);
  const fixture = makeHybrid(directory);
  const original = fs.readFileSync(fixture.path);
  const offset = original.readUInt32BE(78);
  const mutations = [
    buffer => buffer.writeUInt32BE(0, offset + 296),
    buffer => buffer.writeUInt32BE(0xffffffff, offset + 296),
    buffer => buffer.writeUInt32BE(7, offset + 296),
    buffer => buffer.writeUInt32BE(1, offset + 300),
    buffer => buffer.writeUInt32BE(999999, offset + 300),
    buffer => buffer.writeUInt32BE(0xffffffff, 78),
    buffer => buffer.writeUInt16BE(65535, 76),
    buffer => buffer.writeUInt32BE(0xffffffff, offset + 284),
  ];
  for (const mutate of mutations) {
    const damaged = Buffer.from(original);
    mutate(damaged);
    assert.equal(detectKind(damaged), 'unknown');
    fs.writeFileSync(fixture.path, damaged);
    await assert.rejects(openMobi(fixture.path, path.join(directory, 'resources')), /文件头或记录表损坏/);
  }
});

test('简繁采样只读有限原始文字，不解析图片和样式', async context => {
  const directory = directoryFor(context);
  const fixture = makeHybrid(directory);
  const resources = path.join(directory, 'resources');
  const opened = await openMobi(fixture.path, resources);
  context.after(() => cleanupMobi(opened));
  const before = fs.readdirSync(resources);
  const sample = sampleMobiText(opened);
  assert.ok(sample.length <= 24000);
  assert.match(sample, /阅读位置验证/);
  assert.doesNotMatch(sample, /<img|data:image/);
  assert.equal(opened.book.chapterCache.size, 0);
  assert.deepEqual(fs.readdirSync(resources), before);
});

test('KF8 按记录缓存随机读与顺序读一致，每条记录至多解压一次', () => {
  const chunks = Array.from({ length: 800 }, (_, index) => Buffer.alloc(64 + index % 7, index % 251));
  const entire = Buffer.concat(chunks);
  const loaded = new Set();
  const book = fixKf8RawCache({
    fullRawLength: entire.length, loadRaw() {},
    mobiFile: { palmdocHeader: { numTextRecords: chunks.length }, loadTextBuffer(index) {
      assert.ok(!loaded.has(index));
      loaded.add(index);
      return chunks[index];
    } },
  });
  assert.equal(fixKf8RawCache(book), book);
  for (const [start, end] of [[0, 10], [entire.length - 50, entire.length], [20000, 20200], [100, 150], [10000, 40000], [0, entire.length], [10, 10]]) {
    assert.deepEqual(Buffer.from(book.loadRaw(start, end)), entire.subarray(start, end));
  }
  assert.equal(loaded.size, chunks.length);
  for (const args of [[-1, 3], [2, 1], [0, entire.length + 1], [NaN, 2], [1.5, 2]]) assert.throws(() => book.loadRaw(...args), /范围/);
});

test('KF8 截断或空正文记录终止读取，不循环分配内存', () => {
  for (const data of [new Uint8Array(), new Uint8Array(2)]) {
    const book = fixKf8RawCache({ fullRawLength: 100, loadRaw() {}, mobiFile: {
      palmdocHeader: { numTextRecords: 1 }, loadTextBuffer: () => data,
    } });
    assert.throws(() => book.loadRaw(0, 100), /记录/);
  }
});

test('加载章节仅补齐本章目录锚点，供 AI 小章边界与导航复用', async () => {
  const resolved = [];
  const href = 'kindle:pos:fid:0:off:0';
  const opened = {
    book: {
      loadChapter: () => ({ html: '<p id="part">正文</p>', css: [] }),
      resolveHref: value => { resolved.push(value); return { id: '0', selector: '[id="part"]' }; },
    },
    spine: [{ id: '0' }], mergedKept: [0], mergePred: [], mergeTarget: [-1], newIndexOf: [0],
    rawIndexById: new Map([['0', 0]]), fidToIndex: new Map([[0, 0]]),
    toc: [{ index: 0, href, children: [{ index: 1, href: 'kindle:pos:fid:1:off:0' }] }],
  };
  const chapter = await loadChapter(opened, 0, 'unused');
  assert.deepEqual(resolved, [href]);
  assert.equal(chapter.tocTargets.length, 1);
  assert.equal(chapter.tocTargets[0].selector, '[id="part"]');
  assert.equal(opened.toc[0].selector, '[id="part"]');
});
