'use strict';
const MAX_RETRY_SECONDS = 86400;
function retryAfter(value, now = Date.now()) {
  if (value == null || value === '') return 0;
  const raw = String(value).trim();
  const seconds = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : (Date.parse(raw) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, Math.min(MAX_RETRY_SECONDS, Math.ceil(seconds))) : 0;
}
function nextStatus(prev, incoming) {
  const s = { ...incoming }; const p = prev || {};
  s.failStreak = s.ok ? 0 : (p.failStreak || 0) + 1;
  s.lastSuccess = s.ok ? s.lastRun : (p.lastSuccess || (p.ok ? p.lastRun : 0) || 0);
  s.recoveredAt = s.ok && p.ok === false ? s.lastRun : (p.recoveredAt || 0);
  if (s.ok) { s.retryAt = 0; s.httpStatus = 200; }
  if (p.chg) s.chg = p.chg;
  return s;
}
function diagnoseError(error='') {
 const e=String(error);
 if(/HTTP 401|login.required|sign.in.required/i.test(e))return 'login-required';
 if(/HTTP 429|Retry-After|rate.limit/i.test(e))return 'rate-limited';
 if(/SOURCE_BLOCKED|HTTP 403|challenge|人机验证/i.test(e))return 'blocked';
 if(/config-required|RSSHub|请填写|未设置/i.test(e))return 'config-required';
 if(/unsupported/i.test(e))return 'unsupported';
 if(/HTTP 404|HTTP 410/.test(e))return 'not-found';
 if(/需要 JS|JS 渲染|JavaScript required/i.test(e))return 'js-only';
 if(/coverage-mismatch/i.test(e))return 'coverage-mismatch';
 if(/No meaningful|no pricing evidence/i.test(e))return 'empty-parse';
 if(/HTTP [45]|ERR_|超时|ENOTFOUND|timeout|fetch failed|TLS/i.test(e))return 'unreachable';
 return 'parse-error';
}
module.exports = { diagnoseError, retryAfter, nextStatus, MAX_RETRY_SECONDS };
