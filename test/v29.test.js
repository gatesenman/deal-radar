'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const zlib = require('zlib'); const path = require('path');
const V = require('../src/core/v29');
const { extractLines } = require('../src/core/page');
const { fetchPage } = require('../src/core/monitor');
const { findDup } = require('../src/core/cluster');

const real = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/cursor-pricing.html.gz'))).toString('utf8');

test('v2.9 normalize + chrome lines', () => {
  assert.equal(V.normalizeLine('Updated: 20 hours ago'), V.normalizeLine('Updated: 19 hours ago'));
  assert.equal(V.normalizeLine('发布于 5 分钟前'), V.normalizeLine('发布于 3 小时前'));
  assert.ok(V.isChrome('Close')); assert.ok(V.isChrome('New')); assert.ok(V.isChrome('Reject All'));
  assert.ok(V.isChrome('Essential cookies keep the site working and stay on. Optional cookies help with performance and advertising — accept, reject, or manage them.'));
  assert.ok(!V.isChrome('Pro plan now $20/month'));
});

test('v2.9 main extraction drops cookie banner / dialog / nav', () => {
  const html = '<body><nav><a>Home</a><a>Docs</a></nav><div id="onetrust-banner-sdk"><p>We use cookies</p><button>Accept all</button></div><div role="dialog"><p>Sign up for our newsletter</p></div><main><h1>Pricing</h1><p>Pro</p><p>$20 / month</p><p>Updated 3 hours ago</p></main><footer>© 2026 Acme</footer></body>';
  const l = V.extractMain(html, extractLines);
  assert.deepEqual(l, ['Pricing', 'Pro', '$20 / month', 'Updated {ago}']);
});

test('v2.9 real pricing page keeps all prices', () => {
  const l = V.extractMain(real, extractLines);
  const f = V.priceFacts(l);
  for (const p of ['$0', '$8', '$30']) assert.ok(f.prices.has(p), p);
});

test('v2.9 judgeChange: price change alerts, text-only change on pricing page does not, flips ignored', () => {
  const a = V.extractMain(real, extractLines);
  const b = V.extractMain(real.replace(/\$30/g, '$35'), extractLines);
  const j = V.judgeChange(a, b, { sub: 'pricing', hash: V.hashOf(b), seen: [V.hashOf(a)] });
  assert.equal(j.alert, true); assert.equal(j.reason, 'price'); assert.ok(j.priceDiff.added.includes('$35'));
  const c = [...a, 'Trusted by engineers at many companies'];
  assert.equal(V.judgeChange(a, c, { sub: 'pricing' }).alert, false);
  const d = [...a, 'Limited-time: 50% off Pro for students'];
  assert.equal(V.judgeChange(a, d, { sub: 'pricing' }).reason, 'offer');
  assert.equal(V.judgeChange(a, ['Your First API Call', 'base_url'], { sub: 'pricing' }).reason, 'noprices');
  assert.equal(V.judgeChange(b, a, { sub: 'pricing', hash: V.hashOf(a), seen: [V.hashOf(a), V.hashOf(b)] }).reason, 'flip');
  assert.equal(V.judgeChange(['a post'], ['a post', 'A brand new blog post'], { sub: 'blog' }).alert, true);
});

test('v2.9 fetchPage: relative time / cookie banner do not alert; real price change does; upgrade rebaselines silently', async () => {
  const pages = {}; let html = '';
  const src = { id: 'p1', name: 'X 价格页', url: 'https://x.test/pricing', kind: 'page', type: 'page', sub: 'pricing' };
  const ft = async () => html;
  pages.p1 = { key: '|' + '|' + src.url, hash: 'old', lines: ['old'], at: 0, changedAt: 0 }; // v2.8 格式的旧基线
  html = '<main><p>Pro</p><p>$20 / month</p><p>Updated 2 hours ago</p></main>';
  let r = await fetchPage(src, [], { fetchText: ft, pages });
  assert.equal(r.items.length, 0); assert.match(r.status.note, /基线/);
  html = '<div class="cookie-consent"><p>We use cookies</p><button>Accept</button></div><main><p>Pro</p><p>$20 / month</p><p>Updated 5 hours ago</p></main>';
  r = await fetchPage(src, [], { fetchText: ft, pages });
  assert.equal(r.items.length, 0);
  html = '<main><p>Pro</p><p>$25 / month</p><p>Updated 1 hours ago</p></main>';
  r = await fetchPage(src, [], { fetchText: ft, pages });
  assert.equal(r.items.length, 1); assert.match(r.items[0].title, /\$20.*\$25/);
});

