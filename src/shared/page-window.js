(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GaiaPageWindow = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function pageWindow(currentPage, totalPages) {
    const total = Math.max(1, Math.floor(Number(totalPages) || 1));
    const current = Math.max(0, Math.min(total - 1, Math.floor(Number(currentPage) || 0)));
    return { startPage: Math.max(0, current - 4), endPage: Math.min(total - 1, current + 7), currentPage: current, totalPages: total };
  }
  return { pageWindow };
});
