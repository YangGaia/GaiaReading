(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GaiaPageTextRange = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /** Read inclusive, zero-based CSS columns without moving the reading position. */
  function read(doc, options = {}) {
    const totalPages = Math.max(1, Math.floor(Number(options.totalPages) || 1));
    const startPage = Math.min(totalPages - 1, Math.max(0, Math.floor(Number(options.startPage) || 0)));
    const endPage = Math.min(totalPages - 1, Math.max(startPage, Math.floor(Number(options.endPage) || startPage)));
    const result = { content: '', startPage, endPage, totalPages, startOffset: -1, endOffset: -1 };
    const step = Number(options.pageWidth) + (Number(options.gap) || 0);
    if (!doc || !doc.body || !(step > 0)) return result;
    const source = typeof options.sourceText === 'function' ? options.sourceText(doc.body) : doc.body.textContent || '';
    const scroll = Number(doc.documentElement.scrollLeft) || Number(doc.body.scrollLeft) || 0;
    const pageOfRect = (rect) => Math.floor((rect.left + scroll + .01) / step);
    const range = doc.createRange();
    const walker = doc.createTreeWalker(doc.body, 4);
    const chunks = [];
    let globalOffset = 0;
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent || '';
      const nodeOffset = globalOffset;
      globalOffset += text.length;
      if (!text.length) continue;
      const parent = node.parentElement;
      if (parent && parent.closest('script,style,noscript,svg,math')) continue;
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.height > 0);
      if (!rects.length || !rects.some((rect) => pageOfRect(rect) >= startPage && pageOfRect(rect) <= endPage)) continue;
      const charPage = (offset) => {
        range.setStart(node, offset);
        range.setEnd(node, Math.min(text.length, offset + 1));
        const boxes = range.getClientRects();
        return boxes.length ? pageOfRect(boxes[0]) : null;
      };
      const lowerBound = (target) => {
        let low = 0;
        let high = text.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          const page = charPage(middle);
          // Collapsed whitespace can have no rectangle. Use the containing
          // prefix's last rectangle, which keeps the search monotonic.
          let effective = page;
          if (effective == null) {
            range.setStart(node, 0);
            range.setEnd(node, middle + 1);
            const prefix = range.getClientRects();
            effective = prefix.length ? pageOfRect(prefix[prefix.length - 1]) : -1;
          }
          if (effective < target) low = middle + 1;
          else high = middle;
        }
        return low;
      };
      const start = lowerBound(startPage);
      const end = lowerBound(endPage + 1);
      if (end <= start) continue;
      const from = nodeOffset + start;
      const to = nodeOffset + end;
      chunks.push(source.slice(from, to));
      if (result.startOffset < 0) result.startOffset = from;
      result.endOffset = to;
    }
    result.content = chunks.join('');
    return result;
  }

  return { read };
});
