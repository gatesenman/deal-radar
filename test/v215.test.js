'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const V215 = require('../src/core/v215');
const { Store } = require('../src/core/store');
const V212 = require('../src/core/v212');

const ROOT = path.join(__dirname, '..');

test('v2.15 shouldPack excludes secrets, user data, and build output', () => {
  assert.equal(V215.shouldPack('src/main.js'), true);
  assert.equal(V215.shouldPack('src/locales/en.json'), true);
  assert.equal(V215.shouldPack('LICENSE'), true);
  assert.equal(V215.shouldPack('node_modules/electron/index.js'), false);
  assert.equal(V215.shouldPack('dist/DealRadar-Setup-2.15.0-x64.exe'), false);
  assert.equal(V215.shouldPack('.env'), false);
  assert.equal(V215.shouldPack('userData/config.json'), false);
  assert.equal(V215.shouldPack('httpcache.json.gz'), false);
  assert.equal(V215.shouldPack('id_rsa'), false);
  assert.equal(V215.scanText('hello').ok, true);
  const fake = 'ghp_' + 'a'.repeat(36);
  assert.equal(V215.scanText('token=' + fake).ok, false);
});

test('v2.15 versionStamp requires package / changelog / tag to agree', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const cl = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.equal(V215.nsisName('2.15.0'), 'DealRadar-Setup-2.15.0-x64.exe');
  const stamped = V215.versionStamp({ pkgVersion: pkg.version, changelog: cl, tag: 'v' + pkg.version });
  assert.equal(stamped.ok, true, JSON.stringify(stamped));
  assert.equal(V215.versionStamp({ pkgVersion: '2.15.0', changelog: '## 2.14.0\n', tag: 'v2.15.0' }).ok, false);
});

test('v2.15 source tree has no obvious secrets in packed paths', () => {
  const walk = (dir, out = []) => {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'coverage') continue;
      const p = path.join(dir, name); const st = fs.statSync(p);
      if (st.isDirectory()) walk(p, out); else out.push(path.relative(ROOT, p));
    }
    return out;
  };
  const files = walk(ROOT);
  const packed = files.filter((f) => V215.shouldPack(f));
  assert.ok(packed.some((f) => f.replace(/\\/g, '/') === 'src/locales/zh-CN.json'));
  assert.ok(packed.some((f) => f.replace(/\\/g, '/') === 'src/main.js'));
  assert.ok(!packed.some((f) => /node_modules|dist[/\\]|release[/\\]/.test(f)));
  const texty = packed.filter((f) => /\.(js|json|md|yml|html|css)$/.test(f) && !f.startsWith('test' + path.sep) && !f.startsWith('test/'));
  for (const f of texty) {
    const r = V215.scanText(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    assert.ok(r.ok, f + ' ' + r.match);
  }
});

test('v2.15 upgrade from a v2.9-style config keeps deals and does not drop new settings defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr215-'));
  const cfg = {
    version: 5,
    brands: [{ id: 'openai', name: 'OpenAI', category: 'ai', group: 'llm', enabled: true, preset: true, aliases: [], exclude: [], notify: true, channels: [{ id: 'blog', type: 'rss', url: 'https://openai.com/blog/rss.xml', enabled: true, preset: true }] }],
    sources: [],
    settings: { theme: 'light', onboarded: true, notify: true, intervalMinutes: 20, filterMine: true, channels: [{ id: 'c1', type: 'webhook', url: 'https://example.com/hook', secret: 'S3CR3T-KEY' }] },
    sourceStatus: {},
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
  fs.writeFileSync(path.join(dir, 'deals.json'), JSON.stringify([{ id: 'd1', title: 'Old deal', link: 'https://openai.com/x', brandIds: ['openai'], fav: true, status: 'claimed', fetchedAt: Date.now(), published: Date.now() }]));
  const s = new Store(dir);
  assert.equal(s.deals[0].fav, true);
  assert.equal(s.deals[0].status, 'claimed');
  assert.equal(s.config.settings.theme, 'light');
  assert.equal(s.config.settings.filterMine, true);
  assert.equal(s.config.settings.onboarded, true);
  assert.equal(s.config.settings.intervalMinutes, 20);
  assert.ok(s.config.settings.listFilters);
  assert.equal(s.config.settings.listFilters.sort, 'pub');
  assert.equal(s.config.settings.lastSeenVersion, '');
  assert.equal(s.config.settings.httpCache, true);
  const bak = V212.exportBackup({ config: s.config, deals: s.deals, views: [], prices: {} });
  const dumped = JSON.stringify(bak);
  assert.ok(!dumped.includes('S3CR3T-KEY'));
  fs.rmSync(dir, { recursive: true, force: true });
});
