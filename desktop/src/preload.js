// Preload for the local Connect + Splash windows only (never for the remote server page).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yukti', {
  getConfig: () => ipcRenderer.invoke('yukti:getConfig'),
  test: (url) => ipcRenderer.invoke('yukti:test', url),
  browseRoot: () => ipcRenderer.invoke('yukti:browseRoot'),
  connect: (req) => ipcRenderer.invoke('yukti:connect', req),
  splashAction: (a) => ipcRenderer.invoke('yukti:splashAction', a),
  onLog: (fn) => ipcRenderer.on('splash:log', (_e, line) => fn(line)),
  onStatus: (fn) => ipcRenderer.on('splash:status', (_e, s) => fn(s)),
});
