// Preload for the main window. The same window shows local pages (setup / install / startup, loaded from file://)
// and later the Yukti web app from the server. The bridge is exposed ONLY on the local file:// pages — the remote
// server page gets no IPC access at all (main.js additionally rejects IPC from any non-file:// frame).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  const on = (ch) => (fn) => {
    const h = (_e, v) => fn(v);
    ipcRenderer.on(ch, h);
    return () => ipcRenderer.removeListener(ch, h);
  };
  contextBridge.exposeInMainWorld('yukti', {
    // setup page
    getConfig: () => ipcRenderer.invoke('yukti:getConfig'),
    test: (url) => ipcRenderer.invoke('yukti:test', url),
    browseRoot: () => ipcRenderer.invoke('yukti:browseRoot'),
    connect: (req) => ipcRenderer.invoke('yukti:connect', req),
    plan: (req) => ipcRenderer.invoke('yukti:plan', req),
    install: (req) => ipcRenderer.invoke('yukti:install', req),
    cancelInstall: () => ipcRenderer.invoke('yukti:cancelInstall'),
    back: () => ipcRenderer.invoke('yukti:back'),
    openLogs: (which) => ipcRenderer.invoke('yukti:openLogs', which),
    setLang: (l) => ipcRenderer.invoke('yukti:setLang', l),
    report: (req) => ipcRenderer.invoke('yukti:report', req),
    onInstallProgress: on('install:progress'),
    // add-ons page
    featuresPlan: () => ipcRenderer.invoke('yukti:featuresPlan'),
    featureInstall: (f) => ipcRenderer.invoke('yukti:featureInstall', f),
    featureRemove: (f) => ipcRenderer.invoke('yukti:featureRemove', f),
    featuresDone: (req) => ipcRenderer.invoke('yukti:featuresDone', req),
    // startup page
    splashInit: () => ipcRenderer.invoke('yukti:splashInit'),
    splashAction: (a) => ipcRenderer.invoke('yukti:splashAction', a),
    onLog: on('splash:log'),
    onStatus: on('splash:status'),
  });
}
