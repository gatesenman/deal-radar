'use strict';
// JS 渲染采集：用隐藏（离屏）BrowserWindow 打开页面，等待公开页面脚本执行；遇到验证立即停止，不绕过验证
const { BrowserWindow, session } = require('electron');

const { assertPublicURL } = require('./core/network-policy');
const guard = (u) => require('./core/network-policy').isLoginURL(u)? Promise.reject(new Error('login-required: Authentication redirect; no sign-in attempted')):assertPublicURL(u, { lookup: require('node:dns').promises.lookup });
const guarded = new WeakSet();
const observers = new WeakMap();
let active = 0; const queue = [];
const MAX = 2;
function acquire() { return new Promise((res) => { if (active < MAX) { active++; res(); } else queue.push(res); }); }
function release() { active--; const n = queue.shift(); if (n) { active++; n(); } }

const CHALLENGE = /just a moment|checking your browser|cf-browser-verification|challenge-platform|verify you are human|请稍候|安全验证/i;

async function renderHTML(url, { timeout = 45000, wait = 2500, ua, partition = 'render-public', observe } = {}) {
  await guard(url);
  await acquire();
  const ses = session.fromPartition(partition);
  if (!guarded.has(ses)) {
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'file://*/*', 'ws://*/*', 'wss://*/*'] }, (details, cb) => { guard(details.url).then(() => cb({ cancel: false }), () => cb({ cancel: true })); });
    observers.set(ses,new Map());
    ses.webRequest.onHeadersReceived((details,cb)=>{const fn=observers.get(ses)?.get(details.webContentsId);let blocked=false;if(details.resourceType==='mainFrame'&&fn)blocked=fn(details);cb(blocked?{cancel:true}:{});});
    guarded.add(ses);
  }
  const w = new BrowserWindow({ show: false, width: 1366, height: 900, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, javascript: true, images: false, session: ses } });
  w.webContents.setAudioMuted(true);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const wcId=w.webContents.id;let mainStatus=0;
  observers.get(ses).set(wcId,details=>{mainStatus=details.statusCode;observe?.({url:details.url,status:details.statusCode,headers:Object.fromEntries(Object.entries(details.responseHeaders||{}).filter(([k])=>/^(content-type|location|retry-after|etag|last-modified)$/i.test(k)))});return [401,403,429].includes(mainStatus);});
  const t0 = Date.now();
  try {
    let loadTimer;
    const ok = await Promise.race([
      w.loadURL(url, ua ? { userAgent: ua } : undefined).then(() => true, (e) => { if(mainStatus>=400)throw new Error('HTTP '+mainStatus);if (/ERR_ABORTED/.test(e.message)) return true; throw e; }),
      new Promise((_, rej) => { loadTimer = setTimeout(() => rej(new Error('渲染超时（' + timeout / 1000 + 's）')), timeout); }),
    ]).finally(() => clearTimeout(loadTimer));
    if(mainStatus>=400)throw new Error('HTTP '+mainStatus);
    if (!ok) throw new Error('页面加载失败');
    let html = '';
    // 等待公开脚本；验证页立即停止。
    for (;;) {
      await new Promise((r) => setTimeout(r, wait));
      html = await w.webContents.executeJavaScript('document.documentElement.outerHTML', true);
      const title = await w.webContents.executeJavaScript('document.title', true);
      if (!CHALLENGE.test(title + html.slice(0, 4000))) break;
      throw new Error('SOURCE_BLOCKED: challenge page; no bypass attempted');
    }
    return html;
  } finally { observers.get(ses)?.delete(wcId);try { w.destroy(); } catch { /* 忽略 */ } release(); }
}

module.exports = { renderHTML };
