'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { addBookmark, removeBookmark, findBookmarkIndex } = require('../src/shared/bookmarks');

test('添加书签', () => {
  const map = {};
  const next = addBookmark(map, '/a.epub', { label: '书签 1', loc: 'epubcfi(/6/4)' });
  assert.strictEqual(map['/a.epub'], undefined, '原对象不应被修改');
  assert.strictEqual(next['/a.epub'].length, 1);
  assert.strictEqual(findBookmarkIndex(next, '/a.epub', 'epubcfi(/6/4)'), 0);
});

test('删除书签', () => {
  let map = {};
  map = addBookmark(map, '/a.epub', { label: '书签 1', loc: 'l1' });
  map = addBookmark(map, '/a.epub', { label: '书签 2', loc: 'l2' });
  const after = removeBookmark(map, '/a.epub', 0);
  assert.strictEqual(after['/a.epub'].length, 1);
  assert.strictEqual(after['/a.epub'][0].loc, 'l2');
  assert.strictEqual(map['/a.epub'].length, 2, '原对象不应被修改');
});

test('删除最后一个书签后清理该书的键', () => {
  let map = addBookmark({}, '/a.epub', { label: 'x', loc: 'l1' });
  map = removeBookmark(map, '/a.epub', 0);
  assert.strictEqual(map['/a.epub'], undefined);
});

test('越界索引删除不改变原数据', () => {
  let map = addBookmark({}, '/a.epub', { label: 'x', loc: 'l1' });
  const after = removeBookmark(map, '/a.epub', 5);
  assert.strictEqual(after, map);
});
