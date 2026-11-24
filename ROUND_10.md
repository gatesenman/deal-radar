# Round 10 — v2.19.0

Rate-limit-aware source recovery

- Honour seconds and HTTP-date Retry-After (max 24h), persist cooldowns through collector status and do not bypass server cooldown on manual refresh. Keep last successful check across outages; reset streaks on recovery. Authenticated HTTP responses no longer populate the public URL cache.

## Changed files
```
 M CHANGELOG.md
 M package-lock.json
 M package.json
 M src/core/http.js
 M src/core/monitor.js
 M src/core/v26.js
 M src/main.js
?? src/core/source-health.js
?? test/v219.test.js
```

## Validation
`OFFLINE=1 npm test` (unit/integration, not UI E2E)
```
ℹ tests 150
ℹ pass 149
ℹ fail 0
ℹ skipped 1
```

## Limitations
Cooldowns are per source, not a host-wide distributed circuit breaker. Header deadlines above 24h are capped. Live rate-limited vendors were not probed; tests use injected responses only.
