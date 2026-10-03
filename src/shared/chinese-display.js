(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./chinese-display-data') : root.GaiaChineseDisplayData);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GaiaChineseDisplay = api;
})(typeof window !== 'undefined' ? window : globalThis, function (data) {
  'use strict';

  // Character-only display conversion deliberately keeps every UTF-16 offset.
  // It does not translate regional vocabulary or rewrite the imported book.
  const mapping = new Map();
  const sourceCharacters = Array.from(data.traditional);
  const targetCharacters = Array.from(data.simplified);
  for (let index = 0; index < sourceCharacters.length; index++) {
    const source = sourceCharacters[index];
    const target = targetCharacters[index];
    if (source && target && source.length === target.length) mapping.set(source, target);
  }
  mapping.set('乾', '干');
  const phraseSources = [
    '著作權', '著作', '著名', '著稱', '著述', '著書', '著錄', '著文', '著者', '著譯',
    '顯著', '卓著', '昭著', '名著', '原著', '專著', '論著', '編著', '合著', '譯著', '拙著', '巨著', '鉅著', '遺著', '土著', '執著',
    '乾坤', '乾隆', '乾元', '乾卦', '乾道', '乾符', '乾封', '乾德', '乾亨', '乾統', '乾祐', '乾興', '乾順', '乾清', '乾陵', '乾縣', '乾州',
    '瞭望',
  ];
  const convertCharacters = (text) => Array.from(text, (character) => mapping.get(character) || character).join('');
  const phrases = new Map();
  for (const phrase of phraseSources) {
    const simplified = convertCharacters(phrase).replace(/着/g, '著').replace(/干/g, '乾').replace(/了望/g, '瞭望');
    phrases.set(phrase, simplified);
    phrases.set(simplified, simplified);
  }
  for (const [source, target] of [['藉口', '借口'], ['藉助', '借助'], ['藉由', '借由'], ['藉此', '借此'], ['憑藉', '凭借']]) phrases.set(source, target);
  const phrasePattern = new RegExp([...phrases.keys()].sort((a, b) => b.length - a.length).join('|'), 'g');
  const documents = new WeakMap();
  const skipped = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE', 'KBD', 'SAMP', 'SVG', 'MATH']);

  function toSimplified(value) {
    const text = String(value == null ? '' : value);
    let output = '';
    let cursor = 0;
    phrasePattern.lastIndex = 0;
    for (const match of text.matchAll(phrasePattern)) {
      output += convertCharacters(text.slice(cursor, match.index)) + phrases.get(match[0]);
      cursor = match.index + match[0].length;
    }
    return output + convertCharacters(text.slice(cursor));
  }

  function textNodes(root) {
    if (!root) return [];
    if (root.nodeType === 3) return [root];
    const doc = root.ownerDocument || root;
    if (!doc.createTreeWalker) return [];
    const walker = doc.createTreeWalker(root, 4); // SHOW_TEXT, also works outside the main window.
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  function eligible(node, body) {
    for (let element = node.parentElement; element; element = element.parentElement) {
      if (skipped.has(String(element.tagName || '').toUpperCase()) || element.getAttribute?.('translate') === 'no') return false;
      if (element === body) break;
    }
    return true;
  }

  function recordFor(node) {
    const doc = node && (node.ownerDocument || (node.nodeType === 9 ? node : null));
    const record = doc && documents.get(doc);
    if (!record || !doc.body || (node !== doc.body && node !== doc && !doc.body.contains(node))) return null;
    return { doc, record };
  }

  function offsetBefore(node, body) {
    if (node === body) return 0;
    const range = body.ownerDocument.createRange();
    range.selectNodeContents(body);
    range.setEndBefore(node);
    return range.toString().length;
  }

  function sourceText(node) {
    if (!node) return '';
    const found = recordFor(node);
    if (!found) return node.textContent || '';
    const { doc, record } = found;
    if (node === doc) return record.original;
    const offset = offsetBefore(node, doc.body);
    return record.original.slice(offset, offset + (node.textContent || '').length);
  }

  function sourceRange(range) {
    if (!range) return '';
    const found = recordFor(range.startContainer);
    if (!found || !found.doc.body.contains(range.endContainer)) return range.toString();
    const before = found.doc.createRange();
    before.selectNodeContents(found.doc.body);
    before.setEnd(range.startContainer, range.startOffset);
    const offset = before.toString().length;
    return found.record.original.slice(offset, offset + range.toString().length);
  }

  function apply(doc, enabled) {
    if (!doc || !doc.body) return false;
    const current = doc.body.textContent || '';
    let record = documents.get(doc);
    if (!record) {
      if (!enabled) return false;
      record = { original: current, display: current, enabled: false };
      documents.set(doc, record);
    } else if (current !== record.display) {
      // Preserve the unchanged source surrounding a publisher's live edit.
      // Highlight/annotation wrappers do not enter this branch: they keep text.
      let prefix = 0;
      let suffix = 0;
      while (prefix < current.length && prefix < record.display.length && current[prefix] === record.display[prefix]) prefix++;
      while (suffix < current.length - prefix && suffix < record.display.length - prefix && current[current.length - 1 - suffix] === record.display[record.display.length - 1 - suffix]) suffix++;
      record.original = record.original.slice(0, prefix) + current.slice(prefix, current.length - suffix) + (suffix ? record.original.slice(-suffix) : '');
    }
    const nodes = textNodes(doc.body);
    const converted = enabled ? toSimplified(record.original) : record.original;
    let offset = 0;
    let changed = false;
    for (const node of nodes) {
      const length = (node.textContent || '').length;
      const original = record.original.slice(offset, offset + length);
      const next = enabled && eligible(node, doc.body) ? converted.slice(offset, offset + length) : original;
      if (node.data !== next) { node.data = next; changed = true; }
      offset += length;
    }
    record.display = doc.body.textContent || '';
    record.enabled = !!enabled;
    return changed;
  }

  function restore(doc) { return apply(doc, false); }

  return { toSimplified, apply, restore, sourceText, sourceRange };
});
