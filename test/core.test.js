'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { parseFeed, parseCheapShark, parseHN } = require('../src/core/feed');
const { classifyOffer, isOffer } = require('../src/core/offers');
const { compileBrand, matchBrands, isDealText, extractPrice, extractDiscount, searchTerm } = require('../src/core/matcher');
const { fetchSource, mergeDeals, runAll, toCSV, expandRequests, normLink } = require('../src/core/monitor');
const { Store } = require('../src/core/store');
const { PRESET_SOURCES, PRESET_BRANDS, DEFAULT_ENABLED } = require('../src/core/defaults');

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>T</title>
<item><title>Apple AirPods Pro 2 $169 &amp; free shipping</title><link>https://ex.com/a?utm_source=x</link><guid>1</guid><pubDate>Mon, 12 Oct 2026 01:00:00 GMT</pubDate><description><![CDATA[<p>Great <b>deal</b><img src="https://img/a.jpg"></p>]]></description></item>
<item><title>Caramel Apple Pops $5</title><link>https://ex.com/b</link></item>
<item><title>Nike Air Max 40% off</title><link>https://ex.com/c</link><media:content url="https://img/c.jpg" medium="image"/></item>
<item><title>Random TV</title><link>https://ex.com/d</link></item>
</channel></rss>`;
const ATOM = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>R</title>
<entry><title>[Monitor] Samsung Odyssey G7 - $299</title><link href="https://reddit.com/x"/><id>t3_1</id><updated>2026-10-11T10:00:00Z</updated><category term="buildapcsales"/><content type="html">&lt;p&gt;&lt;img src=&quot;https://i/x.png&quot;&gt;&amp;amp; more&lt;/p&gt;</content></entry>
</feed>`;
const RDF = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"><channel><title>S</title></channel><item><title>小米 15 直降 500 元</title><link>https://s/1</link></item></rdf:RDF>`;

const brands = [
  { id: 'apple', name: 'Apple', aliases: ['iPhone', 'AirPods', '苹果'], exclude: ['caramel apple'] },
  { id: 'nike', name: 'Nike', aliases: ['耐克'], exclude: [] },
  { id: 'samsung', name: 'Samsung', aliases: ['Galaxy', '三星'], exclude: [] },
  { id: 'xiaomi', name: 'Xiaomi', aliases: ['小米', 'Redmi'], exclude: [] },
];

test('parse RSS 2.0 with CDATA, entities, images', () => {
  const f = parseFeed(RSS);
  assert.equal(f.items.length, 4);
  assert.equal(f.items[0].title, 'Apple AirPods Pro 2 $169 & free shipping');
  assert.equal(f.items[0].image, 'https://img/a.jpg');
  assert.match(f.items[0].summary, /Great deal/);
  assert.equal(f.items[2].image, 'https://img/c.jpg');
  assert.ok(f.items[0].published > 0);
});
test('parse Atom with escaped HTML content', () => {
  const f = parseFeed(ATOM);
  assert.equal(f.items[0].link, 'https://reddit.com/x');
  assert.equal(f.items[0].image, 'https://i/x.png');
  assert.deepEqual(f.items[0].categories, ['buildapcsales']);
});
test('parse RDF / RSS 1.0', () => { assert.equal(parseFeed(RDF).items[0].title, '小米 15 直降 500 元'); });
test('HTML / anti-bot pages are rejected with clear errors', () => {
  assert.throws(() => parseFeed('<!DOCTYPE html><html><body>x</body></html>'), /网页/);
  assert.throws(() => parseFeed('   <script>var seqid="x"</script>'), /反爬/);
});
test('CheapShark JSON', () => {
  const f = parseCheapShark([{ dealID: 'a', title: 'Game', salePrice: '4.99', normalPrice: '19.99', savings: '75.03', thumb: 't', lastChange: 1760000000 }]);
  assert.equal(f.items[0].discount, '75% OFF'); assert.equal(f.items[0].price, '$4.99');
});

