'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/core/collectors');
const { canonicalUrl, similarity, scoreDeal } = require('../src/core/dedupe');
const { applyRules, normalizeRule } = require('../src/core/rules');
const { toOPML, parseOPML } = require('../src/core/opml');
const { normalizeChannel } = require('../src/core/store');
const { backoffUntil, skipReason, mergeDeals } = require('../src/core/monitor');
const { HttpCache, makeFetchText } = require('../src/core/http');
const D = require('../src/core/defaults');

test('协议：请求地址构造', () => {
  assert.strictEqual(C.requestUrl({ type: 'github', opts: { repo: 'openai/openai-python' } }), 'https://github.com/openai/openai-python/releases.atom');
  assert.match(C.requestUrl({ type: 'github', opts: { repo: 'a/b', api: true, what: 'tags' } }), /api\.github\.com\/repos\/a\/b\/tags/);
  assert.throws(() => C.requestUrl({ type: 'github', opts: { repo: 'bad' } }));
  assert.match(C.requestUrl({ type: 'hn', opts: { query: 'ChatGPT', minPoints: 50 } }), /query=ChatGPT&numericFilters=points>=50/);
  assert.match(C.requestUrl({ type: 'reddit', opts: { sub: 'r/OpenAI', query: 'free' } }), /r\/OpenAI\/search\.rss\?q=free/);
  assert.strictEqual(C.requestUrl({ type: 'telegram', opts: { channel: '@durov' } }), 'https://t.me/s/durov');
  assert.match(C.requestUrl({ type: 'bluesky', opts: { handle: 'github.com' } }), /getAuthorFeed\?actor=github\.com/);
  assert.strictEqual(C.requestUrl({ type: 'discourse', url: 'https://community.openai.com/latest' }), 'https://community.openai.com/latest.json');
  assert.match(C.requestUrl({ type: 'appstore', opts: { appId: '6448311069' } }), /itunes\.apple\.com\/lookup\?id=6448311069&country=us/);
  assert.throws(() => C.requestUrl({ type: 'rsshub', opts: { route: '/x' } }, {}), /RSSHub/);
  assert.strictEqual(C.requestUrl({ type: 'rsshub', opts: { route: '/github/release/a/b' } }, { rsshubBase: 'https://rsshub.app/' }), 'https://rsshub.app/github/release/a/b');
  assert.match(C.requestUrl({ type: 'search', keyword: '豆包 优惠' }), /hl=zh-CN/);
  assert.match(C.requestUrl({ type: 'search', keyword: 'ChatGPT', opts: { engine: 'bing' } }), /bing\.com\/news\/search.*format=rss/);
});

