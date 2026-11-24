'use strict';
// v2.6：优惠有效期状态、「适用于我」画像匹配、领取指南、落地页复查、厂商覆盖透明度。全部为纯函数（复查的网络请求由调用方注入）。

const DAY = 86400000;
const ENDING_DAYS = 3;
const RECHECK_FRESH = 7 * DAY;
const STALE_DAYS = 45; // 无截止日、也没复查过的优惠：发布超过 45 天仍视为「状态未知」

// 落地页出现这些措辞 → 视为活动已结束
const GONE_RE = /\b(?:(?:this |the )?(?:offer|promotion|promo|deal|campaign|program(?:me)?)\s+(?:has\s+)?(?:ended|expired|concluded|is\s+(?:no\s+longer\s+available|closed|over|no\s+longer\s+offered))|no longer (?:available|offered|accepting (?:applications|sign-?ups))|(?:this |the )?(?:deal|offer|promo)\s+has\s+expired|applications (?:are )?(?:now )?closed|sign-?ups? (?:are|is) (?:now )?closed)\b|活动已(?:结束|截止|下线|关闭)|本活动已结束|优惠已(?:结束|失效|过期)|已停止(?:报名|申请|领取)|(?:报名|领取)已截止|名额已满|报名通道已关闭/i;
const NOT_FOUND_RE = /(?:page\s+(?:not\s+found|does(?:\s+not|n't)\s+exist)|404\s+not\s+found|we\s+can(?:\s+not|'t)\s+find\s+(?:this|that|the)\s+page|页面不存在|页面未找到|您访问的页面不存在|找不到(?:该|此)?页面)/i;

/** 有效期状态：active 进行中 / ending 即将截止（3 天内） / expired 已过期 / unknown 状态未知 */
function validity(d, now = Date.now()) {
  const f = d.facts || {};
  const rc = d.recheck || null;
  const out = (status, reason, extra = {}) => ({ status, reason, deadline: f.deadline || 0, checkedAt: rc ? rc.at : 0, ...extra });
  if (rc && rc.gone) return out('expired', rc.reason || 'landing-gone');
  if (f.deadline && f.deadline < now) return out('expired', 'deadline-passed');
  if (f.deadline && f.deadline - now <= ENDING_DAYS * DAY) return out('ending', 'deadline-soon', { daysLeft: Math.max(0, Math.ceil((f.deadline - now) / DAY)) });
  if (f.deadline) return out('active', 'deadline-future', { daysLeft: Math.ceil((f.deadline - now) / DAY) });
  // v2.6.1：新闻/第三方页面还能打开 ≠ 优惠仍有效，只有官方页面复查正常才算「进行中」
  if (rc && rc.ok && now - rc.at <= RECHECK_FRESH && (f.trust || {}).level === 3) return out('active', 'landing-ok');
  const age = now - (d.published || d.fetchedAt || now);
  if (age <= 14 * DAY && (f.trust || {}).level === 3) return out('active', 'recent-official');
  return out('unknown', age > STALE_DAYS * DAY ? 'stale' : 'no-deadline');
}

/** 解析落地页复查结果 */
function judgeLanding(html, httpStatus) {
  if (httpStatus === 404 || httpStatus === 410) return { ok: false, gone: true, reason: 'http-' + httpStatus };
  if (httpStatus && httpStatus >= 400) return { ok: false, gone: false, reason: 'http-' + httpStatus };
  const raw = String(html || '');
  const title = ((raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const text = raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (NOT_FOUND_RE.test(title) || (text.length < 400 && NOT_FOUND_RE.test(text))) return { ok: false, gone: true, reason: 'soft-404' };
  const m = text.match(GONE_RE);
  if (m) return { ok: false, gone: true, reason: 'text:' + m[0].slice(0, 60) };
  return { ok: true, gone: false, reason: 'ok' };
}

/** 选出需要复查落地页的优惠（最久未查的优先） */
function pickRecheck(deals, { now = Date.now(), hours = 12, limit = 15, maxAgeDays = 60 } = {}) {
  return deals.filter((d) => d.link && /^https?:/.test(d.link) && (d.offerTypes || []).length && d.facts && !d.pageDiff && d.status !== 'ignored'
    && now - (d.published || d.fetchedAt || 0) <= maxAgeDays * DAY && !(d.recheck && d.recheck.gone) && !(d.facts.deadline && d.facts.deadline < now)
    && (!d.recheck || now - d.recheck.at >= (d.recheck.suspect ? Math.min(hours, 1) : hours) * 3600000))
    .sort((a, b) => (+!!(b.recheck || {}).suspect - +!!(a.recheck || {}).suspect) || ((a.recheck || {}).at || 0) - ((b.recheck || {}).at || 0) || (b.published || 0) - (a.published || 0)).slice(0, limit);
}
async function recheckDeals(deals, fetchText, opts = {}) {
  const list = pickRecheck(deals, opts); const now = opts.now || Date.now(); let gone = 0;
  for (const d of list) {
    let r;
    try { const html = await fetchText(d.link, { timeout: 15000, cache: false }); r = judgeLanding(html, 200); } catch (e) { r = e.status ? judgeLanding('', e.status) : { ok: false, gone: false, reason: 'error' }; }
    // v2.6.1：HTTP 404/410 可能是 CDN / 反爬的偶发错误——须连续两次复查都 404 才判定已下线；页面文字明确写「已结束」则立即判定
    if (r.gone && /^(http-|soft-404)/.test(r.reason) && !(d.recheck && d.recheck.suspect)) r = { ok: false, gone: false, suspect: true, reason: r.reason };
    if (r.gone && /^(http-|soft-404)/.test(r.reason)) r.confirmed = true;
    d.recheck = { at: now, ...r }; if (r.gone) gone++;
  }
  return { checked: list.length, gone };
}

// —— 「适用于我」画像 ——
const DEFAULT_PROFILE = { region: 'any', student: false, userType: 'any', pay: [] };
const PAY_IDS = ['unionpay', 'alipay', 'wechat', 'card'];
/** appliesToMe(deal, profile) → { ok, reasons: [代码] }。信息不足时默认适用（宁可多给）。 */
function appliesToMe(d, p = DEFAULT_PROFILE) {
  p = { ...DEFAULT_PROFILE, ...(p || {}) };
  const f = d.facts; if (!f) return { ok: true, reasons: [] };
  const elig = f.elig || []; const aud = f.audience || []; const pay = new Set(p.pay || []);
  const reasons = [];
  const studentOnly = (elig.includes('学生') || (d.offerTypes || []).includes('student')) && !aud.includes('所有用户');
  if (studentOnly && !p.student) reasons.push('student-only');
  if (elig.includes('新用户') && p.userType === 'existing') reasons.push('new-users-only');
  const overseas = elig.includes('可能需海外账号 / 支付');
  if (overseas && p.region === 'cn' && p.pay && p.pay.length && !pay.has('card')) reasons.push('needs-intl-card');
  const lim = elig.find((e) => e.startsWith('限 '));
  if (lim && p.region === 'cn') reasons.push('region-limited');
  if (elig.includes('国内可用') && p.region === 'overseas' && (f.regions || []).length === 1 && f.regions[0] === '中国大陆' && p.pay.length && !['unionpay', 'alipay', 'wechat'].some((x) => pay.has(x))) reasons.push('needs-cn-payment');
  return { ok: reasons.length === 0, reasons };
}

// —— 领取指南 ——
const CODE_RE = /(?:promo(?:tion)?\s*code|coupon(?:\s*code)?|discount\s*code|use\s+code|code|优惠码|兑换码|邀请码|口令)\s*[:：]?\s*["“'「]?([A-Z0-9][A-Z0-9_-]{3,23})["”'」]?/;
function codeOf(text) {
  const m = String(text || '').match(CODE_RE); if (!m) return '';
  const c = m[1]; if (!/[0-9]/.test(c) && c.length < 5) return ''; if (/^(HTTP|HTTPS|API|FREE|PLUS|PRO)$/i.test(c)) return '';
  return /[a-z]/.test(c) && !/[A-Z]/.test(c) ? '' : c;
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } }
function sameSite(h, dom) { dom = String(dom || '').replace(/^www\./, '').toLowerCase(); return !!h && !!dom && (h === dom || h.endsWith('.' + dom)); }
/**
 * claimGuide(deal, { domains: [厂商官网域名], pricingUrl, promoUrls: [官方活动/学生页] })
 * → { kind, steps: [{ key }], claimUrl, claimUrlOfficial, code, warnings: [] }
 * 步骤与注意事项用 key 返回，由界面按语言翻译。
 */
function claimGuide(d, v = {}) {
  const text = `${d.title || ''} ${d.titleZh || ''} ${d.summary || ''}`;
  const f = d.facts || {}; const claim = f.claim || '';
  const doms = (v.domains || []).filter(Boolean);
  const linkHost = hostOf(d.link);
  const linkOfficial = doms.some((x) => sameSite(linkHost, x));
  const promo = (v.promoUrls || []).find((u) => /student|edu|educat|startup|free|promo|offer|学生|教育/i.test(u) && (((d.offerTypes || []).includes('student') && /student|edu|学生|教育/i.test(u)) || ((d.offerTypes || []).includes('startup') && /startup/i.test(u))));
  const claimUrl = linkOfficial ? d.link : (promo || v.pricingUrl || (doms[0] ? `https://${doms[0]}/` : d.link));
  const code = codeOf(text);
  let kind = 'visit';
  if (code || /优惠码|兑换码/.test(claim)) kind = 'code';
  else if (/申请/.test(claim) || (d.offerTypes || []).includes('startup')) kind = 'apply';
  else if (/合作方/.test(claim)) kind = 'partner';
  else if (/自动生效/.test(claim)) kind = 'auto';
  else if ((d.offerTypes || []).includes('student')) kind = 'student';
  const STEPS = {
    code: ['open-official', 'sign-in', 'enter-code', 'confirm-price'],
    apply: ['open-official', 'check-eligibility', 'submit-application', 'wait-review'],
    partner: ['check-partner', 'open-partner', 'link-account', 'confirm-price'],
    auto: ['open-official', 'sign-in', 'auto-applied'],
    student: ['open-official', 'verify-student', 'confirm-price'],
    visit: ['open-official', 'sign-in', 'find-offer', 'confirm-price'],
  };
  const warnings = [];
  if (/credit card|debit card|payment (?:method|details)|card (?:required|on file)|绑(?:定)?(?:信用)?卡|信用卡|需(?:要)?绑卡|预授权/i.test(text) || (/trial|试用/i.test(text) && (d.offerTypes || []).includes('free'))) warnings.push('needs-card');
  if (/auto[- ]?renew|renews? automatically|then \$\s?\d|after (?:the )?(?:trial|first)|billed (?:monthly|annually) after|自动续费|自动续订|到期后(?:按|将)|之后(?:按|恢复)/i.test(text) || (/(?:first|首)\s*(?:month|月)/i.test(text))) warnings.push('auto-renew');
  if ((f.elig || []).includes('可能需海外账号 / 支付')) warnings.push('intl-account');
  if ((f.elig || []).includes('第三方中转（非官方）')) warnings.push('reseller');
  if (!linkOfficial && d.link && claimUrl !== d.link) warnings.push('news-link');
  return { kind, steps: STEPS[kind], claimUrl, claimUrlOfficial: linkOfficial || claimUrl !== d.link, code, warnings };
}

// —— 覆盖透明度 ——
const BLIND_SPOTS_COMMON = ['x', 'linkedin', 'discord', 'wechat-mp', 'in-app'];
const BLIND_SPOTS_VENDOR = {
  openai: ['help-center'], anthropic: ['help-center'], cursor: ['forum-login'], xai: ['x-primary', 'sitemap-403'], 'github-copilot': ['email-only'],
  doubao: ['in-app-cn'], kimi: ['in-app-cn'], qwen: ['in-app-cn'], deepseek: ['in-app-cn'], zhipu: ['in-app-cn'], coze: ['in-app-cn'], minimax: ['in-app-cn'],
  gemini: ['carrier-region'], perplexity: ['partner-region'],
};
/** coverage(brands, channelSources, sourceStatus, now) → 每个已启用厂商一行 */
function coverage(brands, chSources, status = {}, now = Date.now()) {
  return brands.filter((b) => b.enabled).map((b) => {
    const chs = chSources.filter((s) => s.brandId === b.id);
    const on = chs.filter((s) => s.enabled !== false);
    const rows = on.map((s) => { const st = status[s.id] || null; return { id: s.id, name: s.name, type: s.type, sub: s.sub, ok: st ? !!st.ok : null, at: st ? st.lastRun || 0 : 0, error: st && !st.ok ? String(st.error || '').slice(0, 120) : '' }; });
    const okRows = rows.filter((r) => r.ok === true);
    const lastOk = okRows.reduce((m, r) => Math.max(m, r.at), 0);
    const lastCheck = rows.reduce((m, r) => Math.max(m, r.at), 0);
    const failing = rows.filter((r) => r.ok === false);
    const pending = rows.filter((r) => r.ok === null);
    const level = !rows.length ? 'none' : !okRows.length ? (pending.length === rows.length ? 'pending' : 'down') : failing.length / rows.length > 0.15 ? 'partial' : 'good';
    return { id: b.id, name: b.name, total: rows.length, disabled: chs.length - on.length, ok: okRows.length, failing: failing.length, pending: pending.length, lastOk, lastCheck, level,
      failingList: failing.slice(0, 8), blind: [...BLIND_SPOTS_COMMON, ...(BLIND_SPOTS_VENDOR[b.id] || [])], stale: lastOk ? now - lastOk > DAY : true };
  });
}

/** 厂商快速查询：名称 / 别名 / 中文名匹配（大小写不敏感，忽略空格与 / ） */
function matchVendor(brands, q) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s/·._-]+/g, '').replace(/\*/g, '');
  const n = norm(q); if (n.length < 2) return [];
  const scored = [];
  for (const b of brands) {
    const names = [b.name, b.id, ...(b.aliases || []), ...(b.zh ? [b.zh] : [])].map(norm).filter(Boolean);
    let s = 0;
    for (const x of names) { if (x === n) s = Math.max(s, 3); else if (x.startsWith(n)) s = Math.max(s, 2); else if (n.length >= 3 && x.includes(n)) s = Math.max(s, 1); }
    if (s) scored.push([s, b]);
  }
  return scored.sort((a, b) => b[0] - a[0] || (b[1].enabled ? 1 : 0) - (a[1].enabled ? 1 : 0)).map((x) => x[1]);
}

module.exports = { validity, judgeLanding, pickRecheck, recheckDeals, appliesToMe, claimGuide, codeOf, coverage, matchVendor, DEFAULT_PROFILE, PAY_IDS, GONE_RE, BLIND_SPOTS_COMMON, BLIND_SPOTS_VENDOR, ENDING_DAYS };
