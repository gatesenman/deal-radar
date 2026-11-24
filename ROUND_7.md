# Round 7 — v2.16.0

Public source network boundary

- Block private source URLs, URL credentials and mixed public/private DNS answers. Revalidate redirects, strip cross-origin auth/cookie headers; hidden renderer guards HTTP/file subrequests. Mask push endpoint URLs and raw settings channels before IPC.

## Changed files
```
 M CHANGELOG.md
 M package-lock.json
 M package.json
 M src/core/http.js
 M src/core/v28.js
 M src/main.js
 M src/render.js
?? src/core/network-policy.js
?? test/v216.test.js
```

## Validation
`OFFLINE=1 npm test` (unit/integration, not UI E2E)
```
ℹ tests 136
ℹ pass 135
ℹ fail 0
ℹ skipped 1
```

## Limitations
DNS preflight is not IP-pinning: DNS rebinding/proxy resolution remains a limitation. Explicit AI and push endpoints are separate user-configured trust boundaries; push settings are not encrypted at rest.
