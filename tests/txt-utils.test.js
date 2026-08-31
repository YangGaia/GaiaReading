'use strict';

const test = require('node:test');
const assert = require('node:assert');
const iconv = require('iconv-lite');
const { decodeTxt, detectEncoding, titleFromFilename } = require('../src/shared/txt-utils');
const { paragraphsToHtml } = require('../src/shared/txt-html');

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

test('TXT 无空行时每行单独成段', () => {
  const html = paragraphsToHtml('第一行\n第二行\n第三行');
  assert.strictEqual(html, '<p>第一行</p><p>第二行</p><p>第三行</p>');
});

test('TXT 每段一行的小说样书按行成段', () => {
  const html = paragraphsToHtml('　　第一章\n　　正文第一段。\n　　正文第二段。');
  assert.strictEqual(html, '<p>第一章</p><p>正文第一段。</p><p>正文第二段。</p>');
  assert.ok(!html.includes('<br>'), '无空行样书不应出现段内换行');
});

test('TXT 空行分段且段内换行保留', () => {
  const html = paragraphsToHtml('第一段第一行\n第一段第二行\n\n第二段');
  assert.strictEqual(html, '<p>第一段第一行<br>第一段第二行</p><p>第二段</p>');
});

test('TXT 段落 HTML 转义', () => {
  const html = paragraphsToHtml('甲 & 乙 <x>\n丙 "引号"\n\n丁');
  assert.ok(html.includes('&amp;'), '应转义 &');
  assert.ok(html.includes('&lt;'), '应转义 <');
  assert.ok(html.includes('&quot;'), '应转义引号');
  assert.ok(html.includes('<br>'), '应保留段内换行');
});

test('TXT 空文本与 CRLF 归一化', () => {
  assert.strictEqual(paragraphsToHtml(''), '');
  assert.strictEqual(paragraphsToHtml('  \n\n  '), '');
  const html = paragraphsToHtml('甲\r\n乙\r\n\r\n丙');
  assert.strictEqual(html, '<p>甲<br>乙</p><p>丙</p>');
});