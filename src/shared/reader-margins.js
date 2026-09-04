'use strict';

/** 阅读页边距档位（纯逻辑，无 DOM 依赖，可单测）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GaiaReaderMargins = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HORIZONTAL_OPTIONS = Object.freeze([
    Object.freeze({ marginPct: 4, gap: 0, label: '紧凑' }),
    Object.freeze({ marginPct: 8, gap: 12, label: '标准' }),
    Object.freeze({ marginPct: 12, gap: 24, label: '宽松' }),
    Object.freeze({ marginPct: 16, gap: 36, label: '超宽' }),
  ]);
  const VERTICAL_OPTIONS = Object.freeze([
    Object.freeze({ padding: 16, label: '紧凑' }),
    Object.freeze({ padding: 28, label: '标准' }),
    Object.freeze({ padding: 40, label: '宽松' }),
    Object.freeze({ padding: 56, label: '超宽' }),
  ]);
  const DEFAULT_HORIZONTAL_MARGIN = 8;
  const DEFAULT_VERTICAL_MARGIN = 28;

  function horizontalProfile(value) {
    const margin = Number(value);
    return HORIZONTAL_OPTIONS.find((option) => option.marginPct === margin) || HORIZONTAL_OPTIONS[1];
  }

  function normalizeHorizontalMargin(value) {
    return horizontalProfile(value).marginPct;
  }

  function nextHorizontalMargin(value) {
    const current = horizontalProfile(value);
    const index = HORIZONTAL_OPTIONS.indexOf(current);
    return HORIZONTAL_OPTIONS[(index + 1) % HORIZONTAL_OPTIONS.length].marginPct;
  }

  function horizontalMarginLabel(value) {
    const option = horizontalProfile(value);
    return option.label + ' · ' + option.marginPct + '% / ' + option.gap + 'px';
  }

  function verticalProfile(value) {
    const padding = Number(value);
    return VERTICAL_OPTIONS.find((option) => option.padding === padding) || VERTICAL_OPTIONS[1];
  }

  function normalizeVerticalMargin(value) {
    return verticalProfile(value).padding;
  }

  function nextVerticalMargin(value) {
    const current = verticalProfile(value);
    const index = VERTICAL_OPTIONS.indexOf(current);
    return VERTICAL_OPTIONS[(index + 1) % VERTICAL_OPTIONS.length].padding;
  }

  function verticalMarginLabel(value) {
    const option = verticalProfile(value);
    return option.label + ' · ' + option.padding + 'px';
  }

  function horizontalMarginFromLegacyGap(value) {
    const gap = Math.max(0, Number(value) || 0);
    return HORIZONTAL_OPTIONS.reduce((best, option) => (
      Math.abs(option.gap - gap) < Math.abs(best.gap - gap) ? option : best
    ), HORIZONTAL_OPTIONS[0]).marginPct;
  }

  return {
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
  };
});
