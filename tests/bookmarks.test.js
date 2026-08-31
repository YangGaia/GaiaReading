'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { addBookmark, removeBookmark, findBookmarkIndex, renameBookmark, bookmarkName } = require('../src/shared/bookmarks');

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

test('重命名书签', () => {
  let map = addBookmark({}, '/a.epub', { name: '书签 1', label: '书签 1', loc: 'l1' });
  map = addBookmark(map, '/a.epub', { name: '书签 2', label: '书签 2', loc: 'l2' });
  const after = renameBookmark(map, '/a.epub', 0, '最喜欢的段落');
  assert.strictEqual(after['/a.epub'][0].name, '最喜欢的段落');
  assert.strictEqual(after['/a.epub'][0].loc, 'l1', '重命名不应改定位');
  assert.strictEqual(map['/a.epub'][0].name, '书签 1', '原对象不应被修改');
  assert.strictEqual(after['/a.epub'][1].name, '书签 2');
});

test('重命名越界或空名字不改数据', () => {
  let map = addBookmark({}, '/a.epub', { name: 'x', label: 'x', loc: 'l1' });
  assert.strictEqual(renameBookmark(map, '/a.epub', 5, 'y'), map);
  assert.strictEqual(renameBookmark(map, '/a.epub', 0, '   '), map);
  assert.strictEqual(renameBookmark(map, '/a.epub', 0, ''), map);
  assert.strictEqual(map['/a.epub'][0].name, 'x');
});

test('bookmarkName 回退顺序', () => {
  assert.strictEqual(bookmarkName({ name: 'a', label: 'b' }, 2), 'a');
  assert.strictEqual(bookmarkName({ label: 'b' }, 2), 'b');
  assert.strictEqual(bookmarkName({}, 2), '书签 3');
});