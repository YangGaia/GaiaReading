(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GaiaBookmarks = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function addBookmark(map, pathKey, bookmark) {
    const list = (map[pathKey] || []).slice();
    list.push(bookmark);
    const next = Object.assign({}, map);
    next[pathKey] = list;
    return next;
  }

  function removeBookmark(map, pathKey, index) {
    const list = (map[pathKey] || []).slice();
    if (index < 0 || index >= list.length) return map;
    list.splice(index, 1);
    const next = Object.assign({}, map);
    if (list.length) next[pathKey] = list;
    else delete next[pathKey];
    return next;
  }

  function findBookmarkIndex(map, pathKey, loc) {
    return (map[pathKey] || []).findIndex((b) => b.loc === loc);
  }

  return { addBookmark, removeBookmark, findBookmarkIndex };
});