test('brand matching: word boundaries, CJK, excludes', () => {
  const c = brands.map(compileBrand);
  assert.deepEqual(matchBrands('New iPhone 17 deal', c), ['apple']);
  assert.deepEqual(matchBrands('Pineapple slicer', c), []);
  assert.deepEqual(matchBrands('Caramel Apple Pops', c), []);
  assert.deepEqual(matchBrands('耐克跑鞋 5 折', c), ['nike']);
  assert.deepEqual(matchBrands('Samsung Galaxy vs iPhone', c).sort(), ['apple', 'samsung']);
  assert.deepEqual(matchBrands('Snikers', c), []);
  const sam = compileBrand({ id: 's', name: 'Samsung', aliases: ['Galaxy S*'] });
  assert.deepEqual(matchBrands('Galaxy S26 Ultra deal', [sam]), ['s']);
  assert.deepEqual(matchBrands('Star Wars Micro Galaxy Squadron', [sam]), []);
});
test('deal text detection', () => {
  assert.ok(isDealText('AirPods 40% off'));
  assert.ok(isDealText('iPhone 直降 800 元'));
  assert.ok(isDealText('$100 off MacBook', true));
  assert.ok(!isDealText('Apple announces new iPad', true));
  assert.ok(!isDealText('A $100 price hike for iPhone', true));
  assert.ok(!isDealText('三星折叠屏发布', true));
  assert.ok(isDealText('Galaxy S26 8折', true));
});
test('price & discount extraction', () => {
  assert.equal(extractPrice('Echo Dot $29.99 + free shipping'), '$29.99');
  assert.equal(extractPrice('Adidas für 49,42€'), '49,42€');
  assert.equal(extractPrice('小米 ¥1999 到手'), '¥1999');
  assert.equal(extractDiscount('Save big: 35% off sitewide'), '35% OFF');
  assert.equal(extractDiscount('全场 7.5折'), '7.5折');
  assert.equal(extractPrice('Redmi Note 17 128GB & £30 Credit / 256GB £239'), '£239');
  assert.equal(extractPrice('Save $50: Apple Watch now $199'), '$199');
  assert.equal(extractPrice('Galaxy S26 $20 off'), '');
  assert.equal(extractPrice('小米 返现 50 元 到手 ¥1999'), '¥1999');
});
test('search term & request expansion', () => {
  assert.equal(searchTerm(brands[0], 'cn'), '(苹果 OR Apple)');
  const src = PRESET_SOURCES.find((s) => s.id === 'gnews-en');
  const reqs = expandRequests(src, brands.slice(0, 2));
  assert.equal(reqs.length, 2); assert.ok(reqs[0].url.includes('Apple')); assert.ok(!reqs[0].url.includes('{q}'));
});
test('normLink strips tracking params', () => { assert.equal(normLink('https://a.com/x?utm_source=1&id=2#h'), 'https://a.com/x?id=2'); });

test('fetchSource filters by kind & brand, survives failures', async () => {
  const deal = { id: 's1', name: 'S1', platform: 'P', region: 'intl', kind: 'deal', url: 'https://x/rss' };
  const r = await fetchSource(deal, brands, { fetchText: async () => RSS });
  assert.equal(r.status.ok, true); assert.equal(r.status.total, 4);
  assert.deepEqual(r.items.map((d) => d.brandIds[0]), ['apple', 'nike']);
  assert.equal(r.items[0].price, '$169'); assert.equal(r.items[1].discount, '40% OFF');
  const bad = await fetchSource(deal, brands, { fetchText: async () => { throw new Error('HTTP 403'); }, retryDelay: 1 });
  assert.equal(bad.status.ok, false); assert.match(bad.status.error, /403/);
  let n = 0; // 429 自动重试
  const retry = await fetchSource(deal, brands, { fetchText: async () => { if (n++ === 0) throw new Error('HTTP 429'); return RSS; }, retryDelay: 1 });
  assert.equal(retry.status.ok, true); assert.equal(n, 2);
});
test('news sources require deal words', async () => {
  const news = { id: 'n', name: 'N', platform: 'P', region: 'intl', kind: 'news', url: 'https://x' };
  const xml = RSS.replace('Nike Air Max 40% off', 'Nike opens new store');
  const r = await fetchSource(news, brands, { fetchText: async () => xml });
  assert.deepEqual(r.items.map((d) => d.brandIds[0]), ['apple']);
});

