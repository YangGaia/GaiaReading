(function () {
  'use strict';

  const documents = new WeakMap();
  const conversion = window.GaiaChineseScript;

  function nodesIn(root) {
    const walker = root.ownerDocument.createTreeWalker(root, 4);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  function snapshot(root) {
    if (documents.has(root)) return documents.get(root);
    const groups = [];
    for (const node of nodesIn(root)) {
      const parent = node.parentElement;
      const skipped = !!parent.closest('script, style, code, pre, textarea');
      const block = parent.closest('p, div, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, section') || root;
      const last = groups[groups.length - 1];
      if (last && last.block === block && last.skipped === skipped) last.text += node.nodeValue;
      else groups.push({ block, skipped, text: node.nodeValue });
    }
    const originalDocument = root.ownerDocument.cloneNode(true);
    const record = { source: root.textContent || '', groups, originalDocument, mode: null, maps: new Map() };
    documents.set(root, record);
    return record;
  }

  function mapping(record, mode) {
    const selected = conversion.normalizeMode(mode);
    if (record.maps.has(selected)) return record.maps.get(selected);
    let text = '';
    let sourceOffset = 0;
    const sourceToTarget = new Uint32Array(record.source.length + 1);
    const targetToSource = [];
    for (const group of record.groups) {
      const mapped = conversion.convertWithMap(group.text, group.skipped ? null : selected);
      for (let index = 0; index <= group.text.length; index++) sourceToTarget[sourceOffset + index] = text.length + mapped.sourceToTarget[index];
      for (let index = 0; index <= mapped.text.length; index++) targetToSource[text.length + index] = sourceOffset + mapped.targetToSource[index];
      text += mapped.text;
      sourceOffset += group.text.length;
    }
    if (!targetToSource.length) targetToSource.push(0);
    const result = { text, sourceToTarget, targetToSource };
    record.maps.set(selected, result);
    return result;
  }

  function apply(root, mode) {
    if (!root) return;
    const record = snapshot(root);
    const selected = conversion.normalizeMode(mode);
    if (record.mode === selected) return;
    const previous = mapping(record, record.mode);
    const next = mapping(record, selected);
    let offset = 0;
    for (const node of nodesIn(root)) {
      const start = previous.targetToSource[Math.min(offset, previous.text.length)];
      offset += node.nodeValue.length;
      const end = previous.targetToSource[Math.min(offset, previous.text.length)];
      node.nodeValue = next.text.slice(next.sourceToTarget[start], next.sourceToTarget[end]);
    }
    record.mode = selected;
  }

  function sourceOffset(root, offset) {
    const record = documents.get(root);
    if (!record) return offset;
    const mapped = mapping(record, record.mode);
    return mapped.targetToSource[Math.max(0, Math.min(mapped.text.length, offset))];
  }

  function displayOffset(root, offset) {
    const record = documents.get(root);
    if (!record) return offset;
    return mapping(record, record.mode).sourceToTarget[Math.max(0, Math.min(record.source.length, offset))];
  }

  function sourceText(root) {
    const record = documents.get(root);
    return record ? record.source : (root ? root.textContent || '' : '');
  }

  function sourceRoot(root) {
    const record = documents.get(root);
    return record ? record.originalDocument.body || record.originalDocument.querySelector('body') : root;
  }

  function rangeAt(root, start, end = start) {
    const nodes = nodesIn(root);
    const range = root.ownerDocument.createRange();
    const locate = offset => {
      let remaining = Math.max(0, offset);
      for (const node of nodes) {
        if (remaining <= node.nodeValue.length) return { node, offset: remaining };
        remaining -= node.nodeValue.length;
      }
      const node = nodes[nodes.length - 1];
      return { node: node || root, offset: node ? node.nodeValue.length : 0 };
    };
    const from = locate(start);
    const to = locate(end);
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  }

  window.GaiaReaderChinese = { apply, sourceOffset, displayOffset, sourceText, sourceRoot, rangeAt };
})();
