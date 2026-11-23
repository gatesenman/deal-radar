'use strict';
const test = require('node:test');
const assert = require('node:assert');
const V = require('../src/core/v213');

test('v2.13 semver compare and isNewer', () => {
  assert.equal(V.cmpSemver('2.13.0', '2.12.0'), 1);
  assert.equal(V.cmpSemver('v2.9.0', '2.9.0'), 0);
  assert.equal(V.cmpSemver('2.10.0', '2.9.0'), 1);
  assert.equal(V.cmpSemver('2.9.1', '2.10.0'), -1);
  assert.ok(V.isNewer('2.13.0', '2.12.0'));
  assert.ok(!V.isNewer('2.12.0', '2.12.0'));
  assert.ok(!V.isNewer('2.11.0', '2.12.0'));
});

test('v2.13 parseRelease and shouldCheck', () => {
  const r = V.parseRelease({
    tag_name: 'v2.13.0', html_url: 'https://github.com/gatesenman/deal-radar/releases/tag/v2.13.0',
    name: 'Deal Radar 2.13.0', published_at: '2026-11-24T00:00:00Z',
    assets: [{ name: 'DealRadar-Setup-2.13.0-x64.exe', browser_download_url: 'https://example/app.exe', size: 10 }],
  });
  assert.equal(r.version, '2.13.0');
  assert.equal(r.assets[0].name, 'DealRadar-Setup-2.13.0-x64.exe');
  assert.ok(V.shouldCheck(0, 1000));
  assert.ok(!V.shouldCheck(1000, 1000 + 1000));
  assert.ok(V.shouldCheck(1000, 1000 + V.CHECK_EVERY));
});

test('v2.13 withRetry retries retryable errors then succeeds', async () => {
  const waits = [];
  let n = 0;
  const out = await V.withRetry(async () => {
    n++;
    if (n < 3) { const e = new Error('ECONNRESET'); e.code = 'ECONNRESET'; throw e; }
    return 'ok';
  }, { tries: 3, delays: [5, 5], sleep: async (ms) => { waits.push(ms); } });
  assert.equal(out, 'ok');
  assert.equal(n, 3);
  assert.deepEqual(waits, [5, 5]);
});

test('v2.13 withRetry does not retry a 400-style error', async () => {
  let n = 0;
  await assert.rejects(() => V.withRetry(async () => { n++; const e = new Error('URL 无效'); throw e; }, { tries: 3, delays: [1, 1], sleep: async () => {} }));
  assert.equal(n, 1);
});
