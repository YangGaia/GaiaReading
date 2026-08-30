'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { removeBook, removeEntry } = require('../src/shared/library');

test('按路径移除书籍且不修改原数组', () => {
  const library = [
    { path: '/a.epub', title: 'A' },
    { path: '/b.pdf', title: 'B' },
    { path: '/c.txt', title: 'C' },
  ];
  const after = removeBook(library, '/b.pdf');
  assert.strictEqual(library.length, 3, '原数组不应被修改');
  assert.deepStrictEqual(after.map((b) => b.path), ['/a.epub', '/c.txt']);
});

test('移除不存在的路径返回原数组', () => {
  const library = [{ path: '/a.epub' }];
  assert.strictEqual(removeBook(library, '/nope.pdf'), library);
});

test('按路径移除 map 条目且不修改原对象', () => {
  const map = { '/a.epub': { loc: 'x' }, '/b.pdf': { page: 3 } };
  const after = removeEntry(map, '/a.epub');
  assert.strictEqual(map['/a.epub'].loc, 'x', '原对象不应被修改');
  assert.deepStrictEqual(Object.keys(after), ['/b.pdf']);
});

test('移除不存在的键返回原对象', () => {
  const map = { '/a.epub': 1 };
  assert.strictEqual(removeEntry(map, '/nope.pdf'), map);
});
