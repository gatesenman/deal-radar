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
module.exports = { retryAfter, nextStatus, MAX_RETRY_SECONDS };
