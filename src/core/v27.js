'use strict';
/**
 * v2.7 更聪明的引擎
 * 1. 自适应轮询：Cho & Garcia-Molina (2003) 变化频率估计 + Miniflux entry_frequency 式的上下限
 * 2. 价格页结构化抽取（套餐 / 金额 / 币种 / 周期）+ 历史 + 人民币换算（changedetection.io restock_diff 的思路）
 * 3. 来源可靠度：Beta 平滑的「用户反馈精度 × 抓取成功率 × 官方加成」
 * 4. 反馈学习：Paul Graham 式朴素贝叶斯 + 不确定性采样（Settles 主动学习）
 * 5. MinHash 签名：近重复检测的候选生成（Broder 1997 / datasketch）
 */
const DAY = 86400000; const MIN = 60000;

// ———————————— 1. 自适应轮询 ————————————
/** 记录一次检查结果（是否有变化）；保留最近 40 次 */
function recordCheck(chg, changed, now = Date.now()) {
  const h = Array.isArray(chg) ? chg.slice(-39) : [];
  h.push([now, changed ? 1 : 0]);
  return h;
}
/**
 * Cho & Garcia-Molina 的改进估计量：λ̂ = −ln((n − X + 0.5)/(n + 0.5)) / Ī
 * n = 检查次数，X = 检测到变化的次数，Ī = 平均检查间隔。返回每分钟变化次数（λ）。
 */
function estimateRate(hist) {
  if (!Array.isArray(hist) || hist.length < 3) return null;
  const n = hist.length - 1; // 第一次检查只作基线
  const X = hist.slice(1).reduce((a, x) => a + (x[1] ? 1 : 0), 0);
  const span = hist[hist.length - 1][0] - hist[0][0];
  if (span <= 0) return null;
  const I = span / n / MIN;
  return -Math.log((n - X + 0.5) / (n + 0.5)) / I;
}
/** 建议的检查间隔（分钟）：约每次预期 0.5 次变化检查一次，夹在 [base, max] 之间 */
function adaptiveInterval(hist, { base = 15, max = 360, target = 0.5 } = {}) {
  const lam = estimateRate(hist);
  if (lam === null) return base;
  if (lam <= 0) return Math.min(max, Math.max(base, base * 4));
  return Math.round(Math.min(max, Math.max(base, target / lam)));
}
/** 本轮是否因「变化很少」而跳过 */
function adaptiveSkip(status, { now = Date.now(), base = 15, max = 360, id = '' } = {}) {
  if (!status || !status.ok || !Array.isArray(status.chg)) return 0;
  const iv = adaptiveInterval(status.chg, { base, max });
  if (iv <= base) return 0;
  // v2.9：±15% 确定性抖动，避免大量渠道同一轮集中到期
  const due = (status.lastRun || 0) + iv * MIN * (id ? require('./v29').jitter(id, status.lastRun || 0) : 1) - 30000;
  return due > now ? iv : 0;
}

