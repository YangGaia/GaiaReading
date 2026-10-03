'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PROVIDERS } = require('../src/shared/ai');
const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
const ai = html.slice(html.indexOf('<div id="ai-view"'), html.indexOf('<div id="library-view"'));

test('AI 中心保留全部配置控件、标签、状态与密码保护', () => {
  const controls = ['btn-ai-back', 'btn-ai-profile-new', 'btn-ai-profile-delete', 'btn-ai-key-toggle', 'btn-ai-key-clear', 'btn-ai-model-menu', 'btn-ai-model-refresh', 'btn-ai-test', 'btn-ai-save', 'ai-profile-list', 'ai-profile-name', 'ai-provider', 'ai-base-url', 'ai-api-key', 'ai-model', 'ai-model-options', 'ai-model-hint', 'ai-config-status', 'ai-config-target', 'ai-center-top-state', 'ai-center-badge'];
  for (const id of controls) assert.equal((ai.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
  for (const id of ['ai-profile-name', 'ai-provider', 'ai-base-url', 'ai-api-key', 'ai-model']) assert.ok(ai.includes(`for="${id}"`), id);
  assert.match(ai, /id="ai-api-key"[^>]+type="password"/);
  assert.match(ai, /id="ai-config-status"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(ai, /id="ai-model-options"[^>]+role="listbox"[^>]+hidden/);
  assert.match(ai, /class="ai-profile-ornament" aria-hidden="true"/);
  assert.doesNotMatch(ai, /ai-center-orb|ai-center-hero|deerflow|2\.jpeg/);
});

test('接口目录优先于内置候选，未获取目录时保留建议，手动输入保持开放', () => {
  let catalog = { models: require('../src/shared/ai-models').extractModels(['relay/private']) };
  const context = vm.createContext({ AI_PROVIDERS: PROVIDERS, els: { aiProvider: { value: 'custom' } }, currentAiModelCatalog: () => catalog, window: { GaiaAiModels: require('../src/shared/ai-models') } });
  vm.runInContext(app.slice(app.indexOf('function aiModelChoices()'), app.indexOf('function setAiModelMenuOpen(')), context);
  const result = context.aiModelChoices();
  assert.deepEqual(Array.from(result.ids), ['relay/private']);
  catalog = null;
  assert.equal(context.aiModelChoices().ids[0], 'gpt-6-astra');
  context.els.aiProvider.value = 'openai';
  assert.equal(context.aiModelChoices().ids.filter((id) => id === 'gpt-6-astra').length, 1);
  assert.match(ai, /id="ai-model"[^>]+type="text"/);
});

test('切换到自定义接口时新增预设不会覆盖填写的 ID，OpenAI 保持原默认模型', () => {
  const els = { aiProvider: { value: 'custom' }, aiBaseUrl: { value: 'https://relay.example/v1' }, aiModel: { value: 'relay/private' }, aiApiKey: {} };
  const context = vm.createContext({ els, AI_PROVIDERS: PROVIDERS, editingAiProfile: () => null, $: () => ({}), updateAiModelOptions() {}, updateAiTarget() {}, setAiConfigStatus() {} });
  vm.runInContext(app.slice(app.indexOf('function changeAiProvider()'), app.indexOf('function decodedHrefFragment(')), context);
  context.changeAiProvider();
  assert.equal(els.aiModel.value, 'relay/private');
  assert.equal(els.aiBaseUrl.value, 'https://relay.example/v1');
  els.aiModel.value = '';
  context.changeAiProvider();
  assert.equal(els.aiModel.value, '');
  els.aiProvider.value = 'openai';
  context.changeAiProvider();
  assert.equal(els.aiModel.value, 'gpt-5.6-luna');
  assert.equal(els.aiBaseUrl.value, PROVIDERS.openai.baseUrl);
});
