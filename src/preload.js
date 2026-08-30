'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readBook: (filePath) => ipcRenderer.invoke('book:read', filePath),
  metadata: (filePath) => ipcRenderer.invoke('book:metadata', filePath),
  stateGet: (key) => ipcRenderer.invoke('state:get', key),
  stateSet: (key, value) => ipcRenderer.invoke('state:set', { key, value }),
  exists: (filePath) => ipcRenderer.invoke('file:exists', filePath),
});
