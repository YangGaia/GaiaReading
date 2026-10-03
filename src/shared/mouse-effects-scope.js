(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GaiaMouseEffectsScope = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const BOOK_SELECTOR = '#reader-content';
  const OVERLAY_SELECTOR = '[role="dialog"], [role="toolbar"], [role="menu"], [popover]:popover-open:not(#fx-canvas), #settings-overlay, #context-menu, #book-import-overlay, #note-editor-overlay, #toc-panel, #bookmarks-panel, #annotations-panel, #book-search-panel, #toc-backdrop, #toc-edge-trigger, #bgm-capsule, .gaia-pet-hitbox, .gaia-pet-console, .gaia-pet-bubble';

  function box(left, top, right, bottom) {
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function intersection(first, second) {
    const left = Math.max(first.left, second.left);
    const top = Math.max(first.top, second.top);
    const right = Math.min(first.right, second.right);
    const bottom = Math.min(first.bottom, second.bottom);
    return right > left && bottom > top ? box(left, top, right, bottom) : null;
  }

  function subtract(region, hole) {
    const overlap = intersection(region, hole);
    if (!overlap) return [region];
    return [
      box(region.left, region.top, region.right, overlap.top),
      box(region.left, overlap.bottom, region.right, region.bottom),
      box(region.left, overlap.top, overlap.left, overlap.bottom),
      box(overlap.right, overlap.top, region.right, overlap.bottom),
    ].filter(rect => rect.width > 0 && rect.height > 0);
  }

  function regions(width, height, bookRects = [], overlayRects = []) {
    const viewport = box(0, 0, Math.max(0, width), Math.max(0, height));
    let allowed = viewport.width && viewport.height ? [viewport] : [];
    for (const book of bookRects) allowed = allowed.flatMap(region => subtract(region, book));
    // Same-direction paths use the nonzero fill rule: overlapping panels are a
    // union, so a menu inside a dialog never cuts a second hole in the effect.
    for (const overlay of overlayRects) {
      const visible = intersection(viewport, overlay);
      if (visible) allowed.push(visible);
    }
    return allowed;
  }

  function isReadingTarget(target) {
    const element = target && (target.nodeType === 3 ? target.parentElement : target);
    return !!(element && typeof element.closest === 'function' &&
      element.closest(BOOK_SELECTOR) && !element.closest(OVERLAY_SELECTOR));
  }

  function visibleRect(element, doc, styles) {
    if (!element || !element.getClientRects().length) return null;
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      let style = styles.get(node);
      if (!style) {
        style = doc.defaultView.getComputedStyle(node);
        styles.set(node, style);
      }
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return null;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  }

  function clipCanvas(context, width, height, doc) {
    const host = doc.getElementById('reader-content');
    const styles = new Map();
    const hostRect = visibleRect(host, doc, styles);
    if (!hostRect) return;
    // The host includes page margins and gutters. One host rectangle also keeps
    // clipping independent of the number of pages in a long PDF document.
    const overlays = [...doc.querySelectorAll(OVERLAY_SELECTOR)]
      .map(element => visibleRect(element, doc, styles)).filter(Boolean);
    context.beginPath();
    for (const rect of regions(width, height, [hostRect], overlays)) context.rect(rect.left, rect.top, rect.width, rect.height);
    context.clip();
  }

  function raiseCanvas(canvas, aboveNewPopover = false) {
    if (!canvas || canvas.hidden || typeof canvas.showPopover !== 'function') return;
    // A manual, noninteractive top-layer surface also paints above native HTML
    // popovers (the music list), without dismissing or taking focus from them.
    if (canvas.matches(':popover-open')) {
      if (!aboveNewPopover) return;
      canvas.hidePopover();
    }
    canvas.setAttribute('popover', 'manual');
    canvas.showPopover();
  }

  return { regions, isReadingTarget, clipCanvas, raiseCanvas };
});
