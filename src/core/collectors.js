'use strict';
// v2.0 可插拔采集协议（adapter）。每个协议把一个渠道配置转换为统一条目 { guid,title,link,summary,image,published }
// 列表型协议由 collect() 处理；网页变化 / JS 渲染 / sitemap 属于「状态型」协议，由 monitor.js 用快照对比处理
const { parse: parseHtml } = require('node-html-parser');
const { parseFeed, stripHtml, decodeEntities } = require('./feed');

const PROTOCOLS = {
  rss: { label: 'RSS / Atom / RDF', group: '订阅', fields: ['url'] },
  jsonfeed: { label: 'JSON Feed', group: '订阅', fields: ['url'] },
  json: { label: '通用 JSON API（JSONPath 字段映射）', group: '通用', fields: ['url', 'itemsPath', 'titleField', 'linkField', 'dateField', 'summaryField', 'linkPrefix'] },
  html: { label: 'HTML 列表抓取（CSS 选择器）', group: '通用', fields: ['url', 'list', 'title', 'link', 'date', 'summary', 'render'] },
  page: { label: '网页变化监控（价格页）', group: '通用', fields: ['url', 'selector', 'keyword', 'render'] },
  render: { label: 'JS 渲染页面变化监控（隐藏浏览器）', group: '通用', fields: ['url', 'selector', 'keyword', 'wait'] },
  sitemap: { label: 'Sitemap 新页面检测', group: '通用', fields: ['url', 'filter'] },
  github: { label: 'GitHub 发布 / 标签 / 提交', group: '平台', fields: ['repo', 'what', 'branch', 'api'] },
  hn: { label: 'Hacker News（Algolia）', group: '平台', fields: ['query', 'minPoints'] },
  reddit: { label: 'Reddit 版块', group: '平台', fields: ['sub', 'query'] },
  discourse: { label: 'Discourse 论坛（JSON）', group: '平台', fields: ['url', 'category'] },
  telegram: { label: 'Telegram 公开频道（t.me/s）', group: '社交', fields: ['channel'] },
  mastodon: { label: 'Mastodon（账号或话题）', group: '社交', fields: ['instance', 'acct', 'tag'] },
  bluesky: { label: 'Bluesky 账号动态', group: '社交', fields: ['handle'] },
  youtube: { label: 'YouTube 频道', group: '社交', fields: ['channelId'] },
  producthunt: { label: 'Product Hunt', group: '平台', fields: ['url'] },
  appstore: { label: 'App Store 应用更新', group: '应用商店', fields: ['appId', 'country'] },
  gplay: { label: 'Google Play 应用更新', group: '应用商店', fields: ['pkg'] },
  rsshub: { label: 'RSSHub 路由（自建实例：X/微博/公众号/B站）', group: '订阅', fields: ['route'] },
  search: { label: '搜索关键词（Google / Bing 新闻）', group: '搜索', fields: ['keyword', 'engine'] },
};
const STATEFUL = new Set(['page', 'render', 'sitemap']);

