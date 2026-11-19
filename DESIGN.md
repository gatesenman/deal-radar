# Deal Radar (全网优惠雷达) — Design Notes for Reviewers

## Stack
- Electron 33, plain HTML/CSS/JS renderer (no framework, no build step), `fast-xml-parser` + `node-html-parser` as the only runtime dependencies.
- No native modules, so Windows builds cross-compile from Linux (electron-builder: NSIS installer + portable exe; wine is used only for rcedit/NSIS uninstaller).
- Persistence: JSON files in `userData` (`config.json`, `deals.json`) with atomic write (tmp + rename) and debounced saves. Corrupt files fall back to defaults.

## Layout
```
src/
  main.js            Main process: window (frameless, custom title bar), tray, notifications, IPC, scheduler, proxy, test modes
  preload.js         contextBridge: window.api.call(channel, ...args) / window.api.on(channel, fn)
  core/
    defaults.js      Preset brands (20), preset sources (29), known-unavailable list, default settings
    feed.js          RSS 2.0 / Atom / RDF parser + CheapShark JSON; HTML stripping, entity decoding, image extraction
    matcher.js       Brand matching (word-boundary for Latin, substring for CJK, exclude words), deal-word detection, price/discount extraction
    monitor.js       fetchSource (per-source fetch+parse+filter, retry on 429/5xx/anti-bot), runAll (same-host serial, cross-host parallel), mergeDeals (dedupe/retention/cap), CSV
    store.js         Config/deals persistence, brand/source CRUD, migration of preset sources across versions
  renderer/          index.html, styles.css (dark/light via CSS variables), app.js (state, rendering, events, e2e hooks)
test/core.test.js    node:test unit tests (offline fixtures) + one LIVE test hitting every preset source
scripts/live-check.js  Prints per-source live status table
```
## Data flow
1. Scheduler (`poll()` in main) runs on start, on manual refresh, and every N minutes (setTimeout chain; `nextRunAt` exposed to UI).
2. `runAll` groups enabled sources by hostname; each host group runs sequentially with a 1.5 s gap (avoids Reddit/Google 429), groups run 6-way parallel. Every source is isolated: errors become `status.error`, never exceptions.
3. Network goes through Electron `net.fetch` (Chromium stack → honours system proxy, or user-set custom proxy via `session.setProxy`). 15 s timeout, Chromium error codes mapped to Chinese messages.
4. Source kinds:
   - `deal` (deal communities): item kept if title/categories match an enabled brand.
   - `news` (newsrooms, IT之家, SMZDM articles): brand match AND deal wording in title (strict: price alone is not enough).
   - `search` (Google News / Bing News templates with `{q}`): one request per enabled brand; title must contain that brand and title+summary must look like a deal.
5. `mergeDeals` dedupes by normalised link hash (tracking params stripped) and by normalised title per source; merges brand ids; drops non-favourite items older than `maxAgeDays`; caps to `maxDeals` (favourites always kept).
6. New items → desktop notifications (individual up to `notifyMax`, else one summary; suppressed on very first run with empty DB to avoid a flood). Click opens the deal.
7. Results are streamed: each source's items are merged and pushed to the UI as soon as that source finishes (throttled 600 ms), so the list fills progressively during the first scan.
8. Sources that failed are retried once, alone, 90 s after the poll (handles network-not-ready at login, transient timeouts/429). Changing the proxy triggers an immediate re-scan.
9. Main pushes full state to renderer (`state` event); renderer filters/sorts locally (publish time / found time / discount) and paginates (120 per page, "load more"). Optimistic local read/fav changes are overlaid for 5 s so an in-flight older state push cannot revert them.

## UI
- Window size/position/maximised state is remembered (reset to default if the saved position is off-screen). Optional auto-start at Windows login (starts hidden in tray).
- Frameless window, custom title bar with search and min/max/close (close → tray when enabled), left sidebar (views + enabled brands with unread counts + radar status), toolbar per view, bottom status bar (state, last/next refresh countdown, source health, totals).
- Views: 优惠动态 (cards/table + detail side panel), 我的收藏, 品牌管理 (card grid, add/edit modal with presets, excludes, toggle, delete with confirm), 数据源 (grouped table, per-source & per-group toggle, live test, custom RSS modal, explanation of unavailable platforms), 设置 (interval, retention, pause, notifications, theme, tray, start minimised, proxy, data dir, clear, reset), 运行日志.
- Empty states for: first fetch (skeletons), no brands enabled, all sources failing (link to proxy settings), no filter results, no favourites.
- Image errors fall back to coloured brand-initial placeholders. All feed text is HTML-escaped before rendering; CSP blocks inline/remote scripts; external links open in the system browser only (window.open and navigation are intercepted).

