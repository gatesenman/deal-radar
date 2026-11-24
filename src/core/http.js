'use strict';
// HTTP 层：统一 UA/自定义请求头/超时、ETag + If-Modified-Since 条件请求缓存（内存）
const { assertPublicURL } = require('./network-policy');
const { retryAfter } = require('./source-health');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

class HttpCache {
  constructor(max = 400) { this.max = max; this.map = new Map(); this.hits = 0; }
  get(url) { const e = this.map.get(url); if (e) { this.map.delete(url); this.map.set(url, e); } return e; }
  set(url, e) { if (e.body && e.body.length > 3e6) return; this.map.delete(url); this.map.set(url, e); while (this.map.size > this.max) this.map.delete(this.map.keys().next().value); }
  // v2.9：持久化（gzip），重启后仍能发送条件请求；最近使用的优先保留，总量上限 maxBytes（未压缩）
  serialize(maxBytes = 60e6) {
    const out = []; let total = 0;
    for (const [url, e] of [...this.map.entries()].reverse()) { const n = (e.body || '').length; if (total + n > maxBytes) continue; total += n; out.push([url, e.etag || '', e.lm || '', e.body || '']); }
    return require('zlib').gzipSync(JSON.stringify({ v: 1, at: Date.now(), e: out.reverse() }));
  }
  load(buf, { maxAgeDays = 14 } = {}) {
    try { const j = JSON.parse(require('zlib').gunzipSync(buf).toString('utf8')); if (!j || j.v !== 1 || Date.now() - (j.at || 0) > maxAgeDays * 864e5) return 0; for (const [url, etag, lm, body] of j.e || []) this.set(url, { etag: etag || null, lm: lm || null, body }); return (j.e || []).length; } catch { return 0; }
  }
}

/**
 * makeFetchText(rawFetch) → fetchText(url, opts)
 * rawFetch(url, init, opts) 返回 WHATWG Response（Node fetch / Electron net.fetch / session.fetch）
 * opts: { ua, headers, timeout, cache(bool), proxy, meta(对象，回写 status/cached/ms/bytes) }
 */
function makeFetchText(rawFetch, { cache = new HttpCache(), friendly = (m) => m, validateUrl = assertPublicURL } = {}) {
  async function fetchText(url, opts = {}) {
    const { ua, headers = {}, timeout = 20000, meta } = opts;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const h = { 'User-Agent': ua || UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8', ...headers };
    const cacheAllowed = opts.cache !== false && !Object.keys(headers).some((k) => /^(authorization|cookie|proxy-authorization)$/i.test(k));
    const c = cacheAllowed ? cache.get(url) : null;
    if (c) { if (c.etag) h['If-None-Match'] = c.etag; if (c.lm) h['If-Modified-Since'] = c.lm; }
    const t0 = Date.now();
    try {
      let target = url; let res;
      for (let redirects = 0; ; redirects++) {
        await validateUrl(target);
        res = await rawFetch(target, { signal: ctrl.signal, headers: h, redirect: 'manual' }, opts);
        if (![301, 302, 303, 307, 308].includes(res.status)) break;
        if (redirects >= 5) throw new Error('Too many redirects');
        const location = res.headers.get('location');
        if (!location) throw new Error('Redirect missing location');
        const next = new URL(location, target).href;
        if (new URL(next).origin !== new URL(target).origin) {
          for (const k of Object.keys(h)) if (/^(authorization|cookie|proxy-authorization|if-none-match|if-modified-since)$/i.test(k)) delete h[k];
        }
        if (res.body && res.body.cancel) await res.body.cancel();
        target = next;
      }
      if (res.status === 304 && c) { cache.hits++; cache.savedBytes = (cache.savedBytes || 0) + c.body.length; if (meta) Object.assign(meta, { status: 304, cached: true, ms: Date.now() - t0, bytes: c.body.length }); return c.body; }
      if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; e.retryAfter = retryAfter(res.headers.get('retry-after')) || (res.status === 429 ? 60 : 0); if (meta) Object.assign(meta, { httpStatus: res.status, retryAt: e.retryAfter ? Date.now() + e.retryAfter * 1000 : 0 }); throw e; }
      const body = await res.text();
      const etag = res.headers.get('etag'); const lm = res.headers.get('last-modified');
      if (cacheAllowed && (etag || lm)) cache.set(url, { etag, lm, body });
      if (meta) Object.assign(meta, { status: res.status, cached: false, ms: Date.now() - t0, bytes: body.length });
      return body;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('请求超时（' + timeout / 1000 + 's）');
      if (e.status) throw e;
      throw new Error(friendly(e.cause && e.cause.code ? e.cause.code + ' ' + e.message : e.message));
    } finally { clearTimeout(timer); }
  }
  fetchText.cache = cache;
  return fetchText;
}

const nodeFetchText = makeFetchText((url, init) => globalThis.fetch(url, init));

module.exports = { UA, HttpCache, makeFetchText, nodeFetchText };
