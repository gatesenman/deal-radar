'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeLLM, extractJSON, redact, PROVIDERS } = require('../src/core/ai');
const D = require('../src/core/discover');
const { startMockLLM, MOCK_KEY } = require('../src/mock-llm');

test('AI：JSON 提取容错 / Key 脱敏 / 预置服务商', () => {
  assert.deepStrictEqual(extractJSON('好的：\n```json\n{"a":[1,{"b":"}"}]}\n```'), { a: [1, { b: '}' }] });
  assert.deepStrictEqual(extractJSON('result: {"x":1} done'), { x: 1 });
  assert.throws(() => extractJSON('no json here'));
  assert.strictEqual(redact('bad key sk-abcdef123456789 in Bearer sk-abcdef123456789', 'sk-abcdef123456789'), 'bad key *** in Bearer ***');
  assert.match(redact('token sk-zzzzzzzzzzzzzzzz leaked'), /sk-\*\*\*/);
  for (const k of ['deepseek', 'qwen', 'kimi', 'zhipu', 'doubao', 'openai', 'custom']) assert.ok(PROVIDERS[k], k);
});

test('AI：OpenAI 兼容客户端（本地模拟服务器）', async () => {
  const m = await startMockLLM(0);
  try {
    const ok = makeLLM({ baseUrl: m.baseUrl + '/', apiKey: MOCK_KEY, model: 'mock' });
    assert.strictEqual(await ok.chat([{ role: 'user', content: 'Reply with exactly OK' }]), 'OK');
    const j = await ok.json([{ role: 'user', content: 'Vendor the user typed: "Mistral".\n- mistral.ai: https://mistral.ai' }]);
    assert.deepStrictEqual(j.official_domains, ['mistral.ai']); assert.ok(j.aliases.includes('Le Chat'));
    const bad = makeLLM({ baseUrl: m.baseUrl, apiKey: 'sk-wrong-1234567890', model: 'mock' });
    await assert.rejects(bad.chat([{ role: 'user', content: 'x' }]), (e) => /401/.test(e.message) && /API Key/.test(e.message) && !e.message.includes('sk-wrong-1234567890'));
    const nf = makeLLM({ baseUrl: m.baseUrl.replace('/v1', '/nope'), apiKey: MOCK_KEY, model: 'mock' });
    await assert.rejects(nf.chat([{ role: 'user', content: 'x' }]), /404/);
    const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 20);
    await assert.rejects(ok.chat([{ role: 'user', content: 'Reply with exactly OK' }], { signal: ctrl.signal }), /已取消/);
    const slow = makeLLM({ baseUrl: m.baseUrl, apiKey: MOCK_KEY, model: 'mock', timeout: 30 });
    await assert.rejects(slow.chat([{ role: 'user', content: 'Reply with exactly OK' }]), /超时/);
    assert.throws(() => makeLLM({ baseUrl: 'ftp://x', model: 'm' }), /地址/);
  } finally { m.server.close(); }
});

// —— 离线夹具：模拟一个厂商官网 ——
const SITE = {
  'https://www.bing.com/search': '<li class="b_algo"><cite>https://acme.ai</cite></li><li><cite>https://en.wikipedia.org › wiki › Acme_AI</cite></li><li><cite>https://acme.ai › pricing</cite></li><li><cite>https://cooking.example.com › acme</cite></li>',
  'https://www.wikidata.org/': '{"search":[]}',
  'https://acme.ai/': `<html><head><title>Acme AI — assistant</title><meta name="description" content="Acme builds AI"><link rel="alternate" type="application/rss+xml" title="Acme Blog" href="/blog/rss.xml"></head><body>
    <a href="/pricing">Pricing</a><a href="/students">Students</a><a href="/blog">Blog</a><a href="/blog/some-long-post-title">A post</a><a href="/careers">Jobs</a>
    <a href="https://github.com/acme/acme-sdk">SDK</a><a href="https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv">YT</a><a href="https://bsky.app/profile/acme.ai">bsky</a>
    <a href="https://apps.apple.com/us/app/acme/id1234567890">iOS</a><a href="https://play.google.com/store/apps/details?id=ai.acme.app">Android</a><a href="https://community.acme.ai/">Forum</a><a href="https://status.acme.ai">Status</a></body></html>`,
  'https://acme.ai/sitemap.xml': '<?xml version="1.0"?><urlset><url><loc>https://acme.ai/news/a</loc></url></urlset>',
  'https://acme.ai/blog/rss.xml': '<rss><channel><title>Acme</title><item><title>Hi</title><link>https://acme.ai/blog/hi</link></item></channel></rss>',
  'https://acme.ai/blog': '<html><head><link rel="alternate" type="application/rss+xml" href="/blog/rss.xml"></head><body>blog</body></html>',
};
const fakeFetch = async (url) => {
  const k = Object.keys(SITE).find((p) => url === p || (p.endsWith('/search') || p.endsWith('wikidata.org/')) && url.startsWith(p));
  if (k) return SITE[k];
  if (/itunes\.apple\.com\/search/.test(url)) return '{"results":[]}';
  throw Object.assign(new Error('HTTP 404'), { status: 404 });
};

