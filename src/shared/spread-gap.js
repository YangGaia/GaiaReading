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

  const OPTIONS = Object.freeze([8, 16, 24, 40]);
  const DEFAULT_GAP = 16;

  function normalizeGap(value) {
    const gap = Number(value);
    return OPTIONS.includes(gap) ? gap : DEFAULT_GAP;
  }

  function nextGap(value) {
    const current = normalizeGap(value);
    const index = OPTIONS.indexOf(current);
    return OPTIONS[(index + 1) % OPTIONS.length];
  }

  return { OPTIONS, DEFAULT_GAP, normalizeGap, nextGap };
});
