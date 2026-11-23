# Round 2 — v2.11.0

Date: 2026-11-24 (Asia/Shanghai, UTC+8)

## Goal
Fewer wrong "still valid" or "page changed" style judgments: better landing-page expiry, deadline parsing, and price extraction.

## Changes
- `judgeLanding`: soft 404 from title or short body (Page not found / 页面不存在); long pages that merely mention 404 stay active. More ended phrases in English and Chinese.
- `parseDeadline`: labeled Chinese/ISO dates, numeric `11/30/2026` vs `31/12/2026`, and relative "ends in 3 days" / "还有 2 周".
- `extractPrices`: `USD 20 / month`, `9 pounds a month`, `dollars` / `euros` / `pounds` units.

## Tests
`test/v211.test.js` plus existing v2.3 / v2.6 / v2.7 cases. Full suite: see commit message.

## Version
2.11.0 on `main`, tag `v2.11.0` (source tag).
