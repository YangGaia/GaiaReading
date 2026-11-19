'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { bookFileStat, inspectBookFile, sameBookFileStat } = require('../src/shared/book-files');
const { relocateBookRecords } = require('../src/shared/book-relocation');

test('文件指纹与文件名无关，可以区分同名、同大小的不同版本', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-relocation-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const original = path.join(dir, '原书.txt');
  const moved = path.join(dir, '改名.txt');
  fs.writeFileSync(original, '第一章');
  const inspected = await inspectBookFile(original);
  fs.renameSync(original, moved);
  assert.equal(await bookFileStat(original), null);
  assert.equal(await bookFileStat(dir), null);
  const renamed = await inspectBookFile(moved);
  assert.equal(renamed.fingerprint, inspected.fingerprint);
  assert.equal(sameBookFileStat(renamed.stat, await bookFileStat(moved)), true);
  fs.writeFileSync(moved, '第二章');
  const changed = await inspectBookFile(moved);
  assert.equal(changed.stat.size, renamed.stat.size);
  assert.notEqual(changed.fingerprint, renamed.fingerprint);
});

test('重新定位同时迁移进度、书签、划线笔记和按书统计', () => {
  const oldPath = 'old/book.epub';
  const newPath = 'new/renamed.epub';
  const original = { path: oldPath, format: 'epub', title: '原书', cover: 'old-cover' };
  const other = { path: 'other.epub' };
  const progress = { percent: 45, loc: 'epubcfi(/6/4!/4/2/1:3)', settings: { fontSize: 120 }, updatedAt: 123 };
  const bookmarks = [{ id: 'ribbon', loc: progress.loc }];
  const annotations = [{ id: 'note', note: '笔记', quote: '正文', anchor: { cfi: progress.loc } }];
  const day = { ms: 350, byBook: { [oldPath]: 250, [other.path]: 100 }, lastReadAt: 456 };
  const finished = { path: oldPath, title: original.title, cover: original.cover, finishedAt: 456 };
  const data = {
    library: [original, other],
    progress: { [oldPath]: progress, [other.path]: { percent: 3 } },
    bookmarks: { [oldPath]: bookmarks },
    annotations: { [oldPath]: annotations },
    readingStats: { goalMinutes: 45, days: { today: day }, completedBooks: { [oldPath]: finished } },
    prefs: { theme: 'night' },
  };
  const snapshot = structuredClone(data);
  const { book, updated } = relocateBookRecords(data, oldPath, newPath, 'new-fingerprint');
  assert.deepEqual(book, { ...original, path: newPath, fingerprint: 'new-fingerprint' });
  assert.deepEqual(updated.library, [book, other]);
  assert.deepEqual(updated.progress, { [newPath]: progress, [other.path]: { percent: 3 } });
  assert.deepEqual(updated.bookmarks, { [newPath]: bookmarks });
  assert.deepEqual(updated.annotations, { [newPath]: annotations });
  assert.deepEqual(updated.readingStats, {
    goalMinutes: 45,
    days: { today: { ...day, byBook: { [newPath]: 250, [other.path]: 100 } } },
    completedBooks: { [newPath]: { ...finished, path: newPath } },
  });
  assert.equal(Object.hasOwn(updated, 'prefs'), false);
  assert.deepEqual(data, snapshot);
});

test('已有书籍或遗留阅读记录占用新路径时保留双方数据', () => {
  const oldPath = 'old/book.txt';
  const newPath = 'new/BOOK.txt';
  const original = { path: oldPath };
  assert.throws(() => relocateBookRecords({ library: [] }, oldPath, newPath, 'hash'), /已从书架移除/);
  assert.throws(() => relocateBookRecords({ library: [original, { path: 'NEW/book.txt' }] }, oldPath, newPath, 'hash'), /已在书架/);
  const data = { library: [original], annotations: { 'new/book.txt': [{ id: 'keep' }] } };
  assert.throws(() => relocateBookRecords(data, oldPath, newPath, 'hash'), /已有阅读记录/);
  assert.deepEqual(data.annotations, { 'new/book.txt': [{ id: 'keep' }] });
  assert.deepEqual(relocateBookRecords({ library: [original] }, oldPath, newPath, 'hash').updated, {
    library: [{ path: newPath, fingerprint: 'hash' }],
  });
});
