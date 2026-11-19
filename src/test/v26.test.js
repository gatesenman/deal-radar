'use strict';
const test = require('node:test');
const assert = require('node:assert');
const V = require('../src/core/v26');
const { extractFacts } = require('../src/core/facts');
const D = require('../src/core/defaults');

const DAY = 86400000; const NOW = new Date('2026-10-21T12:00:00+08:00').getTime();
const mk = (o) => { const d = { id: 'x', title: '', link: 'https://example.com/a', brandIds: ['openai'], offerTypes: ['free'], platform: 'TechCrunch', published: NOW - DAY, fetchedAt: NOW - DAY, category: 'ai', ...o }; d.facts = extractFacts(d); return d; };

test('v2.6 validity: deadline passed → expired, ≤3 days → ending, future → active', () => {
  assert.equal(V.validity(mk({ title: 'ChatGPT Plus free until Oct 10, 2026' }), NOW).status, 'expired');
  const e = V.validity(mk({ title: 'Claude Pro 50% off until Oct 23, 2026' }), NOW); assert.equal(e.status, 'ending'); assert.ok(e.daysLeft <= 3);
  assert.equal(V.validity(mk({ title: 'Cursor Pro free for students through Dec 31, 2026' }), NOW).status, 'active');
});
test('v2.6 validity: landing recheck gone → expired; fresh ok → active; old no-deadline → unknown', () => {
  assert.equal(V.validity({ ...mk({ title: 'Gemini Pro free trial' }), recheck: { at: NOW - 3600000, gone: true, ok: false, reason: 'http-404' } }, NOW).status, 'expired');
  const off = mk({ title: 'Gemini Pro free trial' }); off.facts.trust = { ...(off.facts.trust || {}), level: 3 };
  assert.equal(V.validity({ ...off, recheck: { at: NOW - DAY, ok: true, gone: false } }, NOW).status, 'active');
  // v2.6.1：新闻页还能打开不代表优惠仍有效
  const news = mk({ title: 'Gemini Pro free trial', published: NOW - 20 * DAY }); news.facts.trust = { ...(news.facts.trust || {}), level: 1 };
  assert.notEqual(V.validity({ ...news, recheck: { at: NOW - DAY, ok: true, gone: false } }, NOW).status, 'active');
  const old = mk({ title: 'Perplexity Pro free for a year', published: NOW - 60 * DAY });
  const v = V.validity(old, NOW); assert.equal(v.status, 'unknown'); assert.equal(v.reason, 'stale');
});
test('v2.6 judgeLanding: 404/410 and ended wording', () => {
  assert.ok(V.judgeLanding('', 404).gone); assert.ok(V.judgeLanding('', 410).gone);
  assert.ok(!V.judgeLanding('', 503).gone);
  assert.ok(V.judgeLanding('<h1>This offer has ended</h1>', 200).gone);
  assert.ok(V.judgeLanding('<p>活动已结束，感谢参与</p>', 200).gone);
  assert.ok(V.judgeLanding('<p>Applications are now closed.</p>', 200).gone);
  assert.ok(V.judgeLanding('<p>Get 3 months free. Offer ends Dec 31.</p>', 200).ok);
  assert.ok(V.judgeLanding('<script>var s="offer has ended"</script><p>Free for students</p>', 200).ok, 'script text ignored');
});
test('v2.6 recheckDeals: picks unchecked recent offers, marks 404 gone, respects interval', async () => {
  const a = mk({ id: 'a', link: 'https://x.test/404' }); const b = mk({ id: 'b', link: 'https://x.test/ok' }); const c = mk({ id: 'c', link: 'https://x.test/c', published: NOW - 90 * DAY });
  const ft = async (u) => { if (u.endsWith('404')) { const e = new Error('HTTP 404'); e.status = 404; throw e; } return '<p>Get it now</p>'; };
  const r = await V.recheckDeals([a, b, c], ft, { now: NOW, hours: 12 });
  assert.equal(r.checked, 2); assert.equal(r.gone, 0, 'first 404 is only suspect'); assert.ok(a.recheck.suspect && !a.recheck.gone); assert.ok(b.recheck.ok); assert.ok(!c.recheck);
  assert.notEqual(V.validity(a, NOW).status, 'expired', 'a single 404 must not hide the offer');
  const r2 = await V.recheckDeals([a, b], ft, { now: NOW + 3600000, hours: 12 }); assert.equal(r2.checked, 1, 'suspect rechecked after 1h, ok one respects interval'); assert.equal(r2.gone, 1); assert.ok(a.recheck.gone);
  const r3 = await V.recheckDeals([a, b], ft, { now: NOW + 2 * 3600000, hours: 12 }); assert.equal(r3.checked, 0, 'gone skipped');
  // 一次偶发 404 后恢复正常：清除嫌疑
  const d = mk({ id: 'd', link: 'https://x.test/flaky' }); let n = 0;
  const ft2 = async () => { if (n++ === 0) { const e = new Error('HTTP 404'); e.status = 404; throw e; } return '<p>ok</p>'; };
  await V.recheckDeals([d], ft2, { now: NOW, hours: 12 }); await V.recheckDeals([d], ft2, { now: NOW + 3600000, hours: 12 });
  assert.ok(d.recheck.ok && !d.recheck.gone && !d.recheck.suspect);
  // 页面文字明确写已结束 → 立即判定
  const e = mk({ id: 'e', link: 'https://x.test/ended' });
  await V.recheckDeals([e], async () => '<h1>This offer has ended</h1>', { now: NOW, hours: 12 }); assert.ok(e.recheck.gone);
});
test('v2.6 appliesToMe: student / new user / overseas card / region limits', () => {
  const stu = mk({ title: 'Gemini free for college students', offerTypes: ['student'] });
  assert.equal(V.appliesToMe(stu, { region: 'cn', student: false }).ok, false);
  assert.deepEqual(V.appliesToMe(stu, { region: 'cn', student: false }).reasons, ['student-only']);
  assert.equal(V.appliesToMe(stu, { student: true }).ok, true);
  const nu = mk({ title: 'Notion AI 50% off for new users' });
  assert.equal(V.appliesToMe(nu, { userType: 'existing' }).ok, false); assert.equal(V.appliesToMe(nu, { userType: 'new' }).ok, true);
  const ov = mk({ title: 'ChatGPT Plus 1 month free' });
  assert.ok((ov.facts.elig || []).includes('可能需海外账号 / 支付'));
  assert.equal(V.appliesToMe(ov, { region: 'cn', pay: ['alipay', 'wechat'] }).ok, false);
  assert.equal(V.appliesToMe(ov, { region: 'cn', pay: ['alipay', 'card'] }).ok, true);
  const india = mk({ title: 'ChatGPT Go free for 12 months in India' });
  assert.equal(V.appliesToMe(india, { region: 'cn' }).ok, false); assert.equal(V.appliesToMe(india, { region: 'overseas' }).ok, true);
  const cn = mk({ title: 'DeepSeek API 降价 50%', brandIds: ['deepseek'], offerTypes: ['discount'] });
  assert.equal(V.appliesToMe(cn, { region: 'cn', pay: ['alipay'] }).ok, true);
  assert.equal(V.appliesToMe(mk({ title: 'x' }), V.DEFAULT_PROFILE).ok, true, 'empty profile → applies');
});
test('v2.6 claimGuide: official link, code extraction, card & auto-renew warnings', () => {
  const vi = { domains: ['openai.com', 'chatgpt.com'], pricingUrl: 'https://chatgpt.com/pricing', promoUrls: ['https://chatgpt.com/pricing', 'https://chatgpt.com/students'] };
  const news = mk({ title: 'ChatGPT Plus free for students until May', offerTypes: ['student'], link: 'https://techcrunch.com/x' });
  const g = V.claimGuide(news, vi); assert.equal(g.claimUrl, 'https://chatgpt.com/students'); assert.equal(g.kind, 'student'); assert.ok(g.warnings.includes('news-link'));
  const off = mk({ title: 'ChatGPT Go now free', link: 'https://openai.com/index/go' }); assert.equal(V.claimGuide(off, vi).claimUrl, 'https://openai.com/index/go');
  const code = mk({ title: 'Cursor Pro 20% off with code CURSOR20 — then $20/month, auto-renews', offerTypes: ['discount'] });
  const gc = V.claimGuide(code, { domains: ['cursor.com'], pricingUrl: 'https://cursor.com/pricing' });
  assert.equal(gc.code, 'CURSOR20'); assert.equal(gc.kind, 'code'); assert.ok(gc.warnings.includes('auto-renew'));
  const card = mk({ title: 'Perplexity Pro 7-day free trial, credit card required' });
  assert.ok(V.claimGuide(card, {}).warnings.includes('needs-card'));
  assert.equal(V.codeOf('使用优惠码：AI2026 立减'), 'AI2026');
  assert.equal(V.codeOf('Use the API code examples'), '');
});
test('v2.6 coverage: per-vendor ok/failing/last check + blind spots', () => {
  const brands = [{ id: 'openai', name: 'OpenAI', enabled: true }, { id: 'xai', name: 'xAI', enabled: true }, { id: 'off', name: 'Off', enabled: false }];
  const ch = [{ id: 'ch-openai-a', brandId: 'openai', name: 'OpenAI · Blog', enabled: true }, { id: 'ch-openai-b', brandId: 'openai', name: 'OpenAI · Pricing', enabled: true }, { id: 'ch-openai-c', brandId: 'openai', name: 'OpenAI · Old', enabled: false }, { id: 'ch-xai-a', brandId: 'xai', name: 'xAI · News', enabled: true }];
  const st = { 'ch-openai-a': { ok: true, lastRun: NOW - 3600000 }, 'ch-openai-b': { ok: false, lastRun: NOW - 60000, error: 'HTTP 403' }, 'ch-xai-a': { ok: false, lastRun: NOW, error: 'timeout' } };
  const rows = V.coverage(brands, ch, st, NOW);
  assert.equal(rows.length, 2);
  const o = rows.find((r) => r.id === 'openai'); assert.equal(o.ok, 1); assert.equal(o.failing, 1); assert.equal(o.disabled, 1); assert.equal(o.lastOk, NOW - 3600000); assert.equal(o.level, 'partial'); assert.equal(o.failingList[0].error, 'HTTP 403');
  const x = rows.find((r) => r.id === 'xai'); assert.equal(x.level, 'down'); assert.ok(x.blind.includes('x-primary')); assert.ok(x.blind.includes('wechat-mp'));
});
test('v2.6 matchVendor: name, alias and Chinese alias', () => {
  const B = D.PRESET_BRANDS;
  assert.equal(V.matchVendor(B, 'claude')[0].id, 'anthropic');
  assert.equal(V.matchVendor(B, 'ChatGPT')[0].id, 'openai');
  const zh = V.matchVendor(B, '亚马逊云科技'); assert.equal(zh[0].id, 'aws');
  assert.equal(V.matchVendor(B, 'c').length, 0);
});
test('v2.6 sources: AWS What\'s New + Azure blog/updates + Foundry blog are preset official RSS', () => {
  const aws = D.VENDOR_CHANNELS.aws; const az = D.VENDOR_CHANNELS.azure;
  assert.ok(aws.some((c) => c.type === 'rss' && /aws\.amazon\.com\/about-aws\/whats-new\/recent\/feed/.test(c.url)));
  assert.ok(az.some((c) => c.type === 'rss' && /azure\.microsoft\.com\/en-us\/blog\/feed/.test(c.url)));
  assert.ok(az.some((c) => c.type === 'rss' && /devblogs\.microsoft\.com\/foundry\/feed/.test(c.url)));
});
test('v2.6 settings: profile is validated by the store', () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const { Store } = require('../src/core/store');
  const s = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'dr26-')));
  const out = s.updateSettings({ profile: { region: 'mars', student: 1, userType: 'new', pay: ['alipay', 'bitcoin', 'alipay', 'card'] }, hideExpired: 0, recheckHours: 1 });
  assert.deepEqual(out.profile, { region: 'any', student: true, userType: 'new', pay: ['alipay', 'card'] });
  assert.equal(out.hideExpired, false); assert.equal(out.recheckHours, 2);
  assert.equal(new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'dr26-'))).config.settings.hideExpired, true);
});

