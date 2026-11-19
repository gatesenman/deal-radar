'use strict';

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

const DEAL_WORDS = [
  // 英文
  'sale', 'deal', 'deals', 'discount', 'discounted', '% off', 'coupon', 'promo', 'promo code', 'clearance',
  'price drop', 'price cut', 'lowest price', 'all-time low', 'savings', 'black friday', 'cyber monday',
  'prime day', 'bogo', 'free shipping', 'markdown', 'cheapest', 'bargain', 'rebate', 'trade-in', 'offer', 'offers',
  // 德/法/西/荷/波（Pepper 系）
  'angebot', 'rabatt', 'gutschein', 'promo', 'réduction', 'soldes', 'oferta', 'descuento', 'korting', 'aanbieding', 'promocja',
  // 中文
  '优惠', '折扣', '促销', '降价', '直降', '立减', '满减', '秒杀', '特价', '限时', '补贴', '国补', '优惠券', '领券', '神券', '消费券', '红包', '包邮',
  '史低', '新低', '好价', '打折', '让利', '返现', '以旧换新', '大促', '双11', '双十一', '618', '活动价', '到手价', '低至',
];

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// 构建匹配某个关键词的函数：英文/数字按词边界匹配，中文按子串匹配
function buildTermRegex(term, cs = false) {
  const t = String(term || '').trim();
  if (!t) return null;
  const fl = cs ? '' : 'i';
  if (CJK.test(t)) return new RegExp(escapeRe(t.replace(/\*$/, '')), 'i');
  // 末尾带 * 表示后面可以紧跟型号数字（如 "Galaxy S*" 匹配 "Galaxy S26"，但不匹配 "Galaxy Squadron"）
  if (t.endsWith('*') && t.length > 1) return new RegExp('(^|[^A-Za-z0-9])' + escapeRe(t.slice(0, -1)) + '(?=\\d|$|[^A-Za-z0-9])', fl);
  // 词边界：前后不是字母数字
  return new RegExp('(^|[^A-Za-z0-9])' + escapeRe(t) + '(?=$|[^A-Za-z0-9])', fl);
}

const DEAL_RES = DEAL_WORDS.map(buildTermRegex);
// 新闻/搜索结果（strict）里过于宽泛、容易误报的词：如 "Apple offers…"、"政府补贴"、"限时开放"
const LOOSE_WORDS = new Set(['offer', 'offers', 'savings', '补贴', '限时', 'promo', '红包']);
const STRICT_RES = DEAL_WORDS.filter((w) => !LOOSE_WORDS.has(w)).map(buildTermRegex);
// 否定表达：「近期也无降价的可能」「不会降价」不算优惠
const NEGATION_RE = /(无|不会|不|没有|拒绝|难|未|从未|从不|并未)(再)?(降价|打折|优惠)|降价无望|no (discount|sale|deal)s?\b/gi;

const PERCENT_RE = /(\d{1,2})\s?%\s?(off|rabatt|de descuento|korting|taniej)|(?:^|[\s(（])-\s?\d{1,2}\s?%|(?:^|[^\d.])\d(\.\d)?\s?折(?!叠)/i;
const OFF_RE = /\d\s?(?:%|dollars?|bucks|元)?\s?off\b/i;
// strict=true 时（新闻/搜索结果）仅凭价格或普通百分比不算优惠，必须有明确的优惠词或折扣表达
function isDealText(text, strict = false) {
  if (!text) return false;
  const t = String(text).replace(NEGATION_RE, ' ');
  if (PERCENT_RE.test(t) || OFF_RE.test(t)) return true;
  if (!strict && (/[$£€¥￥]\s?\d/.test(t) || /\d\s?%/.test(t))) return true;
  return (strict ? STRICT_RES : DEAL_RES).some((re) => re && re.test(t));
}

// 配件语境：「Magnethalterung für iPhone」「Manette pour PC/Switch」「适用于苹果」——第三方配件，不算该品牌的优惠
const PREP = '(?:for|für|fur|pour|para|voor|dla|per|compatible with|compatible|kompatibel mit|kompatibel|fits|works with)';
const PHRASE = "[^,;|():：，。!！?？\\[\\]【】-]{0,30}$";
const ACCESSORY_RE = new RegExp('(?:^|[^A-Za-z])' + PREP + '\\s+' + PHRASE + '|(?:适用于?|兼容|适配|用于)' + PHRASE, 'i');
const NOT_ACCESSORY_RE = new RegExp('(?:off|deal|deals|sale|price|only|just|discount|savings?|rabatt|angebot|promo)\\s+' + PREP + '\\s+' + PHRASE, 'i');
function isAccessoryContext(text, index) {
  const before = text.slice(Math.max(0, index - 40), index);
  return ACCESSORY_RE.test(before) && !NOT_ACCESSORY_RE.test(before);
}

function compileBrand(brand) {
  // noName：名称只是显示用（如「OpenAI / ChatGPT」），只用关键词匹配；cs：区分大小写（Cursor、Notion、Grok…）
  const aliases = [...(brand.noName && (brand.aliases || []).length ? [] : [brand.name]), ...(brand.aliases || [])].map((s) => String(s).trim()).filter(Boolean);
  const uniq = [...new Set(aliases.map((a) => a.toLowerCase()))].map((l) => aliases.find((a) => a.toLowerCase() === l));
  return {
    id: brand.id,
    name: brand.name,
    res: uniq.map((t) => buildTermRegex(t, !!brand.cs)).filter(Boolean),
    excl: (brand.exclude || []).map(buildTermRegex).filter(Boolean),
  };
}

// 某个关键词在文本中的命中位置（全部）
function matchIndexes(re, text) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const out = []; let m;
  while ((m = g.exec(text)) && out.length < 10) {
    // 词边界正则会把前导的非字母字符一并匹配，修正为关键词本身的起点
    const lead = m[1] && m[1].length ? m[1].length : 0;
    out.push(m.index + lead);
    if (g.lastIndex === m.index) g.lastIndex++;
  }
  return out;
}

