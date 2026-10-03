'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  beginBookImport: (requestId) => ipcRenderer.invoke('book:import:begin', requestId),
  endBookImport: (requestId) => ipcRenderer.invoke('book:import:end', requestId),
  cancelBookImport: (requestId) => ipcRenderer.invoke('book:import:cancel', requestId),
  openFiles: (requestId) => ipcRenderer.invoke('dialog:openFiles', requestId),
  openFolder: (requestId) => ipcRenderer.invoke('dialog:openFolder', requestId),
  onBookImportProgress: (callback) => {
    const listener = (event, progress) => callback(progress);
    ipcRenderer.on('book:import:progress', listener);
    return () => ipcRenderer.removeListener('book:import:progress', listener);
  },
  readBook: (filePath) => ipcRenderer.invoke('book:read', filePath),
  metadata: (filePath, requestId) => ipcRenderer.invoke('book:metadata', filePath, requestId),
  mobiOpen: (filePath) => ipcRenderer.invoke('mobi:open', filePath),
  mobiChapter: (sessionId, index) => ipcRenderer.invoke('mobi:chapter', { sessionId, index }),
  mobiResolveHref: (sessionId, href) => ipcRenderer.invoke('mobi:resolve-href', { sessionId, href }),
  mobiClose: (sessionId) => ipcRenderer.invoke('mobi:close', sessionId),
  stateGet: (key) => ipcRenderer.invoke('state:get', key),
  stateSet: (key, value) => ipcRenderer.invoke('state:set', { key, value }),
  searchIndexGet: (filePath) => ipcRenderer.invoke('search:index:get', filePath),
  searchIndexSet: (filePath, sections) => ipcRenderer.invoke('search:index:set', { filePath, sections }),
  aiProfilesGet: () => ipcRenderer.invoke('ai:profiles:get'),
  aiProfileSave: (profile) => ipcRenderer.invoke('ai:profile:save', profile),
  aiProfileActivate: (profileId) => ipcRenderer.invoke('ai:profile:activate', profileId),
  aiProfileDelete: (profileId) => ipcRenderer.invoke('ai:profile:delete', profileId),
  aiProfileTest: (profileId) => ipcRenderer.invoke('ai:profile:test', profileId),
  aiProfileModels: (profileId) => ipcRenderer.invoke('ai:profile:models', profileId),
  aiChat: (payload) => ipcRenderer.invoke('ai:chat', payload),
  aiChatCancel: (requestId) => ipcRenderer.invoke('ai:chat:cancel', requestId),
  aiAliceComment: (payload) => ipcRenderer.invoke('ai:alice-comment', payload),
  dictionaryOpen: (query) => ipcRenderer.invoke('dictionary:open', query),
  searchWeb: (query, options) => ipcRenderer.invoke('selection:search', { query, ...(options || {}) }),
  exists: (filePath) => ipcRenderer.invoke('file:exists', filePath),
  displayFrequency: () => ipcRenderer.invoke('display:frequency'),
  softwareRendering: () => ipcRenderer.invoke('graphics:software-rendering'),
  onDisplayFrequencyChanged: (callback) => {
    const listener = (event, frequency) => callback(frequency);
    ipcRenderer.on('display:frequency-changed', listener);
    return () => ipcRenderer.removeListener('display:frequency-changed', listener);
  },
  isWindowFocused: () => ipcRenderer.invoke('window:is-focused'),
  onWindowFocusChanged: (callback) => {
    const listener = (event, focused) => callback(!!focused);
    ipcRenderer.on('window:focus-changed', listener);
    return () => ipcRenderer.removeListener('window:focus-changed', listener);
  },
});
