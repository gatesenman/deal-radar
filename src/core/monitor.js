'use strict';
const crypto = require('crypto');
const { parseFeed, parseCheapShark, parseHN } = require('./feed');
const { classifyOffer, isOffer, refineOffer, applyFeedback, OFFER_LABELS } = require('./offers');
const { extractLines, hashLines, diffLines, diffSnippet, isBlocked } = require('./page');
const V29 = require('./v29');
const { compileBrand, matchBrands, isDealText, extractPrice, extractDiscount, searchTerm } = require('./matcher');
const { collect, sitemapUrls, titleFromUrl, requestUrl, parseHeaders, STATEFUL } = require('./collectors');
const { UA, nodeFetchText } = require('./http');
const { canonicalUrl, scoreDeal } = require('./dedupe');

const HARDWARE_RE = /\b(keyboard|mouse|laptops?|notebooks?|monitors?|headphones?|earbuds|ssd|tablets?|smartphones?|chromebook|desktop pc|gaming pc|tv|glasses|oakley|ray-?ban|smart glasses|phones?|pixel \d+|galaxy s\d+)\b|键盘|鼠标|笔记本电脑|显示器|耳机|手机壳|平板电脑|汽车|车型/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function hashId(s) { return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16); }

// 规范化链接用于去重（去掉常见追踪参数）
function normLink(link) { return canonicalUrl(link); }

function normTitle(t) { return String(t).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 80); }

// 默认 Node fetch 实现（Electron 中会替换为 net.fetch / session.fetch 以支持系统代理）
const defaultFetchText = nodeFetchText;

// 请求选项：渠道级 UA / 请求头 / 超时 / 代理开关
function reqOpts(source, meta) {
  return { ua: source.ua, headers: parseHeaders(source.headers), timeout: (Number(source.timeout) || 20) * 1000, proxy: source.proxy, meta };
}
// 带重试与退避：429 / 5xx / 连接重置 → 等待（遵守 Retry-After，最长 20 秒）后重试一次
async function withRetry(fn, retryDelay) {
  try { return await fn(); } catch (e) {
    if (!/HTTP (429|5\d\d)|ECONNRESET|反爬|fetch failed/.test(e.message)) throw e;
    if (e.retryAfter > 20) throw e; // persist the cooldown instead of retrying before the server allows
    await sleep(Math.min(20000, e.retryAfter ? e.retryAfter * 1000 : retryDelay));
    return fn();
  }
}

// 为数据源生成具体请求列表（search 类型按品牌展开）
function expandRequests(source, brands) {
  if (source.kind !== 'search') return [{ url: source.url, brandId: null }];
  return brands.map((b) => {
    const q = (searchTerm(b, source.region) + ' ' + (source.searchSuffix || '')).trim();
    return { url: source.url.replace('{q}', encodeURIComponent(q).replace(/%20/g, '+')), brandId: b.id };
  });
}

