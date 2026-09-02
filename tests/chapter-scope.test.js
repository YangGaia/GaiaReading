'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { flattenToc, selectChapterScope } = require('../src/shared/chapter-scope');

test('目录扁平化保留阅读顺序并兼容 EPUB 与 MOBI 子目录字段', () => {
  const flat = flattenToc([
    { label: '卷一', children: [{ label: '第一章' }] },
    { label: '卷二', subitems: [{ label: '第二章' }] },
  ]);
  assert.deepStrictEqual(flat.map((entry) => [entry.item.label, entry.depth, entry.order]), [
    ['卷一', 0, 0],
    ['第一章', 1, 1],
    ['卷二', 0, 2],
    ['第二章', 1, 3],
  ]);
});

test('同一底层文档含多个目录章节时只选择当前小章边界', () => {
  const entries = [
    { label: '第一章', containerIndex: 4, startOffset: 0, order: 0 },
    { label: '第二章', containerIndex: 4, startOffset: 800, order: 1 },
    { label: '第三章', containerIndex: 4, startOffset: 1500, order: 2 },
  ];
  const scope = selectChapterScope(entries, 4, 920);
  assert.strictEqual(scope.selected.label, '第二章');
  assert.strictEqual(scope.startOffset, 800);
  assert.strictEqual(scope.endOffset, 1500);
});

test('目录章节跨越多个底层文档时沿用最近目录标题且不扩大到全文', () => {
  const entries = [
    { label: '第一章', containerIndex: 2, startOffset: 0, order: 0 },
    { label: '第二章', containerIndex: 5, startOffset: 0, order: 1 },
  ];
  const scope = selectChapterScope(entries, 3, 300);
  assert.strictEqual(scope.selected.label, '第一章');
  assert.strictEqual(scope.selected.continued, true);
  assert.strictEqual(scope.startOffset, 0);
  assert.strictEqual(scope.endOffset, null);
});