// ———————————— 2. 价格抽取 ————————————
const CUR = { '$': 'USD', 'US$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'CNY', '￥': 'CNY', 'HK$': 'HKD', 'NT$': 'TWD', 'S$': 'SGD', '₹': 'INR', 'A$': 'AUD', 'C$': 'CAD' };
const PRICE_RE = /(US\$|HK\$|NT\$|S\$|A\$|C\$|[$€£¥￥₹])\s?(\d{1,5}(?:[.,]\d{1,3})?)|(USD|EUR|GBP|CNY)\s*\$?\s*(\d{1,5}(?:[.,]\d{1,3})?)|(\d{1,6}(?:\.\d{1,2})?)\s?(元|美元|美金|欧元|英镑|dollars?|euros?|pounds?|USD|EUR|GBP|CNY|RMB)(?![A-Za-z])/;
const UNIT_CUR = { '元': 'CNY', 'RMB': 'CNY', 'CNY': 'CNY', '美元': 'USD', '美金': 'USD', 'USD': 'USD', '欧元': 'EUR', 'EUR': 'EUR', '英镑': 'GBP', 'GBP': 'GBP', 'dollar': 'USD', 'dollars': 'USD', 'euro': 'EUR', 'euros': 'EUR', 'pound': 'GBP', 'pounds': 'GBP' };
const PERIOD_RE = [
  [/per\s*1m|\/\s*1m|1m tokens|百万\s*tokens|per million|\/\s*mtok|每百万/i, 'mtok'],
  [/per\s*(?:user|seat)\s*(?:\/|per)?\s*month|user\/month|seat per month|\/\s*seat/i, 'seat-month'],
  [/\/\s*(?:mo|month)\b|per\s*month|a month|monthly|billed monthly|\/月|每月|每个月|月付/i, 'month'],
  [/\/\s*(?:yr|year)\b|per\s*year|annually|yearly|\/年|每年|年付/i, 'year'],
];
const PLAN_RE = /^(free|hobby|plus|pro\+?|max|team|teams|business|enterprise|premium|standard|basic|starter|ultra|ultimate|individual|personal|developer|scale|growth|go|lite|advanced|免费版|专业版|团队版|企业版|个人版|旗舰版|标准版|高级版|基础版)(?![a-z])/i;
function periodOf(t) { for (const [re, p] of PERIOD_RE) if (re.test(t)) return p; return ''; }
function parseAmount(s) { const t = String(s).replace(/,(?=\d{3}\b)/g, '').replace(',', '.'); return Number(t); }
/**
 * 从价格页的文本行中抽取「套餐 → 价格」：
 * 套餐名取最近出现的短标题行（Free / Pro / Team / 专业版…），价格取同行或紧随两行内的金额 + 周期
 */
function extractPrices(lines, { max = 16 } = {}) {
  const out = []; const seen = new Set(); let plan = ''; let planAge = 99; let was = null;
  const L = (lines || []).map((x) => String(x || '').trim()).filter(Boolean);
  for (let i = 0; i < L.length && out.length < max; i++) {
    const t = L[i];
    if (t.length <= 28 && t.split(/\s+/).length <= 3 && PLAN_RE.test(t) && !PRICE_RE.test(t)) { plan = t.replace(/\s+/g, ' '); planAge = 0; continue; }
    planAge++;
    const m = t.match(PRICE_RE); if (!m || t.length > 160) continue;
    let amount, currency;
    if (m[1] && m[2]) { amount = parseAmount(m[2]); currency = CUR[m[1]]; }
    else if (m[3] && m[4]) { amount = parseAmount(m[4]); currency = { USD: 'USD', EUR: 'EUR', GBP: 'GBP', CNY: 'CNY' }[m[3]]; }
    else { amount = parseAmount(m[5]); currency = UNIT_CUR[(m[6] || '').toLowerCase()] || UNIT_CUR[m[6]]; }
    if (!Number.isFinite(amount) || !currency) continue;
    if (/\b(save|saving|off|discount)\b|节省|立省|省下|优惠\s*[$¥€£]/i.test(t)) continue; // 「Save $36/year」是省下的钱，不是套餐价
    const ctx = [t, L[i + 1] || ''].join(' ');
    const period = periodOf(ctx);
    if (!period) { const n1 = L[i + 1] || ''; if (PRICE_RE.test(n1) && n1.length <= 24 && periodOf([n1, L[i + 2] || ''].join(' '))) { was = { amount, currency, at: i }; } continue; } // 划线原价 $15 紧跟现价 $12 /month // 没有计费周期的金额（如「$10,000 credits」）不当作套餐价格
    const name = planAge <= 6 && plan ? plan : (t.match(PLAN_RE) || [])[0] || '';
    if (!name) continue;
    if (/^(free|免费)/i.test(name) && (amount > 0 || !/^(free|免费版?)( plan| tier)?$/i.test(name))) continue; // 「Free」套餐不可能收费；「Free of charge / Free Tier」后面的是按量单价
    const key = name.toLowerCase() + '|' + period;
    if (seen.has(key)) continue; seen.add(key);
    const rec = { plan: name, amount, currency, period };
    if (was && was.at === i - 1 && was.currency === currency && was.amount > amount) rec.was = was.amount;
    was = null;
    out.push(rec);
  }
  return out;
}
/** 与上次快照比较，返回变化 [{plan, period, from, to, currency}] */
function diffPrices(prev, next) {
  const idx = new Map((prev || []).map((p) => [p.plan.toLowerCase() + '|' + p.period, p]));
  const ch = [];
  for (const p of next || []) {
    const o = idx.get(p.plan.toLowerCase() + '|' + p.period);
    if (o && o.currency === p.currency && Math.abs(o.amount - p.amount) > 1e-9 && !(p.was && Math.abs(p.was - o.amount) < 1e-9) && !(o.was && Math.abs(o.was - p.amount) < 1e-9)) ch.push({ plan: p.plan, period: p.period, from: o.amount, to: p.amount, currency: p.currency });
  }
  return ch;
}
/** 写入价格历史：每个来源保留每个套餐最近 60 个点（价格不变只更新时间） */
function updatePriceBook(book, sourceId, meta, list, now = Date.now()) {
  const b = book[sourceId] || { ...meta, plans: {} };
  Object.assign(b, meta, { at: now });
  const changes = diffPrices(Object.values(b.plans).map((x) => ({ plan: x.plan, period: x.period, currency: x.currency, amount: x.hist[x.hist.length - 1][1], was: x.was })), list);
  for (const p of list) {
    const k = p.plan.toLowerCase() + '|' + p.period;
    const cur = b.plans[k] || { plan: p.plan, period: p.period, currency: p.currency, hist: [] };
    const last = cur.hist[cur.hist.length - 1];
    if (!last || last[1] !== p.amount) cur.hist.push([now, p.amount]); else last[2] = now;
    cur.hist = cur.hist.slice(-60); cur.currency = p.currency; cur.seen = now; if (p.was) cur.was = p.was; else delete cur.was;
    b.plans[k] = cur;
  }
  book[sourceId] = b;
  return changes;
}
// 汇率：fx = { base: 'CNY', rates: { USD: 7.1, ... }, date }
const FX_FALLBACK = { USD: 7.1, EUR: 7.7, GBP: 9.0, HKD: 0.91, TWD: 0.22, SGD: 5.3, INR: 0.085, AUD: 4.6, CAD: 5.1, CNY: 1 };
function toCNY(amount, currency, fx) {
  const r = (fx && fx.rates && fx.rates[currency]) || FX_FALLBACK[currency];
  return r ? Math.round(amount * r * 100) / 100 : null;
}
/** 解析 frankfurter / open.er-api 的返回，统一成「1 外币 = x 元」 */
function parseFx(json) {
  const rates = {};
  if (Array.isArray(json)) { for (const r of json) if (r.quote === 'CNY' && r.base && r.rate) rates[r.base] = r.rate; }
  else if (json && json.rates && json.rates.CNY) { const cny = json.rates.CNY; for (const [k, v] of Object.entries(json.rates)) if (v) rates[k] = Math.round((cny / v) * 10000) / 10000; }
  rates.CNY = 1;
  return rates;
}

// ———————————— 3. 来源可靠度 ————————————
/**
 * Beta(2,2) 平滑：用户正反馈（收藏 / 已领取）与负反馈（不是优惠 / 忽略）的比例，
 * 叠加最近 40 次抓取成功率与官方渠道加成。返回 0–1 与说明。
 */
function sourceReliability({ pos = 0, neg = 0, okRuns = 0, runs = 0, official = false } = {}) {
  const fb = (pos + 2) / (pos + neg + 4);
  const up = runs ? (okRuns + 1) / (runs + 2) : 0.75;
  const base = official ? 0.15 : 0;
  const score = Math.max(0, Math.min(1, 0.55 * fb + 0.3 * up + base));
  return { score: Math.round(score * 100) / 100, fb: Math.round(fb * 100) / 100, up: Math.round(up * 100) / 100, n: pos + neg };
}

// ———————————— 4. 反馈学习（朴素贝叶斯）————————————
const STOP = new Set('the a an and or of to in for on with by is are at from as your you this that new now get its it be'.split(' '));
function tokens(text) {
  const t = String(text || '').toLowerCase();
  const out = new Set();
  for (const w of t.match(/[a-z][a-z0-9+.-]{1,20}/g) || []) if (!STOP.has(w)) out.add(w);
  for (const m of t.match(/\$\s?\d+|\d+\s?%/g) || []) out.add(m.includes('%') ? '#pct' : '#usd');
  const cjk = t.replace(/[^\u4e00-\u9fff]+/g, ' ');
  for (const seg of cjk.split(' ')) for (let i = 0; i < seg.length - 1; i++) out.add(seg.slice(i, i + 2));
  return [...out].slice(0, 80);
}
function newModel() { return { pos: {}, neg: {}, np: 0, nn: 0, labels: {} }; }
/** 学习一条反馈；同一条目再次标注会先撤销旧标签 */
function learn(model, id, text, label) {
  const m = model || newModel();
  const prev = m.labels[id];
  const toks = tokens(text);
  const apply = (lab, sign) => { const bag = lab ? m.pos : m.neg; for (const w of toks) { bag[w] = Math.max(0, (bag[w] || 0) + sign); if (!bag[w]) delete bag[w]; } if (lab) m.np += sign; else m.nn += sign; };
  if (prev !== undefined) { if (prev === label) return m; apply(prev, -1); }
  apply(label, 1); m.labels[id] = label;
  const ids = Object.keys(m.labels); if (ids.length > 3000) delete m.labels[ids[0]];
  return m;
}
/** Graham 式组合：取偏离 0.5 最多的 15 个词。返回 P(感兴趣) 或 null（训练样本不足） */
function predict(model, text, { minLabels = 12 } = {}) {
  const m = model; if (!m || m.np + m.nn < minLabels || !m.np || !m.nn) return null;
  const probs = [];
  for (const w of tokens(text)) {
    const g = (m.pos[w] || 0); const b = (m.neg[w] || 0);
    if (g + b < 2) continue;
    const p = Math.min(0.99, Math.max(0.01, (g / m.np) / (g / m.np + b / m.nn)));
    probs.push(p);
  }
  if (!probs.length) return 0.5;
  probs.sort((a, b) => Math.abs(b - 0.5) - Math.abs(a - 0.5));
  const top = probs.slice(0, 15);
  const prod = top.reduce((a, p) => a * p, 1); const inv = top.reduce((a, p) => a * (1 - p), 1);
  return Math.round((prod / (prod + inv)) * 1000) / 1000;
}
/** 不确定性采样：挑出最接近 0.5 的未标注条目让用户判断 */
function uncertain(deals, model, { limit = 6 } = {}) {
  return deals.filter((d) => d.learnP !== undefined && d.learnP !== null && !(model.labels || {})[d.id] && d.status === 'new')
    .sort((a, b) => Math.abs(a.learnP - 0.5) - Math.abs(b.learnP - 0.5)).slice(0, limit);
}

// ———————————— 5. MinHash ————————————
function h32(str, seed) { let h = seed >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function shingles(text, k = 3) { const s = String(text || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ''); const out = new Set(); for (let i = 0; i + k <= s.length; i++) out.add(s.slice(i, i + k)); return out; }
function minhash(text, perms = 64) { const sh = [...shingles(text)]; const sig = new Array(perms).fill(0xffffffff); for (const x of sh) for (let i = 0; i < perms; i++) { const v = h32(x, 2166136261 + i * 374761393); if (v < sig[i]) sig[i] = v; } return sig; }
function mhSim(a, b) { let e = 0; for (let i = 0; i < a.length; i++) if (a[i] === b[i]) e++; return e / a.length; }
/** LSH 分桶：b 个 band × r 行，返回候选对 */
function lshPairs(items, { bands = 16, rows = 4 } = {}) {
  const buckets = new Map(); const pairs = new Set();
  for (const it of items) for (let b = 0; b < bands; b++) {
    const key = b + ':' + it.sig.slice(b * rows, b * rows + rows).join(',');
    const arr = buckets.get(key) || []; for (const o of arr) pairs.add(o < it.id ? o + '|' + it.id : it.id + '|' + o); arr.push(it.id); buckets.set(key, arr);
  }
  return [...pairs].map((p) => p.split('|'));
}

module.exports = { PRICE_RE, PLAN_RE, recordCheck, estimateRate, adaptiveInterval, adaptiveSkip, extractPrices, diffPrices, updatePriceBook, toCNY, parseFx, FX_FALLBACK, sourceReliability, tokens, newModel, learn, predict, uncertain, minhash, mhSim, lshPairs, shingles, periodOf };
