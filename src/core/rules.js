'use strict';
// 提醒规则引擎：厂商 + 优惠类型 + 关键词（含/不含）+ 最低重要度 → 通知 / 声音 / 高亮
function splitKw(v) { return (Array.isArray(v) ? v : String(v || '').split(/[,，\n]/)).map((s) => String(s).trim().toLowerCase()).filter(Boolean); }
function normalizeRule(r = {}) {
  return {
    id: r.id || 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: String(r.name || '未命名规则').slice(0, 60), enabled: r.enabled !== false,
    vendors: Array.isArray(r.vendors) ? r.vendors : [], types: Array.isArray(r.types) ? r.types : [], keywords: splitKw(r.keywords), exclude: splitKw(r.exclude),
    minScore: Math.max(0, Math.min(100, Number(r.minScore) || 0)), notify: r.notify !== false, sound: !!r.sound, highlight: /^#[0-9a-f]{3,8}$/i.test(r.highlight || '') ? r.highlight : '',
    offersOnly: r.offersOnly !== false,
  };
}
function matchRule(r, d) {
  if (!r.enabled) return false;
  const isOffer = d.category !== 'ai' || (d.offerTypes || []).length > 0;
  if (r.offersOnly !== false && !isOffer) return false;
  if (r.vendors.length && !d.brandIds.some((b) => r.vendors.includes(b))) return false;
  if (r.types.length && !(d.offerTypes || []).some((t) => r.types.includes(t))) return false;
  const text = (d.title + ' ' + (d.summary || '')).toLowerCase();
  if (r.keywords.length && !r.keywords.some((k) => text.includes(k))) return false;
  if (r.exclude.some((k) => text.includes(k))) return false;
  if (r.minScore && (d.score || 0) < r.minScore) return false;
  return true;
}
// 对新条目执行规则：写入 d.rules / d.hl，返回 { notify:[], sound:boolean }
function applyRules(rules, deals) {
  const rs = (rules || []).map(normalizeRule).filter((r) => r.enabled);
  const notify = []; let sound = false;
  for (const d of deals) {
    const hit = rs.filter((r) => matchRule(r, d));
    if (!hit.length) continue;
    d.rules = hit.map((r) => r.name);
    const hl = hit.find((r) => r.highlight); if (hl) d.hl = hl.highlight;
    if (hit.some((r) => r.notify)) notify.push(d);
    if (hit.some((r) => r.sound)) sound = true;
  }
  return { notify, sound };
}
module.exports = { normalizeRule, matchRule, applyRules };