test('mergeDeals dedupes by link & title, keeps favourites, caps size', () => {
  const mk = (id, t, extra = {}) => ({ id, titleKey: t, sourceId: 's', brandIds: ['apple'], published: Date.now(), fetchedAt: Date.now(), ...extra });
  let { all, added } = mergeDeals([], [mk('1', 'a'), mk('2', 'b'), mk('1', 'a')]);
  assert.equal(added.length, 2);
  ({ all, added } = mergeDeals(all, [mk('3', 'b'), mk('4', 'c', { brandIds: ['nike'] })]));
  assert.equal(added.length, 1); assert.equal(all.length, 3);
  const old = mk('9', 'old', { fetchedAt: Date.now() - 40 * 86400000, published: 1, fav: true });
  const old2 = mk('8', 'old2', { fetchedAt: Date.now() - 40 * 86400000, published: 1 });
  ({ all } = mergeDeals([...all, old, old2], [], { maxAgeDays: 30 }));
  assert.ok(all.find((d) => d.id === '9')); assert.ok(!all.find((d) => d.id === '8'));
  ({ all } = mergeDeals(all, [], { maxDeals: 2 }));
  assert.equal(all.length, 2); assert.ok(all.find((d) => d.id === '9'));
});

test('runAll serialises same host, parallel otherwise, never throws', async () => {
  const order = [];
  const sources = [
    { id: 'a', name: 'a', kind: 'deal', url: 'https://same.com/1', enabled: true },
    { id: 'b', name: 'b', kind: 'deal', url: 'https://same.com/2', enabled: true },
    { id: 'c', name: 'c', kind: 'deal', url: 'https://other.com/1', enabled: true },
    { id: 'd', name: 'd', kind: 'deal', url: 'https://off.com/1', enabled: false },
  ];
  const res = await runAll(sources, brands, { hostGap: 5, retryDelay: 1, fetchText: async (u) => { order.push(u); if (u.includes('other')) throw new Error('boom'); return RSS; } });
  assert.equal(res.length, 3);
  assert.equal(res.find((r) => r.source.id === 'c').status.ok, false);
  assert.ok(order.indexOf('https://same.com/1') < order.indexOf('https://same.com/2'));
});

test('CSV export has BOM and escapes quotes', () => {
  const csv = toCSV([{ title: 'A "q", b', brandIds: ['apple'], price: '$1', discount: '', platform: 'P', sourceName: 'S', published: 0, link: 'https://x', read: true, fav: false }], (id) => id);
  assert.ok(csv.startsWith('\ufeff"标题"'));
  assert.ok(csv.includes('"A ""q"", b"'));
});

test('Store: defaults, brand CRUD, sources, persistence, corrupt file recovery', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'));
  const s = new Store(dir);
  assert.ok(s.config.brands.length >= 15); assert.ok(s.config.sources.length >= 20);
  const b = s.upsertBrand({ name: 'Puma', aliases: ['Puma', '彪马'] });
  assert.equal(b.enabled, true);
  assert.throws(() => s.upsertBrand({ name: 'puma' }), /已存在/);
  assert.throws(() => s.upsertBrand({ name: '  ' }), /不能为空/);
  s.upsertBrand({ id: b.id, name: 'Puma', aliases: ['Puma'], exclude: ['x'] });
  assert.throws(() => s.addSource({ url: 'ftp://x' }), /http/);
  const src = s.addSource({ url: 'https://example.com/feed', name: '' });
  assert.equal(src.name, 'example.com');
  s.removeSource('slickdeals'); assert.ok(s.config.sources.find((x) => x.id === 'slickdeals'), 'preset sources cannot be deleted');
  s.removeSource(src.id); assert.ok(!s.config.sources.find((x) => x.id === src.id));
  s.setSourceEnabled('slickdeals', false);
  const s2 = new Store(dir);
  assert.ok(s2.config.brands.find((x) => x.name === 'Puma'));
  assert.equal(s2.config.sources.find((x) => x.id === 'slickdeals').enabled, false);
  fs.writeFileSync(path.join(dir, 'config.json'), '{broken'); fs.writeFileSync(path.join(dir, 'deals.json'), 'nope');
  const s3 = new Store(dir); assert.ok(s3.config.brands.length >= 15); assert.deepEqual(s3.deals, []);
});