## Testing
- `npm test` — 20 tests (`OFFLINE=1` skips the live one) (parsers, matcher, dedupe, retry, host serialisation, CSV, store CRUD/persistence/corruption, live sources ≥80% OK).
- `scripts/run-ui-tests.sh` runs all three UI modes below. `scripts/live-check.js` prints a live per-source table.
- `DEAL_RADAR_SHOT=<dir> electron .` under xvfb — real fetch + screenshots of all screens; `DEAL_RADAR_SHOT_SET=e2e` drives the real DOM through 34 interaction checks (search, filters, favourite, detail, table, add/edit/dup/toggle brand, custom RSS add+test+delete, settings, proxy validation, mark-all-read, load more, CSV export, persistence on disk); `DEAL_RADAR_SHOT_SET=offline` with a dead proxy checks graceful all-failed handling.

## Known limitations
- "全网" is really: the 26 listed feeds + Google/Bing News search. E-commerce sites (Taobao/JD/PDD/Amazon) need login or are heavily anti-bot and aren't scraped.
- Some sources can intermittently rate-limit/anti-bot (Reddit 429, SMZDM JS challenge, TechBargains Cloudflare). One retry is attempted; failures are surfaced per source.
- From mainland China, Google News/Reddit and several overseas sites need a proxy (system proxy is honoured by default).
- Windows build is unsigned (SmartScreen warning). Notifications/tray were exercised on Linux/Xvfb only as far as possible; Windows behaviour relies on Electron's standard APIs (AppUserModelId is set for toasts).

## Windows build verification
- Built on Linux with electron-builder + wine (rcedit sets exe icon/version; NSIS installer is assisted, Chinese language, choosable install dir, desktop/start-menu shortcuts).
- v1.1.0: the NSIS installer was installed silently under wine (`/S`), the installed exe passed all 35 e2e checks (`DEAL_RADAR_SHOT_SET=e2e`), the portable exe rendered every screen with live data (`screenshots/final-7-*`), and a normal (non-test) portable run created `config.json`/`deals.json` plus the Start-menu shortcut used for toast notifications. This is a smoke test, not a substitute for a real Windows 10/11 run.
- Curated screenshots: `screenshots/final-*.png` (raw test shots are regenerated by `scripts/run-ui-tests.sh` and git-ignored).

## v1.1.0 review changes (independent reviewer)
- Matching: accessory-context filter (`for/für/pour/para… iPhone`, `适用于/兼容…` → not a brand deal unless the brand also appears outside that phrase); strict news wording drops loose words (offer/补贴/限时/券→优惠券/领券), ignores bare percentages and negations (「无降价」), `A-70%` energy labels and 「3折叠」; price extraction skips credit/cashback/"save $X"/"$X off" amounts.
- Feeds: double-escaped HTML in summaries is stripped; Pepper `123° - ` heat prefix becomes a `heat` field; per-source `skip` regex (V2EX 收/求购/拼车).
- Sources: + 快科技 (mydrivers), cnBeta, Android Police deals (all verified live, no login). Total 29.
- Store: corrupt JSON is backed up (`*.corrupt-<ts>`) before falling back; writes retry on Windows EPERM/EBUSY then fall back to direct write and never throw; settings are clamped; brand `notify` flag; config `version: 2` with onboarding flag (existing users skip onboarding); deals cap 3000.
- Main: uncaughtException/unhandledRejection are logged instead of crashing; notifications are retained until closed (Windows GC drops click handlers otherwise); per-brand notification mute; poll requests during a running poll are queued (new brands scanned immediately after); failed-source retry no longer pushes back the main schedule; resume/unlock triggers an overdue refresh; portable build uses `PORTABLE_EXECUTABLE_FILE` for auto-start and creates a Start-menu shortcut with the AppUserModelId so Windows toasts are delivered; `notify:test`, `net:check`, `deal:remove`, `brand:notify`, `brand:enableOnly` IPC.
- UI: first-run welcome (brand chips + proxy choice); proxy port presets (Clash 7890 / Clash Verge 7897 / v2rayN 10809 / SOCKS5 1080) + connectivity check; banner when ≥3 overseas sources fail for network reasons; heat tags; brand bell toggle; subtle delete buttons; full (uncropped) thumbnails; human countdown; max/restore icon; double-click title bar; proxy input not overwritten by background pushes; detail panel not re-rendered unless changed.

