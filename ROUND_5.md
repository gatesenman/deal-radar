# Round 5 — v2.14.0

Date: 2026-11-24 (Asia/Shanghai, UTC+8)

## Goal
Performance and everyday polish: keep the list the way you left it, explain upgrades, follow the system theme, and spend less work redrawing during a refresh.

## Changes
- Persist type / validity / sort / region / platform / news filters (not the search box or unread).
- What’s new dialog after an upgrade (skipped during first-run onboarding and screenshot/E2E `SHOT_DIR` runs).
- System theme option; keyboard shortcut help; team / blogger presets; cache size in Settings.
- Mid-refresh state updates reuse the last decorated deal list when no new offers arrived.
- Discover-channel “found on official site” reason uses the i18n catalog.

## Tests
`OFFLINE=1 npm test`: 127 passed, 1 skipped (LIVE).

## Version
2.14.0 on `main`, tag `v2.14.0`.
