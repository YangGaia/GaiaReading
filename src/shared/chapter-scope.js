'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GaiaChapterScope = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function flattenToc(items) {
    const out = [];
    const walk = (list, depth) => {
      for (const item of list || []) {
        if (!item || typeof item !== 'object') continue;
        out.push({ item, depth, order: out.length });
        const children = Array.isArray(item.children) ? item.children : item.subitems;
        if (Array.isArray(children) && children.length) walk(children, depth + 1);
      }
    };
    walk(items, 0);
    return out;
  }

  function selectChapterScope(entries, containerIndex, currentOffset) {
    const index = Number(containerIndex);
    const offset = Math.max(0, Number(currentOffset) || 0);
    const normalized = (entries || [])
      .filter((entry) => entry && Number.isFinite(Number(entry.containerIndex)))
      .map((entry, order) => ({
        ...entry,
        containerIndex: Number(entry.containerIndex),
        startOffset: Math.max(0, Number(entry.startOffset) || 0),
        order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : order,
      }));
    const local = normalized
      .filter((entry) => entry.containerIndex === index)
      .sort((a, b) => a.startOffset - b.startOffset || a.order - b.order);
    let selected = null;
    for (const entry of local) {
      if (entry.startOffset <= offset) selected = entry;
      else break;
    }
    // AZW3/KF8 常在目录锚点前保留页码或极短排版前缀。阅读器打开该底层文档的
    // 第 0 页时，当前位置可能落在锚点前；这段前缀应归入即将开始的当前章，
    // 不能误判成上一章正文。真正跨文档延续的正文通常会明显长于该前缀。
    if (!selected && local.length && local[0].startOffset <= 512) selected = local[0];
    if (!selected) {
      const previous = normalized
        .filter((entry) => entry.containerIndex < index)
        .sort((a, b) => a.containerIndex - b.containerIndex || a.startOffset - b.startOffset || a.order - b.order);
      selected = previous.length ? { ...previous[previous.length - 1], continued: true, startOffset: 0 } : null;
    }
    const end = local.find((entry) => entry.startOffset > (selected ? selected.startOffset : offset));
    return {
      selected,
      startOffset: selected && selected.containerIndex === index && !selected.continued ? selected.startOffset : 0,
      endOffset: end ? end.startOffset : null,
      endEntry: end || null,
    };
  }

  return { flattenToc, selectChapterScope };
});
