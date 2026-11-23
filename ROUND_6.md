# Round 6 — v2.15.0

Date: 2026-11-24 (Asia/Shanghai, UTC+8)

## Goal
Packaging, upgrade safety, and a GitHub Release that includes a Windows installer.

## Changes
- `scripts/pack-release.js` / `npm run pack:source` writes a clean source zip + SHA256 (Python zipfile, no `zip` binary required).
- Tests cover pack excludes, secret scanning, version-stamp agreement, and a v2.9-style config upgrade (deals / filters / secrets).
- GitHub Actions workflow runs `OFFLINE=1 npm test`.
- LICENSE and README are included in the packaged app. Linux dir and Windows NSIS builds were produced on this box.

## Tests
`OFFLINE=1 npm test`: 131 passed, 1 skipped (LIVE).
Linux `electron-builder --linux dir` packaged locales, core v210–v215, and assets.
Windows installer: `DealRadar-Setup-2.15.0-x64.exe` (unsigned NSIS).

## Hashes (SHA256)
- Setup `5072477d622df56384cb4ecfb6d7f5d621adff257ba726b96b2ce58eca1bdfcf`
- Source zip hash is generated after the v2.15.0 commit and attached to the GitHub Release.

## Version
2.15.0 on `main`, tag `v2.15.0`, Release https://github.com/gatesenman/deal-radar/releases/tag/v2.15.0
