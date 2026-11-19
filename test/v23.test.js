'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { refineOffer, applyFeedback, offerConfidence, classifyOffer } = require('../src/core/offers');
const { extractFacts, parseDeadline, amountOf } = require('../src/core/facts');
const { digestOf, inQuiet, parseEnrich, needsEnrich, enrichPrompt } = require('../src/core/digest');
const { mergeDeals } = require('../src/core/monitor');
const { Store } = require('../src/core/store');
const ref = new Date('2026-10-14T10:00:00').getTime();

test('v2.3 precision: noise from the live audit is demoted, real offers kept', () => {
  const noise = [
    ['3-month for free offer gone?', 'reddit'], ['Free trial offer disappears as soon as I try to claim it', 'reddit'],
    ['Using Google Gemini for Free? You\'re Losing Some Models Later This Week - PCMag', 'news'],
    ['Mistral denies a fresh security breach, but the code on sale looks a lot like May\'s leak', 'news'],
    ['Claude Haiku 5.5 vs Grok 4.5: Cheaper, Faster, Higher Score', 'news'], ['So the claude for startups cohort is full?', 'reddit'],
    ['I got into Stripe Startups with $500 credits', 'reddit'], ['Anthropic Faces Online Backlash After Pausing Free Claude Startup Perks', 'news'],
    ['微软GitHub Copilot学生免费套餐“降本”，无法手动选择高级模型', 'news'], ['AI Tools for Students Free Download for Android', 'news'],
    ['OpenAI reopens its $200 Pro plan but cuts API credits in half', 'news'], ['Elon Musk\'s xAI may overhaul Grok and X subscriptions with 4 new plans', 'news'],
  ];
  for (const [t, sub] of noise) assert.deepEqual(refineOffer(t, classifyOffer(t).length ? classifyOffer(t) : ['free'], { sub }), [], t);
  const real = [
    ['Manus 开启限时免费活动：8 月 26 日前 Manus 1.6/Lite 全球免费用', 'news'], ['豆包正式上线学生优惠：2.5倍免费额度！专业版38元/月起', 'news'],
    ['DeepSeek cuts V4-Pro prices by 75% and slashes API cache costs to a tenth', 'news'], ['Select Samsung Galaxy Device Owners: 1-Year Perplexity Pro Subscription Free', ''],
    ['Google Gemini AI Plus - FREE 12 months for students via Handshake', ''], ['Anthropic Opens Up Claude Startups Program With Credits, Tools And Community Access For Founders', 'news'],
    ['Google makes Gemini 4 Argon broadly available with limited-time low API pricing of $2/$10 per 1M token', 'news'],
    ['新客送 10 美元 Claude 免费额度', 'reddit'],
  ];
  for (const [t, sub] of real) { const c = classifyOffer(t); assert.ok(c.length, 'classified: ' + t); assert.ok(refineOffer(t, c, { sub }).length, 'kept: ' + t); }
  assert.deepEqual(refineOffer('anything', ['pricing'], { sub: 'reddit' }), ['pricing'], 'official price-page diffs always kept');
});

test('v2.3 feedback: noise words + penalised sources', () => {
  const fb = { words: ['IPO'], sources: { s1: 3 } };
  assert.deepEqual(applyFeedback('OpenAI cheaper model ahead of IPO', ['discount'], 's2', fb), []);
  assert.deepEqual(applyFeedback('Some vague cheaper thing', ['discount'], 's1', fb), []);
  assert.deepEqual(applyFeedback('50% off ChatGPT Plus', ['discount'], 's1', fb), ['discount'], 'strong signal survives source penalty');
  assert.deepEqual(applyFeedback('x', ['pricing'], 's1', { words: ['x'] }), ['pricing']);
});