test('协议：JSON API / HTML / JSON Feed / App Store / Bluesky 解析', async () => {
  const json = JSON.stringify({ data: { list: [{ name: 'GPT 半价', path: '/p/1', at: '2026-10-01T00:00:00Z' }] } });
  const it = C.parseJsonApi(json, { opts: { itemsPath: '$.data.list', titleField: 'name', linkField: 'path', dateField: 'at' } }, 'https://x.com/api');
  assert.strictEqual(it[0].title, 'GPT 半价'); assert.strictEqual(it[0].link, 'https://x.com/p/1'); assert.ok(it[0].published > 0);
  assert.throws(() => C.parseJsonApi(json, { opts: { itemsPath: 'data' } }), /数组/);
  const html = '<ul><li class="i"><a href="/a">Claude 免费试用</a><time datetime="2026-10-02">x</time></li><li class="i"><a href="https://b.com/b">B</a></li></ul>';
  const h = C.parseHtmlList(html, { opts: { list: 'li.i' } }, 'https://s.com/news');
  assert.strictEqual(h.length, 2); assert.strictEqual(h[0].link, 'https://s.com/a'); assert.ok(h[0].published);
  assert.throws(() => C.parseHtmlList(html, { opts: { list: '.none' } }), /未匹配/);
  const jf = C.parseJsonFeed(JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', items: [{ id: '1', url: 'https://e.com/1', title: 'T', date_published: '2026-10-01T00:00:00Z' }] }));
  assert.strictEqual(jf[0].title, 'T');
  const as = C.parseAppStore(JSON.stringify({ results: [{ trackId: 1, trackName: 'ChatGPT', version: '1.2', trackViewUrl: 'https://apps.apple.com/app/id1?uo=4', releaseNotes: 'fix', currentVersionReleaseDate: '2026-10-01T00:00:00Z' }] }));
  assert.match(as[0].title, /ChatGPT iOS 版更新 1\.2/); assert.ok(!as[0].link.includes('uo=4'));
  const bs = C.parseBluesky(JSON.stringify({ feed: [{ post: { uri: 'at://did/app.bsky.feed.post/k1', author: { handle: 'github.com' }, record: { text: 'Copilot Free is here', createdAt: '2026-10-01T00:00:00Z' } } }, { reason: {}, post: { uri: 'x', author: {}, record: { text: 'repost' } } }] }), { opts: { handle: 'github.com' } });
  assert.strictEqual(bs.length, 1); assert.strictEqual(bs[0].link, 'https://bsky.app/profile/github.com/post/k1');
  // collect + 过滤
  const rss = '<rss><channel><item><title>ChatGPT Plus 50% off</title><link>https://a.com/1</link></item><item><title>ChatGPT outage</title><link>https://a.com/2</link></item></channel></rss>';
  const r = await C.collect({ type: 'rss', url: 'https://a.com/feed', include: 'off', exclude: 'outage' }, { fetchText: async () => rss });
  assert.deepStrictEqual((r.items || r).map((x) => x.link), ['https://a.com/1']);
  assert.throws(() => C.filterItems([], { regex: '(' }), /正则/);
});

test('去重：规范化链接与相似度、重要度评分', () => {
  assert.strictEqual(canonicalUrl('http://www.example.com/a/?utm_source=x&id=2#top'), canonicalUrl('https://example.com/a?id=2'));
  assert.ok(similarity('OpenAI cuts GPT-5 API prices by 50%', 'OpenAI cuts GPT-5 API prices 50%') > 0.82);
  assert.ok(similarity('Claude Pro free for students', 'Gemini Ultra price hike') < 0.4);
  const a = scoreDeal({ title: 'ChatGPT Plus free for students', offerTypes: ['free', 'student'], sources: [1, 2, 3], kind: 'vendor', sub: 'blog' });
  const b = scoreDeal({ title: 'some news', offerTypes: [], kind: 'agg' });
  assert.ok(a > b && a <= 100 && b >= 0);
});

test('合并：跨来源相似标题合并为「N 个来源」', () => {
  const now = Date.now();
  const mk = (id, t, src) => ({ id, title: t, link: 'https://' + src + '.com/' + id, sourceId: src, sourceName: src, brandIds: ['openai'], category: 'ai', offerTypes: ['price'], firstSeen: now, fetchedAt: now, published: now });
  const out = mergeDeals([], [mk('1', 'OpenAI cuts GPT-5 API prices by 50%', 'a'), mk('2', 'OpenAI cuts GPT-5 API prices by 50 %', 'b'), mk('3', 'Totally different headline here', 'c')], { dedupe: true });
  const list = out.all;
  assert.strictEqual(list.length, 2);
  const merged = list.find((d) => (d.sources || []).length > 1);
  assert.ok(merged && merged.sources.length === 2);
});

test('提醒规则：厂商 / 类型 / 关键词 / 高亮 / 声音', () => {
  const d1 = { title: 'Gemini 学生免费一年', brandIds: ['gemini'], category: 'ai', offerTypes: ['free', 'student'], score: 80 };
  const d2 = { title: 'Claude 新功能', brandIds: ['anthropic'], category: 'ai', offerTypes: [], score: 20 };
  const rules = [normalizeRule({ name: '学生', types: ['student'], sound: true, highlight: '#22c55e' }), { name: '关', enabled: false }, { name: 'x', vendors: ['anthropic'], exclude: '新功能' }];
  const r = applyRules(rules, [d1, d2]);
  assert.deepStrictEqual(r.notify, [d1]); assert.strictEqual(r.sound, true); assert.strictEqual(d1.hl, '#22c55e'); assert.ok(!d2.rules);
  assert.strictEqual(applyRules(D.DEFAULT_RULES, [{ ...d1 }]).notify.length, 1);
});

test('OPML：导出再导入往返一致', () => {
  const x = toOPML([{ title: 'OpenAI & 朋友', items: [{ title: 'Blog <News>', xmlUrl: 'https://openai.com/news/rss.xml', htmlUrl: 'https://openai.com' }] }, { title: '空', items: [] }]);
  const back = parseOPML(x);
  assert.deepStrictEqual(back, [{ title: 'Blog <News>', xmlUrl: 'https://openai.com/news/rss.xml', htmlUrl: 'https://openai.com', group: 'OpenAI & 朋友' }]);
  assert.throws(() => parseOPML('<html/>'), /OPML/);
});

test('渠道校验：按协议检查必填项', () => {
  assert.throws(() => normalizeChannel({ type: 'rss', url: 'ftp://x' }), /http/);
  assert.throws(() => normalizeChannel({ type: 'github', opts: {} }), /repo/);
  assert.throws(() => normalizeChannel({ type: 'mastodon', opts: {} }), /Mastodon/);
  assert.throws(() => normalizeChannel({ type: 'rss', url: 'https://a.com', regex: '(' }), /正则/);
  const c = normalizeChannel({ type: 'appstore', opts: { appId: '1', empty: '' }, interval: 99999, proxy: false });
  assert.strictEqual(c.sub, 'app'); assert.strictEqual(c.interval, 1440); assert.strictEqual(c.proxy, false); assert.ok(!('empty' in c.opts));
  assert.strictEqual(normalizeChannel({ type: 'json', url: 'https://a.com/api' }).type, 'json');
  assert.strictEqual(normalizeChannel({ type: 'nope', url: 'https://a.com/f' }).type, 'rss');
});

test('退避与按周期跳过', () => {
  const now = Date.now();
  assert.strictEqual(backoffUntil({ ok: false, failStreak: 1, lastRun: now }), 0);
  assert.strictEqual(backoffUntil({ ok: false, failStreak: 3, lastRun: now }, 15), now + 60 * 60000);
  assert.strictEqual(backoffUntil({ ok: false, failStreak: 20, lastRun: now }, 15), now + 360 * 60000);
  assert.match(skipReason({}, { ok: false, failStreak: 3, lastRun: now }, { now }), /退避/);
  assert.strictEqual(skipReason({}, { ok: false, failStreak: 3, lastRun: now }, { now, force: true }), '');
  assert.match(skipReason({ interval: 60 }, { ok: true, lastRun: now - 10 * 60000 }, { now }), /周期/);
});

test('HTTP 缓存：ETag 条件请求与 304', async () => {
  const cache = new HttpCache(); let calls = 0; let sentIfNone = null;
  const raw = async (url, o) => { calls++; sentIfNone = (o.headers || {})['If-None-Match'] || null; return calls === 1 ? { status: 200, ok: true, headers: { get: (k) => (k.toLowerCase() === 'etag' ? '"v1"' : null) }, text: async () => 'BODY' } : { status: 304, ok: false, headers: { get: () => null }, text: async () => '' }; };
  const f = makeFetchText(raw, { cache });
  assert.strictEqual(await f('https://a.com/x', {}), 'BODY');
  const meta = {}; assert.strictEqual(await f('https://a.com/x', { meta }), 'BODY');
  assert.strictEqual(sentIfNone, '"v1"');
});

test('预置源：主流厂商、无冷门、协议合法', () => {
  const ids = D.PRESET_BRANDS.map((b) => b.id);
  for (const bad of ['lovable', 'bolt', 'poe', 'openrouter', 'groq', 'windsurf', 'replit']) assert.ok(!ids.includes(bad), bad);
  for (const must of ['openai', 'anthropic', 'gemini', 'deepseek', 'kimi', 'qwen', 'doubao']) assert.ok(ids.includes(must), must);
  let n = 0;
  for (const [, chs] of Object.entries(D.VENDOR_CHANNELS)) for (const c of chs) { n++; assert.ok(C.PROTOCOLS[c.type || 'rss'], c.type); assert.ok(normalizeChannel(c)); }
  assert.ok(n >= 150, 'channels ' + n);
});
