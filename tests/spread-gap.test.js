'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { OPTIONS, DEFAULT_GAP, normalizeGap, nextGap, gapLabel } = require('../src/shared/spread-gap');

test('双页间隙提供差异明显的四个档位并默认取消额外留白', () => {
  assert.deepStrictEqual(OPTIONS, [0, 24, 56, 96]);
  assert.strictEqual(DEFAULT_GAP, 0);
  assert.strictEqual(normalizeGap(undefined), 0);
  assert.strictEqual(normalizeGap(48), 0);
  assert.strictEqual(normalizeGap('24'), 24);
  assert.strictEqual(gapLabel(0), '无 · 0px');
  assert.strictEqual(gapLabel(96), '宽 · 96px');
});

test('双页间隙按钮按档位循环并在末尾回到最窄值', () => {
  assert.strictEqual(nextGap(0), 24);
  assert.strictEqual(nextGap(24), 56);
  assert.strictEqual(nextGap(56), 96);
  assert.strictEqual(nextGap(96), 0);
});
