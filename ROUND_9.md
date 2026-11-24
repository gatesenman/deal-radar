# Round 9 — v2.18.0

Conservative expiry and currency interpretation

- Reject impossible calendar dates and ambiguous numeric dates; honour explicit zoned ISO deadline instants. Parse grouped/European price amounts and explicit JPY/regional currency. Start fresh price history on currency switches; soft-404 requires confirmation.

## Changed files
```
 M CHANGELOG.md
 M package-lock.json
 M package.json
 M src/core/facts.js
 M src/core/v26.js
 M src/core/v27.js
?? test/v218.test.js
```

## Validation
`OFFLINE=1 npm test` (unit/integration, not UI E2E)
```
ℹ tests 146
ℹ pass 145
ℹ fail 0
ℹ skipped 1
```

## Limitations
Date-only deadlines remain end-of-day in the device timezone; ambiguous dollar/yen symbols retain legacy USD/CNY defaults unless explicit currency or a caller hint exists. No new live coverage measurement.
