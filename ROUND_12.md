# Round 12 — v2.21.0

Accessible modal navigation and reproducible release validation

- Add labelled modal semantics, keyboard focus trapping/return, search labels, live toast roles, visible focus and reduced-motion support. Add network-blocked Electron smoke for zh/en, upgrade fixtures, settings and backup IPC, also run by CI. Package tracked files only with source scans and a stable ZIP root. Add bilingual current-version notes and updated limitations.

## Changed files
```
 M .github/workflows/test.yml
 M CHANGELOG.md
 M README.en.md
 M README.md
 M package-lock.json
 M package.json
 M scripts/pack-release.js
 M src/core/v214.js
 M src/locales/en.json
 M src/locales/zh-CN.json
 M src/main.js
 M src/renderer/app.js
 M src/renderer/index.html
 M src/renderer/styles.css
?? ROUND_12.md
?? VALIDATION_2.21.md
?? scripts/smoke-electron.js
?? test/v221.test.js
```

## Validation
`OFFLINE=1 npm test` (unit/integration, not UI E2E)
```
ℹ tests 158
ℹ pass 157
ℹ fail 0
ℹ skipped 1
```

## Limitations
Native Windows installer/upgrade, screen readers and full UI E2E were not tested. See VALIDATION_2.21.md for actual Linux packaged/source UI smoke outcomes and security limitations.

## Actual UI and packaging validation
- Source Electron/Xvfb smoke: 12/12 checks per language (zh-CN, en).
- Packaged Linux executable smoke: 12/12 per language.
- Windows NSIS x64 build and ASAR/PE structural checks passed; native Windows install/upgrade not executed.
- See `VALIDATION_2.21.md`; final checksums are attached to the Release.