test('v1.1: accessory context, strict news wording, negation', () => {
  const c = [{ id: 'apple', name: 'Apple', aliases: ['iPhone', 'AirPods', '苹果'] }, { id: 'sony', name: 'Sony', aliases: ['PS5'] }, { id: 'nin', name: 'Nintendo', aliases: ['Switch 2'] }].map(compileBrand);
  assert.deepEqual(matchBrands('LISEN MagSafe Halterung Auto für iPhone 18-12', c), []);
  assert.deepEqual(matchBrands('Case for iPhone 16', c), []);
  assert.deepEqual(matchBrands('适用于苹果iPhone 17的手机壳 9.9元', c), []);
  assert.deepEqual(matchBrands('Manette pour PC/Switch/Switch 2/iOS', c), []);
  assert.deepEqual(matchBrands('Apple AirPods case for iPhone 17', c), ['apple']);
  assert.deepEqual(matchBrands('$50 off for Sony PS5', c), ['sony']);
  assert.deepEqual(matchBrands('Deals for Black Friday: Apple iPad', c), ['apple']);
  assert.deepEqual(matchBrands('Case for iPhone 16', c, { accessory: false }), ['apple']);
  assert.ok(!isDealText('iPhone 18 Pro卖不动了 近期也无降价的可能', true));
  assert.ok(!isDealText('苹果超95%生产制造已采用可再生能源', true));
  assert.ok(!isDealText('券商研报：苹果', true));
  assert.ok(!isDealText('Samsung New A-70% Washers', true));
  assert.ok(!isDealText('华为三折叠 3折叠屏发布', true));
  assert.ok(isDealText('Nike Air -40%', true));
  assert.ok(isDealText('AirPods Pro 3创历史最低价，多款苹果产品同步大幅降价', true));
});
test('v1.1: double-escaped HTML summary, Pepper heat prefix, per-source skip', async () => {
  const { stripHtml } = require('../src/core/feed');
  assert.equal(stripHtml('Preis &lt;a href=&quot;https://x&quot;&gt;Link&lt;/a&gt; ok'), 'Preis Link ok');
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>P</title>
<item><title>113° - Apple AirPods 4 für 99€</title><link>https://p/1</link></item>
<item><title>收一台 iPhone</title><link>https://p/2</link></item></channel></rss>`;
  const src = { id: 'p', name: 'P', platform: 'P', region: 'intl', kind: 'deal', url: 'https://p', skip: '^\\s*(收|求)' };
  const r = await fetchSource(src, brands, { fetchText: async () => xml });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].title, 'Apple AirPods 4 für 99€');
  assert.equal(r.items[0].heat, 113);
  assert.equal(r.items[0].price, '99€');
});
test('v1.1: store migration, per-brand notify, settings clamping, corrupt backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version: 1, brands: [{ id: 'x', name: 'X', aliases: ['X'], enabled: true }], sources: [], settings: { intervalMinutes: 15 } }));
  const s = new Store(dir);
  assert.equal(s.config.settings.onboarded, false, 'v1.0/1.1 users see the new AI welcome once');
  assert.equal(s.config.version, 5);
  assert.equal(s.config.brands[0].notify, true);
  s.setBrandNotify('x', false); assert.equal(new Store(dir).config.brands[0].notify, false);
  assert.equal(s.updateSettings({ intervalMinutes: 1 }).intervalMinutes, 5);
  assert.equal(s.updateSettings({ maxAgeDays: 'abc' }).maxAgeDays, 30);
  const fresh = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'dr-')));
  assert.equal(fresh.config.settings.onboarded, false, 'new users see onboarding');
  fs.writeFileSync(path.join(dir, 'deals.json'), '{oops');
  const s2 = new Store(dir); assert.deepEqual(s2.deals, []);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('deals.json.corrupt-')), 'corrupt file is backed up');
  s2.upsertBrand({ name: 'Y' }); assert.throws(() => s2.upsertBrand({ id: 'x', name: 'y' }), /已存在/, 'rename onto another brand name is rejected');
});

test('v1.2: offer classification (types, negation, false positives)', () => {
  const c = classifyOffer;
  assert.deepEqual(c('OpenAI Offers Free ChatGPT Plus for One Month to Students').sort(), ['free', 'student']);
  assert.ok(c('Anthropic gives startups $25k in API credits').includes('credits'));
  assert.ok(c('Anthropic gives startups $25k in API credits').includes('startup'));
  assert.deepEqual(c('DeepSeek API 降价 75%'), ['discount']);
  assert.ok(c('再次狂送 $15 满血 Claude Token').includes('credits'));
  assert.ok(c('Black Friday deal: 50% off Perplexity Pro').includes('event'));
  for (const t of ['ChatGPT will no longer be free', 'How students use ChatGPT', 'xAI and Pentagon reach deal to use Grok', '[Self-promo] I built a Gemini CLI wrapper', 'OpenAI 发布会活动回顾']) assert.deepEqual(c(t), [], t);
  assert.equal(isOffer(['plan']), false); assert.equal(isOffer(['credits']), true);
});

