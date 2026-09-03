'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  STANDARD,
  HIGH,
  normalizeReaderTextContrast,
  readerTextColor,
  readerLinkColor,
  readerTextContrastLabel,
} = require('../src/shared/reader-contrast');

test('文字对比度只接受标准与高对比两档', () => {
  assert.strictEqual(normalizeReaderTextContrast(HIGH), HIGH);
  assert.strictEqual(normalizeReaderTextContrast(STANDARD), STANDARD);
  assert.strictEqual(normalizeReaderTextContrast('unknown'), STANDARD);
  assert.strictEqual(normalizeReaderTextContrast(null), STANDARD);
});

test('高对比文字按主题使用纯黑、棕黑与纯白', () => {
  assert.strictEqual(readerTextColor('light', STANDARD), '#24292f');
  assert.strictEqual(readerTextColor('eye', STANDARD), '#4a3826');
  assert.strictEqual(readerTextColor('dark', STANDARD), '#e6edf3');
  assert.strictEqual(readerTextColor('light', HIGH), '#000000');
  assert.strictEqual(readerTextColor('eye', HIGH), '#1f140c');
  assert.strictEqual(readerTextColor('dark', HIGH), '#ffffff');
  assert.strictEqual(readerLinkColor('light'), '#0645ad');
  assert.strictEqual(readerLinkColor('eye'), '#8a6d3b');
  assert.strictEqual(readerLinkColor('dark'), '#58a6ff');
  assert.strictEqual(readerTextContrastLabel(STANDARD), '标准');
  assert.strictEqual(readerTextContrastLabel(HIGH), '高对比');
});
