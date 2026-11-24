# Adapter repair checkpoint

- Baseline inventory: **367** built-in source IDs preserved from v2.21.1 (84 aggregators + 283 vendor channels). Disabled preferences remain in scope.
- `initial.json` is a diagnostic pass, partially resumed after fixing Electron's redirect transport. It is NOT the final verified result and mixes pre-fix and post-fix requests.
- `gap-inspection.json` records short public DOM excerpts from five concrete failures: a regional restriction (Claude docs), contact-sales content missed by the Meta keyword filter, Manus's empty pricing shell, a transient Kimi status response, and Canva's regional redirect to a generic homepage. These are evidence, not instructions to execute.
- Fixed public transport redirects without weakening per-hop URL validation, stopped login/challenge redirects, bounded response sizes, resolved feed links/xml:base, added same-origin advertised-feed discovery, schema-aware empty states, sitemap traversal diagnostics, configuration hints, and preservation of custom preset URLs/options/headers/preferences.
- At this checkpoint: `OFFLINE=1 npm test`: **169 passed, 0 failed, 1 intentionally skipped LIVE test (170 total)**. Real Electron redirect regression: **2 checks passed**. Native Windows installation/upgrade not tested.
- Full verified live pass and final release are still pending. No availability/coverage percentage is claimed. Known blocks must stay blocked, with original evidence retained, rather than being retried or swapped for unrelated sites.
