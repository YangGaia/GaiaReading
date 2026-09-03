'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  STANDARD,
  HIGH,
  normalizeReaderTextContrast,
  darkReaderTextColor,
  readerTextContrastLabel,
} = require('../src/shared/reader-contrast');

test('夜间文字对比度只接受标准与高对比两档', () => {
  assert.strictEqual(normalizeReaderTextContrast(HIGH), HIGH);
  assert.strictEqual(normalizeReaderTextContrast(STANDARD), STANDARD);
  assert.strictEqual(normalizeReaderTextContrast('unknown'), STANDARD);
  assert.strictEqual(normalizeReaderTextContrast(null), STANDARD);
});

test('高对比夜间文字使用纯白并提供明确标签', () => {
  assert.strictEqual(darkReaderTextColor(STANDARD), '#e6edf3');
  assert.strictEqual(darkReaderTextColor(HIGH), '#ffffff');
  assert.strictEqual(readerTextContrastLabel(STANDARD), '标准灰白');
  assert.strictEqual(readerTextContrastLabel(HIGH), '高对比白');
});
