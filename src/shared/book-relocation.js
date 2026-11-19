'use strict';

const path = require('node:path');
const { pathKey } = require('./book-import');

const READING_MAPS = ['progress', 'bookmarks', 'annotations'];

function rekey(map, oldPath, newPath, update = (value) => value) {
  if (!map || !Object.hasOwn(map, oldPath)) return map;
  const next = { ...map, [newPath]: update(map[oldPath]) };
  delete next[oldPath];
  return next;
}

function assertRelocationTarget(data, newPath) {
  const target = pathKey(path.resolve(newPath));
  const isTarget = (item) => pathKey(path.resolve(item)) === target;
  if (data.library?.some((book) => isTarget(book.path))) {
    throw new Error('所选文件已在书架上，请选择原书的新位置。');
  }
  const stats = data.readingStats;
  const maps = READING_MAPS.map((key) => data[key]);
  if (stats) maps.push(stats.completedBooks, ...Object.values(stats.days || {}).map((day) => day?.byBook));
  if (maps.some((map) => map && Object.keys(map).some(isTarget))) {
    throw new Error('所选位置已有阅读记录。为保留两份记录，请将原书移到其他位置后再试。');
  }
}

function relocateBookRecords(data, oldPath, newPath, fingerprint) {
  const source = data.library?.find((book) => book.path === oldPath);
  if (!source) throw new Error('这本书已从书架移除。');
  assertRelocationTarget(data, newPath);
  const book = { ...source, path: newPath, fingerprint };
  const updated = { library: data.library.map((item) => item === source ? book : item) };
  for (const key of READING_MAPS) {
    if (data[key]) updated[key] = rekey(data[key], oldPath, newPath);
  }
  if (data.readingStats) {
    const stats = data.readingStats;
    const days = Object.fromEntries(Object.entries(stats.days || {}).map(([date, day]) => {
      const byBook = rekey(day?.byBook, oldPath, newPath);
      return [date, byBook !== day?.byBook ? { ...day, byBook } : day];
    }));
    const completedBooks = rekey(stats.completedBooks, oldPath, newPath, (entry) => ({ ...entry, path: newPath }));
    updated.readingStats = { ...stats, days, completedBooks };
  }
  return { book, updated };
}

module.exports = { assertRelocationTarget, relocateBookRecords };
