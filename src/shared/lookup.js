'use strict';

const DICTIONARY_HOSTS = new Set(['dict.youdao.com']);

function normalizeLookupText(value, maxChars) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('没有可查询的文字');
  const limit = Math.max(1, Number(maxChars) || 80);
  return Array.from(text).slice(0, limit).join('');
}

function dictionaryUrl(value) {
  return 'https://dict.youdao.com/search?q=' + encodeURIComponent(normalizeLookupText(value, 80));
}

function searchUrl(value) {
  return 'https://www.baidu.com/s?wd=' + encodeURIComponent(normalizeLookupText(value, 200));
}

function isAllowedDictionaryUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'https:' && DICTIONARY_HOSTS.has(parsed.hostname.toLowerCase());
  } catch (error) {
    return false;
  }
}

module.exports = {
  normalizeLookupText,
  dictionaryUrl,
  searchUrl,
  isAllowedDictionaryUrl,
};
