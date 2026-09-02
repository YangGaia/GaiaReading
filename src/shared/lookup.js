'use strict';

const DICTIONARY_HOSTS = new Set(['dict.youdao.com']);
const SEARCH_ENGINES = Object.freeze({
  google: Object.freeze({ label: 'Google', template: 'https://www.google.com/search?q={query}' }),
  bing: Object.freeze({ label: 'Bing', template: 'https://www.bing.com/search?q={query}' }),
  baidu: Object.freeze({ label: '百度', template: 'https://www.baidu.com/s?wd={query}' }),
  custom: Object.freeze({ label: '自定义', template: '' }),
});

function normalizeLookupText(value, maxChars) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('没有可查询的文字');
  const limit = Math.max(1, Number(maxChars) || 80);
  return Array.from(text).slice(0, limit).join('');
}

function dictionaryUrl(value) {
  return 'https://dict.youdao.com/search?q=' + encodeURIComponent(normalizeLookupText(value, 80));
}

function normalizeSearchEngine(value) {
  const engine = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SEARCH_ENGINES, engine) ? engine : 'google';
}

function normalizeCustomSearchTemplate(value) {
  const template = String(value || '').trim();
  if (!template) throw new Error('请填写自定义搜索网址');
  if (!template.includes('{query}')) throw new Error('自定义搜索网址必须包含 {query}');
  const schemeEnd = template.indexOf('://');
  const authorityEnd = template.indexOf('/', schemeEnd + 3);
  if (template.indexOf('{query}') < (authorityEnd < 0 ? template.length : authorityEnd)) {
    throw new Error('{query} 不能出现在网站域名中');
  }
  let parsed;
  try {
    parsed = new URL(template.replaceAll('{query}', 'gaia-query'));
  } catch (error) {
    throw new Error('自定义搜索网址格式不正确');
  }
  if (parsed.protocol !== 'https:') throw new Error('自定义搜索网址必须使用 HTTPS');
  if (parsed.username || parsed.password) throw new Error('自定义搜索网址不能包含账号或密码');
  return template;
}

function searchUrl(value, options) {
  const input = options && typeof options === 'object' ? options : {};
  const engine = normalizeSearchEngine(input.engine);
  const template = engine === 'custom' ? normalizeCustomSearchTemplate(input.customTemplate) : SEARCH_ENGINES[engine].template;
  return template.replaceAll('{query}', encodeURIComponent(normalizeLookupText(value, 200)));
}

function searchEngineLabel(value) {
  return SEARCH_ENGINES[normalizeSearchEngine(value)].label;
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
  SEARCH_ENGINES,
  normalizeSearchEngine,
  normalizeCustomSearchTemplate,
  searchUrl,
  searchEngineLabel,
  isAllowedDictionaryUrl,
};
