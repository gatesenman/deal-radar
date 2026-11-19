'use strict';
/**
 * v2.5 跨语言 / 多源故事聚类
 * 把「同一事件」的中英文报道合并为一张卡（sources: N）。
 * 保守策略：必须共享至少一个「锚点」（厂商 / 金额 / 产品名 / 百分比），
 * 再叠加标题指纹相似度；宁可漏合也不误合。
 */
const { similarity, bigrams, normForSim } = require('./dedupe');

const CJK = /[\u3400-\u9fff]/;
const PCT = /(\d{1,3})\s?%/g;
const MONEY = /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?k)?|\d+(?:\.\d+)?\s*(?:美元|美金|刀|元|CNY|USD)/gi;
const MONTHS = /(\d+|one|two|three|six|twelve|a)\s*(?:-\s*)?(months?|years?|weeks?|个月|月|年|周)/gi;
const FREE = /\bfree\b|免费|限免|0\s?元/i;
const PRODUCTS = /\b(chatgpt|claude|gemini|grok|perplexity|copilot|cursor|deepseek|kimi|sora|midjourney|gpt-?\d|opus|sonnet|haiku|llama|mistral|codex|manus)\b/gi;

function langOf(t) { return CJK.test(String(t || '').slice(0, 40)) ? 'zh' : 'en'; }

/** 抽取与语言无关的「事件锚点」——合并时至少要命中一个 */
function anchors(title, brandIds = []) {
  const t = String(title || '');
  const a = new Set();
  for (const b of brandIds || []) if (b) a.add('b:' + b);
  let m;
  PCT.lastIndex = 0; while ((m = PCT.exec(t))) a.add('p:' + m[1]);
  if (/半价|half[- ]price|50%\s*off/i.test(t)) a.add('p:50');
  MONEY.lastIndex = 0; while ((m = MONEY.exec(t))) {
    const raw = m[0].replace(/\s+/g, '').toLowerCase().replace(/,/g, '');
    const num = (raw.match(/\d+(?:\.\d+)?/) || [])[0];
    if (num) a.add('m:' + num); // 只保留数字，避免 $1,000 vs 1000美元 对不上
  }
  MONTHS.lastIndex = 0; while ((m = MONTHS.exec(t))) {
    const n = { a: 1, one: 1, two: 2, three: 3, six: 6, twelve: 12 }[String(m[1]).toLowerCase()] || m[1];
    const u = /year|年/i.test(m[2]) ? 'y' : /week|周/i.test(m[2]) ? 'w' : 'm';
    a.add('d:' + n + u);
  }
  if (FREE.test(t)) a.add('free');
  if (/\bfree\s+year\b|一年|1\s*年|免费使用1年|免费.{0,4}1\s*年/i.test(t)) a.add('d:1y');
  if (/\bfree\s+(?:for\s+)?(?:one\s+|a\s+|1\s+)?months?\b|免费.{0,4}1\s*个?月|一个月免费/i.test(t)) a.add('d:1m');
  PRODUCTS.lastIndex = 0; while ((m = PRODUCTS.exec(t))) a.add('x:' + m[1].toLowerCase().replace(/-/g, ''));
  // 去掉媒体后缀后的「核心短语」指纹（跨语言弱）：数字 + 拉丁产品词
  const core = t.toLowerCase().replace(/\s[-–—|｜]\s[^-–—|｜]{2,40}$/, '')
    .replace(/[\u3400-\u9fff]+/g, ' ').replace(/[^a-z0-9%$]+/g, ' ').trim();
  if (core.length >= 6) a.add('c:' + core.split(/\s+/).filter((w) => w.length > 2).slice(0, 6).join(' '));
  return a;
}

function shareAnchor(A, B) {
  for (const x of A) if (x !== 'free' && B.has(x)) return true;
  // 仅有 free 不够——必须再共享一个厂商或产品
  if (A.has('free') && B.has('free')) {
    for (const x of A) if (x.startsWith('b:') || x.startsWith('x:')) if (B.has(x)) return true;
  }
  return false;
}

/**
 * 两标题是否为「同一故事」。同语言阈值 0.82；跨语言要求锚点共享 + 拉丁核心词重合或金额/百分比一致。
 */