## v1.2.0：AI / 软件厂商优惠 + 每厂商多渠道

- **数据模型**：`brand = { id, name, aliases, exclude, category: 'ai'|'goods', cs, noName, enabled, notify, channels[] }`；`channel = { id, type: 'rss'|'page'|'search', sub, name, url, keyword, selector, enabled, preset }`。全局 `sources` 只放跨厂商的聚合源（新闻搜索、HN、Reddit、V2EX…），带 `category`。配置版本 3，迁移时补齐预置厂商/渠道并保留用户状态。
- **抓取**：`monitor.channelSources(brands)` 把启用厂商的渠道展开成数据源（`kind: vendor|page`，固定归属 `vendor`），与全局源一起交给 `runAll`（同主机串行、并发 6）。厂商只与同 `category` 的数据源匹配。
- **优惠识别**（`core/offers.js`）：正则规则把标题（官方渠道再加摘要前 200 字）分为 free / discount / credits / student / startup / event / plan / pricing；先去掉否定说法，暂停/结束/汇总类标题直接判为非优惠；单独的 event 需要强促销词。官方渠道全部保留（无类型 = 「资讯」，默认隐藏、不通知）；聚合源必须「标题含厂商 + 有优惠类型」，提问帖排除。
- **网页变化监控**（`core/page.js`）：node-html-parser 去掉 script/style/nav/footer → 按块级标签切行 → 可选 CSS 选择器 / 关键词行过滤 → 按行集合求 SHA1 指纹（只是顺序变化不算变化）。首次检测建立基线；变化时按行集合求差，生成一条动态（标题取第一条新增行，摘要为 +/- 片段，价格页自动带 `pricing` 类型）。快照保存在 `pages.json`。如果检测到人机验证页（Cloudflare 的 Just a moment 等），渠道标为失败并写明原因。
- **界面**：「AI 优惠」（默认只看优惠，「含资讯」开关）/「实物优惠」（可选）/「厂商与渠道」（分组卡片 → 厂商详情：渠道表格、快照、最新动态）/「聚合数据源」。

## v2.0.0：专业雷达（协议适配器 / 源健康 / 规则引擎）

- **协议适配器**（`core/collectors.js`）：`PROTOCOLS` 注册表（20 种）。渠道 = `{ type, opts, url?, keyword?, interval, timeout, ua, headers, proxy, include, exclude, regex, render, flaky }`。`requestUrl(ch, ctx)` 负责构造请求（GitHub Atom/API、HN Algolia、Reddit RSS、Discourse JSON、t.me/s、Bluesky getAuthorFeed、Mastodon lookup→statuses / tag、iTunes lookup、Play 详情页、RSSHub 基址、Google/Bing 新闻），对应解析器输出统一条目，最后 `filterItems`（包含 / 排除 / 正则）。状态型协议（page / render / sitemap）走 `monitor.fetchPage` 的快照对比；sitemap 会展开 sitemapindex（取最后 4 个），首轮建基线，之后每轮最多产出 20 个新 URL。`store.normalizeChannel` 按协议校验必填项。
- **JS 渲染**（`src/render.js`）：离屏隐藏 BrowserWindow（独立分区 `persist:render`，最多 2 个并发），遇到 Cloudflare 等待页会持续等待到超时，取 `document.body.innerText`。
- **HTTP 层**（`core/http.js`）：统一 UA / 请求头 / 超时；内存 LRU 缓存（400 条）存 ETag / Last-Modified，发条件请求，304 直接复用正文（`cached`，计入缓存命中）；错误带 `status` 和 `Retry-After`。`proxy:false` 的渠道走 `persist:direct` 直连会话。
- **调度**（`monitor.runAll`）：按主机分组串行（`hostGap`，Reddit 7 s），组间并发（`concurrency`，默认 6），渲染任务单独成组；`withRetry` 对 429 / 5xx / 连接重置重试并遵守 Retry-After（≤20 s）；`skipReason` 实现渠道独立周期与指数退避（连续失败 n≥2 次 → 跳过 min(2^(n-1)×15 分钟, 6 小时)），手动刷新强制全部运行。
- **源健康**（`health.json`）：每个源最近 40 次 `{t, ok, ms, n, c(cached), e}`；界面汇总 KPI、按协议分布、成功率迷你图、运行日志。
- **去重与评分**（`core/dedupe.js`）：`canonicalUrl` 去掉跟踪参数 / www / m. / amp 并统一 https；`mergeDeals` 对 3 天内不同来源、标题 Dice 相似度 ≥0.82 的条目合并，记录 `sources[]`；`scoreDeal` 按优惠类型权重、官方渠道、来源数、热度、标题线索计算 0–100。
- **规则引擎**（`core/rules.js`）：规则 = 厂商 ∧ 优惠类型 ∧ 关键词（任一）∧ ¬排除词 ∧ 重要度≥阈值 → `notify / sound / highlight`。新条目先过规则，命中 `notify` 的按重要度排序后弹通知，命中 `sound` 时渲染进程用 WebAudio 提示音。取代 v1 的「只通知优惠」硬编码。
- **导入导出**（`core/opml.js`）：OPML 2.0（按厂商分组）导入导出；完整配置 JSON 导入导出（保留已抓取的优惠）。
- **配置迁移**：版本 4。v2.0 新增的预置厂商对老用户默认关闭；被移除的冷门预置厂商若已启用则转为自定义厂商保留，未启用则删除。
- **来源取舍**：按用户要求「不要冷门的」——只保留主流厂商与官方 / 权威渠道；数量让位于质量。全量实测脚本 `scripts/live-channels.js`（Electron 下可测渲染渠道），结果写入 `test/live-channels.json`。
- **测试**：`npm test` 增加 `test/v2.test.js`（协议 URL 构造与解析、JSON/HTML/JSON Feed/App Store/Bluesky、过滤、去重 / 合并、规则、OPML 往返、渠道校验、退避、ETag 304、预置源质量约束）；e2e 增加协议切换与测试预览、源健康、运行日志、规则增删改、时间线、重要度排序、快捷键、OPML / 配置导出、引擎设置校验。
- **Windows 冒烟（wine）**：v2.0.0 安装版静默安装后 e2e 68/68 通过；便携版在 wine 下完成全部 30 张截图（`screenshots/final2-wine-*`）。wine 网络栈下部分境外源会超时，这不代表真实 Windows 上的表现。