test('发现：搜索结果排序官网（仿冒 / 无关域名降权）', () => {
  const r = D.rankDomains('Mistral', ['https://www.foodnetwork.com/a', 'https://www.foodnetwork.com/b', 'https://mistral.ai', 'https://en.wikipedia.org/wiki/Mistral', 'https://mistral-ai-free.com'], null);
  assert.strictEqual(r[0].domain, 'mistral.ai');
  assert.ok(!r.some((x) => x.domain === 'wikipedia.org'));
  assert.deepStrictEqual(D.parseBingCites('<cite>https://kimi.com › en › pricing</cite><cite>platform.kimi.com › docs › …</cite>'), ['https://kimi.com/en/pricing', 'https://platform.kimi.com/docs']);
  assert.strictEqual(D.regDomain('www.bigmodel.com.cn'), 'bigmodel.com.cn');
});

test('发现：端到端（离线夹具，无 AI）→ 标准协议候选 + 实测 + 勾选', async () => {
  const steps = [];
  const r = await D.discoverVendor('Acme', { fetchText: fakeFetch, onStep: (s) => steps.push(s.id + ':' + s.state), testChannel: async (c) => ({ ok: c.type !== 'discourse', total: c.type === 'bluesky' ? 0 : 3, sample: ['x'] }) });
  assert.deepStrictEqual(r.vendor.domains, ['acme.ai']);
  const types = r.candidates.map((c) => c.type);
  for (const t of ['rss', 'sitemap', 'page', 'github', 'youtube', 'bluesky', 'appstore', 'gplay', 'discourse', 'search', 'hn']) assert.ok(types.includes(t), 'missing ' + t);
  assert.ok(r.candidates.some((c) => c.type === 'rss' && c.sub === 'status' && /status\.acme\.ai\/history\.rss/.test(c.url)));
  assert.ok(r.candidates.some((c) => c.type === 'page' && c.sub === 'pricing' && /\/students$/.test(c.url)));
  assert.ok(!r.candidates.some((c) => /careers|some-long-post/.test(c.url || '')), '不应收录招聘页或单篇文章');
  assert.ok(!r.candidates.find((c) => c.type === 'discourse').checked, '实测失败的不默认勾选');
  assert.ok(!r.candidates.find((c) => c.type === 'bluesky').checked, '0 条的不默认勾选');
  assert.ok(r.candidates.find((c) => c.type === 'github').checked);
  for (const c of r.candidates) assert.ok(require('../src/core/collectors').PROTOCOLS[c.type]);
  assert.ok(steps.includes('ai:skip') && steps.includes('test:ok'));
});

test('发现：AI 参与（模拟服务器）→ 别名 / 排除词 / 拒绝官网以外的 AI 建议；可取消', async () => {
  const m = await startMockLLM(0);
  try {
    const llm = makeLLM({ baseUrl: m.baseUrl, apiKey: MOCK_KEY, model: 'mock' });
    const r = await D.discoverVendor('Mistral', { fetchText: async (u) => fakeFetch(u.replace(/mistral/g, 'acme')).then((b) => b.replace(/acme/gi, 'mistral')), llm, testChannel: async () => ({ ok: true, total: 2, sample: [] }) });
    assert.ok(r.usedAI); assert.ok(r.vendor.aliases.includes('Le Chat')); assert.ok(r.vendor.exclude.includes('mistral wind'));
    assert.ok(!r.candidates.some((c) => /evil\.example/.test(c.url || '')));
    assert.ok(r.candidates.some((c) => c.name === '官方价格页'));
    const ctrl = new AbortController(); ctrl.abort();
    await assert.rejects(D.discoverVendor('Mistral', { fetchText: fakeFetch, llm, signal: ctrl.signal }), /已取消/);
  } finally { m.server.close(); }
});

