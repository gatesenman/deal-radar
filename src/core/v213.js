'use strict';
// v2.13：GitHub Release 更新检查（只提示、不自动安装未签名安装包）+ 推送失败重试。

const RELEASE_API = 'https://api.github.com/repos/gatesenman/deal-radar/releases/latest';
const CHECK_EVERY = 24 * 3600 * 1000;

function parseVer(s) {
  return String(s || '').trim().replace(/^v/i, '').split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
}
function cmpSemver(a, b) {
  const pa = parseVer(a), pb = parseVer(b);
  const n = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < n; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x > y) return 1; if (x < y) return -1; }
  return 0;
}
function isNewer(remote, current) { return cmpSemver(remote, current) > 0; }

function parseRelease(json) {
  if (!json || typeof json !== 'object') throw new Error('invalid release');
  const tag = String(json.tag_name || json.tag || '');
  const version = tag.replace(/^v/i, '');
  const assets = (json.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url || a.url || '', size: a.size || 0 }));
  return { tag, version, url: json.html_url || json.url || '', name: json.name || tag, publishedAt: json.published_at || '', assets };
}

function shouldCheck(lastAt, now = Date.now(), interval = CHECK_EVERY) {
  return !lastAt || (now - Number(lastAt) >= interval);
}

function isRetryable(err) {
  const code = err && (err.status || err.code);
  if (code === 429 || (Number(code) >= 500 && Number(code) <= 599)) return true;
  const m = String((err && err.message) || err || '');
  return /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|503|502|504|429|fetch failed|socket/i.test(m);
}

async function withRetry(fn, { tries = 3, delays = [400, 1200], retryable = isRetryable, sleep } = {}) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(i); } catch (e) {
      last = e;
      if (i === tries - 1 || !retryable(e)) throw e;
      const ms = delays[Math.min(i, delays.length - 1)] || 0;
      if (ms) await wait(ms);
    }
  }
  throw last;
}

module.exports = { RELEASE_API, CHECK_EVERY, cmpSemver, isNewer, parseRelease, shouldCheck, isRetryable, withRetry };