// 返回命中的品牌 id 列表。opts.accessory=false 可关闭「配件语境」过滤
function matchBrands(text, compiledBrands, opts = {}) {
  const hits = [];
  if (!text) return hits;
  for (const b of compiledBrands) {
    if (b.excl.some((re) => re.test(text))) continue;
    const idx = [];
    for (const re of b.res) if (re.test(text)) idx.push(...matchIndexes(re, text));
    if (!idx.length) continue;
    // 所有命中都处在「for iPhone / für iPhone / 适用于苹果」这类配件语境中时，视为第三方配件而非品牌优惠
    if (opts.accessory !== false && idx.every((i) => isAccessoryContext(text, i))) continue;
    hits.push(b.id);
  }
  return hits;
}

// 价格提取：返回第一个价格字符串
const PRICE_RE = /(?:[$£€¥￥]\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d.,]*\s?(?:€|zł|kr|元|円)|(?:A\$|C\$|AU\$|CA\$|US\$)\s?\d[\d,]*(?:\.\d{1,2})?)/i;
// 多个金额时跳过「£30 Credit」「Save $50」「$20 off」「返现 50 元」这类非售价金额
const NOT_PRICE_AFTER = /^\s*(?:off|credit|cashback|cash back|gift ?card|voucher|coupon|rabatt|bonus|reward|back|de descuento|de réduction|korting|taniej|返现|券|立减|优惠|补贴|红包)/i;
const NOT_PRICE_BEFORE = /(?:save|saving|extra|up to|over|get|earn|bonus|省|减|返现?|送)\s*$/i;
function extractPrice(text) {
  if (!text) return '';
  const g = new RegExp(PRICE_RE.source, 'gi');
  let m;
  while ((m = g.exec(text))) {
    const p = m[0].replace(/\s+/g, '');
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 14);
    const before = text.slice(Math.max(0, m.index - 10), m.index);
    if (!NOT_PRICE_AFTER.test(after) && !NOT_PRICE_BEFORE.test(before)) return p;
  }
  return ''; // 只有「省 $20」「$20 off」这类金额时不当作售价
}

function extractDiscount(text) {
  if (!text) return '';
  let m = text.match(/(\d{1,2})\s?%\s?(?:off|rabatt|korting|de descuento|taniej)/i) || text.match(/(?:^|[\s(（])-\s?(\d{1,2})\s?%/);
  if (m) return m[1] + '% OFF';
  m = text.match(/(?:^|[^\d.])(\d(?:\.\d)?)\s?折(?!叠)/);
  if (m) return m[1] + '折';
  m = text.match(/(?:save|saving)\s+(\d{1,2})%/i);
  if (m) return m[1] + '% OFF';
  return '';
}

// 搜索词：英文用品牌名；中文优先用中文别名
function searchTerm(brand, region) {
  if (region === 'cn') {
    const zh = (brand.aliases || []).find((a) => CJK.test(a));
    return zh ? `(${zh} OR ${quote(brand.name)})` : quote(brand.name);
  }
  return quote(brand.name);
}
function quote(s) { return /\s/.test(s) ? `"${s}"` : s; }

module.exports = { buildTermRegex, isDealText, isAccessoryContext, compileBrand, matchBrands, extractPrice, extractDiscount, searchTerm, DEAL_WORDS };
