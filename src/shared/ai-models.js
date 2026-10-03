(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GaiaAiModels = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FAMILIES = ['GPT', 'Claude', 'Gemini', 'DeepSeek', 'Qwen', 'GLM', 'Llama', 'Mistral', 'Kimi', '其他'];
  const rules = [
    ['GPT', /(?:^|[\s/_.:-])(?:gpt|chatgpt|o[1-9])(?:$|[\d\s/_.:-])/i, /openai/i],
    ['Claude', /claude/i, /anthropic/i],
    ['Gemini', /gemini|gemma/i, /google/i],
    ['DeepSeek', /deepseek/i, /deepseek/i],
    ['Qwen', /qwen|qwq|qvq|通义/i, /alibaba|qwen|aliyun/i],
    ['GLM', /(?:^|[\s/_.:-])(?:chat)?glm|智谱/i, /zhipu|z\.ai/i],
    ['Llama', /llama/i, /meta/i],
    ['Mistral', /mistral|mixtral|codestral|ministral|pixtral|magistral|devstral/i, /mistral/i],
    ['Kimi', /kimi|moonshot/i, /moonshot/i],
  ];

  function familyOf(model) {
    const explicit = String(model.provider || '');
    const provider = rules.find(rule => rule[2].test(explicit));
    if (provider) return provider[0];
    const named = rules.find(rule => rule[1].test(model.id));
    if (named) return named[0];
    const owned = rules.find(rule => rule[2].test(String(model.owner || '')));
    return owned ? owned[0] : '其他';
  }

  function capabilitiesOf(model) {
    const values = [model.type, model.task];
    for (const field of ['capabilities', 'modalities', 'output_modalities']) {
      const value = model[field];
      if (Array.isArray(value)) values.push(...value);
      else if (value && typeof value === 'object') values.push(...Object.keys(value).filter(key => value[key] === true));
    }
    const text = values.filter(value => typeof value === 'string').join(' ').toLowerCase();
    const labels = [];
    if (/chat|text|completion/.test(text)) labels.push('文本');
    if (/reason/.test(text)) labels.push('推理');
    if (/image|vision/.test(text)) labels.push('图像');
    if (/audio|speech|tts|transcrib/.test(text)) labels.push('语音');
    if (/embed|vector/.test(text)) labels.push('向量');
    return labels;
  }

  function extractModels(value) {
    const candidates = Array.isArray(value) ? value : value && Array.isArray(value.data) ? value.data : value && Array.isArray(value.models) ? value.models : [];
    const models = new Map();
    for (const entry of candidates) {
      const source = typeof entry === 'string' ? { id: entry } : entry || {};
      const id = String(source.id || source.name || source.model || '').trim();
      if (!id || models.has(id)) continue;
      const model = { id, owner: String(source.owned_by || source.owner || '').slice(0, 160), provider: String(source.provider || '').slice(0, 160) };
      model.family = familyOf(model);
      model.capabilities = capabilitiesOf(source);
      models.set(id, model);
    }
    return Array.from(models.values());
  }

  function groupModels(models, filter, family) {
    const needle = String(filter || '').trim().toLowerCase();
    return FAMILIES.map(name => ({
      name,
      models: models.filter(model => model.family === name && (!family || family === name) && (!needle || [model.id, model.owner, model.family].join(' ').toLowerCase().includes(needle)))
        .slice().sort((left, right) => left.id.localeCompare(right.id, 'en', { numeric: true })),
    })).filter(group => group.models.length);
  }

  function compareModels(previous, next) {
    const before = new Set((previous || []).map(model => model.id));
    const after = new Set((next || []).map(model => model.id));
    return { added: next.filter(model => !before.has(model.id)).map(model => model.id), removed: (previous || []).filter(model => !after.has(model.id)).map(model => model.id) };
  }

  function nextPageUrl(data, currentUrl, initialUrl) {
    let next = data && (data.next || data.next_page || data.links && data.links.next);
    if (next && typeof next === 'object') next = next.href;
    let result;
    if (typeof next === 'string' && next) result = new URL(next, currentUrl);
    else if (data && (data.next_cursor || data.has_more === true && data.last_id)) {
      result = new URL(currentUrl);
      result.searchParams.set(data.next_cursor ? 'cursor' : 'after', data.next_cursor || data.last_id);
    } else if (data && data.has_more === true) throw new Error('上游模型列表尚未完整返回，但未提供下一页游标');
    else return null;
    const initial = new URL(initialUrl);
    if (result.origin !== initial.origin || result.pathname.replace(/\/$/, '') !== initial.pathname.replace(/\/$/, '') || result.username || result.password || result.hash) {
      throw new Error('上游模型分页地址必须保持同一接口，已停止读取');
    }
    return result.href;
  }

  return { FAMILIES, familyOf, extractModels, groupModels, compareModels, nextPageUrl };
});
