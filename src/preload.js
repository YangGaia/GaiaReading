'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readBook: (filePath) => ipcRenderer.invoke('book:read', filePath),
  metadata: (filePath) => ipcRenderer.invoke('book:metadata', filePath),
  mobiOpen: (filePath) => ipcRenderer.invoke('mobi:open', filePath),
  mobiChapter: (sessionId, index) => ipcRenderer.invoke('mobi:chapter', { sessionId, index }),
  mobiClose: (sessionId) => ipcRenderer.invoke('mobi:close', sessionId),
  stateGet: (key) => ipcRenderer.invoke('state:get', key),
  stateSet: (key, value) => ipcRenderer.invoke('state:set', { key, value }),
  aiProfilesGet: () => ipcRenderer.invoke('ai:profiles:get'),
  aiProfileSave: (profile) => ipcRenderer.invoke('ai:profile:save', profile),
  aiProfileActivate: (profileId) => ipcRenderer.invoke('ai:profile:activate', profileId),
  aiProfileDelete: (profileId) => ipcRenderer.invoke('ai:profile:delete', profileId),
  aiProfileTest: (profileId) => ipcRenderer.invoke('ai:profile:test', profileId),
  aiProfileModels: (profileId) => ipcRenderer.invoke('ai:profile:models', profileId),
  aiChat: (payload) => ipcRenderer.invoke('ai:chat', payload),
  aiAliceComment: (payload) => ipcRenderer.invoke('ai:alice-comment', payload),
  dictionaryOpen: (query) => ipcRenderer.invoke('dictionary:open', query),
  searchWeb: (query, options) => ipcRenderer.invoke('selection:search', { query, ...(options || {}) }),
  exists: (filePath) => ipcRenderer.invoke('file:exists', filePath),
  displayFrequency: () => ipcRenderer.invoke('display:frequency'),
  onDisplayFrequencyChanged: (callback) => {
    const listener = (event, frequency) => callback(frequency);
    ipcRenderer.on('display:frequency-changed', listener);
    return () => ipcRenderer.removeListener('display:frequency-changed', listener);
  },
});
