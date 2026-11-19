'use strict';
const test = require('node:test'); const assert = require('node:assert');
const V = require('../src/core/v27');
const MIN = 60000;

test('v2.7 Cho–Garcia-Molina estimator: rate from change history, interval clamped', () => {
  const hist = []; let t = 0; for (let i = 0; i < 21; i++) { hist.push([t, i > 0 && i % 5 === 0 ? 1 : 0]); t += 15 * MIN; }
  const lam = V.estimateRate(hist); // 4 changes in 20 checks of 15 min
  const expect = -Math.log((20 - 4 + 0.5) / (20 + 0.5)) / 15; assert.ok(Math.abs(lam - expect) < 1e-12);
  assert.equal(V.adaptiveInterval(hist, { base: 15, max: 360 }), Math.round(0.5 / lam));
  const busy = hist.map(([x]) => [x, 1]); assert.equal(V.adaptiveInterval(busy, { base: 15 }), 15, 'always changing → base');
  const dead = hist.map(([x]) => [x, 0]); assert.equal(V.adaptiveInterval(dead, { base: 15, max: 360 }), 60, 'never changing → 4×base');
  assert.equal(V.estimateRate([[0, 0]]), null);
});
test('v2.7 adaptiveSkip + monitor.skipReason integration', () => {
  const { skipReason } = require('../src/core/monitor');
  const hist = []; for (let i = 0; i < 10; i++) hist.push([i * 15 * MIN, 0]);
  const st = { ok: true, lastRun: 9 * 15 * MIN, chg: hist };
  const now = st.lastRun + 20 * MIN;
  assert.match(skipReason({}, st, { now, adaptive: true, baseMin: 15 }), /变化频率/);
  assert.equal(skipReason({}, st, { now, adaptive: false, baseMin: 15 }), '');
  assert.equal(skipReason({}, st, { now, adaptive: true, baseMin: 15, force: true }), '');
  assert.equal(skipReason({}, st, { now: st.lastRun + 70 * MIN, adaptive: true, baseMin: 15 }), '', 'due again after interval');
  assert.equal(V.recordCheck(new Array(45).fill([0, 0]), true, 1).length, 40);
});
test('v2.7 price extraction from pricing-page lines', () => {
  const lines = ['Pricing', 'Free', '$0', '/month', 'Get started', 'Pro', '$20', 'per month', 'Everything in Free', 'Business', '$40', 'per user/month', 'Get up to $10,000 in credits', 'Enterprise', 'Contact sales'];
  const p = V.extractPrices(lines);
  assert.deepEqual(p.map((x) => [x.plan, x.amount, x.currency, x.period]), [['Free', 0, 'USD', 'month'], ['Pro', 20, 'USD', 'month'], ['Business', 40, 'USD', 'seat-month']]);
  const zh = V.extractPrices(['专业版', '¥ 99 /月', '团队版', '199 元 每月']);
  assert.deepEqual(zh.map((x) => [x.plan, x.amount, x.currency]), [['专业版', 99, 'CNY'], ['团队版', 199, 'CNY']]);
  assert.equal(V.extractPrices(['Free use of SWE-2', '$200 credits']).length, 0);
});
test('v2.7 price book history + diff + CNY', () => {
  const book = {};
  assert.deepEqual(V.updatePriceBook(book, 's', { name: 'X · Pricing' }, [{ plan: 'Pro', amount: 20, currency: 'USD', period: 'month' }], 1), []);
  const ch = V.updatePriceBook(book, 's', {}, [{ plan: 'Pro', amount: 17, currency: 'USD', period: 'month' }], 2);
  assert.deepEqual(ch, [{ plan: 'Pro', period: 'month', from: 20, to: 17, currency: 'USD' }]);
  V.updatePriceBook(book, 's', {}, [{ plan: 'Pro', amount: 17, currency: 'USD', period: 'month' }], 3);
  assert.equal(book.s.plans['pro|month'].hist.length, 2, 'unchanged price does not add a point');
  assert.equal(V.toCNY(10, 'USD', { rates: { USD: 6.678 } }), 66.78);
  assert.equal(V.toCNY(10, 'USD', null), 71);
  assert.equal(V.parseFx([{ base: 'USD', quote: 'CNY', rate: 6.7 }]).USD, 6.7);
  assert.equal(V.parseFx({ rates: { USD: 1, CNY: 7, EUR: 0.875 } }).EUR, 8);
});
test('v2.7 source reliability (Beta smoothing)', () => {
  const good = V.sourceReliability({ pos: 10, neg: 0, runs: 40, okRuns: 40, official: true });
  const bad = V.sourceReliability({ pos: 0, neg: 10, runs: 40, okRuns: 20 });
  const fresh = V.sourceReliability({});
  assert.ok(good.score > 0.85 && bad.score < 0.3 && fresh.score > bad.score && fresh.score < good.score);
});
test('v2.7 naive Bayes learns from feedback; relabel undoes; uncertainty sampling', () => {
  let m = V.newModel();
  const pos = ['ChatGPT Plus free for students', 'Claude Pro 50% off for students', 'Cursor Pro free for students one year', 'Gemini free trial for students', 'GitHub Copilot free students', 'Perplexity Pro free for students'];
  const neg = ['Anthropic hires new CFO', 'OpenAI lawsuit update court', 'xAI raises funding round', 'Google layoffs report court', 'Meta lawsuit court ruling', 'Microsoft hires executive'];
  pos.forEach((t, i) => V.learn(m, 'p' + i, t, true)); neg.forEach((t, i) => V.learn(m, 'n' + i, t, false));
  assert.ok(V.predict(m, 'Notion AI free for students') > 0.8);
  assert.ok(V.predict(m, 'court ruling on lawsuit') < 0.2);
  V.learn(m, 'p0', pos[0], false); assert.equal(m.np, 5); assert.equal(m.nn, 7, 'relabel moves the example');
  assert.equal(V.predict(V.newModel(), 'x'), null, 'not enough labels');
  const deals = [{ id: 'a', learnP: 0.9, status: 'new' }, { id: 'b', learnP: 0.52, status: 'new' }, { id: 'c', learnP: 0.4, status: 'new' }, { id: 'p1', learnP: 0.5, status: 'new' }];
  assert.deepEqual(V.uncertain(deals, m, { limit: 2 }).map((d) => d.id), ['b', 'c'], 'labeled items excluded, closest to 0.5 first');
  assert.ok(V.tokens('免费试用 ChatGPT').includes('免费'));
});
test('v2.7 MinHash + LSH finds near-duplicate titles', () => {
  const items = [
    { id: 'a', sig: V.minhash('OpenAI makes ChatGPT Plus free for college students in US and Canada') },
    { id: 'b', sig: V.minhash('OpenAI makes ChatGPT Plus free for college students in the US and Canada') },
    { id: 'c', sig: V.minhash('Google announces Gemini 3 pricing for developers') },
  ];
  assert.ok(V.mhSim(items[0].sig, items[1].sig) > 0.7); assert.ok(V.mhSim(items[0].sig, items[2].sig) < 0.3);
  const pairs = V.lshPairs(items).map((p) => p.sort().join('|'));
  assert.ok(pairs.includes('a|b')); assert.ok(!pairs.includes('a|c'));
});
test('v2.7 store persists prices + learn model and validates new settings', () => {
  const { Store } = require('../src/core/store'); const os = require('os'); const fs = require('fs'); const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr27-')); const s = new Store(dir);
  s.prices.x = { plans: {} }; s.savePrices(); V.learn(s.learn, 'i', 'free trial', true); s.saveLearn();
  const out = s.updateSettings({ adaptivePolling: 0, learnEnabled: 1 }); assert.equal(out.adaptivePolling, false); assert.equal(out.learnEnabled, true);
  const s2 = new Store(dir); assert.ok(s2.prices.x); assert.equal(s2.learn.np, 1);
});

test('v2.7 价格抽取：划线原价、Save 文案、迁移噪音', () => {
  const V = require('../src/core/v27');
  const r = V.extractPrices(['Standard', 'Billed annually. Save $36/year.', '$15', '$12', '/month']);
  assert.deepEqual(r, [{ plan: 'Standard', amount: 12, currency: 'USD', period: 'month', was: 15 }]);
  assert.deepEqual(V.diffPrices([{ plan: 'Standard', period: 'month', currency: 'USD', amount: 15 }], r), []);
  assert.equal(V.diffPrices([{ plan: 'Standard', period: 'month', currency: 'USD', amount: 20 }], r).length, 1);
  const { isCodeNoise } = require('../src/core/monitor');
  assert.ok(isCodeNoise('[data-slot=icon]]:-mx-0.5 [&>[data-slot=icon]]:shrink-0 gap-x-3 px-[18'));
});