## v2.1.0：AI 辅助添加厂商 / 渠道

- **`core/ai.js`**：OpenAI 兼容 `/chat/completions` 客户端（`makeLLM`），超时（60 s）、可取消（AbortSignal）、`response_format: json_object` 不被支持时自动降级重试；错误按 401/403/404/429 给出中文提示；`extractJSON` 容忍代码块与前后文字；`redact()` 把 Key、`sk-…`、`Bearer …` 全部替换为 `***`，所有日志 / 错误 / 进度文本都经过它。服务商预设：DeepSeek、通义 / 百炼、Kimi、智谱、豆包 / 方舟、OpenAI、自定义（OpenRouter / Ollama…）。
- **Key 存储**：主进程用 `safeStorage.encryptString`（Windows 上是 DPAPI）加密后以 base64 存到 `config.json` 的 `settings.ai.keyEnc`；渲染进程只拿到 `{ hasKey, keyHint: "sk-…1234", encrypted }`。`exportConfig` 不导出 Key；`updateSettings` 拒绝修改 `ai`（只能走 `ai:save`）。加密不可用（如无钥匙串的 Linux）时只保存在内存中，不落盘。
- **`core/discover.js` → `discoverVendor(name)`**：搜索（Bing `<cite>` 解析 + Wikidata `wbsearchentities` / `wbgetentities` 的 P856 官网、P2397 YouTube、P2037 GitHub、P12361 Bluesky、P4033 Mastodon、P3861 App Store、P3418 Google Play、P3789 Telegram 及中英文别名；DuckDuckGo HTML 作为备用）→ `rankDomains` 打分（名称或 Wikidata 英文别名出现在域名中加分，否则降为 30%；百科、媒体、社交平台、`-free/-zh` 等导流站排除）→ 可选 AI 确认官方域名（只能从搜索结果 / Wikidata 中选）→ 爬取首页与博客 / 更新日志页做 RSS 自动发现 + 15 个常见订阅路径 + sitemap 探测 + 链接分类 → 社交 / 应用商店 / GitHub（组织 → 按 star 取前 2 个仓库）/ YouTube @handle 解析 → 固定加入新闻搜索与 HN → 可选 AI 归类（keep / sub / 中文名 / page 关键词 / 别名 / 排除词 / ≤4 个官网域名下的补充地址）→ 4 并发实测（复用 `fetchSource`，与正式抓取完全一致；page 被拦截自动试 render；关键词过严自动去掉重试）→ 默认勾选规则（实测成功且有内容、非重复订阅、AI 未剔除、最多 14 个）。全过程通过 `onStep` 推送进度，AbortSignal 贯穿所有请求以支持「停止」。
- **`discoverChannel(input)`**：URL → `platformChannel`（GitHub / YouTube / Reddit / Bluesky / Telegram / App Store / Play / HN / Mastodon）→ 抓取后按内容判断：feed / sitemap / JSON（`guessJson` 找最像条目列表的数组并猜字段）/ 人机验证或正文 <200 字 → render / 声明了订阅源 → rss / 价格页 → page（自动选 main 等区域）/ 列表页 → AI 选择器（`parseHtmlList` 验证 ≥3 条）或 `guessListSelector`（同前缀链接计数）→ 兜底 page。自然语言 → AI 给出官方 URL 与意图后再走 URL 分析；无 AI 时按意图词（定价 / 学生 / 更新日志 / 博客 / 状态…）在厂商已有渠道的官网主机上探测常见路径，最后退回新闻搜索。
- **IPC**：`ai:save`、`ai:test`、`discover:vendor(jobId, name)`（进度事件 `discover:progress`）、`discover:channel(jobId, input, brandId)`、`discover:cancel(jobId)`、`discover:commit({ vendor, channels, existingId })`（建厂商 + 批量建渠道，重复地址跳过，随后立即抓取该厂商）。
- **测试**：`test/ai.test.js`（JSON 提取、脱敏、客户端对本地模拟服务器的成功 / 401 / 404 / 取消 / 超时、域名排序、离线夹具端到端发现、AI 参与时的别名 / 排除词 / 拒绝域外建议 / 取消、渠道识别的 8 种情形 + 自然语言有无 AI）。`src/mock-llm.js` 是确定性的本地 OpenAI 兼容服务器（`DEAL_RADAR_MOCK_LLM=1` 时由测试模式启动）；e2e 通过真实界面完成 AI 配置、错误 Key、连接测试、取消、Hugging Face 端到端添加、自然语言 / URL / GitHub 渠道识别，并断言 Key 不出现在状态和日志里。`scripts/discover-live.js` 实测任意厂商（可用 LLM_BASE / LLM_KEY / LLM_MODEL 接真实或模拟 AI）。

