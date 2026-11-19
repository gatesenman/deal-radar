'use strict';
/**
 * v2.5 可选 AI 优惠分类器：把「像优惠但其实是行业评论 / 软文」的条目标为 noise。
 * 无 Key 时跳过；结果缓存在 d.aiClass / d.aiClassAt，不反复消耗。
 */
const CJK = /[\u4e00-\u9fff]/;

function needsClassify(d) {
  if (!d || d.aiClass || d.pageDiff) return false;
  if (d.feedback === 'noise' || d.status === 'ignored') return false;
  const types = d.offerTypes || [];
  if (!types.length || types.includes('pricing')) return false;
  // 只对「可疑」条目调用：社区 / 新闻 / 无强数字力度
  const strong = /\b\d{1,3}\s?%\s?(off|discount)|\$\s?\d[\d,]*(k)?\s+(in\s+)?(free\s+)?(api\s+)?credits?|\bfree\s+(trial|month|year|for\s+students)|限时(半价|免费)|免费\s*\d|\d(?:\.\d)?\s?折|送\s*\d/i.test(d.title || '');
  if (strong && (d.platform === '厂商渠道' || d.platform === '厂商官方' || ['blog', 'pricing', 'changelog'].includes(d.sub))) return false;
  return true;
}

function classifyPrompt(list) {
  return `You classify AI-vendor deal headlines for a deal radar. For each item reply whether it is a REAL actionable offer (user can claim/buy/get something now: free trial, discount %, credits, student pack, startup credits, new cheaper plan with a price, limited-time promo) or NOISE (industry commentary, price-war analysis, model comparison, rumor, tutorial, podcast, partnership soft-promo, hardware/shopping unrelated to AI subscriptions, reseller grey-market without an official vendor offer).
Return JSON only: {"items":[{"i":0,"class":"offer"|"noise","why":"≤12 words"}]}
Items:
${list.map((d, i) => `${i}. ${(d.brandIds || []).join('/')}: ${String(d.title).slice(0, 180)}`).join('\n')}`;
}

function parseClassify(text) {
  let j = null;
  try { j = JSON.parse(text); } catch { const m = String(text || '').match(/\{[\s\S]*\}/); if (m) { try { j = JSON.parse(m[0]); } catch { j = null; } } }
  const arr = j && Array.isArray(j.items) ? j.items : Array.isArray(j) ? j : [];
  return arr.filter((x) => x && Number.isInteger(Number(x.i)) && /^(offer|noise)$/i.test(x.class || '')).map((x) => ({ i: Number(x.i), class: String(x.class).toLowerCase(), why: x.why ? String(x.why).slice(0, 80) : '' }));
}

/** 可选：用 AI 把疑似跨语言同一事件的候选对确认合并。返回应合并的 [aId,bId] 列表。 */
function clusterPrompt(pairs) {
  return `You decide whether two deal headlines are the SAME event (same vendor offer / price change reported in different languages or outlets). Be conservative: only merge when clearly the same specific offer (same product + same deal terms). Do NOT merge general "price war" articles with a specific discount.
Return JSON only: {"pairs":[{"i":0,"same":true|false}]}
Pairs:
${pairs.map((p, i) => `${i}. A: ${String(p.a).slice(0, 140)}\n   B: ${String(p.b).slice(0, 140)}`).join('\n')}`;
}
function parseCluster(text) {
  let j = null;
  try { j = JSON.parse(text); } catch { const m = String(text || '').match(/\{[\s\S]*\}/); if (m) { try { j = JSON.parse(m[0]); } catch { j = null; } } }
  const arr = j && Array.isArray(j.pairs) ? j.pairs : [];
  return arr.filter((x) => x && Number.isInteger(Number(x.i))).map((x) => ({ i: Number(x.i), same: !!x.same }));
}

module.exports = { needsClassify, classifyPrompt, parseClassify, clusterPrompt, parseCluster };
