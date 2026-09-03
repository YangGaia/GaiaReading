'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { OPTIONS, DEFAULT_GAP, normalizeGap, nextGap } = require('../src/shared/spread-gap');

test('双页间隙提供四个安全档位并默认使用紧凑值', () => {
  assert.deepStrictEqual(OPTIONS, [8, 16, 24, 40]);
  assert.strictEqual(DEFAULT_GAP, 16);
  assert.strictEqual(normalizeGap(undefined), 16);
  assert.strictEqual(normalizeGap(48), 16);
  assert.strictEqual(normalizeGap('24'), 24);
});

test('双页间隙按钮按档位循环并在末尾回到最窄值', () => {
  assert.strictEqual(nextGap(8), 16);
  assert.strictEqual(nextGap(16), 24);
  assert.strictEqual(nextGap(24), 40);
  assert.strictEqual(nextGap(40), 8);
});
