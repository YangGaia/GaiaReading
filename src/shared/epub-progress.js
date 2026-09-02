'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GaiaEpubProgress = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  /**
   * 计算 EPUB 阅读进度（0-100）。
   * 优先使用 epub.js 生成的书内位置索引（locations）：
   * - location 有值且 locations.total > 0 时，返回 location/total。
   *   （epub.js 在 locations 生成失败时 total 为 0，percentage 恒为 0，不能信任。）
   * 位置索引不可用时回退到"章节序号 + 章内页码"：
   * - 多章节：按章节等权，章内页码按比例细分
   * - 单章节：按章内页码/章总页数
   * @param {object} location epub.js relocated 事件或 currentLocation() 的 location 对象
   * @param {Array} spineItems epub.spine.spineItems
   * @param {number} locationsTotal epub.locations.total（未生成时为 0）
   * @returns {number} 0-100
   */
  function epubDisplayPercent(location, spineItems, locationsTotal) {
    const start = (location && location.start) || {};
    const loc = start.location;
    const total = locationsTotal || 0;
    if (loc != null && total > 0) {
      return Math.min(100, Math.max(0, (loc / total) * 100));
    }
    const totalSections = Math.max(1, Array.isArray(spineItems) ? spineItems.length : 1);
    const idx = start.index != null ? start.index : 0;
    const disp = start.displayed || {};
    const page = disp.page || 1;
    const secTotal = disp.total || 1;
    const percent = totalSections > 1
      ? ((idx + (page - 1) / secTotal) / totalSections) * 100
      : ((page - 1) / secTotal) * 100;
    return Math.min(100, Math.max(0, percent));
  }

  function normalizeEpubHref(value) {
    let href = String(value || '').trim().replace(/\\/g, '/').split('#')[0].split('?')[0];
    try { href = decodeURI(href); } catch (error) {}
    while (href.startsWith('./')) href = href.slice(2);
    return href.replace(/^\/+/, '').toLowerCase();
  }

  function epubHrefsMatch(left, right) {
    const a = normalizeEpubHref(left);
    const b = normalizeEpubHref(right);
    if (!a || !b) return false;
    return a === b || a.endsWith('/' + b) || b.endsWith('/' + a);
  }

  function findEpubNavLabel(items, resourceHref) {
    for (const item of items || []) {
      if (item && item.href && epubHrefsMatch(item.href, resourceHref)) {
        const label = String(item.label || '').trim();
        if (label) return label;
      }
      if (item && item.subitems && item.subitems.length) {
        const nested = findEpubNavLabel(item.subitems, resourceHref);
        if (nested) return nested;
      }
    }
    return null;
  }

  function resolveEpubTocTarget(spineItems, tocHref) {
    const raw = String(tocHref || '').trim();
    if (!raw) return '';
    const hashAt = raw.indexOf('#');
    const fragment = hashAt >= 0 ? raw.slice(hashAt) : '';
    const target = normalizeEpubHref(raw);
    const items = Array.isArray(spineItems) ? spineItems : [];
    const exactIndex = items.findIndex((item) => normalizeEpubHref(item && item.href) === target);
    const matchingIndexes = exactIndex >= 0
      ? [exactIndex]
      : items.map((item, index) => epubHrefsMatch(item && item.href, raw) ? index : -1).filter((index) => index >= 0);
    if (matchingIndexes.length === 1) {
      const index = matchingIndexes[0];
      const matched = items[index];
      if (!fragment || index === 0) {
        if (matched && matched.idref) return '#' + matched.idref;
        return index;
      }
      if (matched && matched.href) return String(matched.href).split('#')[0] + fragment;
    }
    return raw;
  }

  return { epubDisplayPercent, normalizeEpubHref, epubHrefsMatch, findEpubNavLabel, resolveEpubTocTarget };
});
