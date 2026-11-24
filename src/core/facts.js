'use strict';
// v2.3：从优惠标题 / 摘要中启发式抽取结构化字段（力度、适用对象、地区、截止时间、领取方式、来源可信度、资格标签）
// 纯函数，无网络依赖；主进程在入库时计算并缓存到 deal.facts，渲染进程直接展示。
const { offerConfidence, RESELLER } = require('./offers');

const MONTHS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
const MON_RE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const CN_VENDORS = new Set(['deepseek', 'kimi', 'zhipu', 'qwen', 'doubao', 'ernie', 'hunyuan', 'spark', 'minimax', 'coze']);

// 把「月/日」推断成具体时间戳（截止当天 23:59:59）：早于发布时间 60 天以上则视为下一年
function mkDate(y, m, d, ref) {
  const base = new Date(ref || Date.now());
  let year = y || base.getFullYear();
  let t = new Date(year, m, d, 23, 59, 59).getTime();
  const check = new Date(t);
  if (check.getFullYear() !== year || check.getMonth() !== m || check.getDate() !== d) return 0;
  if (!y && t < (ref || Date.now()) - 60 * 86400000) t = new Date(year + 1, m, d, 23, 59, 59).getTime();
  if (isNaN(t) || m < 0 || m > 11 || d < 1 || d > 31) return 0;
  return t;
}
function parseDeadline(text, ref) {
  const s = String(text || '');
  let m;
  // Explicit zoned deadlines represent an instant, not machine-local end of day.
  const stamp = s.match(/(?:until|ends?(?:\s+on)?|expires?(?:\s+on)?|deadline:?|截止(?:日期)?[:：]?)\s*(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2}))/i);
  if (stamp) {
    const date = stamp[1].slice(0, 10).split('-').map(Number);
    if (!mkDate(date[0], date[1] - 1, date[2], ref)) return 0;
    return Number.isFinite(Date.parse(stamp[1])) ? Date.parse(stamp[1]) : 0;
  }
  // 英文：until / through / by / before / ends / expires / till + Month Day[, Year]
  const en = new RegExp(`\\b(?:until|through|thru|by|before|ends?(?:\\s+on)?|expires?(?:\\s+on)?|valid\\s+(?:until|till|through)|till|deadline:?)\\s+(${MON_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?`, 'i');
  if ((m = s.match(en))) return mkDate(m[3] ? Number(m[3]) : 0, MONTHS[m[1].toLowerCase()], Number(m[2]), ref);
  const en2 = new RegExp(`\\b(?:until|through|by|before|ends?|expires?|till)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MON_RE})(?:\\s+(20\\d{2}))?`, 'i');
  if ((m = s.match(en2))) return mkDate(m[3] ? Number(m[3]) : 0, MONTHS[m[2].toLowerCase()], Number(m[1]), ref);
  // 中文：[YYYY年]M月D日前 / 截至(到)M月D日 / M月D日截止 / 至M月D日
  if ((m = s.match(/(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?\s*(?:之?前|截止|止|结束|到期)/))) return mkDate(m[1] ? Number(m[1]) : 0, Number(m[2]) - 1, Number(m[3]), ref);
  if ((m = s.match(/(?:截至|截止(?:到|至)?|至|到)\s*(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/))) return mkDate(m[1] ? Number(m[1]) : 0, Number(m[2]) - 1, Number(m[3]), ref);
  // ISO：until 2026-10-31
  if ((m = s.match(/\b(?:until|by|before|through|截止|截至)\s*(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/i))) return mkDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), ref);
  // v2.11：截止日期：2026年11月30日 / 有效期至 2026-12-31
  if ((m = s.match(/(?:截止(?:日期)?|有效期至?|到期(?:日)?|截止日期)\s*[:：]?\s*(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/))) return mkDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), ref);
  if ((m = s.match(/(?:截止(?:日期)?|有效期至?|到期)\s*[:：]?\s*(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/))) return mkDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), ref);
  // v2.11：until 11/30/2026 或 30/11/2026（首位 > 12 则视为日/月/年）
  if ((m = s.match(/\b(?:until|through|thru|by|before|ends?(?:\s+on)?|expires?(?:\s+on)?|valid\s+(?:until|till|through)|till|deadline:?)\s+(\d{1,2})[/-](\d{1,2})[/-](20\d{2})/i))) {
    const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    if (a <= 12 && b <= 12 && a !== b) return 0; // locale-ambiguous, do not invent an expiry
    return a > 12 ? mkDate(y, b - 1, a, ref) : mkDate(y, a - 1, b, ref);
  }
  // v2.11：ends in 3 days / 还有 2 周
  if ((m = s.match(/\b(?:ends?|expires?|closes?)\s+in\s+(\d{1,3})\s+(days?|weeks?)\b/i))) {
    const n = Number(m[1]) * (/week/i.test(m[2]) ? 7 : 1);
    const t0 = (ref || Date.now()) + n * 86400000;
    const d = new Date(t0); d.setHours(23, 59, 59, 0); return d.getTime();
  }
  if ((m = s.match(/(?:还有|剩余|剩)\s*(\d{1,3})\s*(天|日|周|星期)/))) {
    const n = Number(m[1]) * (/周|星期/.test(m[2]) ? 7 : 1);
    const t0 = (ref || Date.now()) + n * 86400000;
    const d = new Date(t0); d.setHours(23, 59, 59, 0); return d.getTime();
  }
  return 0;
}

