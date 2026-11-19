'use strict';
/**
 * v2.9 基于调研的优化（见 RESEARCH.md）
 * 1. 正文抽取：去掉 Cookie 横幅 / 对话框 / 导航 / 页眉页脚（readability / trafilatura 的样板去除思路）
 * 2. 易变内容归一化：「Updated: 3 hours ago」「5 分钟前」之类相对时间不算变化（changedetection.io 的 ignore_text 思路）
 * 3. 版本翻转识别：页面在已见过的版本之间来回切换（A/B 测试、CDN 节点不一致）不重复提醒
 * 4. 价格页结构化比较：只有价格 / 套餐 / 优惠字样变化才提醒（restock_diff / price-change detector）
 * 5. 多源佐证（KBT，Dong et al. 2015 的思路简化）：同一优惠被多个独立站点报道时提高置信度
 * 6. 轮询抖动：给下次检查时间加 ±15% 随机抖动，避免所有渠道同时到期造成突发请求
 */
const crypto = require('crypto');
const { parse } = require('node-html-parser');
const { PRICE_RE, PLAN_RE } = require('./v27');

const BOILER_SEL = 'nav,footer,aside,[role=navigation],[role=contentinfo],[role=dialog],[role=alertdialog],[aria-hidden=true],[aria-modal=true],dialog';
const BOILER_ATTR = /(^|[\s_-])(cookie|cookies|consent|onetrust|gdpr|cc-banner|cookiebar|ot-sdk|truste|newsletter-signup|skip-link)([\s_-]|$)/i;

/** 去掉 DOM 中的样板区域；返回被移除的节点数 */
function stripBoilerplate(root) {
  let n = 0;
  root.querySelectorAll(BOILER_SEL).forEach((x) => { x.remove(); n++; });
  root.querySelectorAll('[id],[class]').forEach((x) => { const a = (x.getAttribute('id') || '') + ' ' + (x.getAttribute('class') || ''); if (a.length < 400 && BOILER_ATTR.test(a)) { x.remove(); n++; } });
  // 只含导航链接的页眉（header 里有 nav 已被移除；剩下纯链接列表的 header 也去掉）
  root.querySelectorAll('header').forEach((x) => { const txt = x.text.replace(/\s+/g, ' ').trim(); const links = x.querySelectorAll('a').length; if (links >= 4 && txt.length / links < 25) { x.remove(); n++; } });
  return n;
}

// 界面控件文字：单独成行时不算内容
const UI_WORDS = new Set(['close', 'new', 'menu', 'open menu', 'close menu', 'toggle menu', 'reject all', 'accept all', 'accept', 'decline', 'cookies settings', 'cookie settings', 'manage cookies', 'cookie policy', 'privacy policy', 'terms of service', 'terms of use', ', and', 'and', 'learn more', 'read more', 'skip to content', 'skip to main content', 'sign in', 'log in', 'login', 'sign up', 'get started', 'back to top', 'dismiss', 'got it', 'ok', 'copy', 'copied', 'share', 'loading', 'loading...', 'beta', 'hot', '关闭', '新', '菜单', '登录', '注册', '接受', '拒绝', '了解更多', '加载中']); // i18n-ok 匹配用词表，不显示
const COOKIE_LINE = /\b(cookies?|consent)\b.*\b(accept|reject|manage|policy|preferences|optional|essential|advertising)\b/i;
function isChrome(line) {
  const t = String(line || '').trim().toLowerCase().replace(/[.!…:：]+$/, '');
  if (!t) return true;
  if (UI_WORDS.has(t)) return true;
  if (t.length < 400 && COOKIE_LINE.test(t)) return true;
  return false;
}

