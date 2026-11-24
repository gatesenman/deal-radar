'use strict';
// v2.12：更细的反馈原因、证据链（官方/多源证实）、完整本地备份（不含推送密钥与 AI Key）。

const FEEDBACK_REASONS = ['noise', 'expired', 'not-for-me', 'duplicate', 'too-small'];

function applyFeedback(deal, reason, { now = Date.now() } = {}) {
  const r = FEEDBACK_REASONS.includes(reason) ? reason : 'noise';
  const out = { ...deal, feedback: r, status: 'ignored', read: true };
  if (r === 'noise') { out.offerTypes = []; delete out.facts; }
  if (r === 'expired') out.recheck = { ...(deal.recheck || {}), gone: true, confirmed: true, reason: 'user-expired', at: now };
  return out;
}

function learnsNegative(reason) { return reason === 'noise' || reason === 'too-small'; }
function learnsWord(reason) { return reason === 'noise'; }

function evidenceOf(d) {
  const srcs = Array.isArray(d.sources) && d.sources.length
    ? d.sources.map((x) => ({ name: x.name || x.sourceName || '', link: x.link || '', official: !!x.official }))
    : (d.sourceName ? [{ name: d.sourceName, link: d.link || d.origin || '', official: false }] : []);
  const official = !!(d.facts && d.facts.trust && d.facts.trust.level === 3)
    || srcs.some((s) => s.official || /官方/.test(s.name || ''));
  if (official && srcs.length) srcs.forEach((s) => { if (/官方/.test(s.name)) s.official = true; });
  const n = Math.max(srcs.length, d.sourceName ? 1 : 0);
  return { n, official, sources: srcs };
}

const SECRET_KEYS = new Set(['secret', 'token', 'key', 'keyEnc', 'apiKey', 'api_key', 'password']);

function stripSecrets(obj, depth = 0) {
  if (depth > 12) return undefined;
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map((x) => stripSecrets(x, depth + 1));
  if (typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if ([...SECRET_KEYS].some((key) => key.toLowerCase() === k.toLowerCase()) || /^(authorization|cookie|proxy-authorization|clientsecret|access[_-]?token|refresh[_-]?token)$/i.test(k) || ['__proto__', 'constructor', 'prototype'].includes(k)) continue;
    if (typeof v === 'string' && /^https?:/.test(v)) {
      try { const u = new URL(v); if (u.username || u.password || [...u.searchParams.keys()].some((q) => /token|secret|key|auth|password/i.test(q))) { out[k] = ''; out.redacted = true; continue; } } catch {}
    }
    if ((k === 'url' || k === 'hook') && typeof v === 'string' && /(?:hooks\.slack|qyapi\.weixin|open\.feishu|oapi\.dingtalk|sctapi\.ftqq|api\.telegram)/i.test(v)) {
      out[k] = '';
      out.redacted = true;
      continue;
    }
    out[k] = stripSecrets(v, depth + 1);
  }
  return out;
}

function exportBackup({ config, deals, views, prices } = {}) {
  const settings = { ...((config && config.settings) || {}) };
  delete settings.ai;
  delete settings.windowBounds;
  delete settings.proxyUrl;
  const push = stripSecrets((settings.channels || []).map((c) => ({ ...c, url: '', enabled: false, last: null })));
  const { channels, ...rest } = settings;
  return {
    app: 'DealRadar',
    format: 3,
    exportedAt: new Date().toISOString(),
    brands: stripSecrets((config && config.brands) || []),
    sources: stripSecrets((config && config.sources) || []),
    settings: stripSecrets(rest),
    views: views || settings.views || [],
    channels: push, // 推送渠道（密钥已去掉）
    deals: Array.isArray(deals) ? deals.map((d) => ({
      id: d.id, title: d.title, link: d.link, brandIds: d.brandIds, offerTypes: d.offerTypes,
      status: d.status, fav: d.fav, read: d.read, feedback: d.feedback, category: d.category,
      sourceId: d.sourceId, sourceName: d.sourceName, platform: d.platform, region: d.region,
      published: d.published, fetchedAt: d.fetchedAt, summary: d.summary, facts: d.facts,
      sources: d.sources, origin: d.origin, score: d.score, vstat: d.vstat, recheck: d.recheck,
      trialUntil: d.trialUntil, trialEnd: d.trialEnd, trialDone: d.trialDone, trialNotified: d.trialNotified, tr: d.tr,
    })) : [],
    prices: prices && typeof prices === 'object' ? prices : undefined,
  };
}

function validateBackup(obj) {
  if (!obj || obj.app !== 'DealRadar') return '不是全网优惠雷达的备份文件';
  if (obj.format !== 3 && obj.format !== 2) return '不支持的备份格式';
  if (!Array.isArray(obj.brands)) return '备份缺少厂商列表';
  return '';
}

function mergeDeals(local, incoming) {
  const map = new Map((local || []).filter((d) => d && d.id).map((d) => [d.id, d]));
  for (const d of incoming || []) {
    if (!d || !d.id || !d.title || !d.link) continue;
    const cur = map.get(d.id);
    if (!cur) { map.set(d.id, d); continue; }
    // 保留用户在任一侧做过的领取 / 收藏 / 反馈
    const fav = !!(cur.fav || d.fav);
    const status = (cur.status === 'claimed' || d.status === 'claimed') ? 'claimed'
      : (cur.status === 'ignored' || d.status === 'ignored') ? (cur.status === 'ignored' ? cur.status : d.status) : (d.status || cur.status);
    const feedback = cur.feedback || d.feedback;
    map.set(d.id, { ...cur, ...d, fav, status, feedback, read: cur.read || d.read });
  }
  return [...map.values()];
}

module.exports = { FEEDBACK_REASONS, applyFeedback, learnsNegative, learnsWord, evidenceOf, stripSecrets, exportBackup, validateBackup, mergeDeals };
