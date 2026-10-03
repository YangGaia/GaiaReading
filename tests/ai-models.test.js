'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../src/shared/ai-models');
const { listModelCatalog, listModels } = require('../src/shared/ai');
const { AiModelCache } = require('../src/shared/ai-model-cache');

const config = { id: 'profile-one', provider: 'custom', baseUrl: 'https://relay.example/v1', model: '' };
const response = data => ({ ok: true, status: 200, json: async () => data });

test('识别模型系列、保留完整 ID，默认 owned_by 不覆盖名称且不猜测能力', () => {
  const models = catalog.extractModels({ data: [
    { id: 'relay/claude-latest', owned_by: 'openai' },
    { id: 'vendor/private', provider: 'google', capabilities: ['text', 'vision'] },
    { id: 'gpt-new-model' }, { id: 'o3-mini' }, { id: 'Qwen/Qwen-Next' },
    { id: 'glm-new' }, { id: 'deepseek-next' }, { id: 'meta/llama-new' },
    { id: 'mixtral-new' }, { id: 'kimi-new' }, { id: 'unrecognised-model' },
  ] });
  assert.deepEqual(models.map(model => model.family), ['Claude', 'Gemini', 'GPT', 'GPT', 'Qwen', 'GLM', 'DeepSeek', 'Llama', 'Mistral', 'Kimi', '其他']);
  assert.equal(models[0].id, 'relay/claude-latest');
  assert.deepEqual(models[0].capabilities, []);
  assert.deepEqual(models[1].capabilities, ['文本', '图像']);
  assert.equal(catalog.groupModels(models, 'relay/claude', 'Claude')[0].models.length, 1);
  assert.equal(catalog.groupModels(models, 'claude', 'GPT').length, 0);
});

test('分页合并去重并保留超过 200 个模型，每次刷新请求上游且不要求已选模型', async () => {
  const requests = [];
  const first = Array.from({ length: 260 }, (_, index) => ({ id: 'private-' + index }));
  const fetch = async (url, options) => {
    requests.push({ url, options });
    return response(url.includes('after=') ? { data: [{ id: 'private-259' }, { id: 'claude-new' }] } : { data: first, has_more: true, last_id: 'private-259' });
  };
  const models = await listModelCatalog(fetch, config, 'test-key');
  assert.equal(models.length, 261);
  assert.equal(models.at(-1).family, 'Claude');
  assert.equal(requests[1].url, 'https://relay.example/v1/models?after=private-259');
  assert.ok(requests.every(request => request.options.cache === 'no-store' && request.options.redirect === 'error'));
  assert.deepEqual(await listModels(async () => response({ models: [{ name: 'qwen:latest' }] }), config, 'test-key'), ['qwen:latest']);
});

test('阻止分页跨域携带密钥、重复分页、无游标截断和错误响应', async () => {
  let calls = 0;
  await assert.rejects(listModelCatalog(async () => { calls++; return response({ data: ['gpt-one'], next: 'https://other.example/models' }); }, config, 'test-key'), /同一接口/);
  assert.equal(calls, 1);
  await assert.rejects(listModelCatalog(async () => response({ data: [], next: '/v1/models' }), config, 'test-key'), /分页异常/);
  await assert.rejects(listModelCatalog(async () => response({ data: [], has_more: true }), config, 'test-key'), /游标/);
  await assert.rejects(listModelCatalog(async () => response({ unexpected: [] }), config, 'test-key'), /格式/);
  await assert.rejects(listModelCatalog(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid key' } }) }), config, 'test-key'), /401.*invalid key/);
});

test('空列表可表达全部下架，模型增删准确且未知系列可选择', async () => {
  assert.deepEqual(await listModelCatalog(async () => response({ data: [] }), config, 'key'), []);
  assert.deepEqual(catalog.compareModels([{ id: 'old' }, { id: 'kept' }], [{ id: 'kept' }, { id: 'new' }]), { added: ['new'], removed: ['old'] });
  assert.equal(catalog.groupModels(catalog.extractModels(['unknown-new']))[0].name, '其他');
});

test('缓存按档案、接口和 Key 隔离，保存时间和更新差异，普通 JSON 不含 Key', () => {
  let data = {};
  const store = { get: (key, fallback) => data[key] || fallback, set: (key, value) => { data[key] = JSON.parse(JSON.stringify(value)); } };
  const cache = new AiModelCache(store);
  const first = catalog.extractModels(['gpt-old', 'claude-current']);
  cache.save(config, 'sensitive-test-key', first, 100);
  assert.equal(new AiModelCache(store).read(config, 'sensitive-test-key').updatedAt, 100);
  assert.equal(cache.read({ ...config, id: 'profile-two' }, 'sensitive-test-key'), null);
  assert.equal(cache.read({ ...config, baseUrl: 'https://other.example/v1' }, 'sensitive-test-key'), null);
  assert.equal(cache.read(config, 'different-key'), null);
  const second = cache.save(config, 'sensitive-test-key', catalog.extractModels(['claude-current', 'gpt-new']), 200);
  assert.deepEqual(second.added, ['gpt-new']);
  assert.deepEqual(second.removed, ['gpt-old']);
  assert.ok(!JSON.stringify(data).includes('sensitive-test-key'));
  cache.save({ ...config, id: 'draft' }, 'draft-key', first, 300);
  cache.adoptDraft({ ...config, id: 'new-profile' }, 'draft-key');
  assert.equal(cache.read({ ...config, id: 'new-profile' }, 'draft-key').updatedAt, 300);
  cache.remove('new-profile');
  assert.equal(cache.read({ ...config, id: 'new-profile' }, 'draft-key'), null);
});
