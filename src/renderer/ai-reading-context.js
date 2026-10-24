(function () {
  'use strict';

  // End of the last visible character, in body.textContent coordinates. A node
  // can span many columns, so a visible paragraph must not expose its full text.
  function visibleTextRange(root, viewport) {
    if (!root) return { start: 0, end: 0 };
    const doc = root.ownerDocument;
    const bounds = viewport || { left: 0, top: 0, right: doc.documentElement.clientWidth, bottom: doc.documentElement.clientHeight };
    if (!(bounds.right > bounds.left && bounds.bottom > bounds.top)) return { start: 0, end: 0 };
    const range = doc.createRange();
    const visible = () => Array.from(range.getClientRects()).some(rect =>
      rect.width > 0 && rect.height > 0 && rect.right > bounds.left + 0.5 && rect.left < bounds.right - 0.5 &&
      rect.bottom > bounds.top + 0.5 && rect.top < bounds.bottom - 0.5);
    const walker = doc.createTreeWalker(root, 4);
    let offset = 0;
    let end = 0;
    let start = null;
    let node;
    while ((node = walker.nextNode())) {
      const length = node.textContent.length;
      const parent = node.parentElement;
      const style = parent && doc.defaultView.getComputedStyle(parent);
      if (length && parent && !parent.closest('script, style, template, [hidden], .gaia-footnote-tooltip') && style.visibility === 'visible') {
        range.selectNodeContents(node);
        if (visible()) {
          if (start === null) {
            let low = 1;
            let high = length;
            while (low < high) {
              const middle = Math.floor((low + high) / 2);
              range.setStart(node, 0);
              range.setEnd(node, middle);
              if (visible()) high = middle;
              else low = middle + 1;
            }
            start = offset + low - 1;
          }
          let low = 0;
          let high = length;
          // The suffix intersects the viewport iff it starts before the last
          // visible character. This also works for a single enormous text node.
          while (low < high) {
            const middle = Math.floor((low + high) / 2);
            range.setStart(node, middle);
            range.setEnd(node, length);
            if (visible()) low = middle + 1;
            else high = middle;
          }
          end = Math.max(end, offset + low);
        }
      }
      offset += length;
    }
    return { start: start === null ? 0 : start, end };
  }

  function textBetween(root, start, end) {
    const range = window.GaiaReaderChinese.rangeAt(root, start, end);
    const holder = root.ownerDocument.createElement('div');
    holder.appendChild(range.cloneContents());
    for (const node of holder.querySelectorAll('script, style, template, [hidden]')) node.remove();
    for (const node of holder.querySelectorAll('br')) node.replaceWith(root.ownerDocument.createTextNode('\n'));
    for (const node of holder.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, blockquote, section, tr')) {
      node.appendChild(root.ownerDocument.createTextNode('\n\n'));
    }
    return holder.textContent || '';
  }

  window.GaiaAiReadingContext = { textBetween, visibleTextRange, visibleTextEnd: (root, viewport) => visibleTextRange(root, viewport).end };
})();
