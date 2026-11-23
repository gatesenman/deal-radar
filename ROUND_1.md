# Round 1 — v2.10.0

Date: 2026-11-24 (Asia/Shanghai, UTC+8)

## Goal
Close a few official-source gaps and make channel protocol detection work instantly when a user pastes a URL, without adding niche sources.

## Changes
- New `src/core/v210.js`: `detectFromUrl`, `feedsFromHtml`, `pickOfficialFeed` (no network).
- Add-channel modal: paste (and URL-field blur) calls `channel:detect` and fills protocol/fields. The existing “识别” flow still fetches the page and can find `<link rel="alternate">` feeds.
- Official preset channels (verified HTTP 200):
  - Mistral news RSS `https://mistral.ai/news/rss`
  - Microsoft blog tag feed `https://blogs.microsoft.com/blog/tag/microsoft-copilot/feed/`
  - Meta Llama API page `https://dev.meta.ai/` (page monitor)
  - `HN_QUERY` for Microsoft Copilot
- Upgrade path: store migration already injects missing preset channels and keeps user channels/enabled flags. Covered by a unit test.
- Genspark and Midjourney official pricing/blog URLs were probed but returned 403 / bot walls, so they were not added.

## Tests
`OFFLINE=1 npm test`: 109 passed, 1 skipped (LIVE network), 0 failed. `test/v210.test.js` covers URL detection, HTML feed extraction, official source presence, and upgrade-safe injection.

## Version
2.10.0 on `main`, tag `v2.10.0` (source tag; installer may wait until the final round).
