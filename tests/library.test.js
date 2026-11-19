'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { searchBooks, removeBook, removeBooks, removeEntry, removeEntries } = require('../src/shared/library');

test('书架搜索按书名、作者和文件名分词匹配并保留传入的顺序', () => {
  const first = { title: '三體 I', author: '劉慈欣', path: 'D:\\Archive\\Orbit-01.EPUB' };
  const second = { title: '三体 II', author: '刘慈欣', path: '/library/Orbit-02.epub' };
  const third = { title: '银河', author: '刘慈欣', path: '/books/other.txt' };
  const shelf = [second, third, first];
  assert.deepStrictEqual(searchBooks(shelf, ' 三体\t劉慈欣　ＥＰＵＢ '), [second, first]);
  assert.deepStrictEqual(searchBooks(shelf, '三體 oRbIt-01'), [first]);
  assert.deepStrictEqual(searchBooks(shelf, 'archive'), []);
  assert.deepStrictEqual(searchBooks(shelf, '银河 orbit'), []);
  assert.deepStrictEqual(searchBooks(shelf, '三体['), []);
  assert.strictEqual(searchBooks(shelf, ' 　\n'), shelf);
});

test('旧书架条目缺少作者和文件名时仍然可以按书名查找', () => {
  const shelf = [{ title: '貓' }, { title: '' }, { path: '/books/封面.txt' }];
  assert.deepStrictEqual(searchBooks(shelf, '猫'), [shelf[0]]);
  assert.deepStrictEqual(searchBooks(shelf, '封面'), [shelf[2]]);
  assert.deepStrictEqual(searchBooks([], '空书架'), []);
});

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

test('批量移除多本书且不修改原数组', () => {
  const library = [
    { path: '/a.epub' },
    { path: '/b.pdf' },
    { path: '/c.txt' },
    { path: '/d.epub' },
  ];
  const after = removeBooks(library, ['/a.epub', '/c.txt']);
  assert.strictEqual(library.length, 4, '原数组不应被修改');
  assert.deepStrictEqual(after.map((b) => b.path), ['/b.pdf', '/d.epub']);
});

test('批量移除无匹配时返回原数组', () => {
  const library = [{ path: '/a.epub' }];
  assert.strictEqual(removeBooks(library, ['/nope.pdf']), library);
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

test('批量移除 map 多个条目且不修改原对象', () => {
  const map = { '/a.epub': 1, '/b.pdf': 2, '/c.txt': 3 };
  const after = removeEntries(map, ['/a.epub', '/c.txt']);
  assert.strictEqual(map['/a.epub'], 1, '原对象不应被修改');
  assert.deepStrictEqual(Object.keys(after), ['/b.pdf']);
});

test('批量移除无匹配键时返回原对象', () => {
  const map = { '/a.epub': 1 };
  assert.strictEqual(removeEntries(map, ['/nope.pdf']), map);
});
