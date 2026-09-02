'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeLookupText,
  dictionaryUrl,
  searchUrl,
  isAllowedDictionaryUrl,
} = require('../src/shared/lookup');

test('词典与搜索查询会清理长度并安全编码', () => {
  assert.strictEqual(normalizeLookupText('  山  茶  '), '山 茶');
  assert.strictEqual(dictionaryUrl('踌躇'), 'https://www.zdic.net/hans/%E8%B8%8C%E8%BA%87');
  assert.strictEqual(searchUrl('A&B'), 'https://www.baidu.com/s?wd=A%26B');
  assert.strictEqual(Array.from(normalizeLookupText('字'.repeat(100), 80)).length, 80);
  assert.throws(() => normalizeLookupText('   '), /没有可查询/);
});

test('内置词典窗口只允许汉典 HTTPS 顶层导航', () => {
  assert.strictEqual(isAllowedDictionaryUrl('https://www.zdic.net/hans/%E8%B8%8C%E8%BA%87'), true);
  assert.strictEqual(isAllowedDictionaryUrl('https://zdic.net/hans/test'), true);
  assert.strictEqual(isAllowedDictionaryUrl('http://www.zdic.net/hans/test'), false);
  assert.strictEqual(isAllowedDictionaryUrl('https://www.zdic.net.evil.example/test'), false);
  assert.strictEqual(isAllowedDictionaryUrl('file:///C:/secret.txt'), false);
});
