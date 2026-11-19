'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = async (ch, ...a) => { const r = await ipcRenderer.invoke(ch, ...a); if (!r.ok) throw new Error(r.error); return r.data; };
let i18n = { lang: 'zh-CN', dict: {}, langs: [] };
try { i18n = ipcRenderer.sendSync('i18n:sync') || i18n; } catch {}
contextBridge.exposeInMainWorld('i18nData', i18n);
contextBridge.exposeInMainWorld('api', {
  call,
  on: (ch, fn) => { const h = (_e, p) => fn(p); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); },
  platform: process.platform,
});
