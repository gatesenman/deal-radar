# Round 8 — v2.17.0

Validated rollback-safe backup restore

- Validate backup shape and dangerous keys before mutation; stage config/deals/prices and roll back on replacement failure. Preserve device push/AI endpoints and credentials; merge price books; preserve trial lifecycle fields; strip nested auth fields, source URL credentials, proxy URLs and portable push URLs.

## Changed files
```
 M CHANGELOG.md
 M package-lock.json
 M package.json
 M src/core/store.js
 M src/core/v212.js
 M src/locales/zh-CN.json
 M src/main.js
?? ROUND_8.md
?? src/core/backup.js
?? test/v217.test.js
```

## Validation
`OFFLINE=1 npm test` (unit/integration, not UI E2E)
```
ℹ tests 141
ℹ pass 140
ℹ fail 0
ℹ skipped 1
```

## Limitations
Rollback covers in-process write errors, not power loss during multi-file renames. Push credentials stay device-local and must be re-entered on a new device. UI restore limit: 25 MB.