function sameStory(a, b, { threshold = 0.82, crossThreshold = 0.55 } = {}) {
  if (!a || !b) return false;
  const ta = a.title || a; const tb = b.title || b;
  if (String(ta).length < 12 || String(tb).length < 12) return false;
  const ba = a.brandIds || []; const bb = b.brandIds || [];
  const Aa = anchors(ta, ba); const Ab = anchors(tb, bb);
  if (!shareAnchor(Aa, Ab)) return false;
  const sameLang = langOf(ta) === langOf(tb);
  const sim = similarity(ta, tb);
  const strongPre = [...Aa].filter((x) => /^(p:|m:|d:)/.test(x) && Ab.has(x)).length;
  const brandPre = [...Aa].some((x) => x.startsWith('b:') && Ab.has(x));
  // 同语言：标题很像，或「同一力度 + 同一厂商」（如两篇都写 DeepSeek 75% 永久降价）
  if (sameLang) {
    if (sim >= threshold) return true;
    if (strongPre >= 1 && brandPre && sim >= 0.45) return true;
    return false;
  }
  // 跨语言：bigram 对中英几乎无用，改看拉丁核心词 Dice + 锚点强度
  const ca = [...Aa].filter((x) => x.startsWith('c:')).map((x) => x.slice(2));
  const cb = [...Ab].filter((x) => x.startsWith('c:')).map((x) => x.slice(2));
  let coreSim = 0;
  if (ca[0] && cb[0]) {
    const A = new Set(ca[0].split(' ')); const B = new Set(cb[0].split(' '));
    let n = 0; for (const x of A) if (B.has(x)) n++;
    coreSim = (2 * n) / (A.size + B.size);
  }
  const strong = [...Aa].filter((x) => /^(p:|m:|d:)/.test(x) && Ab.has(x)).length;
  const brandHit = [...Aa].some((x) => x.startsWith('b:') && Ab.has(x));
  const prodHit = [...Aa].some((x) => x.startsWith('x:') && Ab.has(x));
  if (strong >= 1 && (coreSim >= 0.35 || (brandHit && prodHit))) return true;
  if (strong >= 2) return true;
  if (Aa.has('free') && Ab.has('free') && brandHit && prodHit && (strong >= 1 || coreSim >= 0.3)) return true;
  if (coreSim >= crossThreshold && brandHit) return true;
  return sim >= threshold; // 极端情况：标题里拉丁部分很长
}

/** 给 mergeDeals 用的索引条目 */
function indexOf(d) {
  return { d, g: bigrams(d.title), a: anchors(d.title, d.brandIds), lang: langOf(d.title) };
}

// v2.9：评测（160 对人工标注，见 RESEARCH.md / E2E_v29.md）后：去掉「报道 - 媒体名」后缀做 MinHash（3-gram，64 个哈希），
// 与原有 sameStory 取并集，再用「数字 / 版本号互不包含」做否决（n8n@2.43.6 vs 2.43.7、2023 vs 2024 报告）
const MH = require('./v27');
function stripOutlet(t) { return String(t || '').replace(/^(title:\s*|-\s+)/i, '').replace(/\s+[-–—|｜]\s+[^-–—|｜]{2,60}$/, '').replace(/\|[^|]*(\|[^|]*)+$/, ''); }
function numSet(t) { return new Set(stripOutlet(t).match(/\d+\.\d+(?:\.\d+)*|(?<!\d)(?:19|20)\d{2}(?!\d)/g) || []); } // 只看版本号与年份
function lead(t) { const m = /^\s*(\d+)\s/.exec(stripOutlet(t)); return m ? m[1] : ''; }
function numConflict(a, b) {
  if (lead(a) && lead(b) && lead(a) !== lead(b)) return true; // 「9 个…」vs「8 个…」盘点类
  if (/版更新/.test(a) && /版更新/.test(b) && a !== b) return true; // 应用商店更新：不同平台 / 版本各算一条
  const A = numSet(a); const B = numSet(b); if (!A.size || !B.size) return false; return [...A].some((x) => !B.has(x)) && [...B].some((x) => !A.has(x)); }
function sigOf(r) { if (!r.mh) r.mh = MH.minhash(stripOutlet(r.d ? r.d.title : r.title)); return r.mh; }
function findDup(it, recent, { threshold = 0.82, mhThreshold = 0.6, sameSourceHours = 48 } = {}) {
  if (!it.title || it.title.length < 12 || it.pageDiff) return null;
  const me = { title: it.title }; const t0 = it.published || it.fetchedAt || 0;
  for (const r of recent) {
    if (r.d.id === it.id) continue;
    // 同一来源（如 Google 新闻聚合：同一事件的多家媒体报道）也比较，但只在 48 小时内
    if (r.d.sourceId === it.sourceId && Math.abs((r.d.published || r.d.fetchedAt || 0) - t0) > sameSourceHours * 3600000) continue;
    if (numConflict(it.title, r.d.title)) continue;
    if (sameStory({ title: it.title, brandIds: it.brandIds }, { title: r.d.title, brandIds: r.d.brandIds }, { threshold })) return r.d;
    if (stripOutlet(it.title).length >= 24 && stripOutlet(r.d.title).length >= 24 && MH.mhSim(sigOf(me), sigOf(r)) >= mhThreshold) return r.d; // 太短的标题（Introducing X）不用 MinHash
  }
  return null;
}

module.exports = { anchors, shareAnchor, sameStory, langOf, indexOf, findDup, stripOutlet, numConflict };
