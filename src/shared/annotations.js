(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GaiaAnnotations = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLORS = ['yellow', 'green', 'pink'];

  function listFor(map, pathKey) {
    return map && Array.isArray(map[pathKey]) ? map[pathKey] : [];
  }

  function addAnnotation(map, pathKey, annotation) {
    const next = Object.assign({}, map || {});
    next[pathKey] = listFor(map, pathKey).concat([annotation]);
    return next;
  }

  function updateAnnotation(map, pathKey, id, patch) {
    const list = listFor(map, pathKey);
    if (!list.some((item) => item.id === id)) return map || {};
    const next = Object.assign({}, map || {});
    next[pathKey] = list.map((item) => item.id === id ? Object.assign({}, item, patch || {}, { id: item.id }) : item);
    return next;
  }

  function removeAnnotation(map, pathKey, id) {
    const list = listFor(map, pathKey);
    if (!list.some((item) => item.id === id)) return map || {};
    const next = Object.assign({}, map || {});
    const filtered = list.filter((item) => item.id !== id);
    if (filtered.length) next[pathKey] = filtered;
    else delete next[pathKey];
    return next;
  }

  function normalizeColor(color) {
    return COLORS.includes(color) ? color : 'yellow';
  }

  function createTextAnchor(text, start, end) {
    const source = String(text || '');
    const safeStart = Math.max(0, Math.min(source.length, Number(start) || 0));
    const safeEnd = Math.max(safeStart, Math.min(source.length, Number(end) || 0));
    return { start: safeStart, end: safeEnd, quote: source.slice(safeStart, safeEnd) };
  }

  function resolveTextAnchor(text, anchor) {
    const source = String(text || '');
    const data = anchor || {};
    const start = Math.max(0, Math.min(source.length, Number(data.start) || 0));
    const end = Math.max(start, Math.min(source.length, Number(data.end) || start));
    const quote = String(data.quote || '');
    if (!quote || source.slice(start, end) === quote) return { start, end };

    const windowStart = Math.max(0, start - 800);
    const windowEnd = Math.min(source.length, start + quote.length + 800);
    const nearby = source.slice(windowStart, windowEnd).indexOf(quote);
    if (nearby >= 0) {
      const found = windowStart + nearby;
      return { start: found, end: found + quote.length };
    }
    const found = source.indexOf(quote);
    return found >= 0 ? { start: found, end: found + quote.length } : null;
  }

  return { COLORS, listFor, addAnnotation, updateAnnotation, removeAnnotation, normalizeColor, createTextAnchor, resolveTextAnchor };
});