async function pLimit(tasks, n) {
  const out = new Array(tasks.length);
  let i = 0;
  async function worker() { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return out;
}

/**
 * 抓取单个数据源并按品牌过滤，返回 { items, status }
 */
// 网页变化监控（价格页 / 无 RSS 的新闻页）：首次抓取建立基线，之后内容变化生成一条「页面变化」动态，附差异片段
async function fetchPage(source, allBrands, { fetchText = defaultFetchText, renderText = null, now = Date.now(), retryDelay = 3000, pages = {} } = {}) {
  const t0 = Date.now();
  const meta = {};
  const st = (ok, extra) => ({ ok, lastRun: now, ms: Date.now() - t0, total: 0, matched: 0, requests: 1, error: '', cached: !!meta.cached, retryAt: meta.retryAt || 0, httpStatus: meta.httpStatus || 0, ...extra });
  const isRender = source.type === 'render' || (source.render && source.type !== 'sitemap');
  const vendor = source.vendor;
  const mkItem = (title, link, summary, types, extra = {}) => ({
    id: hashId(link + '#' + (extra.hash || title)), titleKey: normTitle(title + (extra.hash || '')), title, heat: 0, category: source.category || 'ai',
    offerTypes: types, link, summary, image: '', price: extractPrice(summary.slice(0, 300)), discount: extractDiscount(summary.slice(0, 300)),
    published: now, fetchedAt: now, brandIds: vendor ? [vendor] : [], sourceId: source.id, sourceName: source.name,
    platform: source.platform, region: source.region, origin: extra.origin || '网页变化监控', read: false, fav: false, sub: source.sub, ...extra.more,
  });
  // —— Sitemap：检测新出现的 URL ——
  if (source.type === 'sitemap') {
    let urls;
    try { urls = await withRetry(() => sitemapUrls(source, (u, o) => fetchText(u, { ...reqOpts(source, meta), ...o })), retryDelay); } catch (e) { return { items: [], status: st(false, { error: e.message }) }; }
    if (!urls.length) return { items: [], status: st(false, { error: 'sitemap 中没有匹配的 URL' }) };
    const key = 'sitemap|' + source.url + '|' + ((source.opts || {}).filter || '');
    const prev = pages[source.id];
    const items = []; let note;
    if (!prev || prev.key !== key) { pages[source.id] = { key, hash: hashLines(urls), lines: urls.slice(-3000), at: now, changedAt: 0 }; note = `已建立基线（${urls.length} 个页面），出现新页面时提醒`; }
    else {
      const old = new Set(prev.lines); const added = urls.filter((u) => !old.has(u));
      pages[source.id] = { key, hash: hashLines(urls), lines: urls.slice(-3000), at: now, changedAt: added.length ? now : prev.changedAt };
      for (const u of added.slice(0, 20)) {
        const t = titleFromUrl(u);
        items.push(mkItem(`${source.name.split(' · ')[0]} 新页面：${t}`, u, u, classifyOffer(t), { origin: 'Sitemap 新页面' }));
      }
      note = added.length ? `发现 ${added.length} 个新页面` : '无新页面';
    }
    return { items, status: st(true, { total: urls.length, matched: items.length, note }) };
  }
  // —— 网页变化监控（普通 / JS 渲染）——
  let body;
  try {
    if (isRender) {
      if (!renderText) return { items: [], status: st(false, { error: 'JS 渲染仅在桌面应用中可用（或已在设置中关闭）' }) };
      body = await renderText(source.url, { timeout: Math.max(30000, (Number(source.timeout) || 45) * 1000), wait: (source.opts || {}).wait, ua: source.ua });
    } else body = await withRetry(() => fetchText(source.url, reqOpts(source, meta)), retryDelay);
  } catch (e) { return { items: [], status: st(false, { error: e.message || String(e) }) }; }
  if (isBlocked(body)) return { items: [], status: st(false, { error: isRender ? '网站人机验证未能自动通过' : '网站启用了人机验证（反爬）——可改用「JS 渲染」协议' }) };
  let lines;
  // v2.9：无选择器 / 关键词时用正文抽取（去掉 Cookie 横幅、对话框、导航页眉页脚），并把相对时间等易变内容归一化
  try { lines = source.selector || source.keyword ? V29.cleanLines(extractLines(body, { selector: source.selector, keyword: source.keyword })) : V29.extractMain(body, extractLines); } catch (e) { return { items: [], status: st(false, { error: e.message }) }; }
  if (!lines.length) return { items: [], status: st(false, { error: '未从页面提取到文字（可能需要 JS 渲染，或关键词/选择器不匹配）' }) };
  const key = 'm29|' + (source.selector || '') + '|' + (source.keyword || '') + '|' + source.url; // v2.9 抽取方式变化：升级后静默重建基线
  const prev = pages[source.id];
  const hash = hashLines(lines);
  const items = [];
  let note = '';
  if (!prev || prev.key !== key) {
    pages[source.id] = { key, hash, lines, at: now, changedAt: 0, seen: [hash] };
    note = `已建立基线（${lines.length} 行），内容变化时提醒`;
  } else if (prev.hash !== hash) {
    const j = V29.judgeChange(prev.lines, lines, { sub: source.sub, seen: prev.seen || [], hash });
    // v2.6.1：JS 渲染页里混进的 CSS 类名 / Tailwind 选择器（如 [&>[data-slot=icon]]:shrink-0）不算内容变化
    const d = { added: j.added.filter((l) => !isCodeNoise(l)), removed: j.removed.filter((l) => !isCodeNoise(l)) };
    const alert = j.alert && (d.added.length || d.removed.length);
    pages[source.id] = { key, hash, lines, at: now, changedAt: alert ? now : prev.changedAt, seen: V29.remember(V29.remember(prev.seen || [], prev.hash), hash), quiet: alert ? 0 : (prev.quiet || 0) + 1 };
    if (alert) {
      const pd = j.priceDiff;
      const head = pd && (pd.added.length || pd.removed.length) ? `价格 ${pd.removed.slice(0, 3).join(' / ') || '—'} → ${pd.added.slice(0, 3).join(' / ') || '—'}` : pd && (pd.plansAdded.length || pd.plansRemoved.length) ? `套餐 ${pd.plansAdded.length ? '+' + pd.plansAdded.join(' / ') : ''}${pd.plansRemoved.length ? ' -' + pd.plansRemoved.join(' / ') : ''}` : (d.added[0] || ('移除：' + d.removed[0]));
      const types = classifyOffer(d.added.join('\n')).filter((t) => t !== 'event' || d.added.some((l) => /promo|limited|限时|活动/i.test(l)));
      if (source.sub === 'pricing' && !types.includes('pricing')) types.unshift('pricing');
      const title = `${source.name}有变化：${head.length > 70 ? head.slice(0, 70) + '…' : head}`;
      items.push(mkItem(title, source.url, diffSnippet(d).slice(0, 1200), types, { hash, origin: isRender ? 'JS 渲染页面监控' : '网页变化监控', more: { pageDiff: { added: d.added.length, removed: d.removed.length, reason: j.reason } } }));
      note = `检测到变化：+${d.added.length} / -${d.removed.length} 行`;
    } else note = j.alert ? '仅代码 / 样式噪声变化，已忽略' : V29.REASON_NOTE[j.reason] || '已忽略';
  } else {
    pages[source.id].at = now;
    note = (meta.cached ? '304 未修改' : '无变化') + (prev.changedAt ? `（上次变化 ${new Date(prev.changedAt).toLocaleString('zh-CN', { hour12: false })}）` : '');
  }
  return { items, status: st(true, { total: lines.length, matched: items.length, note }) };
}

// 厂商渠道 → 数据源（渠道随厂商启用）
const SUB_LABEL = { blog: '官方博客', changelog: '更新日志', pricing: '价格页', status: '状态公告', app: '应用商店', social: '官方社交', youtube: 'YouTube', github: 'GitHub', forum: '社区论坛', reddit: 'Reddit', news: '新闻搜索', other: '其它' };
function channelSource(brand, ch, ctx = {}) {
  const type = ch.type || 'rss';
  const zh = ch.region === 'cn' || /[\u3400-\u9fff]/.test(ch.keyword || '');
  let url = ch.url || '';
  try { if (!['page', 'render', 'sitemap'].includes(type)) url = requestUrl({ ...ch, type, keyword: ch.keyword || (type === 'search' ? brand.name : '') }, ctx); } catch { url = ch.url || ''; }
  return {
    id: `ch-${brand.id}-${ch.id}`, name: `${brand.name} · ${ch.name}`, platform: '厂商渠道', region: zh ? 'cn' : 'intl', country: SUB_LABEL[ch.sub] || '渠道',
    kind: STATEFUL.has(type) ? 'page' : 'vendor', type, vendor: brand.id, category: brand.category || 'ai', url, maxItems: ch.maxItems || (type === 'search' ? 60 : 0),
    selector: ch.selector || '', keyword: STATEFUL.has(type) ? (ch.keyword || '') : (ch.keyword || ''), sub: ch.sub || 'other', channel: true, brandId: brand.id, chId: ch.id,
    opts: ch.opts || {}, headers: ch.headers || '', ua: ch.ua || '', proxy: ch.proxy, timeout: ch.timeout || 0, include: ch.include || '', exclude: ch.exclude || '', regex: ch.regex || '',
    render: !!ch.render, interval: Number(ch.interval) || 0, flaky: !!ch.flaky,
    enabled: !!brand.enabled && ch.enabled !== false, preset: !!ch.preset,
  };
}
function channelSources(brands, ctx) { return brands.flatMap((b) => (b.channels || []).map((c) => channelSource(b, c, ctx))); }

async function fetchSource(source, allBrands, opts = {}) {
  if (source.kind === 'page') return fetchPage(source, allBrands, opts);
  const { fetchText: ft0 = defaultFetchText, renderText = null, now = Date.now(), retryDelay = 3000, searchGap = 250, ctx = {} } = opts;
  const meta = {};
  // 渠道开启「JS 渲染」时，HTML 列表等协议改走隐藏浏览器
  const fetchText = (url, o = {}) => (o.render ? (renderText ? renderText(url, o) : Promise.reject(new Error('JS 渲染仅在桌面应用中可用'))) : ft0(url, { ...reqOpts(source, meta), ...o, meta }));
  // 品牌/厂商只和同分类的数据源匹配（AI 厂商 ↔ AI 源，实物品牌 ↔ 实物源）；未标分类的视为通用
  const cat = source.category || 'goods';
  const brands = allBrands.filter((b) => !b.category || !source.category || b.category === cat);
  const compiled = brands.map(compileBrand);
  let skipRe = null; try { skipRe = source.skip ? new RegExp(source.skip, 'i') : null; } catch { /* 忽略无效正则 */ }
  const reqs = expandRequests(source, brands);
  const t0 = Date.now();
  let total = 0; const errors = []; const results = [];
  for (const r of reqs) {
    try {
      const load = async () => {
        // 多协议渠道（JSON / HTML / Discourse / Bluesky / Telegram / App Store …）走采集适配器
        if (source.type && source.type !== 'rss' && !(source.kind === 'search' && !source.channel)) {
          const c = await collect({ ...source, url: source.type === 'search' || source.type === 'youtube' || source.type === 'producthunt' ? r.url : source.url }, { fetchText, ctx });
          return { items: c.items };
        }
        const body = await fetchText(r.url);
        const f = source.format === 'cheapshark' ? parseCheapShark(body) : source.format === 'hn' ? parseHN(body) : parseFeed(body);
        if (source.include || source.exclude || source.regex) f.items = require('./collectors').filterItems(f.items, source);
        if (source.maxItems && f.items.length > source.maxItems) f.items = f.items.slice(0, source.maxItems);
        return f;
      };
      // 429 限流 / 5xx / 连接重置 / 偶发反爬页：等待后重试一次（超时不重试，避免拖慢整轮）
      const feed = await withRetry(load, retryDelay);
      if (reqs.length > 1) await sleep(searchGap);
      total += feed.items.length;
      for (const it of feed.items) {
        if (skipRe && skipRe.test(it.title)) continue; // 数据源级过滤（如 V2EX 的求购帖）
        // 只用标题 + 分类匹配品牌（摘要噪声太大，容易误报）
        let brandIds = matchBrands(it.title + ' ' + (it.categories || []).join(' '), compiled);
        let offerTypes = [];
        if (cat === 'ai') {
          // AI/软件：识别优惠类型。官方源全部保留（无优惠的作为「厂商资讯」，默认隐藏）；其它源必须是优惠
          offerTypes = classifyOffer(it.title);
          brandIds = matchBrands(it.title, compiled);
          if (source.kind === 'vendor') {
            if (source.vendor && !brandIds.includes(source.vendor) && brands.some((b) => b.id === source.vendor)) brandIds.unshift(source.vendor);
            // 论坛/Reddit/GitHub 发布等渠道的正文噪声大，只按标题识别；状态公告永远不算优惠
            if (!offerTypes.length && !['forum', 'reddit', 'github', 'status', 'youtube', 'app', 'social'].includes(source.sub)) offerTypes = classifyOffer(it.title + ' ' + (it.summary || '').slice(0, 200)).filter((t) => t !== 'event' && t !== 'plan' && t !== 'discount' && t !== 'startup');
            if (source.sub === 'status' || source.sub === 'app' || source.sub === 'github') offerTypes = source.sub === 'app' ? offerTypes.filter((t) => t !== 'plan') : [];
            if (source.sub !== 'pricing' && HARDWARE_RE.test(it.title)) offerTypes = [];
            offerTypes = applyFeedback(it.title, refineOffer(it.title, offerTypes, { sub: source.sub, kind: source.kind, hideResellers: !!(opts.feedback && opts.feedback.hideResellers), aiClass: it.aiClass }), source.id, opts.feedback);
          } else {
            if (source.kind === 'search' && r.brandId && !brandIds.includes(r.brandId)) continue;
            // 实物硬件（带 Copilot 键的键盘、AI PC 等）与多条新闻拼接的汇总标题不属于软件优惠
            if (HARDWARE_RE.test(it.title) || (it.title.match(/[；;|｜]/g) || []).length >= 2) continue;
            // 社区里的提问帖（「怎么免费用 Claude？」）不是优惠
            if (/[?？]\s*$/.test(it.title.trim()) || /^(how|where|what|why|is|are|can|does|any|anyone)\b.*\b(free|discount|cheap)/i.test(it.title)) continue;
            if (source.kind === 'search' && !offerTypes.length) offerTypes = classifyOffer(it.title + ' ' + (it.summary || '').slice(0, 300)).filter((t) => t !== 'event' && t !== 'plan');
            offerTypes = applyFeedback(it.title, refineOffer(it.title, offerTypes, { sub: source.sub, kind: source.kind, hideResellers: !!(opts.feedback && opts.feedback.hideResellers), aiClass: it.aiClass }), source.id, opts.feedback);
            if (!isOffer(offerTypes)) continue;
          }
        } else if (source.kind === 'search') {
          // 实物搜索结果：标题必须包含品牌，且标题/摘要具备优惠特征
          brandIds = matchBrands(it.title, compiled);
          if (r.brandId && !brandIds.includes(r.brandId)) continue;
          if (!isDealText(it.title + ' ' + it.summary, true)) continue;
        } else if (source.kind === 'news') {
          if (!isDealText(it.title, true)) continue;
        }
        if (brandIds.length === 0) continue;
        if (cat === 'goods' && !offerTypes.length) offerTypes = ['discount'];
        const link = normLink(it.link);
        // Pepper 系（mydealz/Dealabs/HotUKDeals…）标题前缀「123° - 」是热度值，拆出来单独显示
        let title = it.title; let heat = 0;
        const hm = title.match(/^(-?\d{1,5})°\s*[-–—]\s*/);
        if (hm) { heat = Number(hm[1]); title = title.slice(hm[0].length); }
        results.push({
          id: hashId(link),
          titleKey: normTitle(title),
          title,
          heat,
          category: cat,
          offerTypes,
          link,
          summary: (it.summary || '').slice(0, 300),
          image: it.image || '',
          price: it.price || extractPrice(title) || (source.kind === 'deal' ? extractPrice(it.summary.slice(0, 40)) : ''),
          discount: it.discount || extractDiscount(it.title + ' ' + it.summary),
          published: it.published || now,
          fetchedAt: now,
          brandIds,
          sourceId: source.id,
          sourceName: source.name,
          platform: source.platform,
          region: source.region,
          origin: it.source || '',
          sub: source.sub || '',
          read: false,
          fav: false,
        });
      }
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }
  const ok = errors.length < reqs.length;
  return {
    items: results,
    status: {
      ok,
      lastRun: now,
      ms: Date.now() - t0,
      total,
      matched: results.length,
      requests: reqs.length,
      error: errors.length ? (reqs.length > 1 ? `${errors.length}/${reqs.length} 个请求失败：` : '') + [...new Set(errors)].slice(0, 2).join('；') : '',
      retryAt: meta.retryAt || 0, httpStatus: meta.httpStatus || 0,
      cached: !!meta.cached, note: meta.cached ? '304 未修改（条件请求缓存命中）' : '',
    },
  };
}

/**
 * 合并新抓取的条目到已有列表，返回真正新增的条目
 * 跨渠道去重：同一规范化链接，或 3 天内标题相似度 ≥ 0.82 的条目合并为一条，记录「N 个来源」
 */
const { similarity, bigrams } = require('./dedupe');
const { findDup, indexOf, sameStory } = require('./cluster');
function mergeDeals(existing, incoming, opts = {}) {
  const { maxDeals = 3000, maxAgeDays = 30, now = Date.now(), dedupe = true } = opts;
  const byId = new Map(existing.map((d) => [d.id, d]));
  const byTitle = new Map(existing.map((d) => [d.titleKey + '|' + d.sourceId, d]));
  // 7 天窗口，便于跨语言报道陆续到达时合并
  const recent = dedupe ? existing.filter((d) => d.title && (d.fetchedAt || 0) > now - 7 * 86400000 && !d.pageDiff).map((d) => indexOf(d)) : [];
  const added = [];
  const addSource = (dup, it) => {
    dup.sources = dup.sources || [{ id: dup.sourceId, name: dup.sourceName, link: dup.link, outlet: /news\.google\./.test(dup.link || '') ? V29.outletOf(dup.title) : '' }];
    if (!dup.sources.some((x) => x.id === it.sourceId && (x.link === it.link || !it.link))) dup.sources.push({ id: it.sourceId, name: it.sourceName, link: it.link, outlet: /news\.google\./.test(it.link || '') ? V29.outletOf(it.title) : '' });
    if (it.lang && dup.lang && it.lang !== dup.lang) dup.langs = [...new Set([...(dup.langs || [dup.lang]), it.lang, dup.lang])];
  };
  for (const it of incoming) {
    let dup = byId.get(it.id) || byTitle.get(it.titleKey + '|' + it.sourceId);
    let cross = false;
    if (!dup && dedupe && !it.pageDiff && String(it.title || '').length >= 12) {
      dup = findDup(it, recent);
      if (dup) cross = true;
    }
    if (dup) {
      for (const b of it.brandIds) if (!dup.brandIds.includes(b)) dup.brandIds.push(b);
      if (it.heat) dup.heat = it.heat;
      if (!dup.price && it.price) dup.price = it.price;
      if (dup.feedback !== 'noise') for (const t of it.offerTypes || []) { dup.offerTypes = dup.offerTypes || []; if (!dup.offerTypes.includes(t)) dup.offerTypes.push(t); }
      if (dup.sourceId !== it.sourceId || cross) addSource(dup, it);
      dup.score = scoreDeal(dup);
      if (opts.onUpdate) opts.onUpdate(dup);
      continue;
    }
    it.score = scoreDeal(it);
    byId.set(it.id, it); byTitle.set(it.titleKey + '|' + it.sourceId, it);
    if (dedupe && !it.pageDiff && it.title) recent.push(indexOf(it));
    added.push(it);
  }
  const cutoff = now - maxAgeDays * 86400000;
  let all = [...byId.values()].filter((d) => d.fav || d.status === 'claimed' || (d.fetchedAt || 0) >= cutoff);
  all.sort((a, b) => (b.published || 0) - (a.published || 0));
  if (all.length > maxDeals) {
    const keep = (d) => d.fav || d.status === 'claimed';
    const favs = all.filter(keep);
    const rest = all.filter((d) => !keep(d)).slice(0, Math.max(0, maxDeals - favs.length));
    all = [...favs, ...rest].sort((a, b) => (b.published || 0) - (a.published || 0));
  }
  return { all, added };
}

function hostOf(url) { try { return new URL(url.replace('{q}', 'x')).hostname.replace(/^www\./, ''); } catch { return url; } }

// 退避：连续失败 n 次（n≥2）后，跳过 min(2^(n-1) × 基础周期, 6 小时)
function backoffUntil(status, baseMin = 15) {
  if (!status || status.ok || !status.failStreak || status.failStreak < 2) return 0;
  return (status.lastRun || 0) + Math.min(6 * 60, Math.pow(2, status.failStreak - 1) * baseMin) * 60000;
}
// 是否应在本轮跳过：渠道自定义周期未到，或处于失败退避期
function skipReason(s, status, { now = Date.now(), force = false, backoff = true, baseMin = 15, adaptive = false, adaptiveMax = 360 } = {}) {
  if (!status) return '';
  if (status.retryAt > now) return 'Server Retry-After: ' + new Date(status.retryAt).toISOString();
  if (force) return '';
  // v2.7：自适应轮询——按该渠道的历史变化频率（Cho & Garcia-Molina 估计）拉长检查间隔
  if (adaptive && !s.interval) { const iv = require('./v27').adaptiveSkip(status, { now, base: baseMin, max: adaptiveMax, id: s.id }); if (iv) return `按变化频率（约每 ${iv} 分钟检查一次）跳过`; }
  if (s.interval && status.ok && now - (status.lastRun || 0) < s.interval * 60000 - 30000) return `按渠道周期（${s.interval} 分钟）跳过`;
  if (backoff) { const u = backoffUntil(status, baseMin); if (u > now) return `连续失败 ${status.failStreak} 次，退避至 ${new Date(u).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}`; }
  return '';
}

// 同一站点的数据源串行抓取（间隔 hostGap 毫秒），避免触发限流；不同站点并行（concurrency）
async function runAll(sources, brands, opts = {}) {
  const status = opts.status || {};
  const skipped = [];
  const active = sources.filter((s) => {
    if (!s.enabled) return false;
    const why = skipReason(s, status[s.id], { force: opts.force, backoff: opts.backoff !== false, baseMin: opts.baseMin, adaptive: !!opts.adaptive, adaptiveMax: opts.adaptiveMax || 360 });
    if (why) { skipped.push({ source: s, why }); return false; }
    return true;
  });
  const groups = new Map();
  active.forEach((s, i) => { const h = s.type === 'render' ? 'render:' + i : hostOf(s.url); if (!groups.has(h)) groups.set(h, []); groups.get(h).push(i); });
  const results = new Array(active.length);
  const hostGap = opts.hostGap ?? 1500;
  // 对匿名访问限流严格的站点额外放慢（Reddit 匿名 RSS 约 10 次/分钟）
  const SLOW_HOSTS = { 'reddit.com': 12000, 'www.reddit.com': 12000, 'old.reddit.com': 12000 };
  // v2.2：面向程序访问的公开 API / 搜索 RSS（单次请求轻量、限额宽松），同站请求间隔缩短，避免几十个厂商的新闻搜索排长队
  const FAST_HOSTS = { 'news.google.com': 400, 'hn.algolia.com': 250, 'itunes.apple.com': 300, 'www.youtube.com': 300, 'youtube.com': 300, 'play.google.com': 600, 'www.bing.com': 600, 'github.com': 600, 'api.github.com': 600 };
  const gapFor = (u) => { const h = hostOf(u); return SLOW_HOSTS[h] || Math.min(hostGap, FAST_HOSTS[h] ?? hostGap); };
  // 队列最长的站点先开始（LPT 调度），缩短整轮耗时
  const queues = [...groups.values()].sort((a, b) => b.length - a.length);
  await pLimit(queues.map((idxs) => async () => {
    for (let k = 0; k < idxs.length; k++) {
      if (k > 0) await sleep(gapFor(active[idxs[k]].url));
      const i = idxs[k];
      try { results[i] = await fetchSource(active[i], brands, opts); } catch (e) {
        results[i] = { items: [], status: { ok: false, lastRun: Date.now(), ms: 0, total: 0, matched: 0, requests: 1, error: e.message } };
      }
      if (opts.onResult) { try { opts.onResult(active[i], results[i]); } catch { /* 回调异常不影响抓取 */ } }
    }
  }), opts.concurrency || 6);
  const out = active.map((s, i) => ({ source: s, ...results[i] }));
  out.skipped = skipped;
  return out;
}

function toCSV(deals, brandName) {
  const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['标题', '厂商/品牌', '优惠类型', '价格', '折扣', '平台', '数据源', '发布时间', '链接', '已读', '收藏'];
  const rows = deals.map((d) => [
    d.title, d.brandIds.map(brandName).join('/'), (d.offerTypes || []).map((t) => OFFER_LABELS[t] || t).join('/') || (d.category === 'ai' ? '厂商资讯' : ''), d.price, d.discount, d.platform, d.sourceName,
    d.published ? new Date(d.published).toLocaleString('zh-CN', { hour12: false }) : '', d.link, d.read ? '是' : '否', d.fav ? '是' : '否',
  ]);
  return '\ufeff' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}


/** 判断一行是否是混入页面文字的样式 / 代码噪声（Tailwind 选择器、CSS 规则等） */
function isCodeNoise(line) {
  const t = String(line || '').trim(); if (!t) return true;
  if (/\[&|\]:|data-slot=|\{[^}]*:[^}]*;|^[.#][\w-]+\s*\{/.test(t)) return true;
  const tk = t.split(/\s+/); if (tk.length >= 3 && tk.every((x) => /^[\w:.\[\]\/#%&>=()!-]+$/.test(x) && /[a-z]-[a-z0-9\[]|^[a-z]{1,4}:/i.test(x))) return true;
  const sym = (t.match(/[\[\]{}<>:;=&_\\/|-]/g) || []).length;
  return t.length >= 12 && sym / t.length > 0.25 && !/[\u4e00-\u9fff]/.test(t) && !/\b[a-z]{3,}\s+[a-z]{3,}\s+[a-z]{3,}\b/i.test(t);
}

module.exports = { isCodeNoise, backoffUntil, skipReason, channelSource, channelSources, SUB_LABEL, fetchPage, hostOf, fetchSource, mergeDeals, runAll, expandRequests, defaultFetchText, normLink, toCSV, hashId, UA };
