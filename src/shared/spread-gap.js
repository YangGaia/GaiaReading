'use strict';

/** 双页页面间隙档位（纯逻辑，无 DOM 依赖，可单测）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GaiaSpreadGap = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const OPTIONS = Object.freeze([0, 24, 56, 96]);
  const DEFAULT_GAP = 0;
  const LABELS = Object.freeze({ 0: '无', 24: '窄', 56: '中', 96: '宽' });

  function normalizeGap(value) {
    const gap = Number(value);
    return OPTIONS.includes(gap) ? gap : DEFAULT_GAP;
  }

  function nextGap(value) {
    const current = normalizeGap(value);
    const index = OPTIONS.indexOf(current);
    return OPTIONS[(index + 1) % OPTIONS.length];
  }

  function gapLabel(value) {
    const gap = normalizeGap(value);
    return LABELS[gap] + ' · ' + gap + 'px';
  }

  return { OPTIONS, DEFAULT_GAP, normalizeGap, nextGap, gapLabel };
});
