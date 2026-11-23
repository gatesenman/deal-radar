# Deal Radar (全网优惠雷达) — User Guide · v2.14.0

[中文说明](README.md) · English

A Windows desktop app that **monitors offers from AI and software vendors in real time** — ChatGPT, Claude, Gemini, Cursor, DeepSeek and more: free trials, student offers, API credits, price cuts, new-user deals, limited-time promotions, startup programs, and changes on official pricing pages. Every vendor has its own official channels (blog, pricing page, changelog, status page, YouTube, GitHub releases, community forums), plus mainstream aggregators (Google/Bing News, Hacker News, Reddit, and regional tech media). New offers can trigger a desktop notification or a push to your phone. Physical-product deals (Apple, Nike, …) are optional and off by default. AI vendors are on by default.

## 1. Install / run

The source tree is **2.14.0**. Download the current Windows installer from [GitHub Releases · v2.9.0](https://github.com/gatesenman/deal-radar/releases/tag/v2.9.0) (a newer installer will ship in a later release):

- **Installer**: `DealRadar-Setup-2.9.0-x64.exe`
- **Source zip**: `DealRadar-2.9.0-source.zip`

SHA256:

```
d7464de239301fd03b64af8350c5c4904b1f41b2b002f3be806873e66b7cbee4  DealRadar-Setup-2.9.0-x64.exe
9e8749b5b0538547ab8e1c36ddf363c998c396cdb2cc291045daea00f3ef8ff5  DealRadar-2.9.0-source.zip
```

The app is not code-signed. If Windows SmartScreen shows “Windows protected your PC”, click “More info → Run anyway”.

Upgrades keep favorites, settings, custom vendors, and channels. Data is migrated automatically.

From source (Node.js + npm):

```bash
npm install
npm start
npm test
npm run dist:win     # Windows installer + portable build, when the environment supports it
```

## 2. Language

- The interface is **简体中文** and **English**. On first launch it follows the system language.
- Switch any time in **Settings → Appearance & window → Language**, or from the picker on the welcome screen. The window refreshes instantly. Tray menu, notifications, and digests follow the selected language.
- Offer titles can be shown in the selected language when an AI key is configured. The original title stays visible underneath.
- Dates and numbers follow the selected locale.

## 3. Quick start

1. **Welcome screen**: choose vendors (mainstream AI vendors are selected by default), optionally enable physical-product deals, pick a network mode, then click **Start monitoring**. Real offers usually appear within about a minute. Presets such as Student, Developer API, or Mainland China can pre-fill a profile and related filters.
2. **Today** (home): counts, top offers, official pricing-page changes, offers ending soon, and active vendors. Each row can be opened, marked claimed, ignored, or reported as not an offer.
3. **AI Offers**: tagged by type (trial, discount, credits, student, startup, limited-time, new plan, pricing change) with facts such as amount, who qualifies, region, deadline, and how to claim. Filter by vendor, type, region, validity, and “applies to me”; search with Ctrl+F; card / timeline / table views; export to CSV.
4. **Vendor lookup and claim guide**: search a vendor by English or Chinese name/alias to see current offers and official prices. Offer details include claim steps, an official link when known, and one-click promo-code copy.
5. **Vendors & channels**: each vendor shows its **logo** and a short description. Enable or mute vendors, inspect channel health, and add RSS/Atom, page-change, JS-rendered, sitemap, GitHub, Reddit, Discourse, YouTube, or news-search channels.
6. **Prices**: structured plan prices with CNY conversion and history. Only amount or plan changes raise a price alert.
7. **Push, digests, and views**: optional WeCom, Feishu, DingTalk, Telegram, Server酱, ntfy, or generic webhook channels (keys stay on this computer). Daily and weekly digests, saved views used as alert rules, and trial-expiry reminders.
8. **Coverage**: a transparency page shows, per vendor, last successful check, which sources were used, failures, and known login-walled gaps.
9. **Background**: closing the window minimizes to the tray. Right-click the tray icon to refresh, pause, or quit.

## 4. Logos

Preset vendor logos are bundled in `assets/logos/` (offline, HiDPI). Vendors you add get a favicon fetched once and cached in the data folder. If a logo cannot be loaded, a colored initials avatar is shown instead.

## 5. What 2.6–2.14 added

- Persistent list filters, a What’s new note after upgrades, a system theme, and lighter mid-refresh UI updates (v2.14).
- GitHub Releases update check (manual or daily) and push-channel retries (v2.13).
- Offer feedback with reasons, evidence badges, and a secret-stripping backup (v2.12).
- Soft-404 landing checks, more deadline formats, and broader price parsing (v2.11).
- Official feed gaps closed for Mistral, Microsoft Copilot, and Meta Llama API; paste-URL protocol detection when adding a channel (v2.10).

- Offer validity, “applies to me” profile (persisted), vendor lookup, claim guides, and coverage transparency (v2.6).
- Adaptive polling, structured prices with history and CNY, source reliability, and preference learning (v2.7).
- Push channels, weekly digest, saved views, share cards, onboarding presets, and trial reminders (v2.8).
- MinHash dedup, main-content extraction, price-aware diffs, corroboration, persistent HTTP cache, and polling jitter (v2.9).

Measured coverage of real mainstream deals is about 85% without logged-in sources. Reaching 99% would need logins or in-app sources. See [SOURCE_COVERAGE.md](SOURCE_COVERAGE.md) and [CHANGELOG.md](CHANGELOG.md).

## 6. Data location

`%APPDATA%\全网优惠雷达\` — `config.json`, `deals.json`, `logos/`, and caches. The folder name is the same in every language so upgrades keep your data.

See [DESIGN.md](DESIGN.md) for technical notes and [RESEARCH.md](RESEARCH.md) for the research behind later versions.

## License

[MIT](LICENSE)
