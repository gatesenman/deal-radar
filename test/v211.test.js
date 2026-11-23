'use strict';
const test = require('node:test');
const assert = require('node:assert');
const V26 = require('../src/core/v26');
const { parseDeadline } = require('../src/core/facts');
const V27 = require('../src/core/v27');

const REF = Date.UTC(2026, 10, 24, 4, 0, 0); // 2026-11-24 12:00 +08 roughly; use local via Date

test('v2.11 judgeLanding: soft 404 title / short body; long mention of 404 is not gone', () => {
  const soft = V26.judgeLanding('<html><head><title>Page not found</title></head><body><h1>404</h1><p>This page does not exist.</p></body></html>', 200);
  assert.equal(soft.gone, true);
  assert.equal(soft.reason, 'soft-404');
  const zh = V26.judgeLanding('<title>页面不存在</title><p>您访问的页面不存在</p>', 200);
  assert.equal(zh.gone, true);
  const long = V26.judgeLanding('<title>Docs</title><p>' + 'We have a troubleshooting note about a mistaken 404 not found in an old blog post. '.repeat(20) + '</p>', 200);
  assert.equal(long.gone, false, 'a long live page that merely mentions 404 must stay');
  assert.equal(V26.judgeLanding('<h1>Welcome</h1>', 200).gone, false);
  assert.equal(V26.judgeLanding('', 404).gone, true);
  assert.equal(V26.judgeLanding('', 500).gone, false);
});

test('v2.11 judgeLanding: more ended wording', () => {
  assert.equal(V26.judgeLanding('<p>This promotion has concluded.</p>', 200).gone, true);
  assert.equal(V26.judgeLanding('<p>The offer is no longer offered.</p>', 200).gone, true);
  assert.equal(V26.judgeLanding('<p>本活动已结束，领取已截止。</p>', 200).gone, true);
  assert.equal(V26.judgeLanding('<p>报名通道已关闭</p>', 200).gone, true);
  assert.equal(V26.judgeLanding('<p>This offer has ended</p>', 200).gone, true);
});

test('v2.11 parseDeadline: ISO labels, numeric dates, relative', () => {
  const ref = new Date(2026, 10, 24, 12, 0, 0).getTime(); // local
  const a = parseDeadline('截止日期：2026年12月31日', ref);
  assert.ok(a);
  assert.equal(new Date(a).getFullYear(), 2026);
  assert.equal(new Date(a).getMonth(), 11);
  assert.equal(new Date(a).getDate(), 31);
  const b = parseDeadline('有效期至 2027-01-15', ref);
  assert.equal(new Date(b).toISOString().slice(0, 10), '2027-01-15');
  const c = parseDeadline('valid until 11/30/2026', ref);
  assert.equal(new Date(c).getMonth(), 10);
  assert.equal(new Date(c).getDate(), 30);
  const d = parseDeadline('until 31/12/2026', ref); // first > 12 → DMY
  assert.equal(new Date(d).getMonth(), 11);
  assert.equal(new Date(d).getDate(), 31);
  const e = parseDeadline('Offer ends in 3 days', ref);
  const days = Math.round((e - ref) / 86400000);
  assert.ok(days >= 3 && days <= 4, 'ends in 3 days, got ' + days);
  const f = parseDeadline('还有 2 周', ref);
  const w = Math.round((f - ref) / 86400000);
  assert.ok(w >= 13 && w <= 15, '2 weeks, got ' + w);
  // existing cases still work
  assert.equal(new Date(parseDeadline('Offer valid until Nov 30', ref)).getMonth(), 10);
  assert.equal(parseDeadline('no date here', ref), 0);
});

test('v2.11 extractPrices: USD 20 / mo, 9 pounds, euros', () => {
  const p = V27.extractPrices(['Pro', 'USD 20 / month']);
  assert.ok(p.length, JSON.stringify(p));
  assert.equal(p[0].plan, 'Pro');
  assert.equal(p[0].amount, 20);
  assert.equal(p[0].currency, 'USD');
  assert.equal(p[0].period, 'month');
  const q = V27.extractPrices(['Plus', '9 pounds a month']);
  assert.ok(q.length, JSON.stringify(q));
  assert.equal(q[0].amount, 9);
  assert.equal(q[0].currency, 'GBP');
  const r = V27.extractPrices(['Team', '€12 /mo']);
  assert.equal(r[0].currency, 'EUR');
  assert.equal(r[0].amount, 12);
  // existing cases still work
  const old = V27.extractPrices(['Pro', '$20', 'per month']);
  assert.deepEqual(old.map((x) => [x.plan, x.amount, x.currency, x.period]), [['Pro', 20, 'USD', 'month']]);
  const zh = V27.extractPrices(['专业版', '¥ 99 /月']);
  assert.deepEqual(zh.map((x) => [x.plan, x.amount, x.currency]), [['专业版', 99, 'CNY']]);
});
