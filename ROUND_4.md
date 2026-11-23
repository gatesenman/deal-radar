# Round 4 — v2.13.0

Date: 2026-11-24 (Asia/Shanghai, UTC+8)

## Goal
Reliable notifications, and a way to learn about new versions now that GitHub Releases exist.

## Changes
- GitHub Releases update check (manual in Settings, automatic at most once a day). Notifies and opens the release page. Does not auto-install unsigned installers.
- Push channels retry twice on timeout / 5xx / 429 / network errors.

## Tests
`OFFLINE=1 npm test`: 121 passed, 1 skipped (LIVE). `test/v213.test.js` covers semver, parseRelease, shouldCheck, and withRetry.

## Version
2.13.0 on `main`, tag `v2.13.0`.
