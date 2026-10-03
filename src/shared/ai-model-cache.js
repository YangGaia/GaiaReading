'use strict';

const crypto = require('node:crypto');
const { compareModels } = require('./ai-models');

function scopeOf(profile, apiKey) {
  return crypto.createHash('sha256').update(JSON.stringify([profile.provider, profile.baseUrl, String(apiKey || '').trim()])).digest('hex');
}

class AiModelCache {
  constructor(store) {
    this.store = store;
  }

  read(profile, apiKey) {
    const entries = this.store.get('aiModelCatalogs', {}) || {};
    const entry = entries[profile.id || 'draft'];
    if (!entry || entry.scope !== scopeOf(profile, apiKey) || !Array.isArray(entry.models)) return null;
    return { models: entry.models, updatedAt: entry.updatedAt, added: entry.added || [], removed: entry.removed || [] };
  }

  save(profile, apiKey, models, now = Date.now()) {
    const entries = this.store.get('aiModelCatalogs', {}) || {};
    const previous = this.read(profile, apiKey);
    const changes = previous ? compareModels(previous.models, models) : { added: [], removed: [] };
    const entry = { models, updatedAt: now, ...changes };
    entries[profile.id || 'draft'] = { ...entry, scope: scopeOf(profile, apiKey) };
    this.store.set('aiModelCatalogs', entries);
    return entry;
  }

  adoptDraft(profile, apiKey) {
    const entry = this.read({ ...profile, id: 'draft' }, apiKey);
    if (entry) this.save(profile, apiKey, entry.models, entry.updatedAt);
  }

  remove(profileId) {
    const entries = this.store.get('aiModelCatalogs', {}) || {};
    delete entries[profileId];
    this.store.set('aiModelCatalogs', entries);
  }
}

module.exports = { AiModelCache };
