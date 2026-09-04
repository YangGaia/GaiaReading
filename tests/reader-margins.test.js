'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  HORIZONTAL_OPTIONS,
  VERTICAL_OPTIONS,
  DEFAULT_HORIZONTAL_MARGIN,
  DEFAULT_VERTICAL_MARGIN,
  horizontalProfile,
  normalizeHorizontalMargin,
  nextHorizontalMargin,
  horizontalMarginLabel,
  normalizeVerticalMargin,
  nextVerticalMargin,
  verticalMarginLabel,
  horizontalMarginFromLegacyGap,
} = require('../src/shared/reader-margins');

test('左右边距四档同时映射正文留白和双页中缝', () => {
  assert.deepStrictEqual(HORIZONTAL_OPTIONS.map((item) => [item.marginPct, item.gap]), [
    [4, 0], [8, 12], [12, 24], [16, 36],
  ]);
  assert.strictEqual(DEFAULT_HORIZONTAL_MARGIN, 8);
  assert.deepStrictEqual(horizontalProfile(12), { marginPct: 12, gap: 24, label: '宽松' });
  assert.strictEqual(horizontalMarginLabel(8), '标准 · 8% / 12px');
  assert.strictEqual(normalizeHorizontalMargin(99), 8);
  assert.strictEqual(nextHorizontalMargin(4), 8);
  assert.strictEqual(nextHorizontalMargin(16), 4);
});

test('上下边距提供四档并默认保持原有 28px', () => {
  assert.deepStrictEqual(VERTICAL_OPTIONS.map((item) => item.padding), [16, 28, 40, 56]);
  assert.strictEqual(DEFAULT_VERTICAL_MARGIN, 28);
  assert.strictEqual(verticalMarginLabel(40), '宽松 · 40px');
  assert.strictEqual(normalizeVerticalMargin(undefined), 28);
  assert.strictEqual(nextVerticalMargin(28), 40);
  assert.strictEqual(nextVerticalMargin(56), 16);
});

test('旧双页间隙迁移到最接近的左右边距档位', () => {
  assert.strictEqual(horizontalMarginFromLegacyGap(0), 4);
  assert.strictEqual(horizontalMarginFromLegacyGap(24), 12);
  assert.strictEqual(horizontalMarginFromLegacyGap(56), 16);
  assert.strictEqual(horizontalMarginFromLegacyGap(undefined), 4);
});
