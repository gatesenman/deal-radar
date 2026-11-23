'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { detectFromUrl, feedsFromHtml, pickOfficialFeed, normalizeUrl } = require('../src/core/v210');
const { VENDOR_CHANNELS, PRESET_BRANDS } = require('../src/core/defaults');

test('v2.10 detectFromUrl: not a URL → null', () => {
  assert.equal(detectFromUrl(''), null);
  assert.equal(detectFromUrl('Claude 的定价页改价提醒'), null);
  assert.equal(detectFromUrl('just some words'), null);
});

test('v2.10 detectFromUrl: RSS / Atom / sitemap / common feed paths', () => {
  const r1 = detectFromUrl('https://github.blog/changelog/label/copilot/feed/');
  assert.equal(r1.type, 'rss');
  assert.equal(r1.sub, 'changelog');
  const r2 = detectFromUrl('https://mistral.ai/news/rss');
  assert.equal(r2.type, 'rss');
  const r3 = detectFromUrl('https://www.langchain.com/blog/rss.xml');
  assert.equal(r3.type, 'rss');
  assert.equal(r3.sub, 'blog');
  const r4 = detectFromUrl('https://mistral.ai/sitemap.xml');
  assert.equal(r4.type, 'sitemap');
  const r5 = detectFromUrl('https://example.com/atom.xml');
  assert.equal(r5.type, 'rss');
  const r6 = detectFromUrl('https://example.com/blog/feed');
  assert.equal(r6.type, 'rss');
  const r7 = detectFromUrl('www.example.com/feed.xml');
  assert.ok(r7 && r7.type === 'rss' && r7.url.startsWith('https://'));
});

test('v2.10 detectFromUrl: GitHub repo, releases.atom, YouTube, Reddit, stores', () => {
  const g = detectFromUrl('https://github.com/huggingface/transformers');
  assert.equal(g.type, 'github');
  assert.equal(g.opts.repo, 'huggingface/transformers');
  assert.equal(g.opts.what, 'releases');
  const g2 = detectFromUrl('https://github.com/langchain-ai/langchain/releases');
  assert.equal(g2.type, 'github');
  assert.equal(g2.opts.what, 'releases');
  const atom = detectFromUrl('https://github.com/langchain-ai/langchain/releases.atom');
  assert.equal(atom.type, 'rss');
  assert.match(atom.url, /releases\.atom/);
  const yt = detectFromUrl('https://www.youtube.com/channel/UCFtEEv80fQVKkD4h1PF-Xqw');
  assert.equal(yt.type, 'youtube');
  assert.equal(yt.opts.channelId, 'UCFtEEv80fQVKkD4h1PF-Xqw');
  const ytrss = detectFromUrl('https://www.youtube.com/feeds/videos.xml?channel_id=UCFtEEv80fQVKkD4h1PF-Xqw');
  assert.equal(ytrss.type, 'youtube');
  const rd = detectFromUrl('https://www.reddit.com/r/GithubCopilot/');
  assert.equal(rd.type, 'reddit');
  assert.equal(rd.opts.sub, 'GithubCopilot');
  const ios = detectFromUrl('https://apps.apple.com/us/app/le-chat/id6740410176');
  assert.equal(ios.type, 'appstore');
  assert.equal(ios.opts.appId, '6740410176');
  assert.equal(ios.opts.country, 'us');
  const gp = detectFromUrl('https://play.google.com/store/apps/details?id=ai.mistral.chat');
  assert.equal(gp.type, 'gplay');
  assert.equal(gp.opts.pkg, 'ai.mistral.chat');
  const tg = detectFromUrl('https://t.me/s/openai');
  assert.equal(tg.type, 'telegram');
  assert.equal(tg.opts.channel, 'openai');
  const bsky = detectFromUrl('https://bsky.app/profile/github.com');
  assert.equal(bsky.type, 'bluesky');
  assert.equal(bsky.opts.handle, 'github.com');
});

