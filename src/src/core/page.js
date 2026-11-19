'use strict';
// 网页变化监控：抓取页面 → 提取正文（可选 CSS 选择器 / 关键词范围）→ 与上次快照逐行比对
const crypto = require('crypto');
const { parse } = require('node-html-parser');

const BLOCK = /<\/?(p|div|li|ul|ol|h[1-6]|tr|td|th|table|section|article|header|footer|br|hr|dt|dd|button|a|span|label|summary|details|main|aside|figcaption|blockquote)\b[^>]*>/gi;
const DROP = 'script,style,noscript,svg,template,iframe,link,meta,img,video,picture,source';

function decode(s) {
  return s.replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ''; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ''; } });
}

function isBlocked(html) {
  return /<title>\s*(Just a moment|Attention Required|Access denied|请稍候)/i.test(html) || /cf-browser-verification|challenge-platform\/h\/b|captcha-delivery/i.test(html.slice(0, 20000));
}

// 返回规范化后的文本行
function extractLines(html, { selector = '', keyword = '' } = {}) {
  const root = parse(html, { comment: false, blockTextElements: { script: false, style: false, noscript: false, pre: true } });
  root.querySelectorAll(DROP).forEach((n) => n.remove());
  let nodes = [];
  if (selector) { try { nodes = root.querySelectorAll(selector); } catch { throw new Error('CSS 选择器无效：' + selector); } if (!nodes.length) throw new Error('页面中找不到选择器：' + selector); }
  if (!nodes.length) { root.querySelectorAll('nav,footer,[role=navigation],[aria-hidden=true]').forEach((n) => n.remove()); nodes = [root.querySelector('main') || root.querySelector('body') || root]; }
  const raw = nodes.map((n) => n.innerHTML).join('\n').replace(BLOCK, '\n').replace(/<[^>]+>/g, ' ');
  let lines = decode(raw).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length >= 2 && !/^[\W_]+$/.test(l));
  lines = lines.filter((l, i) => l !== lines[i - 1]);
  const kws = String(keyword || '').split(/[,，;；]/).map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (kws.length) {
    const keep = new Set();
    lines.forEach((l, i) => { if (kws.some((k) => l.toLowerCase().includes(k))) keep.add(i); });
    lines = lines.filter((_, i) => keep.has(i));
  }
  return lines.slice(0, 3000);
}

// 按行集合计算指纹：只调整顺序（A/B 排版）不算变化
function hashLines(lines) { return crypto.createHash('sha1').update([...new Set(lines)].sort().join('\n')).digest('hex').slice(0, 16); }

function diffLines(oldLines, newLines) {
  const o = new Set(oldLines); const n = new Set(newLines);
  return { added: newLines.filter((l) => !o.has(l)), removed: oldLines.filter((l) => !n.has(l)) };
}

function diffSnippet(d, max = 8) {
  const part = (arr, sign) => arr.slice(0, max).map((l) => `${sign} ${l.length > 160 ? l.slice(0, 160) + '…' : l}`).join('\n') + (arr.length > max ? `\n…（另有 ${arr.length - max} 行）` : '');
  return [d.added.length ? '新增内容：\n' + part(d.added, '+') : '', d.removed.length ? '移除内容：\n' + part(d.removed, '-') : ''].filter(Boolean).join('\n\n');
}

module.exports = { extractLines, hashLines, diffLines, diffSnippet, isBlocked };
