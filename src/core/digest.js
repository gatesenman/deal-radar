'use strict';
// v2.3：「今日要点」聚合（首页 + 每日摘要通知共用）、免打扰判断、AI 翻译/要点的提示词与解析
const H = 3600000;
const isLiveOffer = (d) => d.category === 'ai' && (d.offerTypes || []).length > 0 && d.status !== 'ignored' && d.feedback !== 'noise';
const expired = (d, now) => !!(d.facts && d.facts.deadline && d.facts.deadline < now);
const when = (d) => d.published || d.fetchedAt || 0;
// 排序分：重要度 + 可信度 + 新鲜度（72 小时线性衰减）
function rank(d, now) {
  const age = Math.max(0, (now - when(d)) / H);
  return (d.score || 0) + 0.35 * ((d.facts && d.facts.confidence) || 40) + Math.max(0, 24 - age / 3);
}
const fmtT = (k, ...a) => String(k).replace(/\{(\d+)\}/g, (m, i) => (a[i] !== undefined ? a[i] : m));
function digestOf(deals, { now = Date.now(), brandName = (x) => x, t = fmtT, titleOf = (d) => d.titleZh || d.title, locale = 'zh-CN' } = {}) {
  const offers = deals.filter(isLiveOffer);
  const recent = offers.filter((d) => now - when(d) <= 72 * H && !expired(d, now));
  const top = recent.filter((d) => !(d.offerTypes.length === 1 && d.offerTypes[0] === 'pricing')).sort((a, b) => rank(b, now) - rank(a, now)).slice(0, 8);
  const pricing = offers.filter((d) => d.offerTypes.includes('pricing') && now - when(d) <= 7 * 24 * H).sort((a, b) => when(b) - when(a)).slice(0, 6);
  const expiring = offers.filter((d) => d.facts && d.facts.deadline && d.facts.deadline >= now && d.facts.deadline - now <= 14 * 24 * H).sort((a, b) => a.facts.deadline - b.facts.deadline).slice(0, 6);
  const today = offers.filter((d) => now - (d.fetchedAt || 0) <= 24 * H);
  const byVendor = {};
  for (const d of offers.filter((x) => now - when(x) <= 7 * 24 * H)) for (const b of d.brandIds || []) byVendor[b] = (byVendor[b] || 0) + 1;
  const vendors = Object.entries(byVendor).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => ({ id, n }));
  const lines = [
    ...top.slice(0, 3).map((d) => '★ ' + t('【{0}】{1}', (d.brandIds || []).map(brandName).join('/'), titleOf(d))),
    ...(pricing.length ? [t('价格页变动 {0} 处：{1}', pricing.length, [...new Set(pricing.flatMap((d) => d.brandIds || []))].map(brandName).slice(0, 4).join(t('、')))] : []),
    ...(expiring.length ? [t('即将截止 {0} 条：最早 {1}', expiring.length, new Date(expiring[0].facts.deadline).toLocaleDateString(locale))] : []),
  ];
  return {
    at: now,
    title: t('今日要点：{0} 条新优惠', today.length) + (top.length ? t('，{0} 条值得关注', top.length) : ''),
    lines,
    top: top.map((d) => d.id), pricing: pricing.map((d) => d.id), expiring: expiring.map((d) => d.id),
    stats: {
      today: today.length,
      pending: offers.filter((d) => (d.status || 'new') === 'new' && !d.read && !expired(d, now)).length,
      claimed: deals.filter((d) => d.status === 'claimed').length,
      ignored: deals.filter((d) => d.status === 'ignored').length,
      expiredCount: offers.filter((d) => expired(d, now)).length,
      week: offers.filter((d) => now - when(d) <= 7 * 24 * H).length,
    },
    vendors,
  };
}
function toMin(s) { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); }
function inQuiet(st, date = new Date()) {
  if (!st || !st.quietHours) return false;
  const a = toMin(st.quietStart || '23:00'); const b = toMin(st.quietEnd || '08:00'); const n = date.getHours() * 60 + date.getMinutes();
  if (a === b) return false;
  return a < b ? n >= a && n < b : n >= a || n < b; // 跨午夜
}
// 需要 AI 处理：英文标题的优惠、还没处理过
const CJK = /[\u4e00-\u9fff]/;
/** 是否需要 AI 翻译到 lang：zh-CN → 英文条目；en → 中文条目。结果按语言缓存在 d.tr[lang] */
function needsEnrich(d, lang = 'zh-CN') {
  if (!isLiveOffer(d) || d.pageDiff) return false;
  const tr = (d.tr || {})[lang];
  if (tr && (tr.title || tr.note)) return false;
  if (lang === 'zh-CN') return !CJK.test(d.title || '') && !d.enrichedAt;
  return CJK.test(d.title || '');
}
function enrichPrompt(list, lang = 'zh-CN') {
  const items = list.map((d, i) => `${i}. ${String(d.title).slice(0, 200)}${d.summary ? ' || ' + String(d.summary).replace(/\s+/g, ' ').slice(0, 160) : ''}`).join('\n');
  if (lang === 'en') return `You help an English-speaking user track AI vendor offers. For each Chinese (or mixed) headline:
1) Translate into concise, natural English. Keep product names (ChatGPT, Claude, Gemini, DeepSeek, Kimi…) and exact numbers/prices/%/durations.
2) Write ONE English note (<=80 chars): what the offer is, who qualifies, amount/deadline if stated.
Do not invent facts. If it is commentary/noise not a claimable offer, set note to "Not an offer: …" and still translate the title.
Return JSON only: {"items":[{"i":0,"text":"...","note":"..."}]}
Items:
${items}`;
  return `You help a Chinese user track AI vendor offers. For each English (or mixed) headline:
1) Translate into concise, natural Simplified Chinese. Keep product names (ChatGPT/Claude/Gemini/DeepSeek/Kimi…) in English; keep exact numbers/prices/%/durations.
2) Write ONE Chinese note (<=40 chars): 力度、适用对象、截止（标题里有的才写）.
Do not invent facts. If it is commentary/noise not a claimable offer, set note to "非优惠：…" and still translate.
Return JSON only: {"items":[{"i":0,"zh":"...","note":"..."}]}
Items:
${items}`;
}
function parseEnrich(text) {
  let j = null;
  try { j = JSON.parse(text); } catch { const m = String(text || '').match(/\{[\s\S]*\}/); if (m) { try { j = JSON.parse(m[0]); } catch { j = null; } } }
  const arr = j && Array.isArray(j.items) ? j.items : Array.isArray(j) ? j : [];
  return arr.filter((x) => x && Number.isInteger(Number(x.i))).map((x) => { const tt = x.text || x.zh || x.en || ''; return { i: Number(x.i), zh: tt ? String(tt) : '', text: tt ? String(tt) : '', note: x.note ? String(x.note) : '' }; });
}
module.exports = { digestOf, inQuiet, needsEnrich, enrichPrompt, parseEnrich, isLiveOffer, rank };
