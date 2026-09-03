(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GaiaReaderContrast = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STANDARD = 'standard';
  const HIGH = 'high';

  function normalizeReaderTextContrast(value) {
    return value === HIGH ? HIGH : STANDARD;
  }

  function darkReaderTextColor(value) {
    return normalizeReaderTextContrast(value) === HIGH ? '#ffffff' : '#e6edf3';
  }

  function readerTextContrastLabel(value) {
    return normalizeReaderTextContrast(value) === HIGH ? '高对比白' : '标准灰白';
  }

  return {
    STANDARD,
    HIGH,
    normalizeReaderTextContrast,
    darkReaderTextColor,
    readerTextContrastLabel,
  };
});
