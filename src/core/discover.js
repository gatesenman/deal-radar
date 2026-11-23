'use strict';
const L = require('../renderer/i18n').t;
// AI 辅助发现：输入厂商名 → 自己搜索（Bing 网页 / Wikidata / DuckDuckGo）→ 确定官网 → 自动发现 RSS、常见路径、sitemap、
// 官方社交 / 论坛 / 应用商店 → （可选）LLM 归类、补全别名与排除词 → 逐个用现有协议实测 → 交给用户勾选确认。
// 只产出标准协议（collectors.PROTOCOLS），不引入任何额外的抓取方式。
const { parse: parseHtml } = require('node-html-parser');
const { PROTOCOLS, parseHtmlList, getPath } = require('./collectors');
const { extractLines, isBlocked } = require('./page');
const { decodeEntities } = require('./feed');

const CJK = /[\u3400-\u9fff]/;
const NOT_OFFICIAL = /(^|\.)(wikipedia|wikidata|wikimedia|linkedin|twitter|x|facebook|instagram|youtube|youtu|github|gitlab|reddit|crunchbase|bloomberg|forbes|techcrunch|theverge|wired|cnbc|reuters|wsj|nytimes|ft|bbc|cnn|zhihu|baidu|weibo|bilibili|douyin|tiktok|medium|substack|google|bing|microsoft|apple|amazon|g2|capterra|producthunt|skilljar|sohu|163|sina|qq|36kr|ithome|csdn|jianshu|toutiao|pitchbook|tracxn|glassdoor|indeed|yahoo|msn|similarweb|trustpilot|play|apps|ycombinator|news|venturebeat|zdnet|businessinsider|cnet|engadget|arstechnica|tomsguide|techradar|pcmag|makeuseof|economist|time|fortune|axios|semafor|theinformation|scmp|caixin|huxiu|geekpark|jiqizhixin|qbitai|sspai|ifanr|smzdm)\.[a-z.]+$/i;
const SOCIAL_HOST = /^(?:www\.)?(github\.com|youtube\.com|bsky\.app|t\.me|apps\.apple\.com|play\.google\.com)$/i;
const MASTO_HOSTS = /^(mastodon\.social|mastodon\.online|fosstodon\.org|hachyderm\.io|mstdn\.social|infosec\.exchange|techhub\.social|mas\.to)$/i;
const SEC = /(^|\/)(pricing|plans?|price|定价|价格)(\/|$|\?|#)/i;
const PROMO = /(^|\/)(students?|education|edu|startups?|startup-program|offers?|promotions?|free-trial)(\/|$|\?|#)/i;
const BLOG = /(^|\/)(blog|news|newsroom|press|announcements?|stories|research|insights)(\/|$|\?|#)/i;
const CHANGE = /(^|\/)(changelog|release-notes|releases|whats-new|what-s-new|updates)(\/|$|\?|#)/i;
const STATUS = /^status\./i;
const COMMON_FEEDS = ['/feed', '/rss', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml', '/blog/rss.xml', '/blog/feed', '/blog/feed.xml', '/blog/rss', '/news/rss.xml', '/news/feed', '/changelog/rss.xml', '/changelog.xml', '/changelog/feed.xml'];
const COMMON_PAGES = ['/pricing', '/plans', '/blog', '/news', '/changelog', '/release-notes'];

const slugName = (s) => String(s).toLowerCase().replace(/\s*[/／(（].*$/, '').replace(/[^a-z0-9]+/g, '');
const tokensOf = (name) => String(name).toLowerCase().split(/[\s/／()（）·,，.\-_]+/).filter((t) => t.length >= 3 && !/^(ai|inc|the|llc|ltd|labs?|company|corp)$/.test(t));
function regDomain(host) {
  const h = String(host).toLowerCase().replace(/^www\./, '');
  const p = h.split('.');
  if (p.length > 2 && /^(com|net|org|gov|edu|co)\.(cn|uk|jp|hk|tw|au)$/.test(p.slice(-2).join('.'))) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
const abs = (href, base) => { try { const u = new URL(href, base); u.hash = ''; return /^https?:$/.test(u.protocol) ? u.toString() : ''; } catch { return ''; } };
const looksFeed = (b) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<\?xml-stylesheet[^>]*>\s*)?<(rss|feed|rdf:RDF)[\s>]/i.test(String(b).slice(0, 3000)) || /"version"\s*:\s*"https:\/\/jsonfeed\.org/.test(String(b).slice(0, 400));
const looksSitemap = (b) => /<(urlset|sitemapindex)[\s>]/i.test(String(b).slice(0, 3000));
const titleOfHtml = (html) => { const m = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim().slice(0, 160) : ''; };
const metaDesc = (html) => { const m = String(html).match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i) || String(html).match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)/i); return m ? decodeEntities(m[1]).trim().slice(0, 300) : ''; };

// —— 可取消的抓取包装 ——
function guarded(fetchText, signal) {
  return (url, o = {}) => {
    if (signal && signal.aborted) return Promise.reject(new Error('已取消'));
    const p = fetchText(url, { timeout: 12000, ...o });
    if (!signal) return p;
    return new Promise((res, rej) => {
      const onAbort = () => rej(new Error('已取消'));
      signal.addEventListener('abort', onAbort, { once: true });
      p.then((v) => { signal.removeEventListener('abort', onAbort); res(v); }, (e) => { signal.removeEventListener('abort', onAbort); rej(e); });
    });
  };
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: e }; } } }));
  return out;
}
const tryFetch = async (ft, url, o) => { try { return await ft(url, o); } catch (e) { if (/已取消/.test(e.message)) throw e; return null; } };

