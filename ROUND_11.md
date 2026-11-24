# Round 11 — v2.20.0

Persistent push delivery reservations

- Reserve per-channel offer/digest/trial keys on disk before external POSTs; deduplicate overlapping saved views and process restarts. Separate daily/weekly scopes. Bound request timeout and stop blindly retrying ambiguous POST outcomes; mask legacy push error bodies.

## Changed files
```
 M CHANGELOG.md
 M package-lock.json
 M package.json
 M src/core/v28.js
 M src/main.js
?? src/core/delivery-ledger.js
?? test/v220.test.js
```

## Validation
`OFFLINE=1 npm test` (unit/integration, not UI E2E)
```
ℹ tests 155
ℹ pass 154
ℹ fail 0
ℹ skipped 1
```

## Limitations
At-most-once preference, not exactly-once: crashes or lost acknowledgements can suppress a message for 30 days. Failed/unknown deliveries are not automatically retried. Providers without idempotency keys cannot guarantee delivery and dedup simultaneously. No real external push was sent.