const CREDIT_RE = /(?:\$|US\$|USD\s?)\s?(\d[\d,]*(?:\.\d+)?)\s?(k)?\s+(?:in\s+|of\s+|worth\s+of\s+)?(?:free\s+)?(?:api\s+|cloud\s+)?credits?/i;
function creditsOf(s) { const m = String(s).match(CREDIT_RE); return m ? `$${m[1]}${m[2] ? 'K' : ''} 额度` : ''; }
function amountOf(text, d) {
  const s = String(text || '');
  let m;
  const cr = creditsOf(s);
  if (cr) { const rest = amountOf(s.replace(CREDIT_RE, ' '), null); return rest && rest !== '免费' ? `${rest} + ${cr}` : cr; }
  if ((m = s.match(/(\d+(?:\.\d+)?)\s*(?:万)?\s*(tokens?|token)/i)) && /免费|赠|送|free/i.test(s)) return `${m[1]}${/万/.test(m[0]) ? '万' : ''} tokens`;
  if ((m = s.match(/(\d+(?:\.\d+)?)\s*倍\s*(?:免费)?额度/))) return `${m[1]} 倍额度`;
  if ((m = s.match(/(?:赠送?|送|领)\s*(\d+(?:\.\d+)?)\s*(元|美元|美金|刀)/))) return `送 ${m[1]}${m[2] === '刀' ? ' 美元' : m[2]}`;
  if ((m = s.match(/\b(\d{1,3})\s?%\s?(?:off|discount)/i)) || (m = s.match(/save\s+(\d{1,3})%/i))) return `${m[1]}% OFF`;
  if ((m = s.match(/(\d(?:\.\d)?)\s?折(?!叠)/))) return `${m[1]} 折`;
  if (/半价|half[- ]price|50% off/i.test(s)) return '半价';
  if ((m = s.match(/\b(?:(\d+|one|two|three|six|twelve|a)[-\s](month|year|week)s?)\s+(?:of\s+)?(?:free|at no cost)|\bfree\s+(?:for\s+)?(\d+|one|two|three|six|twelve|a)\s+(month|year|week)s?/i))) {
    const n = m[1] || m[3]; const u = m[2] || m[4];
    const N = { a: 1, one: 1, two: 2, three: 3, six: 6, twelve: 12 }[String(n).toLowerCase()] || n;
    return `免费 ${N} ${{ month: '个月', year: '年', week: '周' }[u.toLowerCase()]}`;
  }
  if (/\bfree\s+year\b|一年(会员)?(免费|白送)|免费(送)?一年/i.test(s)) return '免费 1 年';
  if ((m = s.match(/免费\s*(\d+)\s*(个?月|天|年)/))) return `免费 ${m[1]} ${m[2]}`;
  if ((m = s.match(/(\d+(?:\.\d+)?)\s*元\s*\/\s*月/))) return `${m[1]} 元/月`;
  if ((m = s.match(/\$\s?(\d+(?:\.\d+)?)\s*\/\s*(?:mo|month)/i))) return `$${m[1]}/月`;
  if (/\bfree\b|免费|限免/i.test(s)) return '免费';
  if (d && d.discount) return d.discount;
  if (/cheaper|降价|下调|直降/i.test(s)) return '降价';
  return '';
}

