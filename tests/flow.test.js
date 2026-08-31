'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { ReadingFlow } = require('../src/shared/flow');

test('单文档分页：翻页与边界', () => {
  const flow = new ReadingFlow({ totalChapters: 1, pagesPerChapter: [5], startPage: 0 });
  assert.strictEqual(flow.canNext(), true);
  assert.strictEqual(flow.canPrev(), false);
  flow.next();
  assert.deepStrictEqual({ chapter: flow.chapter, page: flow.page }, { chapter: 0, page: 1 });
  flow.next();
  flow.next();
  flow.next();
  assert.deepStrictEqual({ chapter: flow.chapter, page: flow.page }, { chapter: 0, page: 4 });
  assert.strictEqual(flow.canNext(), false);
  assert.strictEqual(flow.next(), null);
  flow.prev();
  assert.deepStrictEqual({ chapter: flow.chapter, page: flow.page }, { chapter: 0, page: 3 });
});

test('多章节：跨章翻页', () => {
  const flow = new ReadingFlow({ totalChapters: 3, pagesPerChapter: [2, 3, 4], startChapter: 0, startPage: 0 });
  // 第 0 章有 2 页
  flow.next();
  assert.strictEqual(flow.chapter, 0);
  assert.strictEqual(flow.page, 1);
  const r = flow.next();
  assert.strictEqual(flow.chapter, 1);
  assert.strictEqual(flow.page, 0);
  assert.strictEqual(r.crossed, true);
  // 跨章后退
  const back = flow.prev();
  assert.strictEqual(back.crossed, true);
  assert.strictEqual(flow.chapter, 0);
  assert.strictEqual(flow.page, 1);
});

test('多章节：双页 step=2', () => {
  const flow = new ReadingFlow({ totalChapters: 2, pagesPerChapter: [3, 3], startChapter: 0, startPage: 0 });
  flow.next(2);
  assert.strictEqual(flow.chapter, 0);
  assert.strictEqual(flow.page, 2);
  flow.next(2);
  assert.strictEqual(flow.chapter, 1);
  assert.strictEqual(flow.page, 1);
  flow.prev(2);
  assert.strictEqual(flow.chapter, 0);
  assert.strictEqual(flow.page, 2);
});

test('进度计算：单文档与多章节', () => {
  const single = new ReadingFlow({ totalChapters: 1, pagesPerChapter: [4], startPage: 1 });
  assert.strictEqual(single.percent(), 50);
  const multi = new ReadingFlow({ totalChapters: 2, pagesPerChapter: [2, 2], startChapter: 1, startPage: 0 });
  assert.strictEqual(multi.percent(), 50);
});

test('章节未知页数时跨章仍可推进', () => {
  const flow = new ReadingFlow({ totalChapters: 3 });
  assert.strictEqual(flow.canNext(), true);
  const r = flow.next();
  assert.strictEqual(r.chapter, 1);
  assert.strictEqual(r.page, 0);
});
