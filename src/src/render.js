'use strict';
// JS 渲染采集：用隐藏（离屏）BrowserWindow 打开页面，等待脚本执行与人机验证自动通过，再取渲染后的 HTML
const { BrowserWindow, session } = require('electron');

let active = 0; const queue = [];
const MAX = 2;
function acquire() { return new Promise((res) => { if (active < MAX) { active++; res(); } else queue.push(res); }); }
function release() { active--; const n = queue.shift(); if (n) { active++; n(); } }

const CHALLENGE = /just a moment|checking your browser|cf-browser-verification|challenge-platform|verify you are human|请稍候|安全验证/i;

async function renderHTML(url, { timeout = 45000, wait = 2500, ua, partition = 'persist:render' } = {}) {
  await acquire();
  const ses = session.fromPartition(partition);
  const w = new BrowserWindow({ show: false, width: 1366, height: 900, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, javascript: true, images: false, session: ses } });
  w.webContents.setAudioMuted(true);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const t0 = Date.now();
  try {
    const ok = await Promise.race([
      w.loadURL(url, ua ? { userAgent: ua } : undefined).then(() => true, (e) => { if (/ERR_ABORTED/.test(e.message)) return true; throw e; }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('渲染超时（' + timeout / 1000 + 's）')), timeout)),
    ]);
    if (!ok) throw new Error('页面加载失败');
    let html = '';
    // 等待脚本渲染；若遇到 Cloudflare 等验证页，最多等待其自动通过
    for (;;) {
      await new Promise((r) => setTimeout(r, wait));
      html = await w.webContents.executeJavaScript('document.documentElement.outerHTML', true);
      const title = await w.webContents.executeJavaScript('document.title', true);
      if (!CHALLENGE.test(title + html.slice(0, 4000))) break;
      if (Date.now() - t0 > timeout) throw new Error('网站人机验证未能自动通过（需要人工验证）');
    }
    return html;
  } finally { try { w.destroy(); } catch { /* 忽略 */ } release(); }
}

module.exports = { renderHTML };