test('v2.9 KBT corroboration', () => {
  assert.equal(V.corroborate(0.5, ['https://a.com/x', 'https://www.a.com/y']).conf, 0.5);
  const c = V.corroborate(0.5, ['https://a.com/x', 'https://b.co.uk/y', { link: 'https://news.google.com/rss/1', outlet: 'The Verge' }]);
  assert.equal(V.corroborate(0.5, [{ link: 'https://news.google.com/a', outlet: 'Reuters' }, { link: 'https://news.google.com/b', outlet: 'Reuters' }]).hosts, 1);
  assert.equal(c.hosts, 3); assert.ok(c.conf > 0.75 && c.conf < 0.8);
  assert.ok(V.corroborate(0.95, ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com', 'https://e.com']).conf <= 0.97);
});

test('v2.9 jitter is deterministic and bounded', () => {
  const xs = Array.from({ length: 200 }, (_, i) => V.jitter('src' + i, 1));
  assert.ok(xs.every((x) => x >= 0.85 && x <= 1.15));
  assert.equal(V.jitter('a', 3), V.jitter('a', 3));
});

test('v2.9 dedupe guards', () => {
  const now = Date.now();
  const mk = (title, sourceId, link) => ({ title, sourceId, link, published: now, fetchedAt: now });
  assert.ok(!findDup(mk('Claude 4.5 is now available', 's1', 'https://a.com/1'), [{ d: mk('Claude 4.6 is now available', 's2', 'https://b.com/1') }]));
  assert.ok(!findDup(mk('5 best AI coding tools for students in 2026 compared', 's1', 'https://a.com/1'), [{ d: mk('7 best AI coding tools for students in 2026 compared', 's2', 'https://b.com/2') }]));
});
test('v2.9 dedupe merges cross-outlet same story', () => {
  const now = Date.now();
  const a = { id: 'a', title: 'OpenAI cuts ChatGPT Plus price for students in India - TechCrunch', sourceId: 'g', published: now };
  const b = { id: 'b', title: 'OpenAI cuts ChatGPT Plus price for students in India - The Verge', sourceId: 'g', published: now };
  assert.ok(findDup(a, [{ d: b }]));
});
test('v2.9 HTTP cache persists across restart', () => {
  const { HttpCache } = require('../src/core/http');
  const a = new HttpCache(); a.set('https://x.test/a', { etag: '"1"', lm: null, body: 'A' }); a.set('https://x.test/b', { etag: null, lm: 'Tue, 01 Oct 2026 00:00:00 GMT', body: 'B' });
  const b = new HttpCache(); assert.equal(b.load(a.serialize()), 2);
  assert.equal(b.get('https://x.test/a').etag, '"1"'); assert.equal(b.get('https://x.test/b').body, 'B');
  assert.equal(new HttpCache().load(Buffer.from('garbage')), 0);
});
test('v2.9 migration demotes old relative-time page alerts', () => {
  const os = require('os'); const Store = require('../src/core/store'); const S0 = Store.Store || Store;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr29-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ settings: { dealsSchema: 7 } }));
  fs.writeFileSync(path.join(dir, 'deals.json'), JSON.stringify([{ id: 'p', title: 'X 发布说明有变化：Updated: 20 hours ago', summary: '新增内容：\n+ Updated: 20 hours ago\n\n移除内容：\n- Updated: 19 hours ago', link: 'https://x.test/', pageDiff: { added: 1, removed: 1 }, brandIds: [], offerTypes: ['pricing'] }, { id: 'q', title: 'Y 价格页有变化：Pro $25', summary: '新增内容：\n+ Pro $25 / month\n\n移除内容：\n- Pro $20 / month', link: 'https://x.test/', pageDiff: { added: 1, removed: 1 }, brandIds: [], offerTypes: ['pricing'] }]));
  const s = new S0(dir);
  assert.equal(s.deals.find((d) => /^X /.test(d.title)).status, 'ignored');
  assert.notEqual(s.deals.find((d) => /^Y /.test(d.title)).status, 'ignored');
});