test('AI 辅助添加渠道：URL / JSON / 列表页 / 平台链接 / 自然语言', async () => {
  const pages = {
    'https://x.com/feed': '<?xml version="1.0"?><rss><channel><title>X Feed</title></channel></rss>',
    'https://x.com/api/posts': JSON.stringify({ data: { posts: [{ name: 'A', permalink: '/a', created_at: '2026-01-01' }, { name: 'B', permalink: '/b', created_at: '2026-01-02' }] } }),
    'https://x.com/blog': '<html><head><title>Blog</title></head><body>' + Array.from({ length: 6 }, (_, i) => `<p>some text paragraph number ${i} with enough words to be a line</p><a href="/blog/post-${i}">A rather long post title number ${i}</a>`).join('') + '</body></html>',
    'https://x.com/pricing': '<html><head><title>Pricing</title><link rel="alternate" type="application/rss+xml" href="/feed"></head><body><main>' + Array.from({ length: 8 }, (_, i) => `<p>Plan ${i}: $${20 + i} per month billed monthly, includes feature set ${i}</p>`).join('') + '</main></body></html>',
    'https://x.com/app': '<html><head><title>App</title></head><body><div id="root"></div></body></html>',
  };
  const ft = async (u) => { if (pages[u]) return pages[u]; throw Object.assign(new Error('HTTP 403'), { status: 403 }); };
  assert.strictEqual((await D.discoverChannel('https://x.com/feed', { fetchText: ft })).channel.type, 'rss');
  const j = (await D.discoverChannel('看看 https://x.com/api/posts 这个接口', { fetchText: ft })).channel;
  assert.strictEqual(j.type, 'json'); assert.strictEqual(j.opts.itemsPath, '$.data.posts'); assert.strictEqual(j.opts.titleField, 'name'); assert.strictEqual(j.opts.linkField, 'permalink');
  const h = (await D.discoverChannel('https://x.com/blog', { fetchText: ft })).channel;
  assert.strictEqual(h.type, 'html'); assert.strictEqual(h.opts.list, 'a[href*="/blog/"]');
  const p = (await D.discoverChannel('https://x.com/pricing', { fetchText: ft })).channel;
  assert.strictEqual(p.type, 'page'); assert.strictEqual(p.sub, 'pricing'); assert.strictEqual(p.selector, 'main');
  assert.strictEqual((await D.discoverChannel('https://x.com/app', { fetchText: ft })).channel.type, 'render');
  assert.strictEqual((await D.discoverChannel('https://x.com/blocked', { fetchText: ft })).channel.type, 'render');
  assert.deepStrictEqual((await D.discoverChannel('https://github.com/openai/codex/releases', { fetchText: ft })).channel.opts, { repo: 'openai/codex', what: 'releases' });
  assert.strictEqual((await D.discoverChannel('https://apps.apple.com/cn/app/kimi/id6474233312', { fetchText: ft })).channel.opts.country, 'cn');
  // 自然语言 + 厂商已有渠道 → 在官网找价格页
  const brand = { name: 'X', channels: [{ url: 'https://x.com/feed' }] };
  const nl = await D.discoverChannel('X 的定价页改价提醒', { fetchText: ft, brand });
  assert.strictEqual(nl.channel.type, 'page'); assert.strictEqual(nl.channel.url, 'https://x.com/pricing');
  const fallback = await D.discoverChannel('监控一下某某公司的新闻', { fetchText: ft });
  assert.strictEqual(fallback.channel.type, 'search'); assert.ok(fallback.warn);
  // 自然语言 + AI
  const m = await startMockLLM(0);
  try {
    const llm = makeLLM({ baseUrl: m.baseUrl, apiKey: MOCK_KEY, model: 'mock' });
    const ft2 = async (u) => (u === 'https://claude.com/pricing' ? pages['https://x.com/pricing'] : ft(u));
    const r = await D.discoverChannel('Claude 的定价页改价提醒', { fetchText: ft2, llm });
    assert.ok(r.usedAI); assert.strictEqual(r.channel.type, 'page'); assert.strictEqual(r.channel.url, 'https://claude.com/pricing');
  } finally { m.server.close(); }
});
