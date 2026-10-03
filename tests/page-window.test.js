'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pageWindow } = require('../src/shared/page-window');
test('chapterless context includes four previous and seven following pages', () => {
  assert.deepEqual(pageWindow(15, 100), { startPage: 11, endPage: 22, currentPage: 15, totalPages: 100 });
});
test('book boundaries clip the window without including distant pages', () => {
  assert.deepEqual(pageWindow(0, 100), { startPage: 0, endPage: 7, currentPage: 0, totalPages: 100 });
  assert.deepEqual(pageWindow(99, 100), { startPage: 95, endPage: 99, currentPage: 99, totalPages: 100 });
  assert.deepEqual(pageWindow(0, 1), { startPage: 0, endPage: 0, currentPage: 0, totalPages: 1 });
});