test('v2.3 facts: amount, deadline, audience, eligibility, claim, trust', () => {
  assert.equal(amountOf('Anthropic gives a free year of Claude Team and USD 1,000 in API credits'), '免费 1 年 + $1,000 额度');
  assert.equal(amountOf('3 months of free ChatGPT Plus'), '免费 3 个月');
  assert.equal(amountOf('谷歌 API 限时半价'), '半价');
  assert.equal(amountOf('Save 20% on your subscription'), '20% OFF');
  assert.equal(new Date(parseDeadline('Offer valid until Nov 30', ref)).toISOString().slice(5, 10), '11-30');
  assert.equal(new Date(parseDeadline('8 月 26 日前全球免费用', ref)).getMonth(), 7);
  assert.equal(new Date(parseDeadline('free through January 15', ref)).getFullYear(), 2027, 'month earlier than now → next year');
  assert.equal(parseDeadline('no date here', ref), 0);
  const f = extractFacts({ title: '豆包正式上线学生优惠：2.5倍免费额度', offerTypes: ['student', 'credits'], brandIds: ['doubao'], platform: '厂商渠道', sub: 'blog', published: ref });
  assert.ok(f.elig.includes('国内可用') && f.elig.includes('学生'));
  assert.equal(f.trust.label, '官方'); assert.ok(f.confidence >= 70);
  const g = extractFacts({ title: 'OpenAI Is Offering Free ChatGPT Plus in India via promo code', offerTypes: ['free'], brandIds: ['openai'], platform: 'Reddit', sub: 'reddit', published: ref });
  assert.ok(g.elig.includes('限 印度') && g.claim === '优惠码 / 兑换码' && g.trust.label === '社区');
  assert.ok(offerConfidence({ offerTypes: ['free'], title: 'free stuff', sub: 'reddit', platform: 'Reddit' }) < offerConfidence({ offerTypes: ['free'], title: '3 months free', sub: 'blog', platform: '厂商渠道' }));
});

test('v2.3 digest: top / pricing / expiring / stats; quiet hours across midnight', () => {
  const mk = (id, o) => ({ id, title: id, category: 'ai', brandIds: ['openai'], offerTypes: ['free'], published: ref - 3600000, fetchedAt: ref - 3600000, score: 40, status: 'new', facts: { confidence: 60, deadline: 0 }, ...o });
  const deals = [mk('a'), mk('b', { score: 80 }), mk('c', { status: 'ignored', score: 99 }), mk('p', { offerTypes: ['pricing'] }), mk('e', { facts: { confidence: 60, deadline: ref + 3 * 86400000 } }),
    mk('x', { facts: { confidence: 60, deadline: ref - 86400000 } }), mk('old', { published: ref - 10 * 86400000, fetchedAt: ref - 10 * 86400000 }), mk('n', { offerTypes: [], feedback: 'noise' })];
  const d = digestOf(deals, { now: ref });
  assert.equal(d.top[0], 'b'); assert.ok(!d.top.includes('c') && !d.top.includes('x') && !d.top.includes('old') && !d.top.includes('p'));
  assert.deepEqual(d.pricing, ['p']); assert.deepEqual(d.expiring, ['e']);
  assert.equal(d.stats.expiredCount, 1); assert.equal(d.stats.ignored, 1); assert.ok(/今日要点/.test(d.title));
  const at = (h, m) => new Date(2026, 9, 14, h, m);
  const st = { quietHours: true, quietStart: '23:00', quietEnd: '08:00' };
  assert.ok(inQuiet(st, at(23, 30)) && inQuiet(st, at(2, 0)) && !inQuiet(st, at(8, 0)) && !inQuiet(st, at(12, 0)));
  assert.ok(!inQuiet({ ...st, quietHours: false }, at(2, 0)));
  assert.ok(inQuiet({ quietHours: true, quietStart: '12:00', quietEnd: '14:00' }, at(13, 0)));
});