// 相对时间 / 计数等易变片段 → 占位符
const VOLATILE = [
  [/\b(?:about |over |almost )?(?:a|an|one|\d+)\s*(?:sec(?:ond)?s?|min(?:ute)?s?|h(?:ou)?rs?|hours?|days?|weeks?|wks?|months?|mos?|years?|yrs?)\s+ago\b/gi, '{ago}'],
  [/\b(?:just now|yesterday|today|moments ago)\b/gi, '{ago}'],
  [/\d+\s*(?:秒|分钟|小时|天|周|个月|月|年)前|刚刚|昨天|今天/g, '{ago}'],
  [/\b(updated|last updated|edited|posted)\s*:?\s*\{ago\}/gi, '$1 {ago}'],
  [/\b\d+(?:\.\d+)?[kKmM]?\s+(?:views|likes|stars|comments|reads|downloads|watching|online|followers)\b/gi, (m) => '{n} ' + m.trim().split(/\s+/).pop()],
  [/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?\d{4}/gi, '©{year}'],
];
function normalizeLine(line) {
  let t = String(line || '');
  for (const [re, rep] of VOLATILE) t = t.replace(re, rep);
  return t;
}

/** 正文抽取（无 CSS 选择器 / 关键词时使用）→ 归一化文本行 */
function extractMain(html, extractLines) {
  const root = parse(html, { comment: false, blockTextElements: { script: false, style: false, noscript: false, pre: true } });
  root.querySelectorAll('script,style,noscript,svg,template,iframe,link,meta,img,video,picture,source').forEach((n) => n.remove());
  stripBoilerplate(root);
  const lines = extractLines(root.toString(), {});
  return cleanLines(lines);
}
function cleanLines(lines) {
  const out = [];
  for (const l of lines || []) { if (isChrome(l)) continue; const n = normalizeLine(l); if (n !== out[out.length - 1]) out.push(n); }
  return out;
}

function hashOf(lines) { return crypto.createHash('sha1').update([...new Set(lines)].sort().join('\n')).digest('hex').slice(0, 16); }

/** 价格页指纹：金额（带币种）+ 套餐名 */
function priceFacts(lines) {
  const prices = new Set(); const plans = new Set();
  const re = new RegExp(PRICE_RE.source, 'g');
  for (const l of lines || []) {
    if (l.length > 300) continue;
    for (const m of l.matchAll(re)) prices.add(m[0].replace(/\s+/g, '').replace(/,(?=\d{3}\b)/g, ''));
    const t = l.trim(); if (t.length <= 28 && t.split(/\s+/).length <= 3 && PLAN_RE.test(t)) plans.add(t.toLowerCase());
  }
  return { prices, plans };
}
const OFFER_WORDS = /free trial|trial|% off|\boff\b|discount|promo|coupon|limited[- ]time|sale|deal|save \d|student|edu(cation)?\s+(discount|plan|pricing)|限时|优惠|折扣|免费试用|试用|学生|教育|特惠|立减|折/i;

/**
 * 判断一次页面变化是否值得提醒
 * prev: { lines, seen:[hash] }；next: lines；sub: 渠道类型
 * 返回 { alert, reason, added, removed, priceDiff:{added,removed} }
 */
function judgeChange(prevLines, nextLines, { sub = '', seen = [], hash = '' } = {}) {
  const o = new Set(prevLines); const n = new Set(nextLines);
  const added = nextLines.filter((l) => !o.has(l)); const removed = prevLines.filter((l) => !n.has(l));
  if (!added.length && !removed.length) return { alert: false, reason: 'order', added, removed };
  if (hash && seen.includes(hash)) return { alert: false, reason: 'flip', added, removed };
  if (sub === 'pricing') {
    const a = priceFacts(prevLines); const b = priceFacts(nextLines);
    const pa = [...b.prices].filter((x) => !a.prices.has(x)); const pr = [...a.prices].filter((x) => !b.prices.has(x));
    const la = [...b.plans].filter((x) => !a.plans.has(x)); const lr = [...a.plans].filter((x) => !b.plans.has(x));
    if (a.prices.size >= 2 && b.prices.size === 0) return { alert: false, reason: 'noprices', added, removed };
    const offer = added.some((l) => OFFER_WORDS.test(l) && l.length < 300);
    if (!pa.length && !pr.length && !la.length && !lr.length && !offer) return { alert: false, reason: 'text', added, removed };
    return { alert: true, reason: pa.length || pr.length ? 'price' : la.length || lr.length ? 'plan' : 'offer', added, removed, priceDiff: { added: pa, removed: pr, plansAdded: la, plansRemoved: lr } };
  }
  return { alert: true, reason: 'content', added, removed };
}
const REASON_NOTE = { order: '仅顺序变化，已忽略', flip: '页面切换回之前见过的版本（灰度测试或缓存节点不一致），已忽略', noprices: '本次页面没有显示任何价格（可能跳转到其它页面），已忽略', text: '价格和套餐都没有变化，只是文字调整，已记录不提醒' };

