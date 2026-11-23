'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const V214 = require('../src/core/v214');
const V28 = require('../src/core/v28');
const { HttpCache } = require('../src/core/http');
const { Store } = require('../src/core/store');

test('v2.14 normalizeFilters keeps safe fields and drops junk', () => {
  const f = V214.normalizeFilters({ type: 'student', valid: 'ending', sort: 'score', region: 'cn', platform: 'Official', news: 1, q: 'secret', unread: true, xss: '<x>' });
  assert.deepEqual(f, { type: 'student', valid: 'ending', sort: 'score', region: 'cn', platform: 'Official', news: true });
  assert.equal(V214.normalizeFilters({ type: 'nope', sort: 'zzz', region: 'us' }).type, '');
  assert.equal(V214.normalizeFilters({ type: 'nope', sort: 'zzz', region: 'us' }).sort, 'pub');
  assert.equal(V214.normalizeFilters({ platform: 'x'.repeat(80) }).platform.length, 40);
});

test('v2.14 notesSince is exclusive of lastSeen and inclusive of current', () => {
  const all = V214.notesSince('', '2.14.0').map((n) => n.v);
  assert.deepEqual(all, ['2.10.0', '2.11.0', '2.12.0', '2.13.0', '2.14.0']);
  assert.deepEqual(V214.notesSince('2.12.0', '2.14.0').map((n) => n.v), ['2.13.0', '2.14.0']);
  assert.deepEqual(V214.notesSince('2.14.0', '2.14.0'), []);
  assert.equal(V214.shouldShowNotes({ onboarded: true, lastSeen: '2.13.0', current: '2.14.0', shot: false }), true);
  assert.equal(V214.shouldShowNotes({ onboarded: true, lastSeen: '2.14.0', current: '2.14.0' }), false);
  assert.equal(V214.shouldShowNotes({ onboarded: false, lastSeen: '', current: '2.14.0' }), false);
  assert.equal(V214.shouldShowNotes({ onboarded: true, lastSeen: '2.10.0', current: '2.14.0', shot: true }), false);
});

test('v2.14 refreshState reuses previous deals payload when no new items', () => {
  const prev = { deals: [{ id: 1 }], runtime: { polling: true }, cacheHits: 1 };
  const live = { runtime: { polling: true, lastRunAt: 9 }, cacheHits: 4, sourceStatus: { a: 1 } };
  const light = V214.refreshState(prev, live, { light: true, hasNew: false });
  assert.equal(light.deals, prev.deals);
  assert.equal(light.cacheHits, 4);
  assert.equal(light.sourceStatus.a, 1);
  assert.equal(V214.refreshState(prev, live, { light: true, hasNew: true }), null);
  assert.equal(V214.refreshState(null, live, { light: true, hasNew: false }), null);
});

test('v2.14 cacheStats counts entries and body bytes', () => {
  const c = new HttpCache(10);
  c.set('https://a.test/', { etag: '1', body: 'hello' });
  c.set('https://b.test/', { lm: 'x', body: 'world!' });
  c.hits = 3; c.savedBytes = 12;
  const s = V214.cacheStats(c);
  assert.equal(s.entries, 2);
  assert.equal(s.bytes, 11);
  assert.equal(s.hits, 3);
  assert.equal(V214.fmtBytes(1536), '1.5 KB');
});

test('v2.14 store persists listFilters, lastSeenVersion, system theme; upgrade-safe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr214-'));
  const s = new Store(dir);
  const out = s.updateSettings({
    listFilters: { type: 'free', valid: 'active', sort: 'found', region: 'intl', platform: 'HN', news: true, q: 'drop' },
    lastSeenVersion: '2.13.0',
    theme: 'system',
  });
  assert.deepEqual(out.listFilters, { type: 'free', valid: 'active', sort: 'found', region: 'intl', platform: 'HN', news: true });
  assert.equal(out.lastSeenVersion, '2.13.0');
  assert.equal(out.theme, 'system');
  s.updateSettings({ theme: 'neon', lastSeenVersion: 'not a version!!!!', listFilters: { type: 'nope' } });
  assert.equal(s.config.settings.theme, 'system');
  assert.equal(s.config.settings.lastSeenVersion, '2.13.0');
  assert.equal(s.config.settings.listFilters.type, '');
  assert.equal(s.config.settings.listFilters.sort, 'found'); // 部分更新不丢掉其它筛选
  // reopen
  const s2 = new Store(dir);
  assert.equal(s2.config.settings.theme, 'system');
  assert.equal(s2.config.settings.lastSeenVersion, '2.13.0');
  assert.equal(s2.config.settings.listFilters.sort, 'found');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('v2.14 team / blogger presets are official-group only', () => {
  assert.ok(V28.PRESETS.team && V28.PRESETS.blogger);
  assert.equal(V28.PRESETS.team.profile.userType, 'existing');
  assert.ok(V28.PRESETS.blogger.groups.includes('llm'));
  assert.ok(!V28.PRESETS.blogger.groups.includes('goods'));
});
