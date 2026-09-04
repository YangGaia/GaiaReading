'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GaiaPdfLayout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PAIRINGS = Object.freeze({ ODD: 'odd-first', EVEN: 'even-first' });
  const ZOOM_MODES = Object.freeze({ FIT_PAGE: 'fit-page', FIT_WIDTH: 'fit-width', MANUAL: 'manual' });

  function normalizePairing(value) {
    return value === PAIRINGS.EVEN ? PAIRINGS.EVEN : PAIRINGS.ODD;
  }

  function normalizeZoomMode(value) {
    return Object.values(ZOOM_MODES).includes(value) ? value : ZOOM_MODES.FIT_PAGE;
  }

  function pdfLayoutForPage(page, totalPages, spread, pairing) {
    const total = Math.max(1, Math.floor(Number(totalPages) || 1));
    const target = Math.max(1, Math.min(total, Math.floor(Number(page) || 1)));
    if (!spread) return { start: target, slots: [target], pages: [target] };

    const mode = normalizePairing(pairing);
    if (mode === PAIRINGS.EVEN && target === 1) {
      return { start: 1, slots: [null, 1], pages: [1] };
    }
    const start = mode === PAIRINGS.EVEN
      ? (target % 2 === 0 ? target : target - 1)
      : (target % 2 === 1 ? target : target - 1);
    const second = start + 1 <= total ? start + 1 : null;
    return { start, slots: [start, second], pages: second ? [start, second] : [start] };
  }

  function calculatePdfScale(options) {
    const opts = options || {};
    const sizes = Array.isArray(opts.pageSizes) && opts.pageSizes.length
      ? opts.pageSizes
      : [{ width: 1, height: 1 }];
    const gap = Math.max(0, Number(opts.gap) || 0);
    const legacyPadding = Math.max(0, Number(opts.padding) || 0);
    const horizontalPadding = opts.horizontalPadding == null
      ? legacyPadding
      : Math.max(0, Number(opts.horizontalPadding) || 0);
    const verticalPadding = opts.verticalPadding == null
      ? legacyPadding
      : Math.max(0, Number(opts.verticalPadding) || 0);
    const pagesWidth = sizes.reduce((sum, size) => sum + Math.max(1, Number(size.width) || 1), 0);
    const gapsWidth = gap * Math.max(0, sizes.length - 1);
    const contentWidth = pagesWidth + gapsWidth;
    const contentHeight = sizes.reduce((max, size) => Math.max(max, Math.max(1, Number(size.height) || 1)), 1);
    const availableWidth = Math.max(1, (Number(opts.viewportWidth) || 1) - horizontalPadding * 2);
    const availableHeight = Math.max(1, (Number(opts.viewportHeight) || 1) - verticalPadding * 2);
    const fitWidthScale = Math.max(1, availableWidth - gapsWidth) / pagesWidth;
    const fitPageScale = Math.min(fitWidthScale, availableHeight / contentHeight);
    const mode = normalizeZoomMode(opts.mode);
    const manualScale = Math.max(0.1, Math.min(4, Number(opts.zoom) || 1));
    const scale = mode === ZOOM_MODES.FIT_WIDTH
      ? fitWidthScale
      : (mode === ZOOM_MODES.MANUAL ? manualScale : fitPageScale);
    return {
      scale: mode === ZOOM_MODES.MANUAL ? manualScale : Math.max(0.001, Math.min(4, scale)),
      fitWidthScale,
      fitPageScale,
      contentWidth,
      contentHeight,
    };
  }

  function pdfPageLabel(pages, totalPages) {
    const visible = (pages || []).filter(Number.isFinite);
    if (!visible.length) return '第 1 / ' + totalPages + ' 页';
    const range = visible.length > 1 ? visible[0] + '–' + visible[visible.length - 1] : String(visible[0]);
    return '第 ' + range + ' / ' + totalPages + ' 页';
  }

  return {
    PAIRINGS,
    ZOOM_MODES,
    normalizePairing,
    normalizeZoomMode,
    pdfLayoutForPage,
    calculatePdfScale,
    pdfPageLabel,
  };
});
