'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../src/shared/chinese-display-data');
const { toSimplified } = require('../src/shared/chinese-display');

test('本地繁转简覆盖常见正文，并保留歧义词、专名和非中文内容', () => {
  const original = '繁體中文閱讀軟體：臺灣頭髮，乾淨與乾隆、乾坤；著作著名與看著火焰；瞭望與瞭解，藉口與慰藉。Latin 123 𨑨 👨‍👩‍👧‍👦';
  assert.equal(toSimplified(original), '繁体中文阅读软体：台湾头发，干净与乾隆、乾坤；著作著名与看着火焰；瞭望与了解，借口与慰藉。Latin 123 𨑨 👨‍👩‍👧‍👦');
  assert.equal(toSimplified(original).length, original.length);
});

test('所有字符映射等长，DOM偏移、选区与CFI不需要重算', () => {
  const sources = Array.from(data.traditional);
  const targets = Array.from(data.simplified);
  assert.ok(sources.length > 2000);
  assert.equal(sources.length, targets.length);
  for (const [index, source] of sources.entries()) assert.equal(source.length, targets[index].length, source);
  assert.equal(toSimplified(data.traditional).length, data.traditional.length);
});

test('重复繁转简稳定，已简化的著作等词不会再次变成着作', () => {
  const original = '顯著卓著昭著，乾隆乾清宮，著作權著稱專著論著與執著；藉口憑藉。';
  const converted = toSimplified(original);
  assert.equal(toSimplified(converted), converted);
  assert.equal(toSimplified(''), '');
  assert.equal(toSimplified(null), '');
});
