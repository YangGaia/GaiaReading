(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GaiaReaderContrast = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STANDARD = 'standard';
  const HIGH = 'high';
  const STANDARD_COLORS = Object.freeze({ light: '#24292f', eye: '#4a3826', dark: '#e6edf3' });
  const HIGH_COLORS = Object.freeze({ light: '#000000', eye: '#1f140c', dark: '#ffffff' });

  function normalizeReaderTextContrast(value) {
    return value === HIGH ? HIGH : STANDARD;
  }

  function normalizeTheme(theme) {
    return theme === 'dark' || theme === 'eye' ? theme : 'light';
  }

  function readerTextColor(theme, value) {
    const colors = normalizeReaderTextContrast(value) === HIGH ? HIGH_COLORS : STANDARD_COLORS;
    return colors[normalizeTheme(theme)];
  }

  function readerLinkColor(theme) {
    const colors = { light: '#0645ad', eye: '#8a6d3b', dark: '#58a6ff' };
    return colors[normalizeTheme(theme)];
  }

  function readerTextContrastLabel(value) {
    return normalizeReaderTextContrast(value) === HIGH ? '高对比' : '标准';
  }

  return {
    STANDARD,
    HIGH,
    normalizeReaderTextContrast,
    readerTextColor,
    readerLinkColor,
    readerTextContrastLabel,
  };
});
