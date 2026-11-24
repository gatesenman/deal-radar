# Per-source audit / 逐源核验 — v2.22.0

Completed / 完成: **2026-11-24T12:16:38.134+08:00 (Asia/Shanghai)**.

Inventory / 清单: **367 = 84 aggregators + 283 vendor channels**. Every original ID is preserved, including disabled sources. **20 registered protocols** are separately configuration/fixture-tested; protocols without built-in instances are not invented as extra live successes.

| Outcome / 结果 | Count / 数量 |
|---|---:|
| parsed | 229 |
| rate-limited | 61 |
| blocked | 36 |
| unreachable | 34 |
| login-required | 3 |
| js-only | 1 |
| valid-empty | 1 |
| not-found | 1 |
| coverage-mismatch | 1 |
| **Total / 合计** | **367** |

Live production-pipeline attempts, including DNS/TLS failures before headers: **289 sources**. HTTP/render response headers were captured for **261**; **28** failed before headers. **2** of the live attempts were stopped at a redirect into a previously blocked host. **78 sources** were deliberately stopped using prior explicit host/source block or rate-limit evidence. Their JSON includes the originating source, timestamp and sanitized HTTP evidence; they are NOT claimed as fresh successful requests. The earlier diagnostic passes are retained but not used as the final availability counts.

## Method / 方法

- Electron ClientRequest → production makeFetchText → fetchSource/collect/renderHTML → link/date normalization → brand/offer/facts and structured-price extraction. Code fingerprint: `4b5005c6ed37a5e70674bf48ef09affb3c2679f0c08806827b58f80d7a0a2135` (pipeline files listed in audit script).
- Four workers, one active GET per host, at least 1100 ms host spacing, 12 s HTTP and 18 s audit-render limits. Explicit 401/403/challenges/429 stop the host; no login, paid API, private token, browser-session reuse, or push send. Retry-After is recorded; the audit does not retry rate-limited hosts early.
- 8 MiB public response default, explicit 32 MiB maximum for Cloudflare's full official changelog feed. Sitemaps have bounded traversal with sampling/child-failure metadata. Search-template sources use one representative vendor (OpenAI or Apple), NOT every vendor/query combination. A complete 367-source pass was followed by a page/render-only repair validation (see checkedCodeSHA256 per row and followUpBase/followUpTypes); unchanged feed/API adapters retain the full-pass evidence. Pages establish first baselines; zero detected changes is expected.
- Parsed official news with zero matching deals is healthy parsing, not a deal-coverage measurement. An empty parser or challenge page is never healthy. Legitimate recognized empty feed/API collections are valid-empty. Contact-sales/free/usage-pricing evidence is distinguished from numeric public prices. No 99% coverage claim. Kimi API pricing currently yields real usage/cache/billing terms but no numeric model rates; some pricing tables/regions remain outside structured price-book extraction.
- Results vary by region/time. Host-wide stop policy is conservative: a block on one path suppresses other paths on that host without asserting each path itself returned the same error. Kimi status was intermittently 404 even though a separate application GET extracted genuine status text.
- Optional RSSHub has NO default instance; configure a public self-hosted HTTPS URL and route explicitly. LAN/private-address instances remain blocked by the public-source policy. Optional X/Weibo/WeChat routes are not live-tested, and their absence is not counted as coverage. No credentials were requested or used in this audit.

## Evidence / 证据

- [All 367 sources](SOURCES.md) — IDs, vendors, URLs, adapter, defaults, times, parsed evidence and exact outcomes.
- [Remaining limitations](REMAINING.md) — every non-healthy source ID/URL, exact reason and setup/action.
- [Sanitized machine-readable results](results.json), [immutable v2.21.1 inventory](original-v2.21.1.json), [current inventory](current-inventory.json).
- [Protocol/configuration coverage](protocols.json), [equivalent-replacement provenance](provenance.json), [short public gap excerpts](gap-inspection.json).
- Real public feed fragments in fixtures/ are bounded regression excerpts, not complete scraped pages. All protocols also have explicit mocked production-pipeline tests; these are NOT live E2E tests.
- [Validation summary](validation.json) records exact automated/build/smoke results. Native Windows installer/upgrade, SmartScreen, signed updates and real notification delivery remain untested.