## v2.2.0：AI 厂商默认全开 + 分类

- `defaults.js`：`BRAND_GROUPS`（llm / agent / creative / software / cloud / custom / goods）与 `AI_GROUPS`；每个预设厂商带 `group`，`on` = 是否属于 AI 组。新增 7 个主流智能体厂商及其渠道（rss/page/render/sitemap/github/youtube/appstore/discourse），全部 2026-10-13 实测。
- `store.js`：配置版本 4 → 5。迁移在 `oldVersion < 5` 时把 AI 组的预设厂商一次性启用，跳过 `userOff`；`userOff` 由 `setBrandEnabled`、`setGroupEnabled`、`upsertBrand(enabled:false)`、`brand:enableOnly` 记录。新增 `setGroupEnabled(group, on)`（IPC `brand:group`）。
- `monitor.runAll`：按站点分组队列做 LPT 调度（最长队列先跑），`FAST_HOSTS` 对 news.google.com / hn.algolia.com / itunes / youtube / play / bing / github 使用 250–600ms 间隔（仍不超过用户设置的 hostGap），Reddit 保持 7s。
- `scripts/bench-scan.js`：全新默认配置的首次扫描基准（Node，跳过 render）。v2.1 调度 327s（含一次网络抖动）→ v2.2 87s，208/209 成功。
- 测试：`test/v22.test.js`（分组/默认值/迁移/幂等/批量），e2e 新增 7 项。

## v2.3.0：PM 深度优化（详见 PM_REVIEW.md）
- `core/offers.js`：`refineOffer`（LOSS / NOT_OFFER / QUESTION / PERSONAL / COMPARE / SPECULATE / STRONG 规则，pricing 永远保留）、`applyFeedback`（噪声词 + 来源惩罚≥3 需强信号）、`offerConfidence`（0–100；第三方中转 −30）。
- `core/facts.js`：`extractFacts` → amount / audience / regions / deadline / claim / trust / elig / confidence。
- `core/digest.js`：今日要点 + 每日摘要 + `inQuiet`（跨午夜）+ AI 翻译 prompt/解析。
- `store._migrateDeals`：一次性迁移（status、重跑 refine、补 facts），`dealsSchema=3`。
- main：通知按 status/可信度/截止过滤，免打扰排队，60s 定时 flush + 摘要；`enrichDeals` 扫描后批量 20 条；新 IPC deal:status / deal:notOffer / feedback:* / digest:now / ai:enrich。
- 渲染：首页 `#view-home`、紧凑卡片（无图不再画大色块）、详情 facts 网格、不是优惠弹窗、通知设置项。
- 测试：test/v23.test.js（8 项）+ 15 项 e2e。

