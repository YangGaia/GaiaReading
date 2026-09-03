(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GaiaBookSearch = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_LIMIT = 500;

  function normalizeWithMap(value) {
    const source = String(value || '');
    let normalized = '';
    const map = [];
    let sourceIndex = 0;
    for (const character of source) {
      const start = sourceIndex;
      sourceIndex += character.length;
      if (/\s/u.test(character) || character === '\u00ad' || character === '\u200b') continue;
      let folded = character;
      try { folded = character.normalize('NFKC'); } catch (error) {}
      folded = folded.toLocaleLowerCase();
      for (const output of folded) {
        normalized += output;
        map.push(start);
      }
    }
    return { source, normalized, map };
  }

  function normalizeQuery(value) {
    return normalizeWithMap(value).normalized;
  }

  function excerptFor(source, start, end, radius) {
    const text = String(source || '');
    const size = Math.max(12, Number(radius) || 36);
    const from = Math.max(0, start - size);
    const to = Math.min(text.length, end + size);
    const prefix = from > 0 ? '…' : '';
    const suffix = to < text.length ? '…' : '';
    return prefix + text.slice(from, to).replace(/\s+/g, ' ').trim() + suffix;
  }

  function findInText(value, query, options) {
    const prepared = normalizeWithMap(value);
    const needle = normalizeQuery(query);
    const settings = options || {};
    const limit = Math.max(1, Number(settings.limit) || DEFAULT_LIMIT);
    if (!needle || !prepared.normalized) return [];
    const matches = [];
    let cursor = 0;
    while (cursor <= prepared.normalized.length - needle.length && matches.length < limit) {
      const found = prepared.normalized.indexOf(needle, cursor);
      if (found < 0) break;
      const originalStart = prepared.map[found];
      const lastMapped = prepared.map[found + needle.length - 1];
      const originalEnd = lastMapped == null
        ? originalStart
        : lastMapped + Array.from(prepared.source.slice(lastMapped))[0].length;
      matches.push({
        start: originalStart,
        end: originalEnd,
        quote: prepared.source.slice(originalStart, originalEnd),
        excerpt: excerptFor(prepared.source, originalStart, originalEnd, settings.radius),
        normalizedStart: found,
      });
      cursor = found + Math.max(1, needle.length);
    }
    return matches;
  }

  function searchSections(sections, query, options) {
    const list = Array.isArray(sections) ? sections : [];
    const settings = options || {};
    const limit = Math.max(1, Number(settings.limit) || DEFAULT_LIMIT);
    const results = [];
    for (let sectionIndex = 0; sectionIndex < list.length && results.length < limit; sectionIndex += 1) {
      const section = list[sectionIndex] || {};
      const matches = findInText(section.text, query, { limit: limit - results.length, radius: settings.radius });
      for (let ordinal = 0; ordinal < matches.length; ordinal += 1) {
        results.push(Object.assign({}, matches[ordinal], {
          sectionIndex,
          ordinal,
          id: String(section.id == null ? sectionIndex : section.id),
          title: String(section.title || '正文'),
          locator: section.locator && typeof section.locator === 'object' ? Object.assign({}, section.locator) : {},
        }));
      }
    }
    return results;
  }

  return {
    DEFAULT_LIMIT,
    normalizeWithMap,
    normalizeQuery,
    excerptFor,
    findInText,
    searchSections,
  };
});
