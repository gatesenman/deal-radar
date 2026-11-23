'use strict';
// v2.10：从网址识别采集协议（纯函数，不访问网络）；从 HTML 抽取官方 RSS/Atom 订阅链接。

const FEED_EXT = /\.(?:rss|atom|xml)$/i;
const FEED_PATH = /(?:^|\/)(?:feed|rss|atom|index\.xml|rss\.xml|feed\.xml|atom\.xml)(?:\.gz)?\/?$/i;
const SITEMAP_PATH = /sitemap(?:[_-]index)?\.xml$/i;
const PRICE_PATH = /\/(?:pricing|plans?|plan-pricing|price|billing|buy)(?:\/|$)/i;
const CHANGE_PATH = /\/(?:changelog|change-?log|release-?notes?|releases?|whats-?new|updates?)(?:\/|$)/i;
const BLOG_PATH = /\/(?:blog|news|newsroom|articles?|journal)(?:\/|$)/i;
const STUDENT_PATH = /\/(?:students?|education|educators?|academic|startups?)(?:\/|$)/i;
const STATUS_HOST = /^(?:status|health)\./i;

function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || /\s/.test(s) && !/^https?:\/\//i.test(s)) return null;
  const withProto = /^(https?:\/\/)/i.test(s) ? s : (/^(?:www\.)?[\w.-]+\.[a-z]{2,}([/:?#]|$)/i.test(s) ? 'https://' + s : null);
  if (!withProto) return null;
  try {
    const u = new URL(withProto);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    return u;
  } catch { return null; }
}

function result(partial) {
  const out = {
    type: partial.type,
    url: partial.url || '',
    opts: partial.opts || {},
    sub: partial.sub || 'blog',
    name: partial.name || '',
    confidence: partial.confidence == null ? 0.8 : partial.confidence,
    reason: partial.reason || '',
  };
  if (partial.keyword) out.keyword = partial.keyword;
  if (partial.render) out.render = true;
  return out;
}

function detectFromUrl(raw) {
  const u = normalizeUrl(raw);
  if (!u) return null;
  const href = u.toString();
  const host = u.hostname.replace(/^www\./i, '').toLowerCase();
  const path = u.pathname || '/';
  const fullPath = path + (u.search || '');
  let m;

  // —— 平台网址：映射到专用协议 ——
  if ((m = href.match(/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(releases|tags|commits))?\/releases\.atom(?:[/?#]|$)/i))
    || (m = href.match(/github\.com\/([\w.-]+)\/([\w.-]+?)\/(?:releases|tags|commits)?\.atom(?:[/?#]|$)/i))) {
    return result({ type: 'rss', url: href, sub: 'github', name: `GitHub ${m[1]}/${m[2]} Atom`, confidence: 0.95, reason: 'GitHub Atom 订阅' });
  }
  if ((m = href.match(/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(releases|tags|commits))?(?:[/?#]|$)/i)) && !/\.atom$/i.test(path)) {
    const what = m[3] || 'releases';
    return result({ type: 'github', url: '', opts: { repo: `${m[1]}/${m[2]}`, what }, sub: 'github', name: `GitHub ${m[1]}/${m[2]}`, confidence: 0.95, reason: 'GitHub 仓库' });
  }
  if ((m = href.match(/youtube\.com\/feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/i))) {
    return result({ type: 'youtube', opts: { channelId: m[1] }, sub: 'youtube', name: 'YouTube 频道', confidence: 0.95, reason: 'YouTube 视频 RSS' });
  }
  if ((m = href.match(/youtube\.com\/channel\/(UC[\w-]{22})/i))) {
    return result({ type: 'youtube', opts: { channelId: m[1] }, sub: 'youtube', name: 'YouTube 频道', confidence: 0.9, reason: 'YouTube 频道地址' });
  }
  if ((m = href.match(/youtube\.com\/@([\w.-]+)/i))) {
    return result({ type: 'page', url: href, sub: 'youtube', name: 'YouTube @' + m[1], confidence: 0.55, reason: 'YouTube 账号页（填写频道 ID 后可改用 YouTube 协议）' });
  }
  if ((m = href.match(/reddit\.com\/r\/(\w+)/i))) {
    return result({ type: 'reddit', opts: { sub: m[1] }, sub: 'reddit', name: 'r/' + m[1], confidence: 0.95, reason: 'Reddit 版块' });
  }
  if ((m = href.match(/bsky\.app\/profile\/([\w.:-]+)/i))) {
    return result({ type: 'bluesky', opts: { handle: m[1] }, sub: 'social', name: 'Bluesky ' + m[1], confidence: 0.95, reason: 'Bluesky 账号' });
  }
  if ((m = href.match(/^https?:\/\/t\.me\/(?:s\/)?([A-Za-z]\w{3,})\/?$/i))) {
    return result({ type: 'telegram', opts: { channel: m[1] }, sub: 'social', name: 'Telegram ' + m[1], confidence: 0.9, reason: 'Telegram 公开频道' });
  }
  if ((m = href.match(/apps\.apple\.com\/.*\/id(\d{6,})/i))) {
    const country = (href.match(/apps\.apple\.com\/(\w\w)\//) || [])[1] || 'us';
    return result({ type: 'appstore', opts: { appId: m[1], country }, sub: 'app', name: 'iOS App 更新', confidence: 0.95, reason: 'App Store 应用页' });
  }
  if ((m = href.match(/play\.google\.com\/store\/apps\/details\?(?:.*&)?id=([\w.]+)/i))) {
    return result({ type: 'gplay', opts: { pkg: m[1] }, sub: 'app', name: 'Android App 更新', confidence: 0.95, reason: 'Google Play 应用页' });
  }
  if ((m = href.match(/news\.ycombinator\.com\/.*[?&]q=([^&]+)/i))) {
    const q = decodeURIComponent(m[1].replace(/\+/g, ' '));
    return result({ type: 'hn', opts: { query: q }, sub: 'forum', name: 'HN ' + q, confidence: 0.9, reason: 'Hacker News 搜索' });
  }
  if (/producthunt\.com\/(?:feed|feed\.rss)/i.test(href)) {
    return result({ type: 'producthunt', url: href, sub: 'other', name: 'Product Hunt', confidence: 0.9, reason: 'Product Hunt RSS' });
  }
  if (host === 'news.google.com' || host === 'www.bing.com' || /\/search\?/i.test(fullPath) && /(?:q|query)=/.test(u.search)) {
    const q = u.searchParams.get('q') || u.searchParams.get('query');
    if (q) return result({ type: 'search', keyword: q, opts: { engine: host.includes('bing') ? 'bing' : 'google' }, sub: 'news', name: q, confidence: 0.7, reason: '新闻搜索' });
  }

  // Discourse 论坛
  if (/^(?:community|forum|forums|discuss|discourse)\./i.test(host) || /\/(?:latest|c\/[\w-]+)(?:\.json)?\/?$/i.test(path)) {
    const base = u.origin;
    if (/discourse/i.test(host) || /^(?:community|forum|forums|discuss)\./i.test(host)) {
      return result({ type: 'discourse', url: base, sub: 'forum', name: host + ' 论坛', confidence: 0.85, reason: 'Discourse 论坛' });
    }
  }

  // 站点地图
  if (SITEMAP_PATH.test(path)) {
    return result({ type: 'sitemap', url: href, sub: 'blog', name: 'Sitemap', confidence: 0.95, reason: '网站 sitemap' });
  }

  // RSS / Atom / XML 订阅（含 github releases.atom 已在上面处理）
  if (FEED_EXT.test(path) || FEED_PATH.test(path) || /(?:[?&](?:format|type)=(?:rss|atom)\b)/i.test(u.search) || /\/feeds?\//i.test(path) && FEED_EXT.test(path)) {
    const sub = CHANGE_PATH.test(path) ? 'changelog' : (PRICE_PATH.test(path) ? 'pricing' : (BLOG_PATH.test(path) ? 'blog' : 'blog'));
    return result({ type: 'rss', url: href, sub, name: sub === 'changelog' ? '更新日志 RSS' : 'RSS 订阅', confidence: 0.92, reason: 'RSS / Atom 地址' });
  }
  if (/\/(?:feed|rss|atom)\/?$/i.test(path) || /\/(?:blog|news|changelog)\/(?:feed|rss)\/?$/i.test(path)) {
    const sub = CHANGE_PATH.test(path) ? 'changelog' : (BLOG_PATH.test(path) ? 'blog' : 'blog');
    return result({ type: 'rss', url: href, sub, name: 'RSS 订阅', confidence: 0.88, reason: '常见 RSS 路径' });
  }

  // 状态页
  if (STATUS_HOST.test(host) || /status\.(?:io|page)/i.test(host)) {
    return result({ type: 'page', url: href, sub: 'status', name: '服务状态', confidence: 0.7, reason: '状态页' });
  }

  // 价格 / 更新日志 / 博客 / 学生页 → 网页变化监控
  if (PRICE_PATH.test(path) || STUDENT_PATH.test(path)) {
    const student = STUDENT_PATH.test(path);
    return result({
      type: 'page', url: href, sub: 'pricing',
      name: student ? '学生/教育优惠页' : '价格页',
      keyword: '$,free,month,trial,student,% off,credit,discount,免费',
      confidence: 0.85,
      reason: student ? '教育/学生/创业计划页' : '官方价格页',
    });
  }
  if (CHANGE_PATH.test(path)) {
    return result({ type: 'page', url: href, sub: 'changelog', name: '更新日志', confidence: 0.8, reason: '更新日志 / 发布说明页' });
  }
  if (BLOG_PATH.test(path) && path.split('/').filter(Boolean).length <= 2) {
    return result({ type: 'page', url: href, sub: 'blog', name: '官方博客', confidence: 0.6, reason: '博客或新闻列表页（点「识别」可尝试发现 RSS）' });
  }

  // 其它 https 网址：当作网页监控，置信度较低
  if (path === '/' || path === '') {
    return result({ type: 'page', url: href, sub: 'blog', name: host, confidence: 0.35, reason: '网站首页（点「识别」可发现官方订阅源）' });
  }
  return result({ type: 'page', url: href, sub: 'other', name: path.split('/').filter(Boolean).slice(-1)[0] || host, confidence: 0.4, reason: '普通网页，将按页面变化监控' });
}

function absUrl(href, base) {
  try { return new URL(href, base).toString(); } catch { return ''; }
}

function attr(tag, name) {
  const m = tag.match(new RegExp(name + '\\s*=\\s*["\']([^"\']+)["\']', 'i')) || tag.match(new RegExp(name + '\\s*=\\s*([^\\s>]+)', 'i'));
  return m ? m[1].trim() : '';
}

function feedsFromHtml(html, baseUrl) {
  const text = String(html || '');
  const out = [];
  const seen = new Set();
  const add = (url, type, title, via) => {
    const u = absUrl(url, baseUrl);
    if (!u || !/^https?:/i.test(u)) return;
    const key = u.replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ url: u, type: type || 'rss', title: (title || '').trim().slice(0, 80), via: via || 'link' });
  };

  const linkRe = /<link\b[^>]*>/gi;
  let m;
  while ((m = linkRe.exec(text))) {
    const tag = m[0];
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    const typ = (attr(tag, 'type') || '').toLowerCase();
    const href = attr(tag, 'href');
    const title = attr(tag, 'title');
    const isAlt = /\balternate\b/.test(rel) || typ === 'application/rss+xml' || typ === 'application/atom+xml' || typ === 'application/feed+json' || typ === 'application/json' && /feed/i.test(rel + title);
    if (!href || !isAlt) continue;
    if (typ === 'application/feed+json' || typ === 'application/json') add(href, 'jsonfeed', title, 'link-json');
    else if (typ.includes('atom')) add(href, 'rss', title, 'link-atom');
    else if (typ.includes('rss') || typ.includes('xml') || !typ) add(href, 'rss', title, 'link-rss');
  }

  const aRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = aRe.exec(text))) {
    const href = m[1];
    const label = m[2].replace(/<[^>]+>/g, '').trim();
    if (/\/(?:feed|rss|atom)(?:\.xml)?\/?$/i.test(href) || /\.(?:rss|atom)$/i.test(href) || /rss|atom|feed/i.test(label) && /\/(?:feed|rss|atom)/i.test(href)) {
      add(href, 'rss', label, 'anchor');
    }
    if (SITEMAP_PATH.test(href)) add(href, 'sitemap', label, 'anchor');
  }
  return out.slice(0, 12);
}

function pickOfficialFeed(feeds, pageUrl) {
  if (!feeds || !feeds.length) return null;
  let pageHost = '';
  try { pageHost = new URL(pageUrl).hostname.replace(/^www\./, '').toLowerCase(); } catch { /* ignore */ }
  const scored = feeds.map((f) => {
    let s = 1;
    try {
      const h = new URL(f.url).hostname.replace(/^www\./, '').toLowerCase();
      if (pageHost && (h === pageHost || h.endsWith('.' + pageHost) || pageHost.endsWith('.' + h))) s += 3;
      else s -= 2; // 第三方订阅聚合降权
    } catch { s -= 1; }
    if (f.via && f.via.startsWith('link')) s += 2;
    if (/comment|comments|replies/i.test(f.title + f.url)) s -= 3;
    return { f, s };
  }).sort((a, b) => b.s - a.s);
  return scored[0] && scored[0].s > 0 ? scored[0].f : null;
}

module.exports = { detectFromUrl, feedsFromHtml, pickOfficialFeed, normalizeUrl };
