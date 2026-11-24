# Validation — v2.21.0

Date: 2026-11-24, Asia/Shanghai (UTC+8)

## Automated tests

`OFFLINE=1 npm test`: **157 passed, 0 failed, 1 skipped** (158 total).
The skipped case is the existing LIVE vendor/source reachability test. These are unit/integration tests, not full E2E.

## Real Electron smoke (isolated Linux/Xvfb)

`npm run smoke`: **12/12 checks in zh-CN and 12/12 in en**.
`SMOKE_APP=dist/linux-unpacked/deal-radar npm run smoke`: **12/12 checks in each language** on the packaged Linux executable.

The runner seeds a synthetic version-5/v2.9-style configuration and one favourite/claimed offer in a temporary user-data directory. It checks:
- launch, current version, retained favourite/claimed state and rendered offer;
- Settings, system-theme option and translated search label;
- dialog role/title, Tab and Shift-Tab focus loop, focus return;
- settings IPC plus persisted filter values on disk;
- backup export/import through real Electron IPC and retained offer count;
- rendered source-health table.

HTTP(S) network requests are blocked during this smoke. There are no push credentials, real push tests, third-party logins or user-PC changes. Fixture screenshots/process logs are retained outside the checkout at `/workspace/dealradar-backups/smoke-*-v221*`.

## Packaging checks

Windows NSIS x64 installer built with Electron 33.4.11 / electron-builder 25.1.8. Unsigned.
ASAR inspected for the correct package version, LICENSE, both locale catalogs and new security/backup/health/delivery modules. Source text scanned for known token/private-key patterns; `.env`, `.git`, test directories and user-data JSON excluded. Installer PE header checked. This is **not** proof of native Windows installer execution.

Clean source ZIP uses tracked files only, excludes node_modules and rebuildable output, scans source text, and has a single `DealRadar-2.21.0/` root. SHA256 values are in the Release `SHA256SUMS.txt`; no self-referential checksum in this document.

## Not tested / remaining limitations

- No native Windows install, interactive upgrade, tray/autostart, DPAPI or uninstall-path test in this run. No screen-reader audit, visual-contrast audit or complete UI E2E.
- Synthetic migration fixtures are not a substitute for an upgrade of every historical real user database. Multi-file restore rolls back caught errors but is not power-loss atomic.
- Source URL guards do DNS preflight, not IP-pinned transport. DNS rebinding, resolver/proxy differences and the privileged Electron main process remain security boundaries. Private-network RSSHub URLs are now blocked for collection.
- AI and push endpoints are explicitly user-trusted and separate from public-source restrictions. Push secrets remain device-local but are not encrypted at rest; masking and portable-export redaction do not change that.
- Push dedup prefers avoiding duplicates: pending/unknown acknowledgements suppress retries for up to 30 days. A crash after reservation can lose a notification. Exactly-once delivery is not promised. Manual push-test requests are intentionally separate and not part of automatic dedup.
- Date-only expiry uses the device timezone; ambiguous bare currency symbols retain legacy defaults. No claim of 99% or new measured coverage.
