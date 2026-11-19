'use strict';
// 优惠类型识别：把一条资讯/帖子归类为 免费试用 / 折扣降价 / 赠送额度 / 学生教育 / 创业扶持 / 限时活动 / 新套餐
// 只看标题（必要时加摘要），尽量保守，宁缺毋滥。

const NEG = /(no longer|not|isn't|is not|won't|will not|never|ends?|ending|ended|stops?|removes?|kills?|scraps?)\s+(be\s+)?(free|discount)|不再免费|取消免费|停止免费|结束免费|无(降价|优惠)|不会降价|没有优惠|从未降价/gi;

const TYPES = [
  { id: 'free', label: '免费试用', re: [
    /\bfree\s+(trial|trials|month|months|year|access|upgrade|for\s+(all|everyone|students|users|a\s+year|one\s+year|\d+|a|one|two|three|six|twelve)\b)/i,
    /\b(\d+|one|two|three|six|twelve)[-\s](day|week|month|year)s?\s+(of\s+)?(free|trial|at no cost)/i,
    /\b(for|is|are|now|becomes?|made)\s+free\b(?!\s+users)/i, /\b(offers?|offering|gives?|giving|get|gets|getting|grab|claim)\s+(a\s+)?free\b(?!\s+users)/i,
    /\bfree\s+[\w+.-]+(\s+[\w+.-]+){0,3}\s+for\s+(one|a|an|\d+|two|three|six|twelve)\s+(full\s+)?(day|week|month|year)s?\b/i, /\bfree for (\w+\s+)?(students|teachers|educators|developers|startups|nonprofits|subscribers|members)\b/i, /\bat no (extra )?cost\b/i, /\b(\d+|one|two|three|six|twelve)[-\s](month|year)s?\b.{0,40}\b(subscription|membership|plan|pro|plus)\s+(is\s+)?free\b/i, /\bfree of charge\b/i, /\bavailable for free\b/i, /\btry .{0,30} (for )?free\b/i,
    /免费(试用|体验|使用|用(?!户)|领|送|开放|升级|获得|赠送|畅享|白嫖|开通|\s*\d+\s*个?(天|月|年))/, /限免|白嫖|0\s?元(购|用|开通|体验)|首月\s*0|一元(体验|开通)/,
  ] },
  { id: 'discount', label: '折扣降价', re: [
    /\b\d{1,3}\s?%\s?(off|cashback|cash back|discount)\b/i, /\bcash\s?back\b/i, /\bslash(es|ed|ing)?\b.{0,25}\bprices?\b/i, /\bcuts?\b.{0,25}\bprices?\b/i, /\bprices?\b.{0,20}\bby\s+\d{1,3}\s?%/i, /\bprices?\b.{0,15}\b(slashed|cut|drops?|lowered|reduced)\b/i, /\bhalf[- ]price\b/i, /\b(discount|discounted|price cut|price drop|cuts? (the )?price|slash(es|ed)? (the )?price|price reduction|cheaper|lower price|promo code|coupon|on sale)\b/i,
    /\bsave \$?\d+/i, /\b(best|great|hot|exclusive|holiday|daily|top|early[- ]bird|sweet|killer|lifetime)\s+deals?\b/i, /\bdeals? (on|alert)\b/i, /\bdeal:/i,
    /降价|打折|折扣|\d(\.\d)?\s?折(?!叠)|半价|特价|立减|直降|优惠(码|券|价|活动|套餐)?|限时(特)?惠|低至|骨折|跳水|砍价|便宜/,
  ] },
  { id: 'credits', label: '赠送额度', re: [
    /\b(api |cloud |free |bonus |extra |\$\d[\d,]*k? (in |of )?(api |cloud |free )?)credits?\b/i, /\bfree (tokens?|usage|compute|gpu hours?)\b/i, /\b(credits?|tokens?) (giveaway|for free|bonus)\b/i,
    /(赠送?|送|领|免费).{0,16}(额度|token|代金券|算力|积分|余额|调用量)|(额度|token|tokens)\s*(免费|赠送|翻倍)|代金券|免费额度|tokens?\s*补贴|算力补贴/i,
  ] },
  { id: 'student', label: '学生教育', re: [
    /\b(students?|education(al)?|edu|teachers?|universit(y|ies)|college|campus|academic)\b.{0,40}\b(free|discount|offer|plan|pricing|pack|program|credits?|off)\b/i,
    /\b(free|discount|offer|plan|pack|program|credits?)\b.{0,40}\b(students?|education(al)?|teachers?|universit(y|ies)|college|campus)\b/i,
    /(学生|教育|校园|高校|教师|大学生).{0,10}(免费|优惠|折扣|认证|计划|特惠|会员|权益)|(免费|优惠|折扣).{0,10}(学生|教育版|高校|大学生)/,
  ] },
  { id: 'startup', label: '创业扶持', re: [
    /\b(startup|startups|founders?)\b.{0,30}\b(program|credits?|perks?|free|offer)\b/i, /\b(for startups|activate credits|accelerator)\b/i,
    /(创业|初创).{0,10}(扶持|计划|额度|补贴|免费)/,
  ] },
  { id: 'pricing', label: '价格页变动', re: [] }, // 由网页变化监控生成，不参与文本识别
  { id: 'event', label: '限时活动', re: [
    /\b(black friday|cyber monday|prime day|limited[- ]time|giveaway|holiday sale|anniversary sale|launch (offer|promo|discount)|early[- ]bird|promo(tion)?s?|promotional)\b/i,
    /双十一|双11|双十二|双12|618|黑五|限时|周年庆|活动|狂欢|大促|秒杀|抽奖|福利|羊毛/,
  ] },
  { id: 'plan', label: '新套餐', re: [
    /\b(new|cheaper|lower[- ]cost|budget|cheapest|affordable|ad-supported|introduc(es|ing)|launch(es|ed|ing)?|unveils?|rolls? out)\b.{0,25}\b(plan|plans|tier|tiers|subscription|pricing)\b/i,
    /新(套餐|会员|订阅|档位|定价)|(推出|上线|发布).{0,8}(套餐|会员|订阅|定价)|(套餐|会员|订阅)(价格)?(调整|下调|更便宜)/,
  ] },
];
const LABELS = Object.fromEntries(TYPES.map((t) => [t.id, t.label]));
// 「限时活动」「新套餐」本身较宽泛：只有在没有更具体类型时才保留，且活动词需要与优惠语义同现
const WEAK = new Set(['event', 'plan']);
const KILL = /\b(pauses?|paused|suspends?|suspended|halts?|halted|discontinues?|discontinued|scraps?|scrapped|kills?|axes|axed|ended|taking away|takes away|took away|remov(es|ed|ing)|restrict(s|ed|ing)?|limited to|nerf(s|ed)?|no more)\b|暂停|停止|叫停|下线|取消|结束|早报|晚报|日报|周报|新闻汇总|一周回顾|\b(newsletter|roundup|this week in|daily digest)\b/i;

