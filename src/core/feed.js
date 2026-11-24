'use strict';
const { XMLParser, XMLValidator } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: false,
  processEntities: false, // 自行解码，避免大 feed 触发实体数量上限
  htmlEntities: false,
  trimValues: true,
  parseTagValue: false,
  isArray: (name) => ['item', 'entry', 'link', 'category', 'media:content', 'media:thumbnail', 'enclosure'].includes(name),
});

function txt(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return decodeEntities(String(v));
  if (Array.isArray(v)) return txt(v[0]);
  if (typeof v === 'object') return txt(v['#text'] ?? '');
  return '';
}
function attr(v) { return v == null ? '' : decodeEntities(String(v)); }

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

function stripTags(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}
// 去标签 → 解码实体 → 再去一次标签（部分 feed 对 HTML 做了二次转义，如 &lt;a href=…&gt;）
function stripHtml(html) {
  if (!html) return '';
  return stripTags(decodeEntities(stripTags(html)))
    .replace(/<[^>]*$/, '') // 被截断的半个标签
    .replace(/\s+/g, ' ')
    .trim();
}

function firstImg(html) {
  if (!html) return '';
  const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? decodeEntities(m[1]) : '';
}

function pickLink(item) {
  const l = item.link;
  if (Array.isArray(l)) {
    const alt = l.find((x) => typeof x === 'object' && (x['@_rel'] === 'alternate' || !x['@_rel']) && x['@_href']);
    if (alt) return attr(alt['@_href']);
    const any = l.find((x) => typeof x === 'object' && x['@_href']);
    if (any) return attr(any['@_href']);
    return txt(l[0]);
  }
  if (l && typeof l === 'object') return attr(l['@_href']) || txt(l);
  return txt(l) || txt(item.guid);
}

function pickImage(item, descHtml) {
  const mc = item['media:content'] || [];
  for (const m of mc) if (m && m['@_url'] && (!m['@_medium'] || m['@_medium'] === 'image')) return attr(m['@_url']);
  const mt = item['media:thumbnail'] || [];
  for (const m of mt) if (m && m['@_url']) return attr(m['@_url']);
  const enc = item.enclosure || [];
  for (const e of enc) if (e && e['@_url'] && /image/i.test(e['@_type'] || 'image')) return attr(e['@_url']);
  return firstImg(descHtml);
}

