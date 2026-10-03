'use strict';

const patched = new WeakSet();

function fixKf8RawCache(book) {
  if (!book || typeof book.loadRaw !== 'function' || patched.has(book)) return book;
  const recordCount = book.mobiFile.palmdocHeader.numTextRecords;
  const fullLength = book.fullRawLength;
  const records = new Map();
  const head = [];
  const tail = [];
  let headEnd = 0;
  let tailStart = fullLength;

  function readRecord(index) {
    if (!Number.isInteger(index) || index < 0 || index >= recordCount) throw new Error('KF8 正文记录不完整');
    if (!records.has(index)) {
      const data = book.mobiFile.loadTextBuffer(index);
      if (!data || !data.length) throw new Error('KF8 正文记录为空或已损坏');
      records.set(index, data);
    }
    return records.get(index);
  }

  book.loadRaw = function (start, end) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > fullLength) {
      throw new Error('KF8 正文位置超出有效范围');
    }
    if (start === end) return new Uint8Array();
    const fromHead = Math.max(0, end - headEnd) <= Math.max(0, tailStart - start);
    if (fromHead) {
      while (headEnd < end) {
        const data = readRecord(head.length);
        head.push({ start: headEnd, end: headEnd + data.length, data });
        headEnd += data.length;
      }
    } else {
      while (tailStart > start) {
        const data = readRecord(recordCount - 1 - tail.length);
        tail.push({ start: tailStart - data.length, end: tailStart, data });
        tailStart -= data.length;
      }
    }
    const chunks = fromHead ? head : tail;
    const at = index => chunks[fromHead ? index : chunks.length - 1 - index];
    let low = 0;
    let high = chunks.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (at(middle).end <= start) low = middle + 1;
      else high = middle;
    }
    const result = new Uint8Array(end - start);
    for (let index = low; index < chunks.length; index++) {
      const chunk = at(index);
      if (chunk.start >= end) break;
      const begin = Math.max(start, chunk.start);
      const finish = Math.min(end, chunk.end);
      result.set(chunk.data.subarray(begin - chunk.start, finish - chunk.start), begin - start);
    }
    return result;
  };
  patched.add(book);
  return book;
}

module.exports = { fixKf8RawCache };
