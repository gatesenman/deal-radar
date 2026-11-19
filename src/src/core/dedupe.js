'use strict';
// 跨渠道去重：URL 规范化 + 标题相似度；重要度评分
const TRACK = /^(utm_\w+|ref|ref_src|ref_url|sd_ref|oc|fbclid|gclid|mc_cid|mc_eid|igshid|spm|from|source|share|si|feature|_hsenc|_hsmi|cmpid|ncid|taid|guccounter)$/i;
function canonicalUrl(link) {
  try {
    const u = new URL(String(link).trim());
    u.hostname = u.hostname.toLowerCase().replace(/^(www|m|amp|mobile)\./, '');
    for (const k of [...u.searchParams.keys()]) if (TRACK.test(k)) u.searchParams.delete(k);
    u.hash = '';
    let p = u.pathname.replace(/\/amp\/?$/, '/').replace(/\/index\.html?$/, '/');
    if (p.length > 1) p = p.replace(/\/+$/, '');
    u.pathname = p;
    if (u.protocol === 'http:') u.protocol = 'https:';
    return u.toString();
  } catch { return link; }
}
function normForSim(t) { return String(t).toLowerCase().replace(/\s[-–—|｜]\s[^-–—|｜]{2,40}$/, '').replace(/[\s\p{P}\p{S}]+/gu, ''); }
function bigrams(t) { const s = normForSim(t || ''); const out = new Set(); for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2)); return out; }
function similarity(a, b) {
  const A = a instanceof Set ? a : bigrams(a); const B = b instanceof Set ? b : bigrams(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return (2 * n) / (A.size + B.size); // Dice 系数
}

// 重要度评分 0–100（不含时间衰减，界面显示时再叠加新鲜度）
const TYPE_W = { pricing: 34, credits: 30, free: 30, student: 26, discount: 26, startup: 22, event: 14, plan: 10 };
const SUB_W = { pricing: 12, blog: 10, changelog: 8, app: 2, status: -10, news: 0, forum: 0, reddit: 0, social: 4, youtube: 2, github: 2 };
function scoreDeal(d) {
  const types = d.offerTypes || [];
  let s = types.length ? Math.max(...types.map((t) => TYPE_W[t] || 8)) + Math.min(10, (types.length - 1) * 5) : 4;
  s += SUB_W[d.sub] || 0;
  if (d.platform === '厂商渠道' || d.platform === '厂商官方') s += 8;
  s += Math.min(24, ((d.sources || []).length) * 8);
  if (d.heat) s += Math.min(12, Math.round(d.heat / 50));
  if (/\b\d{2,3}%|\d+(\.\d+)?\s*折|免费|free/i.test(d.title)) s += 6;
  return Math.max(0, Math.min(100, s));
}

module.exports = { canonicalUrl, similarity, bigrams, scoreDeal, normForSim };
