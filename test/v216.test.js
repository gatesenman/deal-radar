'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertPublicURL, privateIP } = require('../src/core/network-policy');
const { makeFetchText } = require('../src/core/http');
const { mask } = require('../src/core/v28');
test('v216 source URL blocks private literals, credentials and mixed DNS', async () => {
  for (const u of ['file:///etc/passwd', 'http://127.1/', 'http://0x7f000001/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://localhost/', 'https://foo.local/', 'https://user:pass@example.com/']) await assert.rejects(assertPublicURL(u));
  await assert.rejects(assertPublicURL('https://official.example/', { lookup: async () => [{ address: '1.1.1.1' }, { address: '10.0.0.1' }] }));
  assert.equal(await assertPublicURL('https://example.com/'), 'https://example.com/');
  assert.equal(privateIP('169.254.169.254'), true);
});
test('v216 redirects revalidate before a second request', async () => {
  let n = 0;
  const ft = makeFetchText(async () => { n++; return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/' } }); });
  await assert.rejects(ft('https://example.com/'), /Private/);
  assert.equal(n, 1);
});
test('v216 cross-origin redirects strip sensitive headers', async () => {
  const requests = [];
  const ft = makeFetchText(async (url, init) => { requests.push({ url, headers: {...init.headers} }); return requests.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://other.example/' } }) : new Response('ok'); });
  assert.equal(await ft('https://example.com/', { headers: { Authorization: 'private', Cookie: 'secret' } }), 'ok');
  assert.equal(requests[1].headers.Authorization, undefined);
  assert.equal(requests[1].headers.Cookie, undefined);
});
test('v216 push URL and token are masked before renderer', () => {
  const out = mask({ url: 'https://example.com/SECRET', token: 'token-private', secret: 'secret-private' });
  assert.equal(out.url, '••••'); assert.equal(out.hasUrl, true);
  assert.ok(!JSON.stringify(out).includes('SECRET'));
});
