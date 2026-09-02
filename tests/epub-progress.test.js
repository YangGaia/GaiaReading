'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { epubDisplayPercent, normalizeEpubHref, epubHrefsMatch, findEpubNavLabel, resolveEpubTocTarget } = require('../src/shared/epub-progress');

test('位置索引可用时按书内位置计算', () => {
  const loc = { start: { location: 5, cfi: 'x' } };
  assert.strictEqual(epubDisplayPercent(loc, [1, 2, 3], 100), 5);
});

test('位置索引 0 与末尾', () => {
  assert.strictEqual(epubDisplayPercent({ start: { location: 0 } }, [], 100), 0);
  assert.strictEqual(epubDisplayPercent({ start: { location: 100 } }, [], 100), 100);
});

test('位置索引不可用(total=0)时回退章节+章内页码', () => {
  const spine = [{}, {}, {}];
  assert.strictEqual(epubDisplayPercent({ start: { index: 0, displayed: { page: 1, total: 10 } } }, spine, 0), 0);
  const mid = epubDisplayPercent({ start: { index: 1, displayed: { page: 6, total: 10 } } }, spine, 0);
  assert.strictEqual(mid, 50);
});

test('单章节无位置索引按页码', () => {
  assert.strictEqual(epubDisplayPercent({ start: { displayed: { page: 1, total: 20 } } }, [], 0), 0);
  assert.strictEqual(epubDisplayPercent({ start: { displayed: { page: 11, total: 20 } } }, [], 0), 50);
});

test('缺省数据返回 0', () => {
  assert.strictEqual(epubDisplayPercent(null, [], 0), 0);
  assert.strictEqual(epubDisplayPercent({}, [], 0), 0);
});

test('EPUB 章节标题按资源路径精确匹配并忽略锚点', () => {
  const toc = [
    { href: 'Text/chapter1.xhtml#start', label: '第一章' },
    { href: 'Text/chapter10.xhtml#start', label: '第十章' },
  ];
  assert.strictEqual(normalizeEpubHref('./Text/%E7%AB%A0.xhtml#part'), 'text/章.xhtml');
  assert.strictEqual(epubHrefsMatch('OEBPS/Text/chapter10.xhtml', 'Text/chapter10.xhtml#middle'), true);
  assert.strictEqual(epubHrefsMatch('Text/chapter1.xhtml', 'Text/chapter10.xhtml'), false);
  assert.strictEqual(findEpubNavLabel(toc, 'Text/chapter10.xhtml'), '第十章');
});

test('EPUB 目录链接会解析为 spine 中可跳转的真实路径', () => {
  const spine = [
    { idref: 'chapter-1', href: 'OEBPS/Text/chapter1.xhtml' },
    { idref: 'chapter-2', href: 'OEBPS/Text/%E7%AB%A0%E8%8A%82.xhtml' },
  ];
  assert.strictEqual(resolveEpubTocTarget(spine, 'Text/chapter1.xhtml#start'), '#chapter-1');
  assert.strictEqual(resolveEpubTocTarget(spine, './Text/章节.xhtml#part'), 'OEBPS/Text/%E7%AB%A0%E8%8A%82.xhtml#part');
  assert.strictEqual(resolveEpubTocTarget(spine, 'Text/章节.xhtml'), '#chapter-2');
  assert.strictEqual(resolveEpubTocTarget(spine, 'missing.xhtml'), 'missing.xhtml');
  assert.strictEqual(resolveEpubTocTarget(spine, ''), '');
});
