(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('opencc-js') : root.OpenCC);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GaiaChineseScript = api;
})(typeof self !== 'undefined' ? self : this, function (opencc) {
  'use strict';

  const dictionaries = new Map();

  function normalizeMode(value) {
    return value === 'simplified' || value === 'traditional' ? value : null;
  }

  function dictionary(mode) {
    if (!dictionaries.has(mode)) {
      const trie = new opencc.Trie();
      const groups = mode === 'traditional' ? opencc.Locale.from.cn : opencc.Locale.to.cn;
      for (const group of groups) trie.loadDictGroup(group);
      dictionaries.set(mode, trie);
    }
    return dictionaries.get(mode);
  }

  function convertWithMap(value, mode) {
    const source = String(value || '');
    const selected = normalizeMode(mode);
    const trie = selected && dictionary(selected);
    const sourceToTarget = new Uint32Array(source.length + 1);
    const targetToSource = [];
    let text = '';
    for (let offset = 0; offset < source.length;) {
      const matched = trie && trie.matchPrefix(source, offset);
      const end = matched ? matched.end : offset + (source.codePointAt(offset) > 0xffff ? 2 : 1);
      const replacement = matched ? matched.value : source.slice(offset, end);
      const before = Array.from(source.slice(offset, end));
      const after = Array.from(replacement);
      const aligned = before.length === after.length;
      let sourceOffset = offset;
      let targetOffset = text.length;
      for (let index = 0; index < before.length; index++) {
        const sourceWidth = before[index].length;
        const targetWidth = aligned ? after[index].length : 0;
        for (let unit = 0; unit < sourceWidth; unit++) sourceToTarget[sourceOffset + unit] = aligned ? targetOffset : text.length;
        if (aligned) {
          for (let unit = 0; unit < targetWidth; unit++) targetToSource[targetOffset + unit] = sourceOffset;
          targetOffset += targetWidth;
        }
        sourceOffset += sourceWidth;
      }
      if (!aligned) for (let unit = 0; unit < replacement.length; unit++) targetToSource[text.length + unit] = offset;
      text += replacement;
      sourceToTarget[end] = text.length;
      targetToSource[text.length] = end;
      offset = end;
    }
    if (!source.length) targetToSource[0] = 0;
    return { text, sourceToTarget, targetToSource };
  }

  function convert(value, mode) {
    const selected = normalizeMode(mode);
    return selected ? dictionary(selected).convert(String(value || '')) : String(value || '');
  }

  function detect(value) {
    const sample = String(value || '').slice(0, 24000);
    const simple = convertWithMap(sample, 'simplified');
    const traditionalText = convertWithMap(sample, 'traditional');
    let simplified = 0;
    let traditional = 0;
    let offset = 0;
    for (const character of sample) {
      const start = offset;
      offset += character.length;
      if (!/\p{Script=Han}/u.test(character)) continue;
      const toSimple = simple.text.slice(simple.sourceToTarget[start], simple.sourceToTarget[offset]);
      const toTraditional = traditionalText.text.slice(traditionalText.sourceToTarget[start], traditionalText.sourceToTarget[offset]);
      if (toSimple === character && toTraditional !== character) simplified++;
      if (toTraditional === character && toSimple !== character) traditional++;
    }
    return traditional > simplified ? 'traditional' : 'simplified';
  }

  function chooseMode(preference, sample) {
    return normalizeMode(preference) || detect(sample);
  }

  function label(mode) {
    return mode === 'traditional' ? '繁体' : '简体';
  }

  return { normalizeMode, convert, convertWithMap, detect, chooseMode, label };
});
