(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GaiaLibrary = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

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

  return { removeBook, removeBooks, removeEntry, removeEntries };
});