test('v2.6.1 settings: filterMine persists as boolean', () => {
  const { Store } = require('../src/core/store'); const os = require('os'); const fs = require('fs'); const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-fm-')); const st = new Store(dir);
  assert.equal(st.updateSettings({ filterMine: 1 }).filterMine, true);
  assert.equal(new Store(dir).config.settings.filterMine, true);
});

test('v2.6.1 page monitor: CSS / Tailwind noise lines are not content changes', () => {
  const { isCodeNoise } = require('../src/core/monitor');
  assert.ok(isCodeNoise('[data-slot=icon]]:-mx-0.5 [&>[data-slot=icon]]:shrink-0 gap-x-3 px-[18px]'));
  assert.ok(isCodeNoise('grid-cols-2 md:grid-cols-4 lg:px-[24px] text-[13px]'));
  for (const t of ['Grok 4 API: $3 / 1M input tokens', 'Batch API 50% off', 'gpt-4o-mini gpt-4.1-nano o3-mini', '学生免费使用 12 个月', 'Free tier: 1,000 requests/day']) assert.ok(!isCodeNoise(t), t);
});

test('v2.6.1 migration: unconfirmed single-404 "expired" from 2.6.0 becomes suspect; text-ended kept', () => {
  const { Store } = require('../src/core/store'); const os = require('os'); const fs = require('fs'); const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-mr-')); const s0 = new Store(dir);
  const a = mk({ id: 'a1', link: 'https://x.test/a' }); a.recheck = { at: NOW, ok: false, gone: true, reason: 'http-404' };
  const b = mk({ id: 'b1', link: 'https://x.test/b' }); b.recheck = { at: NOW, ok: false, gone: true, reason: 'text:This Deal Has Expired' };
  s0.deals = [a, b]; s0.config.settings.dealsSchema = 5; s0._migrateRecheck();
  const s = s0; const A = s.deals.find((d) => d.id === 'a1'); const B = s.deals.find((d) => d.id === 'b1');
  assert.ok(!A.recheck.gone && A.recheck.suspect); assert.ok(B.recheck.gone); assert.equal(s.config.settings.dealsSchema, 6);
});