## v2.4.0：厂商 logo + 多语言（i18n）
- **Logo**：`src/core/brandmeta.js`（58 个预置厂商的官网域名 + 中英文简介）；`scripts/fetch-logos.py` 构建期下载 → `assets/logos/<id>.png`（PIL 解码校验、裁边、居中、128×128；来源记录在 `sources.json`）。运行时 `src/core/logo.js`：为用户 / AI 添加的厂商抓取官网图标（声明的 icon → apple-touch-icon → Google s2 → favicon.ico），按文件头校验（PNG/JPEG/ICO/GIF/WebP/无脚本 SVG），缓存到 `userData/logos/`，`brand.logo` 记录文件名；聚合站域名（Google/Reddit/…）不抓。主进程 `logosMap()` 把预置 logo 映射为相对路径、自定义 logo 映射为 data URL，随 state 下发；渲染层 `avatar()` 统一输出，`img.blogo` 加载失败回退首字母色块。
- **i18n**：`src/renderer/i18n.js`（主进程 / 渲染进程共用 UMD）。gettext 风格：中文原文即 key，`src/locales/<lang>.json` 为译文。`L(key, ...args)` 用于界面文案（`{0}` 占位，支持语序调整）；`tx(text)` 用于运行期数据（渠道名、分组、事实字段、错误、日志）：按「中文片段」查表，数字归一化为占位符，失败时按分隔符贪心匹配、再逐词翻译。
- `scripts/i18n-rewrite.js`：基于 acorn 的 codemod，把 app.js / main.js 中的中文字面量和模板文本包成 `L()`（比较、正则、属性键等跳过）。`scripts/i18n-extract.js`：生成 `zh-CN.json`（源目录）并检查各语言缺失项、占位符一致性和硬编码残留（`--check` 用于单测）。
- 语言选择：`settings.lang = auto | zh-CN | en`；auto 时按 `app.getLocale()`（中文 → zh-CN，其余 → en）；`DEAL_RADAR_LANG` 仅在 auto 时作为覆盖（测试用）。preload 通过 `ipcRenderer.sendSync('i18n:sync')` 在 app.js 执行前注入词典；切换语言时主进程重建托盘菜单并 `webContents.reload()`（不重启进程）。英文界面下 `MutationObserver` 兜底翻译来自核心数据的中文片段，`translate="no"` 标记的内容区（优惠标题、摘要、发布方）不动。
- 优惠内容：`d.tr[lang] = {title, note, at}` 按语言缓存 AI 译文；`needsEnrich(d, lang)`（zh：英文条目；en：中文条目），`enrichPrompt(list, lang)`；v2.3 的 `titleZh/aiNote` 由 `_migrateI18n()` 迁入 `tr['zh-CN']`（dealsSchema 4）。`userData` 目录名与 `app.setName` 固定为中文，切换语言不影响数据位置。
- 测试：`test/v24.test.js`（7 项：t/tx、语言解析、词典完整性 + 残留扫描、logo 资产、logo 抓取、按语言翻译选择 + 英文摘要、迁移）；UI：中文 e2e 新增运行中切换语言检查；英文整套截图 + 可见中文残留扫描（`[i18n]` 行）。

## v2.5.0：精度 / 跨语言聚类 / AI 分类
- `offers.js`：COMMENTARY / PODCAST / RUMOR / NON_AI_SHOP；hideResellers；aiClass 缓存；STRONG 扩「offering free」。
- `cluster.js`：语言无关锚点（厂商、金额数字、时长、产品名、半价→50%）+ 同语言 / 跨语言合并条件；`mergeDeals` 窗口 7 天。
- `classify.js`：可选 AI 批量 offer/noise；`classifyDeals` 在每轮扫描后运行。
- `digest.js`：翻译提示词加强；`enrichLimit` 设置（默认 40）。
- 迁移 dealsSchema 5；测试 test/v25.test.js。