test('v1.2: AI vendor matching (case-sensitive names, noName, CJK aliases)', () => {
  const byId = Object.fromEntries(PRESET_BRANDS.filter((b) => b.id).map((b) => [b.id, b]));
  const comp = ['openai', 'anthropic', 'cursor', 'xai', 'qwen', 'doubao'].map((id) => compileBrand(byId[id]));
  assert.deepEqual(matchBrands('ChatGPT Plus free for students', comp), ['openai']);
  assert.deepEqual(matchBrands('Claude Pro 半价', comp), ['anthropic']);
  assert.deepEqual(matchBrands('Cursor Pro free for a year', comp), ['cursor']);
  assert.deepEqual(matchBrands('move the cursor to the left', comp), [], 'lowercase cursor is not the vendor');
  assert.deepEqual(matchBrands('Grok 4 free this week', comp), ['xai']);
  assert.deepEqual(matchBrands('通义千问 API 降价 97%', comp), ['qwen']);
  assert.deepEqual(matchBrands('豆包大模型 送 50 万 tokens', comp), ['doubao']);
  assert.ok(DEFAULT_ENABLED.includes(byId.openai.name) && !DEFAULT_ENABLED.includes('Apple'));
});

test('v1.2: HN parser, vendor/community sources, categories, store defaults & goods toggle', async () => {
  const hn = parseHN({ hits: [{ objectID: '1', title: 'Anthropic expands Claude startups program with $45K in credits', url: 'https://x/1', created_at_i: 1760000000, points: 50, num_comments: 3 }, { objectID: '2', title: 'Show HN: my app', url: '' }] });
  assert.equal(hn.items.length, 2); assert.equal(hn.items[1].link, 'https://news.ycombinator.com/item?id=2');
  const ai = PRESET_BRANDS.filter((b) => ['openai', 'anthropic'].includes(b.id));
  const goods = [{ id: 'apple', name: 'Apple', aliases: ['AirPods'], exclude: [], category: 'goods' }];
  const VENDOR = `<rss><channel><item><title>Introducing GPT-9</title><link>https://o/1</link></item><item><title>ChatGPT Plus free for college students</title><link>https://o/2</link></item></channel></rss>`;
  const r1 = await fetchSource({ id: 'v', kind: 'vendor', vendor: 'openai', category: 'ai', url: 'u' }, [...ai, ...goods], { fetchText: async () => VENDOR });
  assert.equal(r1.items.length, 2, 'vendor feed keeps news too');
  assert.deepEqual(r1.items[0].brandIds, ['openai']); assert.deepEqual(r1.items[0].offerTypes, []);
  assert.deepEqual(r1.items[1].offerTypes.sort(), ['free', 'student']); assert.equal(r1.items[1].category, 'ai');
  const COMM = `<rss><channel><item><title>Claude is great</title><link>https://c/1</link></item><item><title>新客送 10 美元 Claude 免费额度</title><link>https://c/2</link></item><item><title>AirPods Pro $169 deal</title><link>https://c/3</link></item></channel></rss>`;
  const r2 = await fetchSource({ id: 'c', kind: 'community', category: 'ai', url: 'u' }, [...ai, ...goods], { fetchText: async () => COMM });
  assert.deepEqual(r2.items.map((d) => d.link), ['https://c/2'], 'community: vendor + offer only, goods brands ignored');
  const r3 = await fetchSource({ id: 'g', kind: 'deal', category: 'goods', url: 'u' }, [...ai, ...goods], { fetchText: async () => COMM });
  assert.deepEqual(r3.items.map((d) => d.brandIds[0]), ['apple']); assert.equal(r3.items[0].category, 'goods');
  const s = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'dr-')));
  assert.equal(s.config.brands.filter((b) => b.enabled).length, DEFAULT_ENABLED.length);
  assert.ok(s.config.sources.filter((x) => x.category === 'goods').every((x) => !x.enabled), 'goods sources off by default');
  assert.ok(s.config.sources.filter((x) => x.category === 'ai').every((x) => x.enabled));
  s.setGoodsEnabled(true);
  assert.ok(s.config.sources.filter((x) => x.category === 'goods').every((x) => x.enabled));
  assert.ok(s.config.brands.some((b) => b.category === 'goods' && b.enabled));
  const cb = s.upsertBrand({ name: 'Lovable', aliases: ['Lovable'] }); assert.equal(cb.category, 'ai');
});

