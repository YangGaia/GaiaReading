(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GaiaEpubTypography = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const documents = new WeakMap();
  const HTML = 'http://www.w3.org/1999/xhtml';
  const SKIP = new Set(['script', 'style', 'link', 'meta', 'base', 'title', 'br', 'wbr', 'source', 'track']);

  function normalizePercent(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(80, Math.min(200, number)) : 100;
  }

  function isFixedLayout(layout, properties) {
    const flags = Array.isArray(properties) ? properties : String(properties || '').split(/\s+/);
    if (flags.includes('rendition:layout-pre-paginated')) return true;
    if (flags.includes('rendition:layout-reflowable')) return false;
    return layout === 'pre-paginated';
  }

  function restore(doc) {
    const entries = documents.get(doc);
    if (!entries) return;
    for (const entry of entries) {
      for (const [property, value, priority] of entry.original) {
        if (value) entry.node.style.setProperty(property, value, priority);
        else entry.node.style.removeProperty(property);
      }
    }
    documents.delete(doc);
  }

  function apply(doc, percent, options) {
    if (!doc || !doc.body || !doc.defaultView) return;
    // Restore only our typography properties. epub.js owns the other inline
    // styles (columns, size, position); restoring cssText would undo pagination.
    restore(doc);
    const scale = normalizePercent(percent) / 100;
    if (scale === 1 || (options && options.fixedLayout)) return;

    // Measure the entire unscaled tree before writing anything. Scaling an
    // ancestor first would otherwise multiply nested em/% and inherited sizes.
    // Re-measure after restoration so theme, line-height and media-query changes
    // use the current book styles rather than a stale or already scaled baseline.
    const entries = [];
    for (const node of [doc.documentElement, doc.body, ...doc.body.querySelectorAll('*')]) {
      const html = !node.namespaceURI || node.namespaceURI === HTML;
      const embedded = !html && ['svg', 'math'].includes(node.localName) && node.parentElement && node.parentElement.namespaceURI === HTML;
      if ((!html && !embedded) || SKIP.has(node.localName)) continue;
      const computed = doc.defaultView.getComputedStyle(node);
      const size = parseFloat(computed.fontSize);
      if (!Number.isFinite(size)) continue;
      const height = parseFloat(computed.lineHeight);
      const properties = ['font-size'];
      if (Number.isFinite(height) && !embedded) properties.push('line-height');
      entries.push({
        node, size, height, embedded,
        original: properties.map((property) => [property, node.style.getPropertyValue(property), node.style.getPropertyPriority(property)]),
      });
    }
    documents.set(doc, entries);
    for (const entry of entries) {
      // Keep self-contained SVG/MathML artwork independent of inherited sizes.
      entry.node.style.setProperty('font-size', (entry.size * (entry.embedded ? 1 : scale)) + 'px', 'important');
      if (Number.isFinite(entry.height) && !entry.embedded) {
        entry.node.style.setProperty('line-height', (entry.height * scale) + 'px', 'important');
      }
    }
  }

  return { normalizePercent, isFixedLayout, apply, restore };
});
