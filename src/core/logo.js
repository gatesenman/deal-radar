'use strict';
// 运行时：为用户添加 / AI 发现的厂商抓取官网图标，缓存到 userData/logos/<id>.<ext>
const fs = require('fs');
const path = require('path');
const NOT_VENDOR = /(^|\.)(google|googleusercontent|bing|reddit|twitter|x|youtube|weibo|v2ex|rsshub|feedburner|github\.io|medium|substack|zhihu|bilibili|toutiao|baidu|wechat|qq|t)\.(com|cn|io|co|app)$|news\.google/i;
const MAGIC = [[/^\x89PNG/, 'png'], [/^\xff\xd8\xff/, 'jpg'], [/^\x00\x00\x01\x00/, 'ico'], [/^GIF8/, 'gif'], [/^RIFF....WEBP/s, 'webp']];
function sniff(buf) {
  const head = buf.subarray(0, 16).toString('latin1');
  for (const [re, ext] of MAGIC) if (re.test(head)) return ext;
  const t = buf.subarray(0, 600).toString('utf8');
  if (/<svg[\s>]/i.test(t) && !/<script/i.test(buf.toString('utf8'))) return 'svg';
  return null;
}
function iconLinks(html, base) {
  const out = [];
  for (const m of html.matchAll(/<link[^>]+>/gi)) {
    const tag = m[0]; const rel = /rel=["']([^"']+)/i.exec(tag); const href = /href=["']([^"']+)/i.exec(tag);
    if (!rel || !href || !/icon/i.test(rel[1]) || /mask/i.test(rel[1])) continue;
    const sz = /sizes=["'](\d+)/i.exec(tag);
    const score = sz ? +sz[1] : /apple/i.test(rel[1]) ? 180 : /\.svg/i.test(href[1]) ? 300 : 32;
    try { out.push([score, new URL(href[1].replace(/&amp;/g, '&'), base).href]); } catch {}
  }
  return out.sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}
async function get(url, ms = 10000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128 Safari/537.36' }, redirect: 'follow' }); if (!r.ok) return null; const b = Buffer.from(await r.arrayBuffer()); return b.length > 2_000_000 ? null : b; } catch { return null; } finally { clearTimeout(t); }
}
/** 返回 { file, src } 或 null。getter 可注入（测试用）。 */
async function fetchLogo(domain, dir, id, getter = get) {
  domain = String(domain || '').replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
  if (!domain || NOT_VENDOR.test(domain)) return null;
  const base = `https://${domain}/`;
  const html = await getter(base);
  const cands = [...(html ? iconLinks(html.toString('utf8'), base) : []), base + 'apple-touch-icon.png', `https://www.google.com/s2/favicons?domain=${domain}&sz=128`, base + 'favicon.ico'];
  for (const u of cands) {
    const b = await getter(u); if (!b || b.length < 100) continue;
    const ext = sniff(b); if (!ext) continue;
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (f.startsWith(id + '.')) fs.unlinkSync(path.join(dir, f));
    const file = `${id}.${ext}`; fs.writeFileSync(path.join(dir, file), b);
    return { file, src: u };
  }
  return null;
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', ico: 'image/x-icon', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
function dataUrl(dir, file) { try { const ext = file.split('.').pop(); return `data:${MIME[ext]};base64,${fs.readFileSync(path.join(dir, file)).toString('base64')}`; } catch { return null; } }
module.exports = { fetchLogo, sniff, iconLinks, dataUrl, NOT_VENDOR };