test('v2.10 detectFromUrl: official pricing / changelog / discourse / HN', () => {
  const p = detectFromUrl('https://www.microsoft.com/en-us/microsoft-365/copilot/pricing');
  assert.equal(p.type, 'page');
  assert.equal(p.sub, 'pricing');
  assert.ok(p.keyword && p.keyword.includes('$'));
  const stu = detectFromUrl('https://runway.com/educators');
  assert.equal(stu.sub, 'pricing');
  const ch = detectFromUrl('https://docs.mistral.ai/getting-started/changelog/');
  assert.equal(ch.type, 'page');
  assert.equal(ch.sub, 'changelog');
  const d = detectFromUrl('https://forum.cursor.com/latest');
  assert.equal(d.type, 'discourse');
  assert.equal(d.sub, 'forum');
  const hn = detectFromUrl('https://news.ycombinator.com/?q=Cursor');
  assert.equal(hn.type, 'hn');
  assert.equal(hn.opts.query, 'Cursor');
});

test('v2.10 feedsFromHtml: rel=alternate and feed anchors; official host preferred', () => {
  const html = `
    <html><head>
      <link rel="alternate" type="application/rss+xml" title="Mistral" href="https://mistral.ai/news/rss">
      <link rel="alternate" type="application/atom+xml" title="Comments" href="https://third-party.example/comments/atom">
    </head><body>
      <a href="/blog/feed.xml">RSS feed</a>
    </body></html>`;
  const feeds = feedsFromHtml(html, 'https://mistral.ai/news');
  assert.ok(feeds.length >= 2, JSON.stringify(feeds));
  assert.ok(feeds.some((f) => f.url === 'https://mistral.ai/news/rss'));
  assert.ok(feeds.some((f) => /feed\.xml$/.test(f.url)));
  const official = pickOfficialFeed(feeds, 'https://mistral.ai/news');
  assert.ok(official);
  assert.equal(official.url, 'https://mistral.ai/news/rss');
});

test('v2.10 official sources: Mistral news RSS, Meta API page, MS Copilot blog + HN', () => {
  const mistral = VENDOR_CHANNELS.mistral || [];
  assert.ok(mistral.some((c) => c.id === 'news-rss' && c.type === 'rss' && c.url === 'https://mistral.ai/news/rss'), JSON.stringify(mistral.map((c) => c.id)));
  const meta = VENDOR_CHANNELS.meta || [];
  assert.ok(meta.some((c) => c.id === 'llama-api' && /dev\.meta\.ai/.test(c.url) && c.sub === 'pricing'), JSON.stringify(meta.map((c) => c.id)));
  const ms = VENDOR_CHANNELS['ms-copilot'] || [];
  assert.ok(ms.some((c) => c.id === 'ms-blog-copilot' && c.type === 'rss' && /microsoft-copilot\/feed/.test(c.url)));
  assert.ok(ms.some((c) => c.id === 'hn' && c.type === 'hn' && /Copilot/i.test((c.opts || {}).query)), 'ms-copilot should have HN query');
  const onIds = new Set(PRESET_BRANDS.filter((b) => b.on && b.category === 'ai').map((b) => b.id));
  assert.ok(onIds.has('ms-copilot') && onIds.has('github-copilot'));
});

test('v2.10 normalizeUrl accepts protocol-less official hosts', () => {
  const u = normalizeUrl('mistral.ai/news/rss');
  assert.equal(u.origin, 'https://mistral.ai');
  assert.equal(normalizeUrl('not a host'), null);
});

test('v2.10 upgrade: new official preset channels appear without wiping user data', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { Store } = require('../src/core/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr210-'));
  const s0 = new Store(dir);
  const meta0 = s0.config.brands.find((b) => b.id === 'meta');
  assert.ok(meta0);
  meta0.channels = (meta0.channels || []).filter((c) => c.id !== 'llama-api');
  const kept = { id: 'user-keep', type: 'rss', name: '我的源', url: 'https://example.com/mine.xml', sub: 'blog', enabled: true, preset: false };
  meta0.channels.push(kept);
  s0.saveConfig();
  const s1 = new Store(dir);
  const meta1 = s1.config.brands.find((b) => b.id === 'meta');
  assert.ok(meta1.channels.some((c) => c.id === 'llama-api' && c.preset), 'new preset channel injected');
  assert.ok(meta1.channels.some((c) => c.id === 'user-keep' && c.url === 'https://example.com/mine.xml'), 'user channel kept');
});
