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
  aiConfigGet: () => ipcRenderer.invoke('ai:config:get'),
  aiConfigSet: (config) => ipcRenderer.invoke('ai:config:set', config),
  aiConfigTest: () => ipcRenderer.invoke('ai:config:test'),
  aiSummarize: (source) => ipcRenderer.invoke('ai:summarize', source),
  exists: (filePath) => ipcRenderer.invoke('file:exists', filePath),
  displayFrequency: () => ipcRenderer.invoke('display:frequency'),
  onDisplayFrequencyChanged: (callback) => {
    const listener = (event, frequency) => callback(frequency);
    ipcRenderer.on('display:frequency-changed', listener);
    return () => ipcRenderer.removeListener('display:frequency-changed', listener);
  },
});