test('v1.2: per-vendor channels & pricing-page change monitor', async () => {
  const { channelSources, fetchSource: fs2 } = require('../src/core/monitor');
  const { extractLines } = require('../src/core/page');
  const b = { id: 'cursor', name: 'Cursor', aliases: ['Cursor'], enabled: true, category: 'ai', cs: true, channels: [
    { id: 'pricing', type: 'page', sub: 'pricing', name: '价格页', url: 'https://x/pricing', enabled: true },
    { id: 'blog', type: 'rss', sub: 'blog', name: '博客', url: 'https://x/rss', enabled: false },
    { id: 's', type: 'search', sub: 'news', name: '搜索', keyword: 'Cursor 学生 免费', enabled: true }] };
  const srcs = channelSources([b]);
  assert.equal(srcs.length, 3); assert.equal(srcs[0].kind, 'page'); assert.equal(srcs[1].enabled, false);
  assert.ok(srcs[2].url.includes('news.google.com') && srcs[2].region === 'cn');
  const v1 = '<html><body><nav>menu</nav><main><h2>Pro</h2><p>$20 / month</p><script>var x=1</script><p>Students: free for a year</p></main></body></html>';
  const v2 = v1.replace('$20', '$16').replace('</main>', '<p>Black Friday: 50% off annual</p></main>');
  assert.deepEqual(extractLines(v1), ['Pro', '$20 / month', 'Students: free for a year']);
  const pages = {}; let html = v1;
  const r1 = await fs2(srcs[0], [b], { fetchText: async () => html, pages });
  assert.equal(r1.items.length, 0); assert.match(r1.status.note, /基线/);
  const r2 = await fs2(srcs[0], [b], { fetchText: async () => html, pages });
  assert.equal(r2.items.length, 0); assert.match(r2.status.note, /无变化/);
  html = v2;
  const r3 = await fs2(srcs[0], [b], { fetchText: async () => html, pages });
  assert.equal(r3.items.length, 1);
  const d = r3.items[0];
  assert.deepEqual(d.brandIds, ['cursor']); assert.ok(d.offerTypes.includes('pricing')); assert.ok(d.offerTypes.includes('discount'));
  assert.match(d.summary, /\+ \$16 \/ month/); assert.match(d.summary, /- \$20 \/ month/);
  const blocked = await fs2(srcs[0], [b], { fetchText: async () => '<title>Just a moment...</title>', pages, retryDelay: 1 });
  assert.equal(blocked.status.ok, false); assert.match(blocked.status.error, /人机验证/);
  const sel = await fs2({ ...srcs[0], selector: '#nope' }, [b], { fetchText: async () => v1, pages });
  assert.equal(sel.status.ok, false);
});

test('LIVE: preset sources reachable & produce matched deals', { skip: !!process.env.OFFLINE, timeout: 300000 } /* v2.6：合并 sources-coverage 后全局源 27→53 个 */, async () => {
  const live = PRESET_SOURCES.filter((s) => s.category === 'ai').map((s) => ({ ...s, enabled: true }));
  const res = await runAll(live, PRESET_BRANDS.filter((b) => DEFAULT_ENABLED.includes(b.name)), {});
  const ok = res.filter((r) => r.status.ok);
  const failed = res.filter((r) => !r.status.ok).map((r) => `${r.source.id}: ${r.status.error}`);
  console.log(`live: ${ok.length}/${res.length} ok; matched=${res.reduce((a, r) => a + r.items.length, 0)}; failed=${JSON.stringify(failed)}`);
  assert.ok(ok.length >= res.length * 0.8, 'at least 80% of sources should work');
  assert.ok(res.reduce((a, r) => a + r.items.filter((d) => isOffer(d.offerTypes)).length, 0) > 30, 'enough real AI offers');
});
