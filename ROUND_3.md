# Round 3 — v2.12.0

Date: 2026-11-24 (Asia/Shanghai, UTC+8)

## Goal
Close remaining user-facing gaps: finer feedback, visible corroboration, and a full local backup for moving to another PC.

## Changes
- Feedback reasons: not an offer, expired, not-for-me, duplicate, too-small.
- Detail pane: official confirmation + "confirmed by N sources".
- Full backup/restore (format 3): deals, views, prices, settings. Push secrets and AI keys are stripped. Merge keeps claimed/favorites.

## Tests
`test/v212.test.js`. `OFFLINE=1 npm test`: 117 passed, 1 skipped (LIVE), 0 failed.

## Version
2.12.0 on `main`, tag `v2.12.0`.
