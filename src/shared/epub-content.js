(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GaiaEpubContent = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const boundDocuments = new WeakSet();
  const REFERENCE_HINT = /(?:footnote|endnote|noteref|note[-_ ]?ref|fnref)/i;
  const NOTE_HINT = /(?:footnote|endnote|note[-_ ]?content|fn[-_ ]?\d+)/i;

  function isFootnoteReference(link) {
    if (!link || String(link.localName || '').toLowerCase() !== 'a') return false;
    const href = link.getAttribute && link.getAttribute('href');
    if (!href || href[0] !== '#' || href.length < 2) return false;
    const role = link.getAttribute('role') || '';
    const type = link.getAttribute('epub:type') || link.getAttribute('type') || '';
    const classes = typeof link.className === 'string' ? link.className : '';
    const parent = link.parentElement;
    const parentName = parent && String(parent.localName || '').toLowerCase();
    const parentClass = parent && typeof parent.className === 'string' ? parent.className : '';
    return role === 'doc-noteref' || /(?:^|\s)noteref(?:\s|$)/i.test(type) ||
      REFERENCE_HINT.test(classes) || REFERENCE_HINT.test(parentClass) ||
      (parentName === 'sup' && !!href);
  }

  function targetForReference(link, doc) {
    if (!doc || !isFootnoteReference(link)) return null;
    const href = link.getAttribute('href');
    let id;
    try { id = decodeURIComponent(href.slice(1)); } catch (error) { id = href.slice(1); }
    const target = doc.getElementById(id);
    if (!target || target === link || (target.contains && target.contains(link))) return null;
    const targetClass = typeof target.className === 'string' ? target.className : '';
    const getAttribute = typeof target.getAttribute === 'function' ? target.getAttribute.bind(target) : () => '';
    const type = getAttribute('epub:type') || getAttribute('type') || '';
    const role = getAttribute('role') || '';
    const targetHinted = NOTE_HINT.test(target.id || '') || NOTE_HINT.test(targetClass) ||
      /(?:^|\s)(?:footnote|endnote|footnotes|endnotes)(?:\s|$)/i.test(type) || role === 'doc-footnote' || role === 'doc-endnote';
    if (!targetHinted && !link.parentElement?.matches?.('sup')) return null;
    return target;
  }

  function noteText(target) {
    if (!target) return '';
    const copy = target.cloneNode(true);
    for (const node of copy.querySelectorAll('a, script, style, .backlink, .footnote-back, [epub\\:type="backlink"], [role="doc-backlink"]')) node.remove();
    return String(copy.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function waitForImages(doc, timeoutMs = 2500) {
    if (!doc || !doc.images || !doc.images.length) return Promise.resolve();
    const images = Array.from(doc.images).filter((image) => !image.complete);
    if (!images.length) return Promise.resolve();
    return new Promise((resolve) => {
      let remaining = images.length;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const image of images) {
          image.removeEventListener('load', onSettled);
          image.removeEventListener('error', onSettled);
        }
        resolve();
      };
      const onSettled = () => {
        remaining -= 1;
        if (remaining <= 0) finish();
      };
      const timer = setTimeout(finish, Math.max(0, timeoutMs));
      for (const image of images) {
        image.addEventListener('load', onSettled, { once: true });
        image.addEventListener('error', onSettled, { once: true });
        if (image.complete) onSettled();
      }
    });
  }

  function bindFootnoteHover(doc) {
    if (!doc || boundDocuments.has(doc)) return 0;
    boundDocuments.add(doc);
    const links = Array.from(doc.querySelectorAll('a[href]'));
    let count = 0;
    let tooltip = null;
    const hide = () => {
      if (tooltip) tooltip.hidden = true;
    };
    for (const link of links) {
      const target = targetForReference(link, doc);
      const text = noteText(target);
      if (!text) continue;
      count += 1;
      if (!tooltip) {
        tooltip = doc.createElement('div');
        tooltip.className = 'gaia-footnote-tooltip';
        tooltip.setAttribute('role', 'tooltip');
        tooltip.hidden = true;
        Object.assign(tooltip.style, {
          position: 'fixed', zIndex: '2147483647', maxWidth: 'min(360px, calc(100vw - 24px))',
          maxHeight: '40vh', overflow: 'auto', padding: '8px 11px', borderRadius: '7px',
          background: '#20232b', color: '#f5f5f5', boxShadow: '0 4px 16px #0008',
          font: '14px/1.6 sans-serif', whiteSpace: 'normal', textIndent: '0', pointerEvents: 'none',
        });
        (doc.body || doc.documentElement).appendChild(tooltip);
      }
      link.setAttribute('aria-describedby', 'gaia-footnote-tooltip');
      tooltip.id = 'gaia-footnote-tooltip';
      link.addEventListener('mouseenter', (event) => {
        tooltip.textContent = text;
        tooltip.hidden = false;
        const rect = link.getBoundingClientRect();
        const width = tooltip.getBoundingClientRect().width;
        const height = tooltip.getBoundingClientRect().height;
        const frame = doc.defaultView.frameElement;
        const viewportWidth = Math.min(doc.defaultView.innerWidth, frame ? frame.clientWidth : doc.defaultView.innerWidth);
        const viewportHeight = Math.min(doc.defaultView.innerHeight, frame ? frame.clientHeight : doc.defaultView.innerHeight);
        const pointerX = event.clientX > 0 && event.clientX < viewportWidth ? event.clientX : rect.left;
        const pointerY = event.clientY > 0 && event.clientY < viewportHeight ? event.clientY : rect.bottom;
        const left = Math.max(8, Math.min(pointerX, viewportWidth - width - 8));
        const below = pointerY + height + 12 <= viewportHeight;
        tooltip.style.left = left + 'px';
        tooltip.style.top = (below ? pointerY + 6 : Math.max(8, pointerY - height - 6)) + 'px';
      });
      link.addEventListener('mouseleave', hide);
    }
    return count;
  }

  return { isFootnoteReference, targetForReference, noteText, waitForImages, bindFootnoteHover };
});
