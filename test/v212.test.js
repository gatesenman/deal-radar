'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const V = require('../src/core/v212');
const { Store } = require('../src/core/store');

test('v2.12 applyFeedback: reasons keep or drop offer types', () => {
  const base = { id: 'a', title: 'Free month', link: 'https://x.test/a', offerTypes: ['free'], status: 'new', facts: { trust: { level: 3, label: '官方' } } };
  const n = V.applyFeedback(base, 'noise');
  assert.equal(n.feedback, 'noise');
  assert.equal(n.status, 'ignored');
  assert.deepEqual(n.offerTypes, []);
  assert.equal(n.facts, undefined);
  const e = V.applyFeedback(base, 'expired', { now: 1000 });
  assert.equal(e.feedback, 'expired');
  assert.deepEqual(e.offerTypes, ['free']);
  assert.equal(e.recheck.gone, true);
  assert.equal(e.recheck.reason, 'user-expired');
  const m = V.applyFeedback(base, 'not-for-me');
  assert.equal(m.feedback, 'not-for-me');
  assert.deepEqual(m.offerTypes, ['free']);
  assert.equal(V.learnsNegative('too-small'), true);
  assert.equal(V.learnsWord('expired'), false);
  assert.equal(V.learnsWord('noise'), true);
});

test('v2.12 evidenceOf: official badge and source count', () => {
  const one = V.evidenceOf({ sourceName: '官方博客', facts: { trust: { level: 3, label: '官方' } } });
  assert.equal(one.n, 1);
  assert.equal(one.official, true);
  const many = V.evidenceOf({ sources: [{ name: 'The Verge', link: 'https://a' }, { name: '官方博客', link: 'https://b' }], facts: { trust: { level: 2 } } });
  assert.equal(many.n, 2);
  assert.equal(many.official, true);
  const none = V.evidenceOf({ sourceName: 'Reddit', facts: { trust: { level: 1 } } });
  assert.equal(none.official, false);
  assert.equal(none.n, 1);
});

test('v2.12 exportBackup strips push secrets and AI keys; merge keeps claimed/fav', () => {
  const bak = V.exportBackup({
    config: {
      brands: [{ id: 'openai', name: 'OpenAI' }],
      sources: [{ id: 's1', url: 'https://example.com/rss' }],
      settings: {
        intervalMinutes: 15,
        ai: { keyEnc: 'SECRET-KEY', provider: 'openai' },
        channels: [{ type: 'telegram', name: 'tg', token: '123:ABCDEFGHIJKLMNOPQRSTUVWXYZ', chatId: '1' }, { type: 'wecom', name: '企微', url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd' }],
      },
    },
    deals: [{ id: 'd1', title: 'T', link: 'https://x', brandIds: ['openai'], offerTypes: ['free'], status: 'new', fav: false }],
  });
  assert.equal(bak.app, 'DealRadar');
  assert.equal(bak.format, 3);
  assert.ok(!JSON.stringify(bak).includes('SECRET-KEY'));
  assert.ok(!JSON.stringify(bak).includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ'));
  assert.ok(!JSON.stringify(bak).includes('key=abcd'));
  assert.ok(bak.channels.every((c) => !c.token && !c.secret && !c.key));
  assert.equal(V.validateBackup(bak), '');
  assert.match(V.validateBackup({ foo: 1 }), /不是/);

  const merged = V.mergeDeals(
    [{ id: 'd1', title: 'T', link: 'https://x', fav: true, status: 'new' }, { id: 'local', title: 'L', link: 'https://l' }],
    [{ id: 'd1', title: 'T', link: 'https://x', fav: false, status: 'claimed' }, { id: 'new', title: 'N', link: 'https://n' }]
  );
  const d1 = merged.find((x) => x.id === 'd1');
  assert.equal(d1.fav, true);
  assert.equal(d1.status, 'claimed');
  assert.ok(merged.some((x) => x.id === 'local'));
  assert.ok(merged.some((x) => x.id === 'new'));
});

test('v2.12 store still upgrades safely after backup helpers load', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr212-'));
  const s = new Store(dir);
  assert.ok(s.config.brands.length > 0);
  const bak = V.exportBackup({ config: s.config, deals: s.deals });
  assert.equal(V.validateBackup(bak), '');
});