function classifyOffer(text) {
  if (!text) return [];
  // 优惠暂停/结束、新闻汇总类标题不算优惠
  if (KILL.test(text)) return [];
  const t = String(text).replace(NEG, ' ').replace(/self[- ]promo(tion)?/gi, ' ');
  const hits = TYPES.filter((ty) => ty.re.some((re) => re.test(t))).map((ty) => ty.id);
  // 「活动」「福利」这类中文泛词单独出现时不算（如「发布会活动」）：要求同时具备其它优惠特征或明确的英文促销词
  if (hits.includes('event') && hits.length === 1 && !/\b(black friday|cyber monday|prime day|giveaway|limited[- ]time|promo)/i.test(t) && !/双十一|双11|黑五|618|羊毛|薅/.test(t)) return [];
  return hits;
}
function isOffer(types) { return (types || []).some((t) => !WEAK.has(t)) || (types || []).includes('event'); }


// —— v2.3 精度优化：在初步分类后做二次判定（基于 2026-10-14 实测 50 条抽样的误报分析）——
// 1) 优惠失效 / 收紧 / 负面事件
const LOSS = /\b(pausing|gone|disappear(s|ed|ing)?|losing|lose|loses|changing|brutal|backlash|denies|denied|leak(s|ed)?|breach|lawsuit|sued|outage|is full|cohort is full|ending soon|price hikes?|won't accept|doesn't accept|rejected|scam|phishing)\b|\bcuts?\b.{0,25}\b(credits?|free tier|limits?)\b|\bin half\b(?!.{0,10}price)|降本|无法|下架|缩水|砍掉|收紧|翻车|涨价后|被封|封号|骗局|价格不菲|昂贵|一码难求/i;
// 6) 非优惠内容：下载站 / 播客 / 教程 / 视频节目
const NOT_OFFER = /\bfree download\b|\bep(isode)?\.?\s?\d+\b|\bpodcast\b|\bwebinar\b|\btutorial\b|\bhow i built\b|\bpower ranking\b|- YouTube$|教程|直播回放/i;
// 2) 提问 / 吐槽 / 个人经历
const QUESTION = /[?？]\s*$|^(how|where|what|why|is|are|can|does|did|any|anyone|should|will)\b/i;
const PERSONAL = /^(i|i'm|i've|im|my|me|we|just)\b|\b(rant|vent|psa: (?!free))\b/i;
// 3) 模型横评 / 价格比较（不是厂商的优惠）
const COMPARE = /\bvs\.?\b|\bversus\b|\bcompared\b|对比|横评|PK/i;
// 4) 传闻、推测
const SPECULATE = /\b(may|might|could|rumou?red?|reportedly|reportedly|considering|mulls?|plans? to)\b|传闻|或将|拟推出|曝/i;
// v2.5 行业评论 / 价格战分析（不是可领取的优惠）
const COMMENTARY = /价格战|补贴大战|竞争格局|卷出新高度|赛道掀|上市公司叙事|市值跌|资本开支|从争夺算力|经营算力|行业竞赛|性价比竞赛|转向入口与性价比|变现模式|核心看点|标的指数|ARR估值|收入规模仍|哪里最便宜|三大渠道|price war|just escalated|intensifies|competition (heats|heats up|intensifies)|reading the .{0,20} release|squeezes? .{0,20} rivals|ignites? battle for|隐藏折扣渠道|立省一个亿|看完立省|科创板IPO|what.?s changed for free accounts|turn your .{0,20} free trial into/i;
const PODCAST = /\b(podcast|webinar|livestream|ama\b|interview with|talks? with)\b|播客|访谈|圆桌|直播回放/i;
const RUMOR = /\b(rumou?r|allegedly|unconfirmed|leak(ed|s)?\b.*\b(say|says|claim)|sources? (say|claim))\b|据传|有传闻|内部人士|爆料称/i;
const NON_AI_SHOP = /\b(oakley|ray-?ban|h&r block|tax software|vps free trials?|hosting|web hosting|nike|adidas|dyson|lego|uniqlo|iphone|airpods)\b|最佳.?VPS|VPS 免费/i;
// 5) 强信号：明确的数字力度 / 领取方式，社区帖子必须具备其一
const STRONG = /\b(offers?|offering|gives?|giving)\s+(a\s+)?free\b|\bfree\s+[\w.+-]{2,20}\s+(in|for|to)\b|\b\d{1,3}\s?%\s?(off|discount)|\bsave\s+\$?\d+%?|\$\s?\d[\d,]*(k)?\s+(in\s+)?(free\s+)?(api\s+)?credits?|\bfree\s+(trial|month|months|year)|\b(promo|coupon)\s?code|\b\d+\s*(months?|years?)\s+(of\s+)?free|\b\d+[-\s](month|year)\b.{0,40}\bfree\b|\bfree\s+for\s+(students|a year|\d+)|(\d+(\.\d+)?\s*折|半价|免费\s*\d+\s*(个?月|天|年)|赠?送\s*\d|\d+\s*(元|美元|美金|刀)|免费额度|限免|优惠码|兑换码)/i;
// 第三方 API 中转 / 账号转售 / 拼车（非官方渠道，存在风险）
const RESELLER = /中转|镜像站|代充|拼车|合租|共享账号|转售|公益站|api\s*代理|token\s*自由|号商|\breseller\b|\bproxy api\b/i;
const STRONG_TYPES = new Set(['free', 'credits', 'student', 'startup']);
/**
 * refineOffer(title, types, { sub, kind }) → types（可能为空 = 降级为资讯）
 * 只做「去噪」，不新增类型；官方价格页变动（pricing）永远保留
 */
