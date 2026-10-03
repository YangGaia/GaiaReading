(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GaiaReaderFeedback = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function create(options) {
    const doc = options.document;
    const schedule = options.setTimeout || doc.defaultView.setTimeout.bind(doc.defaultView);
    const cancel = options.clearTimeout || doc.defaultView.clearTimeout.bind(doc.defaultView);
    const node = doc.createElement('div');
    node.id = 'reader-feedback';
    node.className = 'reader-feedback';
    node.hidden = true;
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.setAttribute('aria-atomic', 'true');
    const mark = doc.createElement('span');
    mark.className = 'reader-feedback-mark';
    mark.setAttribute('aria-hidden', 'true');
    const message = doc.createElement('span');
    message.className = 'reader-feedback-message';
    node.appendChild(mark);
    node.appendChild(message);
    options.host.appendChild(node);
    let timer = 0;
    let version = 0;

    function clear() {
      version += 1;
      cancel(timer);
      timer = 0;
      node.hidden = true;
      message.textContent = '';
    }

    function show(text, kind = 'success') {
      clear();
      const current = version;
      node.dataset.kind = kind;
      mark.textContent = kind === 'success' ? '✓' : kind === 'error' ? '!' : '·';
      message.textContent = String(text);
      node.hidden = false;
      timer = schedule(() => { if (version === current) clear(); }, 2600);
    }

    return { show, clear };
  }

  return { create };
});