const AUD = [
  ['学生', /\b(students?|college|universit(y|ies)|campus|edu)\b|学生|高校|校园|大学生/i],
  ['教师', /\b(teachers?|educators?)\b|教师|老师/i],
  ['创业公司', /\b(startups?|founders?)\b|创业|初创/i],
  ['开发者', /\b(developers?|devs|api)\b|开发者|API/i],
  ['企业', /\b(enterprise|business|teams?|companies|organi[sz]ations?)\b|企业|团队|政企/i],
  ['开源维护者', /\b(open[- ]source maintainers?|oss maintainers?)\b|开源/i],
  ['新用户', /\b(new (users?|customers?|subscribers?|accounts?)|first[- ]time)\b|新用户|新客|首月|首单/i],
  ['特定设备 / 合作方用户', /\b(pixel|galaxy|asus|rog|paypal|verizon|t-mobile|airtel|jio|xbox|samsung|lenovo|antom)\b|PayPal|三星|华硕|联想|运营商/i],
  ['所有用户', /\b(all users|everyone|for all|free users?|all (plans|tiers))\b|所有用户|全体用户|全部用户|免费用户/i],
];
const REGIONS = [
  ['中国大陆', /国内|中国大陆|大陆用户|\bchina\b|人民币|¥|元\/月/i], ['美国', /\b(u\.?s\.?|united states|america)\b|美国|美区/i], ['印度', /\bindia(n)?\b|印度/i],
  ['印尼', /\bindonesia\b|印尼/i], ['英国', /\b(uk|united kingdom|britain)\b|英国/i], ['欧盟', /\b(eu|europe(an)?)\b|欧洲|欧盟/i], ['日本', /\bjapan(ese)?\b|日本/i],
  ['加拿大', /\bcanada\b|加拿大/i], ['泰国', /\bthailand\b|泰国/i], ['全球', /\b(global(ly)?|worldwide)\b|全球/i],
];
function claimOf(s) {
  if (/\b(promo|coupon|discount)\s?code\b|优惠码|兑换码|邀请码|口令/i.test(s)) return '优惠码 / 兑换码';
  if (/\b(apply|application|applications|program|programme|cohort|grant)\b|申请|报名|计划/i.test(s)) return '需申请审核';
  if (/\bvia\b|\bthrough\b.{0,20}\b(paypal|pixel|asus|verizon)|绑定|通过.{0,8}(领取|开通)|PayPal/i.test(s)) return '通过合作方领取';
  if (/\b(automatically|auto[- ]applied|now (free|available)|for all users|rolling out)\b|自动|直接(使用|开通)|全量/i.test(s)) return '自动生效 / 直接使用';
  if (/\b(claim|redeem|sign up|get it)\b|领取|开通|注册/i.test(s)) return '官网领取 / 注册';
  return '';
}
function trustOf(d) {
  const official = d.platform === '厂商渠道' ? !['news', 'reddit', 'forum'].includes(d.sub) : d.platform === '厂商官方';
  if (official || d.sub === 'pricing') return { level: 3, label: '官方' };
  if ((d.sources || []).length > 1) return { level: 2, label: `媒体 · ${(d.sources || []).length} 源交叉` };
  if (['reddit', 'forum'].includes(d.sub) || /V2EX|Reddit|Hacker News|社区|HotUKDeals|Slickdeals|Product Hunt/i.test(d.platform || '')) return { level: 1, label: '社区' };
  return { level: 2, label: '媒体' };
}

/** extractFacts(deal, { brands }) → facts */
function extractFacts(d, opts = {}) {
  const text = `${d.title || ''} ${d.titleZh || ''} ${(d.summary || '').slice(0, 300)}`;
  const title = `${d.title || ''} ${d.titleZh || ''}`;
  const audience = AUD.filter(([, re]) => re.test(title)).map(([n]) => n);
  const regions = REGIONS.filter(([, re]) => re.test(title)).map(([n]) => n);
  const deadline = d.pageDiff ? 0 : parseDeadline(text, d.published || d.fetchedAt);
  const cn = (d.brandIds || []).some((id) => CN_VENDORS.has(id)) || d.region === 'cn' && regions.includes('中国大陆');
  const elig = [];
  if (cn || regions.includes('中国大陆')) elig.push('国内可用');
  else if ((d.brandIds || []).length && (d.offerTypes || []).some((t) => ['free', 'discount', 'plan', 'event'].includes(t)) && !audience.includes('开发者')) elig.push('可能需海外账号 / 支付');
  if (audience.includes('学生') || (d.offerTypes || []).includes('student')) elig.push('学生');
  if (audience.includes('企业') || audience.includes('创业公司') || (d.offerTypes || []).includes('startup')) elig.push('企业 / 创业');
  if (audience.includes('新用户')) elig.push('新用户');
  if (RESELLER.test(title)) elig.unshift('第三方中转（非官方）');
  if (regions.length && !regions.includes('中国大陆') && !regions.includes('全球')) elig.push('限 ' + regions.slice(0, 2).join('/'));
  const facts = {
    amount: d.pageDiff ? '价格页有改动' : amountOf(title, d) || amountOf(text, d),
    audience, regions, deadline, claim: claimOf(text), trust: trustOf(d), elig: [...new Set(elig)],
    confidence: offerConfidence(d),
  };
  return facts;
}

module.exports = { extractFacts, parseDeadline, amountOf, claimOf, trustOf, CN_VENDORS };
