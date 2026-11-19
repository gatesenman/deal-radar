'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const I18N = require('../src/renderer/i18n');
const en = require('../src/locales/en.json');
const zh = require('../src/locales/zh-CN.json');
const { BRAND_META } = require('../src/core/brandmeta');
const { PRESET_BRANDS } = require('../src/core/defaults');
const { slug, Store } = require('../src/core/store');
const { sniff, iconLinks, fetchLogo, NOT_VENDOR } = require('../src/core/logo');
const { digestOf, needsEnrich, enrichPrompt, parseEnrich } = require('../src/core/digest');

test('v2.4 i18n: t() placeholders, fallback, language resolution', () => {
  I18N.set('en', en);
  assert.equal(I18N.t('今日要点'), 'Today');
  assert.equal(I18N.t('共 {0} 条优惠 · {1} 条厂商资讯', 3, 5), '3 offers · 5 vendor news');
  assert.equal(I18N.t('不存在的键 {0}', 1), '不存在的键 1');
  assert.equal(I18N.resolve('auto', 'zh-CN'), 'zh-CN');
  assert.equal(I18N.resolve('auto', 'zh-TW'), 'zh-CN');
  assert.equal(I18N.resolve('auto', 'en-US'), 'en');
  assert.equal(I18N.resolve('auto', 'de'), 'en');
  assert.equal(I18N.resolve('en', 'zh-CN'), 'en');
  assert.equal(I18N.locale(), 'en-US');
  I18N.set('zh-CN', {});
});
test('v2.4 i18n: tx() translates data fragments, numbers normalized, leaves unknown text', () => {
  I18N.set('en', en);
  assert.equal(I18N.tx('ChatGPT 价格页'), 'ChatGPT Pricing page');
  assert.equal(I18N.tx('免费 2 年'), 'free for 2 years');
  assert.equal(I18N.tx('媒体 · 3 源交叉'), 'Media · 3 sources');
  assert.equal(I18N.tx('国内可用'), 'Available in China');
  assert.equal(I18N.tx('Hello world'), 'Hello world');
  I18N.set('zh-CN', {});
  assert.equal(I18N.tx('国内可用'), '国内可用');
});
test('v2.4 i18n: catalogs complete and no hard-coded UI strings left (scan script)', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'i18n-extract.js'), '--check'], { encoding: 'utf8' });
  assert.match(out, /missing UI 0/);
  assert.match(out, /hard-coded leftovers 0/);
  for (const k of Object.keys(zh)) assert.ok(en[k], 'en missing: ' + k);
  const ph = (s) => (String(s).match(/\{\d+\}/g) || []).sort().join();
  for (const [k, v] of Object.entries(en)) if (zh[k]) assert.equal(ph(v), ph(k), 'placeholder mismatch: ' + k);
});
test('v2.4 brand meta: every preset has domain + zh/en description + bundled logo (valid PNG ≥ 128px)', () => {
  for (const b of PRESET_BRANDS) {
    const id = b.id || slug(b.name); const m = BRAND_META[id];
    assert.ok(m && m.domain && m.desc['zh-CN'] && m.desc.en, id);
    assert.ok(!/[\u4e00-\u9fff]/.test(m.desc.en), id + ' en desc has Chinese');
    const f = path.join(__dirname, '..', 'assets', 'logos', id + '.png');
    const buf = fs.readFileSync(f);
    assert.equal(sniff(buf), 'png', id);
    assert.equal(buf.readUInt32BE(16), 128, id + ' width'); assert.equal(buf.readUInt32BE(20), 128, id + ' height');
  }
});
test('v2.4 logo fetch: picks declared icon, validates bytes, caches to dir, skips aggregator domains', async () => {
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(300, 1)]);
  const pages = { 'https://acme.ai/': Buffer.from('<link rel="icon" href="/x.svg"><link rel="apple-touch-icon" sizes="180x180" href="/apple.png">'), 'https://acme.ai/apple.png': png };
  assert.deepEqual(iconLinks(pages['https://acme.ai/'].toString(), 'https://acme.ai/'), ['https://acme.ai/x.svg', 'https://acme.ai/apple.png']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-'));
  const r = await fetchLogo('https://acme.ai/path', dir, 'acme', async (u) => pages[u] || null);
  assert.equal(r.file, 'acme.png'); assert.ok(fs.existsSync(path.join(dir, 'acme.png')));
  assert.equal(sniff(Buffer.from('<html>not an image</html>')), null);
  assert.equal(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>')), null);
  assert.equal(await fetchLogo('news.google.com', dir, 'x', async () => png), null);
  assert.ok(NOT_VENDOR.test('reddit.com'));
});
test('v2.4 digest + per-language AI translation selection', () => {
  const now = Date.now();
  const d1 = { id: 'a', title: 'Claude free for students', category: 'ai', isOffer: true, offerTypes: ['free', 'student'], fetchedAt: now, published: now, brandIds: ['anthropic'], score: 80 };
  const d2 = { id: 'b', title: 'Kimi 限时免费 1 个月', category: 'ai', isOffer: true, offerTypes: ['free'], fetchedAt: now, published: now, brandIds: ['kimi'], score: 70 };
  assert.ok(needsEnrich(d1, 'zh-CN')); assert.ok(!needsEnrich(d1, 'en'));
  assert.ok(needsEnrich(d2, 'en')); assert.ok(!needsEnrich(d2, 'zh-CN'));
  assert.ok(!needsEnrich({ ...d2, tr: { en: { title: 'x' } } }, 'en'));
  assert.match(enrichPrompt([d2], 'en'), /Translate into concise, natural English/);
  assert.deepEqual(parseEnrich('{"items":[{"i":0,"text":"Kimi free","note":"n"}]}')[0].text, 'Kimi free');
  I18N.set('en', en);
  const dg = digestOf([d1, d2], { now, t: I18N.t, titleOf: (d) => (d.tr && d.tr.en && d.tr.en.title) || d.title, locale: 'en-US' });
  assert.match(dg.title, /^Today's highlights: 2 new offers/);
  assert.ok(!/[\u4e00-\u9fff]/.test(dg.title));
  I18N.set('zh-CN', {});
  assert.match(digestOf([d1], { now }).title, /^今日要点：1 条新优惠/);
});
test('v2.4 migration: titleZh/aiNote → tr["zh-CN"], lang defaults to auto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr24-'));
  fs.writeFileSync(path.join(dir, 'deals.json'), JSON.stringify([{ id: 'x', title: 'Free Claude', titleZh: '免费 Claude', aiNote: '要点', enrichedAt: 1, category: 'ai', isOffer: true, offerTypes: ['free'], brandIds: [], fetchedAt: Date.now(), published: Date.now(), link: 'https://x.com/a', platform: 'X', sourceId: 'ai-gnews-en', fav: true }]));
  const s = new Store(dir);
  assert.equal(s.config.settings.lang, 'auto');
  assert.ok(s.config.settings.dealsSchema >= 4);
  const d = s.deals.find((x) => x.id === 'x');
  assert.deepEqual(d.tr['zh-CN'].title, '免费 Claude');
  assert.equal(s.updateSettings({ lang: 'xx' }).lang, 'auto');
  assert.equal(s.updateSettings({ lang: 'en' }).lang, 'en');
});
