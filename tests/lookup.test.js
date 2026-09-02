'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeLookupText,
  dictionaryUrl,
  normalizeSearchEngine,
  normalizeCustomSearchTemplate,
  searchUrl,
  searchEngineLabel,
  isAllowedDictionaryUrl,
} = require('../src/shared/lookup');

test('词典与搜索查询会清理长度并安全编码', () => {
  assert.strictEqual(normalizeLookupText('  山  茶  '), '山 茶');
  assert.strictEqual(dictionaryUrl('踌躇'), 'https://dict.youdao.com/search?q=%E8%B8%8C%E8%BA%87');
  assert.strictEqual(searchUrl('A&B'), 'https://www.google.com/search?q=A%26B');
  assert.strictEqual(Array.from(normalizeLookupText('字'.repeat(100), 80)).length, 80);
  assert.throws(() => normalizeLookupText('   '), /没有可查询/);
});

test('网页搜索可选 Google、Bing、百度与安全的自定义引擎', () => {
  assert.strictEqual(searchUrl('山 茶', { engine: 'google' }), 'https://www.google.com/search?q=%E5%B1%B1%20%E8%8C%B6');
  assert.strictEqual(searchUrl('山茶', { engine: 'bing' }), 'https://www.bing.com/search?q=%E5%B1%B1%E8%8C%B6');
  assert.strictEqual(searchUrl('山茶', { engine: 'baidu' }), 'https://www.baidu.com/s?wd=%E5%B1%B1%E8%8C%B6');
  assert.strictEqual(searchUrl('A&B', { engine: 'custom', customTemplate: 'https://example.com/find?q={query}' }), 'https://example.com/find?q=A%26B');
  assert.strictEqual(normalizeSearchEngine('unknown'), 'google');
  assert.strictEqual(searchEngineLabel('bing'), 'Bing');
  assert.strictEqual(normalizeCustomSearchTemplate(' HTTPS://example.com/find?q={query} '), 'HTTPS://example.com/find?q={query}');
  assert.throws(() => searchUrl('test', { engine: 'custom', customTemplate: '' }), /请填写/);
  assert.throws(() => searchUrl('test', { engine: 'custom', customTemplate: 'https://example.com/search' }), /\{query\}/);
  assert.throws(() => searchUrl('test', { engine: 'custom', customTemplate: 'http://example.com/?q={query}' }), /HTTPS/);
  assert.throws(() => searchUrl('test', { engine: 'custom', customTemplate: 'https://{query}.example.com/' }), /域名/);
  assert.throws(() => searchUrl('test', { engine: 'custom', customTemplate: 'https://user:pass@example.com/?q={query}' }), /账号或密码/);
});

test('内置词典窗口只允许网易有道 HTTPS 顶层导航', () => {
  assert.strictEqual(isAllowedDictionaryUrl('https://dict.youdao.com/search?q=test'), true);
  assert.strictEqual(isAllowedDictionaryUrl('http://dict.youdao.com/result?word=test'), false);
  assert.strictEqual(isAllowedDictionaryUrl('https://dict.youdao.com.evil.example/test'), false);
  assert.strictEqual(isAllowedDictionaryUrl('https://www.zdic.net/hans/test'), false);
  assert.strictEqual(isAllowedDictionaryUrl('file:///C:/secret.txt'), false);
});