// —— 小工具 ——
function getPath(obj, p) {
  if (!p) return obj;
  const parts = String(p).replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1').replace(/\[\*\]/g, '').split('.').filter(Boolean);
  let cur = obj;
  for (const k of parts) { if (cur == null) return undefined; cur = cur[k]; }
  return cur;
}
function field(obj, spec) {
  if (!spec) return '';
  if (spec.includes('{')) return spec.replace(/\{([^}]+)\}/g, (_, p) => { const v = getPath(obj, p.trim()); return v == null ? '' : String(v); });
  const v = getPath(obj, spec); return v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
}
function toTs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || /^\d{9,13}$/.test(String(v))) { const n = Number(v); return n < 1e12 ? n * 1000 : n; }
  const t = Date.parse(v); return Number.isFinite(t) ? t : null;
}
function absUrl(u, base) { if (!u) return ''; try { const p = new URL(u, /^https?:\/\//i.test(u)?undefined:base); return /^https?:$/.test(p.protocol) ? p.toString() : ''; } catch { return ''; } }
function firstLine(s, n = 140) { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; }
function parseJSON(body) { try { return typeof body === 'string' ? JSON.parse(body) : body; } catch { throw new Error('Invalid JSON / 返回的不是有效 JSON'); } }
function parseHeaders(h) {
  if (!h) return {};
  if (typeof h === 'object') return h;
  const out = {};
  const s = String(h).trim();
  if (s.startsWith('{')) { try { return JSON.parse(s); } catch { return {}; } }
  for (const line of s.split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return out;
}

// —— 各协议的请求地址 ——
function requestUrl(ch, ctx = {}) {
  const o = ch.opts || {};
  switch (ch.type) {
    case 'github': {
      const repo = String(o.repo || '').replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GitHub 仓库格式应为 owner/repo');
      const what = o.what || 'releases';
      if (o.api) return what === 'commits' ? `https://api.github.com/repos/${repo}/commits?per_page=20${o.branch ? '&sha=' + encodeURIComponent(o.branch) : ''}` : `https://api.github.com/repos/${repo}/${what}?per_page=20`;
      return what === 'commits' ? `https://github.com/${repo}/commits/${encodeURIComponent(o.branch || 'main')}.atom` : `https://github.com/${repo}/${what}.atom`;
    }
    case 'hn': return `https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=40&query=${encodeURIComponent(o.query || ch.keyword || '')}${o.minPoints ? '&numericFilters=points>=' + Number(o.minPoints) : ''}`;
    case 'reddit': {
      const sub = String(o.sub || '').replace(/^\/?r\//, '');
      if (!sub) throw new Error('请填写版块名，如 OpenAI');
      return o.query ? `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.rss?q=${encodeURIComponent(o.query)}&restrict_sr=on&sort=new&limit=50` : `https://www.reddit.com/r/${encodeURIComponent(sub)}/new/.rss?limit=50`;
    }
    case 'discourse': { const base = String(ch.url || '').replace(/\/(latest(\.json|\.rss)?)?$/, ''); return o.category ? `${base}/c/${o.category}.json` : `${base}/latest.json`; }
    case 'telegram': { const c = String(o.channel || '').replace(/^@|^https?:\/\/t\.me\/(s\/)?/g, ''); if (!c) throw new Error('请填写频道名'); return `https://t.me/s/${c}`; }
    case 'bluesky': { const h = String(o.handle || '').replace(/^@/, ''); if (!h) throw new Error('请填写 Bluesky 账号'); return `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(h)}&limit=30&filter=posts_no_replies`; }
    case 'mastodon': {
      const inst = String(o.instance || 'mastodon.social').replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (o.tag) return `https://${inst}/api/v1/timelines/tag/${encodeURIComponent(String(o.tag).replace(/^#/, ''))}?limit=40`;
      if (!o.acct) throw new Error('请填写账号或话题');
      return `https://${inst}/api/v1/accounts/lookup?acct=${encodeURIComponent(String(o.acct).replace(/^@/, ''))}`;
    }
    case 'youtube': return o.channelId ? 'https://www.youtube.com/feeds/videos.xml?channel_id=' + encodeURIComponent(o.channelId) : ch.url;
    case 'appstore': return `https://itunes.apple.com/lookup?id=${encodeURIComponent(o.appId)}&country=${o.country || 'us'}`;
    case 'gplay': return `https://play.google.com/store/apps/details?id=${encodeURIComponent(o.pkg)}&hl=en_US&gl=US`;
    case 'rsshub': {
      const base = String(ctx.rsshubBase || '').replace(/\/$/, '');
      if (!base) throw new Error('未设置 RSSHub 地址（设置 → 高级 → RSSHub 实例）');
      return base + '/' + String(o.route || '').replace(/^\//, '');
    }
    case 'search': {
      const kw = ch.keyword || o.keyword || '';
      const zh = ch.region === 'cn' || /[\u3400-\u9fff]/.test(kw);
      if (o.engine === 'bing') return `https://www.bing.com/news/search?q=${encodeURIComponent(kw)}&format=rss&setlang=${zh ? 'zh-cn' : 'en-us'}`;
      return `https://news.google.com/rss/search?q=${encodeURIComponent(kw + ' when:30d')}&${zh ? 'hl=zh-CN&gl=CN&ceid=CN:zh-Hans' : 'hl=en-US&gl=US&ceid=US:en'}`;
    }
    case 'producthunt': return ch.url || 'https://www.producthunt.com/feed';
    default: return ch.url;
  }
}

// —— 解析器 ——
function parseJsonFeed(body) {
  const o = parseJSON(body);
  if (!o || !Array.isArray(o.items) || !/jsonfeed/.test(o.version || '')) throw new Error('不是 JSON Feed（缺少 version/items）');
  return o.items.map((it) => ({ guid: String(it.id || it.url), title: firstLine(it.title || stripHtml(it.content_html || it.content_text || ''), 160), link: it.url || it.external_url || '', summary: stripHtml(it.summary || it.content_html || it.content_text || '').slice(0, 400), image: it.image || '', published: toTs(it.date_published || it.date_modified) }));
}
function parseJsonApi(body, ch, url) {
  const o = ch.opts || {};
  const data = parseJSON(body);
  let arr = getPath(data, o.itemsPath || '');
  if (!Array.isArray(arr)) throw new Error('JSONPath「' + (o.itemsPath || '$') + '」没有指向数组');
  return arr.map((it) => {
    let link = field(it, o.linkField || 'url');
    if (o.linkPrefix && link && !/^https?:/.test(link)) link = o.linkPrefix + link;
    return { guid: link || field(it, 'id'), title: firstLine(stripHtml(field(it, o.titleField || 'title')), 200), link: absUrl(link, url), summary: stripHtml(field(it, o.summaryField || '')).slice(0, 400), image: field(it, o.imageField || ''), published: toTs(field(it, o.dateField || '')) };
  });
}
function parseHtmlList(body, ch, url) {
  const o = ch.opts || {};
  if (!o.list) throw new Error('请填写列表项 CSS 选择器');
  const root = parseHtml(body);
  const nodes = root.querySelectorAll(o.list);
  if (!nodes.length) throw new Error('列表选择器「' + o.list + '」未匹配到元素（页面可能需要 JS 渲染）');
  return nodes.map((n) => {
    const tn = o.title ? n.querySelector(o.title) : n;
    const ln = o.link ? n.querySelector(o.link) : (n.tagName === 'A' ? n : n.querySelector('a'));
    const dn = o.date ? n.querySelector(o.date) : n.querySelector('time');
    const sn = o.summary ? n.querySelector(o.summary) : null;
    const href = ln ? ln.getAttribute('href') : '';
    const img = n.querySelector('img');
    return { guid: href, title: firstLine(decodeEntities(tn ? tn.text : ''), 200), link: absUrl(href, url), summary: sn ? firstLine(decodeEntities(sn.text), 400) : '', image: img ? absUrl(img.getAttribute('src') || '', url) : '', published: dn ? toTs(dn.getAttribute('datetime') || dn.text.trim()) : null };
  }).filter((x) => x.title && x.link);
}
function parseTelegram(body, url) {
  const root = parseHtml(body);
  const msgs = root.querySelectorAll('.tgme_widget_message');
  if (!msgs.length) { if (/tgme_page_title/.test(body)) throw new Error('频道不公开预览或不存在'); throw new Error('未找到频道消息'); }
  return msgs.map((m) => {
    const post = m.getAttribute('data-post') || '';
    const tx = m.querySelector('.tgme_widget_message_text');
    const text = tx ? decodeEntities(tx.structuredText || tx.text) : '';
    const tm = m.querySelector('time');
    const a = tx && tx.querySelector('a[href^="http"]');
    return { guid: 'tg:' + post, title: firstLine(text.split('\n')[0] || text, 140), link: 'https://t.me/' + post, summary: firstLine(text, 400), image: '', published: tm ? toTs(tm.getAttribute('datetime')) : null, outLink: a ? a.getAttribute('href') : '' };
  }).filter((x) => x.title).reverse();
}
function parseBluesky(body, ch) {
  const o = parseJSON(body);
  if (!Array.isArray(o.feed)) throw new Error(o.message || 'Bluesky 返回格式异常');
  const h = String((ch.opts || {}).handle || '').replace(/^@/, '');
  return o.feed.filter((f) => !f.reason).map(({ post }) => {
    const r = post.record || {}; const rkey = String(post.uri).split('/').pop();
    const ext = post.embed && (post.embed.external || (post.embed.media && post.embed.media.external));
    return { guid: post.uri, title: firstLine(r.text || (ext && ext.title) || '', 140), link: `https://bsky.app/profile/${post.author.handle || h}/post/${rkey}`, summary: firstLine((r.text || '') + (ext ? '  🔗 ' + (ext.title || '') + ' ' + ext.uri : ''), 400), image: ext && ext.thumb || '', published: toTs(r.createdAt || post.indexedAt) };
  }).filter((x) => x.title);
}
function parseMastodonStatuses(arr) {
  if (!Array.isArray(arr)) throw new Error((arr && arr.error) || 'Mastodon 返回格式异常');
  return arr.filter((s) => !s.reblog).map((s) => {
    const text = stripHtml(s.content || '');
    return { guid: s.uri || s.id, title: firstLine((s.spoiler_text ? s.spoiler_text + ' ' : '') + text, 140) || (s.card && s.card.title) || '', link: s.url || s.uri, summary: firstLine(text + (s.card ? '  🔗 ' + (s.card.title || '') : ''), 400), image: (s.media_attachments || [])[0] ? s.media_attachments[0].preview_url : '', published: toTs(s.created_at) };
  }).filter((x) => x.title);
}
function parseDiscourse(body, base) {
  const o = parseJSON(body);
  const topics = o && o.topic_list && o.topic_list.topics;
  if (!Array.isArray(topics)) throw new Error('不是 Discourse 论坛 JSON');
  return topics.filter((t) => !t.pinned_globally && t.visible !== false).map((t) => ({ guid: 'dc:' + t.id, title: decodeEntities(t.title || t.fancy_title || ''), link: new URL(`/t/${encodeURIComponent(t.slug || 'topic')}/${t.id}`, base).href, summary: t.excerpt ? stripHtml(t.excerpt).slice(0, 300) : `回复 ${t.posts_count - 1 || 0} · 浏览 ${t.views || 0}`, image: t.image_url || '', published: toTs(t.created_at) }));
}
function parseHNJson(body) {
  const o = parseJSON(body);
  if (!Array.isArray(o.hits)) throw new Error('Hacker News 返回格式异常');
  return o.hits.filter((h) => h.title).map((h) => ({ guid: 'hn:' + h.objectID, title: decodeEntities(h.title), link: h.url || 'https://news.ycombinator.com/item?id=' + h.objectID, summary: `HN ${h.points || 0} 分 · ${h.num_comments || 0} 条评论 · 讨论 https://news.ycombinator.com/item?id=${h.objectID}`, image: '', published: h.created_at_i ? h.created_at_i * 1000 : null }));
}
function parseGithubApi(body, ch) {
  const arr = parseJSON(body);
  if (!Array.isArray(arr)) throw new Error((arr && arr.message) || 'GitHub API 返回异常');
  const repo = (ch.opts || {}).repo; const what = (ch.opts || {}).what || 'releases';
  if (what === 'commits') return arr.map((c) => ({ guid: c.sha, title: firstLine(c.commit.message.split('\n')[0], 160), link: c.html_url, summary: firstLine(c.commit.message, 400), image: '', published: toTs(c.commit.author && c.commit.author.date) }));
  if (what === 'tags') return arr.map((t) => ({ guid: 'tag:' + t.name, title: `${repo} ${encodeURIComponent(t.name)}`, link: `https://github.com/${repo}/releases/tag/${encodeURIComponent(t.name)}`, summary: '', image: '', published: null }));
  return arr.map((r) => ({ guid: 'rel:' + r.id, title: `${repo} ${r.name || r.tag_name}`, link: r.html_url, summary: firstLine(r.body || '', 400), image: '', published: toTs(r.published_at || r.created_at) }));
}
function parseAppStore(body) {
  const o = parseJSON(body);
  const a = o.results && o.results[0];
  if (!a) throw new Error('App Store 未找到该应用 ID');
  if(!a.trackId || !a.trackName || !a.trackViewUrl || !a.version)throw new Error('App Store response missing required application fields');
  const price=a.formattedPrice || (Number.isFinite(a.price) && a.currency ? new Intl.NumberFormat('en',{style:'currency',currency:a.currency}).format(a.price) : 'unknown / 价格未知');
  return [{ guid: `as:${a.trackId}:${a.version}`, title: `${a.trackName} iOS 版更新 ${a.version}`, link: a.trackViewUrl.replace(/\?.*$/, '') + '#v' + a.version, summary: firstLine((a.releaseNotes || '') + `（价格 ${price}，评分 ${Number(a.averageUserRating || 0).toFixed(1)}）`, 400), image: a.artworkUrl100 || '', published: toTs(a.currentVersionReleaseDate) }];
}
function parseGplay(body, ch, url) {
  const name = (body.match(/<h1[^>]*>(?:<span[^>]*>)?([^<]+)/) || [])[1] || (ch.opts || {}).pkg;
  let upd = (body.match(/Updated on<\/div><div[^>]*>([^<]+)</) || [])[1];
  if(!upd){const root=parseHtml(body);const el=root.querySelector('[itemprop=dateModified]');upd=el?.getAttribute('content') || '';if(!upd)for(const n of root.querySelectorAll('div,span')){if(n.text.trim()==='Updated on'){upd=n.nextElementSibling?.text?.trim() || '';if(toTs(upd))break;}}}
  if (!upd || !toTs(upd)) throw new Error('未能识别 Google Play 更新时间（页面结构变化或需要 JS）');
  return [{ guid: 'gp:' + (ch.opts || {}).pkg + ':' + upd, title: `${decodeEntities(name)} Android 版更新（${upd}）`, link: url + '#' + encodeURIComponent(upd), summary: '', image: '', published: toTs(upd) }];
}

function filterItems(items, ch) {
  const split = (s) => String(s || '').split(/[,，\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const inc = split(ch.include); const exc = split(ch.exclude);
  let re = null; try { re = ch.regex ? new RegExp(ch.regex, 'i') : null; } catch { throw new Error('正则表达式无效：' + ch.regex); }
  return items.filter((it) => {
    const t = (it.title + ' ' + (it.summary || '')).toLowerCase();
    if (inc.length && !inc.some((k) => t.includes(k))) return false;
    if (exc.some((k) => t.includes(k))) return false;
    if (re && !re.test(it.title)) return false;
    return true;
  });
}

/**
 * 采集一个列表型渠道 → { items, url }
 * fetchText(url, { ua, headers, timeout, proxy, render }) 由调用方提供
 */
async function collect(ch, { fetchText, ctx = {} } = {}) {
  const cap = require('./source-capabilities').capability(ch,ctx);
  if (['config-required','unsupported'].includes(cap.state)) throw new Error(cap.state+': '+cap.hint);
  const url = requestUrl(ch, ctx);
  const o = ch.opts || {};
  const req = { maxBytes: o.maxBytes, meta: {}, ua: ch.ua, headers: parseHeaders(ch.headers), timeout: (Number(ch.timeout) || 20) * 1000, proxy: ch.proxy, render: !!(ch.render || o.render), wait: o.wait };
  let items;
  const body = await fetchText(url, req);
  if (require('./page').isBlocked(body)) throw new Error('SOURCE_BLOCKED: challenge page');
  switch (ch.type) {
    case 'jsonfeed': items = parseJsonFeed(body); break;
    case 'json': items = parseJsonApi(body, ch, url); break;
    case 'html': items = parseHtmlList(body, ch, url); break;
    case 'telegram': items = parseTelegram(body, url); break;
    case 'bluesky': items = parseBluesky(body, ch); break;
    case 'mastodon': {
      const j = parseJSON(body);
      if (o.tag) items = parseMastodonStatuses(j);
      else {
        if (!j.id) throw new Error('Mastodon 账号不存在');
        const inst = String(o.instance || 'mastodon.social').replace(/^https?:\/\//, '').replace(/\/$/, '');
        items = parseMastodonStatuses(parseJSON(await fetchText(`https://${inst}/api/v1/accounts/${j.id}/statuses?exclude_replies=true&exclude_reblogs=true&limit=30`, req)));
      }
      break;
    }
    case 'discourse': items = parseDiscourse(body, String(ch.url).replace(/\/(latest(\.json|\.rss)?)?$/, '')); break;
    case 'hn': items = parseHNJson(body); break;
    case 'github': items = o.api ? parseGithubApi(body, ch) : parseFeed(body,{baseURL:req.meta.finalURL || url}).items.map((it) => ({ ...it, title: (o.what === 'commits' ? '' : String(o.repo).split('/')[1] + ' ') + it.title })); break;
    case 'appstore': items = parseAppStore(body); break;
    case 'gplay': items = parseGplay(body, ch, url); break;
    default: { // rss / youtube / reddit / producthunt / rsshub / search
      const t = String(body).trimStart();
      if (t.startsWith('{')) { const j = parseJSON(t); items = j.version && /jsonfeed/.test(j.version) ? parseJsonFeed(j) : (() => { throw new Error('返回了 JSON 而不是 RSS'); })(); } else { const feed=await require('./feed').parseOrDiscoverFeed(body,req.meta.finalURL||url,fetchText,req); items=feed.items; if(!items.length&&!feed.validEmpty)throw new Error('Feed has no meaningful parsed data'); }
    }
  }
  const rawCount = items.length;
  items = items.map(it => ({ ...it, link: absUrl(it.link,req.meta.finalURL||url), image: absUrl(it.image,req.meta.finalURL||url) })).filter(it=>it.title && it.link);
  if (rawCount && !items.length) throw new Error('Source records have no valid title/link');
  items = filterItems(items, ch);
  if (ch.maxItems && items.length > ch.maxItems) items = items.slice(0, ch.maxItems);
  return { items, url, rawCount, validEmpty: rawCount === 0 && ch.type !== 'html' && ch.type !== 'gplay' && ch.type !== 'telegram' };
}

// Sitemap：返回 URL 列表（sitemapindex 自动展开前若干个子 sitemap）
async function sitemapUrls(ch, fetchText) {
 const o=ch.opts||{};const req={ua:ch.ua,headers:parseHeaders(ch.headers),timeout:(Number(ch.timeout)||20)*1000,proxy:ch.proxy};
 const maxMaps=Math.min(12,Math.max(1,Number(o.maxSitemaps)||8)), maxURLs=Math.min(10000,Math.max(1,Number(o.maxURLs)||3000));
 const visited=new Set(),urls=new Set(),warnings=[];let sampled=false;
 async function walk(url,depth=0){
  if(visited.has(url))return;
  if(visited.size>=maxMaps || depth>3){sampled=true;return;}
  visited.add(url);const body=await fetchText(url,req);
  if(require('./page').isBlocked(body))throw new Error('SOURCE_BLOCKED: sitemap challenge');
  const index=/<(?:\w+:)?sitemapindex[\s>]/i.test(body.slice(0,3000));
  if(!index&&!/<(?:\w+:)?urlset[\s>]/i.test(body.slice(0,3000)))throw new Error('Not a sitemap / 不是 sitemap.xml');
  const locs=[...String(body).matchAll(/<(?:\w+:)?loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/(?:\w+:)?loc>/gi)].map(m=>{try{return new URL(decodeEntities(m[1].trim()),url).href;}catch{return '';}}).filter(u=>/^https?:/.test(u));
  if(index){let subs=locs;const relevant=o.filter?subs.filter(u=>u.includes(o.filter)):[];if(relevant.length)subs=relevant;
   for(const sub of subs.slice().reverse()){if(visited.size>=maxMaps){sampled=true;break;}try{await walk(sub,depth+1);}catch(e){warnings.push(e.message);if(/SOURCE_BLOCKED|HTTP (401|403|429)/i.test(e.message))break;}}
  }else for(const u of locs){if(!o.filter||u.includes(o.filter)){if(urls.size<maxURLs)urls.add(u);else sampled=true;}}
 }
 await walk(ch.url);if(!urls.size&&warnings.length)throw new Error(warnings.join('; '));
 const result=[...urls];Object.defineProperties(result,{warnings:{value:warnings},stats:{value:{fetchedMaps:visited.size,maxMaps,maxURLs,sampled}}});return result;
}

function titleFromUrl(u) {
  try { const p = new URL(u).pathname.split('/').filter(Boolean).pop() || u; return decodeURIComponent(p).replace(/\.(html?|php)$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); } catch { return u; }
}

module.exports = { PROTOCOLS, STATEFUL, collect, requestUrl, sitemapUrls, titleFromUrl, parseHeaders, filterItems, getPath, parseJsonFeed, parseJsonApi, parseHtmlList, parseTelegram, parseBluesky, parseMastodonStatuses, parseDiscourse, parseAppStore, parseGplay };
