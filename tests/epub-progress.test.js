'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { epubDisplayPercent } = require('../src/shared/epub-progress');

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