/** 记住最近见过的版本指纹（最多 8 个） */
function remember(seen, hash) { const s = (Array.isArray(seen) ? seen : []).filter((h) => h !== hash); s.push(hash); return s.slice(-8); }

// ———————————— 5. 多源佐证（KBT 简化） ————————————
function hostKey(u) { try { const h = new URL(u).hostname.replace(/^www\./, ''); const p = h.split('.'); return p.length > 2 && !/^(co|com|org|net|gov|edu)$/.test(p[p.length - 2]) ? p.slice(-2).join('.') : p.slice(-3).join('.'); } catch { return ''; } }
/**
 * 根据「多少个独立站点报道了同一条」提高置信度：
 * conf' = 1 − (1 − conf) × (1 − r)^(k−1)，r 为每多一个独立来源带来的确认度（默认 0.35），k = 独立站点数
 * 官方来源本身已是高置信度；只有 1 个来源时不变
 */
const AGG = /^(news\.google\.com|google\.com|bing\.com|msn\.com|news\.yahoo\.com|feedproxy\.google\.com)$/;
/** 来源的「独立站点」键：聚合器链接（Google 新闻等）用媒体名（标题后缀），否则用注册域名 */
function outletKey(x) {
  const link = typeof x === 'string' ? x : (x && x.link) || ''; const outlet = typeof x === 'object' && x ? x.outlet : '';
  const h = hostKey(link);
  if (outlet) return 'o:' + String(outlet).toLowerCase().replace(/^(the\s+|www\.|手机|mobile\s+|m\.)/, '').replace(/[\s.]+/g, '');
  if (AGG.test(h)) return 'agg:' + link;
  return h;
}
function outletOf(title) { const m = String(title || '').match(/\s[-–|]\s([^-–|]{2,40})$/); return m ? m[1].trim() : ''; }
function corroborate(conf, links, { r = 0.35, cap = 0.97 } = {}) {
  const byLink = new Set(); const uniq = (links || []).filter((x) => { const l = typeof x === 'string' ? x : (x && x.link) || ''; if (l && byLink.has(l)) return false; byLink.add(l); return true; });
  const hosts = new Set(uniq.map(outletKey).filter(Boolean));
  const k = hosts.size;
  const c = Math.max(0, Math.min(1, Number(conf) || 0));
  if (k <= 1) return { conf: c, hosts: k };
  return { conf: Math.min(cap, Math.max(c, 1 - (1 - c) * Math.pow(1 - r, k - 1))), hosts: k };
}

// ———————————— 6. 轮询抖动 ————————————
/** 由来源 id 和轮次决定的确定性抖动系数 ∈ [1−j, 1+j] */
function jitter(id, round, j = 0.15) { const h = crypto.createHash('md5').update(String(id) + '|' + round).digest(); return 1 - j + (h.readUInt32BE(0) / 0xffffffff) * 2 * j; }

module.exports = { outletKey, outletOf, stripBoilerplate, isChrome, normalizeLine, extractMain, cleanLines, hashOf, priceFacts, judgeChange, REASON_NOTE, remember, corroborate, hostKey, jitter, OFFER_WORDS };