function refineOffer(title, types, ctx = {}) {
  if (!types || !types.length) return [];
  if (types.includes('pricing')) return types;
  const t = String(title || '').trim();
  const strong = STRONG.test(t);
  if (LOSS.test(t)) return [];
  if (NOT_OFFER.test(t)) return [];
  // 只有「限时活动」且无数字力度：社区和新闻里噪声很大
  if (types.length === 1 && types[0] === 'event' && !strong && !/限时(免费|特惠|折扣|半价|低价)|limited[- ]time\s+(low\s+)?(api\s+)?(offer|free|discount|pricing|price)/i.test(t)) return [];
  if (ctx.sub === 'app' && !strong) return [];
  if (QUESTION.test(t) && !strong && !/\b(offers?|offering|free\s+\w+|\d+%\s*off|student)/i.test(t)) return [];
  const community = ['reddit', 'forum'].includes(ctx.sub) || ctx.kind === 'community';
  if (community && (PERSONAL.test(t) || !strong)) return [];
  if (COMPARE.test(t) && types.every((x) => x === 'discount' || x === 'plan')) return [];
  // 只有泛泛的 cheaper（如「企业寻求更便宜的 AI 部署」），没有价格 / 模型 / 套餐语境
  if (types.length === 1 && types[0] === 'discount' && /\bcheaper\b/i.test(t) && !/\b(price|prices|pricing|api|plan|plans|model|models|tier|subscription|token|tokens)\b|\$|%/i.test(t)) return [];
  // 「免费用户将被进一步限制」类：免费额度缩水是坏消息
  if (/\blimit(s|ed|ing)?\b.{0,40}\bfree\b/i.test(t) && !/\blimited[- ]time\b/i.test(t)) return [];
  // 聚合站里只因「via Perplexity / PayPal 返现」挂钩 AI 的非 AI 商品
  if (/\b(cb|cashback|cash back)\b.{0,40}\bvia\s+\w+/i.test(t)) return [];
  // v2.5：行业「价格战 / 竞争格局」评论——没有具体可领的优惠
  // 「怎么把试用变成…」教程 / 评测：不是新优惠
  if (/\b(week four panic|turn your .{0,30} (free )?trial into|here's how to turn your)\b|变现模式参考|哪里最便宜/i.test(t)) return [];
  if (COMMENTARY.test(t) && !STRONG.test(t) && !/\bfree\s+(year|month|claude|chatgpt|gemini|for\s+students)|\$\s?\d|限时(半价|免费)|免费(使用|开放|领|送|会员)|推免费|送\s*\d|\d(?:\.\d)?\s?折/i.test(t)) return [];
  // v2.5：播客 / 访谈 / 传闻（无明确领取力度时）
  // 技术合作 / 「让 X 更好」类软文，无领取力度
  if (/\bmaking\b.{0,40}\bbetter\b|\b(integrat(es|ion)|partners? with|collaboration)\b/i.test(t) && !STRONG.test(t)) return [];
  if (PODCAST.test(t)) return [];
  if (RUMOR.test(t) && !strong) return [];
  // v2.5：非 AI 实物/购物站优惠（标题里 AI 仅作返现途径）
  if (NON_AI_SHOP.test(t) && !/\b(chatgpt|claude|gemini|perplexity|copilot|cursor|openai|anthropic|midjourney)\b.{0,30}\b(free|trial|pro|plus|student|credits?|off|discount)/i.test(t)) return [];
  // v2.5：可选——直接过滤第三方中转（默认保留但降可信度；设置 hideResellers 时整条降级）
  if (ctx.hideResellers && RESELLER.test(t)) return [];
  if (SPECULATE.test(t) && !strong && !/[\u4e00-\u9fff]/.test(t.slice(0, 6))) return [];
  // v2.5 AI 分类器缓存：aiClass === "noise" 时降级（pricing 已在上方保留）
  if (ctx.aiClass === "noise") return [];
  return types;
}
// v2.3「不是优惠」反馈：用户屏蔽词（标题包含即降级为资讯）；被标记 ≥3 次的来源只保留带明确力度的条目
function applyFeedback(title, types, sourceId, fb) {
  if (!fb || !types || !types.length || types.includes('pricing')) return types || [];
  const t = String(title || '').toLowerCase();
  if ((fb.words || []).some((w) => w && t.includes(String(w).toLowerCase()))) return [];
  if (sourceId && (fb.sources || {})[sourceId] >= 3 && !STRONG.test(title)) return [];
  return types;
}
function hasStrongSignal(t) { return STRONG.test(String(t || '')); }
// 置信度 0–100：用于「今日要点」排序与卡片上的可信度显示
function offerConfidence(d) {
  const types = d.offerTypes || [];
  if (!types.length) return 0;
  let c = 40;
  if (types.includes('pricing')) c += 30;
  if (STRONG.test(d.title || '')) c += 25;
  if (types.some((x) => STRONG_TYPES.has(x))) c += 10;
  if (d.platform === '厂商渠道' || d.platform === '厂商官方') c += 15;
  if (['blog', 'pricing', 'changelog'].includes(d.sub)) c += 10;
  if (['reddit', 'forum'].includes(d.sub)) c -= 15;
  if (RESELLER.test(d.title || '')) c -= 30; // 第三方中转 / 转售：非官方，降低可信度（不直接过滤）
  if (d.aiClass === 'offer') c += 15;
  // v2.9：多源佐证（KBT 思路）——同一优惠被多个独立站点报道时提高置信度（同站点多次不算）
  if ((d.sources || []).length > 1) { const k = require('./v29').corroborate(Math.max(0.05, Math.min(1, c / 100)), [{ link: d.link, outlet: d.outlet || (/news\.google\./.test(d.link || '') ? require('./v29').outletOf(d.title) : '') }, ...d.sources]); if (k.hosts > 1) c = Math.round(k.conf * 100); }
  if (d.aiClass === 'noise') c = Math.min(c, 25);
  return Math.max(5, Math.min(100, c));
}

module.exports = { RESELLER, COMMENTARY, PODCAST, RUMOR, NON_AI_SHOP, applyFeedback, hasStrongSignal, refineOffer, offerConfidence, classifyOffer, isOffer, OFFER_LABELS: LABELS, OFFER_TYPES: TYPES.map((t) => ({ id: t.id, label: t.label })) };
