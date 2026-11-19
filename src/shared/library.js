(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./chinese-script'));
  } else {
    root.GaiaLibrary = factory(root.GaiaChineseScript);
  }
})(typeof self !== 'undefined' ? self : this, function (chinese) {
  'use strict';

  const searchFields = new WeakMap();

  function normalizeSearchText(value) {
    const text = String(value || '').normalize('NFKC').trim();
    return text && chinese.convert(text, 'simplified').toLowerCase();
  }

  function searchBooks(library, query) {
    const terms = normalizeSearchText(query).match(/\S+/g);
    if (!terms) return library;
    return library.filter((book) => {
      if (!searchFields.has(book)) {
        const filename = String(book.path || '').split(/[\\/]/).pop();
        searchFields.set(book, [book.title, book.author, filename].map(normalizeSearchText));
      }
      const fields = searchFields.get(book);
      return terms.every((term) => fields.some((field) => field.includes(term)));
    });
  }

  function removeBook(library, pathKey) {
    const index = library.findIndex((b) => b.path === pathKey);
    if (index < 0) return library;
    return library.filter((b) => b.path !== pathKey);
  }

  function removeBooks(library, pathKeys) {
    const keys = new Set(pathKeys);
    const next = library.filter((b) => !keys.has(b.path));
    return next.length === library.length ? library : next;
  }

  function removeEntry(map, pathKey) {
    if (!map || !Object.prototype.hasOwnProperty.call(map, pathKey)) return map;
    const next = Object.assign({}, map);
    delete next[pathKey];
    return next;
  }

  function removeEntries(map, pathKeys) {
    const keys = pathKeys.filter((k) => Object.prototype.hasOwnProperty.call(map, k));
    if (!keys.length) return map;
    const next = Object.assign({}, map);
    for (const k of keys) delete next[k];
    return next;
  }

  return { searchBooks, removeBook, removeBooks, removeEntry, removeEntries };
});