test('v2.3 AI enrichment prompt / parser / selection', () => {
  const list = [{ title: 'Free ChatGPT Plus for students', summary: 'x' }];
  assert.ok(/Simplified Chinese/.test(enrichPrompt(list)) && /0\. Free ChatGPT/.test(enrichPrompt(list)));
  assert.deepEqual(parseEnrich('```json\n{"items":[{"i":0,"zh":"学生免费","note":"n"}]}\n```'), [{ i: 0, zh: '学生免费', text: '学生免费', note: 'n' }]);
  assert.deepEqual(parseEnrich('garbage'), []);
  assert.ok(needsEnrich({ category: 'ai', offerTypes: ['free'], title: 'Free trial', status: 'new' }));
  assert.ok(!needsEnrich({ category: 'ai', offerTypes: ['free'], title: '免费试用', status: 'new' }));
  assert.ok(!needsEnrich({ category: 'ai', offerTypes: ['free'], title: 'Free', enrichedAt: 1 }));
});

test('v2.3 mergeDeals: claimed kept past retention; noise feedback not re-tagged', () => {
  const now = ref; const old = now - 40 * 86400000;
  const ex = [{ id: '1', title: 'Old claimed offer', titleKey: 'k1', sourceId: 's', fetchedAt: old, status: 'claimed', brandIds: [] }, { id: '2', title: 'old unclaimed', titleKey: 'k2', sourceId: 's', fetchedAt: old, brandIds: [] },
    { id: '3', title: 'noise item', titleKey: 'k3', sourceId: 's', fetchedAt: now, offerTypes: [], feedback: 'noise', brandIds: [] }];
  const r = mergeDeals(ex, [{ id: '3', title: 'noise item', titleKey: 'k3', sourceId: 's', offerTypes: ['free'], brandIds: [] }], { now, maxAgeDays: 30 });
  assert.deepEqual(r.all.map((d) => d.id).sort(), ['1', '3']);
  assert.deepEqual(r.all.find((d) => d.id === '3').offerTypes, []);
});

test('v2.3 deals migration: re-judge with new precision rules, add facts & status (once)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr23-'));
  const s0 = new Store(dir); s0.config.settings.dealsSchema = 0; s0.saveConfig();
  const deals = [
    { id: 'n1', title: '3-month for free offer gone?', link: 'https://x/1', brandIds: ['openai'], category: 'ai', offerTypes: ['free'], sub: 'reddit', fetchedAt: Date.now() },
    { id: 'r1', title: 'ChatGPT Plus free for 3 months for students', link: 'https://x/2', brandIds: ['openai'], category: 'ai', offerTypes: ['free', 'student'], sub: 'blog', platform: '厂商渠道', fetchedAt: Date.now() },
    { id: 'f1', title: 'Is this free?', link: 'https://x/3', brandIds: ['openai'], category: 'ai', offerTypes: ['free'], sub: 'reddit', fav: true, fetchedAt: Date.now() },
  ];
  fs.writeFileSync(path.join(dir, 'deals.json'), JSON.stringify(deals));
  const s = new Store(dir);
  const by = (id) => s.deals.find((d) => d.id === id);
  assert.deepEqual(by('n1').offerTypes, []); assert.ok(by('r1').facts && by('r1').facts.amount === '免费 3 个月');
  assert.deepEqual(by('f1').offerTypes, ['free'], 'favourites untouched');
  assert.ok(s.deals.every((d) => d.status === 'new')); assert.equal(s.config.settings.dealsSchema >= 3, true); assert.equal(s.config.settings.migratedDealsDemoted, 1);
  by('r1').offerTypes = ['free']; s.saveDealsNow();
  const s2 = new Store(dir); assert.deepEqual(s2.deals.find((d) => d.id === 'r1').offerTypes, ['free'], 'runs once');
});

test('v2.3 settings validation', () => {
  const s = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'dr23s-')));
  s.updateSettings({ notifyMinConf: 500, quietStart: '25:99', digestTime: '07:30', noiseWords: [' IPO ', 'IPO', 'x', 'leak'] });
  assert.equal(s.config.settings.notifyMinConf, 100); assert.equal(s.config.settings.quietStart, '23:00'); assert.equal(s.config.settings.digestTime, '07:30');
  assert.deepEqual(s.config.settings.noiseWords, ['IPO', 'leak']);
});
