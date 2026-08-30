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

  function removeEntry(map, pathKey) {
    if (!map || !Object.prototype.hasOwnProperty.call(map, pathKey)) return map;
    const next = Object.assign({}, map);
    delete next[pathKey];
    return next;
  }

  return { removeBook, removeEntry };
});