// 解析 RSS 2.0 / Atom / RDF(RSS 1.0)，返回统一结构
function parseFeed(xml, { baseURL = '' } = {}) {
  if (typeof xml !== 'string') throw new Error('响应不是文本');
  const head = xml.slice(0, 600).toLowerCase();
  if (!/<(rss|feed|rdf:rdf)[\s>]/.test(xml.slice(0, 3000).toLowerCase())) {
    if (head.includes('<script') || /captcha|challenge|just a moment/i.test(head)) throw new Error('被网站反爬验证拦截（返回了验证页面）');
    if (head.includes('<html')) throw new Error('返回的是网页而不是 RSS / HTML is not a feed');
    throw new Error('无法识别的订阅格式');
  }
  const doc = parser.parse(xml);
  let raw = [];
  let feedTitle = '';
  if (doc.rss) {
    const ch = doc.rss.channel || {};
    feedTitle = txt(ch.title);
    raw = ch.item || [];
  } else if (doc.feed) {
    feedTitle = txt(doc.feed.title);
    raw = doc.feed.entry || [];
  } else if (doc['rdf:RDF']) {
    const r = doc['rdf:RDF'];
    feedTitle = txt(r.channel && r.channel.title);
    raw = r.item || [];
  }
  if (!Array.isArray(raw)) raw = [raw];
  const base = attr((doc.feed || {})['@_xml:base']) || baseURL;
  const resolve = (u, itemBase = base) => { if (!u) return ''; try { const v=new URL(u,/^https?:\/\//i.test(u)?undefined:(itemBase || undefined)); return /^https?:$/.test(v.protocol)?v.href:''; } catch { return baseURL ? '' : u; } };
  const items = raw.map((it) => {
    const descHtml = txt(it['content:encoded']) || txt(it.description) || txt(it.content) || txt(it.summary);
    const title = stripHtml(txt(it.title));
    const itemBase = attr(it['@_xml:base']) ? resolve(attr(it['@_xml:base'])) : base;
    const link = resolve((pickLink(it) || '').trim(), itemBase);
    const date = txt(it.pubDate) || txt(it.published) || txt(it.updated) || txt(it['dc:date']);
    const ts = Date.parse(date);
    const cats = (it.category || []).map((c) => (typeof c === 'object' ? attr(c['@_term']) || txt(c) : txt(c))).filter(Boolean);
    return {
      guid: txt(it.guid) || txt(it.id) || link,
      title,
      link,
      summary: stripHtml(descHtml).slice(0, 400),
      image: resolve(pickImage(it, descHtml), itemBase),
      published: Number.isFinite(ts) ? ts : null,
      categories: cats.slice(0, 6),
      source: txt(it.source) || '', // Google News 原始来源
    };
  }).filter((x) => x.title && x.link);
  if (raw.length && !items.length) throw new Error('Feed entries have no usable title/link');
  return { title: feedTitle, items, rawCount: raw.length, validEmpty: raw.length === 0 && !!feedTitle && XMLValidator.validate(xml) === true };
}

function parseCheapShark(json) {
  const arr = typeof json === 'string' ? JSON.parse(json) : json;
  if (!Array.isArray(arr)) throw new Error('CheapShark 返回格式异常');
  return {
    rawCount: arr.length, validEmpty: arr.length === 0,
    title: 'CheapShark',
    items: arr.map((d) => ({
      guid: 'cs:' + d.dealID,
      title: `${d.title} — $${d.salePrice}（原价 $${d.normalPrice}，${Math.round(Number(d.savings))}% OFF）`,
      link: 'https://www.cheapshark.com/redirect?dealID=' + d.dealID,
      summary: `Steam 评价: ${d.steamRatingText || '无'}；Metacritic: ${d.metacriticScore || '-'}`,
      image: d.thumb || '',
      published: d.lastChange ? d.lastChange * 1000 : null,
      categories: ['Games'],
      source: '',
      price: '$' + d.salePrice,
      discount: Math.round(Number(d.savings)) + '% OFF',
    })),
  };
}

// Hacker News（Algolia 搜索 API）
function parseHN(json) {
  const o = typeof json === 'string' ? JSON.parse(json) : json;
  if (!o || !Array.isArray(o.hits)) throw new Error('Hacker News 返回格式异常');
  return {
    rawCount: o.hits.length, validEmpty: o.hits.length === 0,
    title: 'Hacker News',
    items: o.hits.filter((h) => h.title).map((h) => ({
      guid: 'hn:' + h.objectID,
      title: decodeEntities(String(h.title)),
      link: h.url || 'https://news.ycombinator.com/item?id=' + h.objectID,
      summary: stripHtml(h.story_text || '').slice(0, 400) + (h.points != null ? ` （HN ${h.points} 分，${h.num_comments || 0} 条评论）` : ''),
      image: '',
      published: h.created_at_i ? h.created_at_i * 1000 : null,
      categories: [],
      source: '',
    })),
  };
}

module.exports = { parseHN, parseFeed, parseCheapShark, stripHtml, decodeEntities };

// Only same-origin advertised public feeds. Never guess a route after a challenge/block.
async function parseOrDiscoverFeed(body, baseURL, fetchText, req={}) {
 if(require('./page').isBlocked(body))throw new Error('SOURCE_BLOCKED: challenge page');
 if (/<html[\s>]/i.test(body.slice(0,3000)) && !/<(rss|feed)[\s>]/i.test(body.slice(0,3000))) {
   const root=require('node-html-parser').parse(body);
   const candidates=root.querySelectorAll('link[rel][href]').filter(n=>/alternate/i.test(n.getAttribute('rel')) && /application\/(rss\+xml|atom\+xml|feed\+json)/i.test(n.getAttribute('type')||''));
   for(const n of candidates.slice(0,2)){let u;try{u=new URL(n.getAttribute('href'),baseURL);if(u.origin!==new URL(baseURL).origin)continue;}catch{continue;}
     const text=await fetchText(u.href,req);const feed=/application\/feed\+json/i.test(n.getAttribute('type'))?{items:require('./collectors').parseJsonFeed(text)}:parseFeed(text,{baseURL:u.href});return {...feed,discoveredURL:u.href};
   }
 }
 return parseFeed(body,{baseURL});
}
module.exports.parseOrDiscoverFeed=parseOrDiscoverFeed;