// —— 1. 搜索 ——
function parseBingCites(html) {
  const out = [];
  for (const m of String(html).matchAll(/<cite[^>]*>([\s\S]*?)<\/cite>/g)) {
    const t = decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim();
    const mm = t.match(/^(https?:\/\/)?([^\s›/]+)(.*)$/); if (!mm) continue;
    const path = mm[3].split('›').map((x) => x.trim()).filter(Boolean).filter((x) => !/\.\.\.$|…$/.test(x)).join('/');
    out.push('https://' + mm[2] + (path ? '/' + path : ''));
  }
  return out;
}
function parseDDG(html) {
  const out = [];
  for (const m of String(html).matchAll(/href="[^"]*?uddg=([^&"]+)/g)) { try { out.push(decodeURIComponent(m[1])); } catch { /* 忽略 */ } }
  return out;
}
async function webSearch(q, ft) {
  const urls = [];
  const bing = await tryFetch(ft, `https://www.bing.com/search?q=${encodeURIComponent(q)}&mkt=en-US&setlang=en-US`, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
  if (bing) urls.push(...parseBingCites(bing));
  if (urls.length < 3) { const ddg = await tryFetch(ft, `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`); if (ddg) urls.push(...parseDDG(ddg)); }
  return [...new Set(urls)];
}
// Wikidata：官网（P856）与官方账号（YouTube P2397 / GitHub P2037 / Bluesky P12361 / Mastodon P4033 / App Store P3861 / Google Play P3418 / Telegram P3789）+ 中英文别名
const WD = { website: 'P856', youtube: 'P2397', github: 'P2037', bluesky: 'P12361', mastodon: 'P4033', appstore: 'P3861', gplay: 'P3418', telegram: 'P3789' };
const WD_DESC = /(company|compan|software|artificial intelligence|\bAI\b|chatbot|language model|startup|developer|platform|service|app|product|search engine|公司|软件|人工智能|模型|助手|平台|应用)/i;
async function wikidata(name, ft) {
  const langs = CJK.test(name) ? ['zh', 'en'] : ['en', 'zh'];
  for (const lang of langs) {
    const s = await tryFetch(ft, `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=${lang}&uselang=${lang}&type=item&limit=7&format=json&origin=*`);
    if (!s) continue;
    let hits; try { hits = JSON.parse(s).search || []; } catch { continue; }
    const n = name.toLowerCase();
    const hit = hits.find((h) => WD_DESC.test(h.description || '') && ((h.label || '').toLowerCase() === n || ((h.match || {}).text || '').toLowerCase() === n)) || hits.find((h) => WD_DESC.test(h.description || '') && (h.label || '').toLowerCase().includes(n));
    if (!hit) continue;
    const e = await tryFetch(ft, `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${hit.id}&props=claims|labels|aliases&languages=en|zh|zh-cn|zh-hans&format=json&origin=*`);
    if (!e) return { id: hit.id, label: hit.label, description: hit.description };
    let ent; try { ent = JSON.parse(e).entities[hit.id]; } catch { return null; }
    const claim = (p) => ((ent.claims || {})[p] || []).filter((c) => c.mainsnak && c.mainsnak.datavalue && c.rank !== 'deprecated').map((c) => c.mainsnak.datavalue.value).filter((v) => typeof v === 'string');
    const out = { id: hit.id, label: hit.label, description: hit.description || '' };
    for (const [k, p] of Object.entries(WD)) out[k] = claim(p);
    const al = new Set();
    for (const l of Object.values(ent.labels || {})) al.add(l.value);
    for (const arr of Object.values(ent.aliases || {})) for (const a of arr) al.add(a.value);
    out.aliases = [...al].filter((a) => a.length <= 30 && a.length >= 2);
    return out;
  }
  return null;
}
// 由搜索结果给候选官网打分
function rankDomains(name, urls, wd) {
  const sl = slugName(name);
  // 名称词 + Wikidata 英文别名（如「智谱」→ Zhipu AI → zhipu），用来判断域名是否与厂商相关
  const toks = [...new Set([...tokensOf(name), ...((wd && wd.aliases) || []).filter((a) => !CJK.test(a)).flatMap(tokensOf)])].filter((t) => !/\./.test(t));
  const hitOf = new Map();
  const score = new Map(); const sample = new Map();
  urls.forEach((u, i) => {
    const h = hostOf(u); if (!h) return;
    const d = regDomain(h); if (NOT_OFFICIAL.test(d)) return;
    let s = Math.max(1, 12 - i);
    const label = d.split('.')[0];
    const nameHit = (sl && (label === sl || label.includes(sl) || (sl.includes(label) && label.length >= 4))) || toks.some((t) => label.includes(t));
    if (nameHit) { s += 15; hitOf.set(d, true); } else s = Math.round(s * 0.3); // 域名与名称无关的结果大幅降权（如「Mistral」搜到菜谱站）
    if (/-(zh|cn|app|ai|free|online|download)$|^(get|try|use)/.test(label) && label !== sl) s -= 6; // 常见仿冒 / 导流站
    score.set(d, (score.get(d) || 0) + s); if (!sample.has(d)) sample.set(d, []); sample.get(d).push(u);
  });
  for (const w of (wd && wd.website) || []) { const d = regDomain(hostOf(w)); if (d) { hitOf.set(d, true); score.set(d, (score.get(d) || 0) + 25); if (!sample.has(d)) sample.set(d, []); sample.get(d).unshift(w); } }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([domain, s]) => ({ domain, score: s, nameHit: !!hitOf.get(domain), urls: [...new Set(sample.get(domain))].slice(0, 8) }));
}

// —— 2. 官网爬取 ——
function scanLinks(html, baseUrl) {
  const root = parseHtml(html);
  const feeds = root.querySelectorAll('link[rel~="alternate"]').filter((l) => /rss|atom|feed\+json|application\/json/i.test(l.getAttribute('type') || '')).map((l) => ({ url: abs(l.getAttribute('href') || '', baseUrl), title: (l.getAttribute('title') || '').trim() })).filter((x) => x.url);
  const anchors = root.querySelectorAll('a[href]').map((a) => ({ url: abs(a.getAttribute('href'), baseUrl), text: a.text.replace(/\s+/g, ' ').trim().slice(0, 60), rel: a.getAttribute('rel') || '' })).filter((a) => a.url);
  return { feeds, anchors };
}
function classifyAnchor(a, officialDomains) {
  const u = a.url; const h = hostOf(u); let m;
  if ((m = u.match(/^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)(?:\/([\w.-]+))?\/?(?:$|[?#])/i)) && !/^(features|about|pricing|login|orgs|topics|sponsors|marketplace|enterprise|apps)$/i.test(m[1])) return m[2] ? { kind: 'github-repo', repo: m[1] + '/' + m[2] } : { kind: 'github-org', org: m[1] };
  if ((m = u.match(/youtube\.com\/(channel\/(UC[\w-]{22})|@([\w.-]+)|c\/([\w.-]+)|user\/([\w.-]+))/i))) return { kind: 'youtube', channelId: m[2] || '', handle: m[3] || m[4] || m[5] || '' };
  if ((m = u.match(/bsky\.app\/profile\/([\w.:-]+)/i))) return { kind: 'bluesky', handle: m[1] };
  if ((m = u.match(/^https?:\/\/t\.me\/(?:s\/)?([A-Za-z]\w{3,})\/?$/i))) return { kind: 'telegram', channel: m[1] };
  if ((m = u.match(/apps\.apple\.com\/.*\/id(\d{6,})/i))) return { kind: 'appstore', appId: m[1] };
  if ((m = u.match(/play\.google\.com\/store\/apps\/details\?(?:.*&)?id=([\w.]+)/i))) return { kind: 'gplay', pkg: m[1] };
  if ((m = u.match(/^https?:\/\/([^/]+)\/@([\w.]+)\/?$/)) && (MASTO_HOSTS.test(m[1]) || /\bme\b/.test(a.rel))) return { kind: 'mastodon', instance: m[1], acct: m[2] };
  const d = regDomain(h);
  if (!officialDomains.includes(d)) return null;
  if (/^(community|forum|forums|discuss|discourse)\./i.test(h)) return { kind: 'forum', base: 'https://' + h };
  if (STATUS.test(h)) return { kind: 'status', url: 'https://' + h };
  let path = ''; try { path = new URL(u).pathname; } catch { /* 忽略 */ }
  if (/\/(login|signin|signup|register|careers|jobs|legal|privacy|terms|cookie|contact|support|help|docs?\/?$)/i.test(path) && !SEC.test(path)) return null;
  if (SEC.test(path) && path.split('/').filter(Boolean).length <= 3) return { kind: 'pricing', url: u };
  if (PROMO.test(path) && path.split('/').filter(Boolean).length <= 2) return { kind: 'promo', url: u };
  if (CHANGE.test(path) && path.split('/').filter(Boolean).length <= 2) return { kind: 'changelog', url: u };
  const depth = path.split('/').filter(Boolean).length;
  if (BLOG.test(path) && depth <= 1) return { kind: 'blog', url: u };
  return null;
}

function mk(type, name, sub, extra, why, origin) {
  const c = { type, name, sub, why, origin, ...extra };
  c.key = type + '|' + (c.url || '') + '|' + JSON.stringify(c.opts || {}) + '|' + (c.keyword || '');
  return c;
}

/**
 * discoverVendor(name, { fetchText, llm, testChannel, onStep, signal, existing })
 * 返回 { vendor:{ name, aliases, exclude, region, domain, homepage, title, description }, candidates:[…含 test 结果、checked], steps, usedAI, notes }
 */
async function discoverVendor(rawName, opts = {}) {
  const name = String(rawName || '').trim();
  if (!name) throw new Error('请输入厂商名称');
  const { llm = null, testChannel = null, onStep = () => {}, signal = null } = opts;
  const ft = guarded(opts.fetchText, signal);
  const step = (id, state, text) => { if (signal && signal.aborted) throw new Error('已取消'); onStep({ id, state, text }); };
  const notes = [];
  // 1. 搜索
  step('search', 'run', `搜索「${name}」的官网和官方账号（Bing / Wikidata）…`);
  const aiQ = /\bai\b|人工智能|智能/i.test(name) ? name : `${name} AI`;
  const [urls1, urls2, urls3, wd0] = await Promise.all([webSearch(name, ft), webSearch(`${name} official site`, ft), webSearch(aiQ, ft), wikidata(name, ft)]);
  const wd = wd0 || (aiQ !== name ? await wikidata(aiQ, ft) : null);
  // 本应用面向 AI / 软件厂商：「名称 + AI」的结果排在前面
  const urls = [...new Set([...urls3, ...urls1, ...urls2])];
  let ranked = rankDomains(name, urls, wd);
  step('search', 'ok', `找到 ${urls.length} 个搜索结果${wd ? `，Wikidata：${wd.label}（${wd.description || '无描述'}）` : ''}`);
  // 2. 确定官网（AI 可参与判断，但必须来自搜索结果或 Wikidata，防止臆造）
  step('domain', 'run', '判断官方域名…');
  let ai1 = null;
  if (llm) {
    try {
      ai1 = await llm.json([
        { role: 'system', content: 'You configure a monitor for official deals/pricing/news of mainstream software & AI vendors. Answer ONLY JSON.' },
        { role: 'user', content: `Vendor the user typed: "${name}".\nSearch results (domain → sample URLs):\n${ranked.slice(0, 10).map((r) => `- ${r.domain}: ${r.urls.slice(0, 3).join(' ')}`).join('\n')}\nWikidata: ${wd ? `${wd.label} — ${wd.description}; website ${(wd.website || []).join(', ')}` : 'none'}\n\nReturn {"official_domains":["main registrable domain first, plus other official ones (e.g. product or China domain)"],"display_name":"canonical vendor/product name, CN/EN with ' / ' if both are common","aliases":["names people use in titles, English and Chinese, product names, max 8"],"exclude":["words that indicate a different meaning of the name (to avoid false matches), max 6"],"region":"intl or cn","is_mainstream":true|false,"reason":"short"}. Use only domains that appear above unless you are certain.` },
      ], { signal, maxTokens: 600 });
    } catch (e) { if (/已取消/.test(e.message)) throw e; notes.push('AI 判断官网失败，改用规则：' + e.message); }
  }
  let domains = [];
  if (ai1 && Array.isArray(ai1.official_domains)) domains = ai1.official_domains.map((d) => regDomain(String(d).replace(/^https?:\/\//, '').split('/')[0])).filter((d) => /\.[a-z]{2,}$/i.test(d) && !NOT_OFFICIAL.test(d));
  if (!domains.length && ranked.length) domains = [ranked[0].domain, ...ranked.slice(1, 3).filter((r) => r.nameHit && r.score >= ranked[0].score * 0.4).map((r) => r.domain)];
  if (!domains.length) {
    // 最后兜底：猜测 name.com / .ai / .cn
    const sl = slugName(name);
    for (const tld of ['com', 'ai', 'io', 'cn']) { if (!sl) break; const b = await tryFetch(ft, `https://${sl}.${tld}/`, { timeout: 8000 }); if (b && titleOfHtml(b).toLowerCase().includes(sl.slice(0, 4))) { domains = [`${sl}.${tld}`]; break; } }
  }
  domains = [...new Set(domains)].slice(0, 3);
  if (!domains.length) { step('domain', 'err', '没有找到可信的官网。可以换个更完整的名称（如英文全称）重试，或直接手动添加渠道。'); throw new Error('没有找到「' + name + '」的官网'); }
  // 官网首页：优先用搜索结果里该域名的首个 URL 的主机（如 www.kimi.com）
  const homeHosts = [];
  for (const d of domains) { const r = ranked.find((x) => x.domain === d); const h = r ? hostOf(r.urls.find((u) => regDomain(hostOf(u)) === d && new URL(u).pathname.length <= 4) || r.urls[0]) : ''; homeHosts.push(h && regDomain(h) === d ? h : 'www.' + d); }
  step('domain', 'ok', `官网：${domains.join('、')}${ai1 ? '（AI 确认）' : ''}`);
  // 3. 爬取官网
  step('crawl', 'run', `读取官网首页，自动发现 RSS / 博客 / 价格页 / 官方账号…`);
  const found = []; const add = (c) => { if (!found.some((x) => x.key === c.key)) found.push(c); };
  let homeHtml = ''; let homeUrl = ''; const anchors = []; const feeds = [];
  for (const h of homeHosts) {
    for (const u of [`https://${h}/`, `https://${h.replace(/^www\./, '')}/`]) {
      const body = await tryFetch(ft, u);
      if (body && !isBlocked(body)) { if (!homeHtml) { homeHtml = body; homeUrl = u; } const s = scanLinks(body, u); anchors.push(...s.anchors); feeds.push(...s.feeds); break; }
    }
  }
  if (!homeHtml) notes.push('官网首页无法直接读取（可能有人机验证或需要 JS），已改用常见路径和搜索结果。');
  const title = titleOfHtml(homeHtml); const description = metaDesc(homeHtml);
  // 搜索结果里属于官网的 URL 也作为线索
  for (const r of ranked.filter((x) => domains.includes(x.domain))) for (const u of r.urls) anchors.push({ url: u, text: '', rel: '' });
  const cls = anchors.map((a) => ({ a, c: classifyAnchor(a, domains) })).filter((x) => x.c);
  // 二级页面（博客 / 更新日志）再做一次 RSS 自动发现
  const listPages = [...new Map(cls.filter((x) => ['blog', 'changelog'].includes(x.c.kind)).map((x) => [x.c.url.replace(/\/$/, ''), x.c])).values()].slice(0, 4);
  const origin = homeUrl ? new URL(homeUrl).origin : `https://${homeHosts[0]}`;
  const probes = [...COMMON_FEEDS.map((p) => origin + p), origin + '/sitemap.xml'];
  const [subPages, probeRes] = await Promise.all([
    pool(listPages, 3, async (c) => ({ c, body: await tryFetch(ft, c.url) })),
    pool(probes, 5, async (u) => ({ u, body: await tryFetch(ft, u, { timeout: 8000 }) })),
  ]);
  for (const sp of subPages) if (sp && sp.body) feeds.push(...scanLinks(sp.body, sp.c.url).feeds);
  const feedSeen = new Set();
  for (const f of feeds) {
    if (feedSeen.has(f.url) || !domains.includes(regDomain(hostOf(f.url))) || /comments/i.test(f.url)) continue; feedSeen.add(f.url);
    const sub = CHANGE.test(f.url) ? 'changelog' : 'blog';
    add(mk(/json/i.test(f.url) && !/rss|atom/i.test(f.url) ? 'jsonfeed' : 'rss', f.title || (sub === 'changelog' ? '更新日志 RSS' : '官方博客 RSS'), sub, { url: f.url }, '官网 <link rel=alternate> 声明的订阅源', '官网'));
  }
  for (const p of probeRes) {
    if (!p || !p.body) continue;
    if (looksFeed(p.body) && !feedSeen.has(p.u)) { feedSeen.add(p.u); add(mk('rss', (CHANGE.test(p.u) ? '更新日志' : /news/.test(p.u) ? '新闻' : '博客') + ' RSS（' + new URL(p.u).pathname + '）', CHANGE.test(p.u) ? 'changelog' : 'blog', { url: p.u }, '常见订阅路径可访问', '常见路径')); }
    else if (looksSitemap(p.body)) { const filter = /\/news\//.test(p.body) ? '/news/' : /\/blog\//.test(p.body) ? '/blog/' : ''; add(mk('sitemap', '官网新页面（sitemap' + (filter ? ' ' + filter : '') + '）', 'blog', { url: p.u, opts: filter ? { filter } : {} }, '官网有 sitemap.xml，可第一时间发现新发布的页面', '常见路径')); }
  }
  const pages = new Map();
  for (const { c } of cls) {
    if (c.kind === 'pricing' || c.kind === 'promo') pages.set(c.url.replace(/\/$/, ''), c);
    if (c.kind === 'changelog' || c.kind === 'blog') if (!feedSeen.size || c.kind === 'changelog') pages.set(c.url.replace(/\/$/, ''), c);
  }
  if (![...pages.values()].some((c) => c.kind === 'pricing')) pages.set(origin + '/pricing', { kind: 'pricing', url: origin + '/pricing', guessed: true });
  for (const c of [...pages.values()].slice(0, 8)) {
    const sub = c.kind === 'pricing' || c.kind === 'promo' ? 'pricing' : c.kind === 'changelog' ? 'changelog' : 'blog';
    const label = c.kind === 'pricing' ? '价格页' : c.kind === 'promo' ? '优惠 / 学生 / 创业计划页' : c.kind === 'changelog' ? '更新日志页' : '博客 / 新闻页';
    add(mk('page', `${label}（${new URL(c.url).pathname}）`, sub, { url: c.url.replace(/\/$/, '') || c.url }, c.guessed ? '常见价格页路径（未在首页链接中出现）' : '官网链接', c.guessed ? '常见路径' : '官网'));
  }
  const status = cls.find((x) => x.c.kind === 'status');
  if (status) add(mk('rss', '服务状态', 'status', { url: status.c.url + '/history.rss' }, '官网链接到状态页（Atlassian Statuspage 提供 RSS）', '官网'));
  const forum = cls.find((x) => x.c.kind === 'forum');
  if (forum) add(mk('discourse', '官方社区论坛', 'forum', { url: forum.c.base }, '官网链接到社区论坛（Discourse 时可用）', '官网'));
  // 官方账号：官网链接 + Wikidata
  const repos = [...new Set(cls.filter((x) => x.c.kind === 'github-repo').map((x) => x.c.repo))].slice(0, 2);
  const orgs = [...new Set([...cls.filter((x) => x.c.kind === 'github-org').map((x) => x.c.org), ...((wd && wd.github) || [])])].slice(0, 1);
  if (!repos.length && orgs.length) {
    const j = await tryFetch(ft, `https://api.github.com/search/repositories?q=${encodeURIComponent('org:' + orgs[0])}&sort=stars&per_page=3`, { headers: { Accept: 'application/vnd.github+json' } });
    try { for (const r of (JSON.parse(j || '{}').items || []).slice(0, 2)) repos.push(r.full_name); } catch { /* 忽略 */ }
  }
  for (const r of repos) add(mk('github', `GitHub ${r} 发布`, 'github', { opts: { repo: r, what: 'releases' } }, orgs.length ? `官方 GitHub 组织 ${orgs[0]} 下的热门仓库` : '官网链接到该仓库', 'GitHub'));
  const yt = cls.find((x) => x.c.kind === 'youtube'); let ytId = (wd && wd.youtube && wd.youtube[0]) || (yt && yt.c.channelId) || '';
  if (!ytId && yt && yt.c.handle) { const b = await tryFetch(ft, `https://www.youtube.com/@${yt.c.handle}`, { headers: { 'Accept-Language': 'en' } }); const m = b && (b.match(/"(?:externalId|channelId)":"(UC[\w-]{22})"/) || b.match(/channel\/(UC[\w-]{22})/)); if (m) ytId = m[1]; }
  if (ytId) add(mk('youtube', 'YouTube 官方频道', 'youtube', { opts: { channelId: ytId } }, wd && wd.youtube && wd.youtube.length ? 'Wikidata 记录的官方频道' : '官网链接', wd && wd.youtube && wd.youtube.length ? 'Wikidata' : '官网'));
  const bs = cls.find((x) => x.c.kind === 'bluesky'); const bsH = (wd && wd.bluesky && wd.bluesky[0]) || (bs && bs.c.handle);
  if (bsH) add(mk('bluesky', 'Bluesky 官方账号', 'social', { opts: { handle: bsH } }, '官方 Bluesky 账号', bs ? '官网' : 'Wikidata'));
  const ms = cls.find((x) => x.c.kind === 'mastodon'); const msW = wd && wd.mastodon && wd.mastodon[0];
  if (ms) add(mk('mastodon', 'Mastodon 官方账号', 'social', { opts: { instance: ms.c.instance, acct: ms.c.acct } }, '官网链接（rel=me）', '官网'));
  else if (msW && msW.includes('@')) { const [acct, inst] = msW.replace(/^@/, '').split('@'); add(mk('mastodon', 'Mastodon 官方账号', 'social', { opts: { instance: inst, acct } }, 'Wikidata 记录的官方账号', 'Wikidata')); }
  const tg = cls.find((x) => x.c.kind === 'telegram'); const tgN = (tg && tg.c.channel) || (wd && wd.telegram && wd.telegram[0]);
  if (tgN) add(mk('telegram', 'Telegram 官方频道', 'social', { opts: { channel: tgN } }, '官方 Telegram 频道', tg ? '官网' : 'Wikidata'));
  // 应用商店：官网链接 → Wikidata → iTunes 搜索 API（名称 + 开发者需与官网匹配）
  let appId = (cls.find((x) => x.c.kind === 'appstore') || {}).c?.appId || (wd && wd.appstore && wd.appstore[0]);
  if (!appId) {
    const j = await tryFetch(ft, `https://itunes.apple.com/search?term=${encodeURIComponent(name.split(/\s*[/／]\s*/)[0])}&entity=software&limit=8&country=us`);
    try {
      const sl = slugName(name).slice(0, 5);
      const hit = (JSON.parse(j || '{}').results || []).find((r) => (r.sellerUrl && domains.includes(regDomain(hostOf(r.sellerUrl)))) || (sl && slugName(r.sellerName || r.artistName || '').includes(sl) && slugName(r.trackName).includes(sl)));
      if (hit) appId = String(hit.trackId);
    } catch { /* 忽略 */ }
  }
  if (appId) add(mk('appstore', 'iOS App 更新', 'app', { opts: { appId: String(appId), country: 'us' } }, 'App Store 官方应用（开发者与官网匹配）', 'App Store'));
  const pkg = (cls.find((x) => x.c.kind === 'gplay') || {}).c?.pkg || (wd && wd.gplay && wd.gplay[0]);
  if (pkg) add(mk('gplay', 'Android App 更新', 'app', { opts: { pkg } }, 'Google Play 官方应用', '官网'));
  const region = (ai1 && ai1.region === 'cn') || CJK.test(name) || domains.some((d) => /\.cn$/.test(d)) ? 'cn' : 'intl';
  const kwName = name.split(/\s*[/／]\s*/)[0];
  add(mk('search', `${kwName} 英文新闻（优惠搜索）`, 'news', { keyword: `"${kwName}" (free OR discount OR credits OR pricing OR students OR price)` }, '按厂商名 + 优惠词搜索 Google 新闻', '搜索'));
  if (region === 'cn' || CJK.test(name)) add(mk('search', `${kwName} 中文新闻（优惠搜索）`, 'news', { keyword: `${kwName} 免费 OR 优惠 OR 降价 OR 限免 OR 学生`, region: 'cn' }, '中文厂商：按名称 + 优惠词搜索中文新闻', '搜索'));
  if (!CJK.test(kwName)) add(mk('hn', 'Hacker News 讨论', 'forum', { opts: { query: kwName, minPoints: 20 } }, 'HN 上讨论度较高的帖子', '搜索'));
  step('crawl', 'ok', `发现 ${found.length} 个候选渠道`);
  // 4. AI 归类（可选）
  let usedAI = !!ai1; let ai2 = null;
  if (llm) {
    step('ai', 'run', 'AI 归类候选渠道、补全别名与排除词…');
    try {
      ai2 = await llm.json([
        { role: 'system', content: 'You configure a monitor that watches mainstream vendors\' OFFICIAL channels for deals, free trials, credits, student offers and price changes. Answer ONLY JSON.' },
        { role: 'user', content: `Vendor: ${name}\nOfficial domains: ${domains.join(', ')}\nHomepage title: ${title}\nDescription: ${description}\n\nCandidate channels (idx | protocol | sub | url/opts | why):\n${found.map((c, i) => `${i} | ${c.type} | ${c.sub} | ${c.url || c.keyword || JSON.stringify(c.opts)} | ${c.why}`).join('\n')}\n\nAllowed protocols: ${Object.keys(PROTOCOLS).join(', ')}. Allowed subs: blog, changelog, pricing, status, app, social, youtube, github, forum, news.\nReturn {"channels":[{"idx":0,"keep":true,"sub":"pricing","name":"short Chinese name","keyword":"optional: for page protocol, comma-separated words to keep only lines with prices/offers"}],"extra":[{"type":"page|rss|sitemap|…","url":"https://… (must be on an official domain)","sub":"…","name":"…","why":"…"}],"aliases":["…"],"exclude":["…"],"notes":"one sentence in Chinese"}. Keep official, high-signal channels; drop duplicates, irrelevant or third-party ones. Suggest at most 4 extra official URLs you are confident exist (pricing, student/education, changelog, newsroom).` },
      ], { signal, maxTokens: 1500 });
      usedAI = true;
      for (const ch of Array.isArray(ai2.channels) ? ai2.channels : []) {
        const c = found[Number(ch.idx)]; if (!c) continue;
        c.aiKeep = ch.keep !== false;
        if (ch.sub && /^(blog|changelog|pricing|status|app|social|youtube|github|forum|news)$/.test(ch.sub)) c.sub = ch.sub;
        if (ch.name && String(ch.name).length <= 40) c.name = String(ch.name);
        if (ch.keyword && c.type === 'page' && String(ch.keyword).length <= 80) c.keyword = String(ch.keyword);
      }
      for (const x of (Array.isArray(ai2.extra) ? ai2.extra : []).slice(0, 4)) {
        if (!PROTOCOLS[x.type] || ['search', 'rsshub', 'json', 'html'].includes(x.type)) continue;
        if (!x.url || !domains.includes(regDomain(hostOf(x.url)))) continue; // 只接受官网域名下的地址，防止 AI 臆造第三方站点
        add({ ...mk(x.type, String(x.name || 'AI 建议渠道').slice(0, 40), x.sub || 'blog', { url: x.url }, String(x.why || 'AI 建议').slice(0, 80), 'AI 建议'), aiKeep: true });
      }
      if (ai2.notes) notes.push('AI：' + String(ai2.notes).slice(0, 160));
      step('ai', 'ok', `AI 已归类 ${found.length} 个候选`);
    } catch (e) { if (/已取消/.test(e.message)) throw e; notes.push('AI 归类失败，已改用规则：' + e.message); step('ai', 'err', 'AI 归类失败，改用规则：' + e.message); }
  } else step('ai', 'skip', '未配置 AI：使用规则分类（可在「设置 → AI 助手」配置）');
  // 5. 逐个实测
  if (testChannel) {
    step('test', 'run', `用现有协议实测 ${found.length} 个渠道…`);
    let done = 0;
    await pool(found, 4, async (c) => {
      if (signal && signal.aborted) throw new Error('已取消');
      try { c.test = await testChannel(c, signal); } catch (e) { c.test = { ok: false, error: e.message }; }
      // 关键词过滤过严导致无内容：去掉关键词再试
      if (c.type === 'page' && c.keyword && c.test && !c.test.ok && /未从页面提取/.test(c.test.error || '')) {
        try { const t = await testChannel({ ...c, keyword: '' }, signal); if (t.ok) { c.keyword = ''; c.test = t; } } catch { /* 保留原结果 */ }
      }
      // 网页监控被拦截时自动尝试 JS 渲染
      if (c.type === 'page' && c.test && !c.test.ok && /403|人机|验证|未从页面提取|challenge/i.test(c.test.error || '') && opts.canRender) {
        const r = { ...c, type: 'render', key: c.key + '|render' };
        try { const t = await testChannel(r, signal); if (t.ok) { c.type = 'render'; c.test = t; c.why += '（普通请求被拦截，改用 JS 渲染）'; } } catch { /* 保留原结果 */ }
      }
      onStep({ id: 'test', state: 'run', text: `实测中… ${++done}/${found.length}` });
    });
    step('test', 'ok', `实测完成：${found.filter((c) => c.test && c.test.ok).length}/${found.length} 可用`);
  }
  // 同一内容的重复订阅（如 /rss.xml 与 /news/rss 指向同一 feed）只勾选一个
  const sig = (c) => c.test && c.test.ok && c.test.sample && c.test.sample.length ? c.type + '|' + c.test.total + '|' + c.test.sample[0] : '';
  const seenSig = new Set();
  for (const c of found) { const k = sig(c); if (!k || c.type !== 'rss') continue; if (seenSig.has(k)) c.dupOf = true; else seenSig.add(k); }
  // 6. 默认勾选
  const useful = (c) => c.test ? c.test.ok && ((c.test.total || 0) > 0 || (c.test.lineCount || 0) >= 3) : true;
  for (const c of found) c.checked = useful(c) && !c.dupOf && c.aiKeep !== false && !(c.type === 'page' && c.sub === 'blog' && found.some((x) => x !== c && x.type === 'rss' && x.sub === 'blog' && useful(x)));
  let n = 0; for (const c of found) if (c.checked && ++n > 14) c.checked = false;
  // 别名 / 排除词
  const aliasSet = new Set([kwName]);
  for (const a of [...((ai1 && ai1.aliases) || []), ...((ai2 && ai2.aliases) || [])]) if (typeof a === 'string' && a.trim().length >= 2 && a.length <= 30) aliasSet.add(a.trim());
  if (!llm && wd && wd.aliases) for (const a of wd.aliases.slice(0, 8)) if (!/\b(inc|ltd|llc|corporation)\b|有限公司|股份|\.[a-z]{2,}$/i.test(a) && a.length <= 20) aliasSet.add(a);
  const exclude = [...new Set([...((ai1 && ai1.exclude) || []), ...((ai2 && ai2.exclude) || [])].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()))].slice(0, 8);
  const display = ai1 && ai1.display_name && String(ai1.display_name).length <= 40 ? String(ai1.display_name) : name;
  return {
    vendor: { name: display, aliases: [...aliasSet].slice(0, 10), exclude, region, domains, homepage: homeUrl || `https://${homeHosts[0]}/`, title, description, wikidata: wd ? { id: wd.id, label: wd.label, description: wd.description } : null, mainstream: ai1 ? ai1.is_mainstream !== false : null },
    candidates: found.map(({ key, ...c }) => ({ key, ...c })), usedAI, notes,
  };
}

// —— AI 辅助添加单个渠道：粘贴 URL 或自然语言描述 ——
const INTENTS = [
  ['pricing', /(定价|价格|改价|涨价|降价|套餐|pricing|price|plans?)/i, ['/pricing', '/plans', '/api/pricing']],
  ['promo', /(学生|教育|创业|student|education|startup)/i, ['/students', '/education', '/startups']],
  ['changelog', /(更新日志|更新|版本|发布说明|changelog|release|what'?s new)/i, ['/changelog', '/release-notes', '/releases']],
  ['blog', /(博客|新闻|公告|官方动态|blog|news|announcement)/i, ['/blog', '/news', '/newsroom']],
  ['status', /(状态|故障|宕机|status|outage)/i, []],
  ['app', /(app|应用|ios|android|手机)/i, []],
  ['github', /(github|开源|sdk|仓库)/i, []],
  ['youtube', /(youtube|视频)/i, []],
];
function platformChannel(url) {
  let m;
  if ((m = url.match(/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(releases|tags|commits))?(?:[/?#]|$)/i)) && !/\.atom$/.test(url)) return { type: 'github', opts: { repo: `${m[1]}/${m[2]}`, what: m[3] || 'releases' }, sub: 'github', name: `GitHub ${m[1]}/${m[2]}` };
  if ((m = url.match(/youtube\.com\/channel\/(UC[\w-]{22})/i))) return { type: 'youtube', opts: { channelId: m[1] }, sub: 'youtube', name: 'YouTube 频道' };
  if ((m = url.match(/reddit\.com\/r\/(\w+)/i))) return { type: 'reddit', opts: { sub: m[1] }, sub: 'reddit', name: 'r/' + m[1] };
  if ((m = url.match(/bsky\.app\/profile\/([\w.:-]+)/i))) return { type: 'bluesky', opts: { handle: m[1] }, sub: 'social', name: 'Bluesky ' + m[1] };
  if ((m = url.match(/^https?:\/\/t\.me\/(?:s\/)?(\w{4,})/i))) return { type: 'telegram', opts: { channel: m[1] }, sub: 'social', name: 'Telegram ' + m[1] };
  if ((m = url.match(/apps\.apple\.com\/.*\/id(\d{6,})/i))) return { type: 'appstore', opts: { appId: m[1], country: (url.match(/apps\.apple\.com\/(\w\w)\//) || [])[1] || 'us' }, sub: 'app', name: 'iOS App 更新' };
  if ((m = url.match(/play\.google\.com\/store\/apps\/details\?(?:.*&)?id=([\w.]+)/i))) return { type: 'gplay', opts: { pkg: m[1] }, sub: 'app', name: 'Android App 更新' };
  if ((m = url.match(/news\.ycombinator\.com\/.*[?&]q=([^&]+)/i))) return { type: 'hn', opts: { query: decodeURIComponent(m[1]) }, sub: 'forum', name: 'HN ' + decodeURIComponent(m[1]) };
  if ((m = url.match(/^https?:\/\/([^/]+)\/@([\w.]+)\/?$/)) && MASTO_HOSTS.test(m[1])) return { type: 'mastodon', opts: { instance: m[1], acct: m[2] }, sub: 'social', name: 'Mastodon @' + m[2] };
  if (/producthunt\.com\/feed/i.test(url)) return { type: 'producthunt', url, sub: 'other', name: 'Product Hunt' };
  return null;
}
// JSON：找出最像“条目列表”的数组，并猜字段
function guessJson(data) {
  let best = null;
  const walk = (v, path, depth) => {
    if (depth > 4 || v == null) return;
    if (Array.isArray(v)) {
      const objs = v.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
      if (objs.length >= 2) {
        const keys = Object.keys(objs[0]);
        const pick = (re) => keys.find((k) => re.test(k) && typeof objs[0][k] === 'string');
        const title = pick(/^(title|name|headline|subject|text)$/i) || pick(/title|name/i);
        const score = objs.length + (title ? 50 : 0);
        if (title && (!best || score > best.score)) best = { score, itemsPath: path || '$', titleField: title, linkField: pick(/^(url|link|href|permalink|html_url|web_url)$/i) || pick(/url|link|slug/i) || '', dateField: pick(/^(published_at|publishedAt|created_at|createdAt|date|pubDate|updated_at|time)$/i) || pick(/date|time|_at$/i) || '', summaryField: pick(/^(summary|description|excerpt|body|content)$/i) || '' };
      }
      return;
    }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : `$.${k}`, depth + 1);
  };
  walk(data, '', 0);
  return best;
}
// HTML 列表：找出重复出现、路径前缀一致的链接（如 /blog/xxx），给出 CSS 选择器
function guessListSelector(html, url) {
  const root = parseHtml(html);
  let basePath = ''; try { basePath = new URL(url).pathname.replace(/\/$/, ''); } catch { /* 忽略 */ }
  const counts = new Map();
  for (const a of root.querySelectorAll('a[href]')) {
    const u = abs(a.getAttribute('href'), url); if (!u || hostOf(u) !== hostOf(url)) continue;
    const p = new URL(u).pathname.split('/').filter(Boolean);
    if (p.length < 2 || a.text.trim().length < 12) continue;
    const prefix = '/' + p[0] + '/';
    counts.set(prefix, (counts.get(prefix) || 0) + 1);
  }
  const ranked = [...counts.entries()].filter(([, n]) => n >= 3).sort((a, b) => (b[0] === basePath + '/' ? 1e6 : b[1]) - (a[0] === basePath + '/' ? 1e6 : a[1]));
  if (!ranked.length) return null;
  return { list: `a[href*="${ranked[0][0]}"]`, count: ranked[0][1] };
}
function compactHtml(html, max = 14000) {
  return String(html).replace(/<(script|style|svg|noscript|iframe)[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\s(style|data-[\w-]+|aria-[\w-]+|srcset|sizes|onclick)="[^"]*"/gi, '').replace(/\s+/g, ' ').slice(0, max);
}

async function analyzeUrl(url, { ft, llm, signal, intent = '' }) {
  const plat = platformChannel(url);
  if (plat) return { channel: { url: plat.url || '', ...plat }, reason: '识别为平台链接，使用对应的专用协议' };
  let body; let fetchErr = '';
  try { body = await ft(url, { timeout: 15000 }); } catch (e) { if (/已取消/.test(e.message)) throw e; fetchErr = e.message; }
  const name = (() => { try { const u = new URL(url); return u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : ''); } catch { return url; } })();
  if (!body) {
    const blocked = /403|401|429|503|人机|challenge/i.test(fetchErr);
    return { channel: { type: 'render', url, sub: intent === 'pricing' ? 'pricing' : 'blog', name }, reason: `普通请求失败（${fetchErr}）${blocked ? '，可能有反爬，' : '，'}建议用 JS 渲染监控页面变化`, warn: true };
  }
  if (looksFeed(body)) return { channel: { type: /jsonfeed\.org/.test(body.slice(0, 400)) ? 'jsonfeed' : 'rss', url, sub: CHANGE.test(url) ? 'changelog' : 'blog', name: titleFromFeed(body) || name }, reason: '地址本身就是 RSS / Atom 订阅源' };
  if (looksSitemap(body)) return { channel: { type: 'sitemap', url, sub: 'blog', name: name + '（sitemap）', opts: {} }, reason: 'sitemap.xml：新页面出现时提醒（可在「URL 过滤」里填 /blog/ 等）' };
  const t = body.trimStart();
  if (t[0] === '{' || t[0] === '[') {
    let data; try { data = JSON.parse(t); } catch { data = null; }
    if (data) {
      const g = guessJson(data);
      if (g) return { channel: { type: 'json', url, sub: 'blog', name, opts: { itemsPath: g.itemsPath, titleField: g.titleField, linkField: g.linkField, dateField: g.dateField, summaryField: g.summaryField } }, reason: `JSON 接口：条目数组 ${g.itemsPath}，标题字段 ${g.titleField}` };
      return { channel: { type: 'page', url, sub: 'other', name }, reason: 'JSON 中没找到条目数组，改为监控内容变化', warn: true };
    }
  }
  if (isBlocked(body)) return { channel: { type: 'render', url, sub: intent === 'pricing' || SEC.test(url) ? 'pricing' : 'blog', name: titleOfHtml(body) || name }, reason: '页面返回人机验证，改用 JS 渲染（隐藏浏览器）' };
  const title = titleOfHtml(body) || name;
  const { feeds } = scanLinks(body, url);
  const lines = (() => { try { return extractLines(body, {}); } catch { return []; } })();
  const textLen = lines.join('').length;
  const isPricing = intent === 'pricing' || intent === 'promo' || SEC.test(url) || PROMO.test(url);
  const alternatives = feeds.slice(0, 4).map((f) => ({ type: 'rss', url: f.url, name: f.title || 'RSS', sub: 'blog', why: '页面声明的订阅源' }));
  if (!isPricing && feeds.length) {
    const sameSection = feeds.find((f) => { try { return new URL(f.url).pathname.startsWith(new URL(url).pathname.replace(/\/$/, '')); } catch { return false; } }) || feeds[0];
    return { channel: { type: 'rss', url: sameSection.url, sub: CHANGE.test(url) ? 'changelog' : 'blog', name: sameSection.title || title }, reason: '页面声明了 RSS / Atom 订阅源（<link rel=alternate>），订阅比抓网页更稳定', alternatives: [{ type: 'page', url, name: title, sub: 'blog', why: '直接监控页面变化' }, ...alternatives.filter((a) => a.url !== sameSection.url)] };
  }
  if (textLen < 200) return { channel: { type: 'render', url, sub: isPricing ? 'pricing' : 'blog', name: title }, reason: `页面正文几乎为空（${textLen} 字），内容由 JS 生成，改用 JS 渲染`, alternatives };
  if (isPricing) {
    const root = parseHtml(body); const sel = ['main', '#pricing', '[class*="pricing"]', 'article'].find((s) => { try { const n = root.querySelector(s); return n && n.text.trim().length > 200; } catch { return false; } }) || '';
    return { channel: { type: 'page', url, sub: 'pricing', name: title, selector: sel === 'main' || sel === 'article' ? sel : sel }, reason: `价格 / 活动页：监控页面文字变化（${lines.length} 行${sel ? '，只比较 ' + sel : ''}）`, alternatives };
  }
  // 列表页：LLM 建议 CSS 选择器 → 启发式 → 退回页面监控
  if (llm) {
    try {
      const s = await llm.json([
        { role: 'system', content: 'You write CSS selectors for scraping a list of posts from HTML. Answer ONLY JSON.' },
        { role: 'user', content: `URL: ${url}\nHTML (trimmed):\n${compactHtml(body)}\n\nReturn {"is_list":true|false,"list":"selector matching each post item (an <a> or a container)","title":"selector inside item or empty","link":"selector inside item or empty","date":"selector inside item or empty","reason":"short Chinese"}. Selectors must work with a simple CSS engine (no :has, no :contains).` },
      ], { signal, maxTokens: 400 });
      if (s && s.is_list !== false && s.list) {
        const o = { list: String(s.list), title: s.title || '', link: s.link || '', date: s.date || '' };
        const items = (() => { try { return parseHtmlList(body, { opts: o }, url); } catch { return []; } })();
        if (items.length >= 3) return { channel: { type: 'html', url, sub: CHANGE.test(url) ? 'changelog' : 'blog', name: title, opts: o }, reason: `AI 建议的 CSS 选择器匹配到 ${items.length} 条${s.reason ? '：' + s.reason : ''}`, alternatives: [{ type: 'page', url, name: title, sub: 'blog', why: '直接监控页面变化' }, ...alternatives], usedAI: true };
      }
    } catch (e) { if (/已取消/.test(e.message)) throw e; }
  }
  const g = guessListSelector(body, url);
  if (g) {
    const items = (() => { try { return parseHtmlList(body, { opts: { list: g.list } }, url); } catch { return []; } })();
    if (items.length >= 3) return { channel: { type: 'html', url, sub: CHANGE.test(url) ? 'changelog' : 'blog', name: title, opts: { list: g.list } }, reason: `识别为文章列表页：选择器 ${g.list} 匹配到 ${items.length} 条`, alternatives: [{ type: 'page', url, name: title, sub: 'blog', why: '直接监控页面变化' }, ...alternatives] };
  }
  return { channel: { type: 'page', url, sub: CHANGE.test(url) ? 'changelog' : BLOG.test(url) ? 'blog' : 'other', name: title }, reason: `未发现订阅源或列表结构，监控页面文字变化（${lines.length} 行）`, alternatives };
}
function titleFromFeed(b) { const m = String(b).match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i); return m ? decodeEntities(m[1]).trim().slice(0, 60) : ''; }

/**
 * discoverChannel(input, { fetchText, llm, brand, signal }) → { channel, reason, alternatives, usedAI }
 * brand: 当前厂商（用于根据已有渠道推断官网域名）
 */
async function discoverChannel(input, opts = {}) {
  const text = String(input || '').trim();
  if (!text) throw new Error('请输入网址或描述');
  const { llm = null, brand = null, signal = null } = opts;
  const ft = guarded(opts.fetchText, signal);
  const urlIn = text.match(/https?:\/\/[^\s"'<>，。]+/);
  if (urlIn) return analyzeUrl(urlIn[0].replace(/[),.]+$/, ''), { ft, llm, signal });
  // 自然语言
  const intentHit = INTENTS.find(([, re]) => re.test(text));
  let intent = intentHit ? intentHit[0] : '';
  const hosts = brand ? [...new Set((brand.channels || []).map((c) => hostOf(c.url || '')).filter((h) => h && !SOCIAL_HOST.test(h) && !/news\.google|bing\.com|reddit|hn\.algolia|itunes|play\.google|ycombinator/.test(h)))] : [];
  let usedAI = false; let guess = null;
  if (llm) {
    try {
      guess = await llm.json([
        { role: 'system', content: 'You map a user request to ONE monitoring channel for a deal/price/news monitor. Answer ONLY JSON.' },
        { role: 'user', content: `Request: ${text}\nCurrent vendor: ${brand ? brand.name : 'unknown'}; known official hosts: ${hosts.join(', ') || 'unknown'}\nProtocols: ${Object.keys(PROTOCOLS).join(', ')}\nReturn {"url":"best official URL to watch (https), or empty","type":"protocol","intent":"pricing|promo|changelog|blog|status|app|github|youtube|news","keyword":"for search protocol or page line filter","opts":{},"reason":"short Chinese"}. Prefer official pages; for price-change alerts use the official pricing page with protocol page.` },
      ], { signal, maxTokens: 400 });
      usedAI = true;
      if (guess.intent) intent = String(guess.intent);
    } catch (e) { if (/已取消/.test(e.message)) throw e; }
  }
  if (guess && guess.url && /^https?:\/\//.test(guess.url)) {
    const r = await analyzeUrl(guess.url, { ft, llm: null, signal, intent });
    if (!r.warn || guess.type === 'render') { if (guess.keyword && r.channel.type === 'page') r.channel.keyword = String(guess.keyword).slice(0, 80); return { ...r, reason: 'AI：' + (guess.reason || '已定位官方页面') + '；' + r.reason, usedAI }; }
  }
  if (guess && guess.type === 'search' && guess.keyword) return { channel: { type: 'search', keyword: String(guess.keyword), sub: 'news', name: '搜索：' + guess.keyword }, reason: 'AI：' + (guess.reason || '用新闻搜索覆盖'), usedAI };
  // 规则：在厂商官网上找对应页面
  const paths = intentHit ? intentHit[2] : [];
  for (const h of hosts.slice(0, 3)) {
    if (intent === 'status') { const u = `https://status.${regDomain(h)}/history.rss`; const b = await tryFetch(ft, u); if (b && looksFeed(b)) return { channel: { type: 'rss', url: u, sub: 'status', name: '服务状态' }, reason: '找到 Statuspage 状态 RSS', usedAI }; continue; }
    for (const p of paths) {
      const u = `https://${h}${p}`; const b = await tryFetch(ft, u);
      if (b && !isBlocked(b)) { const r = await analyzeUrl(u, { ft, llm: null, signal, intent }); return { ...r, reason: L('在官网 {0} 找到 {1}；', h, p) + r.reason, usedAI }; }
    }
    if (intent === 'blog' || intent === 'changelog') {
      const home = await tryFetch(ft, `https://${h}/`);
      if (home) { const f = scanLinks(home, `https://${h}/`).feeds[0]; if (f) return { channel: { type: 'rss', url: f.url, sub: intent, name: f.title || '官方 RSS' }, reason: '官网首页声明的订阅源', usedAI }; }
    }
  }
  const kw = text.replace(/(帮我|请|添加|监控|提醒|一下|的|渠道|关注|我要|我想)/g, ' ').replace(/\s+/g, ' ').trim() || text;
  return { channel: { type: 'search', keyword: kw, sub: 'news', name: '搜索：' + kw }, reason: hosts.length ? '官网上没找到对应页面，改用新闻搜索' : '无法确定官网（请先给厂商添加一个官网渠道，或直接粘贴网址），改用新闻搜索', usedAI, warn: true };
}

module.exports = { discoverVendor, discoverChannel, analyzeUrl, rankDomains, regDomain, parseBingCites, parseDDG, scanLinks, classifyAnchor, guessJson, guessListSelector, platformChannel, looksFeed, looksSitemap, compactHtml };
