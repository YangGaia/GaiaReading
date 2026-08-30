'use strict';

const test = require('node:test');
const assert = require('node:assert');
const iconv = require('iconv-lite');
const { decodeTxt, detectEncoding, titleFromFilename } = require('../src/shared/txt-utils');

test('UTF-8 带 BOM', () => {
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('你好')]);
  const { encoding, text } = decodeTxt(buf);
  assert.strictEqual(encoding, 'utf8');
  assert.strictEqual(text, '你好');
});

test('UTF-8 无 BOM 中文', () => {
  const buf = Buffer.from('电子书阅读', 'utf8');
  const { encoding, text } = decodeTxt(buf);
  assert.strictEqual(encoding, 'utf8');
  assert.strictEqual(text, '电子书阅读');
});

test('GBK 中文（字节恰好也是合法 UTF-8）', () => {
  const buf = iconv.encode('中文测试', 'gbk');
  const { encoding, text } = decodeTxt(buf);
  assert.strictEqual(encoding, 'gbk');
  assert.strictEqual(text, '中文测试');
});

test('UTF-16LE 带 BOM', () => {
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('电子书', 'utf16le')]);
  const { encoding, text } = decodeTxt(buf);
  assert.strictEqual(encoding, 'utf16le');
  assert.strictEqual(text, '电子书');
});

test('英文 UTF-8 文本', () => {
  const { encoding, text } = decodeTxt(Buffer.from('hello world'));
  assert.strictEqual(encoding, 'utf8');
  assert.strictEqual(text, 'hello world');
});

test('文件名去扩展名', () => {
  assert.strictEqual(titleFromFilename('三体.txt'), '三体');
  assert.strictEqual(titleFromFilename('novel.epub'), 'novel');
  assert.strictEqual(titleFromFilename('report.PDF'), 'report');
  assert.strictEqual(detectEncoding(Buffer.from([0xff, 0xfe, 0x00, 0x41])), 'utf16le');
});
